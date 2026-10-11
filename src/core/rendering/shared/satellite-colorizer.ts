import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldSimulationState } from '@/core/simulation/state'
import { clamp, smoothstep } from '@/core/math/math'

type Rgb = readonly [number, number, number]

const EARTH_RADIUS_KM = 6371
const ROCK_COLOR: Rgb = [0.39, 0.37, 0.33]
const SNOW_COLOR: Rgb = [0.83, 0.87, 0.9]

/** Creates natural-looking surface colors from continuous climate and terrain fields. */
export class SatelliteColorizer {
  build(data: WorldSimulationState, mesh: SphericalMesh, hillshade = false): Float32Array {
    const count = mesh.numRegions
    const colors = new Float32Array(count * 3)
    const gradients = hillshade ? this.buildLandGradients(mesh, data) : undefined
    const textures = data.geography.terrainTexture
    const biome = data.biome
    const climate = data.climate?.koppen

    for (let region = 0; region < count; region++) {
      const elevation = data.geography.elevation[region]
      let color: Rgb
      if (!data.geography.landMask[region]) {
        const depthKm = Math.max(0, -elevation)
        const shallowWater = 1 - smoothstep(0.015, 0.45, depthKm)
        color = this.mix([0.018, 0.075, 0.17], [0.065, 0.28, 0.34], shallowWater)
        const bathymetricTexture = textures.detail[region] + textures.postDetail[region] * 0.35
        color = this.scale(color, 1 + clamp(bathymetricTexture * 0.08, -0.025, 0.025))
      }
      else {
        const annualTemperature = biome?.annualTemperatureC[region] ?? climate?.annualTemperatureC[region] ?? 12
        const annualPrecipitation = biome?.annualPrecipitationMm[region] ?? climate?.annualPrecipitationMm[region] ?? 700
        const aridityIndex = biome?.aridityIndex[region] ?? 0.5
        const thermal = smoothstep(-18, 26, annualTemperature)
        const aridityWetness = smoothstep(0.12, 0.85, aridityIndex)
        const precipitationWetness = smoothstep(120, 1800, annualPrecipitation)
        const wetness = clamp(aridityWetness * 0.68 + precipitationWetness * 0.32, 0, 1)

        // Continuous dry-to-humid and cold-to-warm palette blending avoids
        // sharp borders caused by assigning one fixed color per biome class.
        const dryColor = this.mix([0.48, 0.46, 0.39], [0.66, 0.49, 0.3], thermal)
        const vegetatedColor = this.mix([0.2, 0.29, 0.24], [0.065, 0.27, 0.09], thermal)
        color = this.mix(dryColor, vegetatedColor, wetness)

        const texture = textures.detail[region] * 0.45
          + textures.tectonicBand[region] * 0.18
          + textures.postDetail[region] * 0.5
          + textures.uniformLand[region] * 0.2
          + textures.coastal[region] * 0.16
        color = this.scale(color, 1 + clamp(texture, -0.14, 0.14))

        // Vegetation gradually gives way to exposed rock, then permanent snow.
        const treeLineKm = 0.65 + 2.9 * thermal
        const alpineFactor = smoothstep(treeLineKm, treeLineKm + 1.8, elevation) * 0.82
        color = this.mix(color, ROCK_COLOR, alpineFactor)
        const coldness = 1 - smoothstep(-10, 3, annualTemperature)
        const snowLineKm = 0.6 + 5 * thermal
        const altitudeSnow = smoothstep(snowLineKm, snowLineKm + 1.6, elevation) * (0.88 - 0.38 * thermal)
        const snowFactor = clamp(coldness * 0.72 + altitudeSnow, 0, 0.92)
        color = this.mix(color, SNOW_COLOR, snowFactor)

        if (gradients) {
          const east = gradients.east[region] * 12
          const north = gradients.north[region] * 12
          const normalLength = Math.sqrt(east * east + north * north + 1)
          // Fixed northwest light gives the projected map readable relief.
          const sunDot = (east * 0.48 - north * 0.42 + 0.77) / normalLength
          color = this.scale(color, clamp(0.64 + 0.42 * Math.max(0, sunDot), 0.62, 1.04))
        }
      }

      const target = region * 3
      colors[target] = color[0]
      colors[target + 1] = color[1]
      colors[target + 2] = color[2]
    }
    return colors
  }

  private buildLandGradients(mesh: SphericalMesh, data: WorldSimulationState): { east: Float32Array, north: Float32Array } {
    const count = mesh.numRegions
    const elevation = new Float32Array(count)
    for (let region = 0; region < count; region++) {
      if (data.geography.landMask[region])
        elevation[region] = Math.max(0, data.geography.elevation[region])
    }

    const east = new Float32Array(count)
    const north = new Float32Array(count)
    for (let region = 0; region < count; region++) {
      const latitude = mesh.regionLatitude[region]
      const longitude = mesh.regionLongitude[region]
      const eastX = Math.cos(longitude)
      const eastZ = -Math.sin(longitude)
      const northX = -Math.sin(latitude) * Math.sin(longitude)
      const northY = Math.cos(latitude)
      const northZ = -Math.sin(latitude) * Math.cos(longitude)
      const center = region * 3
      const x = mesh.regionPosition[center]
      const y = mesh.regionPosition[center + 1]
      const z = mesh.regionPosition[center + 2]
      let eastRise = 0
      let eastSpan = 0
      let northRise = 0
      let northSpan = 0
      for (let edge = mesh.neighborOffsets[region]; edge < mesh.neighborOffsets[region + 1]; edge++) {
        const neighbor = mesh.neighbors[edge]
        const index = neighbor * 3
        const dx = mesh.regionPosition[index] - x
        const dy = mesh.regionPosition[index + 1] - y
        const dz = mesh.regionPosition[index + 2] - z
        const eastDistance = (dx * eastX + dz * eastZ) * EARTH_RADIUS_KM
        const northDistance = (dx * northX + dy * northY + dz * northZ) * EARTH_RADIUS_KM
        const rise = elevation[neighbor] - elevation[region]
        eastRise += eastDistance * rise
        eastSpan += eastDistance * eastDistance
        northRise += northDistance * rise
        northSpan += northDistance * northDistance
      }
      east[region] = eastSpan > 1e-8 ? eastRise / eastSpan : 0
      north[region] = northSpan > 1e-8 ? northRise / northSpan : 0
    }
    return { east, north }
  }

  private mix(a: Rgb, b: Rgb, amount: number): Rgb {
    const t = clamp(amount, 0, 1)
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ]
  }

  private scale(color: Rgb, amount: number): Rgb {
    return [
      clamp(color[0] * amount, 0, 1),
      clamp(color[1] * amount, 0, 1),
      clamp(color[2] * amount, 0, 1),
    ]
  }
}
