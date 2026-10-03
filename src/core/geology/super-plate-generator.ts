import type { SphericalCrustData } from '@/core/geology/geology-data'
import type { SphericalPlateData } from '@/core/geology/plate-generator'
import type SphericalMesh from '@/core/mesh/mesh'
import { CRUST_TYPE } from '@/core/geology/geology-data'

export interface SuperPlateData {
  regionPlate: Int16Array
  plateCount: number
  plateAngularVelocity: Float32Array
  crust: SphericalCrustData
}

/** Groups adjacent same-crust plates into detail-stable broad tectonic units. */
export class SuperPlateGenerator {
  generate(
    mesh: SphericalMesh,
    plates: SphericalPlateData,
    angularVelocity: Float32Array,
    crust: SphericalCrustData,
  ): SuperPlateData | null {
    const plateCount = plates.plateSeeds.length
    if (plateCount < 8)
      return null
    const area = new Float64Array(plateCount)
    const neighbors = Array.from({ length: plateCount }, () => new Set<number>())
    for (let region = 0; region < mesh.numRegions; region++) {
      const plate = plates.regionPlate[region]
      area[plate] += mesh.regionArea[region]
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        const other = plates.regionPlate[neighbor]
        if (other !== plate)
          neighbors[plate].add(other)
      }
    }

    const components: number[][] = []
    const visited = new Uint8Array(plateCount)
    for (let plate = 0; plate < plateCount; plate++) {
      if (visited[plate])
        continue
      const component: number[] = []
      const queue = [plate]
      visited[plate] = 1
      for (let head = 0; head < queue.length; head++) {
        const current = queue[head]
        component.push(current)
        for (const neighbor of neighbors[current]) {
          if (
            visited[neighbor]
            || crust.plateCrustType[neighbor] !== crust.plateCrustType[plate]
          ) {
            continue
          }
          visited[neighbor] = 1
          queue.push(neighbor)
        }
      }
      components.push(component)
    }

    const targetCount = Math.max(2, Math.min(20, Math.round(plateCount / 4)))
    const plateToSuper = new Int16Array(plateCount).fill(-1)
    let nextSuperPlate = 0
    for (const component of components) {
      const groupCount = Math.max(1, Math.round(targetCount * component.length / plateCount))
      const seeds = this.pickSeeds(component, groupCount, neighbors, area)
      this.assignComponent(component, seeds, neighbors, area, plateToSuper, nextSuperPlate)
      nextSuperPlate += seeds.length
    }

    const regionPlate = new Int16Array(mesh.numRegions)
    for (let region = 0; region < mesh.numRegions; region++)
      regionPlate[region] = plateToSuper[plates.regionPlate[region]]
    return {
      regionPlate,
      plateCount: nextSuperPlate,
      plateAngularVelocity: this.aggregateVelocities(
        plateToSuper,
        nextSuperPlate,
        angularVelocity,
        area,
      ),
      crust: this.aggregateCrust(
        plateToSuper,
        nextSuperPlate,
        crust,
        area,
      ),
    }
  }

  private pickSeeds(
    component: number[],
    count: number,
    neighbors: Array<Set<number>>,
    area: Float64Array,
  ): number[] {
    const seeds = [component[0]]
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

  private assignComponent(
    component: number[],
    seeds: number[],
    neighbors: Array<Set<number>>,
    area: Float64Array,
    assignment: Int16Array,
    offset: number,
  ): void {
    const distance = new Float64Array(assignment.length).fill(Infinity)
    const owner = new Int16Array(assignment.length).fill(-1)
    for (let seed = 0; seed < seeds.length; seed++) {
      distance[seeds[seed]] = 0
      owner[seeds[seed]] = offset + seed
    }
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
        const candidate = distance[current] + Math.sqrt(area[neighbor] || 1)
        if (candidate < distance[neighbor]) {
          distance[neighbor] = candidate
          owner[neighbor] = owner[current]
        }
      }
    }
    for (const plate of component)
      assignment[plate] = owner[plate] >= 0 ? owner[plate] : offset
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
