import type { SphericalMesh } from '@another-earth/world-core'
import type { WorkerResponse } from '../lib/generation/protocol'
import { createMeshPipeline, MeshQueries, validateSphericalMesh } from '@another-earth/world-core'
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
    await runtime.handle({ type: 'GENERATE', requestId: 'bad', input: input(8, 0) })
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
