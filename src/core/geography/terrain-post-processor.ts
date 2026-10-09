import type { TerrainErosionFields } from '@/core/geography/terrain-erosion-processor'
import type { TerrainFinalizationFields } from '@/core/geography/terrain-finalizer'
import type { TerrainTextureFields } from '@/core/geography/terrain-texture-generator'
import type { TectonicSpatialFields } from '@/core/geology/tectonic-spatial-fields'
import type { TerrainClassificationFields } from '@/core/geology/terrain-classifier'
import type SphericalMesh from '@/core/mesh/mesh'
import alea from 'alea'
import { createNoise3D } from 'simplex-noise'
import {
  normalizedElevationArrayToKm,
  normalizedElevationDeltaArrayToKm,
} from '@/core/geography/elevation-units'
import { TerrainErosionProcessor } from '@/core/geography/terrain-erosion-processor'
import { TerrainFinalizer } from '@/core/geography/terrain-finalizer'
import { TerrainTextureGenerator } from '@/core/geography/terrain-texture-generator'
import { REFERENCE_REGION_LEVEL } from '@/core/mesh/reference-grid-projector'

export interface TerrainPostProcessData {
  elevation: Float32Array
  landMask: Uint8Array
  terrainNoise: Float32Array
  texture: TerrainTextureFields
  finalization: TerrainFinalizationFields
  erosion: TerrainErosionFields
}

const WARP_FREQUENCY = 4
const WARP_OCTAVES = 5
const WARP_MAX_AMPLITUDE = 0.13
const WARP_BIAS_BASE = 0.25
const WARP_BIAS_SCALE = 0.5
const WARP_HOTSPOT_DAMPEN = 0.8
const SMOOTH_EDGE_SENSITIVITY = 12
const SHORELINE_LAND_RELIEF_LIMIT = 0.12
const SHORELINE_OCEAN_DEPTH_LIMIT = 0.025
const SHORELINE_EDIFICE_PROTECTION = 0.025
/** About half a reference-grid cell on the unit sphere. */
const SHORELINE_MAX_FRAGMENT_AREA = 2 * Math.PI / (10 * 4 ** REFERENCE_REGION_LEVEL + 2)
const DETAIL_NOISE_AMPLITUDE_KM = 0.1
const DETAIL_NOISE_FREQUENCY = 5
const DETAIL_NOISE_OCTAVES = 6
const DETAIL_NOISE_WARP_FREQUENCY = 3
const DETAIL_NOISE_WARP_AMPLITUDE = 0.08
const DETAIL_NOISE_WARP_OCTAVES = 3
const DETAIL_NOISE_DAMPEN_STRENGTH = 0.5
const RIDGE_SHARPEN_CAP = 2
const VALLEY_DEEPEN_FACTOR = 0.5
const VALLEY_FLOOR_FRACTION = 0.5
const VALLEY_FLOOR_MINIMUM = 0.001

interface DetailNoiseOptions {
  amplitudeKm?: number
  frequencyMultiplier?: number
  warpAmplitudeMultiplier?: number
  bipolar?: boolean
  biasExponent?: number
  seedOffset?: number
}

/** Applies scale-separated terrain texture and conservative spherical smoothing. */
export class TerrainPostProcessor {
  private readonly textureGenerator = new TerrainTextureGenerator()
  private readonly finalizer = new TerrainFinalizer()
  private readonly erosionProcessor = new TerrainErosionProcessor()

