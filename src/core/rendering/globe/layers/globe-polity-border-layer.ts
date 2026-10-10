import type SphericalMesh from '@/core/mesh/mesh'
import type { SphericalRegionTopologyBuilder } from '@/core/rendering/shared/spherical-region-topology'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Group, Vector2 } from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { getSurfaceDaylight } from '@/core/rendering/shared/day-night-lighting'
import { createPolityBorderPaths, createPolitySmoothedCornerPositions } from '@/core/rendering/shared/polity-border-geometry'

const OCEAN_DEPTH_SCALE = 0.3

export class GlobePolityBorderLayer {
  readonly group = new Group()

  private geometries: LineGeometry[] = []
  private material: LineMaterial | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    terrainVerticalScale: number,
    usesElevationGeometry: boolean,
    smoothedRegionCorners: Float32Array | null,
    regionTopologyBuilder: SphericalRegionTopologyBuilder,
    canvasWidth: number,
    canvasHeight: number,
    sunPosition: { x: number, y: number, z: number },
  ) {
    this.group.name = 'GlobePolityBorders'
    this.build(mesh, data, params, terrainVerticalScale, usesElevationGeometry, smoothedRegionCorners, regionTopologyBuilder, canvasWidth, canvasHeight, sunPosition)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    terrainVerticalScale: number,
    usesElevationGeometry: boolean,
    smoothedRegionCorners: Float32Array | null,
    regionTopologyBuilder: SphericalRegionTopologyBuilder,
    canvasWidth: number,
    canvasHeight: number,
    sunPosition: { x: number, y: number, z: number },
  ): void {
    if (!params.appearance.overlays['nation-borders'] || !data.society?.polities) {
      return
    }

    const scale = usesElevationGeometry ? terrainVerticalScale : 0
    const smoothedCorners = this.getRegionSmoothingMode(params) === 'polities' && smoothedRegionCorners
      ? smoothedRegionCorners
      : createPolitySmoothedCornerPositions(mesh, data, regionTopologyBuilder)

    const paths = createPolityBorderPaths(
      mesh,
      data,
      params.core.planetRadius + 0.32,
      scale,
      OCEAN_DEPTH_SCALE,
      smoothedCorners,
    )

    if (paths.length === 0) {
      return
    }

    this.material = new LineMaterial({
      color: 0x747A80,
      vertexColors: true,
      linewidth: 3.4,
      dashed: true,
      dashSize: 1.5,
      gapSize: 1,
      resolution: new Vector2(Math.max(1, canvasWidth), Math.max(1, canvasHeight)),
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    })

    for (const path of paths) {
      const points = path.closed ? [...path.points, path.points[0]] : path.points
      const geometry = new LineGeometry().setPositions(points.flatMap(point => point))
      const colors = points.flatMap((point) => {
        const brightness = params.appearance.overlays['day-night']
          ? getSurfaceDaylight(point[0], point[1], point[2], sunPosition.x, sunPosition.y, sunPosition.z)
          : 1
        return [brightness, brightness, brightness]
      })
      geometry.setColors(colors)
      const line = new Line2(geometry, this.material)
      line.computeLineDistances()
      line.renderOrder = 7
      this.group.add(line)
      this.geometries.push(geometry)
    }
  }

  private getRegionSmoothingMode(params: WorldConfig): string | null {
    const mode = params.appearance.baseMap
    if (mode === 'polities' || mode === 'polities-smoothed')
      return 'polities'
    return null
  }

  updateLineWidth(_zoom: number): void {
    // Currently Globe does not dynamically adjust polity border width on zoom, but can be added if needed
  }

  updateViewport(width: number, height: number): void {
    if (this.material) {
      this.material.resolution.set(Math.max(1, width), Math.max(1, height))
    }
  }

  dispose(): void {
    this.group.clear()
    for (const g of this.geometries) g.dispose()
    this.geometries = []
    this.material?.dispose()
  }
}
