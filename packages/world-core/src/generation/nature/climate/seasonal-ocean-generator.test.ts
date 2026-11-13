import { createSphericalMesh } from '#mesh/spherical-mesh'
import { describe, expect, it } from 'vitest'
import { ITCZ_LONGITUDE_SAMPLES } from './climate-data'
import { DEG } from './climate-geometry'
import { climateMesh } from './climate-mesh'
import { circumpolarWaters, generateSeasonalOcean } from './seasonal-ocean-generator'

describe('circumpolar surface currents', () => {
  it('requires a connected loop and excludes isolated water', () => {
    const mesh = climateMesh(createSphericalMesh({ subdivisionLevel: 4, physicalRadiusKm: 6371 }))
    const ocean = Uint8Array.from(mesh.regionLatitude, latitude => Number(Math.abs(latitude / DEG + 60) < 5))
    const isolated = mesh.regionLatitude.findIndex(latitude => latitude < -75 * DEG)
    ocean[isolated] = 1
    const open = circumpolarWaters(mesh, ocean, -1)
    expect(open.some(Boolean)).toBe(true)
    expect(open[isolated]).toBe(0)
    for (let r = 0; r < mesh.numRegions; r++) {
      if (Math.abs(mesh.regionLongitude[r]) < 10 * DEG)
        ocean[r] = 0
    }
    expect(circumpolarWaters(mesh, ocean, -1).some(Boolean)).toBe(false)
  })

  it('maintains an eastward equatorial return between westward trade currents', () => {
    const mesh = climateMesh(createSphericalMesh({ subdivisionLevel: 5, physicalRadiusKm: 6371 }))
    const count = mesh.numRegions
    const land = Uint8Array.from(mesh.regionLongitude, longitude => Number(Math.abs(longitude / DEG) < 15))
    const itcz = Float32Array.from({ length: 4 * ITCZ_LONGITUDE_SAMPLES }, (_, i) =>
      [5, 20, 5, -10][Math.floor(i / ITCZ_LONGITUDE_SAMPLES)] * DEG)
    const current = generateSeasonalOcean(mesh, land, {
      solarDeclination: Float32Array.of(0, 23.5 * DEG, 0, -23.5 * DEG),
      itczLatitude: itcz,
      windEast: new Float32Array(4 * count).fill(-8),
      windNorth: new Float32Array(4 * count),
    })
    const interiorAt = (latitude: number) => mesh.regionLatitude.findIndex((lat, r) =>
      Math.abs(lat / DEG - latitude) < 0.5 && Math.abs(mesh.regionLongitude[r] / DEG) > 140)
    const returnCurrent = interiorAt(5)
    const southTradeCurrent = interiorAt(-12)
    const northTradeCurrent = interiorAt(12)
    const boundaryAt = (sign: number) => mesh.regionLatitude.findIndex((lat, r) =>
      Math.abs(lat / DEG - 20) < 1 && mesh.regionLongitude[r] / DEG * sign > 15 && mesh.regionLongitude[r] / DEG * sign < 18)
    const westernBoundary = boundaryAt(1)
    const easternBoundary = boundaryAt(-1)
    for (let season = 0; season < 4; season++) {
      const offset = season * count
      expect(current.oceanEast[offset + returnCurrent]).toBeGreaterThan(0)
      expect(current.oceanEast[offset + southTradeCurrent]).toBeLessThan(0)
      expect(current.oceanEast[offset + northTradeCurrent]).toBeLessThan(0)
      expect(current.oceanNorth[offset + westernBoundary]).toBeGreaterThan(0)
      expect(current.oceanNorth[offset + easternBoundary]).toBeLessThan(0)
    }
  })
})
