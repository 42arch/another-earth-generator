import type SphericalMesh from '@/core/mesh/mesh'
import type { GlobeDisplayMode } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { KOPPEN_COLORS } from '@/core/climate/koppen-climate-classifier'
import { BIOME_COLORS } from '@/core/ecology/biome-data'
import { CRUST_TYPE, SUBDUCTION_ROLE } from '@/core/geology/geology-data'
import { clamp } from '@/core/math/math'
import { getOceanCurrentSpeedColor, getWindColor } from '@/core/rendering/shared/climate-color-scale'
import { SatelliteColorizer } from '@/core/rendering/shared/satellite-colorizer'
import { Color } from 'three'
import {
  getHeightmapLandColor,
  getHeightmapOceanColor,
  HEIGHTMAP_MAX_LAND_ELEVATION_KM,
  HEIGHTMAP_MAX_OCEAN_DEPTH_KM,
} from '@/core/rendering/shared/heightmap-color-scale'

type Rgb = readonly [number, number, number]

export class WorldColorizer {
  private readonly satelliteColorizer = new SatelliteColorizer()
  private readonly heightmapOceanPalette = this.buildHeightmapOceanPalette()
  private readonly heightmapLandPalette = this.buildHeightmapLandPalette()
  private readonly windPalette = this.buildClimatePalette(getWindColor)
  private readonly oceanCurrentSpeedPalette = this.buildClimatePalette(getOceanCurrentSpeedColor)

