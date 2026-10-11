import type { Camera } from 'three'
import type { GeoJsonFeature } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { BufferAttribute, BufferGeometry, Color, Group, Points, Vector3 } from 'three'
import { resolveGeoJsonSource } from '@/core/data-source/geojson-source-runtime'
import { geographicToCartesian } from '@/core/projections/projection-math'
import { createMapMarkerMaterial } from '@/core/rendering/shared/settlement-marker-material'
import { getMapStyleLayer, isMapStyleLayerVisible, matchesMapStyleLayerFilter, resolveMapStyleLayer } from '@/core/rendering/styles/style-runtime'
import { elevationKmToDisplayCoordinate } from '@/core/simulation/geography/elevation-units'

type PointPlacement
  = | { view: 'map', projection: MapProjection, centralMeridian: number, depth: number, renderOrder: number }
    | { view: 'globe', sunlight: Vector3, terrainVerticalScale: number, usesElevationGeometry: boolean, renderOrder: number }

/** Batched GPU point attributes for any registered point source and circle style layer. */
export class StyledPointLayer {
  readonly group = new Group()
  readonly points: Points<BufferGeometry, ReturnType<typeof createMapMarkerMaterial>>

  private readonly features: GeoJsonFeature[] = []
  private readonly placement: PointPlacement
  private readonly layerId: string
  private readonly sourceId: string
  private lastStyleId: string | undefined
  private lastStyleZoom = Number.NaN

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    layerId: string,
    placement: PointPlacement,
  ) {
    this.layerId = layerId
    this.placement = placement
    this.group.name = `StyledPoints:${layerId}:${placement.view}`
    const styleLayer = getMapStyleLayer(params.appearance.mapStyle, layerId)
    this.sourceId = styleLayer?.source ?? ''
    const sourceFeatures = styleLayer?.renderer === 'circle'
      ? resolveGeoJsonSource(styleLayer.source, mesh, data, params)?.data.features ?? []
      : []
    const positions: number[] = []
    const levels: number[] = []

    for (const feature of sourceFeatures) {
      const coordinates = feature.geometry.type === 'Point'
        ? [feature.geometry.coordinates]
        : feature.geometry.type === 'MultiPoint' ? feature.geometry.coordinates : []
      if (coordinates.length === 0)
        continue
      const region = Number(feature.properties.region ?? -1)
      for (const coordinate of coordinates) {
        const [longitude, latitude] = coordinate
        if (placement.view === 'map') {
          const projected = placement.projection.project(
            longitude * Math.PI / 180,
            latitude * Math.PI / 180,
            placement.centralMeridian,
          )
          if (!projected)
            continue
          positions.push(projected.x, projected.y, placement.depth)
        }
        else {
          const elevation = region >= 0 && region < mesh.numRegions
            ? elevationKmToDisplayCoordinate(data.geography.elevation[region])
            : elevationKmToDisplayCoordinate((coordinate[2] ?? 0) / 1000)
          const offset = placement.usesElevationGeometry ? elevation * placement.terrainVerticalScale : 0
          const radius = params.core.planetRadius + offset + 0.22
          const unit = geographicToCartesian(longitude * Math.PI / 180, latitude * Math.PI / 180)
          positions.push(
            unit[0] * radius,
            unit[1] * radius,
            unit[2] * radius,
          )
        }
        this.features.push(feature)
        levels.push(Number(feature.properties.markerLevel ?? 0))
      }
    }

    const count = this.features.length
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3), 3))
    geometry.setAttribute('markerLevel', new BufferAttribute(new Float32Array(levels), 1))
    geometry.setAttribute('markerOpacity', new BufferAttribute(new Float32Array(count), 1))
    geometry.setAttribute('markerStyleScale', new BufferAttribute(new Float32Array(count), 1))
    geometry.setAttribute('markerStrokeColor', new BufferAttribute(new Float32Array(count * 3), 3))
    geometry.setAttribute('markerStrokeWidth', new BufferAttribute(new Float32Array(count), 1))
    this.points = new Points(geometry, createMapMarkerMaterial(
      placement.view === 'globe',
      placement.view === 'globe' && params.appearance.baseMap === 'satellite' && params.appearance.overlays['day-night'],
      placement.view === 'globe' ? placement.sunlight : undefined,
    ))
    this.points.renderOrder = placement.renderOrder
    this.group.add(this.points)
    if (placement.view === 'map' && placement.projection.wrapX) {
      for (const offset of [-placement.projection.worldWidth, placement.projection.worldWidth]) {
        const copy = new Points(geometry, this.points.material)
        copy.position.x = offset
        copy.renderOrder = placement.renderOrder
        this.group.add(copy)
      }
    }
    this.updateStyleZoom(params.appearance.mapStyle, 0)
  }

  updateStyleZoom(styleId: string, zoom: number): void {
    this.group.visible = isMapStyleLayerVisible(styleId, this.layerId, zoom, this.placement.view)
    if (styleId === this.lastStyleId && Math.abs(zoom - this.lastStyleZoom) < 0.03)
      return
    this.lastStyleId = styleId
    this.lastStyleZoom = zoom
    const geometry = this.points.geometry
    const colors = geometry.getAttribute('color') as BufferAttribute
    const opacities = geometry.getAttribute('markerOpacity') as BufferAttribute
    const scales = geometry.getAttribute('markerStyleScale') as BufferAttribute
    const strokeColors = geometry.getAttribute('markerStrokeColor') as BufferAttribute
    const strokeWidths = geometry.getAttribute('markerStrokeWidth') as BufferAttribute
    const color = new Color()
    const strokeColor = new Color()
    for (let index = 0; index < this.features.length; index++) {
      const properties = this.features[index].properties
      const visible = matchesMapStyleLayerFilter(styleId, this.layerId, zoom, properties)
      const paint = resolveMapStyleLayer(styleId, this.layerId, zoom, properties)?.paint
      color.set(String(paint?.['circle-color'] ?? '#FFAE59'))
      colors.setXYZ(index, color.r, color.g, color.b)
      opacities.setX(index, visible ? Number(paint?.['circle-opacity'] ?? 1) : 0)
      scales.setX(index, Number(paint?.['circle-radius'] ?? 2) / 2)
      strokeColor.set(String(paint?.['circle-stroke-color'] ?? '#000000'))
      strokeColors.setXYZ(index, strokeColor.r, strokeColor.g, strokeColor.b)
      strokeWidths.setX(index, Number(paint?.['circle-stroke-width'] ?? 0))
    }
    colors.needsUpdate = true
    opacities.needsUpdate = true
    scales.needsUpdate = true
    strokeColors.needsUpdate = true
    strokeWidths.needsUpdate = true
  }

  pickFeature(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): { sourceId: string, featureId: string | number } | null {
    if (!this.group.visible)
      return null
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const positions = this.points.geometry.getAttribute('position')
    const opacities = this.points.geometry.getAttribute('markerOpacity')
    const point = new Vector3()
    const offsets = this.placement.view === 'map' && this.placement.projection.wrapX
      ? [-this.placement.projection.worldWidth, 0, this.placement.projection.worldWidth]
      : [0]
    let nearest = 10 * 10
    let chosen: GeoJsonFeature | undefined

    for (let index = 0; index < this.features.length; index++) {
      if (opacities.getX(index) <= 0)
        continue
      point.fromBufferAttribute(positions, index)
      if (this.placement.view === 'globe' && point.dot(camera.position) <= point.lengthSq())
        continue
      for (const offset of offsets) {
        point.x += offset
        point.project(camera)
        if (point.z >= -1 && point.z <= 1) {
          const dx = (point.x + 1) * rect.width / 2 - x
          const dy = (1 - point.y) * rect.height / 2 - y
          const distance = dx * dx + dy * dy
          if (distance < nearest) {
            nearest = distance
            chosen = this.features[index]
          }
        }
        point.fromBufferAttribute(positions, index)
      }
    }
    return chosen ? { sourceId: this.sourceId, featureId: chosen.id } : null
  }

  dispose(): void {
    this.group.clear()
    this.points.geometry.dispose()
    this.points.material.dispose()
  }
}
