import type { SphericalMesh } from '@another-earth/world-core'

const fields = ['centers', 'areaKm2', 'neighborOffsets', 'neighbors', 'triangles', 'dualVertices', 'boundaryCorners', 'edgeRegions', 'edgeTriangles', 'triangleEdges', 'neighborEdges', 'edgeAngularDistances'] as const

/** Clone once without detaching the worker/cache owner, then transfer only cloned buffers. */
export function transferSnapshot(mesh: SphericalMesh): { mesh: SphericalMesh, buffers: ArrayBuffer[], bytes: number } {
  const snapshot = structuredClone(mesh)
  const buffers = new Set<ArrayBuffer>()
  for (const field of fields) {
    const buffer = snapshot[field].buffer
    if (buffer instanceof ArrayBuffer)
      buffers.add(buffer)
  }
  return { mesh: snapshot, buffers: [...buffers], bytes: [...buffers].reduce((total, buffer) => total + buffer.byteLength, 0) }
}

/** Structured clone returns plain data; assert its required shape before consumers use it. */
export function hydrateMesh(value: SphericalMesh): SphericalMesh {
  if (!value || typeof value.meshId !== 'string' || !Number.isInteger(value.regionCount) || value.regionCount < 12 || !(value.centers instanceof Float64Array) || !(value.triangles instanceof Uint32Array) || !(value.neighborOffsets instanceof Uint32Array) || !(value.neighbors instanceof Uint32Array) || !(value.dualVertices instanceof Float64Array) || !(value.boundaryCorners instanceof Uint32Array) || !(value.areaKm2 instanceof Float64Array) || !(value.edgeRegions instanceof Uint32Array) || !(value.edgeTriangles instanceof Uint32Array) || !(value.triangleEdges instanceof Uint32Array) || !(value.neighborEdges instanceof Uint32Array) || !(value.edgeAngularDistances instanceof Float64Array))
    throw new TypeError('Invalid transferred Mesh')
  if (value.centers.length !== value.regionCount * 3 || value.areaKm2.length !== value.regionCount || value.neighborOffsets.length !== value.regionCount + 1 || value.neighbors.length !== value.boundaryCorners.length || value.neighbors.length !== value.neighborEdges.length || value.neighborOffsets[value.regionCount] !== value.neighbors.length || value.triangles.length % 3 !== 0 || value.dualVertices.length !== value.triangles.length || value.triangleEdges.length !== value.triangles.length || value.edgeRegions.length % 2 !== 0 || value.edgeTriangles.length !== value.edgeRegions.length || value.edgeAngularDistances.length * 2 !== value.edgeRegions.length)
    throw new TypeError('Transferred Mesh array lengths do not match')
  return value
}
