import type {
  SphericalBoundaryData,
  SphericalCrustData,
} from '@/core/geology/geology-data'
import type SphericalMesh from '@/core/mesh/mesh'
import {
  CRUST_TYPE,
  PLATE_BOUNDARY,
  SUBDUCTION_ROLE,
} from '@/core/geology/geology-data'

const NORMAL_VELOCITY_THRESHOLD = 0.003

export class SphericalPlateBoundaryAnalyzer {
  analyze(
    mesh: SphericalMesh,
    regionPlate: Int16Array,
    plateAngularVelocity: Float32Array,
    crust: SphericalCrustData,
  ): SphericalBoundaryData {
    const edgeCount = mesh.voronoi.edgeRegions.length / 2
    const edgeBoundaryType = new Uint8Array(edgeCount)
    const edgeNormalVelocity = new Float32Array(edgeCount)
    const edgeShearVelocity = new Float32Array(edgeCount)
    const edgeStress = new Float32Array(edgeCount)
    const regionBoundaryType = new Uint8Array(mesh.numRegions)
    const regionStress = new Float32Array(mesh.numRegions)
    const regionCompression = new Float32Array(mesh.numRegions)
    const regionExtension = new Float32Array(mesh.numRegions)
    const regionShear = new Float32Array(mesh.numRegions)
    const regionStressDirection = new Float32Array(mesh.numRegions * 3)
    const edgeSubductingPlate = new Int16Array(edgeCount).fill(-1)
    const edgeOverridingPlate = new Int16Array(edgeCount).fill(-1)
    const regionSubductionRole = new Uint8Array(mesh.numRegions)
    const regionSubductionStress = new Float32Array(mesh.numRegions)

    for (let edge = 0; edge < edgeCount; edge++) {
      const edgeIndex = edge * 2
      const regionA = mesh.voronoi.edgeRegions[edgeIndex]
      const regionB = mesh.voronoi.edgeRegions[edgeIndex + 1]
      const plateA = regionPlate[regionA]
      const plateB = regionPlate[regionB]
      if (plateA === plateB)
        continue

      const aIndex = regionA * 3
      const bIndex = regionB * 3
      const ax = mesh.regionPosition[aIndex]
      const ay = mesh.regionPosition[aIndex + 1]
      const az = mesh.regionPosition[aIndex + 2]
      const bx = mesh.regionPosition[bIndex]
      const by = mesh.regionPosition[bIndex + 1]
      const bz = mesh.regionPosition[bIndex + 2]

      let px = ax + bx
      let py = ay + by
      let pz = az + bz
      const pointLength = Math.hypot(px, py, pz) || 1
      px /= pointLength
      py /= pointLength
      pz /= pointLength

      let nx = bx - ax
      let ny = by - ay
      let nz = bz - az
      const radial = nx * px + ny * py + nz * pz
      nx -= radial * px
      ny -= radial * py
      nz -= radial * pz
      const normalLength = Math.hypot(nx, ny, nz) || 1
      nx /= normalLength
      ny /= normalLength
      nz /= normalLength

      const tx = py * nz - pz * ny
      const ty = pz * nx - px * nz
      const tz = px * ny - py * nx
      const angularA = plateA * 3
      const awx = plateAngularVelocity[angularA]
      const awy = plateAngularVelocity[angularA + 1]
      const awz = plateAngularVelocity[angularA + 2]
      const velocityAX = awy * pz - awz * py
      const velocityAY = awz * px - awx * pz
      const velocityAZ = awx * py - awy * px
      const angularB = plateB * 3
      const bwx = plateAngularVelocity[angularB]
      const bwy = plateAngularVelocity[angularB + 1]
      const bwz = plateAngularVelocity[angularB + 2]
      const relativeX = bwy * pz - bwz * py - velocityAX
      const relativeY = bwz * px - bwx * pz - velocityAY
      const relativeZ = bwx * py - bwy * px - velocityAZ
      const normalVelocity = relativeX * nx + relativeY * ny + relativeZ * nz
      const shearVelocity = Math.abs(relativeX * tx + relativeY * ty + relativeZ * tz)
      const boundaryType = normalVelocity < -NORMAL_VELOCITY_THRESHOLD
        ? PLATE_BOUNDARY.Convergent
        : normalVelocity > NORMAL_VELOCITY_THRESHOLD
          ? PLATE_BOUNDARY.Divergent
          : PLATE_BOUNDARY.Transform
      const stress = Math.max(Math.abs(normalVelocity), shearVelocity)

      edgeBoundaryType[edge] = boundaryType
      edgeNormalVelocity[edge] = normalVelocity
      edgeShearVelocity[edge] = shearVelocity
      edgeStress[edge] = stress
      const compression = Math.max(0, -normalVelocity)
      const extension = Math.max(0, normalVelocity)
      this.aggregateRegion(
        regionA,
        boundaryType,
        stress,
        compression,
        extension,
        shearVelocity,
        nx,
        ny,
        nz,
        regionBoundaryType,
        regionStress,
        regionCompression,
        regionExtension,
        regionShear,
        regionStressDirection,
      )
      this.aggregateRegion(
        regionB,
        boundaryType,
        stress,
        compression,
        extension,
        shearVelocity,
        -nx,
        -ny,
        -nz,
        regionBoundaryType,
        regionStress,
        regionCompression,
        regionExtension,
        regionShear,
        regionStressDirection,
      )

      if (boundaryType === PLATE_BOUNDARY.Convergent) {
        const crustA = crust.regionCrustType[regionA]
        const crustB = crust.regionCrustType[regionB]
        const bothContinental = crustA === CRUST_TYPE.Continental
          && crustB === CRUST_TYPE.Continental
        if (!bothContinental) {
          const aSubducts = (crustA === CRUST_TYPE.Oceanic && crustB === CRUST_TYPE.Continental)
            || (crustA === crustB && crust.regionDensity[regionA] > crust.regionDensity[regionB])
            || (
              crustA === crustB
              && crust.regionDensity[regionA] === crust.regionDensity[regionB]
              && plateA > plateB
            )
          const subductingPlate = aSubducts ? plateA : plateB
          const overridingPlate = aSubducts ? plateB : plateA
          edgeSubductingPlate[edge] = subductingPlate
          edgeOverridingPlate[edge] = overridingPlate
          this.aggregateSubductionRole(
            regionA,
            plateA === subductingPlate ? SUBDUCTION_ROLE.Subducting : SUBDUCTION_ROLE.Overriding,
            stress,
            regionSubductionRole,
            regionSubductionStress,
          )
          this.aggregateSubductionRole(
            regionB,
            plateB === subductingPlate ? SUBDUCTION_ROLE.Subducting : SUBDUCTION_ROLE.Overriding,
            stress,
            regionSubductionRole,
            regionSubductionStress,
          )
        }
      }
    }

    const regionSubductionFactor = new Float32Array(mesh.numRegions).fill(0.5)
    for (let region = 0; region < mesh.numRegions; region++) {
      if (regionSubductionRole[region] === SUBDUCTION_ROLE.Overriding)
        regionSubductionFactor[region] = 0
      else if (regionSubductionRole[region] === SUBDUCTION_ROLE.Subducting)
        regionSubductionFactor[region] = 1
    }

    return {
      edgeBoundaryType,
      edgeNormalVelocity,
      edgeShearVelocity,
      edgeStress,
      regionBoundaryType,
      regionStress,
      regionCompression,
      regionExtension,
      regionShear,
      regionStressDirection,
      edgeSubductingPlate,
      edgeOverridingPlate,
      regionSubductionRole,
      regionSubductionFactor,
    }
  }