  generate(
    mesh: SphericalMesh,
    baseElevation: Float32Array,
    candidateLandMask: Uint8Array,
    spatialFields: TectonicSpatialFields,
    classification: TerrainClassificationFields,
    seed: number,
    islandDensity: number,
    roughness: number,
    terrainWarp: number,
    smoothing: number,
    glacialErosion: number,
    hydraulicErosion: number,
    ridgeSharpening: number,
    dynamicTopography?: Float32Array,
    phasorRidge?: Float32Array,
    hotspot?: Float32Array,
    edifices?: Float32Array,
    deferDrainage = false,
  ): TerrainPostProcessData {
    console.time('textureGenerator.generate')
    const textured = this.textureGenerator.generate(
      mesh,
      baseElevation,
      candidateLandMask,
      spatialFields,
      classification,
      seed,
      islandDensity,
      roughness,
      phasorRidge,
    )
    if (dynamicTopography?.length === mesh.numRegions) {
      for (let region = 0; region < mesh.numRegions; region++)
        textured.elevation[region] += dynamicTopography[region]
    }
    console.timeEnd('textureGenerator.generate')
    
    console.time('finalizer.generate')
    const finalized = this.finalizer.generate(mesh, textured.elevation, candidateLandMask)
    const elevation = Float32Array.from(finalized.elevation)
    console.timeEnd('finalizer.generate')
    
    console.time('warpTerrain')
    this.warpTerrain(mesh, elevation, seed, terrainWarp, hotspot)
    console.timeEnd('warpTerrain')
    
    const beforePostProcess = Float32Array.from(elevation)
    console.time('regularizeShoreline')
    this.regularizeShoreline(mesh, elevation, candidateLandMask, edifices)
    console.timeEnd('regularizeShoreline')
    
    // Freeze the stabilized shoreline for later erosion and land-only detail.
    const oceanMask = this.buildOceanMask(elevation)
    
    console.time('smooth')
    if (smoothing > 0) {
      const iterations = Math.round(1 + smoothing * 4)
      const strength = 0.2 + smoothing * 0.5
      this.smooth(mesh, elevation, oceanMask, iterations, strength)
    }
    console.timeEnd('smooth')
    
    const beforeDetail = Float32Array.from(elevation)
    console.time('applyDetailNoise')
    this.applyDetailNoise(mesh, elevation, oceanMask, classification, seed)
    this.applyDetailNoise(mesh, elevation, oceanMask, classification, seed, {
      amplitudeKm: 0.05,
      frequencyMultiplier: 2,
      warpAmplitudeMultiplier: 2,
      bipolar: true,
      biasExponent: 0.4,
      seedOffset: 13579,
    })
    console.timeEnd('applyDetailNoise')
    
    for (let region = 0; region < mesh.numRegions; region++) {
      const detailDelta = elevation[region] - beforeDetail[region]
      textured.texture.postDetail[region] = detailDelta
      textured.texture.total[region] += detailDelta
    }
    
    console.time('erosionProcessor.generate')
    const erosion = this.erosionProcessor.generate(mesh, elevation, oceanMask, {
      glacial: glacialErosion,
      hydraulic: hydraulicErosion,
      drainageDiagnostics: false,
    })
    console.timeEnd('erosionProcessor.generate')
    
    const sharpening = Math.max(0, Math.min(1, ridgeSharpening))
    console.time('sharpenRidges')
    if (sharpening > 0) {
      this.sharpenRidges(
        mesh,
        elevation,
        oceanMask,
        Math.round(1 + sharpening * 3),
        sharpening * 0.08,
      )
    }
    console.timeEnd('sharpenRidges')
    
    console.time('applySoilCreep')
    this.applySoilCreep(mesh, elevation, oceanMask, 3, 0.1125)
    console.timeEnd('applySoilCreep')
    
    console.time('rebuildDrainage')
    if (!deferDrainage)
      this.erosionProcessor.rebuildDrainage(mesh, elevation, oceanMask, erosion)
    console.timeEnd('rebuildDrainage')
    const landMask = new Uint8Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      landMask[region] = elevation[region] > 0 ? 1 : 0
      finalized.fields.postProcessDelta[region] = elevation[region] - beforePostProcess[region]
    }

