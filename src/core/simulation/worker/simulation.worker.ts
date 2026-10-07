import type { WorldConfig } from '@/core/simulation/config'
import type { GeneratedSphericalWorld, SimulationContext } from '@/core/simulation/pipeline/types'
import { PipelineScheduler } from '@/core/simulation/pipeline/scheduler'
import { BiomeStage } from '@/core/simulation/pipeline/stages/biome-stage'
import { ClimateOutputStage } from '@/core/simulation/pipeline/stages/climate-output-stage'
import { ContinentalCrustStage } from '@/core/simulation/pipeline/stages/continental-crust-stage'
import { KoppenClimateStage } from '@/core/simulation/pipeline/stages/koppen-climate-stage'
import { MeshStage } from '@/core/simulation/pipeline/stages/mesh-stage'
import { MonthlyClimateStage } from '@/core/simulation/pipeline/stages/monthly-climate-stage'
import { PlateStage } from '@/core/simulation/pipeline/stages/plate-stage'
import { ProjectionStage } from '@/core/simulation/pipeline/stages/projection-stage'
import { SeasonalCirculationStage } from '@/core/simulation/pipeline/stages/seasonal-circulation-stage'
import { SuperPlateStage } from '@/core/simulation/pipeline/stages/super-plate-stage'
import { SurfaceHydrologyStage } from '@/core/simulation/pipeline/stages/surface-hydrology-stage'
import { TectonicStage } from '@/core/simulation/pipeline/stages/tectonic-stage'
import { TerrainStage } from '@/core/simulation/pipeline/stages/terrain-stage'
import { extractTransferables } from './transfer'

// 定义通讯协议
export type WorkerMessage
  = | { type: 'GENERATE', payload: WorldConfig }

export type WorkerResponse
  = | { type: 'PROGRESS', stageName: string }
    | { type: 'STAGE_COMPLETE', stageName: string, durationMs: number }
    | { type: 'PIPELINE_COMPLETE', durationMs: number }
    | { type: 'SUCCESS', payload: GeneratedSphericalWorld }
    | { type: 'ERROR', error: string }

const scheduler = new PipelineScheduler()
  .addStage(new MeshStage())
  .addStage(new PlateStage())
  .addStage(new ContinentalCrustStage())
  .addStage(new SuperPlateStage())
  .addStage(new ProjectionStage())
  .addStage(new TectonicStage())
  .addStage(new TerrainStage())
  .addStage(new SeasonalCirculationStage())
  .addStage(new MonthlyClimateStage())
  .addStage(new ClimateOutputStage())
  .addStage(new KoppenClimateStage())
  .addStage(new BiomeStage())
  .addStage(new SurfaceHydrologyStage())

scheduler.addMiddleware({
  onStageStart: (stageName) => {
    postMessage({ type: 'PROGRESS', stageName } as WorkerResponse)
  },
  onStageComplete: (stageName, durationMs) => {
    postMessage({ type: 'STAGE_COMPLETE', stageName, durationMs } as WorkerResponse)
  },
  onPipelineComplete: (durationMs) => {
    postMessage({ type: 'PIPELINE_COMPLETE', durationMs } as WorkerResponse)
  },
})

globalThis.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  if (e.data.type === 'GENERATE') {
    const config = e.data.payload
    try {
      const context = { config } as SimulationContext
      await scheduler.execute(context)

      const lastGenerated: GeneratedSphericalWorld = {
        mesh: context.mesh!,
        referenceMesh: context.referenceMesh!,
        outputToReference: context.outputToReference!,
        referencePlates: context.referencePlates!,
        data: context.data!,
      }

      // 提取 ArrayBuffers 用于零拷贝传输
      const transferables = extractTransferables(lastGenerated)

      postMessage(
        { type: 'SUCCESS', payload: lastGenerated } as WorkerResponse,
        { transfer: transferables },
      )
    }
    catch (err: any) {
      postMessage({ type: 'ERROR', error: err.message || String(err) } as WorkerResponse)
    }
  }
}
