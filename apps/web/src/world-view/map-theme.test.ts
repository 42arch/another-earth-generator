import type { ClimateArtifact, EcologyArtifact, GeographicRegionsArtifact, GeologyArtifact, SphericalMesh, StaticLakeArtifact, TerrainArtifact } from '@another-earth/world-core'
import { classifyBiomeSeries, createGeologyPipeline, createTerrainPipeline, DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS } from '@another-earth/world-core'
import { NATURAL_BIOME_DEFINITIONS, NATURAL_LAND_COVER_DEFINITIONS } from '@another-earth/world-data'
import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { geographicNameLabel, geographicRegionLabel, geologyRegionColor } from './map-theme-data'
import { buildLayerStatistics, formatLayerStatistics } from './layer-statistics'
import { prepareRenderGeometry } from './map-render-data'

describe('geology display ownership', () => {
  it('renders final continent, ocean and sea assignments rather than candidate land', () => {
    const geology = { continentIndex: new Int32Array([0, 0, 0]) } as GeologyArtifact
    const terrain = { landMask: new Uint8Array([1, 0, 0]) } as TerrainArtifact
    const regions = {
      continentIndex: new Int32Array([0, -1, -1]),
      oceanIndex: new Int32Array([-1, 0, -1]),
      seaIndex: new Int32Array([-1, -1, 0]),
      continents: [{ id: 'continent:one', name: '苍岚', areaKm2: 1 }],
      oceans: [{ id: 'ocean:one', name: '沧溟', areaKm2: 1 }],
      seas: [{ id: 'sea:one', areaKm2: 1 }],
    } as GeographicRegionsArtifact
    const palette = geologyRegionColor(geology, 'continents', terrain, null, 0, null, null, null, null, null, regions)!
    expect(palette(0)).not.toEqual(palette(1))
    expect(palette(1)).not.toEqual(palette(2))
    const stats = buildLayerStatistics('continents', { regionCount: 3, geology, terrain, regions })!
    expect(stats.title).toBe('大陆、洋与海')
    expect(stats.rows.map(row => [row.label, row.count])).toEqual([['苍岚大陆', 1], ['沧溟洋', 1], ['海 1', 1]])
    expect([0, 1, 2].map(region => geographicRegionLabel(regions, region))).toEqual(['苍岚大陆', '沧溟洋', '海 1'])
    expect(geographicNameLabel('Avara', 'continent', 0)).toBe('Avara 大陆')
  })

  it('uses the selected month and shares speed classes between the map and legend', () => {
    const geology = {} as GeologyArtifact
    const terrain = { landMask: new Uint8Array([0, 0, 1]) } as TerrainArtifact
    const climate = {
      regionCount: 3,
      referenceRegionCount: 1,
      geographicReference: new Uint32Array(3),
      oceanReference: new Int32Array([0, -1, -1]),
      circulation: {
        windEast: new Float32Array([0, 40, 40, 0]),
        windNorth: new Float32Array(4),
        oceanEast: new Float32Array([0, 2, 2, 0]),
        oceanNorth: new Float32Array(4),
      },
    } as ClimateArtifact
    const input = { regionCount: 3, geology, terrain, climate, month: 5 }

    const wind = buildLayerStatistics('wind-speed', input)!
    expect(wind.title).toContain('第 6 月')
    expect(wind.rows.find(row => row.label === '≥ 8 m/s')?.count).toBe(3)
    expect(buildLayerStatistics('wind-speed', { ...input, month: 0 })!.rows.find(row => row.label === '< 1 m/s')?.count).toBe(3)

    const current = buildLayerStatistics('ocean-speed', input)!
    expect(current.rows.find(row => row.label === '0.15 至 < 0.2 m/s')?.count).toBe(1)
    expect(current.rows.find(row => row.label === '无流速数据')?.count).toBe(1)
    expect(current.rows.find(row => row.label === '陆地')?.count).toBe(1)
    const color = geologyRegionColor(geology, 'ocean-speed', terrain, climate, input.month)!
    expect(color(0)).not.toEqual(color(1))
    expect(color(1)).not.toEqual(color(2))
  })

  it('shows annual C0 climate layers and area-weighted summaries independently of the selected month', () => {
    const geology = {} as GeologyArtifact
    const terrain = { landMask: new Uint8Array([0, 1, 1, 0]) } as TerrainArtifact
    const temperatureC = new Float32Array(4 * 12).fill(-5)
    const precipitationMm = new Float32Array(4 * 12).fill(20)
    const climate = {
      regionCount: 4,
      temperatureC,
      precipitationMm,
      annualMeanTemperatureC: new Float32Array([-25, 10, 30, 5]),
      annualPrecipitationMm: new Float32Array([0, 600, 2400, 100]),
    } as ClimateArtifact
    const input = { regionCount: 4, geology, terrain, climate, regionAreaKm2: new Float64Array([1, 1, 3, 1]), month: 0 }

    for (const theme of ['annual-temperature', 'annual-precipitation'] as const) {
      const colorInJanuary = geologyRegionColor(geology, theme, terrain, climate, 0)!(2)
      const colorInJune = geologyRegionColor(geology, theme, terrain, climate, 5)!(2)
      expect(colorInJune).toEqual(colorInJanuary)
      expect(buildLayerStatistics(theme, { ...input, month: 5 })).toEqual(buildLayerStatistics(theme, input))
    }
    expect(geologyRegionColor(geology, 'annual-temperature', terrain, climate, 0)!(2))
      .not.toEqual(geologyRegionColor(geology, 'temperature', terrain, climate, 0)!(2))
    expect(geologyRegionColor(geology, 'annual-precipitation', terrain, climate, 0)!(2))
      .not.toEqual(geologyRegionColor(geology, 'precipitation', terrain, climate, 0)!(2))

    const temperature = buildLayerStatistics('annual-temperature', input)!
    expect(temperature.title).toBe('年平均气温分布')
    expect(temperature.description).toContain('全域面积加权平均 13.3 °C')
    expect(temperature.description).toContain('陆地面积加权平均 25.0 °C')
    expect(temperature.description).toContain('陆地范围 10.0–30.0 °C')
    const precipitation = buildLayerStatistics('annual-precipitation', input)!
    expect(precipitation.title).toBe('年总降水分布')
    expect(precipitation.description).toContain('陆地面积加权平均 1950 mm/年')
    expect(precipitation.rows.find(row => row.label === '≥ 2000 mm/年')).toMatchObject({ count: 1, landSharePercentage: 50 })
    expect(formatLayerStatistics(precipitation)).toContain('陆地面积加权平均 1950 mm/年')
    expect(buildLayerStatistics('annual-precipitation', { ...input, terrain: { landMask: new Uint8Array(4) } as TerrainArtifact })?.description)
      .toContain('无陆地区域')
  })

  it('keeps the reference biome classification distinct from its coarse natural cover', async () => {
    const classified = classifyBiomeSeries(new Float32Array(12).fill(26), new Float32Array(12).fill(200), false, 0, 1, 0, 365.25)
    expect(classified.potentialBiomeCode).toBe('TropicalRainforest')
    const result = await createGeologyPipeline().execute({ seed: 'biome-display', config: { planet: { physicalRadiusKm: 6371 }, mesh: { subdivisionLevel: 1, irregularity: 0 }, reference: { subdivisionLevel: 2 }, geology: DEFAULT_GEOLOGY_PARAMETERS } })
    const mesh = result.getOutput<SphericalMesh>('mesh')
    const geology = result.getOutput<GeologyArtifact>('geology')
    const biomeIndex = new Uint16Array(mesh.regionCount)
    const coverIndex = new Uint16Array(mesh.regionCount)
    biomeIndex[1] = 1
    coverIndex[1] = 2
    const ecology: EcologyArtifact = {
      meshId: mesh.meshId,
      terrainMeshId: mesh.meshId,
      climateMeshId: mesh.meshId,
      algorithmVersion: 'ecology-e0-v3',
      regionCount: mesh.regionCount,
      potentialBiomeIds: NATURAL_BIOME_DEFINITIONS.map(definition => definition.id),
      landCoverIds: NATURAL_LAND_COVER_DEFINITIONS.map(definition => definition.id),
      potentialBiomeIndex: biomeIndex,
      landCoverIndex: coverIndex,
      aridityIndex: new Float32Array(mesh.regionCount),
      growingSeasonMonths: new Uint8Array(mesh.regionCount),
    }
    const landMask = new Uint8Array(mesh.regionCount)
    landMask[1] = 1
    const terrain = { landMask } as TerrainArtifact
    expect(geologyRegionColor(geology, 'biomes', terrain, null, 0, null, null, null, ecology)!(1)).toEqual([0.05, 0.42, 0.18])
    expect(geologyRegionColor(geology, 'land-cover', terrain, null, 0, null, null, null, ecology)!(1)).toEqual([0.142, 0.5, 0.332])
    expect(buildLayerStatistics('biomes', { regionCount: mesh.regionCount, geology, terrain, ecology })!.rows.find(row => row.key === NATURAL_BIOME_DEFINITIONS[1].id)?.label).toBe('热带雨林')
    expect(buildLayerStatistics('land-cover', { regionCount: mesh.regionCount, geology, terrain, ecology })!.rows.find(row => row.key === NATURAL_LAND_COVER_DEFINITIONS[2].id)?.label).toBe('森林')
  })

  it('uses legacy Köppen category IDs, colors and labels without changing climate facts', async () => {
    const result = await createGeologyPipeline().execute({ seed: 'koppen-display', config: { planet: { physicalRadiusKm: 6371 }, mesh: { subdivisionLevel: 1, irregularity: 0 }, reference: { subdivisionLevel: 2 }, geology: DEFAULT_GEOLOGY_PARAMETERS } })
    const mesh = result.getOutput<SphericalMesh>('mesh')
    const geology = result.getOutput<GeologyArtifact>('geology')
    const classes = new Uint8Array(mesh.regionCount)
    classes[1] = 1 // Af
    classes[2] = 31 // EF
    const climate = { koppenClass: classes } as ClimateArtifact
    const terrain = { landMask: Uint8Array.from(classes, value => Number(value !== 0)) } as TerrainArtifact
    const palette = geologyRegionColor(geology, 'koppen', terrain, climate)!
    expect(palette(0)).toEqual([0.05, 0.18, 0.34])
    expect(palette(1)).toEqual([0.04, 0.48, 0.28])
    expect(palette(2)).toEqual([0.9, 0.94, 0.96])
    const stats = buildLayerStatistics('koppen', { regionCount: mesh.regionCount, geology, terrain, climate })!
    expect(stats.rows.find(row => row.key === 'Af')).toMatchObject({ label: 'Af · 热带雨林', count: 1, landSharePercentage: 50 })
    expect(stats.rows.find(row => row.key === 'EF')).toMatchObject({ label: 'EF · 冰原', count: 1, landSharePercentage: 50 })
    expect(stats.rows.find(row => row.key === 'Ocean')?.count).toBe(mesh.regionCount - 2)
    expect(Array.from(classes.slice(0, 3))).toEqual([0, 1, 31])
  })

  it('maps candidate-land colors to Voronoi regions and leaves all facts intact across themes', async () => {
    const result = await createGeologyPipeline().execute({ seed: 'display', config: { planet: { physicalRadiusKm: 6371 }, mesh: { subdivisionLevel: 1, irregularity: 0 }, reference: { subdivisionLevel: 2 }, geology: DEFAULT_GEOLOGY_PARAMETERS } })
    const mesh = result.getOutput<SphericalMesh>('mesh')
    const geology = result.getOutput<GeologyArtifact>('geology')
    const original = structuredClone(geology)
    const palette = geologyRegionColor(geology, 'candidate-land')!
    const geometry = prepareRenderGeometry(mesh, 'voronoi', palette)
    let offset = 0
    for (let r = 0; r < mesh.regionCount; r++) {
      const color = palette(r)
      expect(Array.from(geometry.colors.subarray(offset, offset + 3))).toEqual(Array.from(new Float32Array(color)))
      offset += (mesh.neighborOffsets[r + 1] - mesh.neighborOffsets[r]) * 9
    }
    for (const theme of ['plates', 'continents', 'crust', 'topology'] as const)
      prepareRenderGeometry(mesh, 'icosphere', geologyRegionColor(geology, theme))
    expect(geology).toEqual(original)
  })

  it('renders lake membership as a display-only theme', async () => {
    const result = await createGeologyPipeline().execute({ seed: 'lake-display', config: { planet: { physicalRadiusKm: 6371 }, mesh: { subdivisionLevel: 1, irregularity: 0 }, reference: { subdivisionLevel: 2 }, geology: DEFAULT_GEOLOGY_PARAMETERS } })
    const geology = result.getOutput<GeologyArtifact>('geology')
    const mesh = result.getOutput<SphericalMesh>('mesh')
    const landMask = new Uint8Array(mesh.regionCount).fill(1)
    landMask[0] = 0
    const terrain = { meshId: mesh.meshId, landMask } as Pick<TerrainArtifact, 'meshId' | 'landMask'>
    const lakes: StaticLakeArtifact = {
      meshId: mesh.meshId,
      terrainMeshId: mesh.meshId,
      hydrologyMeshId: mesh.meshId,
      algorithmVersion: 'static-lakes-l1-v6',
      regionCount: mesh.regionCount,
      lakeIndex: new Int32Array(mesh.regionCount).fill(-1),
      lakes: [{ id: `${mesh.meshId}:lake:1`, basinId: `${mesh.meshId}:basin:1`, endorheic: false, areaKm2: 1, waterLevelKm: 1, spillRegion: 1, downstreamRegion: 2, regions: new Uint32Array([1]) }],
      minimumLakeRegionCount: 2,
    }
    lakes.lakeIndex[1] = 0
    const palette = geologyRegionColor(geology, 'lakes', terrain as TerrainArtifact, null, 0, null, null, lakes)!
    expect(palette(1)).toEqual([0.03, 0.58, 0.88])
    expect(palette(2)).toEqual([0.65, 0.74, 0.42])
  })
})

