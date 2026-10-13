import type { Camera } from 'three'
import type { GeoJsonFeatureCollection, GeoJsonPosition } from '@/core/data-source'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { StyledLayerBehavior, StyledLayerUpdateContext, ViewportUpdatableLayer } from '@/core/rendering/shared/styled/styled-layer-behavior'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import {
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  Vector3,
} from 'three'
import { resolveGeoJsonSource } from '@/core/data-source'
import { geographicToCartesian } from '@/core/projections/projection-math'
import { RiverGeometry, riverStrokePaths } from '@/core/rendering/shared/geometries/river-geometry'
import { MapRibbonGeometry } from '@/core/rendering/shared/geometries/ribbon-geometry'
import { MapRibbonMaterial } from '@/core/rendering/shared/geometries/ribbon-material'
import { addWrappedCopies } from '@/core/rendering/shared/layers/wrap-copies'
import { pickGeoJsonLineFeature } from '@/core/rendering/shared/picking/geojson-line-picking'
import { elevationKmToDisplayCoordinate } from '@/core/simulation/geography/elevation-units'
import { getMapStylePaint, isMapStyleLayerVisible } from '@/core/styles'

export type RiverPlacement
  = | {
    view: 'globe'
    planetRadius: number
    terrainVerticalScale: number
    usesElevationGeometry: boolean
  }
    | {
      view: 'map'
      projection: MapProjection
      centralMeridian: number
      viewportWidth: number
      viewportHeight: number
    }

/**
 * 统一样式河流图层：支持 3D 球面网格构建与 2D 投影屏幕空间自适应丝带渲染
 */
export class StyledRiverLayer implements StyledLayerBehavior, ViewportUpdatableLayer {
  readonly group = new Group()

  private globeGeometry: ReturnType<RiverGeometry['createFromPaths']> | null = null
  private globeMaterial: MeshLambertMaterial | null = null
  private basePositions: Float32Array | null = null
  private baseStyleWidth = 1
  private lastAppliedStyleWidth = Number.NaN

  private mapGeometry: ReturnType<MapRibbonGeometry['create']> | null = null
  private mapMaterial: MapRibbonMaterial | null = null

