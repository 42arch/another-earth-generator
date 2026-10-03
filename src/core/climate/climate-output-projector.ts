import type { ClimateData, ClimateOutputProjectionData } from '@/core/climate/climate-data'
import type SphericalMesh from '@/core/mesh/mesh'
import type { GeographyData } from '@/core/simulation/state'
import { CLIMATE_MONTH_COUNT } from '@/core/climate/climate-data'
import { clamp } from '@/core/climate/climate-geometry'
import { interpolateMonthlyForcing } from '@/core/climate/monthly-forcing'
import { makeMonthlyWind } from '@/core/climate/monthly-precipitation-generator'
import { makeElevationGradients } from '@/core/climate/monthly-spatial-fields'

const SOURCE_STRIDE = 3
const WEIGHT_MAX = 65535

/** Smooth, coast-aware interpolation for continuous climate fields. */
export function buildClimateOutputProjection(
  outputMesh: SphericalMesh,
  climateMesh: SphericalMesh,
  nearest: Uint32Array,
  outputLandMask: Uint8Array,
  outputElevationKm: Float32Array,
  climateLandMask: Uint8Array,
  climateElevationKm: Float32Array,
): ClimateOutputProjectionData {
  if (climateMesh.numRegions > WEIGHT_MAX)
    throw new Error('Climate projection requires at most 65,535 source regions')
  const outputCount = outputMesh.numRegions
  if (nearest.length !== outputCount)
    throw new Error('Climate nearest-region mapping has the wrong length')
  const sourceRegion = new Uint16Array(outputCount * SOURCE_STRIDE)
  const sourceWeight = new Uint16Array(sourceRegion.length)
  for (let region = 0; region < outputCount; region++) {
    const center = nearest[region]
    const targetLand = outputLandMask[region]
    const outputIndex = 3 * region
    const x = outputMesh.regionPosition[outputIndex]
    const y = outputMesh.regionPosition[outputIndex + 1]
    const z = outputMesh.regionPosition[outputIndex + 2]
    let first = -1
    let second = -1
    let third = -1
    let firstDistance = Infinity
    let secondDistance = Infinity
    let thirdDistance = Infinity

    for (let pass = 0; pass < 2; pass++) {
      const start = climateMesh.neighborOffsets[center]
      const end = climateMesh.neighborOffsets[center + 1]
      for (let edge = start - 1; edge < end; edge++) {
        const candidate = edge < start ? center : climateMesh.neighbors[edge]
        if (pass === 0 && climateLandMask[candidate] !== targetLand)
          continue
        const index = 3 * candidate
        const dx = climateMesh.regionPosition[index] - x
        const dy = climateMesh.regionPosition[index + 1] - y
        const dz = climateMesh.regionPosition[index + 2] - z
        const distance = dx * dx + dy * dy + dz * dz
        if (distance < firstDistance) {
          third = second
          thirdDistance = secondDistance
          second = first
          secondDistance = firstDistance
          first = candidate
          firstDistance = distance
        }
        else if (distance < secondDistance) {
          third = second
          thirdDistance = secondDistance
          second = candidate
          secondDistance = distance
        }
        else if (distance < thirdDistance) {
          third = candidate
          thirdDistance = distance
        }
      }
      // Use a single surface type wherever the local climate mesh has one.
      if (first >= 0)
        break
    }
    if (first < 0)
      throw new Error('Could not find a climate projection source')
    sourceRegion[outputIndex] = first
    sourceRegion[outputIndex + 1] = second >= 0 ? second : first
    sourceRegion[outputIndex + 2] = third >= 0 ? third : first
    const inverseFirst = 1 / (Math.sqrt(firstDistance) + 0.0025)
    const inverseSecond = second >= 0 ? 1 / (Math.sqrt(secondDistance) + 0.0025) : 0
    const inverseThird = third >= 0 ? 1 / (Math.sqrt(thirdDistance) + 0.0025) : 0
    const total = inverseFirst + inverseSecond + inverseThird
    const firstWeight = Math.round(WEIGHT_MAX * inverseFirst / total)
    const secondWeight = Math.min(WEIGHT_MAX - firstWeight, Math.round(WEIGHT_MAX * inverseSecond / total))
    sourceWeight[outputIndex] = firstWeight
    sourceWeight[outputIndex + 1] = secondWeight
    sourceWeight[outputIndex + 2] = WEIGHT_MAX - firstWeight - secondWeight
  }

  const sourceGradient = makeElevationGradients(climateMesh, climateElevationKm)
  const outputGradient = makeElevationGradients(outputMesh, outputElevationKm)
  return {
    outputRegionCount: outputCount,
    climateRegionCount: climateMesh.numRegions,
    sourceRegion,
    sourceWeight,
    sourceGradientEast: sourceGradient.east,
    sourceGradientNorth: sourceGradient.north,
    outputGradientEast: outputGradient.east,
    outputGradientNorth: outputGradient.north,
    globalRainScale: new Float64Array(CLIMATE_MONTH_COUNT),
    landRainScale: new Float64Array(CLIMATE_MONTH_COUNT),
  }
}

