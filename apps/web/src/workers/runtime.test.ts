import type { SphericalMesh } from '@another-earth/world-core'
import type { WorkerResponse } from '../lib/generation/protocol'
import { createMeshPipeline, DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS, MeshQueries, validateGeologyArtifact, validateSphericalMesh, validateTerrainArtifact } from '@another-earth/world-core'
import { describe, expect, it } from 'vitest'
import { hydrateMesh } from '../lib/generation/transfer'
import { GenerationWorkerRuntime } from './runtime'

const input = (level: number, irregularity: number, seed = '42') => ({ seed, config: { planet: { physicalRadiusKm: 6371 }, mesh: { subdivisionLevel: level, irregularity } } })

describe('generationWorkerRuntime', () => {
  it.each([0, 0.5])('runs the real MeshStage and transfers regularity %s with intact cache', async (irregularity) => {
    const messages: WorkerResponse[] = []
    const runtime = new GenerationWorkerRuntime((message, buffers = []) => {
      messages.push(buffers.length ? { ...message, mesh: hydrateMesh(structuredClone((message as Extract<WorkerResponse, { type: 'COMPLETED' }>).mesh, { transfer: buffers })) } as WorkerResponse : message)
    })
    const request = { type: 'GENERATE' as const, requestId: 'one', input: input(2, irregularity) }
    await runtime.handle(request)
    const first = messages.find((m): m is Extract<WorkerResponse, { type: 'COMPLETED' }> => m.type === 'COMPLETED')!
    expect(first.cacheHit).toBe(false)
    expect(messages.some(m => m.type === 'PROGRESS')).toBe(true)
    expect(validateSphericalMesh(first.mesh).valid).toBe(true)
    const direct = await createMeshPipeline().execute(request.input)
    const directMesh = direct.getOutput<SphericalMesh>('mesh')
    expect(first.mesh.centers).toEqual(directMesh.centers)
    expect(first.mesh.triangles).toEqual(directMesh.triangles)
    expect(new MeshQueries(first.mesh).getNeighborCount(0)).toBe(new MeshQueries(directMesh).getNeighborCount(0))
    await runtime.handle({ ...request, requestId: 'two' })
    const second = messages.filter((m): m is Extract<WorkerResponse, { type: 'COMPLETED' }> => m.type === 'COMPLETED')[1]
    expect(second.cacheHit).toBe(true)
    expect(second.mesh.centers).toEqual(first.mesh.centers)
    await runtime.handle({ ...request, requestId: 'three', input: { ...request.input, config: { ...request.input.config, climate: { precipitationFactor: 2 } } } })
    expect(messages.filter(m => m.type === 'COMPLETED')[2]).toMatchObject({ cacheHit: true })
    await runtime.handle({ ...request, requestId: 'four', input: input(3, irregularity) })
    expect(messages.filter(m => m.type === 'COMPLETED')[3]).toMatchObject({ cacheHit: false })
    await runtime.handle({ type: 'PICK', requestId: 'pick', position: { x: 1, y: 0, z: 0 } })
    expect(messages.some(m => m.type === 'PICKED' && m.requestId === 'pick')).toBe(true)
    await runtime.handle({ type: 'CLEAR_CACHE', requestId: 'clear' })
    expect(runtime.pipeline.cache.usedBytes).toBe(0)
  })

  it('rejects malformed input and remains reusable after failure', async () => {
    const messages: WorkerResponse[] = []
    const runtime = new GenerationWorkerRuntime(message => messages.push(message))
    await runtime.handle({ nonsense: true })
    expect(messages[0]).toMatchObject({ type: 'FAILED', error: { name: 'ProtocolError' } })
    await runtime.handle({ type: 'GENERATE', requestId: 'bad', input: input(9, 0) })
    expect(messages.some(m => m.type === 'FAILED' && m.requestId === 'bad')).toBe(true)
    await runtime.handle({ type: 'GENERATE', requestId: 'good', input: input(0, 0) })
    expect(messages.some(m => m.type === 'COMPLETED' && m.requestId === 'good')).toBe(true)
  })

  it('does not cache a request cancelled before Stage execution', async () => {
    const messages: WorkerResponse[] = []
    const runtime = new GenerationWorkerRuntime(message => messages.push(message))
    const running = runtime.handle({ type: 'GENERATE', requestId: 'cancel', input: input(0, 0) })
    await runtime.handle({ type: 'CANCEL', requestId: 'cancel' })
    await running
    expect(messages.some(m => m.type === 'CANCELLED' && m.requestId === 'cancel')).toBe(true)
  })
})

