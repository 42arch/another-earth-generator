import type { ClimateMesh } from './climate-mesh'
import type { MonthlyForcing } from './monthly-forcing'
import { createSphericalMesh } from '#mesh/spherical-mesh'
import { describe, expect, it } from 'vitest'
import { ITCZ_LONGITUDE_SAMPLES } from './climate-data'
import { DEG } from './climate-geometry'
import { climateMesh } from './climate-mesh'
import { computeMonthlyPrecipitation } from './monthly-precipitation-generator'
import { makeMonthlySpatialFields } from './monthly-spatial-fields'

function flatSubtropicalTransect(oceanAtWest: boolean) {
  const count = 6
  const latitude = 33 * DEG
  const ocean = oceanAtWest ? 0 : count - 1
  const longitudes = Float32Array.from({ length: count }, (_, r) => r * 2.5 * DEG)
  const positions = Float32Array.from(Array.from(longitudes).flatMap(longitude => [
    Math.cos(latitude) * Math.sin(longitude),
    Math.sin(latitude),
    Math.cos(latitude) * Math.cos(longitude),
  ]))
  const neighborOffsets = Uint32Array.from([0, 1, 3, 5, 7, 9, 10])
  const neighbors = Uint32Array.from([1, 0, 2, 1, 3, 2, 4, 3, 5, 4])
  const edgeOwners = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5]
  const deltas = (axis: number) => Float32Array.from(neighbors, (other, edge) =>
    positions[3 * edgeOwners[edge] + axis] - positions[3 * other + axis])
  const mesh: ClimateMesh = {
    numRegions: count,
    regionPosition: positions,
    regionLatitude: new Float32Array(count).fill(latitude),
    regionLongitude: longitudes,
    regionArea: new Float64Array(count).fill(1),
    neighborOffsets,
    neighbors,
    neighborDx: deltas(0),
    neighborDy: deltas(1),
    neighborDz: deltas(2),
    physicalRadiusKm: 6371,
  }
  const zero = new Float32Array(count)
  const coastDistanceKm = Float32Array.from(longitudes, (_, r) => 250 * Math.max(0, Math.abs(ocean - r) - 1))
  const surface = {
    regionCount: count,
    landMask: Uint8Array.from(longitudes, (_, r) => Number(r !== ocean)),
    elevationKm: zero,
  }
  const spatial = {
    coastDistanceKm,
    continentality: coastDistanceKm.map(km => km / 1500),
    westCoastInfluence: zero,
    eastMonsoonExposure: zero,
    elevationGradientEast: zero,
    elevationGradientNorth: zero,
    edgeKm: 250,
  }
  const forcing: MonthlyForcing = {
    days: 365.25 / 12,
    solarDeclination: 23.5 * DEG,
    orbitalPhase: Math.PI / 2,
    itczLatitude: new Float32Array(ITCZ_LONGITUDE_SAMPLES),
    maritimeItczLatitude: 0,
    pressureHpa: new Float32Array(count).fill(1013),
    windEast: new Float32Array(count).fill(-100),
    windNorth: zero,
    monsoonEast: zero,
    oceanEast: zero,
    oceanNorth: zero,
    oceanWarmth: zero,
  }
  return { mesh, surface, spatial, forcing, temperature: new Float32Array(count).fill(25) }
}

