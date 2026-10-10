import type { SphericalTectonicData } from '@/core/geology/geology-data'
import type { TectonicSpatialFields } from '@/core/geology/tectonic-spatial-fields'
import type { TerrainClassificationFields } from '@/core/geology/terrain-classifier'
import type SphericalMesh from '@/core/mesh/mesh'
import alea from 'alea'
import { createNoise3D } from 'simplex-noise'
import { smoothstep } from '@/core/math/math'

const EARTH_RADIUS_KM = 6371
const NUM_KERNELS = 4000
const WAVELENGTH_KM = 55
const BANDWIDTH_KM = 180
const ORIENTATION_JITTER = 0.22
const AMPLITUDE = 0.5
const BIAS = 0.3
const STRESS_THRESHOLD = 0.02
const ELEVATION_THRESHOLD = 0.005
const ELEVATION_RAMP_RANGE = 0.08
const FOLD_BELT_FLOOR = 0.05
const SUBDUCTING_KERNEL_MAX = 0.75
const SUBDUCTING_GATE_FULL = 0.55
const SUBDUCTING_GATE_ZERO = 0.92
const DIRECTION_SMOOTHING_KM = 220
const WARP_FREQUENCY = 110
const WARP_AMPLITUDE = 0.006
const WARP_OCTAVES = 5
const LATITUDE_BINS = 36
const LONGITUDE_BINS = 72

interface PhasorKernel {
  x: number
  y: number
  z: number
  directionX: number
  directionY: number
  directionZ: number
  phase: number
}

export interface PhasorRidgeData {
  elevation: Float32Array
  contribution: Float32Array
}

