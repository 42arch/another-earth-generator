import type { Camera } from 'three'
import type { GeoJsonFeature, GeoJsonPosition } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { BufferAttribute, BufferGeometry, Color, Group, LineBasicMaterial, LineSegments, Vector3 } from 'three'
import { resolveGeoJsonSource } from '@/core/data-source/geojson-source-runtime'
import { getMapStyleSource } from '@/core/data-source/source-registry'
import { getSurfaceDaylight } from '@/core/math/daylight'
import { geographicToCartesian } from '@/core/projections/projection-math'
import { MapLineGeometry } from '@/core/rendering/map/line-geometry'
import { getMapStyleDocument, getMapStyleLayer, isMapStyleLayerVisible, matchesMapStyleLayerFilter, resolveMapStyleLayer } from '@/core/rendering/styles/style-runtime'
import { elevationKmToDisplayCoordinate } from '@/core/simulation/geography/elevation-units'

type LinePlacement
  = | { view: 'map', projection: MapProjection, centralMeridian: number, depth: number, renderOrder: number }
    | { view: 'globe', terrainVerticalScale: number, usesElevationGeometry: boolean, sunDirection?: readonly [number, number, number], renderOrder: number }

/** Compiles GeoJSON line features into one batched line geometry per style layer. */
export class StyledLineLayer {
  readonly group = new Group()
  private geometry: BufferGeometry | null = null
  private material: LineBasicMaterial | null = null
  private readonly layerId: string
  private readonly view: LinePlacement['view']
  private readonly sourceId: string
  private readonly features: GeoJsonFeature[] = []
  private lastStyleId = ''
  private lastStyleZoom = Number.NaN

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    layerId: string,
    placement: LinePlacement,
  ) {
    this.layerId = layerId
    this.view = placement.view
    this.group.name = `StyledLines:${layerId}:${placement.view}`
    const layer = getMapStyleLayer(params.appearance.mapStyle, layerId)
    this.sourceId = layer?.source ?? ''
    const source = layer && getMapStyleSource(layer.source, getMapStyleDocument(params.appearance.mapStyle).sources)
    if (!layer || layer.renderer !== 'line' || !source || source.kind !== 'geojson')
      return
    if (source.overlay && !params.appearance.overlays[source.overlay])
      return
    const collection = resolveGeoJsonSource(
      layer.source,
      mesh,
      data,
      params,
      'smoothed',
    )?.data
    if (!collection)
      return
    const positions: number[] = []
    const colors: number[] = []
    const brightnesses: number[] = []
    const featureIndices: number[] = []
    const featureOpacities: number[] = []
    const color = new Color()
    const appendVertex = (point: GeoJsonPosition) => {
      const unit = geographicToCartesian(point[0] * Math.PI / 180, point[1] * Math.PI / 180)
      const altitudeKm = (point[2] ?? 0) / 1000
      const elevation = placement.view === 'globe' && placement.usesElevationGeometry
        ? elevationKmToDisplayCoordinate(altitudeKm) * placement.terrainVerticalScale
        : 0
      const radius = placement.view === 'globe' ? params.core.planetRadius + 0.4 + elevation : 1
      positions.push(unit[0] * radius, unit[1] * radius, unit[2] * radius)
      const brightness = placement.view === 'globe' && params.appearance.baseMap === 'satellite'
        && params.appearance.overlays['day-night'] && placement.sunDirection
        ? getSurfaceDaylight(unit[0], unit[1], unit[2], ...placement.sunDirection)
        : 1
      colors.push(color.r * brightness, color.g * brightness, color.b * brightness)
      brightnesses.push(brightness)
    }
    for (const feature of collection.features) {
      color.set(String(resolveMapStyleLayer(params.appearance.mapStyle, layerId, 0, feature.properties)?.paint['line-color'] ?? '#C88968'))
      const featureIndex = this.features.push(feature) - 1
      const geometry = feature.geometry
      const lines = geometry.type === 'LineString'
        ? [geometry.coordinates]
        : geometry.type === 'MultiLineString'
          ? geometry.coordinates
          : geometry.type === 'Polygon'
            ? geometry.coordinates
            : geometry.type === 'MultiPolygon'
              ? geometry.coordinates.flat()
              : []
      for (const line of lines) {
        for (let index = 1; index < line.length; index++) {
          appendVertex(line[index - 1])
          appendVertex(line[index])
          featureIndices.push(featureIndex, featureIndex)
          featureOpacities.push(1, 1)
        }
      }
    }
    const sourceGeometry = new BufferGeometry()
    sourceGeometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    sourceGeometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
    sourceGeometry.setAttribute('brightness', new BufferAttribute(new Float32Array(brightnesses), 1))
    sourceGeometry.setAttribute('featureIndex', new BufferAttribute(new Uint32Array(featureIndices), 1))
    sourceGeometry.setAttribute('featureOpacity', new BufferAttribute(new Float32Array(featureOpacities), 1))
    if (positions.length > 0)
      sourceGeometry.computeBoundingSphere()
    if (placement.view === 'map') {
      this.geometry = new MapLineGeometry().create(
        sourceGeometry,
        placement.projection,
        placement.centralMeridian,
        placement.depth,
      )
      sourceGeometry.dispose()
    }
    else {
      this.geometry = sourceGeometry
    }
    if ((this.geometry.getAttribute('position')?.count ?? 0) === 0) {
      this.geometry.dispose()
      this.geometry = null
      return
    }

    const paint = resolveMapStyleLayer(params.appearance.mapStyle, layerId, 0)?.paint
    this.material = new LineBasicMaterial({
      color: 0xFFFFFF,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      linewidth: Number(paint?.['line-width'] ?? 1),
      depthTest: placement.view === 'globe',
      depthWrite: false,
    })
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float featureOpacity;\nvarying float vFeatureOpacity;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFeatureOpacity = featureOpacity;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFeatureOpacity;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vFeatureOpacity;')
    }
    const line = new LineSegments(this.geometry, this.material)
    line.renderOrder = placement.renderOrder
    this.group.add(line)
    if (placement.view === 'map' && placement.projection.wrapX) {
      for (const offset of [-placement.projection.worldWidth, placement.projection.worldWidth]) {
        const copy = line.clone()
        copy.position.x = offset
        this.group.add(copy)
      }
    }
    this.updateStyleZoom(params.appearance.mapStyle, 0)
  }

  updateStyleZoom(styleId: string, zoom: number): void {
    this.group.visible = isMapStyleLayerVisible(styleId, this.layerId, zoom, this.view)
    if (this.lastStyleId === styleId && Math.abs(zoom - this.lastStyleZoom) < 0.03)
      return
    this.lastStyleId = styleId
    this.lastStyleZoom = zoom
    if (!this.material)
      return
    const paint = resolveMapStyleLayer(styleId, this.layerId, zoom)?.paint
    this.material.linewidth = Number(paint?.['line-width'] ?? 1)
    if (!this.geometry)
      return
    const colors = this.geometry.getAttribute('color') as BufferAttribute
    const opacities = this.geometry.getAttribute('featureOpacity') as BufferAttribute
    const indices = this.geometry.getAttribute('featureIndex') as BufferAttribute
    const brightness = this.geometry.getAttribute('brightness') as BufferAttribute
    const featureStyles = this.features.map((feature) => {
      const featurePaint = resolveMapStyleLayer(styleId, this.layerId, zoom, feature.properties)?.paint
      const visible = matchesMapStyleLayerFilter(styleId, this.layerId, zoom, feature.properties)
      return {
        color: new Color(String(featurePaint?.['line-color'] ?? '#C88968')),
        opacity: visible ? Math.max(0, Math.min(1, Number(featurePaint?.['line-opacity'] ?? 1))) : 0,
      }
    })
    for (let vertex = 0; vertex < indices.count; vertex++) {
      const style = featureStyles[indices.getX(vertex)]
      if (!style)
        continue
      const light = brightness?.getX(vertex) ?? 1
      colors.setXYZ(vertex, style.color.r * light, style.color.g * light, style.color.b * light)
      opacities.setX(vertex, style.opacity)
    }
    colors.needsUpdate = true
    opacities.needsUpdate = true
  }

  pickFeature(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): { sourceId: string, featureId: string | number } | null {
    if (!this.group.visible || !this.geometry)
      return null
    const positions = this.geometry.getAttribute('position')
    const indices = this.geometry.getAttribute('featureIndex')
    const opacities = this.geometry.getAttribute('featureOpacity')
    if (!positions || !indices || !opacities)
      return null
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const a = new Vector3()
    const b = new Vector3()
    const offsets = this.view === 'map' && this.group.children.length > 1
      ? this.group.children.map(child => child.position.x)
      : [0]
    let nearest = 36
    let chosen: GeoJsonFeature | undefined
    for (let vertex = 0; vertex + 1 < positions.count; vertex += 2) {
      const feature = this.features[indices.getX(vertex)]
      if (!feature || opacities.getX(vertex) <= 0)
        continue
      for (const offset of offsets) {
        a.fromBufferAttribute(positions, vertex)
        b.fromBufferAttribute(positions, vertex + 1)
        a.x += offset
        b.x += offset
        if (this.view === 'globe' && a.dot(camera.position) <= a.lengthSq() && b.dot(camera.position) <= b.lengthSq())
          continue
        a.project(camera)
        b.project(camera)
        if ((a.z < -1 && b.z < -1) || (a.z > 1 && b.z > 1))
          continue
        const ax = (a.x + 1) * rect.width / 2
        const ay = (1 - a.y) * rect.height / 2
        const bx = (b.x + 1) * rect.width / 2
        const by = (1 - b.y) * rect.height / 2
        const dx = bx - ax
        const dy = by - ay
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / Math.max(dx * dx + dy * dy, 1e-9)))
        const distance = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2
        if (distance < nearest) {
          nearest = distance
          chosen = feature
        }
      }
    }
    return chosen ? { sourceId: this.sourceId, featureId: chosen.id } : null
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.material?.dispose()
  }
}
