import type { ClimateArtifact, CryosphereArtifact, EcologyArtifact, GeographicRegionsArtifact, GeologyArtifact, HydrologyArtifact, SphericalMesh, StaticLakeArtifact, TerrainArtifact } from '@another-earth/world-core'
import { sampleClimateSpeedMps } from '@another-earth/world-core'
import { NATURAL_BIOME_DEFINITIONS, NATURAL_LAND_COVER_DEFINITIONS } from '@another-earth/world-data'

export type GeologyTheme = 'satellite' | 'topology' | 'plates' | 'continents' | 'candidate-land' | 'crust' | 'elevation' | 'land' | 'boundaries' | 'mantle' | 'volcanism' | 'uplift' | 'relief' | 'plains' | 'slope' | 'temperature' | 'precipitation' | 'annual-temperature' | 'annual-precipitation' | 'koppen' | 'wind' | 'wind-speed' | 'ocean-speed' | 'ocean-current' | 'snow' | 'runoff' | 'rivers' | 'basins' | 'lakes' | 'biomes' | 'land-cover'
const ocean = [0.06, 0.19, 0.29] as const
const land = [0.65, 0.74, 0.42] as const
const SATELLITE_SHALLOW_WATER_LIMIT_KM = 1.0 // Display transition widened from the reference 0.45 km.
const SATELLITE_HILLSHADE_GRADIENT_SCALE = 20 // Mildly raises low-relief contrast from the reference 12.
type LinearRgb = readonly [number, number, number]

const WIND_SPEED_STOPS: readonly (readonly [number, string])[] = [
  [0, '#0a131c'],
  [1.5, '#142e3d'],
  [3.5, '#1e5163'],
  [5.5, '#2e7e85'],
  [7.5, '#4ab5a3'],
  [10, '#A9FFF1'],
]
const OCEAN_CURRENT_SPEED_STOPS: readonly (readonly [number, string])[] = [
  [0, '#040a14'],
  [0.15, '#10355E'],
  [0.45, '#1d578a'],
  [0.8, '#2f84ba'],
  [1.15, '#52b0db'],
  [1.5, '#9ECAE1'],
]

