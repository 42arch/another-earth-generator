import type { GenerationWorker } from '@/core/world/generation-client'
import type { GenerationRequest, GenerationResponse } from '@/core/world/generation-protocol'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_GLOBE_GEN_PARAMS } from '@/core/spherical/config'
import { GenerationClient } from '@/core/world/generation-client'

class FakeWorker implements GenerationWorker {
  onmessage: GenerationWorker['onmessage'] = null
  onerror: GenerationWorker['onerror'] = null
  onmessageerror: GenerationWorker['onmessageerror'] = null
  requests: GenerationRequest[] = []
  terminate = vi.fn()
  postMessage(request: GenerationRequest) { this.requests.push(request) }
  respond(response: GenerationResponse) { this.onmessage?.({ data: response } as MessageEvent<GenerationResponse>) }
  complete(id: number, meshRevision = 1) {
    this.respond({ type: 'result', id, meshRevision, data: {} as never, stage: 'world', timings: {} })
  }
}

describe('background generation lifecycle', () => {
  it('discards stale results and coalesces pending dependency stages', async () => {
    const worker = new FakeWorker()
    const client = new GenerationClient(() => worker)
    const progress = vi.fn()
    const first = client.generate(DEFAULT_GLOBE_GEN_PARAMS, 'world', progress)
    const second = client.generate(DEFAULT_GLOBE_GEN_PARAMS, 'hydrology', progress)
    const third = client.generate(DEFAULT_GLOBE_GEN_PARAMS, 'religions', progress)
    expect(await second).toBeNull()
    expect(worker.requests).toHaveLength(1)
    worker.respond({ type: 'progress', id: 1, stage: 'climate' })
    expect(progress).not.toHaveBeenCalled()
    worker.complete(1)
    expect(await first).toBeNull()
    expect(worker.requests[1].stage).toBe('hydrology')
    expect(worker.requests[1].meshRevision).toBe(-1)
    worker.complete(3)
    expect((await third)?.id).toBe(3)
    client.destroy()
  })

  it('cancels active work and can start a fresh worker', async () => {
    const workers: FakeWorker[] = []
    const client = new GenerationClient(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    })
    const first = client.generate(DEFAULT_GLOBE_GEN_PARAMS, 'world', () => {})
    client.cancel()
    expect(await first).toBeNull()
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    const retry = client.generate(DEFAULT_GLOBE_GEN_PARAMS, 'hydrology', () => {})
    workers[0].complete(1)
    workers[0].onerror?.({ message: 'late error from terminated worker' } as ErrorEvent)
    workers[0].onmessageerror?.()
    workers[1].complete(2)
    expect((await retry)?.id).toBe(2)
    client.destroy()
  })

  it('includes discarded updates when invalidating the displayed world', async () => {
    const worker = new FakeWorker()
    const client = new GenerationClient(() => worker)
    const initial = client.generate(DEFAULT_GLOBE_GEN_PARAMS, 'world', () => {})
    worker.complete(1)
    await initial

    const terrain = client.generate(DEFAULT_GLOBE_GEN_PARAMS, 'elevation', () => {})
    const religion = client.generate(DEFAULT_GLOBE_GEN_PARAMS, 'religions', () => {})
    worker.respond({ type: 'result', id: 2, meshRevision: 1, data: {} as never, stage: 'elevation', timings: {} })
    expect(await terrain).toBeNull()
    worker.respond({ type: 'result', id: 3, meshRevision: 1, data: {} as never, stage: 'religions', timings: {} })
    expect((await religion)?.stage).toBe('elevation')

    const next = client.generate(DEFAULT_GLOBE_GEN_PARAMS, 'religions', () => {})
    worker.respond({ type: 'result', id: 4, meshRevision: 1, data: {} as never, stage: 'religions', timings: {} })
    expect((await next)?.stage).toBe('religions')
    client.destroy()
  })

  it('reports worker startup failures and permits retry', async () => {
    const worker = new FakeWorker()
    const create = vi.fn().mockImplementationOnce(() => { throw new Error('startup failed') }).mockReturnValue(worker)
    const client = new GenerationClient(create)
    await expect(client.generate(DEFAULT_GLOBE_GEN_PARAMS, 'world', () => {})).rejects.toThrow('startup failed')
    const retry = client.generate(DEFAULT_GLOBE_GEN_PARAMS, 'world', () => {})
    worker.complete(2)
    expect((await retry)?.id).toBe(2)
    client.destroy()
  })
})