  build(data: WorldSimulationState, mode: GlobeDisplayMode, mesh?: SphericalMesh, mapHillshade = false): Float32Array {
    if (mode === 'satellite') {
      if (!mesh)
        throw new Error('Satellite rendering requires the world mesh')
      return this.satelliteColorizer.build(data, mesh, mapHillshade)
    }

    const numRegions = data.geography.elevation.length
    const colors = new Float32Array(numRegions * 3)

    let plateColors: Float32Array | null = null
    if (mode === 'plates') {
      const regions = data.geology.regionSuperPlate
      let maxPlate = 0
      for (let i = 0; i < numRegions; i++) {
        if (regions[i] > maxPlate)
          maxPlate = regions[i]
      }
      plateColors = this.buildPlateColors(maxPlate + 1)
    }
    let continentColors: Float32Array | null = null
    if (mode === 'continents') {
      let maxContinent = 0
      for (let i = 0; i < numRegions; i++) {
        if (data.geography.visibleContinentId[i] > maxContinent)
          maxContinent = data.geography.visibleContinentId[i]
      }
      continentColors = this.buildPlateColors(maxContinent + 1)
    }
    let maximumStress = 0
    if (mode === 'stress') {
      for (let region = 0; region < numRegions; region++)
        maximumStress = Math.max(maximumStress, data.geology.tectonics.regionStress[region])
    }
    let maximumFlowLog = 1
    const flowValues = data.geography.terrainErosion.flowAccumulation
    if (mode === 'geometric-flow') {
      for (let region = 0; region < numRegions; region++) {
        maximumFlowLog = Math.max(
          maximumFlowLog,
          Math.log1p(flowValues[region]),
        )
      }
    }

    for (let region = 0; region < numRegions; region++) {
      const target = region * 3
      let color: Rgb

      if (mode === 'plates' && plateColors) {
        const plate = data.geology.regionSuperPlate[region]
        const pIdx = Math.max(0, plate) * 3
        colors[target] = plateColors[pIdx]
        colors[target + 1] = plateColors[pIdx + 1]
        colors[target + 2] = plateColors[pIdx + 2]
        continue
      }
      else if (mode === 'continents' && continentColors) {
        const continent = data.geography.visibleContinentId[region]
        if (data.geography.landMask[region] === 0) {
          colors[target] = 0.1
          colors[target + 1] = 0.15
          colors[target + 2] = 0.2
        }
        else if (continent < 0) {
          colors[target] = 0.62
          colors[target + 1] = 0.58
          colors[target + 2] = 0.46
        }
        else {
          const cIdx = continent * 3
          colors[target] = continentColors[cIdx]
          colors[target + 1] = continentColors[cIdx + 1]
          colors[target + 2] = continentColors[cIdx + 2]
        }
        continue
      }
      else if (mode === 'dem') {
        color = data.geography.landMask[region] === 0
          ? [0, 0, 0]
          : this.demColor(data.geography.elevation[region])
      }
      else if (mode === 'heightmap') {
        color = this.heightmapColor(
          data.geography.elevation[region],
          data.geography.landMask[region] === 0,
        )
      }
      /*
      else if (mode === 'crust') {
        color = data.geology.tectonics.regionCrustType[region] === CRUST_TYPE.Continental
          ? [0.72, 0.52, 0.28]
          : [0.08, 0.3, 0.52]
      }
      else if (mode === 'density') {
        const density = clamp((data.geology.tectonics.regionDensity[region] - 2.4) / 1.1, 0, 1)
        color = this.mix([0.96, 0.78, 0.32], [0.25, 0.08, 0.48], density)
      }
      */
      else if (mode === 'subduction') {
        const overriding = data.geography.terrainFields.overridingInfluence[region]
        const subducting = data.geography.terrainFields.subductingInfluence[region]
        const role = data.geology.tectonics.regionSubductionRole[region]
        color = overriding > subducting || role === SUBDUCTION_ROLE.Overriding
          ? this.mix([0.18, 0.16, 0.14], [1, 0.45, 0.08], overriding)
          : subducting > 0 || role === SUBDUCTION_ROLE.Subducting
            ? this.mix([0.05, 0.1, 0.16], [0.15, 0.55, 1], subducting)
            : data.geology.tectonics.regionCrustType[region] === CRUST_TYPE.Continental
              ? [0.18, 0.16, 0.14]
              : [0.05, 0.1, 0.16]
      }
      else if (mode === 'stress') {
        const stress = maximumStress > 0
          ? data.geology.tectonics.regionStress[region] / maximumStress
          : 0
        color = this.stressColor(stress)
      }
      else if (mode === 'mantle') {
        color = this.mantleColor(data.geology.mantleFlow[region])
      }
      else if (mode === 'volcanism') {
        color = this.volcanismColor(data, region)
      }
      else if (mode === 'classification') {
        color = this.terrainClassificationColor(data, region)
      }
      else if (mode === 'texture') {
        color = this.textureColor(data, region)
      }
      else if (mode === 'finalization') {
        color = this.finalizationColor(data, region)
      }
      else if (mode === 'geometric-flow') {
        const strength = Math.log1p(flowValues[region])
          / maximumFlowLog
        color = this.flowColor(strength)
      }
      else if (mode === 'glacial') {
        color = this.glacialColor(data.geography.terrainErosion.glacialIndex[region])
      }
      else if (mode === 'koppen') {
        color = KOPPEN_COLORS[data.climate?.koppen?.climateClass[region] ?? 0]
      }
      else if (mode === 'biome') {
        color = BIOME_COLORS[data.biome?.biomeClass[region] ?? 0] ?? BIOME_COLORS[0]
      }
      else if (mode === 'temperature') {
        color = this.temperatureColor(data.climate?.displayMonth?.temperatureC[region] ?? 0)
      }
      else if (mode === 'precipitation') {
        color = this.precipitationColor(data.climate?.displayMonth?.precipitationMm[region] ?? 0)
      }
      else if (mode === 'wind' || mode === 'ocean-current') {
        const vector = data.climate?.displayVector
        const strength = vector && vector.kind === mode
          ? Math.hypot(vector.east[region], vector.north[region])
          : 0
        const land = data.geography.landMask[region] !== 0
        color = mode === 'wind'
          ? this.mix(
              this.windContextColor(data, region),
              this.climatePaletteColor(this.windPalette, strength / 0.9),
              0.4,
            )
          : land
            ? [0.035, 0.055, 0.075]
            : this.climatePaletteColor(this.oceanCurrentSpeedPalette, strength / 1.5)
      }
      else {
        color = [0, 0, 0]
      }

      colors[target] = color[0]
      colors[target + 1] = color[1]
      colors[target + 2] = color[2]
    }

    return colors
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
      const target = corner * 3
      const color = this.demColor(value)
      colors[target] = color[0]
      colors[target + 1] = color[1]
      colors[target + 2] = color[2]
    }
    return colors
  }

  private demColor(elevation: number): Rgb {
    const shade = clamp(elevation / HEIGHTMAP_MAX_LAND_ELEVATION_KM, 0, 1)
    return [shade, shade, shade]
  }

  private heightmapColor(elevation: number, isOcean: boolean): Rgb {
    const palette = isOcean ? this.heightmapOceanPalette : this.heightmapLandPalette
    const scale = isOcean
      ? -elevation / HEIGHTMAP_MAX_OCEAN_DEPTH_KM
      : elevation / HEIGHTMAP_MAX_LAND_ELEVATION_KM
    const paletteIndex = Math.round(clamp(scale, 0, 1) * 255)
    const offset = paletteIndex * 3
    return [
      palette[offset],
      palette[offset + 1],
      palette[offset + 2],
    ]
  }

  private windContextColor(data: WorldSimulationState, region: number): Rgb {
    const elevation = data.geography.elevation[region]
    if (data.geography.landMask[region] !== 0) {
      const relief = Math.sqrt(clamp(elevation / HEIGHTMAP_MAX_LAND_ELEVATION_KM, 0, 1))
      return this.mix([0.30, 0.28, 0.22], [0.48, 0.43, 0.33], relief)
    }

    const depth = Math.sqrt(clamp(-elevation / HEIGHTMAP_MAX_OCEAN_DEPTH_KM, 0, 1))
    return this.mix([0.08, 0.27, 0.36], [0.025, 0.12, 0.23], depth)
  }

  private buildHeightmapOceanPalette(): Float32Array {
    const palette = new Float32Array(256 * 3)
    const color = new Color()
    for (let index = 0; index < 256; index++) {
      const depth = HEIGHTMAP_MAX_OCEAN_DEPTH_KM * index / 255
      color.setStyle(getHeightmapOceanColor(depth))
      const offset = index * 3
      palette[offset] = color.r
      palette[offset + 1] = color.g
      palette[offset + 2] = color.b
    }
    return palette
  }

  private buildHeightmapLandPalette(): Float32Array {
    const palette = new Float32Array(256 * 3)
    const color = new Color()
    for (let index = 0; index < 256; index++) {
      const elevation = HEIGHTMAP_MAX_LAND_ELEVATION_KM * index / 255
      color.setStyle(getHeightmapLandColor(elevation))
      const offset = index * 3
      palette[offset] = color.r
      palette[offset + 1] = color.g
      palette[offset + 2] = color.b
    }
    return palette
  }

  private buildClimatePalette(colorAt: (value: number) => string): Float32Array {
    const palette = new Float32Array(256 * 3)
    const color = new Color()
    for (let index = 0; index < 256; index++) {
      color.setStyle(colorAt(index / 255))
      const offset = index * 3
      palette[offset] = color.r
      palette[offset + 1] = color.g
      palette[offset + 2] = color.b
    }
    return palette
  }

  private climatePaletteColor(palette: Float32Array, value: number): Rgb {
    const paletteIndex = Math.round(clamp(value, 0, 1) * 255)
    const offset = paletteIndex * 3
    return [palette[offset], palette[offset + 1], palette[offset + 2]]
  }

  private temperatureColor(value: number): Rgb {
    const t = clamp((value + 30) / 70, 0, 1)
    if (t < 0.5)
      return this.mix([0.18, 0.32, 0.72], [0.88, 0.93, 0.86], t * 2)
    return this.mix([0.88, 0.93, 0.86], [0.86, 0.27, 0.12], (t - 0.5) * 2)
  }

  private precipitationColor(value: number): Rgb {
    const t = clamp(Math.log1p(value) / Math.log1p(600), 0, 1)
    if (t < 0.5)
      return this.mix([0.80, 0.65, 0.42], [0.34, 0.68, 0.49], t * 2)
    return this.mix([0.34, 0.68, 0.49], [0.08, 0.25, 0.57], (t - 0.5) * 2)
  }

  private stressColor(stress: number): Rgb {
    const value = clamp(stress, 0, 1)
    if (value < 0.35)
      return this.mix([0.015, 0.02, 0.04], [0.28, 0.05, 0.38], value / 0.35)
    if (value < 0.7)
      return this.mix([0.28, 0.05, 0.38], [0.9, 0.18, 0.05], (value - 0.35) / 0.35)
    return this.mix([0.9, 0.18, 0.05], [1, 0.95, 0.45], (value - 0.7) / 0.3)
  }

  private volcanismColor(data: WorldSimulationState, region: number): Rgb {
    const contributions: Array<{ value: number, color: Rgb }> = [
      { value: data.geology.edifices.islandArc[region] / 3.3, color: [0.1, 0.75, 1] },
      { value: data.geology.edifices.volcanicArc[region] / 1.32, color: [1, 0.24, 0.06] },
      { value: data.geology.edifices.hotspot[region] / 3.3, color: [1, 0.82, 0.08] },
      { value: data.geology.edifices.largeIgneousProvince[region] / 0.3, color: [0.72, 0.2, 1] },
    ]
    let strongest = contributions[0]
    for (let index = 1; index < contributions.length; index++) {
      if (contributions[index].value > strongest.value)
        strongest = contributions[index]
    }
    return this.mix([0.025, 0.03, 0.045], strongest.color, clamp(strongest.value, 0, 1))
  }

  private textureColor(data: WorldSimulationState, region: number): Rgb {
    const contributions: Array<{ value: number, color: Rgb }> = [
      { value: Math.abs(data.geography.terrainTexture.phasorRidge[region]) / 0.9, color: [0.72, 0.3, 1] },
      { value: Math.abs(data.geography.terrainTexture.tectonicBand[region]) / 0.48, color: [1, 0.4, 0.08] },
      { value: Math.abs(data.geography.terrainTexture.detail[region]) / 0.24, color: [0.08, 0.8, 0.72] },
      { value: Math.abs(data.geography.terrainTexture.coastal[region]) / 0.3, color: [1, 0.18, 0.55] },
      { value: Math.abs(data.geography.terrainTexture.uniformLand[region]) / 0.21, color: [0.68, 0.82, 0.2] },
      { value: Math.abs(data.geography.terrainTexture.postDetail[region]) / 0.15, color: [0.3, 0.72, 1] },
    ]
    let strongest = contributions[0]
    for (let index = 1; index < contributions.length; index++) {
      if (contributions[index].value > strongest.value)
        strongest = contributions[index]
    }
    return this.mix([0.02, 0.025, 0.035], strongest.color, clamp(strongest.value, 0, 1))
  }

  private terrainClassificationColor(data: WorldSimulationState, region: number): Rgb {
    if (data.geography.candidateLandMask[region] === 0) {
      return this.mix(
        [0.025, 0.06, 0.12],
        [0.12, 0.42, 0.72],
        data.geography.terrainClassification.tectonicActivity[region],
      )
    }
    const contributions: Array<{ value: number, color: Rgb }> = [
      { value: data.geography.terrainClassification.craton[region], color: [0.74, 0.67, 0.28] },
      { value: data.geography.terrainClassification.basin[region], color: [0.12, 0.48, 0.72] },
      { value: data.geography.terrainClassification.foldBelt[region], color: [0.94, 0.25, 0.08] },
      {
        value: data.geography.terrainClassification.plateau[region],
        color: [0.62, 0.27, 0.82],
      },
    ]
    let strongest = contributions[0]
    for (let index = 1; index < contributions.length; index++) {
      if (contributions[index].value > strongest.value)
        strongest = contributions[index]
    }
    const activity = data.geography.terrainClassification.tectonicActivity[region]
    const base = this.mix([0.12, 0.22, 0.12], [0.32, 0.42, 0.18], activity)
    return this.mix(base, strongest.color, clamp(strongest.value, 0, 1))
  }

  private finalizationColor(data: WorldSimulationState, region: number): Rgb {
    if (data.geography.terrainFinalization.topologyChanged[region] !== 0)
      return [1, 0.2, 0.72]
    const delta = data.geography.terrainFinalization.shapingDelta[region]
      + data.geography.terrainFinalization.topologyDelta[region]
      + data.geography.terrainFinalization.postProcessDelta[region]
    const strength = clamp(Math.abs(delta) / 0.72, 0, 1)
    const color: Rgb = delta >= 0 ? [1, 0.62, 0.12] : [0.12, 0.58, 1]
    return this.mix([0.02, 0.025, 0.035], color, strength)
  }

  private flowColor(value: number): Rgb {
    const strength = clamp(value, 0, 1)
    if (strength < 0.55) {
      return this.mix(
        [0.012, 0.02, 0.035],
        [0.04, 0.42, 0.72],
        strength / 0.55,
      )
    }
    return this.mix(
      [0.04, 0.42, 0.72],
      [0.72, 1, 0.96],
      (strength - 0.55) / 0.45,
    )
  }

  private mantleColor(value: number): Rgb {
    const strength = clamp(value, -1, 1)
    return strength >= 0
      ? this.mix([0.025, 0.03, 0.045], [1, 0.24, 0.06], strength)
      : this.mix([0.025, 0.03, 0.045], [0.08, 0.42, 1], -strength)
  }

  private glacialColor(value: number): Rgb {
    const strength = clamp(value, 0, 1)
    if (strength < 0.45) {
      return this.mix(
        [0.012, 0.02, 0.035],
        [0.12, 0.48, 0.9],
        strength / 0.45,
      )
    }
    return this.mix(
      [0.12, 0.48, 0.9],
      [0.94, 0.98, 1],
      (strength - 0.45) / 0.55,
    )
  }

  private buildPlateColors(plateCount: number): Float32Array {
    const colors = new Float32Array(Math.max(1, plateCount) * 3)
    for (let plate = 0; plate < plateCount; plate++) {
      const hue = (plate * 137.508) % 360
      const rgb = this.hslToRgb(hue / 360, 0.65, 0.55)
      const target = plate * 3
      colors[target] = rgb[0]
      colors[target + 1] = rgb[1]
      colors[target + 2] = rgb[2]
    }
    return colors
  }

  private mix(a: Rgb, b: Rgb, t: number): Rgb {
    const clamped = clamp(t, 0, 1)
    return [
      a[0] + (b[0] - a[0]) * clamped,
      a[1] + (b[1] - a[1]) * clamped,
      a[2] + (b[2] - a[2]) * clamped,
    ]
  }

  private hslToRgb(h: number, s: number, l: number): Rgb {
    if (s === 0)
      return [l, l, l]
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    const hue2rgb = (t: number) => {
      let v = t
      if (v < 0)
        v += 1
      if (v > 1)
        v -= 1
      if (v < 1 / 6)
        return p + (q - p) * 6 * v
      if (v < 1 / 2)
        return q
      if (v < 2 / 3)
        return p + (q - p) * (2 / 3 - v) * 6
      return p
    }
    return [
      hue2rgb(h + 1 / 3),
      hue2rgb(h),
      hue2rgb(h - 1 / 3),
    ]
  }
}