it('transfers geology copies without detaching cache and recovers after invalid geology', async () => {
  const messages: WorkerResponse[] = []
  const runtime = new GenerationWorkerRuntime((message, transfer = []) => {
    messages.push(structuredClone(message, { transfer }))
  })
  const request = { type: 'GENERATE', requestId: 'geology-one', input: { ...input(2, 0.5), config: { ...input(2, 0.5).config, reference: { subdivisionLevel: 2 }, geology: { ...DEFAULT_GEOLOGY_PARAMETERS } } } }
  await runtime.handle(request)
  const first = messages.find((m): m is Extract<WorkerResponse, { type: 'COMPLETED' }> => m.type === 'COMPLETED')!
  expect(first.geology).toBeDefined()
  validateGeologyArtifact(first.geology!, first.mesh.meshId, first.mesh.regionCount)
  const expected = first.geology!.plateIndex[0]
  first.geology!.plateIndex[0] = 999
  await runtime.handle({ ...request, requestId: 'geology-two' })
  const second = messages.filter((m): m is Extract<WorkerResponse, { type: 'COMPLETED' }> => m.type === 'COMPLETED')[1]
  expect(second.geology!.plateIndex[0]).toBe(expected)
  expect(second.stages?.every(stage => stage.action === 'cache-hit')).toBe(true)
  await runtime.handle({ ...request, requestId: 'bad-geology', input: { ...request.input, config: { ...request.input.config, geology: { ...DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS, primaryPlateCount: 101 } } } })
  expect(messages).toContainEqual(expect.objectContaining({ type: 'FAILED', requestId: 'bad-geology' }))
  await runtime.handle({ type: 'PICK', requestId: 'old-geology-pick', position: { x: 1, y: 0, z: 0 } })
  expect(messages).toContainEqual(expect.objectContaining({ type: 'PICKED', requestId: 'old-geology-pick' }))
  await runtime.handle({ ...request, requestId: 'geology-three' })
  expect(messages.filter(m => m.type === 'COMPLETED')).toHaveLength(3)
})

it('transfers terrain independently, validates it and reuses tectonics on postprocessing changes', async () => {
  const messages: WorkerResponse[] = []
  const runtime = new GenerationWorkerRuntime((message, transfer = []) => messages.push(structuredClone(message, { transfer })))
  const request = { type: 'GENERATE', requestId: 'terrain-first', input: { ...input(3, 0.5), config: { ...input(3, 0.5).config, reference: { subdivisionLevel: 2 }, geology: DEFAULT_GEOLOGY_PARAMETERS, landforms: DEFAULT_LANDFORM_PARAMETERS, terrain: { ...DEFAULT_TERRAIN_PARAMETERS } } } }
  await runtime.handle(request)
  const first = messages.find((m): m is Extract<WorkerResponse, { type: 'COMPLETED' }> => m.type === 'COMPLETED')!
  expect(first.terrain).toBeDefined()
  validateTerrainArtifact(first.terrain!, first.mesh.meshId, first.mesh.regionCount, first.geology!.plates.length)
  expect(first.terrain!.regionalUpliftCoordinate).toBeInstanceOf(Float32Array)
  expect(first.terrain!.regionalReliefKm).toBeInstanceOf(Float32Array)
  const weight = first.terrain!.roughnessWeight[0]
  first.terrain!.roughnessWeight[0] = 999
  const uplift = first.terrain!.regionalUpliftCoordinate[0]
  first.terrain!.regionalUpliftCoordinate[0] = 999
  const height = first.terrain!.elevationKm[0]
  first.terrain!.elevationKm[0] = 999
  await runtime.handle({ ...request, requestId: 'terrain-second' })
  const second = messages.filter((m): m is Extract<WorkerResponse, { type: 'COMPLETED' }> => m.type === 'COMPLETED')[1]
  expect(second.terrain!.elevationKm[0]).toBe(height)
  expect(second.terrain!.regionalUpliftCoordinate[0]).toBe(uplift)
  expect(second.terrain!.roughnessWeight[0]).toBe(weight)
  expect(second.stages?.every(stage => stage.action === 'cache-hit')).toBe(true)
  request.input.config.terrain.roughness = 0.1
  await runtime.handle({ ...request, requestId: 'terrain-changed' })
  const third = messages.filter((m): m is Extract<WorkerResponse, { type: 'COMPLETED' }> => m.type === 'COMPLETED')[2]
  expect(third.stages?.filter(stage => stage.action === 'execute').map(stage => stage.stageId)).toEqual(['terrain'])
})
