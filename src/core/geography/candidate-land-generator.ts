import type SphericalMesh from '@/core/mesh/mesh'
import alea from 'alea'
import { createNoise3D } from 'simplex-noise'
import { computeSphericalDistanceField, computeSphericalNearestLabels, referenceCellsToAngle } from '@/core/math/distance-field'
import { clamp } from '@/core/math/math'

export interface CandidateLandData {
  candidateLandMask: Uint8Array
  continentId: Int16Array
  /** Nearest candidate continent at every reference region, including ocean. */
  nearestContinentId: Int16Array
  /** Reference-mesh region at the seed of each generated continent. */
  continentSeeds: Uint32Array
  landArea: number
}

interface PlateTopology {
  area: Float64Array
  centroid: Float64Array
  compactness: Float64Array
  neighbors: Array<Set<number>>
}

const COAST_CONTOUR_AMPLITUDE = referenceCellsToAngle(6)

/** Places continents on subdivisions guided by moving plates, then contours coasts. */
export class CandidateLandGenerator {
  generate(
    mesh: SphericalMesh,
    regionPlate: Int16Array,
    plateSeeds: Uint32Array,
    requestedContinentCount: number,
    requestedCoverage: number,
    sizeVariety: number,
    seed: number,
    plateToSuper?: Int16Array,
  ): CandidateLandData {
    const plateCount = plateSeeds.length
    if (regionPlate.length !== mesh.numRegions)
      throw new Error('Plate assignment must match the reference mesh')
    if (plateCount === 0)
      throw new Error('At least one tectonic plate is required')
    if (plateToSuper && plateToSuper.length !== plateCount)
      throw new Error('Moving plate mapping must match reference subdivisions')

    const continentCount = Math.max(
      1,
      Math.min(Math.floor(requestedContinentCount), plateCount),
    )
    const coverage = clamp(requestedCoverage, 0, 1)
    const variety = clamp(sizeVariety, 0, 1)
    const random = alea(seed + 42)
    const topology = this.buildPlateTopology(mesh, regionPlate, plateCount)
    const totalArea = topology.area.reduce((sum, area) => sum + area, 0)
    const targetLandArea = totalArea * coverage
    const seedPlates = this.pickContinentSeedPlates(
      topology,
      continentCount,
      totalArea,
      variety,
      random,
      plateToSuper,
    )

    this.trimOversizedSeeds(seedPlates, topology.area, targetLandArea)
    const plateContinent = new Int16Array(plateCount).fill(-1)
    let landArea = 0
    for (let continent = 0; continent < seedPlates.length; continent++) {
      const plate = seedPlates[continent]
      plateContinent[plate] = continent
      landArea += topology.area[plate]
    }

    const growthTarget = targetLandArea * 0.9
    const targets = this.buildContinentTargets(
      seedPlates.length,
      growthTarget,
      variety,
      random,
    )
    const continentAreas = new Float64Array(seedPlates.length)
    for (let continent = 0; continent < seedPlates.length; continent++)
      continentAreas[continent] = topology.area[seedPlates[continent]]

    let progressed = true
    while (progressed && landArea < growthTarget) {
      progressed = false
      for (let continent = 0; continent < seedPlates.length; continent++) {
        if (continentAreas[continent] >= targets[continent])
          continue
        const plate = this.pickGrowthPlate(
          continent,
          plateContinent,
          topology,
          random,
          plateToSuper,
        )
        if (plate < 0)
          continue
        plateContinent[plate] = continent
        continentAreas[continent] += topology.area[plate]
        landArea += topology.area[plate]
        progressed = true
        if (landArea >= growthTarget)
          break
      }
    }

    this.absorbEnclosedOceans(
      plateContinent,
      topology,
      landArea,
      targetLandArea * 1.1,
    )

    const plateLandMask = new Uint8Array(mesh.numRegions)
    const plateContinentId = new Int16Array(mesh.numRegions).fill(-1)
    for (let region = 0; region < mesh.numRegions; region++) {
      const continent = plateContinent[regionPlate[region]]
      if (continent < 0)
        continue
      plateLandMask[region] = 1
      plateContinentId[region] = continent
    }
    const contoured = this.contourCoasts(
      mesh,
      plateLandMask,
      plateContinentId,
      seedPlates.map(plate => plateSeeds[plate]),
      targetLandArea,
      seed,
    )

    return {
      candidateLandMask: contoured.candidateLandMask,
      continentId: contoured.continentId,
      nearestContinentId: contoured.nearestContinentId,
      continentSeeds: Uint32Array.from(
        seedPlates.map(plate => plateSeeds[plate]),
      ),
      landArea: contoured.landArea,
    }
  }

