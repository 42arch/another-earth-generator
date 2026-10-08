import type { SphericalCrustData } from '@/core/geology/geology-data'
import type { SphericalPlateData } from '@/core/geology/plate-generator'
import type SphericalMesh from '@/core/mesh/mesh'
import alea from 'alea'
import { CRUST_TYPE } from '@/core/geology/geology-data'

export interface SuperPlateTopologyData {
  regionPlate: Int16Array
  plateCount: number
  plateToSuper: Int16Array
  plateAngularVelocity: Float32Array
}

export interface SuperPlateData extends SuperPlateTopologyData {
  crust: SphericalCrustData
}

/** Groups reference subdivisions into connected, differently sized tectonic plates. */
export class SuperPlateGenerator {
  generate(
    mesh: SphericalMesh,
    plates: SphericalPlateData,
    angularVelocity: Float32Array,
    crust: SphericalCrustData,
    primaryCount: number = Math.max(2, Math.round(plates.plateSeeds.length / 4)),
    microCount = 0,
    sizeVariety = 0.8,
    seed = 0,
  ): SuperPlateData | null {
    const topology = this.generateTopology(
      mesh,
      plates,
      angularVelocity,
      primaryCount,
      microCount,
      sizeVariety,
      seed,
    )
    return topology ? this.attachCrust(mesh, plates, topology, crust) : null
  }

  generateTopology(
    mesh: SphericalMesh,
    plates: SphericalPlateData,
    angularVelocity: Float32Array,
    primaryCount: number = Math.max(2, Math.round(plates.plateSeeds.length / 4)),
    microCount = 0,
    sizeVariety = 0.8,
    seed = 0,
  ): SuperPlateTopologyData | null {
    const plateCount = plates.plateSeeds.length
    if (plateCount < 2)
      return null
    const area = new Float64Array(plateCount)
    const centroid = new Float64Array(plateCount * 3)
    const neighbors = Array.from({ length: plateCount }, () => new Set<number>())
    for (let region = 0; region < mesh.numRegions; region++) {
      const plate = plates.regionPlate[region]
      const weight = mesh.regionArea[region]
      area[plate] += weight
      const position = region * 3
      const target = plate * 3
      centroid[target] += mesh.regionPosition[position] * weight
      centroid[target + 1] += mesh.regionPosition[position + 1] * weight
      centroid[target + 2] += mesh.regionPosition[position + 2] * weight
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        const other = plates.regionPlate[neighbor]
        if (other !== plate)
          neighbors[plate].add(other)
      }
    }
    for (let plate = 0; plate < plateCount; plate++) {
      const index = plate * 3
      const length = Math.hypot(centroid[index], centroid[index + 1], centroid[index + 2]) || 1
      centroid[index] /= length
      centroid[index + 1] /= length
      centroid[index + 2] /= length
    }

    const targetCount = Math.max(2, Math.min(plateCount, Math.floor(primaryCount)))
    const random = alea(seed + 2117)
    const seeds = this.pickSeeds(Array.from({ length: plateCount }, (_, plate) => plate), targetCount, neighbors, area)
    const targets = Float64Array.from(seeds, () => Math.exp((random() - 0.5) * sizeVariety * 3.5))
    const totalArea = area.reduce((sum, value) => sum + value, 0)
    const weightSum = targets.reduce((sum, value) => sum + value, 0)
    for (let plate = 0; plate < targets.length; plate++)
      targets[plate] = targets[plate] / weightSum * totalArea
    const plateToSuper = new Int16Array(plateCount).fill(-1)
    const assignedArea = new Float64Array(targetCount)
    for (let group = 0; group < targetCount; group++) {
      plateToSuper[seeds[group]] = group
      assignedArea[group] = area[seeds[group]]
    }
    this.growGroups(plateToSuper, neighbors, area, targets, assignedArea)

    const broadVelocities = this.aggregateVelocities(plateToSuper, targetCount, angularVelocity, area)
    const nextSuperPlate = this.addBoundaryMicroplates(
      plateToSuper,
      targetCount,
      Math.min(Math.max(0, Math.floor(microCount)), plateCount - targetCount),
      neighbors,
      area,
      broadVelocities,
      centroid,
    )
    const finalVelocities = this.aggregateVelocities(plateToSuper, nextSuperPlate, angularVelocity, area)
    for (let plate = 0; plate < plateCount; plate++) {
      const group = plateToSuper[plate]
      if (group < targetCount)
        continue
      const index = group * 3
      const fine = plate * 3
      finalVelocities[index] = angularVelocity[fine]
      finalVelocities[index + 1] = angularVelocity[fine + 1]
      finalVelocities[index + 2] = angularVelocity[fine + 2]
    }

