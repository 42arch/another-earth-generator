import type { SphericalTectonicData } from '@/core/geology/geology-data'
import type { TectonicSpatialFields } from '@/core/geology/tectonic-spatial-fields'
import type SphericalMesh from '@/core/mesh/mesh'
import alea from 'alea'
import { createNoise3D } from 'simplex-noise'
import {
  CRUST_TYPE,
  PLATE_BOUNDARY,
  SUBDUCTION_ROLE,
} from '@/core/geology/geology-data'
import {
  computeSphericalDistanceField,
  computeSphericalInfluenceField,
  referenceCellsToAngle,
} from '@/core/math/distance-field'
import { clamp } from '@/core/math/math'

export interface TectonicEdificeFields {
  islandArc: Float32Array
  volcanicArc: Float32Array
  hotspot: Float32Array
  largeIgneousProvince: Float32Array
  total: Float32Array
}

export interface IslandGenerationParams {
  islandArcCount: number
  islandDensity: number
  hotspotCount: number
}

interface SphericalEdifice {
  x: number
  y: number
  z: number
  sigma: number
  height: number
  swellSigma?: number
  swellHeight?: number
  drift?: readonly [number, number, number]
  stretch?: number
  calderaDepth?: number
  calderaSigma?: number
  warp?: number
}

const ARC_PEAK_DISTANCE = referenceCellsToAngle(1.25)
const ARC_BAND_WIDTH = referenceCellsToAngle(1)
const ARC_MAX_DISTANCE = referenceCellsToAngle(3.5)
const ARC_ORIGIN_MIN_CHORD = 0.5
const MAX_OCEAN_ARC_ELEVATION = 0.6
const ARC_BASE_AMPLITUDE = 2.3
const ARC_PEAK_AMPLITUDE = 1.65
const VOLCANIC_ARC_DISTANCE = referenceCellsToAngle(2)
const VOLCANIC_ARC_WIDTH = referenceCellsToAngle(1.25)
const VOLCANO_MIN_SPACING = referenceCellsToAngle(1.25)
const VOLCANO_SIGMA = 0.003
const VOLCANO_HEIGHT_BASE = 0.15
const HOTSPOT_CHAIN_LENGTH = 6
const HOTSPOT_CHAIN_SPACING = 0.06
const HOTSPOT_MIN_SPACING = 0.42
const LIP_SIGMA = 0.08

