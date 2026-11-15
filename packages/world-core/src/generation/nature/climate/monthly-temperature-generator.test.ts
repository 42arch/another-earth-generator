import type { MonthlyForcing } from './monthly-forcing'
import type { MonthlySpatialFields } from './monthly-spatial-fields'
import { createSphericalMesh } from '#mesh/spherical-mesh'
import { describe, expect, it } from 'vitest'
import { climateMesh } from './climate-mesh'
import { computeMonthlyTemperature } from './monthly-temperature-generator'

describe('monthly temperature', () => {
  it('increases the eastern midlatitude seasonal range while preserving the annual midpoint', () => {
    const mesh = climateMesh(createSphericalMesh({ subdivisionLevel: 3, physicalRadiusKm: 6371 }))
    const n = mesh.numRegions
    const zero = new Float32Array(n)
    const land = { regionCount: n, landMask: new Uint8Array(n).fill(1), elevationKm: zero }
    const easternRegion = mesh.regionLatitude.reduce((best, latitude, r) =>
      Math.abs(latitude * 180 / Math.PI - 45) < Math.abs(mesh.regionLatitude[best] * 180 / Math.PI - 45) ? r : best, 0)
    const easternExposure = new Float32Array(n)
    easternExposure[easternRegion] = 1
    const partialExposure = new Float32Array(n)
    partialExposure[easternRegion] = 0.5
    const spatial: MonthlySpatialFields = {
      coastDistanceKm: zero,
      continentality: zero,
      westCoastInfluence: zero,
      eastMonsoonExposure: zero,
      elevationGradientEast: zero,
      elevationGradientNorth: zero,
      edgeKm: 200,
    }
    const eastern = { ...spatial, eastMonsoonExposure: easternExposure }
    const partialEastern = { ...spatial, eastMonsoonExposure: partialExposure }
    const western = { ...eastern, westCoastInfluence: easternExposure }
    const westernControl = { ...spatial, westCoastInfluence: easternExposure }
    const summer: MonthlyForcing = {
      days: 365.25 / 12,
      solarDeclination: 0,
      orbitalPhase: Math.PI / 2 + 0.35,
      itczLatitude: new Float32Array(72),
      maritimeItczLatitude: 0,
      pressureHpa: zero,
      windEast: zero,
      windNorth: zero,
      monsoonEast: zero,
      oceanEast: zero,
      oceanNorth: zero,
      oceanWarmth: zero,
    }
    const winter = { ...summer, orbitalPhase: summer.orbitalPhase + Math.PI }
    const controlSummer = computeMonthlyTemperature(mesh, land, spatial, summer)[easternRegion]
    const controlWinter = computeMonthlyTemperature(mesh, land, spatial, winter)[easternRegion]
    const easternSummer = computeMonthlyTemperature(mesh, land, eastern, summer)[easternRegion]
    const easternWinter = computeMonthlyTemperature(mesh, land, eastern, winter)[easternRegion]
    const partialSummer = computeMonthlyTemperature(mesh, land, partialEastern, summer)[easternRegion]
    const westernSummer = computeMonthlyTemperature(mesh, land, western, summer)[easternRegion]
    const westernWinter = computeMonthlyTemperature(mesh, land, western, winter)[easternRegion]
    const westernControlSummer = computeMonthlyTemperature(mesh, land, westernControl, summer)[easternRegion]
    const westernControlWinter = computeMonthlyTemperature(mesh, land, westernControl, winter)[easternRegion]

    expect(easternSummer).toBeGreaterThan(controlSummer + 2.5)
    expect(easternWinter).toBeLessThan(controlWinter - 2.5)
    expect(easternSummer + easternWinter).toBeCloseTo(controlSummer + controlWinter)
    expect(partialSummer).toBeGreaterThan(controlSummer + 1)
    expect(partialSummer).toBeLessThan(controlSummer + 1.5)
    expect(westernSummer).toBeCloseTo(westernControlSummer)
    expect(westernWinter).toBeCloseTo(westernControlWinter)
  })

  it('moderates subtropical western shores without cooling polar land', () => {
    const mesh = climateMesh(createSphericalMesh({ subdivisionLevel: 3, physicalRadiusKm: 6371 }))
    const n = mesh.numRegions
    const zero = new Float32Array(n)
    const land = { regionCount: n, landMask: new Uint8Array(n).fill(1), elevationKm: zero }
    const coast = mesh.regionLatitude.reduce((best, latitude, r) =>
      Math.abs(latitude * 180 / Math.PI - 35) < Math.abs(mesh.regionLatitude[best] * 180 / Math.PI - 35) ? r : best, 0)
    const polar = mesh.regionLatitude.reduce((best, latitude, r) =>
      Math.abs(latitude * 180 / Math.PI - 65) < Math.abs(mesh.regionLatitude[best] * 180 / Math.PI - 65) ? r : best, 0)
    const spatial: MonthlySpatialFields = {
      coastDistanceKm: zero,
      continentality: zero,
      westCoastInfluence: zero,
      eastMonsoonExposure: zero,
      elevationGradientEast: zero,
      elevationGradientNorth: zero,
      edgeKm: 200,
    }
    const exposure = new Float32Array(n)
    exposure[coast] = 1
    exposure[polar] = 1
    const western = { ...spatial, westCoastInfluence: exposure }
    const forcing: MonthlyForcing = {
      days: 365.25 / 12,
      solarDeclination: 0,
      orbitalPhase: Math.PI / 2 + 0.35,
      itczLatitude: new Float32Array(72),
      maritimeItczLatitude: 0,
      pressureHpa: zero,
      windEast: zero,
      windNorth: zero,
      monsoonEast: zero,
      oceanEast: zero,
      oceanNorth: zero,
      oceanWarmth: zero,
    }
    const summerControl = computeMonthlyTemperature(mesh, land, spatial, forcing)
    const summerWestern = computeMonthlyTemperature(mesh, land, western, forcing)
    const winter = { ...forcing, orbitalPhase: forcing.orbitalPhase + Math.PI }
    const winterControl = computeMonthlyTemperature(mesh, land, spatial, winter)
    const winterWestern = computeMonthlyTemperature(mesh, land, western, winter)

    expect(summerWestern[coast]).toBeLessThan(summerControl[coast] - 2)
    expect(winterWestern[coast]).toBeGreaterThan(winterControl[coast] + 2)
    expect(summerWestern[coast] + winterWestern[coast]).toBeCloseTo(summerControl[coast] + winterControl[coast])
    expect(summerWestern[polar]).toBeCloseTo(summerControl[polar])
    expect(winterWestern[polar]).toBeCloseTo(winterControl[polar])
  })
})
