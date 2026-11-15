import type { WorkerResponse } from '../lib/generation/protocol'
import {
  BUILTIN_MAP_PROJECTIONS,
  BUILTIN_MAP_STYLE_PRESET_LIST,
  createCartographySession,
  DEFAULT_CARTOGRAPHY_VIEW_STATE,
} from '@another-earth/cartography'
import {
  DEFAULT_CLIMATE_PARAMETERS,
  DEFAULT_GEOLOGY_PARAMETERS,
  DEFAULT_HYDROLOGY_PARAMETERS,
  DEFAULT_LANDFORM_PARAMETERS,
  DEFAULT_TERRAIN_PARAMETERS,
} from '@another-earth/world-core'
import { describe, expect, it } from 'vitest'
import { GenerationController } from '../lib/generation/controller'
import { GenerationWorkerRuntime } from '../workers/runtime'
import { buildLayerStatisticsFromReader, formatLayerStatistics } from './layer-statistics'

class MockWorker extends EventTarget {
  sent: unknown[] = []
  terminated = false
  postMessage(request: unknown): void { this.sent.push(request) }
  terminate(): void { this.terminated = true }
  reply(response: WorkerResponse): void { this.dispatchEvent(new MessageEvent('message', { data: response })) }
}

describe('slice 5: single-track WorldSnapshot -> WorldMapReader -> CartographySession & reader statistics', () => {
  it('completes candidate preparation, atomic commit, style/thematic/month/2D-3D switching without re-running Worker generation, and computes area-weighted statistics', async () => {
    const worker = new MockWorker()
    const runtime = new GenerationWorkerRuntime((message, transfer = []) => {
      const received = structuredClone(message, { transfer })
      worker.reply(received)
    })
    const controller = new GenerationController(undefined, () => worker as unknown as Worker)
    const session = createCartographySession({ width: 960, height: 540 })

    const config = {
      planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
      mesh: { subdivisionLevel: 2, irregularity: 0.45 },
      reference: { subdivisionLevel: 2 },
      geology: DEFAULT_GEOLOGY_PARAMETERS,
      landforms: DEFAULT_LANDFORM_PARAMETERS,
      terrain: DEFAULT_TERRAIN_PARAMETERS,
      climate: DEFAULT_CLIMATE_PARAMETERS,
      hydrology: {
        ...DEFAULT_HYDROLOGY_PARAMETERS,
        riverDensityScale: 2.0,
      },
      ecology: true as const,
    }
    const publication = {
      snapshotId: 'snapshot:slice5-world-1',
      worldId: 'world:slice5',
      name: 'Slice 5 World',
      createdAt: '2026-11-14T00:00:00Z',
      revision: 0,
    }

    const genPromise = controller.generate({ seed: 'slice5-seed', config, publication })
    expect(worker.sent).toHaveLength(1)
    await runtime.handle(worker.sent[0])
    const result = await genPromise

    expect(result.candidateWorld?.snapshotId).toBe(publication.snapshotId)
    expect(controller.publishedWorld).toBeNull()

    // 1. Prepare GPU cartography resources on the validated candidate before committing
    const candidateReader = controller.candidateMapReader(publication.snapshotId)
    const prepared = await session.prepareWorld(candidateReader, DEFAULT_CARTOGRAPHY_VIEW_STATE)

    // 2. Atomically commit in Controller and activate in CartographySession
    controller.commitWorld(publication.snapshotId)
    session.activateWorld(prepared)

    expect(controller.publishedWorld?.snapshotId).toBe(publication.snapshotId)
    expect(session.activeSnapshotId).toBe(publication.snapshotId)

    const publishedReader = controller.publishedMapReader()
    expect(publishedReader.identity.snapshotId).toBe(publication.snapshotId)

    // 3. Verify base style and all 15 available thematic layer statistics directly from WorldMapReader
    const baseStats = buildLayerStatisticsFromReader(publishedReader, {
      activeThematicId: null,
      styleId: 'satellite',
      month: 0,
      legend: session.activeLegend,
    })
    expect(baseStats.totalCells).toBe(publishedReader.mesh.regionCount)
    expect(baseStats.rows.reduce((sum, r) => sum + r.count, 0)).toBe(publishedReader.mesh.regionCount)

    const thematicIds = [
      'elevation',
      'plates',
      'continents',
      'temperature',
      'annual-temperature',
      'precipitation',
      'annual-precipitation',
      'koppen',
      'wind-speed',
      'ocean-speed',
      'snow',
      'runoff',
      'basins',
      'biomes',
      'land-cover',
    ] as const

    for (const thematicId of thematicIds) {
      session.setViewState({
        ...DEFAULT_CARTOGRAPHY_VIEW_STATE,
        activeThematicId: thematicId,
        climateMonth: 5,
      })
      const stats = buildLayerStatisticsFromReader(publishedReader, {
        activeThematicId: thematicId,
        styleId: 'satellite',
        month: 5,
        legend: session.activeLegend,
      })
      expect(stats.totalCells).toBe(publishedReader.mesh.regionCount)
      expect(stats.rows.length).toBeGreaterThan(0)
      expect(stats.rows.reduce((sum, r) => sum + r.count, 0)).toBe(publishedReader.mesh.regionCount)
      expect(formatLayerStatistics(stats)).toContain(stats.title)
    }

    // Annual temperature and annual precipitation statistics are invariant to month changes
    const annualTempJan = buildLayerStatisticsFromReader(publishedReader, {
      activeThematicId: 'annual-temperature',
      month: 0,
    })
    const annualTempJul = buildLayerStatisticsFromReader(publishedReader, {
      activeThematicId: 'annual-temperature',
      month: 6,
    })
    expect(annualTempJul).toEqual(annualTempJan)

    // 4. Switch across all 6 style presets, overlays, months, and 3D <-> 2D projections:
    // Worker message count must remain 1 (zero Worker re-generation!)
    for (const preset of BUILTIN_MAP_STYLE_PRESET_LIST) {
      session.setViewState({
        ...DEFAULT_CARTOGRAPHY_VIEW_STATE,
        styleId: preset.id,
        activeThematicId: null,
        enabledOverlayIds: [
          'rivers',
          'lakes',
          'coastlines',
          'plate-boundaries',
          'graticule',
          'cell-wireframe',
          'wind-arrows',
          'ocean-arrows',
          'labels',
        ],
        climateMonth: 3,
      })
      expect(session.activeLegend).not.toBeNull()
    }

    for (const projId of Object.keys(BUILTIN_MAP_PROJECTIONS) as (keyof typeof BUILTIN_MAP_PROJECTIONS)[]) {
      session.setViewState({
        ...DEFAULT_CARTOGRAPHY_VIEW_STATE,
        viewMode: 'atlas',
        projectionId: projId,
        styleId: 'standard-atlas',
      })
      const pick2D = session.pickAtScreenPoint(480, 270)
      expect(pick2D).not.toBeNull()
      expect(pick2D!.snapshotId).toBe(publication.snapshotId)
      const regionFacts = controller.queryWorldRegion(pick2D!.regionId, 3)
      expect(regionFacts.snapshotId).toBe(publication.snapshotId)
      expect(regionFacts.region).toBe(pick2D!.regionId)
    }

    // Zero additional Worker requests were sent during any display/view/style/month transition
    expect(worker.sent).toHaveLength(1)

    // 5. Aborting prepareWorld for a successor world leaves the first world active and intact
    const abortController = new AbortController()
    abortController.abort()
    await expect(
      session.prepareWorld(publishedReader, DEFAULT_CARTOGRAPHY_VIEW_STATE, { signal: abortController.signal }),
    ).rejects.toThrow('aborted')
    expect(session.activeSnapshotId).toBe(publication.snapshotId)
    expect(controller.publishedWorld?.snapshotId).toBe(publication.snapshotId)

    session.dispose()
    controller.dispose()
    expect(session.getActiveGpuResourceCounts()).toEqual({
      geometries: 0,
      materials: 0,
      textures: 0,
    })
  })
})
