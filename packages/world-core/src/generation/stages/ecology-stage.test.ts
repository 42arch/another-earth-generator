import type { EcologyArtifact } from '#generation/nature/ecology/ecology'
import type { TerrainArtifact } from '#generation/nature/geography'
import { DEFAULT_CLIMATE_PARAMETERS } from '#generation/nature/climate/climate'
import { describe, expect, it } from 'vitest'
import { createEcologyPipeline } from './ecology-stage'
import { DEFAULT_GEOLOGY_PARAMETERS } from './geology-stage'
import { DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS } from './terrain-stage'

describe('e0 stage integration', () => {
  it('reuses the current natural inputs and is independent of water stages', async () => {
    const pipeline = createEcologyPipeline()
    const input = {
      seed: 'ecology-stage',
      config: {
        ecology: true as const,
        planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
        mesh: { subdivisionLevel: 1, irregularity: 0.5 },
        reference: { subdivisionLevel: 2 },
        geology: DEFAULT_GEOLOGY_PARAMETERS,
        landforms: DEFAULT_LANDFORM_PARAMETERS,
        terrain: DEFAULT_TERRAIN_PARAMETERS,
        climate: DEFAULT_CLIMATE_PARAMETERS,
      },
    }
    const first = await pipeline.execute(input)
    const terrain = first.getOutput<TerrainArtifact>('terrain')
    const ecology = first.getOutput<EcologyArtifact>('ecology-e0')
    expect(first.plan.map(stage => stage.stageId)).toContain('ecology-e0')
    expect(first.plan.map(stage => stage.stageId)).not.toContain('hydrology-h0')
    expect(first.plan.map(stage => stage.stageId)).not.toContain('static-lakes-l1')
    expect(ecology.algorithmVersion).toBe('ecology-e0-v3')
    expect(ecology.regionCount).toBe(terrain.landMask.length)

    const cached = await pipeline.execute(input)
    expect(cached.plan.every(stage => stage.action === 'cache-hit')).toBe(true)
    const forced = await pipeline.execute(input, { force: true })
    expect(forced.getOutput<EcologyArtifact>('ecology-e0').potentialBiomeIndex).toEqual(ecology.potentialBiomeIndex)
    expect(forced.getOutput<EcologyArtifact>('ecology-e0').landCoverIndex).toEqual(ecology.landCoverIndex)
  })
})
