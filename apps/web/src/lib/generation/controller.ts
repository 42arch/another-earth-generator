import type { ClimateArtifact, CryosphereArtifact, EcologyArtifact, GeographicRegionsArtifact, GeologyArtifact, HydrologyArtifact, SphericalMesh, StagePlan, StaticLakeArtifact, TerrainArtifact } from '@another-earth/world-core'
import type { GenerationConfig, SerializedError, WorkerRequest, WorkerResponse } from './protocol'
import { validateClimateArtifact, validateCryosphereArtifact, validateEcologyArtifact, validateGeographicRegions, validateGeologyArtifact, validateHydrologyArtifact, validateStaticLakeArtifact, validateTerrainArtifact, WorldStore } from '@another-earth/world-core'
import { loadBuiltinGenerationCatalog } from '@another-earth/world-data'
import { hydrateMesh } from './transfer'

const namingPacks = loadBuiltinGenerationCatalog().packs

export type GenerationStatus = 'idle' | 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'
export interface GenerationState {
  readonly status: GenerationStatus
  readonly requestId?: string
  readonly stageId?: string
  readonly stageProgress?: number
  readonly pipelineProgress: number
  readonly detail?: string
  readonly postMessageMs?: number
}
export interface GenerationResult {
  readonly mesh: SphericalMesh
  readonly geology?: GeologyArtifact
  readonly terrain?: TerrainArtifact
  readonly regions?: GeographicRegionsArtifact
  readonly climate?: ClimateArtifact
  readonly cryosphere?: CryosphereArtifact
  readonly hydrology?: HydrologyArtifact
  readonly lakes?: StaticLakeArtifact
  readonly ecology?: EcologyArtifact
  readonly candidateWorld?: { readonly snapshotId: string, readonly worldId: string, readonly revision: number, readonly regionCount: number }
  readonly stages?: readonly StagePlan[]
  readonly cacheHit: boolean
  readonly cacheBytes: number
  readonly pipelineMs: number
  readonly copyMs: number
  readonly meshBytes: number
  readonly receiveMs: number
  readonly hydrateMs: number
}

export class GenerationCancelledError extends Error {
  constructor() {
    super('Generation cancelled')
    this.name = 'GenerationCancelledError'
  }
}

export class RemoteGenerationError extends Error {
  readonly stageId?: string
  constructor(error: SerializedError) {
    super(error.message)
    this.name = error.name
    this.stageId = error.stageId
    if (error.stack)
      this.stack = error.stack
  }
}

function createWorker(): Worker {
  return new Worker(new URL('../../workers/generation.worker.ts', import.meta.url), { type: 'module' })
}

export class GenerationController {
  #worldStore = new WorldStore()
  #candidateWorldStore?: WorldStore
  #factory: () => Worker
  #worker?: Worker
  #sequence = 0
  #active?: { id: string, kind: 'mesh' | 'geology' | 'terrain' | 'climate' | 'hydrology' | 'ecology' | 'world', expectedSnapshotId?: string, resolve: (value: GenerationResult) => void, reject: (reason: Error) => void, started: number }
  #pending = new Map<string, { resolve: (value: number) => void, reject: (reason: Error) => void }>()
  #disposed = false
  #state: GenerationState = { status: 'idle', pipelineProgress: 0 }
  #listener?: (state: GenerationState) => void
  workerInitMs = 0
  lastPostMessageMs = 0

  constructor(onState?: (state: GenerationState) => void, factory: () => Worker = createWorker) {
    this.#listener = onState
    this.#factory = factory
    this.#spawn()
  }

