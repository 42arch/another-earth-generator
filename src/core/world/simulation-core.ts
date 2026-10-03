import type { WorldConfig } from '@/core/simulation/config'
import type { PipelineMiddleware } from '@/core/simulation/pipeline/scheduler'
import type { GeneratedSphericalWorld } from '@/core/simulation/pipeline/types'
import type { WorkerMessage, WorkerResponse } from '@/core/simulation/worker/simulation.worker'
import SphericalMesh from '@/core/mesh/mesh'

export class GenerationAbortedError extends Error {
  constructor() {
    super('World generation was superseded by a newer request')
    this.name = 'GenerationAbortedError'
  }
}

export class SimulationCore {
  private lastGenerated: GeneratedSphericalWorld | null = null

  private worker: Worker | null = null
  private activeGeneration: { worker: Worker, reject: (reason: Error) => void } | null = null
  private middlewares: PipelineMiddleware[] = []
  private stageTimings: Array<{ stage: string, durationMs: number }> = []

  constructor(_config: WorldConfig) {
    this.initWorker()
  }

  private initWorker() {
    this.cancelActiveGeneration()
    // Using Vite's special ?worker import syntax or native module worker
    this.worker = new Worker(new URL('../simulation/worker/simulation.worker.ts', import.meta.url), { type: 'module' })
  }

  /** Settles the promise before terminating its worker, so callers never await a dead worker forever. */
  private cancelActiveGeneration() {
    const activeGeneration = this.activeGeneration
    this.activeGeneration = null
    if (activeGeneration)
      activeGeneration.reject(new GenerationAbortedError())
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
  }

  addMiddleware(middleware: PipelineMiddleware) {
    this.middlewares.push(middleware)
  }

  generate(config: WorldConfig): Promise<GeneratedSphericalWorld> {
    // We recreate worker each time to ensure clean state and avoid overlapping runs
    this.initWorker()
    this.stageTimings = []
    const worker = this.worker!

    return new Promise((resolve, reject) => {
      const fail = (error: Error) => {
        if (this.activeGeneration?.worker !== worker)
          return
        this.activeGeneration = null
        reject(error)
      }
      const succeed = (data: GeneratedSphericalWorld) => {
        if (this.activeGeneration?.worker !== worker)
          return
        this.activeGeneration = null
        this.lastGenerated = data
        resolve(data)
      }

      this.activeGeneration = { worker, reject }
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data
        if (msg.type === 'PROGRESS') {
          this.middlewares.forEach(m => m.onStageStart?.(msg.stageName))
        }
        else if (msg.type === 'STAGE_COMPLETE') {
          this.stageTimings.push({ stage: msg.stageName, durationMs: msg.durationMs })
          this.middlewares.forEach(m => m.onStageComplete?.(msg.stageName, msg.durationMs))
        }
        else if (msg.type === 'PIPELINE_COMPLETE') {
          this.middlewares.forEach(m => m.onPipelineComplete?.(msg.durationMs))
        }
        else if (msg.type === 'ERROR') {
          fail(new Error(msg.error))
        }
        else if (msg.type === 'SUCCESS') {
          try {
            const data = msg.payload
            const restoreStart = performance.now()

            // Reconstruct class instances that lost their prototypes during postMessage
            const sameMesh = data.mesh === data.referenceMesh
            data.mesh = new SphericalMesh(data.mesh as any)
            data.referenceMesh = sameMesh ? data.mesh : new SphericalMesh(data.referenceMesh as any)
            this.stageTimings.push({ stage: 'RestoreMesh', durationMs: performance.now() - restoreStart })
            // eslint-disable-next-line no-console
            console.table(this.stageTimings.map(({ stage, durationMs }) => ({ stage, ms: Math.round(durationMs) })))

            succeed(data)
          }
          catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)))
          }
        }
      }
      worker.onerror = (event) => {
        event.preventDefault()
        fail(new Error(event.message || 'World generation worker failed'))
      }
      worker.onmessageerror = () => {
        fail(new Error('World generation worker returned an unreadable result'))
      }

      try {
        worker.postMessage({ type: 'GENERATE', payload: config } as WorkerMessage)
      }
      catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  get state(): GeneratedSphericalWorld | null {
    return this.lastGenerated
  }

  get timings(): ReadonlyArray<{ stage: string, durationMs: number }> {
    return this.stageTimings
  }
}
