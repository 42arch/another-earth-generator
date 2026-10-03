import type { SphericalTectonicData } from '@/core/geology/geology-data'
import type SphericalMesh from '@/core/mesh/mesh'
import alea from 'alea'
import { PLATE_BOUNDARY } from '@/core/geology/geology-data'

export interface MantleDynamicTopographyFields {
  /** Signed normalized mantle flow: positive is upwelling, negative is downwelling. */
  normalizedFlow: Float32Array
  /** Unnormalized tangential convection vector used to bias plate motion. */
  tangentFlow: Float32Array
  /** Broad elevation contribution in the reference generator's shaping coordinate. */
  elevationDelta: Float32Array
}

interface MantleCell {
  x: number
  y: number
  z: number
  radialSign: -1 | 1
  rotationalSign: -1 | 1
  strength: number
}

const MANTLE_CELL_COUNT = 5
const MINIMUM_CELL_SEPARATION = 0.6
const DOMINANT_CELL_STRENGTH = 2
const MINOR_CELL_STRENGTH = 0.7
const ROTATION_STRENGTH = 0.6
const DYNAMIC_TOPO_UPLIFT = 0.035
const DYNAMIC_TOPO_SUBSIDENCE = 0.025

/** Builds the reference-style long-wavelength mantle convection field. */
export class MantleDynamicTopographyGenerator {
  generate(
    mesh: SphericalMesh,
    tectonics: SphericalTectonicData,
    seed: number,
  ): MantleDynamicTopographyFields {
    return this.generateFromBoundaryTypes(mesh, tectonics.regionBoundaryType, seed)
  }

  generateFromBoundaryTypes(
    mesh: SphericalMesh,
    boundaryTypes: Uint8Array,
    seed: number,
  ): MantleDynamicTopographyFields {
    const random = alea(seed + 9999)
    const cells = this.placeCells(mesh, boundaryTypes, random)
    const signedFlow = new Float32Array(mesh.numRegions)
    const tangentFlow = new Float32Array(mesh.numRegions * 3)
    let maximumMagnitude = 0

    for (let region = 0; region < mesh.numRegions; region++) {
      const offset = region * 3
      const px = mesh.regionPosition[offset]
      const py = mesh.regionPosition[offset + 1]
      const pz = mesh.regionPosition[offset + 2]
      let flowX = 0
      let flowY = 0
      let flowZ = 0
      let radialSum = 0

      for (const cell of cells) {
        const dot = this.clampDot(px * cell.x + py * cell.y + pz * cell.z)
        const angle = Math.acos(dot)
        if (angle < 1e-6)
          continue
        let radialX = cell.x - dot * px
        let radialY = cell.y - dot * py
        let radialZ = cell.z - dot * pz
        const radialLength = Math.hypot(radialX, radialY, radialZ)
        if (radialLength < 1e-10)
          continue
        radialX /= radialLength
        radialY /= radialLength
        radialZ /= radialLength
        const tangentX = py * radialZ - pz * radialY
        const tangentY = pz * radialX - px * radialZ
        const tangentZ = px * radialY - py * radialX
        const strength = cell.strength / (0.5 + angle * angle)
        const radialStrength = cell.radialSign * strength
        const rotationalStrength = cell.rotationalSign * ROTATION_STRENGTH * strength
        flowX += radialX * radialStrength + tangentX * rotationalStrength
        flowY += radialY * radialStrength + tangentY * rotationalStrength
        flowZ += radialZ * radialStrength + tangentZ * rotationalStrength
        radialSum += radialStrength
      }

      const magnitude = Math.hypot(flowX, flowY, flowZ)
      const value = magnitude * Math.sign(radialSum)
      signedFlow[region] = value
      tangentFlow[offset] = flowX
      tangentFlow[offset + 1] = flowY
      tangentFlow[offset + 2] = flowZ
      maximumMagnitude = Math.max(maximumMagnitude, Math.abs(value))
    }

    const normalizedFlow = new Float32Array(mesh.numRegions)
    const elevationDelta = new Float32Array(mesh.numRegions)
    const inverseMaximum = maximumMagnitude > 1e-6 ? 1 / maximumMagnitude : 0
    for (let region = 0; region < mesh.numRegions; region++) {
      const value = signedFlow[region] * inverseMaximum
      normalizedFlow[region] = value
      elevationDelta[region] = value > 0
        ? value * DYNAMIC_TOPO_UPLIFT
        : value * DYNAMIC_TOPO_SUBSIDENCE
    }
    return { normalizedFlow, tangentFlow, elevationDelta }
  }

