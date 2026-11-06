import type { GeologyArtifact, SphericalMesh, TerrainArtifact } from '@another-earth/world-core'
import { createGeologyPipeline, createTerrainPipeline, DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS } from '@another-earth/world-core'
import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { geologyRegionColor } from './geology-debug-data'
import { prepareDebugGeometry } from './mesh-debug-data'

describe('geology display ownership', () => {
  it('maps candidate-land colors to Voronoi regions and leaves all facts intact across themes', async () => {
    const result = await createGeologyPipeline().execute({ seed: 'display', config: { planet: { physicalRadiusKm: 6371 }, mesh: { subdivisionLevel: 1, irregularity: 0 }, reference: { subdivisionLevel: 2 }, geology: DEFAULT_GEOLOGY_PARAMETERS } })
    const mesh = result.getOutput<SphericalMesh>('mesh')
    const geology = result.getOutput<GeologyArtifact>('geology')
    const original = structuredClone(geology)
    const palette = geologyRegionColor(geology, 'candidate-land')!
    const geometry = prepareDebugGeometry(mesh, 'voronoi', palette)
    let offset = 0
    for (let r = 0; r < mesh.regionCount; r++) {
      const color = palette(r)
      expect(Array.from(geometry.colors.subarray(offset, offset + 3))).toEqual(Array.from(new Float32Array(color)))
      offset += (mesh.neighborOffsets[r + 1] - mesh.neighborOffsets[r]) * 9
    }
    for (const theme of ['plates', 'continents', 'crust', 'topology'] as const)
      prepareDebugGeometry(mesh, 'icosphere', geologyRegionColor(geology, theme))
    expect(geology).toEqual(original)
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
    const geometry = prepareDebugGeometry(mesh, 'voronoi', palette)
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
  const geometry = prepareDebugGeometry(mesh, 'voronoi', palette)
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