/** Directional Gabor-like ridge field adapted from the reference generator. */
export class PhasorRidgeGenerator {
  generate(
    mesh: SphericalMesh,
    baseElevation: Float32Array,
    candidateLandMask: Uint8Array,
    tectonics: SphericalTectonicData,
    fields: TectonicSpatialFields,
    classification: TerrainClassificationFields,
    seed: number,
  ): PhasorRidgeData {
    const elevation = Float32Array.from(baseElevation)
    const contribution = new Float32Array(mesh.numRegions)
    const smoothedDirection = this.buildDirectionField(mesh, tectonics, fields)
    const candidates: number[] = []

    for (let region = 0; region < mesh.numRegions; region++) {
      if (
        candidateLandMask[region] === 0
        || fields.convergentInfluence[region] < STRESS_THRESHOLD
        || fields.subductingInfluence[region] > SUBDUCTING_KERNEL_MAX
      ) {
        continue
      }
      const direction = region * 3
      const lengthSquared = smoothedDirection[direction] ** 2
        + smoothedDirection[direction + 1] ** 2
        + smoothedDirection[direction + 2] ** 2
      if (lengthSquared >= 0.25)
        candidates.push(region)
    }
    if (candidates.length === 0)
      return { elevation, contribution }

    const random = alea(seed + 1313)
    this.shuffle(candidates, random)
    const kernels = this.buildKernels(
      mesh,
      smoothedDirection,
      candidates.slice(0, NUM_KERNELS),
      random,
    )
    if (kernels.length === 0)
      return { elevation, contribution }

    const grid = this.buildKernelGrid(kernels)
    const wavelength = WAVELENGTH_KM / EARTH_RADIUS_KM
    const bandwidth = BANDWIDTH_KM / EARTH_RADIUS_KM
    const frequency = 1 / wavelength
    const inverseBandwidthSquared = -0.5 / (bandwidth * bandwidth)
    const envelopeCutoffSquared = 9 * bandwidth * bandwidth
    const latitudeBinSize = Math.PI / LATITUDE_BINS
    const searchBins = Math.max(1, Math.ceil(3 * bandwidth / latitudeBinSize))
    const warpNoise = createNoise3D(alea(seed + 1717))

    for (let region = 0; region < mesh.numRegions; region++) {
      if (candidateLandMask[region] === 0 || elevation[region] < ELEVATION_THRESHOLD)
        continue
      const position = region * 3
      const x = mesh.regionPosition[position]
      const y = mesh.regionPosition[position + 1]
      const z = mesh.regionPosition[position + 2]
      const warpedX = x + this.fbm(warpNoise, x * WARP_FREQUENCY + 17.3, y * WARP_FREQUENCY + 28.4, z * WARP_FREQUENCY + 9.1, WARP_OCTAVES) * WARP_AMPLITUDE
      const warpedY = y + this.fbm(warpNoise, x * WARP_FREQUENCY + 5.2, y * WARP_FREQUENCY + 33.6, z * WARP_FREQUENCY + 22.8, WARP_OCTAVES) * WARP_AMPLITUDE
      const warpedZ = z + this.fbm(warpNoise, x * WARP_FREQUENCY + 11.7, y * WARP_FREQUENCY + 6.9, z * WARP_FREQUENCY + 41.5, WARP_OCTAVES) * WARP_AMPLITUDE
      const latitudeBin = this.latitudeBin(y)
      const longitudeBin = this.longitudeBin(x, z)
      let real = 0
      let imaginary = 0
      let envelopeSum = 0

      for (let latitudeOffset = -searchBins; latitudeOffset <= searchBins; latitudeOffset++) {
        const candidateLatitudeBin = latitudeBin + latitudeOffset
        if (candidateLatitudeBin < 0 || candidateLatitudeBin >= LATITUDE_BINS)
          continue
        for (let longitudeOffset = -searchBins; longitudeOffset <= searchBins; longitudeOffset++) {
          const candidateLongitudeBin = (
            (longitudeBin + longitudeOffset) % LONGITUDE_BINS + LONGITUDE_BINS
          ) % LONGITUDE_BINS
          const indices = grid[candidateLatitudeBin * LONGITUDE_BINS + candidateLongitudeBin]
          if (!indices)
            continue
          for (const kernelIndex of indices) {
            const kernel = kernels[kernelIndex]
            const dx = x - kernel.x
            const dy = y - kernel.y
            const dz = z - kernel.z
            const chordSquared = dx * dx + dy * dy + dz * dz
            if (chordSquared > envelopeCutoffSquared)
              continue
            const envelope = Math.exp(chordSquared * inverseBandwidthSquared)
            if (envelope < 0.01)
              continue
            const phaseCoordinate = warpedX * kernel.directionX
              + warpedY * kernel.directionY
              + warpedZ * kernel.directionZ
            const phase = Math.PI * 2 * frequency * phaseCoordinate + kernel.phase
            real += envelope * Math.cos(phase)
            imaginary += envelope * Math.sin(phase)
            envelopeSum += envelope
          }
        }
      }
      if (envelopeSum < 0.02)
        continue

      const ridge = Math.atan2(imaginary, real) / (Math.PI * 2) + BIAS
      const elevationGate = Math.min(
        1,
        (elevation[region] - ELEVATION_THRESHOLD) / ELEVATION_RAMP_RANGE,
      )
      const foldBelt = classification.foldBelt[region]
      const foldBeltMultiplier = FOLD_BELT_FLOOR + (1 - FOLD_BELT_FLOOR) * foldBelt
      const orogenicPower = classification.orogenicPower[region]
      const subductingGate = this.subductingGate(fields.subductingInfluence[region])
      const value = ridge
        * AMPLITUDE
        * elevationGate
        * foldBeltMultiplier
        * orogenicPower
        * subductingGate
      elevation[region] += value
      contribution[region] = value
    }

    return { elevation, contribution }
  }

