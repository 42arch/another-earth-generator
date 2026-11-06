import type { MeshTopology, SphericalMesh, Vector3Like } from '../index'
import { describe, expect, it } from 'vitest'
import { angularDistance, cartesianToLatLon, createSphericalMesh, generateIcosphere, greatCircleDistanceKm, icosphereRegionCount, latLonToCartesian, MeshQueries, normalizeVector, SphericalSpatialIndex, tangentDirections, validateSphericalMesh } from '../index'

function brute(mesh: MeshTopology, p: Vector3Like): number {
  const length = Math.hypot(p.x, p.y, p.z)
  let best = -1
  let distance = Infinity
  for (let r = 0; r < mesh.regionCount; r++) {
    const dx = p.x / length - mesh.centers[3 * r]
    const dy = p.y / length - mesh.centers[3 * r + 1]
    const dz = p.z / length - mesh.centers[3 * r + 2]
    const d = dx * dx + dy * dy + dz * dz
    if (d < distance || (d === distance && r < best)) {
      best = r
      distance = d
    }
  }
  return best
}
const make = (level: number, radius = 6371) => createSphericalMesh({ subdivisionLevel: level, physicalRadiusKm: radius })
describe('standard Icosphere and spherical Voronoi', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])('generates exact vertex and face counts for L%i', (level) => {
    const geometry = generateIcosphere(level)
    expect(geometry.centers.length / 3).toBe(10 * 4 ** level + 2)
    expect(geometry.triangles.length / 3).toBe(20 * 4 ** level)
  })
  it.each([0, 1, 2, 3, 4])('validates full topology and geometry for L%i', (level) => {
    const mesh = make(level)
    expect(validateSphericalMesh(mesh)).toEqual({ valid: true, issues: [] })
    expect(mesh.edgeRegions.length / 2).toBe(30 * 4 ** level)
    expect(mesh.regionCount - mesh.edgeRegions.length / 2 + mesh.triangles.length / 3).toBe(2)
    expect(mesh.areaKm2.reduce((a, b) => a + b, 0) / 6371 ** 2).toBeCloseTo(4 * Math.PI, 10)
  })
  it('keeps every convex cell corner on the nearest-site bisectors', () => {
    const mesh = make(2, 1)
    for (let t = 0; t < mesh.triangles.length / 3; t++) {
      const x = mesh.dualVertices[3 * t]
      const y = mesh.dualVertices[3 * t + 1]
      const z = mesh.dualVertices[3 * t + 2]
      const a = mesh.triangles[3 * t]
      const ownDot = x * mesh.centers[3 * a] + y * mesh.centers[3 * a + 1] + z * mesh.centers[3 * a + 2]
      for (let r = 0; r < mesh.regionCount; r++) {
        const dot = x * mesh.centers[3 * r] + y * mesh.centers[3 * r + 1] + z * mesh.centers[3 * r + 2]
        expect(dot).toBeLessThanOrEqual(ownDot + 1e-12)
      }
    }
  })
  it('rejects malformed topology and winding', () => {
    const mesh = make(1)
    mesh.triangles[0] = mesh.triangles[1]
    mesh.neighbors[0] = mesh.regionCount
    mesh.dualVertices[0] = Infinity
    expect(validateSphericalMesh(mesh).valid).toBe(false)
  })
  it('is reproducible and independent of intervening calls and physical radius', () => {
    const first = make(2, 1)
    make(0, 5)
    const second = make(2, 1)
    for (const key of Object.keys(first) as (keyof SphericalMesh)[])
      expect(second[key]).toEqual(first[key])
    const scaled = make(2, 10)
    expect(scaled.centers).toEqual(first.centers)
    expect(scaled.triangles).toEqual(first.triangles)
    expect(scaled.meshId).not.toBe(first.meshId)
    for (let r = 0; r < first.regionCount; r++)
      expect(scaled.areaKm2[r]).toBeCloseTo(first.areaKm2[r] * 100, 10)
    second.centers[0] = 42
    expect(first.centers[0]).not.toBe(42)
  })
  it('rejects unsafe subdivision levels and radii', () => {
    for (const level of [-1, 0.5, 9, Infinity, Number.NaN])
      expect(() => icosphereRegionCount(level)).toThrow(RangeError)
    for (const radius of [0, -1, Infinity, Number.NaN])
      expect(() => make(0, radius)).toThrow(RangeError)
  })
})
describe('coordinates and physical units', () => {
  it('uses Y-up and the established geographic directions', () => {
    const p = { x: 0, y: 0, z: 0 }
    expect(latLonToCartesian(0, 0, p)).toEqual({ x: 0, y: 0, z: 1 })
    latLonToCartesian(0, Math.PI / 2, p)
    expect(p.x).toBeCloseTo(1)
    latLonToCartesian(Math.PI / 2, 0, p)
    expect(p.y).toBeCloseTo(1)
    expect(angularDistance({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 })).toBe(Math.PI)
    expect(greatCircleDistanceKm({ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, 2)).toBeCloseTo(Math.PI)
  })
  it('round-trips seams and near-pole coordinates', () => {
    for (const latitude of [-Math.PI / 2, -1.2, 0, 1.2, Math.PI / 2 - 1e-10]) {
      for (const longitude of [-Math.PI, -2, 0, 2, Math.PI, 5 * Math.PI]) {
        const v = latLonToCartesian(latitude, longitude, { x: 0, y: 0, z: 0 })
        const ll = cartesianToLatLon(v, { latitude: 0, longitude: 0 })
        const restored = latLonToCartesian(ll.latitude, ll.longitude, { x: 0, y: 0, z: 0 })
        expect(angularDistance(v, restored)).toBeLessThan(1e-12)
      }
    }
  })
  it('normalizes and constructs orthonormal local tangent directions at both poles', () => {
    for (const p of [{ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 1, y: 2, z: 3 }]) {
      normalizeVector(p, p)
      const east = { x: 0, y: 0, z: 0 }
      const north = { x: 0, y: 0, z: 0 }
      tangentDirections(p, east, north)
      expect(Math.hypot(east.x, east.y, east.z)).toBeCloseTo(1, 12)
      expect(Math.hypot(north.x, north.y, north.z)).toBeCloseTo(1, 12)
      expect(east.x * p.x + east.y * p.y + east.z * p.z).toBeCloseTo(0, 12)
      expect(north.x * p.x + north.y * p.y + north.z * p.z).toBeCloseTo(0, 12)
      expect(east.x * north.x + east.y * north.y + east.z * north.z).toBeCloseTo(0, 12)
    }
    expect(() => normalizeVector({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toThrow(RangeError)
    expect(() => latLonToCartesian(2, 0, { x: 0, y: 0, z: 0 })).toThrow(RangeError)
  })
})
describe('read-only mesh and spatial queries', () => {
  it('matches brute force around the world, seams, and poles', () => {
    const mesh = make(3)
    const index = new SphericalSpatialIndex(mesh)
    const p = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < 250; i++) {
      latLonToCartesian(Math.asin(2 * (i + 0.5) / 250 - 1), i * 2.399963229728653, p)
      expect(index.findNearestRegion(p)).toBe(brute(mesh, p))
    }
    for (const latitude of [-Math.PI / 2, -Math.PI / 2 + 1e-12, Math.PI / 2, Math.PI / 2 - 1e-12]) {
      for (const longitude of [-Math.PI, Math.PI, 0]) {
        latLonToCartesian(latitude, longitude, p)
        expect(index.findNearestRegion(p)).toBe(brute(mesh, p))
      }
    }
    latLonToCartesian(0.2, Math.PI - 1e-12, p)
    const west = index.findNearestRegion(p)
    latLonToCartesian(0.2, -Math.PI + 1e-12, p)
    expect(index.findNearestRegion(p)).toBe(west)
    expect(() => index.findNearestRegion({ x: 0, y: 0, z: 0 })).toThrow(RangeError)
  })
  it('returns each exact center and resolves exact ties with the lower region ID', () => {
    const mesh = make(2)
    const index = new SphericalSpatialIndex(mesh)
    const queries = new MeshQueries(mesh)
    const p = { x: 0, y: 0, z: 0 }
    queries.forEachRegion(r => expect(index.findNearestRegion(queries.getRegionCenter(r, p))).toBe(r))
    const tied: MeshTopology = { meshId: 'tie', regionCount: 2, centers: new Float64Array([1, 0, 0, -1, 0, 0]), areaKm2: new Float64Array(2), neighborOffsets: new Uint32Array(3), neighbors: new Uint32Array() }
    expect(new SphericalSpatialIndex(tied).findNearestRegion({ x: 0, y: 1, z: 0 })).toBe(0)
  })
  it('reads topology without modifying or exposing the mesh arrays', () => {
    const mesh = make(1)
    const before = mesh.centers.slice()
    const q = new MeshQueries(mesh)
    let neighbors = 0
    let corners = 0
    q.forEachNeighbor(0, (n, edge, km) => {
      expect(q.areAdjacent(n, 0)).toBe(true)
      expect(q.getNeighborDistanceKm(0, n)).toBe(km)
      expect(km).toBe(mesh.edgeAngularDistances[edge] * 6371)
      neighbors++
    })
    q.forEachBoundaryCorner(0, (_corner, x, y, z) => {
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12)
      corners++
    })
    expect(neighbors).toBe(q.getNeighborCount(0))
    expect(corners).toBe(neighbors)
    expect(q.getRegionAreaKm2(0)).toBe(mesh.areaKm2[0])
    expect(q.getNeighborDistanceKm(0, 0)).toBeNull()
    expect(q).not.toHaveProperty('centers')
    expect(mesh.centers).toEqual(before)
    expect(() => q.getNeighborCount(-1)).toThrow(RangeError)
  })
})
