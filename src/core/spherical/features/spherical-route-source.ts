import type {
  SphericalLineSegment,
  SphericalPoint,
  SphericalStrokePath,
} from '@/core/spherical/geometry/spherical-polyline'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type { HumanRoute, HumanRouteMode } from '@/core/spherical/spherical-world-data'
import { stitchSphericalSegments } from '@/core/spherical/geometry/spherical-polyline'

interface TradeEdge {
  mode: HumanRouteMode
  regionA: number
  regionB: number
  volume: number
}

/**
 * 将交通网络和贸易流量转换为共享球面路径。普通交通层会消除重复边，贸易层
 * 则保留每条路线的流量、颜色与宽度，便于不同视图采用各自的绘制技术。
 */
export class SphericalRouteSource {
  createNetwork(
    mesh: SphericalMesh,
    routes: readonly HumanRoute[],
    mode: HumanRouteMode,
  ): SphericalStrokePath[] {
    const points = new Map<string, SphericalPoint>()
    const segments: SphericalLineSegment[] = []
    const renderedEdges = new Set<string>()

    for (const route of routes) {
      if (route.mode !== mode)
        continue
      for (let index = 1; index < route.regions.length; index++) {
        const regionA = route.regions[index - 1]
        const regionB = route.regions[index]
        const keyA = String(regionA)
        const keyB = String(regionB)
        const edgeKey = regionA < regionB
          ? `${regionA}:${regionB}`
          : `${regionB}:${regionA}`
        if (renderedEdges.has(edgeKey))
          continue
        renderedEdges.add(edgeKey)
        points.set(keyA, this.getRegionPosition(mesh, regionA))
        points.set(keyB, this.getRegionPosition(mesh, regionB))
        segments.push({ start: keyA, end: keyB })
      }
    }

    return stitchSphericalSegments(segments, points).map(path => ({
      closed: path.closed,
      points: path.points.map(position => ({ position, width: 1 })),
    }))
  }

  createTrade(
    mesh: SphericalMesh,
    routes: readonly HumanRoute[],
    routeVolume: Float32Array,
  ): SphericalStrokePath[] {
    const edgeByKey = new Map<string, TradeEdge>()
    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
      const volume = routeVolume[routeIndex] ?? 0
      const route = routes[routeIndex]
      if (volume <= 0 || route.regions.length < 2)
        continue
      for (let index = 1; index < route.regions.length; index++) {
        const source = route.regions[index - 1]
        const target = route.regions[index]
        const regionA = Math.min(source, target)
        const regionB = Math.max(source, target)
        const key = `${route.mode}:${regionA}:${regionB}`
        const existing = edgeByKey.get(key)
        if (existing)
          existing.volume += volume
        else
          edgeByKey.set(key, { mode: route.mode, regionA, regionB, volume })
      }
    }

    const edges = [...edgeByKey.values()]
    const sortedVolumes = edges.map(edge => edge.volume).sort((a, b) => a - b)
    const scaleIndex = Math.floor(Math.max(0, sortedVolumes.length - 1) * 0.95)
    const volumeScale = Math.max(Number.EPSILON, sortedVolumes[scaleIndex] ?? 0)

    return edges.map((edge) => {
      // 平方根压缩保留中等流量路线，P95 尺度避免单条干线压扁其余层级。
      const intensity = Math.sqrt(Math.min(1, edge.volume / volumeScale))
      const color: readonly [number, number, number] = edge.mode === 'road'
        ? [
            0.5 + intensity * 0.5,
            0.27 + intensity * 0.48,
            0.08 + intensity * 0.12,
          ]
        : [
            0.1 + intensity * 0.25,
            0.4 + intensity * 0.48,
            0.5 + intensity * 0.5,
          ]
      return {
        closed: false,
        points: [edge.regionA, edge.regionB].map(region => ({
          position: this.getRegionPosition(mesh, region),
          width: 0.9 + intensity * 2.5,
          color,
        })),
      }
    })
  }

  private getRegionPosition(mesh: SphericalMesh, region: number): SphericalPoint {
    const index = region * 3
    return [
      mesh.regionPosition[index],
      mesh.regionPosition[index + 1],
      mesh.regionPosition[index + 2],
    ]
  }
}