it('renders physical height and final-land themes without mutating terrain', async () => {
  const result = await createTerrainPipeline().execute({ seed: 'display-terrain', config: { planet: { physicalRadiusKm: 6371 }, mesh: { subdivisionLevel: 2, irregularity: 0.5 }, reference: { subdivisionLevel: 2 }, geology: DEFAULT_GEOLOGY_PARAMETERS, landforms: DEFAULT_LANDFORM_PARAMETERS, terrain: DEFAULT_TERRAIN_PARAMETERS } })
  const mesh = result.getOutput<SphericalMesh>('mesh')
  const geology = result.getOutput<GeologyArtifact>('geology')
  const terrain = result.getOutput<TerrainArtifact>('terrain')
  const original = structuredClone(terrain)
  for (const theme of ['elevation', 'land', 'boundaries', 'mantle', 'volcanism', 'uplift', 'relief', 'plains', 'slope'] as const) {
    const palette = geologyRegionColor(geology, theme, terrain)!
    const geometry = prepareRenderGeometry(mesh, 'voronoi', palette)
    expect(geometry.colors.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
  }
  expect(terrain).toEqual(original)

  // The screenshot-matched heightmap selects separate ocean/land ramps using the final mask.
  // Use an owned display copy so core facts and their buffer ownership stay intact.
  const display = structuredClone(terrain)
  const heights = [-12, -10, -4, -1, 0, 1e-9, 0.0005, 1, 2.5, 3.5, 5, 6.5, 7]
  display.elevationKm.set(heights)
  display.landMask.set(heights.map(km => km > 0 ? 1 : 0))
  const palette = geologyRegionColor(geology, 'elevation', display)!
  const colors = heights.map((_, r) => palette(r))
  const expectedColor = (hex: string) => {
    const color = new Color(hex)
    return [color.r, color.g, color.b]
  }
  for (const [index, hex] of [[0, '#061a33'], [1, '#061a33'], [2, '#174d81'], [4, '#367eae'], [5, '#075537'], [7, '#27853c'], [8, '#9bc75a'], [9, '#efd18c'], [10, '#ba4033'], [11, '#a72f2f'], [12, '#a72f2f']] as const) {
    const expected = expectedColor(hex)
    for (let channel = 0; channel < 3; channel++)
      expect(colors[index][channel]).toBeCloseTo(expected[channel], 6)
  }
  const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((value, axis) => value - b[axis]))
  expect(distance(colors[4], colors[5])).toBeGreaterThan(0.01)
  expect(colors[5]).toEqual(colors[6])
  expect(colors[10][0]).toBeGreaterThan(colors[10][1] * 2)
  // Voronoi cells carry their own color to all triangle vertices; coast colors
  // must not be averaged between neighboring sea and land regions.
  const geometry = prepareRenderGeometry(mesh, 'voronoi', palette)
  let offset = 0
  for (let r = 0; r < heights.length; r++) {
    const expected = Array.from(new Float32Array(palette(r)))
    const vertices = (mesh.neighborOffsets[r + 1] - mesh.neighborOffsets[r]) * 3
    for (let v = 0; v < vertices; v++) {
      expect(Array.from(geometry.colors.subarray(offset, offset + 3))).toEqual(expected)
      offset += 3
    }
  }
  expect(terrain).toEqual(original)
})
