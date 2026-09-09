import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type {
  SphericalMaritimeContact,
  SphericalSettlement,
} from '@/core/spherical/society/society-data'
import type { SphericalClimateData } from '@/core/spherical/climate/climate-data'
import { REGION_FEATURE } from '@/core/spherical/geography/region-feature'
import { findSphericalPath } from '@/core/spherical/algorithms/pathfinder'
import { clamp, dot3 } from '@/core/spherical/geometry/spherical-math'

interface MaritimeGateway {
  component: number
  settlement: number
  landRegion: number
  oceanRegion: number
  score: number
}

export interface SphericalMaritimeContactGeneratorInput {
  landMask: Uint8Array
  regionFeature: Uint8Array
  climate: SphericalClimateData
  settlements: SphericalSettlement[]
}

export class SphericalMaritimeContactGenerator {
  generate(
    mesh: SphericalMesh,
    input: SphericalMaritimeContactGeneratorInput,
    params: GlobeGenParams,
  ): SphericalMaritimeContact[] {
    const component = this.buildLandComponents(mesh, input.landMask)
    const gateways = this.findComponentGateways(mesh, input, component)
    if (gateways.length < 2)
      return []

    const pairKeys = new Set<string>()
    const pairs: Array<[MaritimeGateway, MaritimeGateway]> = []
    const connectionCount = 1 + Math.round(clamp(params.shippingRouteDensity, 0, 1))
    const maximumRange = clamp(
      params.shippingMaxRange * (0.58 + params.shippingRouteDensity * 0.18),
      0.12,
      Math.PI,
    )
    for (const source of gateways) {
      const nearest = gateways
        .filter(target => target.component !== source.component)
        .map(target => ({
          target,
          distance: mesh.distanceBetweenRegions(source.landRegion, target.landRegion),
        }))
        .filter(candidate => candidate.distance <= maximumRange)
        .sort((a, b) => a.distance - b.distance || a.target.component - b.target.component)
      for (let index = 0; index < Math.min(connectionCount, nearest.length); index++) {
        const target = nearest[index].target
        const low = Math.min(source.component, target.component)
        const high = Math.max(source.component, target.component)
        const key = `${low}:${high}`
        if (pairKeys.has(key))
          continue
        pairKeys.add(key)
        pairs.push([source, target])
      }
    }

    const contacts: SphericalMaritimeContact[] = []
    const cellAngle = Math.sqrt(4 * Math.PI / mesh.numRegions)
    for (const [source, target] of pairs) {
      const forward = this.createContact(
        mesh,
        input,
        source,
        target,
        maximumRange,
        cellAngle,
        params,
      )
      if (forward)
        contacts.push(forward)
      const reverse = this.createContact(
        mesh,
        input,
        target,
        source,
        maximumRange,
        cellAngle,
        params,
      )
      if (reverse)
        contacts.push(reverse)
    }
    return contacts
  }

  private createContact(
    mesh: SphericalMesh,
    input: SphericalMaritimeContactGeneratorInput,
    source: MaritimeGateway,
    target: MaritimeGateway,
    maximumRange: number,
    cellAngle: number,
    params: GlobeGenParams,
  ): SphericalMaritimeContact | null {
    const edgeCost = (from: number, to: number) => this.sailingCost(
      mesh,
      input,
      from,
      to,
      cellAngle,
      maximumRange,
      params,
    )
    const path = findSphericalPath(mesh, source.oceanRegion, target.oceanRegion, {
      isPassable: region => input.regionFeature[region] === REGION_FEATURE.Ocean,
      edgeCost,
      heuristicCost: (region, destination) => (
        mesh.distanceBetweenRegions(region, destination) / cellAngle * 0.3
      ),
    })
    if (path.length === 0)
      return null

    let distance = mesh.distanceBetweenRegions(source.landRegion, source.oceanRegion)
      + mesh.distanceBetweenRegions(target.oceanRegion, target.landRegion)
    let baseCost = distance / cellAngle
    for (let index = 1; index < path.length; index++) {
      const from = path[index - 1]
      const to = path[index]
      distance += mesh.distanceBetweenRegions(from, to)
      baseCost += edgeCost(from, to)
    }
    if (distance > maximumRange * 1.45)
      return null
    const rangeRatio = clamp(distance / maximumRange, 0, 1.5)
    const reliability = clamp(
      0.94 - rangeRatio * 0.48 - params.shippingOpenOceanRisk * rangeRatio * 0.18,
      0.18,
      0.96,
    )
    const sourceSettlement = input.settlements[source.settlement]
    const targetSettlement = input.settlements[target.settlement]
    const settlementStrength = Math.sqrt(
      Math.max(1, sourceSettlement.population)
      * Math.max(1, targetSettlement.population),
    )
    const populationFactor = clamp(Math.log1p(settlementStrength) / 11, 0.15, 1)
    const strength = clamp(
      reliability * 0.58
      + populationFactor * 0.24
      + Math.min(sourceSettlement.baseProsperity, targetSettlement.baseProsperity) * 0.18,
      0.12,
      1,
    )
    return {
      sourceSettlement: source.settlement,
      targetSettlement: target.settlement,
      sourceRegion: source.landRegion,
      targetRegion: target.landRegion,
      distance,
      baseCost,
      reliability,
      strength,
    }
  }

