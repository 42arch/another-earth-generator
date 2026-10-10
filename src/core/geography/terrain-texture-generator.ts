import type { TectonicSpatialFields } from '@/core/geology/tectonic-spatial-fields'
import type { TerrainClassificationFields } from '@/core/geology/terrain-classifier'
import type SphericalMesh from '@/core/mesh/mesh'
import alea from 'alea'
import { createNoise3D } from 'simplex-noise'
import { referenceCellsToAngle } from '@/core/math/distance-field'
import { clamp, smoothstep } from '@/core/math/math'

export interface TerrainTextureFields {
  phasorRidge: Float32Array
  tectonicBand: Float32Array
  detail: Float32Array
  coastal: Float32Array
  uniformLand: Float32Array
  postDetail: Float32Array
  total: Float32Array
}

const COAST_DETAIL_WIDTH = referenceCellsToAngle(4)
const OCEAN_FLOOR_CLAMP = -0.005
const ISLAND_PEAK_FLOOR = 0.04
const SUMMIT_PEAK_SCALE = 1

/** Builds scale-separated, seam-free surface texture on the unit sphere. */
export class TerrainTextureGenerator {
  generate(
    mesh: SphericalMesh,
    baseElevation: Float32Array,
    candidateLandMask: Uint8Array,
    spatialFields: TectonicSpatialFields,
    classification: TerrainClassificationFields,
    seed: number,
    islandDensity: number,
    roughness: number,
    phasorRidge?: Float32Array,
  ): { elevation: Float32Array, texture: TerrainTextureFields } {
    const noiseMagnitude = clamp(roughness, 0, 0.5)
    const tectonicBand = this.buildTectonicBandNoise(
      mesh,
      candidateLandMask,
      classification,
      seed,
      noiseMagnitude,
    )
    const afterTectonicBand = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++)
      afterTectonicBand[region] = baseElevation[region] + tectonicBand[region]
    const detail = this.buildDetailTexture(
      mesh,
      afterTectonicBand,
      candidateLandMask,
      spatialFields,
      classification,
      seed,
      noiseMagnitude,
    )
    const afterDetail = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++)
      afterDetail[region] = afterTectonicBand[region] + detail[region]
    const coastal = this.buildCoastalDetail(
      mesh,
      afterDetail,
      candidateLandMask,
      spatialFields,
      seed,
      clamp(islandDensity, 0, 1),
      noiseMagnitude / 0.4,
    )
    const preUniformElevation = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      preUniformElevation[region] = afterDetail[region] + coastal[region]
    }
    const uniformLand = this.buildUniformLandNoise(
      mesh,
      preUniformElevation,
      candidateLandMask,
      spatialFields,
      classification,
      seed,
      noiseMagnitude,
    )
    const total = new Float32Array(mesh.numRegions)
    const postDetail = new Float32Array(mesh.numRegions)
    const structural = phasorRidge?.length === mesh.numRegions
      ? phasorRidge
      : new Float32Array(mesh.numRegions)
    const elevation = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      const surfaceTexture = tectonicBand[region]
        + detail[region]
        + coastal[region]
        + uniformLand[region]
      total[region] = structural[region] + surfaceTexture
      elevation[region] = clamp(baseElevation[region] + surfaceTexture, -0.75, 1.2)
      if (
        candidateLandMask[region] === 0
        && elevation[region] > OCEAN_FLOOR_CLAMP
        && elevation[region] < ISLAND_PEAK_FLOOR
      ) {
        elevation[region] = OCEAN_FLOOR_CLAMP
      }
    }
    return {
      elevation,
      texture: {
        phasorRidge: structural,
        tectonicBand,
        detail,
        coastal,
        uniformLand,
        postDetail,
        total,
      },
    }
  }

  private buildTectonicBandNoise(
    mesh: SphericalMesh,
    candidateLandMask: Uint8Array,
    classification: TerrainClassificationFields,
    seed: number,
    noiseMagnitude: number,
  ): Float32Array {
    const noise = createNoise3D(alea(seed))
    const result = new Float32Array(mesh.numRegions)
    const warpOctaves = mesh.numRegions > 200000 ? 2 : 3
    for (let region = 0; region < mesh.numRegions; region++) {
      const position = region * 3
      const x = mesh.regionPosition[position]
      const y = mesh.regionPosition[position + 1]
      const z = mesh.regionPosition[position + 2]
      const wx = x + 0.4 * this.fbm(noise, x + 5.3, y + 1.7, z + 3.1, warpOctaves)
      const wy = y + 0.4 * this.fbm(noise, x + 8.1, y + 2.9, z + 7.3, warpOctaves)
      const wz = z + 0.4 * this.fbm(noise, x + 1.4, y + 6.2, z + 4.8, warpOctaves)
      if (candidateLandMask[region] === 0) {
        result[region] = this.fbm(noise, wx * 4, wy * 4, wz * 4, 4)
          * noiseMagnitude
          * 0.2
        continue
      }

      const foldBelt = classification.foldBelt[region]
      const foldFrequency = 1 + foldBelt * 2
      const continentalFrequency = foldFrequency * 4
      const continental = this.fbm(
        noise,
        wx * continentalFrequency,
        wy * continentalFrequency,
        wz * continentalFrequency,
        4,
      ) * noiseMagnitude
      const ridged = this.ridgedFbm(
        noise,
        wx * continentalFrequency,
        wy * continentalFrequency,
        wz * continentalFrequency,
        4,
      ) * noiseMagnitude
      const continentalMixed = continental * (1 - foldBelt) + ridged * foldBelt
      const regional = this.fbm(
        noise,
        wx * 16 * foldFrequency + 22.1,
        wy * 16 * foldFrequency + 6.8,
        wz * 16 * foldFrequency + 15.4,
        4,
        0.5,
      ) * noiseMagnitude * 0.27
      const local = this.fbm(
        noise,
        wx * 20 + 41.7,
        wy * 20 + 13.2,
        wz * 20 + 27.9,
        3,
        0.5,
      ) * noiseMagnitude * 0.14
      const amplitude = classification.noiseAmplitude[region]
      result[region] = (continentalMixed + regional) * amplitude
        + local * Math.sqrt(amplitude)
    }
    return result
  }

  private buildDetailTexture(
    mesh: SphericalMesh,
    baseElevation: Float32Array,
    candidateLandMask: Uint8Array,
    fields: TectonicSpatialFields,
    _classification: TerrainClassificationFields,
    seed: number,
    noiseMagnitude: number,
  ): Float32Array {
    const noise = createNoise3D(alea(seed))
    const result = new Float32Array(mesh.numRegions)
    const warpOctaves = mesh.numRegions > 200000 ? 2 : 3
    for (let region = 0; region < mesh.numRegions; region++) {
      if (candidateLandMask[region] === 0 || baseElevation[region] <= 0.1)
        continue
      const position = region * 3
      const x = mesh.regionPosition[position]
      const y = mesh.regionPosition[position + 1]
      const z = mesh.regionPosition[position + 2]
      const wx = x + 0.4 * this.fbm(noise, x + 5.3, y + 1.7, z + 3.1, warpOctaves)
      const wy = y + 0.4 * this.fbm(noise, x + 8.1, y + 2.9, z + 7.3, warpOctaves)
      const wz = z + 0.4 * this.fbm(noise, x + 1.4, y + 6.2, z + 4.8, warpOctaves)
      const elevationExcess = baseElevation[region] - 0.1
      const dissection = this.fbm(
        noise,
        wx * 32 + 71.3,
        wy * 32 + 44.8,
        wz * 32 + 29.1,
        3,
        0.5,
      )
      const elevationDrive = Math.min(1, Math.sqrt(elevationExcess) * 2)
      const stress = fields.convergentInfluence[region]
      let contribution = dissection
        * Math.sqrt(elevationExcess)
        * Math.max(elevationDrive, stress)
        * noiseMagnitude
        * 0.3
      const elevationAfterDissection = baseElevation[region] + contribution
      if (elevationAfterDissection > 0.55 && stress > 0.03) {
        const peakNoise = this.ridgedFbm(
          noise,
          wx * 36 + 91.3,
          wy * 36 + 55.7,
          wz * 36 + 38.2,
          3,
        )
        const spike = Math.max(0, peakNoise - 0.45)
        contribution += spike
          * (elevationAfterDissection - 0.55)
          * Math.max(stress, 0.2)
          * SUMMIT_PEAK_SCALE
      }
      result[region] = contribution
    }
    return result
  }

  private buildCoastalDetail(
    mesh: SphericalMesh,
    baseElevation: Float32Array,
    candidateLandMask: Uint8Array,
    fields: TectonicSpatialFields,
    seed: number,
    islandDensity: number,
    roughnessScale: number,
  ): Float32Array {
    const coastNoise = createNoise3D(alea(seed + 77))
    const warpNoise = createNoise3D(alea(seed + 211))
    const islandNoise = createNoise3D(alea(seed + 133))
    const nearshoreIslandWidth = referenceCellsToAngle(1 + islandDensity * 1)
    const islandMaskStart = 0.94 - islandDensity * 0.2
    const islandMaskEnd = 0.995 - islandDensity * 0.04
    const islandAmplitude = 0.04 + islandDensity * 0.035
    const result = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      const coastDistance = fields.coastDistance[region]
      if (coastDistance > COAST_DETAIL_WIDTH)
        continue
      const position = region * 3
      const x = mesh.regionPosition[position]
      const y = mesh.regionPosition[position + 1]
      const z = mesh.regionPosition[position + 2]
      const falloff = 1 - smoothstep(0, COAST_DETAIL_WIDTH, coastDistance)
      const activeMargin = fields.convergentInfluence[region]
      const subductionSuppression = fields.subductingInfluence[region]
      const frequency = 24 + activeMargin * 12
      const amplitude = (0.019 + activeMargin * 0.024) * falloff * falloff

      const warpX = warpNoise(x * 3 + 11.3, y * 3 + 4.7, z * 3 + 8.2) * 0.075 * falloff
      const warpY = warpNoise(x * 3 + 2.9, y * 3 + 9.4, z * 3 + 1.6) * 0.075 * falloff
      const warpZ = warpNoise(x * 3 + 7.5, y * 3 + 0.3, z * 3 + 5.9) * 0.075 * falloff
      const original = coastNoise(x * frequency, y * frequency, z * frequency)
      const warped = coastNoise(
        (x + warpX) * frequency,
        (y + warpY) * frequency,
        (z + warpZ) * frequency,
      )
      let delta = (original * 0.45 + (warped - original) * 0.9)
        * amplitude
        * roughnessScale
      if (delta > 0)
        delta *= 1 - subductionSuppression * 0.8

      if (
        candidateLandMask[region] === 0
        && coastDistance <= nearshoreIslandWidth
        && subductionSuppression < 0.25
      ) {
        const islandMacro = this.ridged(islandNoise(x * 19, y * 19, z * 19))
        const islandFine = this.ridged(islandNoise(
          x * 41 + 13.7,
          y * 41 + 5.9,
          z * 41 + 21.3,
        ))
        const islandMask = smoothstep(
          islandMaskStart,
          islandMaskEnd,
          islandMacro * islandFine,
        )
        const coastFade = 1 - coastDistance / nearshoreIslandWidth
        const bump = islandMask * coastFade * islandAmplitude
        if (baseElevation[region] + delta + bump > ISLAND_PEAK_FLOOR)
          delta += bump
      }
      result[region] = delta
    }
    return result
  }

  private buildUniformLandNoise(
    mesh: SphericalMesh,
    elevation: Float32Array,
    candidateLandMask: Uint8Array,
    fields: TectonicSpatialFields,
    classification: TerrainClassificationFields,
    seed: number,
    noiseMagnitude: number,
  ): Float32Array {
    const additiveNoise = createNoise3D(alea(seed + 500))
    const subtractiveNoise = createNoise3D(alea(seed + 501))
    const result = new Float32Array(mesh.numRegions)
    const amplitude = 0.65 * noiseMagnitude
    const mountainRampDistance = referenceCellsToAngle(10)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (candidateLandMask[region] === 0 && elevation[region] <= 0)
        continue
      const current = elevation[region]
      let slopeSum = 0
      let neighborCount = 0
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        slopeSum += Math.abs(elevation[neighbor] - current)
        neighborCount++
      }
      const slope = neighborCount > 0 ? slopeSum / neighborCount : 0
      const gradientDampening = 1 / (1 + 4 * slope)
      const positiveElevation = Math.max(0, current)
      const elevationT = Math.min(1, positiveElevation / 0.3)
      const elevationBoost = smoothstep(0, 1, elevationT)
      const basinDampening = 1 - 0.6 * classification.basinFactor[region]
      const mountainDistance = fields.convergentDistance[region]
      const mountainT = Number.isFinite(mountainDistance)
        ? Math.max(0, 1 - mountainDistance / mountainRampDistance)
        : 0
      const modulation = Math.max(
        0.1,
        gradientDampening
        * elevationBoost
        * basinDampening
        * (1 + 0.5 * mountainT * mountainT),
      )
      const index = region * 3
      const x = mesh.regionPosition[index]
      const y = mesh.regionPosition[index + 1]
      const z = mesh.regionPosition[index + 2]
      const additive = this.fbm(
        additiveNoise,
        x * 36 + 55.3,
        y * 36 + 18.7,
        z * 36 + 42.1,
        8,
      ) * amplitude
      const subtractive = this.fbm(
        subtractiveNoise,
        x * 72 + 88.9,
        y * 72 + 33.4,
        z * 72 + 61.6,
        8,
      ) * amplitude * 0.5
      result[region] = (additive - subtractive) * modulation
    }
    return result
  }

  private fbm(
    noise: ReturnType<typeof createNoise3D>,
    x: number,
    y: number,
    z: number,
    octaves: number,
    persistence = 2 / 3,
  ): number {
    let amplitude = 1
    let frequency = 1
    let value = 0
    let weight = 0
    for (let octave = 0; octave < octaves; octave++) {
      value += noise(x * frequency, y * frequency, z * frequency) * amplitude
      weight += amplitude
      amplitude *= persistence
      frequency *= 2
    }
    return weight > 0 ? value / weight : 0
  }

  private ridged(value: number): number {
    return 1 - Math.abs(value)
  }

  private ridgedFbm(
    noise: ReturnType<typeof createNoise3D>,
    x: number,
    y: number,
    z: number,
    octaves: number,
  ): number {
    let sum = 0
    let frequency = 1
    let amplitude = 1
    let previous = 1
    let maximum = 0
    for (let octave = 0; octave < octaves; octave++) {
      let value = 1 - Math.abs(noise(x * frequency, y * frequency, z * frequency))
      value *= value
      sum += value * amplitude * previous
      maximum += amplitude
      previous = Math.min(value, 1)
      frequency *= 2
      amplitude *= 0.5
    }
    return maximum > 0 ? sum / maximum : 0
  }

}
