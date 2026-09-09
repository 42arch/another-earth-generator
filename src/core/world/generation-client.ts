import type { GlobeGenParams } from '@/core/spherical/config'
import type { GenerationStage } from '@/core/world/generation-plan'
import type { GenerationRequest, GenerationResponse, GenerationResult } from '@/core/world/generation-protocol'
import { mergeGenerationStages } from '@/core/world/generation-plan'

export interface GenerationWorker {
  onmessage: ((event: MessageEvent<GenerationResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: (() => void) | null
  postMessage: (request: GenerationRequest) => void
  terminate: () => void
}

interface PendingGeneration {
  request: GenerationRequest
  resolve: (result: GenerationResult | null) => void
  reject: (error: Error) => void
  progress: (stage: string) => void
}

/** At most one running job and one coalesced pending job. */
export class GenerationClient {
  private worker: GenerationWorker | null = null
  private active: PendingGeneration | null = null
  private pending: PendingGeneration | null = null
  private nextId = 0
  private meshRevision = -1
  private uncommittedStage: GenerationStage | null = null
  private disposed = false

  constructor(private readonly createWorker: () => GenerationWorker = () =>
    new Worker(new URL('./generation.worker.ts', import.meta.url), { type: 'module' })) {}

  generate(params: GlobeGenParams, stage: GenerationStage | null, progress: (stage: string) => void): Promise<GenerationResult | null> {
    if (this.disposed)
      return Promise.reject(new Error('生成器已关闭。'))
    return new Promise((resolve, reject) => {
      const request = { id: ++this.nextId, params: { ...params }, stage, meshRevision: this.meshRevision }
      if (this.pending) {
        request.stage = mergeGenerationStages(request.stage, this.pending.request.stage)
        this.pending.resolve(null)
      }
      this.pending = { request, resolve, reject, progress }
      this.dispatch()
    })
  }

  cancel(): void {
    this.worker?.terminate()
    this.worker = null
    this.active?.resolve(null)
    this.pending?.resolve(null)
    this.active = null
    this.pending = null
    this.meshRevision = -1
    this.uncommittedStage = null
  }

  destroy(): void {
    this.disposed = true
    this.cancel()
  }

  private fail(error: Error): void {
    this.active?.reject(error)
    this.pending?.reject(error)
    this.cancel()
  }

  private dispatch(): void {
    if (this.active || !this.pending)
      return
    this.active = this.pending
    this.pending = null
    try {
      if (!this.worker) {
        const worker = this.createWorker()
        this.worker = worker
        worker.onmessage = event => {
          if (this.worker === worker)
            this.receive(event.data)
        }
        worker.onerror = event => {
          if (this.worker === worker)
            this.fail(new Error(event.message || '后台生成器启动失败。'))
        }
        worker.onmessageerror = () => {
          if (this.worker === worker)
            this.fail(new Error('无法读取生成结果，请重试。'))
        }
      }
      this.active.request.meshRevision = this.meshRevision
      this.worker.postMessage(this.active.request)
    }
    catch (error) {
      this.fail(error instanceof Error ? error : new Error('无法启动后台生成器。'))
    }
  }

  private receive(response: GenerationResponse): void {
    const active = this.active
    if (!active || response.id !== active.request.id)
      return
    if (response.type === 'progress') {
      if (!this.pending)
        active.progress(response.stage)
      return
    }
    this.active = null
    if (response.type === 'error') {
      if (this.pending)
        active.resolve(null)
      else
        active.reject(new Error(response.message))
    }
    else if (this.pending) {
      this.uncommittedStage = mergeGenerationStages(this.uncommittedStage, response.stage)
      active.resolve(null)
    }
    else {
      this.meshRevision = response.meshRevision
      active.resolve({ ...response, stage: mergeGenerationStages(this.uncommittedStage, response.stage) })
      this.uncommittedStage = null
    }
    this.dispatch()
  }
}
