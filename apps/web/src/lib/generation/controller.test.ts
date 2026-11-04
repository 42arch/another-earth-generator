import type { WorkerRequest, WorkerResponse } from './protocol'
import { createSphericalMesh } from '@another-earth/world-core'
import { describe, expect, it, vi } from 'vitest'
import { GenerationCancelledError, GenerationController } from './controller'

class MockWorker extends EventTarget {
  sent: WorkerRequest[] = []
  terminated = false
  postMessage(request: WorkerRequest): void { this.sent.push(request) }
  terminate(): void { this.terminated = true }
  reply(response: WorkerResponse): void { this.dispatchEvent(new MessageEvent('message', { data: response })) }
  fail(): void { this.dispatchEvent(Object.assign(new Event('error'), { message: 'Worker crashed' })) }
}
const input = { seed: '42', config: { planet: { physicalRadiusKm: 6371 }, mesh: { subdivisionLevel: 0, irregularity: 0 } } }
const mesh = createSphericalMesh({ subdivisionLevel: 0, physicalRadiusKm: 6371 })
const complete = (id: string): WorkerResponse => ({ type: 'COMPLETED', requestId: id, mesh, cacheHit: false, cacheBytes: 1024, pipelineMs: 4, copyMs: 2, meshBytes: 2048 })

describe('generationController', () => {
  it('tracks startup, progress, completion and stale messages', async () => {
    const worker = new MockWorker()
    const states: string[] = []
    const controller = new GenerationController(s => states.push(s.status), () => worker as unknown as Worker)
    worker.reply({ type: 'READY' })
    const promise = controller.generate(input)
    const id = worker.sent[0].requestId
    worker.reply({ type: 'STARTED', requestId: id })
    worker.reply({ type: 'PROGRESS', requestId: id, stageId: 'mesh', stageProgress: 0.5, pipelineProgress: 0.5, status: 'stage-progress' })
    expect(controller.state.pipelineProgress).toBe(0.5)
    worker.reply(complete('stale'))
    expect(controller.state.status).toBe('running')
    worker.reply(complete(id))
    expect((await promise).mesh).toEqual(mesh)
    expect(states).toEqual(['starting', 'running', 'running', 'completed'])
    controller.dispose()
    expect(worker.terminated).toBe(true)
  })

  it('hard-cancels old work and creates a fresh Worker for the latest request', async () => {
    const workers: MockWorker[] = []
    const controller = new GenerationController(undefined, () => {
      const worker = new MockWorker()
      workers.push(worker)
      return worker as unknown as Worker
    })
    const old = controller.generate(input)
    const latest = controller.generate(input)
    await expect(old).rejects.toBeInstanceOf(GenerationCancelledError)
    expect(workers[0].terminated).toBe(true)
    workers[0].reply(complete(workers[0].sent[0].requestId))
    expect(controller.state.status).toBe('starting')
    workers[1].reply(complete(workers[1].sent[0].requestId))
    await expect(latest).resolves.toMatchObject({ mesh })
    controller.dispose()
  })

  it('supports cooperative cancel, remote errors, cache control and picking', async () => {
    const worker = new MockWorker()
    const controller = new GenerationController(undefined, () => worker as unknown as Worker)
    const task = controller.generate(input)
    const id = worker.sent[0].requestId
    controller.cancel('cooperative')
    expect(worker.sent[1]).toEqual({ type: 'CANCEL', requestId: id })
    worker.reply({ type: 'CANCELLED', requestId: id })
    await expect(task).rejects.toBeInstanceOf(GenerationCancelledError)
    const failed = controller.generate(input)
    worker.reply({ type: 'FAILED', requestId: worker.sent[2].requestId, error: { name: 'StageExecutionError', message: 'bad mesh', stageId: 'mesh' } })
    await expect(failed).rejects.toMatchObject({ message: 'bad mesh', stageId: 'mesh' })
    const clear = controller.clearCache()
    worker.reply({ type: 'CACHE_CLEARED', requestId: worker.sent[3].requestId })
    await expect(clear).resolves.toBeUndefined()
    const pick = controller.pick({ x: 1, y: 0, z: 0 })
    worker.reply({ type: 'PICKED', requestId: worker.sent[4].requestId, region: 7 })
    await expect(pick).resolves.toBe(7)
    controller.dispose()
  })

  it('rejects all pending work after a Worker crash or disposal', async () => {
    const worker = new MockWorker()
    const controller = new GenerationController(undefined, () => worker as unknown as Worker)
    const task = controller.generate(input)
    worker.fail()
    await expect(task).rejects.toThrow('Worker crashed')
    expect(controller.state.status).toBe('failed')
    expect(worker.terminated).toBe(true)
    const pending = controller.clearCache()
    controller.dispose()
    await expect(pending).rejects.toBeInstanceOf(GenerationCancelledError)
  })

  it('does not leave promises pending if postMessage fails', async () => {
    const worker = new MockWorker()
    vi.spyOn(worker, 'postMessage').mockImplementation(() => {
      throw new Error('clone failed')
    })
    const controller = new GenerationController(undefined, () => worker as unknown as Worker)
    await expect(controller.generate(input)).rejects.toThrow('clone failed')
    await expect(controller.clearCache()).rejects.toThrow('clone failed')
    controller.dispose()
  })

  it('fails an active request on an invalid Worker response', async () => {
    const worker = new MockWorker()
    const controller = new GenerationController(undefined, () => worker as unknown as Worker)
    const task = controller.generate(input)
    worker.dispatchEvent(new MessageEvent('message', { data: { type: 'UNKNOWN', requestId: worker.sent[0].requestId } }))
    await expect(task).rejects.toThrow('Invalid Worker response')
    expect(worker.terminated).toBe(true)
    controller.dispose()
  })
})