function linearHex(hex: string): LinearRgb {
  const value = Number.parseInt(hex.slice(1), 16)
  const convert = (shift: number) => {
    const channel = ((value >> shift) & 0xff) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  return [convert(16), convert(8), convert(0)]
}

function speedRampColor(speed: number, stops: readonly (readonly [number, string])[]): LinearRgb {
  if (speed <= stops[0][0])
    return linearHex(stops[0][1])
  for (let index = 1; index < stops.length; index++) {
    const [upperSpeed, upperHex] = stops[index]
    if (speed <= upperSpeed) {
      const [lowerSpeed, lowerHex] = stops[index - 1]
      const t = (speed - lowerSpeed) / (upperSpeed - lowerSpeed)
      const lower = linearHex(lowerHex)
      const upper = linearHex(upperHex)
      return [lower[0] + (upper[0] - lower[0]) * t, lower[1] + (upper[1] - lower[1]) * t, lower[2] + (upper[2] - lower[2]) * t]
    }
  }
  return linearHex(stops[stops.length - 1][1])
}

export const CIRCULATION_SPEED_COLORS: readonly LinearRgb[] = [
  [0.05, 0.12, 0.24],
  [0.06, 0.26, 0.47],
  [0.06, 0.43, 0.51],
  [0.19, 0.61, 0.40],
  [0.62, 0.73, 0.26],
  [0.96, 0.55, 0.14],
  [0.35, 0.35, 0.35],
  land,
]
export const CIRCULATION_SPEED_BINS = {
  'wind-speed': [1, 2, 4, 6, 8],
  'ocean-speed': [0.02, 0.05, 0.1, 0.15, 0.2],
} as const

export function circulationSpeedClass(theme: keyof typeof CIRCULATION_SPEED_BINS, climate: ClimateArtifact, month: number, region: number, landRegion: boolean): number {
  if (theme === 'ocean-speed' && landRegion)
    return 7
  const speed = sampleClimateSpeedMps(climate, region, month, theme === 'wind-speed' ? 'wind' : 'ocean')
  if (speed === null)
    return 6
  const bounds = CIRCULATION_SPEED_BINS[theme]
  const index = bounds.findIndex(bound => speed < bound)
  return index < 0 ? bounds.length : index
}

// Stable class order and linear RGB palette from the feat-society Köppen layer.
export const KOPPEN_LABELS = [
  '海洋',
  '热带雨林',
  '热带季风',
  '热带冬干稀树草原',
  '热带夏干稀树草原',
  '热沙漠',
  '冷沙漠',
  '热半干旱草原',
  '冷半干旱草原',
  '炎夏地中海',
  '暖夏地中海',
  '凉夏地中海',
  '冬干炎夏温带',
  '冬干暖夏温带',
  '冬干凉夏温带',
  '湿润炎夏温带',
  '温带海洋性',
  '凉夏海洋性',
  '夏干炎夏大陆性',
  '夏干暖夏大陆性',
  '夏干亚寒带',
  '夏干严寒亚寒带',
  '冬干炎夏大陆性',
  '冬干暖夏大陆性',
  '冬干亚寒带',
  '冬干严寒亚寒带',
  '湿润炎夏大陆性',
  '湿润暖夏大陆性',
  '湿润亚寒带',
  '湿润严寒亚寒带',
  '苔原',
  '冰原',
] as const

export const KOPPEN_COLORS: readonly LinearRgb[] = [
  [0.05, 0.18, 0.34],
  [0.04, 0.48, 0.28],
  [0.11, 0.63, 0.32],
  [0.64, 0.78, 0.19],
  [0.75, 0.85, 0.39],
  [0.94, 0.39, 0.17],
  [0.77, 0.33, 0.28],
  [0.96, 0.69, 0.26],
  [0.86, 0.63, 0.40],
  [0.95, 0.77, 0.33],
  [0.93, 0.87, 0.48],
  [0.82, 0.85, 0.62],
  [0.29, 0.65, 0.38],
  [0.44, 0.72, 0.48],
  [0.61, 0.80, 0.61],
  [0.18, 0.67, 0.53],
  [0.36, 0.75, 0.65],
  [0.57, 0.81, 0.73],
  [0.70, 0.50, 0.68],
  [0.63, 0.59, 0.76],
  [0.55, 0.66, 0.80],
  [0.44, 0.59, 0.75],
  [0.44, 0.43, 0.72],
  [0.40, 0.51, 0.78],
  [0.34, 0.58, 0.80],
  [0.27, 0.52, 0.72],
  [0.36, 0.38, 0.69],
  [0.31, 0.45, 0.73],
  [0.25, 0.53, 0.74],
  [0.20, 0.45, 0.65],
  [0.67, 0.76, 0.82],
  [0.90, 0.94, 0.96],
]

function categorical(index: number): LinearRgb {
  const hue = (index * 0.618033988749895) % 1
  const component = (offset: number) => {
    const k = (offset + hue * 12) % 12
    return 0.63 - 0.38 * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [component(0), component(8), component(4)]
}

// Migrated from docs/old-src/core/simulation/ecology/biome-data.ts BIOME_COLORS.
// Values are linear RGB, matching the legacy Three.js vertex-color palette.
const LEGACY_BIOME_COLORS: Readonly<Record<string, LinearRgb>> = {
  Ocean: [0.035, 0.12, 0.28],
  TropicalRainforest: [0.05, 0.42, 0.18],
  TropicalSeasonalForest: [0.12, 0.58, 0.22],
  Savanna: [0.68, 0.66, 0.22],
  HotDesert: [0.83, 0.48, 0.22],
  ColdDesert: [0.65, 0.48, 0.42],
  Steppe: [0.72, 0.68, 0.4],
  MediterraneanShrubland: [0.68, 0.58, 0.28],
  TemperateGrassland: [0.48, 0.62, 0.32],
  TemperateSeasonalForest: [0.18, 0.48, 0.28],
  TemperateRainforest: [0.16, 0.6, 0.48],
  BorealForest: [0.2, 0.42, 0.5],
  Tundra: [0.56, 0.68, 0.72],
  IceSheet: [0.9, 0.94, 0.96],
  AlpineTundra: [0.73, 0.82, 0.78],
}

// Coarse land-cover classes reuse the corresponding legacy biome hues.
const LEGACY_LAND_COVER_COLORS: Readonly<Record<string, LinearRgb>> = {
  Ocean: LEGACY_BIOME_COLORS.Ocean,
  SnowIce: LEGACY_BIOME_COLORS.IceSheet,
  Forest: [0.142, 0.5, 0.332],
  Savanna: LEGACY_BIOME_COLORS.Savanna,
  Desert: [0.74, 0.48, 0.32],
  Grassland: [0.6, 0.65, 0.36],
  Shrubland: LEGACY_BIOME_COLORS.MediterraneanShrubland,
  Tundra: [0.645, 0.75, 0.75],
}

const BIOME_CODE_BY_ID = new Map<string, string>(NATURAL_BIOME_DEFINITIONS.map(definition => [definition.id, definition.code] as const))
const LAND_COVER_CODE_BY_ID = new Map<string, string>(NATURAL_LAND_COVER_DEFINITIONS.map(definition => [definition.id, definition.code] as const))

function ecologyClassColor(theme: 'biomes' | 'land-cover', id: string): LinearRgb {
  const code = theme === 'biomes' ? BIOME_CODE_BY_ID.get(id) : LAND_COVER_CODE_BY_ID.get(id)
  const palette = theme === 'biomes' ? LEGACY_BIOME_COLORS : LEGACY_LAND_COVER_COLORS
  return code ? palette[code] ?? [1, 0, 1] : [1, 0, 1]
}

/** Convert a legacy linear RGB category color to its matching CSS swatch. */
export function ecologyLegendColor(theme: 'biomes' | 'land-cover', id: string): string {
  const toSrgbByte = (linear: number) => {
    const value = Math.max(0, Math.min(1, linear))
    const srgb = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
    return Math.round(srgb * 255)
  }
  return `rgb(${ecologyClassColor(theme, id).map(toSrgbByte).join(', ')})`
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function mixColor(from: LinearRgb, to: LinearRgb, amount: number): LinearRgb {
  const t = clamp(amount)
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]
}

function scaleColor(color: LinearRgb, amount: number): LinearRgb {
  const scale = clamp(amount, 0, 2)
  return [clamp(color[0] * scale), clamp(color[1] * scale), clamp(color[2] * scale)]
}

/** Relief modulation ported from the reference satellite map hillshade. */
function satelliteHillshade(mesh: SphericalMesh, terrain: TerrainArtifact): Float32Array {
  const count = mesh.regionCount
  const elevation = new Float32Array(count)
  const shading = new Float32Array(count)
  for (let region = 0; region < count; region++) {
    if (terrain.landMask[region])
      elevation[region] = Math.max(0, terrain.elevationKm[region])
  }

  for (let region = 0; region < count; region++) {
    const center = region * 3
    const x = mesh.centers[center]
    const y = mesh.centers[center + 1]
    const z = mesh.centers[center + 2]
    const latitude = Math.asin(clamp(y, -1, 1))
    const longitude = Math.atan2(x, z)
    const eastX = Math.cos(longitude)
    const eastZ = -Math.sin(longitude)
    const northX = -Math.sin(latitude) * Math.sin(longitude)
    const northY = Math.cos(latitude)
    const northZ = -Math.sin(latitude) * Math.cos(longitude)
    let eastRise = 0
    let eastSpan = 0
    let northRise = 0
    let northSpan = 0

    for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
      const neighbor = mesh.neighbors[edge]
      const neighborCenter = neighbor * 3
      const dx = mesh.centers[neighborCenter] - x
      const dy = mesh.centers[neighborCenter + 1] - y
      const dz = mesh.centers[neighborCenter + 2] - z
      const eastDistance = (dx * eastX + dz * eastZ) * mesh.physicalRadiusKm
      const northDistance = (dx * northX + dy * northY + dz * northZ) * mesh.physicalRadiusKm
      const rise = elevation[neighbor] - elevation[region]
      eastRise += eastDistance * rise
      eastSpan += eastDistance * eastDistance
      northRise += northDistance * rise
      northSpan += northDistance * northDistance
    }

    const east = (eastSpan > 1e-8 ? eastRise / eastSpan : 0) * SATELLITE_HILLSHADE_GRADIENT_SCALE
    const north = (northSpan > 1e-8 ? northRise / northSpan : 0) * SATELLITE_HILLSHADE_GRADIENT_SCALE
    const normalLength = Math.sqrt(east * east + north * north + 1)
    const sunDot = (east * 0.48 - north * 0.42 + 0.77) / normalLength
    shading[region] = clamp(0.64 + 0.42 * Math.max(0, sunDot), 0.62, 1.04)
  }
  return shading
}

/** Port of the reference satellite renderer, using the same T0 surface texture fields. */
function satelliteSurfaceColor(region: number, terrain: TerrainArtifact, climate?: ClimateArtifact | null, ecology?: EcologyArtifact | null, hillshade?: Float32Array): LinearRgb {
  const elevationKm = terrain.elevationKm[region]
  const texture = terrain.surfaceTexture
  if (!terrain.landMask[region]) {
    const shallowWater = 1 - smoothstep(0.015, SATELLITE_SHALLOW_WATER_LIMIT_KM, Math.max(0, -elevationKm))
    const color = mixColor([0.018, 0.075, 0.17], [0.065, 0.28, 0.34], shallowWater)
    const bathymetricTexture = (texture?.detail[region] ?? 0) + (texture?.postDetail[region] ?? 0) * 0.35
    return scaleColor(color, 1 + clamp(bathymetricTexture * 0.08, -0.025, 0.025))
  }

  const annualTemperatureC = climate?.annualMeanTemperatureC[region] ?? 12
  const annualPrecipitationMm = climate?.annualPrecipitationMm[region] ?? 700
  const aridityIndex = ecology?.aridityIndex[region] ?? 0.5
  const thermal = smoothstep(-18, 26, annualTemperatureC)
  const aridityWetness = smoothstep(0.12, 0.85, aridityIndex)
  const precipitationWetness = smoothstep(120, 1800, annualPrecipitationMm)
  const wetness = clamp(aridityWetness * 0.68 + precipitationWetness * 0.32)
  let color = mixColor(
    mixColor([0.48, 0.46, 0.39], [0.66, 0.49, 0.3], thermal),
    mixColor([0.2, 0.29, 0.24], [0.065, 0.27, 0.09], thermal),
    wetness,
  )

  if (texture) {
    const surfaceTexture = texture.detail[region] * 0.45
      + texture.tectonicBand[region] * 0.18
      + texture.postDetail[region] * 0.5
      + texture.uniformLand[region] * 0.2
      + texture.coastal[region] * 0.16
    color = scaleColor(color, 1 + clamp(surfaceTexture, -0.14, 0.14))
  }

  const treeLineKm = 0.65 + 2.9 * thermal
  const alpineFactor = smoothstep(treeLineKm, treeLineKm + 1.8, elevationKm) * 0.82
  color = mixColor(color, [0.39, 0.37, 0.33], alpineFactor)
  const coldness = 1 - smoothstep(-10, 3, annualTemperatureC)
  const snowLineKm = 0.6 + 5 * thermal
  const altitudeSnow = smoothstep(snowLineKm, snowLineKm + 1.6, elevationKm) * (0.88 - 0.38 * thermal)
  const snowFactor = clamp(coldness * 0.72 + altitudeSnow, 0, 0.92)
  color = mixColor(color, [0.83, 0.87, 0.9], snowFactor)
  if (hillshade)
    color = scaleColor(color, hillshade[region])
  return color
}

/** Display palette consumes independent worker copies; it never changes geology facts. */
export function geographicNameLabel(name: string | undefined, kind: 'continent' | 'ocean', index: number): string {
  if (!name) return kind === 'continent' ? `大陆 ${index + 1}` : `大洋 ${index + 1}`
  const suffix = kind === 'continent' ? '大陆' : '洋'
  return `${name}${/[\u3400-\u9fff〇]$/u.test(name) ? '' : ' '}${suffix}`
}

export function geographicRegionLabel(regions: GeographicRegionsArtifact, region: number): string {
  const continent = regions.continentIndex[region]
  if (continent >= 0) return geographicNameLabel(regions.continents[continent]?.name, 'continent', continent)
  const ocean = regions.oceanIndex[region]
  if (ocean >= 0) return geographicNameLabel(regions.oceans[ocean]?.name, 'ocean', ocean)
  return `海 ${regions.seaIndex[region] + 1}`
}

export function geographicRegionColor(regions: GeographicRegionsArtifact, region: number): LinearRgb {
  const continent = regions.continentIndex[region]
  if (continent >= 0) {
    const color = categorical(continent)
    return [color[0] * 0.7 + 0.1, color[1] * 0.7 + 0.18, color[2] * 0.45 + 0.08]
  }
  const ocean = regions.oceanIndex[region]
  if (ocean >= 0) {
    const color = categorical(ocean + 17)
    return [0.025 + color[0] * 0.12, 0.10 + color[1] * 0.24, 0.24 + color[2] * 0.38]
  }
  const sea = regions.seaIndex[region]
  const color = categorical(sea + 41)
  return [0.05 + color[0] * 0.16, 0.21 + color[1] * 0.28, 0.27 + color[2] * 0.29]
}

export function geologyRegionColor(geology: GeologyArtifact | null | undefined, theme: GeologyTheme, terrain?: TerrainArtifact | null, climate?: ClimateArtifact | null, month = 0, cryosphere?: CryosphereArtifact | null, hydrology?: HydrologyArtifact | null, lakes?: StaticLakeArtifact | null, ecology?: EcologyArtifact | null, mesh?: SphericalMesh | null, regions?: GeographicRegionsArtifact | null): ((region: number) => readonly [number, number, number]) | undefined {
  if (theme === 'satellite' && terrain) {
    const hillshade = mesh ? satelliteHillshade(mesh, terrain) : undefined
    return region => satelliteSurfaceColor(region, terrain, climate, ecology, hillshade)
  }
  if (theme === 'continents' && regions)
    return region => geographicRegionColor(regions, region)
  if (!geology || theme === 'topology')
    return undefined
  return (region) => {
    if (theme === 'rivers' && hydrology)
      return terrain?.landMask[region] ? land : ocean
    if (theme === 'basins' && hydrology)
      return hydrology.basinIndex[region] < 0 ? ocean : categorical(hydrology.basinIndex[region])
    if (theme === 'lakes' && lakes) {
      const index = lakes.lakeIndex[region]
      if (index < 0)
        return terrain?.landMask[region] ? land : ocean
      return lakes.lakes[index].endorheic ? [0.04, 0.35, 0.62] : [0.03, 0.58, 0.88]
    }
    if (theme === 'koppen' && climate)
      return KOPPEN_COLORS[climate.koppenClass[region]] ?? KOPPEN_COLORS[0]
    if (theme === 'biomes' && ecology) {
      const index = ecology.potentialBiomeIndex[region]
      return ecologyClassColor(theme, ecology.potentialBiomeIds[index] ?? '')
    }
    if (theme === 'land-cover' && ecology) {
      const index = ecology.landCoverIndex[region]
      return ecologyClassColor(theme, ecology.landCoverIds[index] ?? '')
    }
    if (theme === 'runoff' && hydrology) {
      const intensity = Math.max(0, Math.min(1, Math.log1p(hydrology.annualRunoffMm[region]) / Math.log1p(2000)))
      return [0.84 - 0.72 * intensity, 0.25 + 0.5 * intensity, 0.18 + 0.75 * intensity]
    }
    if (theme === 'snow' && cryosphere) {
      const amount = cryosphere.monthlySnowWaterEquivalentMm[month * cryosphere.regionCount + region]
      const intensity = Math.max(0, Math.min(1, Math.log1p(amount) / Math.log1p(500)))
      return [0.35 + 0.58 * intensity, 0.48 + 0.48 * intensity, 0.62 + 0.38 * intensity]
    }
    if (climate && (theme === 'temperature' || theme === 'annual-temperature')) {
      const value = theme === 'annual-temperature'
        ? climate.annualMeanTemperatureC[region]
        : climate.temperatureC[month * climate.regionCount + region]
      const t = Math.max(0, Math.min(1, (value + 30) / 70))
      return [0.1 + 0.8 * t, 0.25 + 0.45 * (1 - Math.abs(t - 0.5) * 2), 0.85 - 0.75 * t]
    }
    if (climate && (theme === 'precipitation' || theme === 'annual-precipitation')) {
      const value = theme === 'annual-precipitation'
        ? climate.annualPrecipitationMm[region]
        : climate.precipitationMm[month * climate.regionCount + region]
      const p = Math.max(0, Math.min(1, value / (theme === 'annual-precipitation' ? 3000 : 400)))
      return [0.72 - 0.64 * p, 0.62 - 0.2 * p, 0.38 + 0.54 * p]
    }
    if (climate && theme === 'wind') {
      const speed = sampleClimateSpeedMps(climate, region, month, 'wind')
      return speed === null ? linearHex('#0a131c') : speedRampColor(speed, WIND_SPEED_STOPS)
    }
    if (climate && (theme === 'wind-speed' || theme === 'ocean-speed'))
      return CIRCULATION_SPEED_COLORS[circulationSpeedClass(theme, climate, month, region, Boolean(terrain?.landMask[region]))]
    if (climate && theme === 'ocean-current') {
      if (terrain?.landMask[region])
        return linearHex('#0d141e')
      const speed = sampleClimateSpeedMps(climate, region, month, 'ocean')
      return speed === null ? linearHex('#040a14') : speedRampColor(speed, OCEAN_CURRENT_SPEED_STOPS)
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
    if (theme === 'crust')
      return geology.crustType[region] ? [0.77, 0.55, 0.32] : ocean
    return geology.candidateLandMask[region] ? land : ocean
  }
}

// Palette aligned with the reference project. docs/old-src/core/styles/presets.ts defines
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
