import type { IcosphereGeometry } from '../index'
import { describe, expect, it } from 'vitest'
import { buildSphericalVoronoi, createSphericalMesh, generateIcosphere, sphericalTriangleArea, tangentDirections, triangulateSphericalDelaunay, validateSphericalMesh } from '../index'

const make = (level: number, irregularity: number, seed: number | string) => createSphericalMesh({ subdivisionLevel: level, physicalRadiusKm: 6371, irregularity, seed })
describe('legacy jitter with spherical Delaunator reconstruction', () => {
  it('keeps the exact subdivision path and identity for irregularity zero', () => {
    const regular = generateIcosphere(3)
    const explicit = generateIcosphere(3, { irregularity: 0, seed: 123 })
    expect(explicit).toEqual(regular)
    expect(make(2, 0, 42).meshId).toBe(make(2, 0, 0).meshId)
  })
  it.each([0, 1, 2, 3, 4])('validates regular and irregular topology, winding and cells at L%i', (level) => {
    for (const irregularity of [0, 0.1, 0.75, 1]) {
      for (const seed of [0, 42, 'another-earth']) {
        expect(validateSphericalMesh(make(level, irregularity, seed))).toEqual({ valid: true, issues: [] })
      }
    }
  })
  it('is deterministic, seed-sensitive, isolated and has variable valence', () => {
    const a = make(3, 0.75, 42)
    make(1, 1, 123)
    const b = make(3, 0.75, 42)
    expect(b).toEqual(a)
    expect(make(3, 0.75, 43).centers).not.toEqual(a.centers)
    expect(make(3, 0.75, 43).meshId).not.toBe(a.meshId)
    expect(a.centers.slice(0, 36)).toEqual(generateIcosphere(3).centers.slice(0, 36))
    expect(a.triangles).not.toEqual(generateIcosphere(3).triangles)
    expect(Array.from(a.neighborOffsets.slice(1), (end, i) => end - a.neighborOffsets[i]).some(degree => degree !== 5 && degree !== 6)).toBe(true)
  })
  it('rejects the old subdivision triangulation after large jitter', () => {
    const geometry = generateIcosphere(2, { irregularity: 1, seed: 42 })
    expect(() => buildSphericalVoronoi({ ...geometry, triangles: generateIcosphere(2).triangles }, 1)).toThrow(/Degenerate or inward/)
  })
  it('satisfies global empty-cap and complete sphere area conditions', () => {
    const mesh = make(2, 1, 101)
    for (let t = 0; t < mesh.triangles.length / 3; t++) {
      const id = mesh.triangles[3 * t]
      const x = mesh.dualVertices[3 * t]
      const y = mesh.dualVertices[3 * t + 1]
      const z = mesh.dualVertices[3 * t + 2]
      const ownDot = x * mesh.centers[3 * id] + y * mesh.centers[3 * id + 1] + z * mesh.centers[3 * id + 2]
      for (let r = 0; r < mesh.regionCount; r++)
        expect(x * mesh.centers[3 * r] + y * mesh.centers[3 * r + 1] + z * mesh.centers[3 * r + 2]).toBeLessThanOrEqual(ownDot + 1e-12)
    }
    expect(mesh.areaKm2.reduce((a, b) => a + b, 0) / 6371 ** 2).toBeCloseTo(4 * Math.PI, 10)
  })
  it('handles projection poles aligned with or arbitrarily near both Z axes', () => {
    const geometry = generateIcosphere(2, { irregularity: 0.75, seed: 42 })
    const p = { x: geometry.centers[0], y: geometry.centers[1], z: geometry.centers[2] }
    const east = { x: 0, y: 0, z: 0 }
    const north = { x: 0, y: 0, z: 0 }
    tangentDirections(p, east, north)
    for (const angle of [0, 1e-9, Math.PI, Math.PI - 1e-9]) {
      const centers = geometry.centers.slice()
      for (let r = 0; r < centers.length; r += 3) {
        const x = centers[r]
        const y = centers[r + 1]
        const z = centers[r + 2]
        const u = x * east.x + y * east.y + z * east.z
        const v = x * north.x + y * north.y + z * north.z
        const w = x * p.x + y * p.y + z * p.z
        centers[r] = u
        centers[r + 1] = v * Math.cos(angle) - w * Math.sin(angle)
        centers[r + 2] = v * Math.sin(angle) + w * Math.cos(angle)
      }
      for (const pole of [0, 11, geometry.centers.length / 3 - 1]) {
        const rebuilt: IcosphereGeometry = { ...geometry, centers, triangles: triangulateSphericalDelaunay(centers, pole) }
        expect(validateSphericalMesh(buildSphericalVoronoi(rebuilt, 1))).toEqual({ valid: true, issues: [] })
      }
    }
  })
  it('closes the pole fan even when another site is very close to the pole', () => {
    const geometry = generateIcosphere(1, { irregularity: 0.75, seed: 3 })
    const centers = new Float64Array(geometry.centers.length + 3)
    centers.set(geometry.centers)
    const p = { x: centers[0], y: centers[1], z: centers[2] }
    const east = { x: 0, y: 0, z: 0 }
    const north = { x: 0, y: 0, z: 0 }
    tangentDirections(p, east, north)
    const epsilon = 1e-6
    const n = Math.hypot(p.x + epsilon * east.x, p.y + epsilon * east.y, p.z + epsilon * east.z)
    centers.set([(p.x + epsilon * east.x) / n, (p.y + epsilon * east.y) / n, (p.z + epsilon * east.z) / n], geometry.centers.length)
    const triangles = triangulateSphericalDelaunay(centers)
    const edges = new Map<string, number>()
    let area = 0
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i] * 3
      const b = triangles[i + 1] * 3
      const c = triangles[i + 2] * 3
      area += sphericalTriangleArea(centers[a], centers[a + 1], centers[a + 2], centers[b], centers[b + 1], centers[b + 2], centers[c], centers[c + 1], centers[c + 2])
      for (let side = 0; side < 3; side++) {
        const u = triangles[i + side]
        const v = triangles[i + (side + 1) % 3]
        const key = `${Math.min(u, v)}:${Math.max(u, v)}`
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
    expect([...edges.values()].every(uses => uses === 2)).toBe(true)
    expect(centers.length / 3 - edges.size + triangles.length / 3).toBe(2)
    expect(area).toBeCloseTo(4 * Math.PI, 9)
  })
  it('rejects invalid parameters and unresolved duplicate sites', () => {
    for (const irregularity of [-1, 1.1, Number.NaN, Infinity])
      expect(() => make(1, irregularity, 0)).toThrow(RangeError)
    expect(() => make(1, 0.75, Infinity)).toThrow(RangeError)
    const centers = generateIcosphere(1).centers
    centers.set(centers.subarray(0, 3), 3)
    expect(() => triangulateSphericalDelaunay(centers)).toThrow(/Duplicate|omitted/)
  })
})
