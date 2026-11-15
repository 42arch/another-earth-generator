import type { SphericalMesh } from '#mesh/spherical-mesh'

/** Ocean sources travel only through connected water on the output mesh. */
export function mapOceanReference(
  output: SphericalMesh,
  reference: SphericalMesh,
  land: Uint8Array,
  referenceLand: Uint8Array,
  nearest: Uint32Array,
): Int32Array {
  const count = output.regionCount
  const component = new Int32Array(count).fill(-1)
  const queue = new Uint32Array(count)
  for (let start = 0; start < count; start++) {
    if (land[start] || component[start] >= 0)
      continue
    component[start] = start
    queue[0] = start
    let end = 1
    for (let head = 0; head < end; head++) {
      const region = queue[head]
      for (let edge = output.neighborOffsets[region]; edge < output.neighborOffsets[region + 1]; edge++) {
        const neighbor = output.neighbors[edge]
        if (land[neighbor] || component[neighbor] >= 0)
          continue
        component[neighbor] = start
        queue[end++] = neighbor
      }
    }
  }

  // A coarse source can cover several disconnected water bodies. Give it to
  // the one whose assigned output cell lies closest to its center.
  const owner = new Int32Array(reference.regionCount).fill(-1)
  const bestDot = new Float64Array(reference.regionCount).fill(-Infinity)
  for (let region = 0; region < count; region++) {
    const source = nearest[region]
    if (land[region] || referenceLand[source])
      continue
    const i = 3 * region
    const j = 3 * source
    const dot = output.centers[i] * reference.centers[j]
      + output.centers[i + 1] * reference.centers[j + 1]
      + output.centers[i + 2] * reference.centers[j + 2]
    if (dot > bestDot[source]) {
      bestDot[source] = dot
      owner[source] = component[region]
    }
  }

  const mapping = new Int32Array(count).fill(-1)
  let end = 0
  for (let region = 0; region < count; region++) {
    const source = nearest[region]
    if (!land[region] && owner[source] === component[region]) {
      mapping[region] = source
      queue[end++] = region
    }
  }
  for (let head = 0; head < end; head++) {
    const region = queue[head]
    for (let edge = output.neighborOffsets[region]; edge < output.neighborOffsets[region + 1]; edge++) {
      const neighbor = output.neighbors[edge]
      if (land[neighbor] || mapping[neighbor] >= 0)
        continue
      mapping[neighbor] = mapping[region]
      queue[end++] = neighbor
    }
  }
  return mapping
}