/** Adds sparse tectonic edifices on top of the continuous elevation skeleton. */
export class TectonicEdificeGenerator {
  generate(
    mesh: SphericalMesh,
    baseElevation: Float32Array,
    candidateLandMask: Uint8Array,
    tectonics: SphericalTectonicData,
    fields: TectonicSpatialFields,
    seed: number,
    params: IslandGenerationParams,
  ): { elevation: Float32Array, edifices: TectonicEdificeFields } {
    const islandDensity = clamp(params.islandDensity, 0, 1)
    const islandArc = this.buildIslandArcs(
      mesh,
      baseElevation,
      candidateLandMask,
      tectonics,
      fields,
      seed,
      Math.max(0, Math.floor(params.islandArcCount)),
      islandDensity,
    )
    const volcanicArc = this.buildVolcanicArcs(mesh, candidateLandMask, tectonics, fields, seed)
    const { hotspot, largeIgneousProvince } = this.buildHotspotsAndLips(
      mesh,
      candidateLandMask,
      tectonics,
      seed,
      Math.max(0, Math.floor(params.hotspotCount)),
    )
    const total = new Float32Array(mesh.numRegions)
    const elevation = new Float32Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      total[region] = islandArc[region]
        + volcanicArc[region]
        + hotspot[region]
        + largeIgneousProvince[region]
      elevation[region] = clamp(baseElevation[region] + total[region], -0.75, 1.2)
    }
    return {
      elevation,
      edifices: {
        islandArc,
        volcanicArc,
        hotspot,
        largeIgneousProvince,
        total,
      },
    }
  }

  private buildIslandArcs(
    mesh: SphericalMesh,
    baseElevation: Float32Array,
    candidateLandMask: Uint8Array,
    tectonics: SphericalTectonicData,
    fields: TectonicSpatialFields,
    seed: number,
    maximumOrigins: number,
    islandDensity: number,
  ): Float32Array {
    const uplift = new Float32Array(mesh.numRegions)
    const macroNoise = createNoise3D(alea(seed + 911))
    const arcNoise = createNoise3D(alea(seed + 307))
    const peakNoise = createNoise3D(alea(seed + 1307))
    const macroThreshold = 0.67 - islandDensity * 0.2
    const patchThreshold = 0.92 - islandDensity * 0.2

    const candidates: Array<{
      region: number
      x: number
      y: number
      z: number
      score: number
      stress: number
    }> = []

    for (let region = 0; region < mesh.numRegions; region++) {
      const plate = tectonics.regionPlate[region]
      if (
        candidateLandMask[region] === 1
        || tectonics.plateCrustType[plate] !== CRUST_TYPE.Oceanic
        || tectonics.regionBoundaryType[region] !== PLATE_BOUNDARY.Convergent
        || tectonics.regionSubductionRole[region] !== SUBDUCTION_ROLE.Overriding
        || !this.hasOceanicPlateNeighbor(mesh, region, tectonics)
      ) {
        continue
      }
      const stress = fields.overridingInfluence[region]
      if (stress < 0.035)
        continue

      const position = region * 3
      const x = mesh.regionPosition[position]
      const y = mesh.regionPosition[position + 1]
      const z = mesh.regionPosition[position + 2]
      const score = this.fbm(macroNoise, x * 4, y * 4, z * 4, 3) + stress * 0.25
      if (score < macroThreshold)
        continue
      candidates.push({ region, x, y, z, score, stress })
    }

    candidates.sort((a, b) => b.score - a.score || a.region - b.region)
    const origins: typeof candidates = []
    const minimumSpacingSquared = ARC_ORIGIN_MIN_CHORD * ARC_ORIGIN_MIN_CHORD
    for (const candidate of candidates) {
      if (origins.length >= maximumOrigins)
        break
      if (origins.some((origin) => {
        const dx = candidate.x - origin.x
        const dy = candidate.y - origin.y
        const dz = candidate.z - origin.z
        return dx * dx + dy * dy + dz * dz < minimumSpacingSquared
      })) {
        continue
      }
      origins.push(candidate)
    }
    if (origins.length === 0)
      return uplift

    const isOrigin = new Uint8Array(mesh.numRegions)
    const originStress = new Float32Array(mesh.numRegions)
    for (const origin of origins) {
      isOrigin[origin.region] = 1
      originStress[origin.region] = origin.stress
    }
    const sameOceanicPlate = (from: number, to: number) => (
      candidateLandMask[to] === 0
      && tectonics.regionPlate[from] === tectonics.regionPlate[to]
    )
    const arcDistance = computeSphericalDistanceField(
      mesh,
      region => isOrigin[region] !== 0,
      sameOceanicPlate,
    )
    const arcStress = computeSphericalInfluenceField(
      mesh,
      region => originStress[region],
      ARC_MAX_DISTANCE,
      sameOceanicPlate,
    )

    for (let region = 0; region < mesh.numRegions; region++) {
      const distance = arcDistance[region]
      if (!Number.isFinite(distance) || distance > ARC_MAX_DISTANCE)
        continue
      const position = region * 3
      const x = mesh.regionPosition[position]
      const y = mesh.regionPosition[position + 1]
      const z = mesh.regionPosition[position + 2]
      const ridged = 1 - Math.abs(this.fbm(arcNoise, x * 5, y * 5, z * 5, 2))
      if (ridged <= patchThreshold)
        continue
      const excess = (ridged - patchThreshold) / (1 - patchThreshold)
      const peak = 1 - Math.abs(peakNoise(x * 30, y * 30, z * 30))
      const distanceWeight = this.gaussian(distance - ARC_PEAK_DISTANCE, ARC_BAND_WIDTH)
      const stressFactor = 0.5 + arcStress[region]
      const requestedUplift = distanceWeight
        * stressFactor
        * (
          excess * ARC_BASE_AMPLITUDE
          + peak * peak * ARC_PEAK_AMPLITUDE
        )
      uplift[region] = Math.min(
        requestedUplift,
        Math.max(0, MAX_OCEAN_ARC_ELEVATION - baseElevation[region]),
      )
    }
    return uplift
  }

  private hasOceanicPlateNeighbor(
    mesh: SphericalMesh,
    region: number,
    tectonics: SphericalTectonicData,
  ): boolean {
    const plate = tectonics.regionPlate[region]
    const nStart = mesh.neighborOffsets[region]
    const nEnd = mesh.neighborOffsets[region + 1]
    for (let n = nStart; n < nEnd; n++) {
      const neighbor = mesh.neighbors[n]
      const neighborPlate = tectonics.regionPlate[neighbor]
      if (
        neighborPlate !== plate
        && tectonics.plateCrustType[neighborPlate] === CRUST_TYPE.Oceanic
      ) {
        return true
      }
    }
    return false
  }

  private buildVolcanicArcs(
    mesh: SphericalMesh,
    candidateLandMask: Uint8Array,
    tectonics: SphericalTectonicData,
    fields: TectonicSpatialFields,
    seed: number,
  ): Float32Array {
    const noise = createNoise3D(alea(seed + 713))
    const candidates: Array<SphericalEdifice & { score: number }> = []
    for (let region = 0; region < mesh.numRegions; region++) {
      const plate = tectonics.regionPlate[region]
      if (
        candidateLandMask[region] === 0
        || tectonics.plateCrustType[plate] !== CRUST_TYPE.Continental
      ) {
        continue
      }
      const distance = fields.overridingDistance[region]
      const stress = fields.overridingInfluence[region]
      if (!Number.isFinite(distance) || stress < 0.04)
        continue
      const distanceWeight = this.gaussian(
        distance - VOLCANIC_ARC_DISTANCE,
        VOLCANIC_ARC_WIDTH,
      )
      const position = region * 3
      const x = mesh.regionPosition[position]
      const y = mesh.regionPosition[position + 1]
      const z = mesh.regionPosition[position + 2]
      const variation = noise(x * 9, y * 9, z * 9)
      const score = distanceWeight * stress * (0.85 + variation * 0.3)
      if (score < 0.035)
        continue
      const heightVariation = clamp(0.7 + variation * 0.6, 0.1, 1.3)
      const sigmaVariation = clamp(
        0.6 + noise(x * 5 + 17.3, y * 5 + 9.1, z * 5 + 4.7) * 0.8,
        0.15,
        1.4,
      )
      candidates.push({
        x,
        y,
        z,
        score,
        sigma: VOLCANO_SIGMA * sigmaVariation,
        height: VOLCANO_HEIGHT_BASE * (0.5 + stress) * heightVariation,
      })
    }
    candidates.sort((a, b) => b.score - a.score)

    const volcanoes: SphericalEdifice[] = []
    const maximumVolcanoes = Math.min(80, tectonics.plateSeeds.length * 4)
    for (const candidate of candidates) {
      if (volcanoes.length >= maximumVolcanoes)
        break
      if (volcanoes.some(existing => (
        this.angularDistance(candidate, existing) < VOLCANO_MIN_SPACING
      ))) {
        continue
      }
      volcanoes.push(candidate)
    }
    return this.rasterizeEdifices(mesh, volcanoes, seed + 713)
  }

  private buildHotspotsAndLips(
    mesh: SphericalMesh,
    candidateLandMask: Uint8Array,
    tectonics: SphericalTectonicData,
    seed: number,
    hotspotCount: number,
  ): { hotspot: Float32Array, largeIgneousProvince: Float32Array } {
    const random = alea(seed + 999)
    const origins: Array<readonly [number, number, number]> = []
    const domes: SphericalEdifice[] = []
    const lips: SphericalEdifice[] = []

    for (let hotspotIndex = 0; hotspotIndex < hotspotCount; hotspotIndex++) {
      const origin = this.pickHotspotOrigin(random, origins)
      origins.push(origin)
      const nearest = this.nearestRegion(mesh, origin[0], origin[1], origin[2])
      const plate = tectonics.regionPlate[nearest]
      const velocity = this.velocityAt(
        tectonics.plateAngularVelocity,
        plate,
        origin[0],
        origin[1],
        origin[2],
      )
      const speed = Math.hypot(velocity[0], velocity[1], velocity[2])
      if (speed <= Number.EPSILON)
        continue
      const drift: [number, number, number] = [
        velocity[0] / speed,
        velocity[1] / speed,
        velocity[2] / speed,
      ]
      const continental = candidateLandMask[nearest] === 1
      const initialHeight = continental
        ? 0.14 + random() * 0.08
        : 0.5 + random() * 0.18
      const initialSigma = continental
        ? 0.022 + random() * 0.01
        : 0.011 + random() * 0.006
      const decay = 0.58 + random() * 0.14
      let current: [number, number, number] = [...origin]
      let height = initialHeight

      for (let chain = 0; chain < HOTSPOT_CHAIN_LENGTH; chain++) {
        domes.push({
          x: current[0],
          y: current[1],
          z: current[2],
          sigma: initialSigma * (1 + chain * 0.05),
          height,
          swellSigma: initialSigma * (continental ? 4 : 2.5),
          swellHeight: height * 0.08,
          drift,
          stretch: 1.05,
          calderaDepth: chain === 0 ? height * (continental ? 0.3 : 0.2) : 0,
          calderaSigma: initialSigma * (continental ? 0.35 : 0.25),
          warp: 0.4,
        })
        height *= decay
        current = this.advanceAgainstDrift(
          current,
          drift,
          HOTSPOT_CHAIN_SPACING * (0.75 + random() * 0.5),
        )
      }

      lips.push({
        x: current[0],
        y: current[1],
        z: current[2],
        sigma: LIP_SIGMA * (0.75 + random() * 0.5),
        height: (continental ? 0.045 : 0.028) * (0.75 + random() * 0.5),
      })
    }

    return {
      hotspot: this.rasterizeEdifices(mesh, domes, seed + 999),
      largeIgneousProvince: this.rasterizeEdifices(mesh, lips, seed + 1999),
    }
  }

  private rasterizeEdifices(
    mesh: SphericalMesh,
    edifices: readonly SphericalEdifice[],
    seed: number,
  ): Float32Array {
    const values = new Float32Array(mesh.numRegions)
    const minimumSigma = Math.sqrt(4 * Math.PI / mesh.numRegions) * 0.65
    const shapeNoise = createNoise3D(alea(seed))
    for (let region = 0; region < mesh.numRegions; region++) {
      const position = region * 3
      const x = mesh.regionPosition[position]
      const y = mesh.regionPosition[position + 1]
      const z = mesh.regionPosition[position + 2]
      let uplift = 0
      for (const edifice of edifices) {
        const peakSigma = Math.max(edifice.sigma, minimumSigma)
        const swellSigma = edifice.swellSigma
          ? Math.max(edifice.swellSigma, minimumSigma)
          : undefined
        const rawAngle = Math.acos(clamp(
          x * edifice.x + y * edifice.y + z * edifice.z,
          -1,
          1,
        ))
        const dx = x - edifice.x
        const dy = y - edifice.y
        const dz = z - edifice.z
        const along = edifice.drift
          ? dx * edifice.drift[0] + dy * edifice.drift[1] + dz * edifice.drift[2]
          : 0
        const stretch = edifice.stretch ?? 1
        const acrossSquared = Math.max(0, rawAngle * rawAngle - along * along)
        let angle = Math.sqrt(acrossSquared + (along / stretch) ** 2)
        if (edifice.warp) {
          const broadWarp = shapeNoise(
            x * 8 + edifice.x * 17,
            y * 8 + edifice.y * 17,
            z * 8 + edifice.z * 17,
          )
          const detailWarp = shapeNoise(
            x * 20 + edifice.z * 29,
            y * 20 + edifice.x * 29,
            z * 20 + edifice.y * 29,
          )
          angle *= Math.max(0.55, 1 + edifice.warp * (broadWarp * 0.6 + detailWarp * 0.4))
        }
        if (angle > peakSigma * 5 && (!swellSigma || angle > swellSigma * 4))
          continue
        uplift += edifice.height * this.gaussian(angle, peakSigma)
        if (edifice.calderaDepth && edifice.calderaSigma) {
          uplift -= edifice.calderaDepth * this.gaussian(
            angle,
            Math.max(edifice.calderaSigma, minimumSigma * 0.35),
          )
        }
        if (swellSigma && edifice.swellHeight)
          uplift += edifice.swellHeight * this.gaussian(angle, swellSigma)
      }
      values[region] = uplift
    }
    return values
  }

  private pickHotspotOrigin(
    random: () => number,
    existing: readonly (readonly [number, number, number])[],
  ): readonly [number, number, number] {
    let best: readonly [number, number, number] = [1, 0, 0]
    let bestDistance = -Infinity
    for (let candidate = 0; candidate < 48; candidate++) {
      const longitude = random() * Math.PI * 2
      const z = random() * 2 - 1
      const radius = Math.sqrt(Math.max(0, 1 - z * z))
      const point: readonly [number, number, number] = [
        radius * Math.cos(longitude),
        radius * Math.sin(longitude),
        z,
      ]
      let minimumDistance = Math.PI
      for (const other of existing) {
        minimumDistance = Math.min(minimumDistance, this.angularDistance(
          { x: point[0], y: point[1], z: point[2] },
          { x: other[0], y: other[1], z: other[2] },
        ))
      }
      if (minimumDistance > bestDistance) {
        best = point
        bestDistance = minimumDistance
      }
      if (minimumDistance >= HOTSPOT_MIN_SPACING)
        return point
    }
    return best
  }

  private nearestRegion(mesh: SphericalMesh, x: number, y: number, z: number): number {
    let nearest = 0
    let bestDot = -Infinity
    for (let region = 0; region < mesh.numRegions; region++) {
      const position = region * 3
      const dot = x * mesh.regionPosition[position]
        + y * mesh.regionPosition[position + 1]
        + z * mesh.regionPosition[position + 2]
      if (dot > bestDot) {
        bestDot = dot
        nearest = region
      }
    }
    return nearest
  }

  private velocityAt(
    angularVelocity: Float32Array,
    plate: number,
    x: number,
    y: number,
    z: number,
  ): readonly [number, number, number] {
    const index = plate * 3
    const wx = angularVelocity[index]
    const wy = angularVelocity[index + 1]
    const wz = angularVelocity[index + 2]
    return [wy * z - wz * y, wz * x - wx * z, wx * y - wy * x]
  }

  private advanceAgainstDrift(
    point: readonly [number, number, number],
    drift: readonly [number, number, number],
    angle: number,
  ): [number, number, number] {
    const radial = drift[0] * point[0] + drift[1] * point[1] + drift[2] * point[2]
    let tx = -drift[0] + radial * point[0]
    let ty = -drift[1] + radial * point[1]
    let tz = -drift[2] + radial * point[2]
    const length = Math.hypot(tx, ty, tz) || 1
    tx /= length
    ty /= length
    tz /= length
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    return [
      point[0] * cosine + tx * sine,
      point[1] * cosine + ty * sine,
      point[2] * cosine + tz * sine,
    ]
  }

  private angularDistance(
    a: Pick<SphericalEdifice, 'x' | 'y' | 'z'>,
    b: Pick<SphericalEdifice, 'x' | 'y' | 'z'>,
  ): number {
    return Math.acos(clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1))
  }

  private fbm(
    noise: ReturnType<typeof createNoise3D>,
    x: number,
    y: number,
    z: number,
    octaves: number,
  ): number {
    let amplitude = 1
    let frequency = 1
    let value = 0
    let weight = 0
    for (let octave = 0; octave < octaves; octave++) {
      value += noise(x * frequency, y * frequency, z * frequency) * amplitude
      weight += amplitude
      amplitude *= 0.5
      frequency *= 2
    }
    return weight > 0 ? value / weight : 0
  }

  private gaussian(distance: number, sigma: number): number {
    const normalized = distance / Math.max(sigma, Number.EPSILON)
    return Math.exp(-0.5 * normalized * normalized)
  }
}
