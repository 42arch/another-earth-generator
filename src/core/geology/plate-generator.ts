import type SphericalMesh from '@/core/mesh/mesh'
import alea from 'alea'
import { clamp } from '@/core/math/math'

const LOW_PLATE_COUNT = 24
const LOW_PLATE_RANGE = 20
const SMOOTH_FIRST_THRESHOLD = 0.62
const SMOOTH_LATER_THRESHOLD = 0.68

export interface SphericalPlateData {
  regionPlate: Int16Array
  plateSeeds: Uint32Array
  /** Signed Euler angular velocity vectors, stored as xyz triples. */
  plateAngularVelocity: Float32Array
}

interface GrowthState {
  frontier: number[]
  rate: number
  dirX: number
  dirY: number
  dirZ: number
  directionStrength: number
  area: number
}

/** Reference-grid plate partition based on World Orogen's round-robin growth. */
export class SphericalPlateGenerator {
  generate(mesh: SphericalMesh, requestedPlateCount: number, seed: number): SphericalPlateData {
    const plateCount = Math.max(1, Math.min(Math.floor(requestedPlateCount), mesh.numRegions))
    const random = alea(seed + 0.5)
    const randomIndex = (length: number) => Math.min(length - 1, Math.floor(random() * length))
    const plateSeeds = this.pickSeeds(mesh, plateCount, randomIndex)
    const regionPlate = new Int16Array(mesh.numRegions).fill(-1)
    const lowPlateFactor = clamp((LOW_PLATE_COUNT - plateCount) / LOW_PLATE_RANGE, 0, 1)
    const states = this.createGrowthStates(mesh, plateSeeds, random, lowPlateFactor)

    for (let plate = 0; plate < plateSeeds.length; plate++)
      regionPlate[plateSeeds[plate]] = plate

    let remaining = mesh.numRegions - plateSeeds.length
    const expectedArea = Math.max(1, remaining / plateCount)
    const areaGovernor = 2 + lowPlateFactor * 2
    const compactWeight = 0.3 - lowPlateFactor * 0.22
    const inverseRegionCount = 1 / mesh.numRegions

    while (remaining > 0) {
      let progressed = false
      for (let plate = 0; plate < states.length; plate++) {
        const state = states[plate]
        if (state.frontier.length === 0)
          continue

        let steps = Math.max(1, Math.ceil(state.rate * (0.5 + random())))
        if (state.area > expectedArea * areaGovernor)
          steps = Math.max(1, Math.ceil(steps * 0.5))

        const seedRegion = plateSeeds[plate]
        const seedIndex = seedRegion * 3
        const sx = mesh.regionPosition[seedIndex]
        const sy = mesh.regionPosition[seedIndex + 1]
        const sz = mesh.regionPosition[seedIndex + 2]
        const expectedChord = Math.sqrt(state.area * inverseRegionCount / Math.PI) * 2
        const compactThreshold = expectedChord * 1.65

        for (let step = 0; step < steps && state.frontier.length > 0; step++) {
          let bestFrontier = 0
          let bestScore = -Infinity
          const samples = Math.min(
            state.frontier.length,
            3 + Math.floor(state.directionStrength * 5),
          )
          for (let sample = 0; sample < samples; sample++) {
            const frontierIndex = randomIndex(state.frontier.length)
            const region = state.frontier[frontierIndex]
            const index = region * 3
            const dx = mesh.regionPosition[index] - sx
            const dy = mesh.regionPosition[index + 1] - sy
            const dz = mesh.regionPosition[index + 2] - sz
            const distanceSquared = dx * dx + dy * dy + dz * dz
            const distance = Math.sqrt(distanceSquared) || 1
            const alignment = (
              dx * state.dirX + dy * state.dirY + dz * state.dirZ
            ) / distance
            const excess = Math.max(0, distanceSquared * 0.5 - compactThreshold)
            const compactPenalty = excess * compactWeight * 2.4
            const score = alignment * state.directionStrength
              + random() * (1 - state.directionStrength * 0.5)
              - compactPenalty
            if (score > bestScore) {
              bestScore = score
              bestFrontier = frontierIndex
            }
          }

          const current = state.frontier[bestFrontier]
          state.frontier[bestFrontier] = state.frontier[state.frontier.length - 1]
          state.frontier.pop()
          for (const neighbor of mesh.forEachNeighborOfRegion(current)) {
            if (regionPlate[neighbor] !== -1)
              continue
            regionPlate[neighbor] = plate
            state.frontier.push(neighbor)
            state.area++
            remaining--
            progressed = true
          }
        }
      }
      if (!progressed)
        break
    }

    this.assignOrphans(mesh, regionPlate)
    const smoothPasses = Math.round(3 - lowPlateFactor)
    this.smoothAndReconnect(mesh, regionPlate, plateSeeds, smoothPasses)
    const plateAngularVelocity = this.createAngularVelocities(plateSeeds.length, random)
    return { regionPlate, plateSeeds, plateAngularVelocity }
  }