/** Project one month; conserves area-weighted global rain after local terrain redistribution. */
export function projectClimateMonth(
  outputMesh: SphericalMesh,
  climateMesh: SphericalMesh,
  geography: GeographyData,
  climate: ClimateData,
  month: number,
  axialTiltDeg: number,
): { temperatureC: Float32Array, precipitationMm: Float32Array } {
  if (!Number.isInteger(month) || month < 0 || month >= CLIMATE_MONTH_COUNT)
    throw new RangeError(`Invalid climate month: ${month}`)
  const monthly = climate.monthly
  if (!monthly)
    throw new Error('Monthly climate has not been generated')
  if (!climate.outputProjection) {
    if (outputMesh.numRegions !== monthly.regionCount)
      throw new Error('Missing output climate projection')
    const start = month * monthly.regionCount
    const end = start + monthly.regionCount
    return {
      temperatureC: monthly.temperatureC.subarray(start, end),
      precipitationMm: monthly.precipitationMm.subarray(start, end),
    }
  }
  const projection = climate.outputProjection
  const count = outputMesh.numRegions
  if (projection.outputRegionCount !== count
    || projection.climateRegionCount !== monthly.regionCount
    || climateMesh.numRegions !== monthly.regionCount) {
    throw new Error('Output climate projection mesh sizes do not match')
  }
  const forcing = interpolateMonthlyForcing(climate.circulation, month, axialTiltDeg)
  const wind = makeMonthlyWind(climateMesh, forcing)
  const sourceOffset = month * monthly.regionCount
  const temperatureC = new Float32Array(count)
  const precipitationMm = new Float32Array(count)
  let sourceRainVolume = 0
  for (let region = 0; region < climateMesh.numRegions; region++)
    sourceRainVolume += monthly.precipitationMm[sourceOffset + region] * climateMesh.regionArea[region]

  let baselineRainVolume = 0
  let baselineLandVolume = 0
  let correctedLandVolume = 0
  for (let region = 0; region < count; region++) {
    const index = region * SOURCE_STRIDE
    let baseTemperature = 0
    let basePrecipitation = 0
    let baseElevation = 0
    let coarseGradientEast = 0
    let coarseGradientNorth = 0
    let windEast = 0
    let windNorth = 0
    for (let sample = 0; sample < SOURCE_STRIDE; sample++) {
      const source = projection.sourceRegion[index + sample]
      const weight = projection.sourceWeight[index + sample] / WEIGHT_MAX
      baseTemperature += monthly.temperatureC[sourceOffset + source] * weight
      basePrecipitation += monthly.precipitationMm[sourceOffset + source] * weight
      baseElevation += climate.surface.elevationKm[source] * weight
      coarseGradientEast += projection.sourceGradientEast[source] * weight
      coarseGradientNorth += projection.sourceGradientNorth[source] * weight
      windEast += wind.east[source] * weight
      windNorth += wind.north[source] * weight
    }
    const area = outputMesh.regionArea[region]
    baselineRainVolume += basePrecipitation * area
    if (geography.landMask[region]) {
      const lapse = 6.9 - 3.4 * clamp(basePrecipitation / (forcing.days * 6), 0, 1)
      temperatureC[region] = clamp(baseTemperature - lapse * (geography.elevation[region] - baseElevation), -90, 60)
      const fineSlope = windEast * projection.outputGradientEast[region]
        + windNorth * projection.outputGradientNorth[region]
      const coarseSlope = windEast * coarseGradientEast + windNorth * coarseGradientNorth
      const terrainFactor = Math.exp(clamp((fineSlope - coarseSlope) * 45, -1.2, 1.2))
      precipitationMm[region] = basePrecipitation * terrainFactor
      baselineLandVolume += basePrecipitation * area
      correctedLandVolume += precipitationMm[region] * area
    }
    else {
      temperatureC[region] = baseTemperature
      precipitationMm[region] = basePrecipitation
    }
  }

  const globalScale = baselineRainVolume > 0 ? sourceRainVolume / baselineRainVolume : 0
  const landScale = correctedLandVolume > 0 ? baselineLandVolume / correctedLandVolume : 1
  projection.globalRainScale[month] = globalScale
  projection.landRainScale[month] = landScale
  for (let region = 0; region < count; region++) {
    precipitationMm[region] *= globalScale * (geography.landMask[region] ? landScale : 1)
  }
  return { temperatureC, precipitationMm }
}

