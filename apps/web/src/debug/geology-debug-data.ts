import type { ClimateArtifact, CryosphereArtifact, GeologyArtifact, HydrologyArtifact, TerrainArtifact } from '@another-earth/world-core'
import { sampleClimateCirculation } from '@another-earth/world-core'

export type GeologyTheme = 'topology' | 'plates' | 'continents' | 'candidate-land' | 'crust' | 'elevation' | 'land' | 'boundaries' | 'mantle' | 'volcanism' | 'uplift' | 'relief' | 'plains' | 'slope' | 'temperature' | 'precipitation' | 'wind' | 'ocean-current' | 'snow' | 'runoff' | 'rivers' | 'basins'
const ocean = [0.06, 0.19, 0.29] as const
const land = [0.65, 0.74, 0.42] as const
function categorical(index: number): readonly [number, number, number] {
  const hue = (index * 0.618033988749895) % 1
  const component = (offset: number) => {
    const k = (offset + hue * 12) % 12
    return 0.63 - 0.38 * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [component(0), component(8), component(4)]
}

/** Display palette consumes independent worker copies; it never changes geology facts. */
export function geologyRegionColor(geology: GeologyArtifact | null | undefined, theme: GeologyTheme, terrain?: TerrainArtifact | null, climate?: ClimateArtifact | null, month = 0, cryosphere?: CryosphereArtifact | null, hydrology?: HydrologyArtifact | null): ((region: number) => readonly [number, number, number]) | undefined {
  if (!geology || theme === 'topology')
    return undefined
  return (region) => {
    if (theme === 'rivers' && hydrology) {
      if (!hydrology.riverMask[region])
        return terrain?.landMask[region] ? land : ocean
      const segment = hydrology.rivers[hydrology.riverIndex[region]]
      if (segment.strahlerOrder >= 3)
        return [0.02, 0.36, 0.94]
      if (segment.strahlerOrder === 2)
        return [0.06, 0.48, 0.83]
      return [0.24, 0.57, 0.75]
    }
    if (theme === 'basins' && hydrology)
      return hydrology.basinIndex[region] < 0 ? ocean : categorical(hydrology.basinIndex[region])
    if (theme === 'runoff' && hydrology) {
      const intensity = Math.max(0, Math.min(1, Math.log1p(hydrology.annualRunoffMm[region]) / Math.log1p(2000)))
      return [0.84 - 0.72 * intensity, 0.25 + 0.5 * intensity, 0.18 + 0.75 * intensity]
    }
    if (theme === 'snow' && cryosphere) {
      const amount = cryosphere.monthlySnowWaterEquivalentMm[month * cryosphere.regionCount + region]
      const intensity = Math.max(0, Math.min(1, Math.log1p(amount) / Math.log1p(500)))
      return [0.35 + 0.58 * intensity, 0.48 + 0.48 * intensity, 0.62 + 0.38 * intensity]
    }
    if (climate && theme === 'temperature') {
      const t = Math.max(0, Math.min(1, (climate.temperatureC[month * climate.regionCount + region] + 30) / 70))
      return [0.1 + 0.8 * t, 0.25 + 0.45 * (1 - Math.abs(t - 0.5) * 2), 0.85 - 0.75 * t]
    }
    if (climate && theme === 'precipitation') {
      const p = Math.max(0, Math.min(1, climate.precipitationMm[month * climate.regionCount + region] / 400))
      return [0.72 - 0.64 * p, 0.62 - 0.2 * p, 0.38 + 0.54 * p]
    }
    if (climate && theme === 'wind') {
      const east = Math.tanh(sampleClimateCirculation(climate, region, month, 'windEast') / 10)
      const north = Math.tanh(sampleClimateCirculation(climate, region, month, 'windNorth') / 10)
      return [0.5 + 0.4 * east, 0.5 + 0.4 * north, 0.5 - 0.4 * east]
    }
    if (climate && theme === 'ocean-current') {
      if (terrain?.landMask[region])
        return land
      const warmth = sampleClimateCirculation(climate, region, month, 'oceanWarmth')
      return [0.4 + 0.4 * warmth, 0.25 + 0.2 * Math.abs(warmth), 0.55 - 0.35 * warmth]
    }
    if (terrain) {
      if (theme === 'elevation')
        return elevationColor(terrain.elevationKm[region], terrain.landMask[region] !== 0)
      if (theme === 'land')
        return terrain.landMask[region] ? land : ocean
      if (theme === 'boundaries')
        return ([[0.16, 0.22, 0.28], [0.9, 0.25, 0.15], [0.1, 0.65, 0.83], [0.83, 0.67, 0.2]] as const)[terrain.boundaryType[region]]
      if (theme === 'mantle') {
        const flow = terrain.mantleFlow[region]
        return [0.3 + Math.max(0, flow) * 0.7, 0.2, 0.3 + Math.max(0, -flow) * 0.7]
      }
      if (theme === 'volcanism') {
        const strength = Math.min(1, terrain.volcanicCoordinate[region] * 4)
        return [0.15 + strength * 0.85, 0.17 + strength * 0.2, 0.2 - strength * 0.15]
      }
      if (theme === 'uplift') {
        const strength = Math.min(1, terrain.regionalUpliftCoordinate[region] / 0.18)
        return [0.16 + strength * 0.74, 0.2 + strength * 0.3, 0.28 - strength * 0.15]
      }
      if (theme === 'relief') {
        const change = terrain.regionalReliefKm[region]
        const strength = Math.min(1, Math.abs(change) / 0.3)
        return [0.2 + Math.max(0, Math.sign(change)) * strength * 0.7, 0.25, 0.3 + Math.max(0, -Math.sign(change)) * strength * 0.65]
      }
      if (theme === 'plains') {
        if (!terrain.landMask[region])
          return ocean
        const protection = 1 - terrain.roughnessWeight[region]
        return [0.2 + protection * 0.45, 0.25 + protection * 0.55, 0.3]
      }
      if (theme === 'slope') {
        return slopeColor(terrain.slopeRadians[region] * 180 / Math.PI)
      }
    }
    if (theme === 'plates')
      return categorical(geology.plateIndex[region])
    if (theme === 'continents')
      return geology.continentIndex[region] >= 0 ? categorical(geology.continentIndex[region]) : ocean
    if (theme === 'crust')
      return geology.crustType[region] ? [0.77, 0.55, 0.32] : ocean
    return geology.candidateLandMask[region] ? land : ocean
  }
}

// Screenshot-matched debug palette. docs/old-src/core/styles/presets.ts defines
// a different heightmap (green/tan/white); it cannot produce the red peaks in
// the supplied old-project screenshot. These are display-only physical km stops.
const oceanElevationStops = [
  [-10, 0x06, 0x1A, 0x33],
  [-4, 0x17, 0x4D, 0x81],
  [0, 0x36, 0x7E, 0xAE],
] as const
const landElevationStops = [
  [0, 0x07, 0x55, 0x37],
  [1, 0x27, 0x85, 0x3C],
  [2.5, 0x9B, 0xC7, 0x5A],
  [3.5, 0xEF, 0xD1, 0x8C],
  [5, 0xBA, 0x40, 0x33],
  [6.5, 0xA7, 0x2F, 0x2F],
] as const

const slopeColorStops = [
  [0, '#244a35'],
  [0.05, '#438b59'],
  [0.25, '#7eaa50'],
  [1, '#c5cf54'],
  [3, '#e5d15c'],
  [10, '#e9873d'],
  [25, '#cc463f'],
  [45, '#722f50'],
] as const

export const SLOPE_LEGEND_TICKS = [0, 1, 3, 10, 45] as const

/** Log-scaled display position gives gentle slopes more color range. */
export function slopeDisplayPosition(degrees: number): number {
  const clamped = Math.max(0, Math.min(45, degrees))
  return Math.log1p(clamped) / Math.log1p(45)
}

export const slopeLegendGradient = `linear-gradient(to right, ${slopeColorStops
  .map(([degrees, color]) => `${color} ${(slopeDisplayPosition(degrees) * 100).toFixed(2)}%`)
  .join(', ')})`

function linearChannel(channel: number): number {
  const srgb = channel / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

function stopColor(stop: readonly [number, number, number, number]): readonly [number, number, number] {
  return [linearChannel(stop[1]), linearChannel(stop[2]), linearChannel(stop[3])]
}

function slopeColor(degrees: number): readonly [number, number, number] {
  const position = slopeDisplayPosition(degrees)
  for (let index = 1; index < slopeColorStops.length; index++) {
    const [degreeA, colorA] = slopeColorStops[index - 1]
    const [degreeB, colorB] = slopeColorStops[index]
    const positionA = slopeDisplayPosition(degreeA)
    const positionB = slopeDisplayPosition(degreeB)
    if (position > positionB)
      continue
    const amount = (position - positionA) / (positionB - positionA)
    return [0, 1, 2].map((channel) => {
      const from = Number.parseInt(colorA.slice(1 + channel * 2, 3 + channel * 2), 16)
      const to = Number.parseInt(colorB.slice(1 + channel * 2, 3 + channel * 2), 16)
      return linearChannel(Math.round(from + (to - from) * amount))
    }) as [number, number, number]
  }
  const last = slopeColorStops[slopeColorStops.length - 1][1]
  return [0, 1, 2].map(channel => linearChannel(Number.parseInt(last.slice(1 + channel * 2, 3 + channel * 2), 16))) as [number, number, number]
}

/** Screenshot reference colors on the current physical km elevation and final mask. */
function elevationColor(km: number, isLand: boolean): readonly [number, number, number] {
  const stops = isLand ? landElevationStops : oceanElevationStops
  if (km <= stops[0][0])
    return stopColor(stops[0])
  for (let i = 1; i < stops.length; i++) {
    if (km > stops[i][0])
      continue
    const a = stops[i - 1]
    const b = stops[i]
    const t = (km - a[0]) / (b[0] - a[0])
    return [linearChannel(Math.round(a[1] + (b[1] - a[1]) * t)), linearChannel(Math.round(a[2] + (b[2] - a[2]) * t)), linearChannel(Math.round(a[3] + (b[3] - a[3]) * t))]
  }
  return stopColor(stops[stops.length - 1])
}