  private pickSeeds(
    mesh: SphericalMesh,
    count: number,
    randomIndex: (length: number) => number,
  ): Uint32Array {
    const seeds: number[] = [randomIndex(mesh.numRegions)]
    const isSeed = new Uint8Array(mesh.numRegions)
    const minimumDistance = new Float32Array(mesh.numRegions).fill(Infinity)
    isSeed[seeds[0]] = 1
    this.updateSeedDistances(mesh, seeds[0], minimumDistance)

    while (seeds.length < count) {
      const topRegions = [-1, -1, -1]
      const topDistances = [-1, -1, -1]
      for (let region = 0; region < mesh.numRegions; region++) {
        if (isSeed[region])
          continue
        const distance = minimumDistance[region]
        for (let rank = 0; rank < 3; rank++) {
          if (distance <= topDistances[rank])
            continue
          for (let shift = 2; shift > rank; shift--) {
            topDistances[shift] = topDistances[shift - 1]
            topRegions[shift] = topRegions[shift - 1]
          }
          topDistances[rank] = distance
          topRegions[rank] = region
          break
        }
      }
      const candidates = topRegions.filter(region => region >= 0)
      if (candidates.length === 0)
        break
      const next = candidates[randomIndex(candidates.length)]
      seeds.push(next)
      isSeed[next] = 1
      this.updateSeedDistances(mesh, next, minimumDistance)
    }
    return Uint32Array.from(seeds)
  }

  private updateSeedDistances(
    mesh: SphericalMesh,
    seedRegion: number,
    minimumDistance: Float32Array,
  ): void {
    const seedIndex = seedRegion * 3
    const sx = mesh.regionPosition[seedIndex]
    const sy = mesh.regionPosition[seedIndex + 1]
    const sz = mesh.regionPosition[seedIndex + 2]
    for (let region = 0; region < mesh.numRegions; region++) {
      const index = region * 3
      const distance = 1 - (
        mesh.regionPosition[index] * sx
        + mesh.regionPosition[index + 1] * sy
        + mesh.regionPosition[index + 2] * sz
      )
      if (distance < minimumDistance[region])
        minimumDistance[region] = distance
    }
    minimumDistance[seedRegion] = 0
  }

  private createGrowthStates(
    mesh: SphericalMesh,
    seeds: Uint32Array,
    random: () => number,
    lowPlateFactor: number,
  ): GrowthState[] {
    const rateMinimum = 0.7 - lowPlateFactor * 0.4
    const rateRange = 2.3 + lowPlateFactor * 2.4
    const directionBase = 0.15 + lowPlateFactor * 0.25
    const directionScale = 0.25 + lowPlateFactor * 0.25

    return Array.from(seeds, (region) => {
      const rate = rateMinimum + random() * random() * rateRange
      const index = region * 3
      const nx = mesh.regionPosition[index]
      const ny = mesh.regionPosition[index + 1]
      const nz = mesh.regionPosition[index + 2]
      const rx = random() - 0.5
      const ry = random() - 0.5
      const rz = random() - 0.5
      const dot = rx * nx + ry * ny + rz * nz
      let dirX = rx - dot * nx
      let dirY = ry - dot * ny
      let dirZ = rz - dot * nz
      const length = Math.hypot(dirX, dirY, dirZ) || 1
      dirX /= length
      dirY /= length
      dirZ /= length
      return {
        frontier: [region],
        rate,
        dirX,
        dirY,
        dirZ,
        directionStrength: Math.min(0.85, random() * (directionBase + directionScale / rate)),
        area: 1,
      }
    })
  }

