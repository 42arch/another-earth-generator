import type SphericalMesh from '@/core/spherical/spherical-mesh'
import { REGION_FEATURE } from '@/core/spherical/geography/region-feature'

interface WaterComponent {
  regions: number[]
  area: number
}

export class SphericalFeatureGenerator {
  generate(mesh: SphericalMesh, landMask: Uint8Array) {
    const regionFeature = new Uint8Array(mesh.numRegions).fill(REGION_FEATURE.Island)
    const regionFeatureId = new Int32Array(mesh.numRegions).fill(-1)
    const visited = new Uint8Array(mesh.numRegions)
    const waterComponents: WaterComponent[] = []

    for (let start = 0; start < mesh.numRegions; start++) {
      if (landMask[start] !== 0 || visited[start] !== 0)
        continue
      const regions = [start]
      let area = 0
      visited[start] = 1
      for (let head = 0; head < regions.length; head++) {
        const region = regions[head]
        area += mesh.regionArea[region]
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          if (landMask[neighbor] === 0 && visited[neighbor] === 0) {
            visited[neighbor] = 1
            regions.push(neighbor)
          }
        }
      }
      waterComponents.push({ regions, area })
    }

    let oceanComponent = -1
    for (let index = 0; index < waterComponents.length; index++) {
      if (
        oceanComponent === -1
        || waterComponents[index].area > waterComponents[oceanComponent].area
      ) {
        oceanComponent = index
      }
    }
    let lakeId = 0
    for (let index = 0; index < waterComponents.length; index++) {
      const isOcean = index === oceanComponent
      const feature = isOcean ? REGION_FEATURE.Ocean : REGION_FEATURE.Lake
      const featureId = isOcean ? 0 : lakeId++
      for (const region of waterComponents[index].regions) {
        regionFeature[region] = feature
        regionFeatureId[region] = featureId
      }
    }

    let islandId = 0
    visited.fill(0)
    for (let start = 0; start < mesh.numRegions; start++) {
      if (landMask[start] === 0 || visited[start] !== 0)
        continue
      const regions = [start]
      visited[start] = 1
      for (let head = 0; head < regions.length; head++) {
        const region = regions[head]
        regionFeature[region] = REGION_FEATURE.Island
        regionFeatureId[region] = islandId
        for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
          if (landMask[neighbor] !== 0 && visited[neighbor] === 0) {
            visited[neighbor] = 1
            regions.push(neighbor)
          }
        }
      }
      islandId++
    }

    return { regionFeature, regionFeatureId }
  }
}