    const regionPlate = new Int16Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++)
      regionPlate[region] = plateToSuper[plates.regionPlate[region]]
    return {
      regionPlate,
      plateCount: nextSuperPlate,
      plateToSuper,
      plateAngularVelocity: finalVelocities,
    }
  }

  attachCrust(
    mesh: SphericalMesh,
    plates: SphericalPlateData,
    topology: SuperPlateTopologyData,
    crust: SphericalCrustData,
  ): SuperPlateData {
    const area = new Float64Array(plates.plateSeeds.length)
    for (let region = 0; region < mesh.numRegions; region++)
      area[plates.regionPlate[region]] += mesh.regionArea[region]
    return {
      ...topology,
      crust: this.aggregateCrust(topology.plateToSuper, topology.plateCount, crust, area),
    }
  }

  private pickSeeds(
    component: number[],
    count: number,
    neighbors: Array<Set<number>>,
    area: Float64Array,
  ): number[] {
    const seeds = [component.reduce((best, plate) => area[plate] > area[best] ? plate : best, component[0])]
    while (seeds.length < Math.min(count, component.length)) {
      const distance = this.distances(component, seeds, neighbors, area)
      let farthest = component[0]
      for (const plate of component) {
        if (distance[plate] > distance[farthest])
          farthest = plate
      }
      if (seeds.includes(farthest))
        break
      seeds.push(farthest)
    }
    return seeds
  }

  private growGroups(
    assignment: Int16Array,
    neighbors: Array<Set<number>>,
    area: Float64Array,
    targets: Float64Array,
    assignedArea: Float64Array,
  ): void {
    let remaining = assignment.filter(value => value < 0).length
    while (remaining > 0) {
      let bestPlate = -1
      let bestGroup = -1
      let bestScore = Infinity
      for (let plate = 0; plate < assignment.length; plate++) {
        if (assignment[plate] >= 0)
          continue
        for (const neighbor of neighbors[plate]) {
          const group = assignment[neighbor]
          if (group < 0)
            continue
          const score = (assignedArea[group] + area[plate]) / Math.max(targets[group], 1e-12)
            + Math.sqrt(area[plate]) * 0.02
          if (score < bestScore || (score === bestScore && plate < bestPlate)) {
            bestScore = score
            bestPlate = plate
            bestGroup = group
          }
        }
      }
      if (bestPlate < 0)
        throw new Error('Disconnected reference plate graph')
      assignment[bestPlate] = bestGroup
      assignedArea[bestGroup] += area[bestPlate]
      remaining--
    }
  }

  private addBoundaryMicroplates(
    assignment: Int16Array,
    majorCount: number,
    requestedCount: number,
    neighbors: Array<Set<number>>,
    area: Float64Array,
    velocity: Float32Array,
    centroid: Float64Array,
  ): number {
    const candidates = Array.from({ length: assignment.length }, (_, plate) => plate)
      .filter(plate => [...neighbors[plate]].some(other => assignment[other] !== assignment[plate]))
      .sort((a, b) => {
        const contrast = (plate: number): number => {
          const owner = assignment[plate] * 3
          const position = plate * 3
          let maximum = 0
          for (const neighbor of neighbors[plate]) {
            const other = assignment[neighbor] * 3
            if (other === owner)
              continue
            const wx = velocity[owner] - velocity[other]
            const wy = velocity[owner + 1] - velocity[other + 1]
            const wz = velocity[owner + 2] - velocity[other + 2]
            const px = centroid[position]
            const py = centroid[position + 1]
            const pz = centroid[position + 2]
            maximum = Math.max(maximum, Math.hypot(
              wy * pz - wz * py,
              wz * px - wx * pz,
              wx * py - wy * px,
            ))
          }
          return maximum
        }
        return (contrast(b) / Math.sqrt(area[b])) - (contrast(a) / Math.sqrt(area[a])) || a - b
      })
    let count = majorCount
    for (const plate of candidates) {
      if (count >= majorCount + requestedCount)
        break
      const owner = assignment[plate]
      if (owner >= majorCount || [...neighbors[plate]].some(other => assignment[other] >= majorCount))
        continue
      const remaining = assignment.reduce((sum, value, index) => sum + (index !== plate && value === owner ? 1 : 0), 0)
      if (remaining < 2 || !this.canRemove(plate, owner, assignment, neighbors))
        continue
      assignment[plate] = count++
    }
    return count
  }

  private canRemove(
    removed: number,
    owner: number,
    assignment: Int16Array,
    neighbors: Array<Set<number>>,
  ): boolean {
    const start = assignment.findIndex((value, index) => index !== removed && value === owner)
    if (start < 0)
      return false
    const visited = new Set<number>([start])
    const queue = [start]
    for (let head = 0; head < queue.length; head++) {
      for (const neighbor of neighbors[queue[head]]) {
        if (neighbor !== removed && assignment[neighbor] === owner && !visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }
    return visited.size === assignment.reduce((sum, value) => sum + (value === owner ? 1 : 0), 0) - 1
  }

  private distances(
    component: number[],
    seeds: number[],
    neighbors: Array<Set<number>>,
    area: Float64Array,
  ): Float64Array {
    const distance = new Float64Array(area.length).fill(Infinity)
    for (const seed of seeds)
      distance[seed] = 0
    const allowed = new Set(component)
    const visited = new Set<number>()
    while (visited.size < component.length) {
      let current = -1
      for (const plate of component) {
        if (!visited.has(plate) && (current < 0 || distance[plate] < distance[current]))
          current = plate
      }
      if (current < 0 || !Number.isFinite(distance[current]))
        break
      visited.add(current)
      for (const neighbor of neighbors[current]) {
        if (!allowed.has(neighbor))
          continue
        distance[neighbor] = Math.min(
          distance[neighbor],
          distance[current] + Math.sqrt(area[neighbor] || 1),
        )
      }
    }
    return distance
  }

  private aggregateVelocities(
    plateToSuper: Int16Array,
    superCount: number,
    velocities: Float32Array,
    area: Float64Array,
  ): Float32Array {
    const result = new Float32Array(superCount * 3)
    const magnitudeSum = new Float64Array(superCount)
    const areaSum = new Float64Array(superCount)
    for (let plate = 0; plate < plateToSuper.length; plate++) {
      const superPlate = plateToSuper[plate]
      const source = plate * 3
      const target = superPlate * 3
      const weight = area[plate]
      result[target] += velocities[source] * weight
      result[target + 1] += velocities[source + 1] * weight
      result[target + 2] += velocities[source + 2] * weight
      magnitudeSum[superPlate] += Math.hypot(
        velocities[source],
        velocities[source + 1],
        velocities[source + 2],
      ) * weight
      areaSum[superPlate] += weight
    }
    for (let plate = 0; plate < superCount; plate++) {
      const index = plate * 3
      const length = Math.hypot(result[index], result[index + 1], result[index + 2]) || 1
      const magnitude = magnitudeSum[plate] / Math.max(areaSum[plate], Number.EPSILON)
      result[index] = result[index] / length * magnitude
      result[index + 1] = result[index + 1] / length * magnitude
      result[index + 2] = result[index + 2] / length * magnitude
    }
    return result
  }

  private aggregateCrust(
    plateToSuper: Int16Array,
    superCount: number,
    crust: SphericalCrustData,
    area: Float64Array,
  ): SphericalCrustData {
    const plateCrustType = new Uint8Array(superCount)
    const plateContinentalFraction = new Float32Array(superCount)
    const plateDensity = new Float32Array(superCount)
    const plateBaseElevation = new Float32Array(superCount)
    const plateCrustThickness = new Float32Array(superCount)
    const totalArea = new Float64Array(superCount)
    const continentalArea = new Float64Array(superCount)
    for (let plate = 0; plate < plateToSuper.length; plate++) {
      const target = plateToSuper[plate]
      const weight = area[plate]
      totalArea[target] += weight
      continentalArea[target] += crust.plateContinentalFraction[plate] * weight
      plateDensity[target] += crust.plateDensity[plate] * weight
      plateBaseElevation[target] += crust.plateBaseElevation[plate] * weight
      plateCrustThickness[target] += crust.plateCrustThickness[plate] * weight
    }
    for (let plate = 0; plate < superCount; plate++) {
      const inverseArea = 1 / Math.max(totalArea[plate], Number.EPSILON)
      plateContinentalFraction[plate] = continentalArea[plate] * inverseArea
      plateCrustType[plate] = plateContinentalFraction[plate] >= 0.5
        ? CRUST_TYPE.Continental
        : CRUST_TYPE.Oceanic
      plateDensity[plate] *= inverseArea
      plateBaseElevation[plate] *= inverseArea
      plateCrustThickness[plate] *= inverseArea
    }
    return {
      plateCrustType,
      plateContinentalFraction,
      plateDensity,
      plateBaseElevation,
      plateCrustThickness,
      regionCrustType: crust.regionCrustType.slice(),
      regionDensity: crust.regionDensity.slice(),
      regionBaseElevation: crust.regionBaseElevation.slice(),
      regionCrustThickness: crust.regionCrustThickness.slice(),
    }
  }
}
