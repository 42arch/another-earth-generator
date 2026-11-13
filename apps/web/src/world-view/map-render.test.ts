import type { SphericalMesh } from '@another-earth/world-core'
import { createMeshPipeline, createSphericalMesh } from '@another-earth/world-core'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { prepareRenderGeometry, prepareRegionSelection } from './map-render-data'
import { disposeSceneObjects } from './world-scene'

const mesh = createSphericalMesh({ subdivisionLevel: 1, physicalRadiusKm: 6371 })
describe('world view geometry mapping', () => {
  it('consumes the public Pipeline MeshStage output and reuses its cached Mesh', async () => {
    const pipeline = createMeshPipeline()
    const input = { seed: 'viewer-test', config: { mesh: { subdivisionLevel: 1, irregularity: 0.5 }, planet: { physicalRadiusKm: 6371 } } }
    const first = await pipeline.execute(input)
    const generated = first.getOutput<SphericalMesh>('mesh')
    expect(prepareRenderGeometry(generated, 'voronoi').positions.length).toBe(generated.boundaryCorners.length * 9)
    const second = await pipeline.execute(input)
    expect(second.plan[0].action).toBe('cache-hit')
    expect(second.getOutput<SphericalMesh>('mesh')).toBe(generated)
  })
  it('maps every Icosphere triangle and shared edge to core coordinates', () => {
    const data = prepareRenderGeometry(mesh, 'icosphere')
    expect(data.positions.length).toBe(mesh.triangles.length * 3)
    for (let i = 0; i < mesh.triangles.length; i++) {
      for (let axis = 0; axis < 3; axis++) {
        expect(data.positions[i * 3 + axis]).toBeCloseTo(mesh.centers[mesh.triangles[i] * 3 + axis], 6)
      }
    }
    expect(data.lines.length).toBe(mesh.edgeRegions.length * 3)
    expect(data.fiveNeighborCenters.length / 3).toBe(12)
  })
  it('maps Voronoi fans to each region and its ordered core corners', () => {
    const data = prepareRenderGeometry(mesh, 'voronoi')
    let out = 0
    for (let r = 0; r < mesh.regionCount; r++) {
      const start = mesh.neighborOffsets[r]
      const end = mesh.neighborOffsets[r + 1]
      for (let i = start; i < end; i++) {
        const a = mesh.boundaryCorners[i]
        const b = mesh.boundaryCorners[i + 1 < end ? i + 1 : start]
        for (let axis = 0; axis < 3; axis++) {
          expect(data.positions[out + axis]).toBeCloseTo(mesh.centers[r * 3 + axis], 6)
          expect(data.positions[out + 3 + axis]).toBeCloseTo(mesh.dualVertices[a * 3 + axis], 6)
          expect(data.positions[out + 6 + axis]).toBeCloseTo(mesh.dualVertices[b * 3 + axis], 6)
        }
        out += 9
      }
    }
    expect(out).toBe(data.positions.length)
  })
  it('transfers display buffers without detaching core buffers', () => {
    const data = prepareRenderGeometry(mesh, 'voronoi')
    const buffers = Object.values(data).map(a => a.buffer as ArrayBuffer)
    const transferred = structuredClone(data, { transfer: buffers })
    expect(data.positions.byteLength).toBe(0)
    expect(transferred.positions.length).toBe(mesh.boundaryCorners.length * 9)
    expect(mesh.centers.byteLength).toBe(mesh.regionCount * 3 * 8)
  })
  it('reports exact core selection facts', () => {
    const selection = prepareRegionSelection(mesh, 0)
    expect(selection.areaKm2).toBe(mesh.areaKm2[0])
    expect(selection.neighbors).toEqual(Array.from(mesh.neighbors.subarray(mesh.neighborOffsets[0], mesh.neighborOffsets[1])))
    expect(selection.ring.length).toBe(selection.neighbors.length * 6)
    expect(selection.spokes.length).toBe(selection.neighbors.length * 6 * 16)
    for (let i = 0; i < selection.spokes.length; i += 3) {
      expect(Math.hypot(selection.spokes[i], selection.spokes[i + 1], selection.spokes[i + 2])).toBeCloseTo(1.004, 6)
    }
  })
  it('sizes five-neighbor markers from irregular topology and maps its Voronoi faces', () => {
    const irregular = createSphericalMesh({ subdivisionLevel: 2, physicalRadiusKm: 6371, irregularity: 1, seed: 'view-test' })
    const data = prepareRenderGeometry(irregular, 'voronoi')
    let fiveNeighbors = 0
    for (let region = 0; region < irregular.regionCount; region++) {
      if (irregular.neighborOffsets[region + 1] - irregular.neighborOffsets[region] === 5)
        fiveNeighbors++
    }
    expect(data.fiveNeighborCenters.length).toBe(3 * fiveNeighbors)
    expect(data.positions.length).toBe(irregular.boundaryCorners.length * 9)
    expect(data.lines.length).toBe(irregular.edgeTriangles.length * 3)
    for (let i = 0; i < data.fiveNeighborCenters.length; i += 3) {
      expect(Math.hypot(data.fiveNeighborCenters[i], data.fiveNeighborCenters[i + 1], data.fiveNeighborCenters[i + 2])).toBeCloseTo(1.002, 5)
    }
  })
})

describe('scene GPU resource ownership', () => {
  it('disposes meshes, line buffers, points and all materials when replacing a scene', () => {
    const root = new THREE.Group()
    const nested = new THREE.Group()
    const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), new THREE.LineBasicMaterial(), new THREE.PointsMaterial()]
    const geometries = [new THREE.BufferGeometry(), new THREE.BufferGeometry(), new THREE.BufferGeometry()]
    let disposedGeometries = 0
    let disposedMaterials = 0
    geometries.forEach(g => g.addEventListener('dispose', () => disposedGeometries++))
    materials.forEach(m => m.addEventListener('dispose', () => disposedMaterials++))
    nested.add(new THREE.Mesh(geometries[0], materials.slice(0, 2)))
    root.add(nested, new THREE.LineSegments(geometries[1], materials[2]), new THREE.Points(geometries[2], materials[3]))
    disposeSceneObjects(root)
    disposeSceneObjects(root)
    expect(root.children).toHaveLength(0)
    expect(disposedGeometries).toBe(3)
    expect(disposedMaterials).toBe(4)
  })
})