  private source: GeoJsonFeatureCollection | null = null
  private readonly placement: RiverPlacement

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    placement: RiverPlacement,
  ) {
    this.placement = placement
    this.group.name = placement.view === 'globe' ? 'GlobeRivers' : 'MapRivers'
    this.build(mesh, data, params, placement)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    placement: RiverPlacement,
  ): void {
    if (!params.appearance.overlays.rivers)
      return

    const source = resolveGeoJsonSource('river-network', mesh, data, params)?.data
    if (!source)
      return
    this.source = source

    const styleId = params.appearance.mapStyle
    const opacity = Number(getMapStylePaint(styleId, 'rivers', 'line-opacity', 0) ?? 0.8)

    const colorLookup = (flowAccumulation: number, order: number): [number, number, number] => {
      const color = new Color(String(getMapStylePaint(styleId, 'rivers', 'line-color', 0, { flowAccumulation, order }) ?? '#6C9FB5'))
      return [color.r, color.g, color.b]
    }

    if (placement.view === 'globe') {
      const riverClearance = placement.usesElevationGeometry ? 0.22 : 0.05
      this.baseStyleWidth = Number(getMapStylePaint(styleId, 'rivers', 'line-width', 0) ?? 1)

      const builder = new RiverGeometry()
      this.globeGeometry = builder.createFromPaths(
        riverStrokePaths(
          source,
          colorLookup,
          placement.usesElevationGeometry ? placement.terrainVerticalScale : 0,
          this.baseStyleWidth,
        ),
        placement.planetRadius + riverClearance,
      )

      if ((this.globeGeometry.getAttribute('position')?.count ?? 0) === 0) {
        this.globeGeometry.dispose()
        this.globeGeometry = null
        return
      }

      this.globeMaterial = new MeshLambertMaterial({
        color: 0xFFFFFF,
        vertexColors: true,
        depthTest: true,
        depthWrite: false,
        transparent: true,
        opacity,
        side: DoubleSide,
        toneMapped: false,
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: NotEqualStencilFunc,
        stencilZPass: ReplaceStencilOp,
      })
      this.basePositions = (this.globeGeometry.getAttribute('position').array as Float32Array).slice()

      const meshCopy = new Mesh(this.globeGeometry, this.globeMaterial)
      meshCopy.renderOrder = 7
      this.group.add(meshCopy)
    }
    else {
      const builder = new MapRibbonGeometry()
      this.mapGeometry = builder.create(
        riverStrokePaths(source, colorLookup),
        placement.projection,
        placement.centralMeridian,
        0.3,
      )

      if ((this.mapGeometry.getAttribute('position')?.count ?? 0) === 0) {
        this.mapGeometry.dispose()
        this.mapGeometry = null
        return
      }

      this.mapMaterial = new MapRibbonMaterial(
        0xFFFFFF,
        opacity,
        placement.viewportWidth,
        placement.viewportHeight,
      )

      const layer = new Mesh(this.mapGeometry, this.mapMaterial)
      layer.renderOrder = 7
      addWrappedCopies(this.group, layer, placement.projection)
    }
  }

  updateWidthScale(zoomOrWidth: number, styleWidth = 1): void {
    if (this.placement.view === 'globe') {
      if (!this.globeGeometry || !this.basePositions || Math.abs(zoomOrWidth - this.lastAppliedStyleWidth) < 0.1)
        return
      this.lastAppliedStyleWidth = zoomOrWidth
      const positions = this.globeGeometry.getAttribute('position')
      const values = positions.array as Float32Array
      const scale = zoomOrWidth / Math.max(this.baseStyleWidth, Number.EPSILON)
      for (let vertex = 0; vertex + 1 < positions.count; vertex += 2) {
        const offset = vertex * 3
        const next = offset + 3
        for (let axis = 0; axis < 3; axis++) {
          const center = (this.basePositions[offset + axis] + this.basePositions[next + axis]) * 0.5
          values[offset + axis] = center + (this.basePositions[offset + axis] - center) * scale
          values[next + axis] = center + (this.basePositions[next + axis] - center) * scale
        }
      }
      positions.needsUpdate = true
    }
    else if (this.mapMaterial) {
      this.mapMaterial.setWidthScale(Math.min(15000, 100 * zoomOrWidth * styleWidth))
    }
  }

  updateStyle(context: StyledLayerUpdateContext): void {
    const isVisible = isMapStyleLayerVisible(context.styleId, context.layerId, context.styleZoom, this.placement.view)
    this.group.visible = isVisible
    if (!isVisible)
      return

    const styleWidth = Number(getMapStylePaint(context.styleId, context.layerId, 'line-width', context.styleZoom) ?? 1)
    if (this.placement.view === 'globe') {
      this.updateWidthScale(styleWidth)
    }
    else {
      this.updateWidthScale(context.viewZoom, styleWidth)
    }
  }

  updateViewport(width: number, height: number): void {
    if (this.placement.view === 'map' && this.mapMaterial) {
      this.mapMaterial.setResolution(width, height)
    }
  }

  pickGeoJsonFeature(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): { sourceId: string, featureId: string | number } | null {
    if (!this.group.visible || !this.source)
      return null

    if (this.placement.view === 'globe') {
      const placement = this.placement
      const featureId = pickGeoJsonLineFeature(this.source, event, canvas, camera, (coordinate: GeoJsonPosition) => {
        const unit = geographicToCartesian(coordinate[0] * Math.PI / 180, coordinate[1] * Math.PI / 180)
        const terrain = placement.usesElevationGeometry
          ? elevationKmToDisplayCoordinate((coordinate[2] ?? 0) / 1000) * placement.terrainVerticalScale
          : 0
        const radius = placement.planetRadius + (placement.usesElevationGeometry ? 0.22 : 0.05) + terrain
        return [new Vector3(unit[0] * radius, unit[1] * radius, unit[2] * radius)]
      }, point => point.dot(camera.position) <= point.lengthSq())
      return featureId === null ? null : { sourceId: 'river-network', featureId }
    }

    const placement = this.placement
    const featureId = pickGeoJsonLineFeature(this.source, event, canvas, camera, (coordinate: GeoJsonPosition) => {
      const projected = placement.projection.project(coordinate[0] * Math.PI / 180, coordinate[1] * Math.PI / 180, placement.centralMeridian)
      if (!projected)
        return []
      const offsets = placement.projection.wrapX ? [-placement.projection.worldWidth, 0, placement.projection.worldWidth] : [0]
      return offsets.map(offset => new Vector3(projected.x + offset, projected.y, 0.3))
    })
    return featureId === null ? null : { sourceId: 'river-network', featureId }
  }

  dispose(): void {
    this.group.clear()
    this.globeGeometry?.dispose()
    this.globeGeometry = null
    this.globeMaterial?.dispose()
    this.globeMaterial = null

    this.mapGeometry?.dispose()
    this.mapGeometry = null
    this.mapMaterial?.dispose()
    this.mapMaterial = null
  }
}