  private placeCells(
    mesh: SphericalMesh,
    boundaryTypes: Uint8Array,
    random: () => number,
  ): MantleCell[] {
    const convergent: number[] = []
    for (let region = 0; region < mesh.numRegions; region++) {
      if (boundaryTypes[region] === PLATE_BOUNDARY.Convergent)
        convergent.push(region)
    }

    const placed: Array<readonly [number, number, number]> = []
    const cells: MantleCell[] = []
    const downwellingCount = Math.min(Math.ceil(MANTLE_CELL_COUNT / 2), convergent.length)
    if (downwellingCount > 0) {
      this.addRegionPosition(mesh, convergent[Math.floor(random() * convergent.length)], placed)
      while (placed.length < downwellingCount) {
        const next = this.farthestRegion(mesh, convergent, placed, true)
        if (next < 0)
          break
        this.addRegionPosition(mesh, next, placed)
      }
      for (let index = 0; index < placed.length; index++) {
        const position = placed[index]
        cells.push(this.createCell(position, -1, index === 0, random))
      }
    }

    const upwellingCount = MANTLE_CELL_COUNT - cells.length
    const stride = Math.max(1, Math.floor(mesh.numRegions / 2048))
    const candidates: number[] = []
    for (let region = 0; region < mesh.numRegions; region += stride)
      candidates.push(region)
    for (let index = 0; index < upwellingCount; index++) {
      let next = this.farthestRegion(mesh, candidates, placed, true)
      if (next < 0)
        next = this.farthestRegion(mesh, candidates, placed, false)
      if (next < 0)
        break
      this.addRegionPosition(mesh, next, placed)
      cells.push(this.createCell(placed[placed.length - 1], 1, index === 0, random))
    }

    if (cells.length === 0) {
      for (let index = 0; index < MANTLE_CELL_COUNT; index++) {
        const longitude = random() * Math.PI * 2
        const z = random() * 2 - 1
        const radius = Math.sqrt(Math.max(0, 1 - z * z))
        cells.push(this.createCell(
          [radius * Math.cos(longitude), radius * Math.sin(longitude), z],
          index % 2 === 0 ? 1 : -1,
          index < 2,
          random,
        ))
      }
    }
    return cells
  }

  private farthestRegion(
    mesh: SphericalMesh,
    candidates: readonly number[],
    placed: ReadonlyArray<readonly [number, number, number]>,
    requireSeparation: boolean,
  ): number {
    let bestRegion = -1
    let bestDistance = -1
    for (const region of candidates) {
      const offset = region * 3
      let minimumDistance = Number.POSITIVE_INFINITY
      for (const position of placed) {
        const distance = 1 - this.clampDot(
          mesh.regionPosition[offset] * position[0]
          + mesh.regionPosition[offset + 1] * position[1]
          + mesh.regionPosition[offset + 2] * position[2],
        )
        minimumDistance = Math.min(minimumDistance, distance)
      }
      if (placed.length === 0)
        minimumDistance = 2
      if (
        requireSeparation
        && minimumDistance < MINIMUM_CELL_SEPARATION
      ) {
        continue
      }
      if (minimumDistance > bestDistance) {
        bestDistance = minimumDistance
        bestRegion = region
      }
    }
    return bestRegion
  }

  private addRegionPosition(
    mesh: SphericalMesh,
    region: number,
    target: Array<readonly [number, number, number]>,
  ): void {
    const offset = region * 3
    target.push([
      mesh.regionPosition[offset],
      mesh.regionPosition[offset + 1],
      mesh.regionPosition[offset + 2],
    ])
  }

  private createCell(
    position: readonly [number, number, number],
    radialSign: -1 | 1,
    dominant: boolean,
    random: () => number,
  ): MantleCell {
    return {
      x: position[0],
      y: position[1],
      z: position[2],
      radialSign,
      rotationalSign: random() < 0.5 ? -1 : 1,
      strength: dominant ? DOMINANT_CELL_STRENGTH : MINOR_CELL_STRENGTH,
    }
  }

  private clampDot(value: number): number {
    return Math.max(-1, Math.min(1, value))
  }
}
