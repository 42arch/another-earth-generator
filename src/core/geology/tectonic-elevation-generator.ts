import type { SphericalTectonicData } from '@/core/geology/geology-data'
import type {
  IslandGenerationParams,
  TectonicEdificeFields,
} from '@/core/geology/tectonic-edifice-generator'
import type { TectonicSpatialFields } from '@/core/geology/tectonic-spatial-fields'
import type { TerrainClassificationFields } from '@/core/geology/terrain-classifier'
import type SphericalMesh from '@/core/mesh/mesh'
import alea from 'alea'
import { createNoise3D } from 'simplex-noise'
import { PhasorRidgeGenerator } from '@/core/geology/phasor-ridge-generator'
import { TectonicEdificeGenerator } from '@/core/geology/tectonic-edifice-generator'
import { TectonicSpatialFieldGenerator } from '@/core/geology/tectonic-spatial-fields'
import { TerrainClassifier } from '@/core/geology/terrain-classifier'
import { referenceCellsToAngle } from '@/core/math/distance-field'
import { clamp } from '@/core/math/math'

export interface ElevationFields {
  elevation: Float32Array
  phasorRidge: Float32Array
  spatialFields: TectonicSpatialFields
  classification: TerrainClassificationFields
  edifices: TectonicEdificeFields
}

const LAND_INTERIOR_WIDTH = referenceCellsToAngle(6)
const PASSIVE_SHELF_WIDTH = referenceCellsToAngle(5)
const ACTIVE_SHELF_WIDTH = referenceCellsToAngle(2)
const CONTINENTAL_SLOPE_WIDTH = referenceCellsToAngle(3.5)
const RIFT_HALF_WIDTH = referenceCellsToAngle(1.6)
const FORELAND_CENTER = referenceCellsToAngle(3.5)
const FORELAND_WIDTH = referenceCellsToAngle(1.8)
const BACK_ARC_CENTER = referenceCellsToAngle(5)
const BACK_ARC_WIDTH = referenceCellsToAngle(2)
const PASSIVE_COASTAL_PLAIN_WIDTH = referenceCellsToAngle(4)
const ACTIVE_COASTAL_MARGIN_TOLERANCE = referenceCellsToAngle(1.25)
const PASSIVE_COASTAL_PLAIN_STRENGTH = 0.85
const RIFT_AXIS_WIDTH = referenceCellsToAngle(0.25)

const SHELF_START = -0.055
const SHELF_END = -0.14
const ABYSS_BASE = -0.35
const INTERIOR_BASE_SHIELD = 0.14
const INTERIOR_BASE_BASIN = 0.04
const INTERIOR_TECTONIC_UPLIFT = 0.16
const COASTAL_DEPRESSION = -0.08
const BASE_SCALE = 0.6
const DISTANCE_EPSILON = referenceCellsToAngle(0.03)
const RIDGE_SIGMA = referenceCellsToAngle(2.5)
const RIDGE_PEAK_SHIFT = referenceCellsToAngle(1)
const RIDGE_EXTENT = referenceCellsToAngle(5)

/** Builds the tectonic elevation skeleton before texture and erosion stages. */
export class TectonicElevationGenerator {
  private readonly spatialFieldGenerator = new TectonicSpatialFieldGenerator()
  private readonly terrainClassifier = new TerrainClassifier()
  private readonly phasorRidgeGenerator = new PhasorRidgeGenerator()
  private readonly edificeGenerator = new TectonicEdificeGenerator()

  generate(
    mesh: SphericalMesh,
    candidateLandMask: Uint8Array,
    tectonics: SphericalTectonicData,
    seed: number,
    islandParams: IslandGenerationParams,
  ): ElevationFields {
    console.time('spatialFieldGenerator.generate')
    const spatialFields = this.spatialFieldGenerator.generate(
      mesh,
      candidateLandMask,
      tectonics,
    )
    console.timeEnd('spatialFieldGenerator.generate')
    
    console.time('terrainClassifier.generate')
    const classification = this.terrainClassifier.generate(
      mesh,
      candidateLandMask,
      tectonics,
      spatialFields,
      seed,
    )
    console.timeEnd('terrainClassifier.generate')
    
    console.time('buildElevation loop')
    const skeletonElevation = new Float32Array(mesh.numRegions)
    const skeletonNoise = createNoise3D(alea(seed + 557))
    const riftNoise = createNoise3D(alea(seed + 419))

    for (let region = 0; region < mesh.numRegions; region++) {
      const baseElevation = this.buildDistanceRatioBase(region, spatialFields, classification)
      const value = candidateLandMask[region] === 1
        ? this.buildContinentalElevation(
            region,
            baseElevation,
            mesh,
            tectonics,
            spatialFields,
            classification,
            skeletonNoise,
            riftNoise,
          )
        : this.buildOceanicElevation(region, baseElevation, mesh, spatialFields, skeletonNoise)
      skeletonElevation[region] = clamp(value, -0.75, 1.2)
    }
    console.timeEnd('buildElevation loop')
    
    console.time('phasorRidgeGenerator.generate')
    const phasor = this.phasorRidgeGenerator.generate(
      mesh,
      skeletonElevation,
      candidateLandMask,
      tectonics,
      spatialFields,
      classification,
      seed,
    )
    console.timeEnd('phasorRidgeGenerator.generate')
    
    console.time('edificeGenerator.generate')
    const { elevation, edifices } = this.edificeGenerator.generate(
      mesh,
      phasor.elevation,
      candidateLandMask,
      tectonics,
      spatialFields,
      seed,
      islandParams,
    )
    console.timeEnd('edificeGenerator.generate')

    return {
      elevation,
      phasorRidge: phasor.contribution,
      spatialFields,
      classification,
      edifices,
    }
  }