  velocityAt(
    plateAngularVelocity: Float32Array,
    plate: number,
    x: number,
    y: number,
    z: number,
  ): readonly [number, number, number] {
    const index = plate * 3
    const wx = plateAngularVelocity[index]
    const wy = plateAngularVelocity[index + 1]
    const wz = plateAngularVelocity[index + 2]
    return [
      wy * z - wz * y,
      wz * x - wx * z,
      wx * y - wy * x,
    ]
  }

  private aggregateRegion(
    region: number,
    boundaryType: number,
    stress: number,
    compression: number,
    extension: number,
    shear: number,
    directionX: number,
    directionY: number,
    directionZ: number,
    regionBoundaryType: Uint8Array,
    regionStress: Float32Array,
    regionCompression: Float32Array,
    regionExtension: Float32Array,
    regionShear: Float32Array,
    regionStressDirection: Float32Array,
  ): void {
    regionCompression[region] = Math.max(regionCompression[region], compression)
    regionExtension[region] = Math.max(regionExtension[region], extension)
    regionShear[region] = Math.max(regionShear[region], shear)
    if (stress <= regionStress[region])
      return
    regionStress[region] = stress
    regionBoundaryType[region] = boundaryType
    const direction = region * 3
    regionStressDirection[direction] = directionX
    regionStressDirection[direction + 1] = directionY
    regionStressDirection[direction + 2] = directionZ
  }

  private aggregateSubductionRole(
    region: number,
    role: number,
    stress: number,
    regionSubductionRole: Uint8Array,
    regionSubductionStress: Float32Array,
  ): void {
    if (stress <= regionSubductionStress[region])
      return
    regionSubductionStress[region] = stress
    regionSubductionRole[region] = role
  }
}
