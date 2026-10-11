import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Group } from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { cartesianToGeographic, unwrapLongitudeNear } from '@/core/projections/projection-math'
import { createClimateVectorGeometry } from '@/core/rendering/shared/climate-vector-geometry'

export class MapClimateVectorLayer {
  readonly group = new Group()

  private geometries: LineGeometry[] = []
  private material: LineMaterial | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ) {
    this.group.name = 'MapClimateVectors'
    this.build(mesh, data, params, projection, centralMeridian)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ): void {
    const mode = params.appearance.baseMap
    const vectors = data.climate?.displayVector
    if (!mesh || !data || (mode !== 'wind' && mode !== 'ocean-current') || vectors?.kind !== mode) {
      return
    }

    const geometry = createClimateVectorGeometry(mesh, vectors, data.geography.landMask, 1)
    this.addProjectedSourceGeometry(
      geometry,
      mode === 'wind' ? 0xA9FFF1 : 0xFFFFFF,
      0.94,
      0.4,
      5,
      mode === 'ocean-current',
      projection,
      centralMeridian,
    )
  }

  private addProjectedSourceGeometry(
    sourceGeometry: ReturnType<typeof createClimateVectorGeometry>,
    color: number,
    opacity: number,
    depthOffset: number,
    renderOrder: number,
    isOceanCurrent: boolean,
    projection: MapProjection,
    centralMeridian: number,
  ): void {
    const lines = sourceGeometry.userData.lines as number[][][]
    const geometries: LineGeometry[] = []

    this.material = new LineMaterial({
      color,
      linewidth: 1.2,
      worldUnits: false,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
    })

    const group = new Group()
    const worldOffsets = projection.wrapX
      ? [-projection.worldWidth, 0, projection.worldWidth]
      : [0]

    for (const worldOffset of worldOffsets) {
      const fragments: number[][][] = []

      for (const line of lines) {
        if (line.length < 2)
          continue

        let current: number[][] = []
        let lastLon = Number.POSITIVE_INFINITY

        for (let i = 0; i < line.length; i++) {
          const pt = line[i]
          const geo = cartesianToGeographic(pt[0], pt[1], pt[2])
          const lon = unwrapLongitudeNear(geo.longitude, lastLon)
          const lat = geo.latitude
          lastLon = lon

          const p = projection.project(lon, lat, centralMeridian)
          if (!p) {
            if (current.length >= 2)
              fragments.push(current)
            current = []
            continue
          }

          if (isOceanCurrent && i > 0) {
            const last = line[i - 1]
            const distSq = (pt[0] - last[0]) ** 2 + (pt[1] - last[1]) ** 2 + (pt[2] - last[2]) ** 2
            if (distSq > 0.05) {
              if (current.length >= 2)
                fragments.push(current)
              current = []
            }
          }

          const end3 = [p.x + worldOffset, p.y, depthOffset]
          if (current.length > 0) {
            const lastP = current[current.length - 1]
            const dx = end3[0] - lastP[0]
            if (Math.abs(dx) > projection.worldWidth * 0.5) {
              if (current.length >= 2)
                fragments.push(current)
              current = []
            }
          }
          current.push(end3)
        }
        if (current.length >= 2)
          fragments.push(current)
      }

      for (const fragment of fragments) {
        const geometry = new LineGeometry().setPositions(fragment.flatMap(point => point))
        const lineMesh = new Line2(geometry, this.material)
        lineMesh.computeLineDistances()
        lineMesh.renderOrder = renderOrder
        group.add(lineMesh)
        geometries.push(geometry)
      }
    }

    if (geometries.length === 0) {
      this.material.dispose()
      this.material = null
      return
    }

    this.group.add(group)
    this.geometries = geometries
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
    for (const g of this.geometries) {
      g.dispose()
    }
    this.geometries = []
    this.material?.dispose()
  }
}