  private contourCoasts(
    mesh: SphericalMesh,
    plateLandMask: Uint8Array,
    plateContinentId: Int16Array,
    continentSeeds: number[],
    targetLandArea: number,
    seed: number,
  ): Pick<CandidateLandData, 'candidateLandMask' | 'continentId' | 'nearestContinentId' | 'landArea'> {
    const count = mesh.numRegions
    const candidateLandMask = new Uint8Array(count)
    const continentId = new Int16Array(count).fill(-1)
    if (targetLandArea <= 0)
      return { candidateLandMask, continentId, nearestContinentId: new Int16Array(count).fill(-1), landArea: 0 }

    const distanceToLand = computeSphericalDistanceField(mesh, region => plateLandMask[region] === 1)
    const distanceToOcean = computeSphericalDistanceField(mesh, region => plateLandMask[region] === 0)
    const noise = createNoise3D(alea(seed + 6031))
    const scores = new Float32Array(count)
    const anchor = new Uint8Array(count)
    for (const region of continentSeeds)
      anchor[region] = 1
    for (let region = 0; region < count; region++) {
      const index = region * 3
      const x = mesh.regionPosition[index]
      const y = mesh.regionPosition[index + 1]
      const z = mesh.regionPosition[index + 2]
      const contour = 0.72 * noise(x * 3.2 + 11.7, y * 3.2 - 8.3, z * 3.2 + 5.1)
        + 0.28 * noise(x * 8.5 - 4.6, y * 8.5 + 7.2, z * 8.5 - 12.4)
      const signedDistance = plateLandMask[region]
        ? distanceToOcean[region]
        : -distanceToLand[region]
      scores[region] = anchor[region]
        ? 2 * Math.PI
        : (Number.isFinite(signedDistance) ? signedDistance : 0)
          + contour * COAST_CONTOUR_AMPLITUDE
    }

    const rankedRegions = Array.from({ length: count }, (_, region) => region)
    rankedRegions.sort((a, b) => scores[b] - scores[a] || a - b)
    let landArea = 0
    for (const region of rankedRegions) {
      if (landArea >= targetLandArea)
        break
      candidateLandMask[region] = 1
      landArea += mesh.regionArea[region]
    }

    // An expanded coast inherits the nearest original continent, not the plate
    // it happened to cross. Distances are processed outward from original land.
    const originalNearestContinent = Int16Array.from(plateContinentId)
    const oceanRegions = rankedRegions.filter(region => plateLandMask[region] === 0)
    oceanRegions.sort((a, b) => distanceToLand[a] - distanceToLand[b] || a - b)
    for (const region of oceanRegions) {
      let nearest = -1
      let nearestDistance = distanceToLand[region]
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        if (distanceToLand[neighbor] >= nearestDistance || originalNearestContinent[neighbor] < 0)
          continue
        nearestDistance = distanceToLand[neighbor]
        nearest = originalNearestContinent[neighbor]
      }
      originalNearestContinent[region] = nearest
    }
    for (let region = 0; region < count; region++) {
      if (candidateLandMask[region])
        continentId[region] = originalNearestContinent[region]
    }
    const nearestContinentId = computeSphericalNearestLabels(mesh, continentId)
    return { candidateLandMask, continentId, nearestContinentId, landArea }
  }

  private buildPlateTopology(
    mesh: SphericalMesh,
    regionPlate: Int16Array,
    plateCount: number,
  ): PlateTopology {
    const area = new Float64Array(plateCount)
    const cellCount = new Uint32Array(plateCount)
    const centroid = new Float64Array(plateCount * 3)
    const perimeter = new Uint32Array(plateCount)
    const neighbors = Array.from({ length: plateCount }, () => new Set<number>())

    for (let region = 0; region < mesh.numRegions; region++) {
      const plate = regionPlate[region]
      if (plate < 0 || plate >= plateCount)
        throw new Error(`Invalid plate ${plate} at reference region ${region}`)
      const regionArea = mesh.regionArea[region]
      const position = region * 3
      area[plate] += regionArea
      cellCount[plate]++
      centroid[plate * 3] += mesh.regionPosition[position] * regionArea
      centroid[plate * 3 + 1] += mesh.regionPosition[position + 1] * regionArea
      centroid[plate * 3 + 2] += mesh.regionPosition[position + 2] * regionArea

      let boundary = false
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        const neighborPlate = regionPlate[neighbor]
        if (neighborPlate === plate)
          continue
        boundary = true
        neighbors[plate].add(neighborPlate)
      }
      if (boundary)
        perimeter[plate]++
    }

    const compactness = new Float64Array(plateCount)
    let maximumCompactness = 0
    for (let plate = 0; plate < plateCount; plate++) {
      const inverseArea = area[plate] > 0 ? 1 / area[plate] : 0
      centroid[plate * 3] *= inverseArea
      centroid[plate * 3 + 1] *= inverseArea
      centroid[plate * 3 + 2] *= inverseArea
      compactness[plate] = Math.sqrt(Math.max(1, cellCount[plate]))
        / Math.max(1, perimeter[plate])
      maximumCompactness = Math.max(maximumCompactness, compactness[plate])
    }
    if (maximumCompactness > 0) {
      for (let plate = 0; plate < plateCount; plate++)
        compactness[plate] /= maximumCompactness
    }

    return { area, centroid, compactness, neighbors }
  }

  private pickContinentSeedPlates(
    topology: PlateTopology,
    count: number,
    totalArea: number,
    variety: number,
    random: () => number,
    plateToSuper?: Int16Array,
  ): number[] {
    const plateCount = topology.area.length
    const seeds = [Math.floor(random() * plateCount)]
    const selected = new Uint8Array(plateCount)
    selected[seeds[0]] = 1
    const expectedArea = totalArea / plateCount

    while (seeds.length < count) {
      const candidates: Array<{ plate: number, score: number }> = []
      for (let plate = 0; plate < plateCount; plate++) {
        if (selected[plate])
          continue
        let minimumDistance = Infinity
        for (const existing of seeds) {
          minimumDistance = Math.min(
            minimumDistance,
            this.centroidDistanceSquared(topology.centroid, plate, existing),
          )
        }
        const rawAreaFactor = Math.sqrt(expectedArea / Math.max(topology.area[plate], 1e-12))
        const areaFactor = 1 + (rawAreaFactor - 1) * (1 - variety * 0.5)
        const compactness = 0.3 + topology.compactness[plate] * 0.7
        const newMovingPlate = plateToSuper
          && seeds.every(existing => plateToSuper[existing] !== plateToSuper[plate])
        candidates.push({
          plate,
          score: minimumDistance * areaFactor * compactness * (newMovingPlate ? 1.3 : 1),
        })
      }
      candidates.sort((a, b) => b.score - a.score || a.plate - b.plate)
      if (candidates.length === 0)
        break
      const topCount = Math.min(3, candidates.length)
      const chosen = candidates[Math.floor(random() * topCount)].plate
      seeds.push(chosen)
      selected[chosen] = 1
    }
    return seeds
  }

  private centroidDistanceSquared(
    centroid: Float64Array,
    first: number,
    second: number,
  ): number {
    const a = first * 3
    const b = second * 3
    const dx = centroid[a] - centroid[b]
    const dy = centroid[a + 1] - centroid[b + 1]
    const dz = centroid[a + 2] - centroid[b + 2]
    return dx * dx + dy * dy + dz * dz
  }

  private trimOversizedSeeds(
    seeds: number[],
    plateArea: Float64Array,
    targetArea: number,
  ): void {
    let seedArea = seeds.reduce((sum, plate) => sum + plateArea[plate], 0)
    while (seeds.length > 1 && seedArea > targetArea) {
      let largest = 0
      for (let index = 1; index < seeds.length; index++) {
        if (plateArea[seeds[index]] > plateArea[seeds[largest]])
          largest = index
      }
      seedArea -= plateArea[seeds[largest]]
      seeds.splice(largest, 1)
    }
  }

  private buildContinentTargets(
    count: number,
    totalArea: number,
    variety: number,
    random: () => number,
  ): Float64Array {
    const weights = new Float64Array(count)
    let weightSum = 0
    for (let continent = 0; continent < count; continent++) {
      weights[continent] = variety > 0 && count > 1
        ? Math.exp((random() - 0.5) * variety * 2.5)
        : 1
      weightSum += weights[continent]
    }
    const targets = new Float64Array(count)
    for (let continent = 0; continent < count; continent++)
      targets[continent] = totalArea * weights[continent] / weightSum
    return targets
  }

  private pickGrowthPlate(
    continent: number,
    plateContinent: Int16Array,
    topology: PlateTopology,
    random: () => number,
    plateToSuper?: Int16Array,
  ): number {
    const candidates: Array<{ plate: number, score: number }> = []
    for (let plate = 0; plate < plateContinent.length; plate++) {
      if (plateContinent[plate] >= 0)
        continue
      let touchesSelf = false
      let touchesOther = false
      let sameNeighbors = 0
      let sameMovingPlateNeighbors = 0
      for (const neighbor of topology.neighbors[plate]) {
        const assignment = plateContinent[neighbor]
        if (assignment === continent) {
          touchesSelf = true
          sameNeighbors++
          if (plateToSuper && plateToSuper[neighbor] === plateToSuper[plate])
            sameMovingPlateNeighbors++
        }
        else if (assignment >= 0) {
          touchesOther = true
          break
        }
      }
      if (!touchesSelf || touchesOther)
        continue
      candidates.push({
        plate,
        score: sameNeighbors + sameMovingPlateNeighbors * 0.75
          + topology.compactness[plate] * 3 + random() * 0.5,
      })
    }
    candidates.sort((a, b) => b.score - a.score || a.plate - b.plate)
    if (candidates.length === 0)
      return -1
    const topCount = Math.min(3, candidates.length)
    return candidates[Math.floor(random() * topCount)].plate
  }

  private absorbEnclosedOceans(
    plateContinent: Int16Array,
    topology: PlateTopology,
    initialLandArea: number,
    maximumLandArea: number,
  ): number {
    const visited = new Uint8Array(plateContinent.length)
    const components: number[][] = []
    for (let plate = 0; plate < plateContinent.length; plate++) {
      if (plateContinent[plate] >= 0 || visited[plate])
        continue
      const component = [plate]
      visited[plate] = 1
      for (let index = 0; index < component.length; index++) {
        for (const neighbor of topology.neighbors[component[index]]) {
          if (plateContinent[neighbor] >= 0 || visited[neighbor])
            continue
          visited[neighbor] = 1
          component.push(neighbor)
        }
      }
      components.push(component)
    }
    if (components.length === 0)
      return initialLandArea

    const componentArea = components.map(component => (
      component.reduce((sum, plate) => sum + topology.area[plate], 0)
    ))
    let mainOcean = 0
    for (let index = 1; index < components.length; index++) {
      if (componentArea[index] > componentArea[mainOcean])
        mainOcean = index
    }

    let landArea = initialLandArea
    for (let index = 0; index < components.length; index++) {
      if (index === mainOcean || landArea + componentArea[index] > maximumLandArea)
        continue
      const borderingContinents = new Set<number>()
      for (const plate of components[index]) {
        for (const neighbor of topology.neighbors[plate]) {
          if (plateContinent[neighbor] >= 0)
            borderingContinents.add(plateContinent[neighbor])
        }
      }
      if (borderingContinents.size !== 1)
        continue
      const continent = borderingContinents.values().next().value
      if (continent === undefined)
        continue
      for (const plate of components[index])
        plateContinent[plate] = continent
      landArea += componentArea[index]
    }
    return landArea
  }
}
