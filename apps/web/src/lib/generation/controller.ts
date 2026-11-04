import type { SphericalMesh } from '@another-earth/world-core'
import type { GenerationConfig, SerializedError, WorkerRequest, WorkerResponse } from './protocol'
import { hydrateMesh } from './transfer'

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
  #factory: () => Worker
  #worker?: Worker
  #sequence = 0
  #active?: { id: string, resolve: (value: GenerationResult) => void, reject: (reason: Error) => void, started: number }
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
      this.#setState({ status: 'running', requestId: active.id, stageId: message.stageId, stageProgress: message.stageProgress, pipelineProgress: message.pipelineProgress, detail: message.status })
    }
    else if (message.type === 'COMPLETED') {
      try {
        const hydrating = performance.now()
        const mesh = hydrateMesh(message.mesh)
        const hydrateMs = performance.now() - hydrating
        this.#active = undefined
        this.#lastCompletedId = active.id
        this.#setState({ status: 'completed', requestId: active.id, pipelineProgress: 1 })
        active.resolve({ mesh, cacheHit: message.cacheHit, cacheBytes: message.cacheBytes, pipelineMs: message.pipelineMs, copyMs: message.copyMs, meshBytes: message.meshBytes, receiveMs: performance.now() - active.started, hydrateMs })
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
    if (!this.#worker)
      this.#spawn()
    const id = `request-${++this.#sequence}`
    this.#setState({ status: 'starting', requestId: id, pipelineProgress: 0 })
    return new Promise((resolve, reject) => {
      this.#active = { id, resolve, reject, started: performance.now() }
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
