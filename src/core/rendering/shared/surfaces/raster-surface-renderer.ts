import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldSimulationState } from '@/core/simulation/state'
import type { StyleValue } from '@/core/styles'
import { Color } from 'three'
import { extractOceanWarmth, extractVectorSpeed, isGeoJsonAreaBaseMap, resolveRasterCellSource } from '@/core/data-source'
import { SatelliteSurfaceRenderer } from '@/core/rendering/shared/surfaces/satellite-surface-renderer'
import { evaluateStyleValue, getMapStyleDocument, getRasterStyleLayer } from '@/core/styles'

export interface RasterEvaluationContext {
  zoom?: number
  tokens: Record<string, string>
}

/**
 * Universal raster field evaluator: completely decoupled from any specific layer or domain mode.
 * Evaluates Mapbox-style raster-color expressions against raw data source fields.
 */
export function evaluateRasterField(
  colorExpression: StyleValue,
  sourceFields: Record<string, ArrayLike<number>>,
  cellCount: number,
  context: RasterEvaluationContext,
): Float32Array {
  const colors = new Float32Array(cellCount * 3)
  const color = new Color()
  const properties: Record<string, number> = {}
  const fieldEntries = Object.entries(sourceFields)

  for (let i = 0; i < cellCount; i++) {
    for (let f = 0; f < fieldEntries.length; f++) {
      properties[fieldEntries[f][0]] = fieldEntries[f][1][i]
    }
    const hexOrRgb = evaluateStyleValue(colorExpression, {
      zoom: context.zoom ?? 0,
      tokens: context.tokens,
      properties,
    })
    color.set(String(hexOrRgb ?? '#000000'))
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }

  return colors
}

function buildFallbackSourceFields(data: WorldSimulationState, count: number): Record<string, ArrayLike<number>> {
  const windVector = data.climate?.displayWindVector ?? (data.climate?.displayVector?.kind === 'wind' ? data.climate.displayVector : undefined)
  const oceanVector = data.climate?.displayOceanVector ?? (data.climate?.displayVector?.kind === 'ocean-current' ? data.climate.displayVector : undefined)
  const isLand = data.geography?.landMask
  return {
    isLand: data.geography?.landMask ?? new Uint8Array(count),
    elevation: data.geography?.elevation ?? new Float32Array(count),
    temperature: data.climate?.displayMonth?.temperatureC ?? new Float32Array(count),
    precipitation: data.climate?.displayMonth?.precipitationMm ?? new Float32Array(count),
    flowAccumulation: data.geography?.terrainErosion?.flowAccumulation ?? new Float32Array(count),
    populationDensity: data.civilization?.populationDensity ?? new Float32Array(count),
    marketAccess: data.civilization?.transport?.marketAccess ?? new Float32Array(count),
    glacialIndex: data.geography?.terrainErosion?.glacialIndex ?? new Float32Array(count),
    subductionOverriding: data.geography?.terrainFields?.overridingInfluence ?? new Float32Array(count),
    subductionSubducting: data.geography?.terrainFields?.subductingInfluence ?? new Float32Array(count),
    windSpeed: extractVectorSpeed(windVector, count),
    oceanCurrentSpeed: extractVectorSpeed(oceanVector, count, isLand, true),
    oceanWarmth: extractOceanWarmth(oceanVector, count, isLand),
  }
}

/**
 * Surface renderer coordinating declarative raster evaluation, thematic solid fills,
 * and high-fidelity satellite simulation without any hardcoded physical color branches.
 */
export class RasterSurfaceRenderer {
  private readonly satelliteRenderer = new SatelliteSurfaceRenderer()

