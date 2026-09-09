import type { GlobeGenParams } from '@/core/spherical/config'
import type { GeneratedSphericalWorld } from '@/core/spherical/spherical-world-generator'
import type { GenerationStage } from '@/core/world/generation-plan'
import { SphericalWorldGenerator } from '@/core/spherical/spherical-world-generator'
import { mergeGenerationStages, planGeneration } from '@/core/world/generation-plan'

const REGENERATORS = {
  elevation: 'regenerateElevation',
  hydrology: 'regenerateLakes',
  rivers: 'regenerateRivers',
  human: 'regenerateHuman',
  transport: 'regenerateTransport',
  trade: 'regenerateTrade',
  cultures: 'regenerateCultures',
  polities: 'regeneratePolities',
  religions: 'regenerateReligions',
} as const

/** Worker-owned state. Dependency planning uses the last successful inputs. */
export class GenerationRuntime {
  private world: GeneratedSphericalWorld | null = null
  private params: GlobeGenParams | null = null
  private revision = 0
  private readonly generator = new SphericalWorldGenerator()

  run(params: GlobeGenParams, requested: GenerationStage | null, progress: (stage: string) => void = () => {}) {
    const stage = mergeGenerationStages(planGeneration(this.params, params), requested)
    const timings: Record<string, number> = {}
    let lastStage = 'prepare'
    let lastTime = performance.now()
    const started = lastTime
    const mark = (next: string) => {
      const now = performance.now()
      timings[lastStage] = (timings[lastStage] ?? 0) + now - lastTime
      lastStage = next
      lastTime = now
      progress(next)
    }
    this.generator.onProgress = mark
    try {
      if (!this.world || stage === 'world') {
        this.world = this.generator.generate(params)
        this.revision++
      }
      else if (stage) {
        this.generator[REGENERATORS[stage]](this.world.mesh, this.world.data, params)
      }
      mark('complete')
      timings.total = performance.now() - started
      this.params = { ...params }
      return { ...this.world, stage, revision: this.revision, timings }
    }
    catch (error) {
      // A failed in-place generator may have partially mutated its inputs.
      this.world = null
      this.params = null
      throw error
    }
    finally {
      this.generator.onProgress = undefined
    }
  }
}