  private buildContinentalElevation(
    region: number,
    baseElevation: number,
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    fields: TectonicSpatialFields,
    classification: TerrainClassificationFields,
    noise: ReturnType<typeof createNoise3D>,
    riftNoise: ReturnType<typeof createNoise3D>,
  ): number {
    const position = region * 3
    const x = mesh.regionPosition[position]
    const y = mesh.regionPosition[position + 1]
    const z = mesh.regionPosition[position + 2]
    const coastDistance = fields.coastDistance[region]
    const convergent = fields.convergentInfluence[region]
    const overriding = fields.overridingInfluence[region]
    const activity = classification.tectonicActivity[region]
    const subduction = classification.subductionFactor[region]
    const personality = classification.basinFactor[region]
    const mountainDistance = fields.convergentDistance[region]
    const plateVariation = (tectonics.regionBaseElevation[region] - 0.22) * 0.3
    let elevation = baseElevation + plateVariation

    if (subduction > 0.5 && elevation > 0)
      elevation *= 1 - (subduction - 0.5) * 2 * 0.42

    const stressMagnitude = convergent * convergent
      * 0.32
      * classification.orogenicPower[region]
    const stressHeightVariation = 0.6 + 0.8 * this.fbm(
      noise,
      x * 8 + 13.7,
      y * 8 + 9.2,
      z * 8 + 4.5,
      3,
    )
    elevation += stressMagnitude
      * ((1 - subduction) - 0.4 * subduction)
      * stressHeightVariation

    const mountainBoost = Number.isFinite(fields.convergentDistance[region])
      && subduction < 0.45
      && fields.convergentDistance[region] < coastDistance
      ? (1 - this.smoothstep(0, LAND_INTERIOR_WIDTH * 1.25, fields.convergentDistance[region]))
      * LAND_INTERIOR_WIDTH * 0.35
      : 0
    const effectiveCoastDistance = coastDistance + mountainBoost
    const downRamp = this.smoothstep(0, LAND_INTERIOR_WIDTH, effectiveCoastDistance)
    const upRamp = this.smoothstep(0, LAND_INTERIOR_WIDTH * 0.4, effectiveCoastDistance)
    const interiorBase = INTERIOR_BASE_SHIELD * (1 - personality)
      + INTERIOR_BASE_BASIN * personality
    const interiorUplift = interiorBase + activity * INTERIOR_TECTONIC_UPLIFT
    const coastalDepression = COASTAL_DEPRESSION * (1 - personality * 0.4)
    const interiorVariation = 1 + 0.2 * this.fbm(
      noise,
      x * 2 + 19.3,
      y * 2 + 7.6,
      z * 2 + 13.1,
      2,
    )
    elevation += (
      coastalDepression * (1 - downRamp) + interiorUplift * upRamp
    ) * interiorVariation

    if (
      Number.isFinite(mountainDistance)
      && convergent < 0.15
      && subduction < 0.5
      && mountainDistance < LAND_INTERIOR_WIDTH * 0.3
    ) {
      const t = mountainDistance / (LAND_INTERIOR_WIDTH * 0.3)
      const profile = t < 0.2
        ? this.smoothstep(0, 0.2, t)
        : 1 - this.smoothstep(0.2, 1, t)
      elevation -= 0.05 * profile * (0.5 + personality * 0.5)
    }

    const riftDistance = fields.riftDistance[region]
    if (Number.isFinite(riftDistance)) {
      const widthRaw = this.fbm(
        riftNoise,
        x * 0.5 + 91.3,
        y * 0.5 + 17.6,
        z * 0.5 + 64.2,
        2,
      )
      const width = clamp(0.5 + widthRaw, 0, 1)
      const floorEnd = RIFT_HALF_WIDTH * 0.35 * (0.5 + 0.5 * width * width)
      const shoulderEnd = floorEnd + RIFT_HALF_WIDTH * 0.5 * (0.65 + 0.35 * width)
      const outerEnd = floorEnd + RIFT_HALF_WIDTH * 2.75 * (0.65 + 0.35 * width)
      let riftEffect = 0
      if (riftDistance <= RIFT_AXIS_WIDTH) {
        riftEffect = -0.12 + this.ridgedFbm(riftNoise, x * 8, y * 8, z * 8, 3) * 0.06
      }
      else if (riftDistance <= floorEnd) {
        const t = riftDistance / Math.max(floorEnd, Number.EPSILON)
        riftEffect = -0.08 * (1 - t * 0.3)
          + this.ridgedFbm(riftNoise, x * 8, y * 8, z * 8, 3) * 0.03 * (1 - t)
      }
      else if (riftDistance <= shoulderEnd) {
        riftEffect = 0.5 * (0.55 + 0.55 * this.fbm(
          noise,
          x * 2.5 + 41.7,
          y * 2.5 + 53.1,
          z * 2.5 + 27.4,
          2,
        ))
      }
      else if (riftDistance <= outerEnd) {
        riftEffect = 0.5
          * (1 - this.smoothstep(shoulderEnd, outerEnd, riftDistance))
          * 0.35
      }
      elevation += riftEffect * fields.divergentInfluence[region]
    }

    const overridingDistance = fields.overridingDistance[region]
    if (Number.isFinite(overridingDistance)) {
      const foreland = this.gaussian(
        overridingDistance - FORELAND_CENTER,
        FORELAND_WIDTH,
      )
      const backArc = this.gaussian(
        fields.backArcDistance[region] - BACK_ARC_CENTER,
        BACK_ARC_WIDTH,
      )
      elevation -= overriding * (foreland * 0.075 + backArc * 0.045)
    }

    if (mountainDistance < RIDGE_EXTENT && convergent > 0.01) {
      const asymmetry = Math.abs(subduction - 0.5) * 2
      const signedDistance = subduction > 0.5 ? mountainDistance : -mountainDistance
      const distanceFromPeak = signedDistance + asymmetry * RIDGE_PEAK_SHIFT
      const widthNoise = 1 + 0.25 * this.fbm(
        noise,
        x * 3 + 44.1,
        y * 3 + 22.7,
        z * 3 + 11.3,
        2,
      )
      const stressWidth = 0.75 + convergent * 0.5
      const sideWidth = distanceFromPeak > 0
        ? 1 - asymmetry * 0.35
        : 1 + asymmetry * 0.55
      const sigma = RIDGE_SIGMA * stressWidth * widthNoise * sideWidth
      const ridgeHeightVariation = 0.6 + 0.6 * this.fbm(
        noise,
        x * 2.5 + 17.3,
        y * 2.5 + 31.7,
        z * 2.5 + 8.9,
        2,
      )
      elevation += this.gaussian(distanceFromPeak, sigma)
        * convergent
        * 0.12
        * ridgeHeightVariation
    }

    if (classification.plateau[region] !== 0 && activity > 0.1)
      elevation += 0.06 * activity * (1 - subduction)

    // A decayed convergent influence from an inland collision must not erase a
    // passive coastal plain. Only preserve a high coastal range when a genuine
    // convergent source lies at that margin (or immediately inland of it).
    const activeCoastalMargin = Number.isFinite(mountainDistance)
      && mountainDistance <= coastDistance + ACTIVE_COASTAL_MARGIN_TOLERANCE
    if (coastDistance < PASSIVE_COASTAL_PLAIN_WIDTH && !activeCoastalMargin && elevation > 0.02) {
      const suppression = PASSIVE_COASTAL_PLAIN_STRENGTH
        * (1 - this.smoothstep(0, PASSIVE_COASTAL_PLAIN_WIDTH, coastDistance))
      elevation -= (elevation - 0.02) * suppression
    }

    const insideRiftFloor = Number.isFinite(riftDistance)
      && riftDistance <= RIFT_HALF_WIDTH * 0.35 + RIFT_AXIS_WIDTH
    if (!insideRiftFloor) {
      const floor = 0.008 * this.smoothstep(0, referenceCellsToAngle(2.5), coastDistance)
      elevation = Math.max(elevation, floor)
    }
    elevation -= fields.transformInfluence[region] * 0.018
    return elevation
  }

