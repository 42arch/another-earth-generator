import type { GeologyArtifact, SphericalMesh, TerrainArtifact, TerrainGenerationConfig } from '@another-earth/world-core'
import type { WorkerRequest, WorkerResponse } from '../lib/generation/protocol'
import { createGeologyPipeline, createMeshPipeline, createTerrainPipeline, PipelineCancelledError, SphericalSpatialIndex } from '@another-earth/world-core'
import { serializeError } from '../lib/generation/protocol'
import { transferSnapshot } from '../lib/generation/transfer'

export class GenerationWorkerRuntime {
  readonly pipeline = createMeshPipeline()
  readonly geologyPipeline = createGeologyPipeline(this.pipeline.cache)
  readonly terrainPipeline = createTerrainPipeline(this.pipeline.cache)
  #active?: { id: string, abort: AbortController }
  #mesh?: SphericalMesh
  #index?: SphericalSpatialIndex
  #send: (message: WorkerResponse, buffers?: ArrayBuffer[]) => void

  constructor(send: (message: WorkerResponse, buffers?: ArrayBuffer[]) => void) {
    this.#send = send
  }

  async handle(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object' || !('requestId' in raw) || typeof raw.requestId !== 'string' || !raw.requestId || !('type' in raw) || typeof raw.type !== 'string') {
      this.#send({ type: 'FAILED', requestId: 'invalid', error: { name: 'ProtocolError', message: 'Invalid request' } })
      return
    }
    const request = raw as WorkerRequest
    if (request.type === 'CANCEL') {
      if (this.#active?.id === request.requestId)
        this.#active.abort.abort()
      return
    }
    if (request.type === 'CLEAR_CACHE') {
      if (this.#active) {
        this.#send({ type: 'FAILED', requestId: request.requestId, error: { name: 'BusyError', message: 'Cannot clear cache during generation' } })
        return
      }
      this.pipeline.cache.clear()
      this.#mesh = undefined
      this.#index = undefined
      this.#send({ type: 'CACHE_CLEARED', requestId: request.requestId })
      return
    }
    if (request.type === 'PICK') {
      if (!this.#mesh) {
        this.#send({ type: 'FAILED', requestId: request.requestId, error: { name: 'NoMeshError', message: 'No Mesh is available' } })
        return
      }
      try {
        this.#index ??= new SphericalSpatialIndex(this.#mesh)
        this.#send({ type: 'PICKED', requestId: request.requestId, region: this.#index.findNearestRegion(request.position) })
      }
      catch (error) {
        this.#send({ type: 'FAILED', requestId: request.requestId, error: serializeError(error) })
      }
      return
    }
    if (request.type !== 'GENERATE') {
      this.#send({ type: 'FAILED', requestId: raw.requestId, error: { name: 'ProtocolError', message: 'Unknown request type' } })
      return
    }
    if (this.#active) {
      this.#send({ type: 'FAILED', requestId: request.requestId, error: { name: 'BusyError', message: 'Worker already has an active generation' } })
      return
    }
    const task = { id: request.requestId, abort: new AbortController() }
    this.#active = task
    this.#send({ type: 'STARTED', requestId: task.id })
    try {
      const started = performance.now()
      const terrainRequested = request.input.config.terrain !== undefined
      if (terrainRequested && (!request.input.config.geology || !request.input.config.landforms))
        throw new Error('Terrain generation requires geology and landform parameters')
      const pipeline = terrainRequested ? this.terrainPipeline : request.input.config.geology ? this.geologyPipeline : this.pipeline
      const result = await pipeline.execute({ seed: request.input.seed, config: request.input.config as TerrainGenerationConfig }, {
        runId: task.id,
        signal: task.abort.signal,
        force: request.input.force,
        onEvent: event => this.#send({ type: 'PROGRESS', requestId: task.id, stageId: event.stageId, stageProgress: event.stageProgress, pipelineProgress: event.pipelineProgress, durationMs: event.durationMs, status: event.type, message: event.message }),
      })
      const pipelineMs = performance.now() - started
      if (task.abort.signal.aborted)
        throw new PipelineCancelledError('mesh')
      const mesh = result.getOutput<SphericalMesh>('mesh')
      const copying = performance.now()
      const geology = request.input.config.geology ? result.getOutput<GeologyArtifact>('geology') : undefined
      const terrain = terrainRequested ? result.getOutput<TerrainArtifact>('terrain') : undefined
      const snapshot = transferSnapshot(mesh, geology, terrain)
      const copyMs = performance.now() - copying
      const posting = performance.now()
      this.#send({ type: 'COMPLETED', requestId: task.id, mesh: snapshot.mesh, geology: snapshot.geology, terrain: snapshot.terrain, stages: result.plan, cacheHit: result.plan.every(stage => stage.action === 'cache-hit'), cacheBytes: this.pipeline.cache.usedBytes, pipelineMs, copyMs, meshBytes: snapshot.bytes }, snapshot.buffers)
      this.#mesh = mesh
      this.#index = undefined
      this.#send({ type: 'TRANSFERRED', requestId: task.id, postMessageMs: performance.now() - posting })
    }
    catch (error) {
      this.#send(error instanceof PipelineCancelledError || task.abort.signal.aborted
        ? { type: 'CANCELLED', requestId: task.id }
        : { type: 'FAILED', requestId: task.id, error: serializeError(error) })
    }
    finally {
      if (this.#active === task)
        this.#active = undefined
    }
  }
}
