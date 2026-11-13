import type { GeographicRegionsArtifact, SphericalMesh } from '@another-earth/world-core'

type LabelMesh = Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers' | 'areaKm2'>

export interface GeographicLabelAnchor {
  readonly id: string
  readonly kind: 'continent' | 'ocean'
  readonly name: string
  readonly areaKm2: number
  /** Unit-sphere center of a cell that actually belongs to the named region. */
  readonly position: readonly [number, number, number]
}

/** Pick a member cell nearest the area-weighted spherical center; never place a label on another region. */
export function buildGeographicLabelAnchors(mesh: LabelMesh, regions: GeographicRegionsArtifact): GeographicLabelAnchor[] {
  if (mesh.meshId !== regions.meshId || mesh.centers.length !== mesh.regionCount * 3 || mesh.areaKm2.length !== mesh.regionCount || regions.continentIndex.length !== mesh.regionCount || regions.oceanIndex.length !== mesh.regionCount)
    throw new Error('Geographic labels require matching mesh and region arrays')

  const collect = (kind: GeographicLabelAnchor['kind'], indexByCell: Int32Array, table: readonly { readonly id: string, readonly name?: string, readonly areaKm2: number }[]): GeographicLabelAnchor[] => {
    const x = new Float64Array(table.length)
    const y = new Float64Array(table.length)
    const z = new Float64Array(table.length)
    const representative = new Int32Array(table.length).fill(-1)
    for (let cell = 0; cell < mesh.regionCount; cell++) {
      const index = indexByCell[cell]
      if (index < 0) continue
      if (index >= table.length) throw new Error(`Invalid ${kind} index at cell ${cell}`)
      const area = mesh.areaKm2[cell]
      const offset = cell * 3
      x[index] += mesh.centers[offset] * area
      y[index] += mesh.centers[offset + 1] * area
      z[index] += mesh.centers[offset + 2] * area
      if (representative[index] < 0 || area > mesh.areaKm2[representative[index]]) representative[index] = cell
    }
    const inverseLength = new Float64Array(table.length)
    for (let index = 0; index < table.length; index++) {
      const length = Math.hypot(x[index], y[index], z[index])
      if (length > 1e-9) inverseLength[index] = 1 / length
    }
    const bestScore = new Float64Array(table.length).fill(-Infinity)
    for (let cell = 0; cell < mesh.regionCount; cell++) {
      const index = indexByCell[cell]
      if (index < 0 || !table[index].name || !inverseLength[index]) continue
      const offset = cell * 3
      const score = (mesh.centers[offset] * x[index] + mesh.centers[offset + 1] * y[index] + mesh.centers[offset + 2] * z[index]) * inverseLength[index]
      if (score > bestScore[index]) {
        bestScore[index] = score
        representative[index] = cell
      }
    }
    return table.flatMap((item, index) => {
      const cell = representative[index]
      if (!item.name || cell < 0) return []
      const offset = cell * 3
      return [{ id: item.id, kind, name: item.name, areaKm2: item.areaKm2, position: [mesh.centers[offset], mesh.centers[offset + 1], mesh.centers[offset + 2]] as const }]
    })
  }
  return [...collect('continent', regions.continentIndex, regions.continents), ...collect('ocean', regions.oceanIndex, regions.oceans)]
}
