import type { ISimulationStage, SimulationContext } from './types'

export interface PipelineMiddleware {
  onStageStart?: (stageName: string) => void
  onStageComplete?: (stageName: string, durationMs: number) => void
  onPipelineComplete?: (durationMs: number) => void
}

export class PipelineScheduler {
  private stages: ISimulationStage[] = []
  private middlewares: PipelineMiddleware[] = []

  addStage(stage: ISimulationStage): this {
    this.stages.push(stage)
    return this
  }

  addMiddleware(middleware: PipelineMiddleware): this {
    this.middlewares.push(middleware)
    return this
  }

  async execute(context: SimulationContext): Promise<void> {
    const pipelineStartTime = performance.now()

    for (const stage of this.stages) {
      this.middlewares.forEach(m => m.onStageStart?.(stage.name))

      // Let the main thread breathe and update UI (important for progress bars)
      await new Promise(resolve => setTimeout(resolve, 0))

      const stageStartTime = performance.now()

      const result = stage.execute(context)
      if (result instanceof Promise) {
        await result
      }

      const durationMs = performance.now() - stageStartTime
      this.middlewares.forEach(m => m.onStageComplete?.(stage.name, durationMs))
    }

    const totalDurationMs = performance.now() - pipelineStartTime
    this.middlewares.forEach(m => m.onPipelineComplete?.(totalDurationMs))
  }
}