  private sailingCost(
    mesh: SphericalMesh,
    input: SphericalMaritimeContactGeneratorInput,
    from: number,
    to: number,
    cellAngle: number,
    maximumRange: number,
    params: GlobeGenParams,
  ): number {
    const fromIndex = from * 3
    const toIndex = to * 3
    const fx = mesh.regionPosition[fromIndex]
    const fy = mesh.regionPosition[fromIndex + 1]
    const fz = mesh.regionPosition[fromIndex + 2]
    const tx = mesh.regionPosition[toIndex]
    const ty = mesh.regionPosition[toIndex + 1]
    const tz = mesh.regionPosition[toIndex + 2]
    const radialProjection = dot3(fx, fy, fz, tx, ty, tz)
    let dx = tx - fx * radialProjection
    let dy = ty - fy * radialProjection
    let dz = tz - fz * radialProjection
    const directionLength = Math.hypot(dx, dy, dz) || 1
    dx /= directionLength
    dy /= directionLength
    dz /= directionLength
    const currentIndex = from * 3
    const currentAssist = dot3(
      input.climate.oceanCurrent[currentIndex],
      input.climate.oceanCurrent[currentIndex + 1],
      input.climate.oceanCurrent[currentIndex + 2],
      dx,
      dy,
      dz,
    )
    const windAssist = dot3(
      input.climate.wind[currentIndex],
      input.climate.wind[currentIndex + 1],
      input.climate.wind[currentIndex + 2],
      dx,
      dy,
      dz,
    )
    const effectiveSpeed = clamp(
      1
      + currentAssist * params.shippingCurrentInfluence * 0.48
      + windAssist * params.shippingWindInfluence * 0.3,
      0.28,
      2.25,
    )
    const distance = mesh.distanceBetweenRegions(from, to)
    const coldRisk = clamp((2 - input.climate.seaSurfaceTemperature[from]) / 14, 0, 1) * 0.45
    const openOceanRisk = clamp(distance / maximumRange, 0, 1)
      * params.shippingOpenOceanRisk
      * 0.4
    return distance / cellAngle / effectiveSpeed * (1 + coldRisk + openOceanRisk)
  }

  private findComponentGateways(
    mesh: SphericalMesh,
    input: SphericalMaritimeContactGeneratorInput,
    component: Int32Array,
  ): MaritimeGateway[] {
    const best = new Map<number, MaritimeGateway>()
    for (let settlement = 0; settlement < input.settlements.length; settlement++) {
      const candidate = input.settlements[settlement]
      if (!candidate.isPort)
        continue
      let oceanRegion = -1
      for (const neighbor of mesh.forEachNeighborOfRegion(candidate.region)) {
        if (
          input.regionFeature[neighbor] === REGION_FEATURE.Ocean
          && (oceanRegion < 0 || neighbor < oceanRegion)
        ) {
          oceanRegion = neighbor
        }
      }
      const landComponent = component[candidate.region]
      if (landComponent < 0 || oceanRegion < 0)
        continue
      const score = Math.log1p(candidate.population) * (0.72 + candidate.baseProsperity * 0.28)
      const current = best.get(landComponent)
      if (!current || score > current.score) {
        best.set(landComponent, {
          component: landComponent,
          settlement,
          landRegion: candidate.region,
          oceanRegion,
          score,
        })
      }
    }
    return [...best.values()]
  }

  private buildLandComponents(mesh: SphericalMesh, landMask: Uint8Array): Int32Array {
    const component = new Int32Array(mesh.numRegions).fill(-1)
    let componentId = 0
    for (let start = 0; start < mesh.numRegions; start++) {
      if (landMask[start] === 0 || component[start] >= 0)
        continue
      const queue = [start]
      component[start] = componentId
      for (let head = 0; head < queue.length; head++) {
        const region = queue[head]
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          if (landMask[neighbor] !== 0 && component[neighbor] < 0) {
            component[neighbor] = componentId
            queue.push(neighbor)
          }
        }
      }
      componentId++
    }
    return component
  }
}
