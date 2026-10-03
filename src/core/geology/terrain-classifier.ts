import type { SphericalTectonicData } from '@/core/geology/geology-data'
import type { TectonicSpatialFields } from '@/core/geology/tectonic-spatial-fields'
import type SphericalMesh from '@/core/mesh/mesh'
import alea from 'alea'
import { createNoise3D } from 'simplex-noise'
import { referenceCellsToAngle } from '@/core/math/distance-field'
import { clamp } from '@/core/math/math'

export interface TerrainClassificationFields {
  basinFactor: Float32Array
  tectonicActivity: Float32Array
  foldBelt: Float32Array
  craton: Float32Array
  basin: Float32Array
  plateau: Uint8Array
  noiseAmplitude: Float32Array
  orogenicPower: Float32Array
  subductionFactor: Float32Array
}

const BASIN_FREQUENCY = 1.8
const BASIN_FACTOR_BIAS = 0.5
const BASIN_FACTOR_SCALE = 0.6
const TECTONIC_REACH = referenceCellsToAngle(10)
const PLATEAU_START = referenceCellsToAngle(1.5)
const SUBDUCTING_REACH_MIN = 0.35
const SUBDUCTING_REACH_RANGE = 0.3
const FOLD_BELT_MULTIPLIER = 3
const CRATON_TECTONIC_MULTIPLIER = 2.5
const BASIN_TECTONIC_MULTIPLIER = 2
const NOISE_ACTIVITY_SCALE = 4
const NOISE_BASE_SCALE = 0.15
const NOISE_ACTIVITY_CONTRIBUTION = 0.45
const PLATEAU_SUPPRESSION_MIN = 0.3
const PLATEAU_SUPPRESSION_SCALE = 0.3
const BASIN_AMPLITUDE_SUPPRESSION = 0.25
const CRATON_AMPLITUDE_SUPPRESSION = 0.12
const OROGENIC_FREQUENCY = 1.5

/** Classifies each cell into overlapping reference-style terrain archetypes. */
export class TerrainClassifier {
  generate(
    mesh: SphericalMesh,
    candidateLandMask: Uint8Array,
    tectonics: SphericalTectonicData,
    spatial: TectonicSpatialFields,
    seed: number,
  ): TerrainClassificationFields {
    const basinFactor = new Float32Array(mesh.numRegions)
    const tectonicActivity = new Float32Array(mesh.numRegions)
    const foldBelt = new Float32Array(mesh.numRegions)
    const craton = new Float32Array(mesh.numRegions)
    const basin = new Float32Array(mesh.numRegions)
    const plateau = new Uint8Array(mesh.numRegions)
    const noiseAmplitude = new Float32Array(mesh.numRegions)
    const orogenicPower = new Float32Array(mesh.numRegions)
    const subductionFactor = new Float32Array(mesh.numRegions)
    const basinNoise = createNoise3D(alea(seed + 661))
    const orogenicNoise = createNoise3D(alea(seed))
    const maximumStress = this.maximum(tectonics.regionStress)

    for (let region = 0; region < mesh.numRegions; region++) {
      const index = region * 3
      const x = mesh.regionPosition[index]
      const y = mesh.regionPosition[index + 1]
      const z = mesh.regionPosition[index + 2]
      const rawOrogenic = orogenicNoise(
        x * OROGENIC_FREQUENCY + 33.7,
        y * OROGENIC_FREQUENCY + 11.2,
        z * OROGENIC_FREQUENCY + 22.9,
      )
      const shapedOrogenic = Math.sign(rawOrogenic) * Math.sqrt(Math.abs(rawOrogenic))
      orogenicPower[region] = clamp(0.5 + 0.5 * shapedOrogenic, 0, 1)

      const factor = spatial.subductionFactor[region]
      subductionFactor[region] = factor
      const boundaryStress = maximumStress > 0
        ? Math.min(1, tectonics.regionStress[region] / maximumStress)
        : 0
      // Reference terrain classes consume the stress after it has propagated
      // into a plate, rather than only the one-cell boundary signal.
      const stress = Math.max(boundaryStress, spatial.convergentInfluence[region])
      const effectiveReach = factor > 0.5
        ? TECTONIC_REACH * (
          SUBDUCTING_REACH_MIN + SUBDUCTING_REACH_RANGE * (1 - factor)
        )
        : TECTONIC_REACH
      const mountainDistance = spatial.convergentDistance[region]
      const proximity = Number.isFinite(mountainDistance) && mountainDistance < effectiveReach
        ? 1 - mountainDistance / effectiveReach
        : 0
      const activity = Math.max(stress, proximity ** 3)
      tectonicActivity[region] = activity

      if (candidateLandMask[region] === 0)
        continue
      const rawBasin = this.fbm(
        basinNoise,
        x * BASIN_FREQUENCY + 7.3,
        y * BASIN_FREQUENCY + 3.1,
        z * BASIN_FREQUENCY + 9.7,
        2,
      )
      const personality = clamp(
        BASIN_FACTOR_BIAS + rawBasin * BASIN_FACTOR_SCALE,
        0,
        1,
      )
      basinFactor[region] = personality
      foldBelt[region] = Math.min(1, stress * FOLD_BELT_MULTIPLIER)
      craton[region] = Math.max(0, 1 - activity * CRATON_TECTONIC_MULTIPLIER)
        * (1 - personality)
      basin[region] = personality
        * Math.max(0, 1 - activity * BASIN_TECTONIC_MULTIPLIER)
      const isPlateau = factor < 0.45
        && Number.isFinite(mountainDistance)
        && mountainDistance > PLATEAU_START
        && mountainDistance < TECTONIC_REACH
      plateau[region] = isPlateau ? 1 : 0

      const noiseActivity = Math.min(1, stress * NOISE_ACTIVITY_SCALE)
      const plateauSuppression = isPlateau
        ? Math.max(
            PLATEAU_SUPPRESSION_MIN,
            1 - activity * PLATEAU_SUPPRESSION_SCALE,
          )
        : 1
      noiseAmplitude[region] = (
        NOISE_BASE_SCALE + NOISE_ACTIVITY_CONTRIBUTION * noiseActivity
      )
      * plateauSuppression
      * (1 - basin[region] * BASIN_AMPLITUDE_SUPPRESSION)
      * (1 - craton[region] * CRATON_AMPLITUDE_SUPPRESSION)
    }

    return {
      basinFactor,
      tectonicActivity,
      foldBelt,
      craton,
      basin,
      plateau,
      noiseAmplitude,
      orogenicPower,
      subductionFactor,
    }
  }

  private fbm(
    noise: ReturnType<typeof createNoise3D>,
    x: number,
    y: number,
    z: number,
    octaves: number,
  ): number {
    let value = 0
    let amplitude = 1
    let frequency = 1
    let amplitudeSum = 0
    for (let octave = 0; octave < octaves; octave++) {
      value += noise(x * frequency, y * frequency, z * frequency) * amplitude
      amplitudeSum += amplitude
      amplitude *= 0.5
      frequency *= 2
    }
    return amplitudeSum > 0 ? value / amplitudeSum : 0
  }

  private maximum(values: Float32Array): number {
    let maximum = 0
    for (const value of values)
      maximum = Math.max(maximum, value)
    return maximum
  }
}