  private buildOceanicElevation(
    region: number,
    baseElevation: number,
    mesh: SphericalMesh,
    fields: TectonicSpatialFields,
    noise: ReturnType<typeof createNoise3D>,
  ): number {
    const coastDistance = fields.coastDistance[region]
    const activeMargin = fields.activeMarginDistance[region] < PASSIVE_SHELF_WIDTH
    const shelfWidth = activeMargin ? ACTIVE_SHELF_WIDTH : PASSIVE_SHELF_WIDTH
    let oceanBase: number

    if (coastDistance <= shelfWidth) {
      const t = this.smoothstep(0, shelfWidth, coastDistance)
      oceanBase = SHELF_START + (SHELF_END - SHELF_START) * t
    }
    else if (coastDistance <= shelfWidth + CONTINENTAL_SLOPE_WIDTH) {
      const t = this.smoothstep(
        shelfWidth,
        shelfWidth + CONTINENTAL_SLOPE_WIDTH,
        coastDistance,
      )
      oceanBase = SHELF_END + (ABYSS_BASE - SHELF_END) * t
    }
    else {
      const position = region * 3
      oceanBase = ABYSS_BASE + this.fbm(
        noise,
        mesh.regionPosition[position] * 2,
        mesh.regionPosition[position + 1] * 2,
        mesh.regionPosition[position + 2] * 2,
        3,
      ) * 0.03
    }

    let elevation = Math.min(baseElevation, oceanBase)
    const ridgeDistance = fields.ridgeDistance[region]
    if (Number.isFinite(ridgeDistance) && ridgeDistance <= referenceCellsToAngle(3)) {
      const fade = 1 - this.smoothstep(0, referenceCellsToAngle(3), ridgeDistance)
      const position = region * 3
      const ridged = this.ridgedFbm(
        noise,
        mesh.regionPosition[position] * 3,
        mesh.regionPosition[position + 1] * 3,
        mesh.regionPosition[position + 2] * 3,
        4,
      )
      elevation += (0.08 + ridged * 0.12) * fade * fade
    }
    elevation -= fields.subductingInfluence[region] * 0.27
    elevation += fields.overridingInfluence[region] * 0.11
    const fractureDistance = fields.fractureDistance[region]
    if (Number.isFinite(fractureDistance)) {
      const fractureFade = 1 - this.smoothstep(0, referenceCellsToAngle(2.5), fractureDistance)
      elevation -= fractureFade * fields.transformInfluence[region] * 0.04
    }
    return elevation
  }