  private assignOrphans(mesh: SphericalMesh, regionPlate: Int16Array): void {
    let changed = true
    while (changed) {
      changed = false
      for (let region = 0; region < mesh.numRegions; region++) {
        if (regionPlate[region] !== -1)
          continue
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          if (regionPlate[neighbor] === -1)
            continue
          regionPlate[region] = regionPlate[neighbor]
          changed = true
          break
        }
      }
    }
  }

  private createAngularVelocities(
    plateCount: number,
    random: () => number,
  ): Float32Array {
    const angularVelocity = new Float32Array(plateCount * 3)
    for (let plate = 0; plate < plateCount; plate++) {
      const longitude = random() * Math.PI * 2
      const z = random() * 2 - 1
      const radius = Math.sqrt(Math.max(0, 1 - z * z))
      const speed = (0.5 + random() * 1.5) * (random() < 0.5 ? -1 : 1)
      const index = plate * 3
      angularVelocity[index] = radius * Math.cos(longitude) * speed
      angularVelocity[index + 1] = radius * Math.sin(longitude) * speed
      angularVelocity[index + 2] = z * speed
    }
    return angularVelocity
  }

  private smoothAndReconnect(
    mesh: SphericalMesh,
    regionPlate: Int16Array,
    seeds: Uint32Array,
    passes: number,
  ): void {
    const isSeed = new Uint8Array(mesh.numRegions)
    for (const seed of seeds)
      isSeed[seed] = 1

    for (let pass = 0; pass < passes; pass++) {
      const threshold = pass === 0 ? SMOOTH_FIRST_THRESHOLD : SMOOTH_LATER_THRESHOLD
      for (let region = 0; region < mesh.numRegions; region++) {
        if (isSeed[region])
          continue
        const counts = new Map<number, number>()
        let degree = 0
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          degree++
          const plate = regionPlate[neighbor]
          counts.set(plate, (counts.get(plate) ?? 0) + 1)
        }
        let bestPlate = regionPlate[region]
        let bestCount = 0
        for (const [plate, count] of counts) {
          if (count > bestCount || (count === bestCount && plate < bestPlate)) {
            bestPlate = plate
            bestCount = count
          }
        }
        if (bestCount > degree * threshold)
          regionPlate[region] = bestPlate
      }
    }

    this.reconnectFragments(mesh, regionPlate, seeds.length)
  }

  private reconnectFragments(
    mesh: SphericalMesh,
    regionPlate: Int16Array,
    plateCount: number,
  ): void {
    const visited = new Uint8Array(mesh.numRegions)
    const mainComponents: number[][] = Array.from({ length: plateCount }, () => [])
    for (let region = 0; region < mesh.numRegions; region++) {
      if (visited[region])
        continue
      const plate = regionPlate[region]
      const component = [region]
      visited[region] = 1
      for (let index = 0; index < component.length; index++) {
        for (const neighbor of mesh.forEachNeighborOfRegion(component[index])) {
          if (visited[neighbor] || regionPlate[neighbor] !== plate)
            continue
          visited[neighbor] = 1
          component.push(neighbor)
        }
      }
      if (component.length > mainComponents[plate].length)
        mainComponents[plate] = component
    }

    const assigned = new Uint8Array(mesh.numRegions)
    const queue: number[] = []
    for (const component of mainComponents) {
      for (const region of component) {
        assigned[region] = 1
        queue.push(region)
      }
    }
    for (let index = 0; index < queue.length; index++) {
      const region = queue[index]
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        if (assigned[neighbor])
          continue
        regionPlate[neighbor] = regionPlate[region]
        assigned[neighbor] = 1
        queue.push(neighbor)
      }
    }
  }
}