describe('monthly precipitation', () => {
  it('limits local land recycling when water is scarce and keeps the marine source available', () => {
    const { mesh, surface, spatial, forcing, temperature } = flatSubtropicalTransect(true)
    const noLandWater = new Float32Array(mesh.numRegions)
    const unlimited = computeMonthlyPrecipitation(mesh, surface, spatial, forcing, temperature)
    const limited = computeMonthlyPrecipitation(mesh, surface, spatial, forcing, temperature, 1, noLandWater)
    const ocean = 0
    const inland = mesh.numRegions - 1
    expect(unlimited[inland]).toBeGreaterThan(0)
    expect(limited[inland]).toBe(0)
    expect(limited[ocean]).toBe(unlimited[ocean])
  })

  it('reduces summer frontal rain at a subtropical western shore', () => {
    const { mesh, surface, spatial, forcing, temperature } = flatSubtropicalTransect(true)
    const coast = 1
    const westCoastInfluence = new Float32Array(mesh.numRegions)
    westCoastInfluence[coast] = 1
    const exposed = { ...spatial, westCoastInfluence }
    const weakWestCoastInfluence = new Float32Array(mesh.numRegions)
    weakWestCoastInfluence[coast] = 0.2
    const weaklyExposed = { ...spatial, westCoastInfluence: weakWestCoastInfluence }
    const summerControl = computeMonthlyPrecipitation(mesh, surface, spatial, forcing, temperature)
    const summerWeakCoast = computeMonthlyPrecipitation(mesh, surface, weaklyExposed, forcing, temperature)
    const summerWesternCoast = computeMonthlyPrecipitation(mesh, surface, exposed, forcing, temperature)
    expect(summerWeakCoast[coast]).toBeCloseTo(summerControl[coast])
    expect(summerWesternCoast[coast]).toBeLessThan(0.7 * summerControl[coast])

    const winter = { ...forcing, solarDeclination: -forcing.solarDeclination }
    const winterControl = computeMonthlyPrecipitation(mesh, surface, spatial, winter, temperature)
    const winterWesternCoast = computeMonthlyPrecipitation(mesh, surface, exposed, winter, temperature)
    expect(winterWesternCoast[coast]).toBeCloseTo(winterControl[coast])

    const onshoreWinter = { ...winter, windEast: new Float32Array(mesh.numRegions).fill(100) }
    const onshoreControl = computeMonthlyPrecipitation(mesh, surface, spatial, onshoreWinter, temperature, 0.2)
    const onshoreWeakCoast = computeMonthlyPrecipitation(mesh, surface, weaklyExposed, onshoreWinter, temperature, 0.2)
    const onshoreWesternCoast = computeMonthlyPrecipitation(mesh, surface, exposed, onshoreWinter, temperature, 0.2)
    expect(onshoreWeakCoast[coast]).toBeCloseTo(onshoreControl[coast])
    expect(onshoreWesternCoast[coast]).toBeGreaterThan(onshoreControl[coast])
  })

  it('accumulates weak-wind drying after landfall even near the coast', () => {
    const { mesh, surface, spatial, forcing, temperature } = flatSubtropicalTransect(false)
    const coastalLand = { ...spatial, continentality: new Float32Array(mesh.numRegions) }
    const weakerWind = { ...forcing, windEast: new Float32Array(mesh.numRegions) }
    const strong = computeMonthlyPrecipitation(mesh, surface, coastalLand, forcing, temperature)
    const weak = computeMonthlyPrecipitation(mesh, surface, coastalLand, weakerWind, temperature)
    expect(weak[4]).toBeCloseTo(strong[4])
    expect(weak[0]).toBeLessThan(strong[0])
  })

  it('dries cold land paths under weak winds while preserving first landfall', () => {
    const { mesh, surface, spatial, forcing, temperature } = flatSubtropicalTransect(false)
    const coastalLand = { ...spatial, continentality: new Float32Array(mesh.numRegions) }
    temperature.fill(-2)
    const winter = { ...forcing, solarDeclination: -forcing.solarDeclination }
    const weakerWind = { ...winter, windEast: new Float32Array(mesh.numRegions).fill(-25) }
    const strong = computeMonthlyPrecipitation(mesh, surface, coastalLand, winter, temperature)
    const weak = computeMonthlyPrecipitation(mesh, surface, coastalLand, weakerWind, temperature)
    expect(weak[4]).toBeCloseTo(strong[4])
    expect(weak[3]).toBeLessThan(strong[3])
  })

  it('carries less moisture down a lee slope than along a plateau', () => {
    const { mesh, surface, spatial, forcing, temperature } = flatSubtropicalTransect(false)
    // Hold the local rain-rate gradients flat to isolate moisture crossing the ridge.
    const ridge = { ...surface, elevationKm: Float32Array.from([0, 0, 0, 1.5, 0, 0]) }
    const plateau = { ...surface, elevationKm: Float32Array.from([0, 0, 1.5, 1.5, 0, 0]) }
    const leeRain = computeMonthlyPrecipitation(mesh, ridge, spatial, forcing, temperature)
    const plateauRain = computeMonthlyPrecipitation(mesh, plateau, spatial, forcing, temperature)
    expect(leeRain[2]).toBeLessThan(plateauRain[2])
  })

  it('moves the rain shadow to the other side of a ridge when wind reverses', () => {
    const mesh = climateMesh(createSphericalMesh({ subdivisionLevel: 4, physicalRadiusKm: 6371 }))
    const count = mesh.numRegions
    const zero = new Float32Array(count)
    const surface = {
      regionCount: count,
      landMask: Uint8Array.from(mesh.regionLongitude, longitude => Number(Math.abs(longitude) < 35 * DEG)),
      elevationKm: mesh.regionLongitude.map(longitude => 3 * Math.exp(-((longitude / (5 * DEG)) ** 2))),
    }
    const spatial = makeMonthlySpatialFields(mesh, surface)
    const temperature = new Float32Array(count).fill(25)
    const forcing: MonthlyForcing = {
      days: 365.25 / 12,
      solarDeclination: 0,
      orbitalPhase: 0,
      itczLatitude: new Float32Array(ITCZ_LONGITUDE_SAMPLES),
      maritimeItczLatitude: 0,
      pressureHpa: new Float32Array(count).fill(1013),
      windEast: new Float32Array(count).fill(100),
      windNorth: zero,
      monsoonEast: zero,
      oceanEast: zero,
      oceanNorth: zero,
      oceanWarmth: zero,
    }
    const west = mesh.regionLongitude.findIndex((longitude, r) =>
      longitude > -7 * DEG && longitude < -2 * DEG && Math.abs(mesh.regionLatitude[r]) < 4 * DEG)
    const east = mesh.regionLongitude.findIndex((longitude, r) =>
      longitude < 7 * DEG && longitude > 2 * DEG && Math.abs(mesh.regionLatitude[r]) < 4 * DEG)
    const eastward = computeMonthlyPrecipitation(mesh, surface, spatial, forcing, temperature)
    const westward = computeMonthlyPrecipitation(mesh, surface, spatial, { ...forcing, windEast: new Float32Array(count).fill(-100) }, temperature)
    expect(eastward[west]).toBeGreaterThan(eastward[east])
    expect(westward[east]).toBeGreaterThan(westward[west])
  })
})