/** Sample final-grid climate without materializing twelve full-resolution maps. */
export function createOutputClimateRegionSampler(
  climate: ClimateData,
  geography: GeographyData,
  axialTiltDeg: number,
  climateMesh: SphericalMesh,
): (region: number, month: number, target?: { temperatureC: number, precipitationMm: number }) => { temperatureC: number, precipitationMm: number } {
  const monthly = climate.monthly
  if (!monthly)
    throw new Error('Monthly climate has not been generated')
  const outputMonthly = climate.outputMonthly
  if (outputMonthly) {
    return (region, month, target = { temperatureC: 0, precipitationMm: 0 }) => {
      const offset = month * outputMonthly.regionCount + region
      target.temperatureC = outputMonthly.temperatureC[offset]
      target.precipitationMm = outputMonthly.precipitationMm[offset]
      return target
    }
  }
  const projection = climate.outputProjection
  if (!projection)
    throw new Error('Missing output climate projection')
  const forcing = Array.from({ length: CLIMATE_MONTH_COUNT }, (_, month) =>
    interpolateMonthlyForcing(climate.circulation, month, axialTiltDeg))
  const winds = forcing.map(monthForcing => makeMonthlyWind(climateMesh, monthForcing))
  return (region, month, target = { temperatureC: 0, precipitationMm: 0 }) => {
    const index = region * SOURCE_STRIDE
    const sourceOffset = month * monthly.regionCount
    const wind = winds[month]
    let baseTemperature = 0
    let basePrecipitation = 0
    let baseElevation = 0
    let coarseGradientEast = 0
    let coarseGradientNorth = 0
    let windEast = 0
    let windNorth = 0
    for (let sample = 0; sample < SOURCE_STRIDE; sample++) {
      const source = projection.sourceRegion[index + sample]
      const weight = projection.sourceWeight[index + sample] / WEIGHT_MAX
      baseTemperature += monthly.temperatureC[sourceOffset + source] * weight
      basePrecipitation += monthly.precipitationMm[sourceOffset + source] * weight
      baseElevation += climate.surface.elevationKm[source] * weight
      coarseGradientEast += projection.sourceGradientEast[source] * weight
      coarseGradientNorth += projection.sourceGradientNorth[source] * weight
      windEast += wind.east[source] * weight
      windNorth += wind.north[source] * weight
    }
    if (!geography.landMask[region]) {
      target.temperatureC = Math.fround(baseTemperature)
      target.precipitationMm = Math.fround(Math.fround(basePrecipitation)
        * projection.globalRainScale[month])
      return target
    }
    const lapse = 6.9 - 3.4 * clamp(basePrecipitation / (forcing[month].days * 6), 0, 1)
    const fineSlope = windEast * projection.outputGradientEast[region]
      + windNorth * projection.outputGradientNorth[region]
    const coarseSlope = windEast * coarseGradientEast + windNorth * coarseGradientNorth
    const terrainFactor = Math.exp(clamp((fineSlope - coarseSlope) * 45, -1.2, 1.2))
    target.temperatureC = Math.fround(clamp(baseTemperature - lapse * (geography.elevation[region] - baseElevation), -90, 60))
    target.precipitationMm = Math.fround(Math.fround(basePrecipitation * terrainFactor)
      * (projection.globalRainScale[month] * projection.landRainScale[month]))
    return target
  }
}

/** Resolve the stored output fields or generate one month at high detail. */
export function getOutputClimateMonth(
  outputMesh: SphericalMesh,
  climateMesh: SphericalMesh,
  geography: GeographyData,
  climate: ClimateData,
  month: number,
  axialTiltDeg: number,
): { temperatureC: Float32Array, precipitationMm: Float32Array } {
  const output = climate.outputMonthly
  if (!output)
    return projectClimateMonth(outputMesh, climateMesh, geography, climate, month, axialTiltDeg)
  if (month < 0 || month >= CLIMATE_MONTH_COUNT || !Number.isInteger(month))
    throw new RangeError(`Invalid climate month: ${month}`)
  if (output.regionCount !== outputMesh.numRegions)
    throw new Error('Output climate mesh size does not match')
  const start = month * output.regionCount
  const end = start + output.regionCount
  return {
    temperatureC: output.temperatureC.subarray(start, end),
    precipitationMm: output.precipitationMm.subarray(start, end),
  }
}