  private buildDistanceRatioBase(
    region: number,
    fields: TectonicSpatialFields,
    classification: TerrainClassificationFields,
  ): number {
    const mountainDistance = fields.terrainMountainDistance[region]
    const oceanDistance = fields.terrainOceanDistance[region]
    const coastlineDistance = fields.terrainCoastlineDistance[region]
    const a = (Number.isFinite(mountainDistance) ? mountainDistance : Math.PI)
      * (1 + (classification.subductionFactor[region] - 0.5) * 0.8)
      + DISTANCE_EPSILON
    const b = (Number.isFinite(oceanDistance) ? oceanDistance : Math.PI) + DISTANCE_EPSILON
    const c = (Number.isFinite(coastlineDistance) ? coastlineDistance : Math.PI) + DISTANCE_EPSILON
    const inverseMountain = 1 / a
    const inverseOcean = 1 / b
    return (inverseMountain - inverseOcean)
      / (inverseMountain + inverseOcean + 1 / c)
      * BASE_SCALE
  }

  private smoothstep(edge0: number, edge1: number, value: number): number {
    if (edge0 === edge1)
      return value < edge0 ? 0 : 1
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)
  }

  private gaussian(distance: number, sigma: number): number {
    if (!Number.isFinite(distance))
      return 0
    const safeSigma = Math.max(sigma, Number.EPSILON)
    const normalized = distance / safeSigma
    return Math.exp(-0.5 * normalized * normalized)
  }

  private fbm(
    noise: ReturnType<typeof createNoise3D>,
    x: number,
    y: number,
    z: number,
    octaves: number,
    persistence = 2 / 3,
  ): number {
    let value = 0
    let amplitude = 1
    let frequency = 1
    let amplitudeSum = 0
    for (let octave = 0; octave < octaves; octave++) {
      value += noise(x * frequency, y * frequency, z * frequency) * amplitude
      amplitudeSum += amplitude
      amplitude *= persistence
      frequency *= 2
    }
    return amplitudeSum > 0 ? value / amplitudeSum : 0
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
