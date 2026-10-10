import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { SphericalRegionTopologyBuilder } from '@/core/rendering/shared/spherical-region-topology'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Group, Vector2 } from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { cartesianToGeographic, unwrapLongitudeNear, wrapLongitude } from '@/core/projections/projection-math'
import { createPolityBorderPaths, createPolitySmoothedCornerPositions } from '@/core/rendering/shared/polity-border-geometry'

const FULL_LONGITUDE = Math.PI * 2

export class MapPolityBorderLayer {
  readonly group = new Group()

  private geometries: LineGeometry[] = []
  private material: LineMaterial | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
    smoothedRegionCorners: Float32Array | null,
    regionTopologyBuilder: SphericalRegionTopologyBuilder,
    viewportWidth: number,
    viewportHeight: number,
  ) {
    this.group.name = 'MapPolityBorders'
    this.build(mesh, data, params, projection, centralMeridian, smoothedRegionCorners, regionTopologyBuilder, viewportWidth, viewportHeight)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
    smoothedRegionCorners: Float32Array | null,
    regionTopologyBuilder: SphericalRegionTopologyBuilder,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    if (!params.appearance.overlays['nation-borders'] || !data.society?.polities) {
      return
    }

    const smoothedCorners = this.getRegionSmoothingMode(params) === 'polities' && smoothedRegionCorners
      ? smoothedRegionCorners
      : createPolitySmoothedCornerPositions(mesh, data, regionTopologyBuilder)

    const paths = createPolityBorderPaths(mesh, data, 1, 0, 1, smoothedCorners)

    this.material = new LineMaterial({
      color: 0x747A80,
      linewidth: 3.4,
      dashed: true,
      dashSize: 0.05,
      gapSize: 0.035,
      resolution: new Vector2(viewportWidth, viewportHeight),
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    })

    for (const path of paths) {
      const geographic = path.points.map((point) => {
        const location = cartesianToGeographic(point[0], point[1], point[2])
        return {
          longitude: wrapLongitude(location.longitude - centralMeridian),
          latitude: location.latitude,
        }
      })
      for (let index = 1; index < geographic.length; index++) {
        geographic[index].longitude = unwrapLongitudeNear(
          geographic[index].longitude,
          geographic[index - 1].longitude,
        )
      }
      if (path.closed) {
        const first = geographic[0]
        geographic.push({
          ...first,
          longitude: unwrapLongitudeNear(first.longitude, geographic[geographic.length - 1].longitude),
        })
      }

      const fragments: [number, number, number][][] = []
      for (const worldOffset of [-FULL_LONGITUDE, 0, FULL_LONGITUDE]) {
        let current: [number, number, number][] = []
        for (let index = 1; index < geographic.length; index++) {
          const start = { ...geographic[index - 1], longitude: geographic[index - 1].longitude + worldOffset }
          const end = { ...geographic[index], longitude: geographic[index].longitude + worldOffset }
          const clipped = clipBorderSegment(
            start,
            end,
            -Math.PI,
            Math.PI,
            projection.minimumLatitude,
            projection.maximumLatitude,
          )
          if (!clipped) {
            if (current.length >= 2)
              fragments.push(current)
            current = []
            continue
          }
          const projectedStart = projection.projectRelative(clipped[0].longitude, clipped[0].latitude)
          const projectedEnd = projection.projectRelative(clipped[1].longitude, clipped[1].latitude)
          if (!projectedStart || !projectedEnd) {
            if (current.length >= 2)
              fragments.push(current)
            current = []
            continue
          }
          const start3: [number, number, number] = [projectedStart.x, projectedStart.y, 0.35]
          const end3: [number, number, number] = [projectedEnd.x, projectedEnd.y, 0.35]
          const last = current[current.length - 1]
          if (last && Math.hypot(last[0] - start3[0], last[1] - start3[1]) > 1e-6) {
            if (current.length >= 2)
              fragments.push(current)
            current = []
          }
          if (current.length === 0)
            current.push(start3)
          current.push(end3)
        }
        if (current.length >= 2)
          fragments.push(current)
      }

      for (const fragment of fragments) {
        const geometry = new LineGeometry().setPositions(fragment.flatMap(point => point))
        const line = new Line2(geometry, this.material)
        line.computeLineDistances()
        line.renderOrder = 6
        this.group.add(line)
        this.geometries.push(geometry)
      }
    }

    if (this.geometries.length === 0) {
      this.material.dispose()
      this.material = null
      return
    }

    if (!projection.wrapX) {
      // In non-wrapping projections (like Orthographic), we don't actually need to copy.
      // The old logic generated all copies above based on [-FULL_LONGITUDE, 0, FULL_LONGITUDE].
      // Wait, in map/view.ts, the fragments loop iterates over the offsets.
      // So the wrappers are ALREADY created inside the group.
      // BUT they only created `[-FULL_LONGITUDE, 0, FULL_LONGITUDE]` unconditionally!
      // In `addPolityBorders`, the worldOffsets loop was hardcoded to `[-FULL_LONGITUDE, 0, FULL_LONGITUDE]`.
    }
  }

  private getRegionSmoothingMode(params: WorldConfig): string | null {
    const mode = params.appearance.baseMap
    if (mode === 'polities' || mode === 'polities-smoothed')
      return 'polities'
    return null
  }

  updateLineWidth(zoom: number): void {
    if (this.material) {
      this.material.linewidth = Math.max(1.0, 3.4 / Math.sqrt(zoom))
    }
  }

  updateViewport(width: number, height: number): void {
    if (this.material) {
      this.material.resolution.set(width, height)
    }
  }

  dispose(): void {
    this.group.clear()
    for (const g of this.geometries) g.dispose()
    this.geometries = []
    this.material?.dispose()
  }
}

function clipBorderSegment(
  start: { longitude: number, latitude: number },
  end: { longitude: number, latitude: number },
  minimumLongitude: number,
  maximumLongitude: number,
  minimumLatitude: number,
  maximumLatitude: number,
): readonly [{ longitude: number, latitude: number }, { longitude: number, latitude: number }] | null {
  let minimumAmount = 0
  let maximumAmount = 1
  const axes = [
    [start.longitude, end.longitude - start.longitude, minimumLongitude, maximumLongitude],
    [start.latitude, end.latitude - start.latitude, minimumLatitude, maximumLatitude],
  ] as const
  for (const [origin, difference, minimum, maximum] of axes) {
    if (Math.abs(difference) <= Number.EPSILON) {
      if (origin < minimum || origin > maximum)
        return null
      continue
    }
    const amountA = (minimum - origin) / difference
    const amountB = (maximum - origin) / difference
    minimumAmount = Math.max(minimumAmount, Math.min(amountA, amountB))
    maximumAmount = Math.min(maximumAmount, Math.max(amountA, amountB))
    if (minimumAmount > maximumAmount)
      return null
  }
  if (maximumAmount - minimumAmount <= 1e-12)
    return null
  const interpolate = (amount: number) => ({
    longitude: start.longitude + (end.longitude - start.longitude) * amount,
    latitude: start.latitude + (end.latitude - start.latitude) * amount,
  })
  return [interpolate(minimumAmount), interpolate(maximumAmount)]
}