  get state(): GenerationState { return this.#state }
  get publishedWorld() { return this.#worldStore.identity }
  commitWorld(snapshotId: string): void {
    if (!this.#candidateWorldStore || this.#candidateWorldStore.identity?.snapshotId !== snapshotId)
      throw new Error('No matching validated world candidate')
    this.#worldStore = this.#candidateWorldStore
    this.#candidateWorldStore = undefined
  }
  queryWorldRegion(region: number, month = 0) { return this.#worldStore.region(region, month) }
  queryWorldBasin(id: string) { return this.#worldStore.basin(id) }
  queryWorldContinent(id: string) { return this.#worldStore.continent(id) }
  queryWorldOcean(id: string) { return this.#worldStore.ocean(id) }
  queryWorldSea(id: string) { return this.#worldStore.sea(id) }
  queryWorldRiver(id: string) { return this.#worldStore.river(id) }
  queryWorldLake(id: string) { return this.#worldStore.lake(id) }
  pickWorld(position: { readonly x: number, readonly y: number, readonly z: number }) { return this.#worldStore.pick(position) }
  exportWorldArchive() { return this.#worldStore.archive(namingPacks) }

  #setState(state: GenerationState): void {
    this.#state = state
    this.#listener?.(state)
  }

  #spawn(): void {
    const started = performance.now()
    this.#workerCreatedAt = started
    const worker = this.#factory()
    this.#worker = worker
    worker.addEventListener('message', this.#onMessage)
    worker.addEventListener('error', this.#onError)
    worker.addEventListener('messageerror', this.#onMessageError)
    this.workerInitMs = performance.now() - started
  }

  #stopWorker(): void {
    if (!this.#worker)
      return
    this.#worker.removeEventListener('message', this.#onMessage)
    this.#worker.removeEventListener('error', this.#onError)
    this.#worker.removeEventListener('messageerror', this.#onMessageError)
    this.#worker.terminate()
    this.#worker = undefined
    for (const pending of this.#pending.values()) pending.reject(new GenerationCancelledError())
    this.#pending.clear()
  }

  #onError = (event: ErrorEvent): void => {
    const error = new Error(event.message || 'Generation Worker failed')
    this.#active?.reject(error)
    this.#active = undefined
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
    this.#setState({ status: 'failed', pipelineProgress: this.#state.pipelineProgress, detail: error.message })
    this.#stopWorker()
  }

  #onMessageError = (): void => {
    this.#onError({ message: 'Cannot deserialize Worker response' } as ErrorEvent)
  }

  #onMessage = (event: MessageEvent<unknown>): void => {
    const value = event.data
    const types = ['READY', 'STARTED', 'PROGRESS', 'COMPLETED', 'TRANSFERRED', 'CANCELLED', 'FAILED', 'CACHE_CLEARED', 'PICKED']
    if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string' || !types.includes(value.type) || (value.type !== 'READY' && (!('requestId' in value) || typeof value.requestId !== 'string'))) {
      this.#onError({ message: 'Invalid Worker response' } as ErrorEvent)
      return
    }
    const message = value as WorkerResponse
    if (message.type === 'READY') {
      this.workerInitMs = performance.now() - this.#workerCreatedAt
      return
    }
    if (message.type === 'TRANSFERRED') {
      if (message.requestId === this.#lastCompletedId) {
        this.lastPostMessageMs = message.postMessageMs
        this.#setState({ ...this.#state, postMessageMs: message.postMessageMs })
      }
      return
    }
    if (message.type === 'CACHE_CLEARED' || message.type === 'PICKED' || (message.type === 'FAILED' && this.#pending.has(message.requestId))) {
      const pending = this.#pending.get(message.requestId)
      if (pending) {
        this.#pending.delete(message.requestId)
        if (message.type === 'FAILED')
          pending.reject(new RemoteGenerationError(message.error))
        else pending.resolve(message.type === 'PICKED' ? message.region : 0)
      }
      return
    }
    const active = this.#active
    if (!active || !('requestId' in message) || message.requestId !== active.id)
      return
    if (message.type === 'STARTED') {
      this.#setState({ status: 'running', requestId: active.id, pipelineProgress: 0 })
    }
    else if (message.type === 'PROGRESS') {
      this.#setState({ status: 'running', requestId: active.id, stageId: message.stageId, stageProgress: message.stageProgress, pipelineProgress: message.pipelineProgress, detail: message.message ?? message.status })
    }
    else if (message.type === 'COMPLETED') {
      try {
        const hydrating = performance.now()
        if ((active.kind === 'world' && (!message.world || !message.ecology || !message.hydrology || !message.lakes || !message.cryosphere || !message.climate || !message.terrain || !message.geology)) || (active.kind === 'ecology' && (!message.ecology || !message.climate || !message.terrain || !message.geology)) || (active.kind === 'hydrology' && (!message.hydrology || !message.lakes || !message.cryosphere || !message.climate || !message.terrain || !message.geology)) || (active.kind === 'climate' && (!message.climate || !message.terrain || !message.geology)) || (active.kind === 'terrain' && (!message.terrain || !message.geology)) || (active.kind === 'geology' && !message.geology))
          throw new TypeError('Worker response is missing requested generation data')
        const mesh = hydrateMesh(message.mesh)
        if (message.geology)
          validateGeologyArtifact(message.geology, mesh.meshId, mesh.regionCount)
        if (message.terrain) {
          if (!message.geology)
            throw new TypeError('Terrain response is missing geology')
          validateTerrainArtifact(message.terrain, mesh.meshId, mesh.regionCount, message.geology.plates.length)
        }
        if (message.regions) {
          if (!message.terrain) throw new TypeError('Geographic regions require terrain')
          validateGeographicRegions(message.regions, mesh.meshId, mesh.regionCount, message.terrain.landMask)
        }
        if (message.climate) {
          if (!message.terrain)
            throw new TypeError('Climate response is missing terrain')
          validateClimateArtifact(message.climate, mesh.meshId, mesh.regionCount)
        }
        if (message.cryosphere) {
          if (!message.terrain || !message.climate)
            throw new TypeError('Cryosphere response is missing terrain or climate')
          validateCryosphereArtifact(message.cryosphere, mesh.meshId, mesh.regionCount)
        }
        if (message.hydrology) {
          if (!message.terrain || !message.climate || !message.cryosphere)
            throw new TypeError('Hydrology response is missing terrain, climate or cryosphere')
          validateHydrologyArtifact(message.hydrology, mesh, message.terrain, message.climate, message.cryosphere)
        }
        if (message.lakes) {
          if (!message.terrain || !message.hydrology)
            throw new TypeError('Static lake response is missing terrain or hydrology')
          validateStaticLakeArtifact(message.lakes, mesh, message.terrain, message.hydrology)
        }
        if (message.ecology) {
          if (!message.terrain || !message.climate)
            throw new TypeError('Ecology response is missing terrain or climate')
          validateEcologyArtifact(message.ecology, mesh.meshId, mesh.regionCount)
        }
        if (active.kind === 'world') {
          if (!message.world || message.world.snapshotId !== active.expectedSnapshotId || message.world.mesh.meshId !== mesh.meshId)
            throw new TypeError('Worker world identity mismatch')
          const candidate = new WorldStore()
          candidate.publish(message.world, namingPacks)
          this.#candidateWorldStore = candidate
        }
        const hydrateMs = performance.now() - hydrating
        this.#active = undefined
        this.#lastCompletedId = active.id
        this.#setState({ status: 'completed', requestId: active.id, pipelineProgress: 1 })
        active.resolve({ mesh, geology: message.geology, terrain: message.terrain, regions: message.regions, climate: message.climate, cryosphere: message.cryosphere, hydrology: message.hydrology, lakes: message.lakes, ecology: message.ecology, candidateWorld: active.kind === 'world' ? this.#candidateWorldStore?.identity ?? undefined : undefined, stages: message.stages, cacheHit: message.cacheHit, cacheBytes: message.cacheBytes, pipelineMs: message.pipelineMs, copyMs: message.copyMs, meshBytes: message.meshBytes, receiveMs: performance.now() - active.started, hydrateMs })
      }
      catch (cause) {
        const error = cause instanceof Error ? cause : new Error('Mesh recovery failed')
        this.#active = undefined
        this.#setState({ status: 'failed', requestId: active.id, pipelineProgress: 0, detail: error.message })
        active.reject(error)
      }
    }
    else if (message.type === 'FAILED' || message.type === 'CANCELLED') {
      const error = message.type === 'CANCELLED' ? new GenerationCancelledError() : new RemoteGenerationError(message.error)
      this.#active = undefined
      this.#setState({ status: message.type === 'CANCELLED' ? 'cancelled' : 'failed', requestId: active.id, pipelineProgress: this.#state.pipelineProgress, detail: error.message })
      active.reject(error)
    }
  }

  #workerCreatedAt = performance.now()
  #lastCompletedId = ''

  generate(input: GenerationConfig): Promise<GenerationResult> {
    if (this.#disposed)
      return Promise.reject(new Error('Generation Controller is disposed'))
    if (this.#active)
      this.cancel('hard')
    this.#candidateWorldStore = undefined
    if (!this.#worker)
      this.#spawn()
    const id = `request-${++this.#sequence}`
    this.#setState({ status: 'starting', requestId: id, pipelineProgress: 0 })
    return new Promise((resolve, reject) => {
      this.#active = { id, kind: input.publication ? 'world' : input.config.ecology ? 'ecology' : input.config.hydrology ? 'hydrology' : input.config.climate ? 'climate' : input.config.terrain ? 'terrain' : input.config.geology ? 'geology' : 'mesh', expectedSnapshotId: input.publication?.snapshotId, resolve, reject, started: performance.now() }
      try {
        this.#worker!.postMessage({ type: 'GENERATE', requestId: id, input } satisfies WorkerRequest)
      }
      catch (cause) {
        this.#active = undefined
        const error = cause instanceof Error ? cause : new Error('Cannot send generation request')
        this.#setState({ status: 'failed', requestId: id, pipelineProgress: 0, detail: error.message })
        reject(error)
      }
    })
  }

  cancel(mode: 'cooperative' | 'hard' = 'hard'): void {
    const active = this.#active
    if (!active)
      return
    if (mode === 'cooperative') {
      this.#worker?.postMessage({ type: 'CANCEL', requestId: active.id } satisfies WorkerRequest)
      return
    }
    this.#active = undefined
    active.reject(new GenerationCancelledError())
    this.#setState({ status: 'cancelled', requestId: active.id, pipelineProgress: this.#state.pipelineProgress })
    this.#stopWorker()
    if (!this.#disposed)
      this.#spawn()
  }

  clearCache(): Promise<void> {
    if (this.#disposed)
      return Promise.reject(new Error('Generation Controller is disposed'))
    if (this.#active)
      return Promise.reject(new Error('Cannot clear cache during generation'))
    if (!this.#worker)
      this.#spawn()
    const id = `request-${++this.#sequence}`
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve: () => resolve(), reject })
      try {
        this.#worker!.postMessage({ type: 'CLEAR_CACHE', requestId: id } satisfies WorkerRequest)
      }
      catch (cause) {
        this.#pending.delete(id)
        reject(cause instanceof Error ? cause : new Error('Cannot clear Worker cache'))
      }
    })
  }

  pick(position: { x: number, y: number, z: number }): Promise<number> {
    if (this.#active)
      return Promise.reject(new Error('Cannot pick during generation'))
    if (!this.#worker)
      return Promise.reject(new Error('Generation Worker unavailable'))
    const id = `request-${++this.#sequence}`
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      try {
        this.#worker!.postMessage({ type: 'PICK', requestId: id, position } satisfies WorkerRequest)
      }
      catch (cause) {
        this.#pending.delete(id)
        reject(cause instanceof Error ? cause : new Error('Cannot request Mesh pick'))
      }
    })
  }

  dispose(): void {
    this.#disposed = true
    this.#active?.reject(new GenerationCancelledError())
    this.#active = undefined
    for (const pending of this.#pending.values()) pending.reject(new GenerationCancelledError())
    this.#pending.clear()
    this.#stopWorker()
    this.#setState({ status: 'idle', pipelineProgress: 0 })
  }
}