  private buildDirectionField(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    fields: TectonicSpatialFields,
  ): Float32Array {
    let current = new Float32Array(tectonics.regionStressDirection)
    const averageEdgeKm = Math.PI * EARTH_RADIUS_KM / Math.sqrt(mesh.numRegions)
    const passes = Math.max(2, Math.round(DIRECTION_SMOOTHING_KM / averageEdgeKm))

    for (let pass = 0; pass < passes; pass++) {
      const next = new Float32Array(current)
      for (let region = 0; region < mesh.numRegions; region++) {
        if (fields.convergentInfluence[region] < STRESS_THRESHOLD)
          continue
        const index = region * 3
        const selfWeight = fields.convergentInfluence[region]
        let x = current[index] * selfWeight
        let y = current[index + 1] * selfWeight
        let z = current[index + 2] * selfWeight
        const nStart = mesh.neighborOffsets[region]
        const nEnd = mesh.neighborOffsets[region + 1]
        for (let n = nStart; n < nEnd; n++) {
          const neighbor = mesh.neighbors[n]
          const weight = fields.convergentInfluence[neighbor]
          if (weight < STRESS_THRESHOLD)
            continue
          const neighborIndex = neighbor * 3
          const neighborX = current[neighborIndex]
          const neighborY = current[neighborIndex + 1]
          const neighborZ = current[neighborIndex + 2]
          if (neighborX * neighborX + neighborY * neighborY + neighborZ * neighborZ < 1e-8)
            continue
          // Stress orientation is axial: d and -d describe the same ridge
          // direction. Flip opposing samples before averaging so the two
          // sides of a convergent boundary do not cancel each other out.
          const sign = x * x + y * y + z * z > 1e-8
            && x * neighborX + y * neighborY + z * neighborZ < 0
            ? -1
            : 1
          x += neighborX * weight * sign
          y += neighborY * weight * sign
          z += neighborZ * weight * sign
        }
        const length = Math.hypot(x, y, z)
        if (length <= 1e-6)
          continue
        next[index] = x / length
        next[index + 1] = y / length
        next[index + 2] = z / length
      }
      current = next
    }
    return current
  }

  private buildKernels(
    mesh: SphericalMesh,
    directionField: Float32Array,
    candidates: readonly number[],
    random: () => number,
  ): PhasorKernel[] {
    const kernels: PhasorKernel[] = []
    for (const region of candidates) {
      const index = region * 3
      const x = mesh.regionPosition[index]
      const y = mesh.regionPosition[index + 1]
      const z = mesh.regionPosition[index + 2]
      let directionX = directionField[index]
      let directionY = directionField[index + 1]
      let directionZ = directionField[index + 2]
      const radial = directionX * x + directionY * y + directionZ * z
      directionX -= radial * x
      directionY -= radial * y
      directionZ -= radial * z
      const directionLength = Math.hypot(directionX, directionY, directionZ)
      if (directionLength < 1e-6)
        continue
      directionX /= directionLength
      directionY /= directionLength
      directionZ /= directionLength

      const jitter = (random() - 0.5) * 2 * ORIENTATION_JITTER
      const cosine = Math.cos(jitter)
      const sine = Math.sin(jitter)
      const crossX = y * directionZ - z * directionY
      const crossY = z * directionX - x * directionZ
      const crossZ = x * directionY - y * directionX
      kernels.push({
        x,
        y,
        z,
        directionX: directionX * cosine + crossX * sine,
        directionY: directionY * cosine + crossY * sine,
        directionZ: directionZ * cosine + crossZ * sine,
        phase: random() * Math.PI * 2,
      })
    }
    return kernels
  }

  private buildKernelGrid(kernels: readonly PhasorKernel[]): Array<number[] | undefined> {
    const grid: Array<number[] | undefined> = Array.from({ length: LATITUDE_BINS * LONGITUDE_BINS })
    for (let index = 0; index < kernels.length; index++) {
      const kernel = kernels[index]
      const bin = this.latitudeBin(kernel.y) * LONGITUDE_BINS
        + this.longitudeBin(kernel.x, kernel.z)
      const cell = grid[bin] ?? []
      cell.push(index)
      grid[bin] = cell
    }
    return grid
  }

  private latitudeBin(y: number): number {
    const latitude = Math.asin(Math.max(-1, Math.min(1, y)))
    return Math.max(0, Math.min(
      LATITUDE_BINS - 1,
      Math.floor((latitude + Math.PI / 2) / Math.PI * LATITUDE_BINS),
    ))
  }

  private longitudeBin(x: number, z: number): number {
    const longitude = Math.atan2(x, z)
    return Math.max(0, Math.min(
      LONGITUDE_BINS - 1,
      Math.floor((longitude + Math.PI) / (Math.PI * 2) * LONGITUDE_BINS),
    ))
  }

  private subductingGate(value: number): number {
    if (value <= SUBDUCTING_GATE_FULL)
      return 1
    if (value >= SUBDUCTING_GATE_ZERO)
      return 0
    return 1 - smoothstep(SUBDUCTING_GATE_FULL, SUBDUCTING_GATE_ZERO, value)
  }

  private shuffle(values: number[], random: () => number): void {
    for (let index = values.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1))
      const value = values[index]
      values[index] = values[other]
      values[other] = value
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
}