  render(
    data: WorldSimulationState,
    mode: string,
    mesh?: SphericalMesh,
    mapHillshade = false,
    mapStyle?: string,
  ): Float32Array {
    const numRegions = mesh?.numRegions ?? data.geography?.elevation?.length ?? 0

    // 1. Thematic area base background
    if (isGeoJsonAreaBaseMap(mode)) {
      const colors = new Float32Array(numRegions * 3)
      const tokens = getMapStyleDocument(mapStyle).tokens
      const ocean = new Color(String(tokens.ocean ?? '#1D1D1F'))
      const land = new Color(String(tokens.landLow ?? '#29292B'))
      for (let region = 0; region < numRegions; region++) {
        const color = data.geography?.landMask?.[region] ? land : ocean
        const offset = region * 3
        colors[offset] = color.r
        colors[offset + 1] = color.g
        colors[offset + 2] = color.b
      }
      return colors
    }

    // 2. Vector cartographic solid land fill
    if (mode === 'cartographic' && (!mapStyle || mapStyle === 'light' || mapStyle === 'standard' || mapStyle === 'dark')) {
      if (!mesh)
        throw new Error('Cartographic rendering requires the world mesh')
      return this.buildCartographicSolid(data, mesh, mapStyle)
    }

    // 3. Delegate realistic satellite mode to dedicated multi-band renderer
    if (mode === 'satellite') {
      if (!mesh)
        throw new Error('Satellite rendering requires the world mesh')
      return this.satelliteRenderer.render(data, mesh, mapHillshade)
    }

    // 4. Pure style-driven raster evaluation
    const styleLayer = getRasterStyleLayer(mapStyle, mode)
    if (styleLayer && styleLayer.paint['raster-color'] !== undefined) {
      const sourceFields = mesh
        ? resolveRasterCellSource(styleLayer.source, mesh, data)?.fields
        : buildFallbackSourceFields(data, numRegions)

      if (sourceFields) {
        const tokens = getMapStyleDocument(mapStyle).tokens as Record<string, string>
        return evaluateRasterField(styleLayer.paint['raster-color'], sourceFields, numRegions, { tokens, zoom: 0 })
      }
    }

    return new Float32Array(numRegions * 3)
  }

  buildDEMCorners(
    mesh: SphericalMesh,
    elevation: Float32Array,
    landMask: Uint8Array,
  ): Float32Array {
    const cornerCount = mesh.voronoi.cornerPosition.length / 3
    const cornerElevation = new Float32Array(cornerCount)
    const cornerRegionCount = new Uint8Array(cornerCount)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (landMask[region] === 0)
        continue
      const start = mesh.voronoi.cellCornerOffsets[region]
      const end = mesh.voronoi.cellCornerOffsets[region + 1]
      for (let index = start; index < end; index++) {
        const corner = mesh.voronoi.cellCorners[index]
        cornerElevation[corner] += elevation[region]
        cornerRegionCount[corner]++
      }
    }

    const colors = new Float32Array(cornerCount * 3)
    for (let corner = 0; corner < cornerCount; corner++) {
      const count = cornerRegionCount[corner]
      const value = count > 0 ? cornerElevation[corner] / count : 0
      const shade = Math.min(1, Math.max(0, value / 8.8))
      const target = corner * 3
      colors[target] = shade
      colors[target + 1] = shade
      colors[target + 2] = shade
    }
    return colors
  }

  private buildCartographicSolid(data: WorldSimulationState, mesh: SphericalMesh, mapStyle?: string): Float32Array {
    const landMask = resolveRasterCellSource('world-surface', mesh, data)?.fields.isLand ?? data.geography.landMask
    const tokens = getMapStyleDocument(mapStyle).tokens
    const ocean = new Color(String(tokens.ocean ?? '#70C8F2'))
    const land = new Color(String(tokens.landLow ?? '#D9F0D1'))
    const colors = new Float32Array(mesh.numRegions * 3)
    for (let region = 0; region < mesh.numRegions; region++) {
      const color = landMask[region] ? land : ocean
      const offset = region * 3
      colors[offset] = color.r
      colors[offset + 1] = color.g
      colors[offset + 2] = color.b
    }
    return colors
  }
}
