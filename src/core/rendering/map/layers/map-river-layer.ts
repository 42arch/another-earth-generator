import type { Camera } from 'three'
import type { GeoJsonFeatureCollection, GeoJsonPosition } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Color, Group, Mesh, Vector3 } from 'three'
import { resolveGeoJsonSource } from '@/core/data-source/geojson-source-runtime'
import { riverStrokePaths } from '@/core/data-source/river-geojson'
import { MapRibbonGeometry } from '@/core/rendering/map/ribbon-geometry'
import { MapRibbonMaterial } from '@/core/rendering/map/ribbon-material'
import { pickGeoJsonLineFeature } from '@/core/rendering/shared/geojson-line-picking'
import { getMapStylePaint } from '@/core/rendering/styles/style-runtime'

export class MapRiverLayer {
  readonly group = new Group()

  private riverRibbonGeometryBuilder = new MapRibbonGeometry()

  private geometry: ReturnType<typeof this.riverRibbonGeometryBuilder.create> | null = null
  private material: MapRibbonMaterial | null = null
  private source: GeoJsonFeatureCollection | null = null
  private readonly projection: MapProjection
  private readonly centralMeridian: number

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
    viewportWidth: number,
    viewportHeight: number,
  ) {
    this.group.name = 'MapRivers'
    this.projection = projection
    this.centralMeridian = centralMeridian
    this.build(mesh, data, params, projection, centralMeridian, viewportWidth, viewportHeight)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    if (!params.appearance.overlays.rivers) {
      return
    }

    const source = resolveGeoJsonSource('river-network', mesh, data, params)?.data
    if (!source)
      return
    this.source = source
    this.geometry = this.riverRibbonGeometryBuilder.create(
      riverStrokePaths(source, (flowAccumulation, order) => {
        const color = new Color(String(getMapStylePaint(params.appearance.mapStyle, 'rivers', 'line-color', 0, { flowAccumulation, order }) ?? '#6C9FB5'))
        return [color.r, color.g, color.b]
      }),
      projection,
      centralMeridian,
      0.3,
    )

    if ((this.geometry.getAttribute('position')?.count ?? 0) === 0) {
      this.geometry.dispose()
      this.geometry = null
      return
    }

    this.material = new MapRibbonMaterial(
      0xFFFFFF,
      Number(getMapStylePaint(params.appearance.mapStyle, 'rivers', 'line-opacity', 0) ?? 0.8),
      viewportWidth,
      viewportHeight,
    )

    const layer = new Mesh(this.geometry, this.material)
    layer.renderOrder = 7
    this.addWrappedCopies(layer, projection)
  }

  private addWrappedCopies(baseLayer: Mesh, projection: MapProjection): void {
    this.group.add(baseLayer)
    if (projection.wrapX) {
      const leftCopy = new Mesh(baseLayer.geometry, baseLayer.material)
      leftCopy.position.x = -projection.worldWidth
      leftCopy.renderOrder = baseLayer.renderOrder

      const rightCopy = new Mesh(baseLayer.geometry, baseLayer.material)
      rightCopy.position.x = projection.worldWidth
      rightCopy.renderOrder = baseLayer.renderOrder

      this.group.add(leftCopy, rightCopy)
    }
  }

  updateWidthScale(zoom: number, styleWidth = 1): void {
    if (this.material) {
      // Base scale 100 multiplied by zoom ensures rivers shrink when zooming out
      // and grow proportionally when zooming in. Capped at 15000 to prevent overflow at zoom 300.
      this.material.setWidthScale(Math.min(15000, 100 * zoom * styleWidth))
    }
  }

  updateViewport(width: number, height: number): void {
    if (this.material) {
      this.material.setResolution(width, height)
    }
  }

  pickFeature(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): { sourceId: string, featureId: string | number } | null {
    if (!this.group.visible || !this.source)
      return null
    const featureId = pickGeoJsonLineFeature(this.source, event, canvas, camera, (coordinate: GeoJsonPosition) => {
      const projected = this.projection.project(coordinate[0] * Math.PI / 180, coordinate[1] * Math.PI / 180, this.centralMeridian)
      if (!projected)
        return []
      const offsets = this.projection.wrapX ? [-this.projection.worldWidth, 0, this.projection.worldWidth] : [0]
      return offsets.map(offset => new Vector3(projected.x + offset, projected.y, 0.3))
    })
    return featureId === null ? null : { sourceId: 'river-network', featureId }
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.material?.dispose()
  }
}