    const physicalTexture = this.textureFieldsToKm(textured.texture)
    return {
      elevation: normalizedElevationArrayToKm(elevation),
      landMask,
      terrainNoise: physicalTexture.total,
      texture: physicalTexture,
      finalization: this.finalizationFieldsToKm(finalized.fields),
      erosion: this.erosionFieldsToKm(erosion),
    }
  }

  private textureFieldsToKm(fields: TerrainTextureFields): TerrainTextureFields {
    return {
      phasorRidge: normalizedElevationDeltaArrayToKm(fields.phasorRidge),
      tectonicBand: normalizedElevationDeltaArrayToKm(fields.tectonicBand),
      detail: normalizedElevationDeltaArrayToKm(fields.detail),
      coastal: normalizedElevationDeltaArrayToKm(fields.coastal),
      uniformLand: normalizedElevationDeltaArrayToKm(fields.uniformLand),
      postDetail: normalizedElevationDeltaArrayToKm(fields.postDetail),
      total: normalizedElevationDeltaArrayToKm(fields.total),
    }
  }

  private finalizationFieldsToKm(
    fields: TerrainFinalizationFields,
  ): TerrainFinalizationFields {
    return {
      shapingDelta: normalizedElevationDeltaArrayToKm(fields.shapingDelta),
      topologyDelta: normalizedElevationDeltaArrayToKm(fields.topologyDelta),
      topologyChanged: fields.topologyChanged,
      postProcessDelta: normalizedElevationDeltaArrayToKm(fields.postProcessDelta),
    }
  }

  private erosionFieldsToKm(fields: TerrainErosionFields): TerrainErosionFields {
    return {
      flowReceiver: fields.flowReceiver,
      flowAccumulation: fields.flowAccumulation,
      glacialIndex: fields.glacialIndex,
      erosionDelta: normalizedElevationDeltaArrayToKm(fields.erosionDelta),
      depositionDelta: normalizedElevationDeltaArrayToKm(fields.depositionDelta),
    }
  }

  private warpTerrain(
    mesh: SphericalMesh,
    elevation: Float32Array,
    seed: number,
    strength: number,
    hotspot?: Float32Array,
  ): void {
    const warpStrength = Math.max(0, Math.min(1, strength))
    if (warpStrength <= 0)
      return
    const noise = createNoise3D(alea(seed + 9999))
    const maximumAmplitude = WARP_MAX_AMPLITUDE * warpStrength
    const warpedElevation = Float32Array.from(elevation)
    const shoreline = new Uint8Array(mesh.numRegions)
    const neighborOffsets = mesh.neighborOffsets
    const neighbors = mesh.neighbors
    for (let region = 0; region < mesh.numRegions; region++) {
      const land = elevation[region] > 0
      const start = neighborOffsets[region]
      const end = neighborOffsets[region + 1]
      for (let n = start; n < end; n++) {
        const neighbor = neighbors[n]
        if ((elevation[neighbor] > 0) !== land) {
          shoreline[region] = 1
          break
        }
      }
    }

    for (let region = 0; region < mesh.numRegions; region++) {
      const index = region * 3
      const x = mesh.regionPosition[index]
      const y = mesh.regionPosition[index + 1]
      const z = mesh.regionPosition[index + 2]
      let eastX = z
      const eastY = 0
      let eastZ = -x
      const eastLength = Math.hypot(eastX, eastZ)
      if (eastLength > 1e-10) {
        eastX /= eastLength
        eastZ /= eastLength
      }
      else {
        eastX = 1
        eastZ = 0
      }
      let northX = y * eastZ
      let northY = z * eastX - x * eastZ
      let northZ = -y * eastX
      const northLength = Math.hypot(northX, northY, northZ) || 1
      northX /= northLength
      northY /= northLength
      northZ /= northLength

      const frequencyX = x * WARP_FREQUENCY
      const frequencyY = y * WARP_FREQUENCY
      const frequencyZ = z * WARP_FREQUENCY
      const displacementEast = this.fbm(
        noise,
        frequencyX,
        frequencyY,
        frequencyZ,
        WARP_OCTAVES,
        2 / 3,
      ) * maximumAmplitude
      const displacementNorth = this.fbm(
        noise,
        frequencyX + 31.7,
        frequencyY + 47.3,
        frequencyZ + 19.1,
        WARP_OCTAVES,
        2 / 3,
      ) * maximumAmplitude
      let targetX = x + eastX * displacementEast + northX * displacementNorth
      let targetY = y + eastY * displacementEast + northY * displacementNorth
      let targetZ = z + eastZ * displacementEast + northZ * displacementNorth
      const targetLength = Math.hypot(targetX, targetY, targetZ) || 1
      targetX /= targetLength
      targetY /= targetLength
      targetZ /= targetLength

      let nearest = region
      let bestDot = targetX * x + targetY * y + targetZ * z
      while (true) {
        let nextRegion = nearest
        const nStart = mesh.neighborOffsets[nearest]
        const nEnd = mesh.neighborOffsets[nearest + 1]
        for (let n = nStart; n < nEnd; n++) {
          const neighbor = mesh.neighbors[n]
          const neighborIndex = neighbor * 3
          const dot = targetX * mesh.regionPosition[neighborIndex]
            + targetY * mesh.regionPosition[neighborIndex + 1]
            + targetZ * mesh.regionPosition[neighborIndex + 2]
          if (dot > bestDot) {
            bestDot = dot
            nextRegion = neighbor
          }
        }
        if (nextRegion === nearest)
          break
        nearest = nextRegion
      }
      warpedElevation[region] = shoreline[nearest]
        ? this.sampleShorelineElevation(mesh, elevation, nearest, targetX, targetY, targetZ)
        : elevation[nearest]
    }

    const warpBias = WARP_BIAS_BASE + WARP_BIAS_SCALE * warpStrength
    for (let region = 0; region < mesh.numRegions; region++) {
      const original = elevation[region]
      const warped = warpedElevation[region]
      let bias = warpBias
      if (hotspot) {
        const fraction = Math.min(1, Math.abs(hotspot[region]) / (Math.abs(original) || 1))
        bias *= 1 - WARP_HOTSPOT_DAMPEN * fraction
      }
      elevation[region] = warped > original
        ? original + (warped - original) * bias
        : warped + (original - warped) * (1 - bias)
    }
  }

  private sampleShorelineElevation(
    mesh: SphericalMesh,
    elevation: Float32Array,
    nearest: number,
    x: number,
    y: number,
    z: number,
  ): number {
    const weightFloor = mesh.regionArea[nearest] * 0.02
    const weighted = (region: number): number => {
      const index = region * 3
      const dx = x - mesh.regionPosition[index]
      const dy = y - mesh.regionPosition[index + 1]
      const dz = z - mesh.regionPosition[index + 2]
      return 1 / (dx * dx + dy * dy + dz * dz + weightFloor)
    }
    let weightSum = weighted(nearest)
    let elevationSum = elevation[nearest] * weightSum
    const nStart = mesh.neighborOffsets[nearest]
    const nEnd = mesh.neighborOffsets[nearest + 1]
    for (let n = nStart; n < nEnd; n++) {
      const neighbor = mesh.neighbors[n]
      const weight = weighted(neighbor)
      weightSum += weight
      elevationSum += elevation[neighbor] * weight
    }
    return elevationSum / weightSum
  }

  /** Removes shallow one-cell coast speckles without flattening raised islands. */
  private regularizeShoreline(
    mesh: SphericalMesh,
    elevation: Float32Array,
    candidateLandMask: Uint8Array,
    edifices?: Float32Array,
  ): void {
    const next = Float32Array.from(elevation)
    for (let pass = 0; pass < 2; pass++) {
      for (let region = 0; region < mesh.numRegions; region++) {
        const current = elevation[region]
        if (edifices && edifices[region] > SHORELINE_EDIFICE_PROTECTION)
          continue
        if (current > SHORELINE_LAND_RELIEF_LIMIT || current < -SHORELINE_OCEAN_DEPTH_LIMIT)
          continue

        let landNeighbors = 0
        let oceanNeighbors = 0
        let landElevation = 0
        let oceanElevation = 0
        const nStart = mesh.neighborOffsets[region]
        const nEnd = mesh.neighborOffsets[region + 1]
        for (let n = nStart; n < nEnd; n++) {
          const neighbor = mesh.neighbors[n]
          const value = elevation[neighbor]
          if (value > 0) {
            landNeighbors++
            landElevation += value
          }
          else {
            oceanNeighbors++
            oceanElevation += value
          }
        }
        const smallFragment = mesh.regionArea[region] <= SHORELINE_MAX_FRAGMENT_AREA
        if (current > 0 && landNeighbors <= 1 && oceanNeighbors >= 4
          && (candidateLandMask[region] === 0 || smallFragment)) {
          next[region] = Math.min(-0.002, oceanElevation / oceanNeighbors * 0.25)
        }
        else if (current <= 0 && smallFragment && candidateLandMask[region] === 1
          && oceanNeighbors <= 1 && landNeighbors >= 4) {
          next[region] = Math.max(0.002, landElevation / landNeighbors * 0.25)
        }
      }
      elevation.set(next)
    }
  }

  private buildOceanMask(elevation: Float32Array): Uint8Array {
    const oceanMask = new Uint8Array(elevation.length)
    for (let region = 0; region < elevation.length; region++)
      oceanMask[region] = elevation[region] <= 0 ? 1 : 0
    return oceanMask
  }

  private smooth(
    mesh: SphericalMesh,
    elevation: Float32Array,
    oceanMask: Uint8Array,
    iterations: number,
    strength: number,
  ): void {
    const locked = new Uint8Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (oceanMask[region] !== 0) {
        if (elevation[region] > 0)
          locked[region] = 1
        continue
      }
      const nStart = mesh.neighborOffsets[region]
      const nEnd = mesh.neighborOffsets[region + 1]
      for (let n = nStart; n < nEnd; n++) {
        const neighbor = mesh.neighbors[n]
        if (oceanMask[neighbor] !== 0) {
          locked[region] = 1
          break
        }
      }
    }
    const next = new Float32Array(mesh.numRegions)
    for (let iteration = 0; iteration < iterations; iteration++) {
      for (let region = 0; region < mesh.numRegions; region++) {
        if (locked[region] !== 0) {
          next[region] = elevation[region]
          continue
        }
        const current = elevation[region]
        let weightSum = 0
        let elevationSum = 0
        const nStart = mesh.neighborOffsets[region]
        const nEnd = mesh.neighborOffsets[region + 1]
        for (let n = nStart; n < nEnd; n++) {
          const neighbor = mesh.neighbors[n]
          const neighborElevation = elevation[neighbor]
          const weight = 1 / (
            1 + Math.abs(neighborElevation - current) * SMOOTH_EDGE_SENSITIVITY
          )
          weightSum += weight
          elevationSum += neighborElevation * weight
        }
        next[region] = weightSum > 0
          ? current + (elevationSum / weightSum - current) * strength
          : current
      }
      elevation.set(next)
    }
  }

  private applyDetailNoise(
    mesh: SphericalMesh,
    elevation: Float32Array,
    oceanMask: Uint8Array,
    classification: TerrainClassificationFields,
    seed: number,
    options: DetailNoiseOptions = {},
  ): void {
    const amplitudeKm = options.amplitudeKm ?? DETAIL_NOISE_AMPLITUDE_KM
    const frequencyMultiplier = options.frequencyMultiplier ?? 1
    const warpAmplitudeMultiplier = options.warpAmplitudeMultiplier ?? 1
    const bipolar = options.bipolar ?? false
    const biasExponent = options.biasExponent ?? 1
    const seedOffset = options.seedOffset ?? 31337
    const noise = createNoise3D(alea(seed + seedOffset))
    const warpFrequency = DETAIL_NOISE_WARP_FREQUENCY * frequencyMultiplier
    const warpAmplitude = DETAIL_NOISE_WARP_AMPLITUDE * warpAmplitudeMultiplier
    const detailFrequency = DETAIL_NOISE_FREQUENCY * frequencyMultiplier

    for (let region = 0; region < mesh.numRegions; region++) {
      if (oceanMask[region] !== 0)
        continue
      const currentElevation = elevation[region]
      if (currentElevation <= 0 || currentElevation >= 0.99)
        continue
      const index = region * 3
      const x = mesh.regionPosition[index]
      const y = mesh.regionPosition[index + 1]
      const z = mesh.regionPosition[index + 2]
      const dx = this.fbm(
        noise,
        x * warpFrequency + 1.7,
        y * warpFrequency + 9.2,
        z * warpFrequency + 4.5,
        DETAIL_NOISE_WARP_OCTAVES,
        2 / 3,
      ) * warpAmplitude
      const dy = this.fbm(
        noise,
        x * warpFrequency - 5.1,
        y * warpFrequency + 2.8,
        z * warpFrequency - 7.3,
        DETAIL_NOISE_WARP_OCTAVES,
        2 / 3,
      ) * warpAmplitude
      const dz = this.fbm(
        noise,
        x * warpFrequency + 6.6,
        y * warpFrequency - 8.4,
        z * warpFrequency + 3.1,
        DETAIL_NOISE_WARP_OCTAVES,
        2 / 3,
      ) * warpAmplitude
      const rawNoise = Math.max(-1, Math.min(1, this.fbm(
        noise,
        (x + dx) * detailFrequency,
        (y + dy) * detailFrequency,
        (z + dz) * detailFrequency,
        DETAIL_NOISE_OCTAVES,
        2 / 3,
      )))
      const mapped = bipolar
        ? Math.sign(rawNoise) * Math.abs(rawNoise) ** biasExponent
        : Math.max(0, rawNoise * 0.5 + 0.5)
      const quietZone = Math.max(
        classification.craton[region],
        classification.basin[region],
      )
      const dampening = 1 - DETAIL_NOISE_DAMPEN_STRENGTH * quietZone
      const orogenicAmplitude = classification.orogenicPower[region]
      const deltaKm = mapped * amplitudeKm * dampening * orogenicAmplitude
      if (Math.abs(deltaKm) < 1e-9)
        continue
      elevation[region] = this.elevationFromHeightKm(
        Math.max(1e-4, this.heightKm(currentElevation) + deltaKm),
        currentElevation,
      )
    }
  }

  private sharpenRidges(
    mesh: SphericalMesh,
    elevation: Float32Array,
    oceanMask: Uint8Array,
    iterations: number,
    strength: number,
  ): void {
    const landRegions: number[] = []
    for (let region = 0; region < mesh.numRegions; region++) {
      if (oceanMask[region] === 0)
        landRegions.push(region)
    }
    const next = new Float32Array(mesh.numRegions)
    const original = Float32Array.from(elevation)
    for (let iteration = 0; iteration < iterations; iteration++) {
      for (const region of landRegions) {
        const current = elevation[region]
        let sum = 0
        let count = 0
        const nStart = mesh.neighborOffsets[region]
        const nEnd = mesh.neighborOffsets[region + 1]
        for (let n = nStart; n < nEnd; n++) {
          const neighbor = mesh.neighbors[n]
          sum += elevation[neighbor]
          count++
        }
        if (count === 0) {
          next[region] = current
          continue
        }
        const average = sum / count
        if (current > average) {
          next[region] = Math.min(
            current + (current - average) * strength,
            original[region] * RIDGE_SHARPEN_CAP,
          )
        }
        else if (current < average) {
          let value = current - (average - current) * strength * VALLEY_DEEPEN_FACTOR
          if (original[region] > 0)
            value = Math.max(value, original[region] * VALLEY_FLOOR_FRACTION, VALLEY_FLOOR_MINIMUM)
          next[region] = value
        }
        else {
          next[region] = current
        }
      }
      for (const region of landRegions)
        elevation[region] = next[region]
    }
  }

  private applySoilCreep(
    mesh: SphericalMesh,
    elevation: Float32Array,
    oceanMask: Uint8Array,
    iterations: number,
    strength: number,
  ): void {
    const interiorLand: number[] = []
    for (let region = 0; region < mesh.numRegions; region++) {
      if (oceanMask[region] !== 0)
        continue
      let coastal = false
      const nStart = mesh.neighborOffsets[region]
      const nEnd = mesh.neighborOffsets[region + 1]
      for (let n = nStart; n < nEnd; n++) {
        const neighbor = mesh.neighbors[n]
        if (oceanMask[neighbor] !== 0) {
          coastal = true
          break
        }
      }
      if (!coastal)
        interiorLand.push(region)
    }
    const next = new Float32Array(mesh.numRegions)
    for (let iteration = 0; iteration < iterations; iteration++) {
      for (const region of interiorLand) {
        let sum = 0
        let count = 0
        const nStart = mesh.neighborOffsets[region]
        const nEnd = mesh.neighborOffsets[region + 1]
        for (let n = nStart; n < nEnd; n++) {
          const neighbor = mesh.neighbors[n]
          if (oceanMask[neighbor] !== 0)
            continue
          sum += elevation[neighbor]
          count++
        }
        next[region] = count > 0
          ? elevation[region] + (sum / count - elevation[region]) * strength
          : elevation[region]
      }
      for (const region of interiorLand)
        elevation[region] = next[region]
    }
  }

  private heightKm(elevation: number): number {
    const squared = elevation * elevation
    return 6 * squared * squared * (5 - 4 * elevation)
  }

  private elevationFromHeightKm(heightKm: number, initialElevation: number): number {
    let elevation = Math.max(initialElevation, (heightKm / 30) ** 0.25)
    elevation = Math.min(0.999, elevation)
    for (let iteration = 0; iteration < 5; iteration++) {
      const squared = elevation * elevation
      const cubed = squared * elevation
      const fourth = cubed * elevation
      const value = 6 * fourth * (5 - 4 * elevation) - heightKm
      const derivative = 120 * cubed * (1 - elevation)
      if (derivative < 1e-6)
        break
      const delta = value / derivative
      elevation = Math.max(1e-4, Math.min(0.9999, elevation - delta))
      if (Math.abs(delta) < 1e-6)
        break
    }
    return elevation
  }

  private fbm(
    noise: ReturnType<typeof createNoise3D>,
    x: number,
    y: number,
    z: number,
    octaves: number,
    persistence: number,
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
}
