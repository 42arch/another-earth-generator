/* eslint-disable antfu/no-top-level-await -- This diagnostic runs as a standalone jiti entry point. */
import type { MonthlyForcing } from '../src/generation/nature/climate/monthly-forcing'
import type { ClimateArtifact, GeologyArtifact, SphericalMesh, TerrainArtifact } from '../src/index'
import process from 'node:process'
import { aggregateClimateSurface, solveClimateYear } from '../src/generation/nature/climate/climate'
import { climateMesh } from '../src/generation/nature/climate/climate-mesh'
import { classifyKoppenSeries } from '../src/generation/nature/climate/koppen-classifier'
import { interpolateMonthlyForcing } from '../src/generation/nature/climate/monthly-forcing'
import { makeMonthlySpatialFields } from '../src/generation/nature/climate/monthly-spatial-fields'
import { createClimatePipeline, DEFAULT_CLIMATE_PARAMETERS, DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS, KOPPEN_CODES } from '../src/index'

const seed = process.argv[2] ?? '1024'
const config = {
  planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
  mesh: { subdivisionLevel: Number(process.argv[3] ?? 7), irregularity: 0.75 },
  geology: { ...DEFAULT_GEOLOGY_PARAMETERS },
  landforms: { ...DEFAULT_LANDFORM_PARAMETERS },
  terrain: { ...DEFAULT_TERRAIN_PARAMETERS },
  climate: { ...DEFAULT_CLIMATE_PARAMETERS, axialTiltDegrees: 23.5, precipitationScale: 1.8 },
}
const result = await createClimatePipeline().execute({ seed, config })
const output = result.getOutput<SphericalMesh>('mesh')
const reference = result.getOutput<SphericalMesh>('reference-mesh')
const terrain = result.getOutput<TerrainArtifact>('terrain')
const geology = result.getOutput<GeologyArtifact>('geology')
const climate = result.getOutput<ClimateArtifact>('climate-c0')
const surface = { ...aggregateClimateSurface(output, reference, terrain, geology.geographicReference), regionCount: reference.regionCount }
const mesh = climateMesh(reference)
const spatial = makeMonthlySpatialFields(mesh, surface)
const forcing = Array.from({ length: 12 }, (_, m) =>
  interpolateMonthlyForcing(climate.circulation, m, config.climate.axialTiltDegrees, config.climate.orbitalPeriodDays))
const meanItcz = forcing[0].itczLatitude.map((_, longitude) =>
  forcing.reduce((sum, month) => sum + month.itczLatitude[longitude] / 12, 0))
const meanMaritimeItcz = forcing.reduce((sum, month) => sum + month.maritimeItczLatitude / 12, 0)
const zero = new Float32Array(reference.regionCount)
const baseline = solveClimateYear(mesh, surface, spatial, month => forcing[month], config.climate)

const cases = {
  baseline: (f: MonthlyForcing) => f,
  withoutPressureDrivenWind: (f: MonthlyForcing) => ({ ...f, windEast: zero, windNorth: zero }),
  withoutCoastalMonsoon: (f: MonthlyForcing) => ({ ...f, monsoonEast: zero }),
  fixedItcz: (f: MonthlyForcing) => ({ ...f, itczLatitude: meanItcz, maritimeItczLatitude: meanMaritimeItcz }),
  withoutCurrentSpeed: (f: MonthlyForcing) => ({ ...f, oceanEast: zero, oceanNorth: zero }),
  withoutOceanWarmth: (f: MonthlyForcing) => ({ ...f, oceanWarmth: zero }),
}

function summarize(result: typeof baseline) {
  const aggregates = { land: empty(), ocean: empty() }
  const koppen = new Float64Array(KOPPEN_CODES.length)
  const temperature = new Float32Array(12)
  const precipitation = new Float32Array(12)
  for (let r = 0; r < reference.regionCount; r++) {
    const land = surface.landMask[r] === 1
    const group = aggregates[land ? 'land' : 'ocean']
    const area = reference.areaKm2[r]
    group.area += area
    for (let m = 0; m < 12; m++) {
      const index = m * reference.regionCount + r
      temperature[m] = result.temperatureC[index]
      precipitation[m] = result.precipitationMm[index]
      group.annualMeanTemperatureC += area * temperature[m] / 12
      group.annualPrecipitationMm += area * precipitation[m]
      group.absoluteMonthlyTemperatureDeltaC += area * Math.abs(temperature[m] - baseline.temperatureC[index]) / 12
      group.absoluteMonthlyPrecipitationDeltaMm += area * Math.abs(precipitation[m] - baseline.precipitationMm[index]) / 12
    }
    group.minimumDriestMonthMm = Math.min(group.minimumDriestMonthMm, ...precipitation)
    if (land)
      koppen[classifyKoppenSeries(temperature, precipitation, reference.centers[r * 3 + 1] < 0)] += area
  }
  return {
    land: normalize(aggregates.land),
    ocean: normalize(aggregates.ocean),
    landKoppenShares: Object.fromEntries(KOPPEN_CODES.slice(1).map((code, i) => [code, koppen[i + 1] / aggregates.land.area])),
  }
}

function empty() {
  return { area: 0, annualMeanTemperatureC: 0, annualPrecipitationMm: 0, absoluteMonthlyTemperatureDeltaC: 0, absoluteMonthlyPrecipitationDeltaMm: 0, minimumDriestMonthMm: Infinity }
}

function normalize(group: ReturnType<typeof empty>) {
  const { area, minimumDriestMonthMm, ...sums } = group
  return { areaKm2: area, minimumDriestMonthMm, ...Object.fromEntries(Object.entries(sums).map(([key, sum]) => [key, sum / area])) }
}

process.stdout.write(`${JSON.stringify({
  seed,
  config,
  climateVersion: climate.algorithmVersion,
  scope: 'Reference mesh annual solve with monthly output. Each case replaces one forcing while all other forcing and terrain remain fixed.',
  cases: Object.fromEntries(Object.entries(cases).map(([name, transform]) => {
    const solved = name === 'baseline'
      ? baseline
      : solveClimateYear(mesh, surface, spatial, month => transform(forcing[month]), config.climate)
    return [name, summarize(solved)]
  })),
}, null, 2)}\n`)
