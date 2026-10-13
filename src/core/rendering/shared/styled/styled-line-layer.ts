import type { Camera } from 'three'
import type { GeoJsonFeature } from '@/core/data-source'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { StyledLayerBehavior, StyledLayerUpdateContext } from '@/core/rendering/shared/styled/styled-layer-behavior'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { BufferAttribute, BufferGeometry, Color, Group, Mesh, Vector3 } from 'three'
import { getMapStyleSource, resolveGeoJsonSource } from '@/core/data-source'
import { getSurfaceDaylight } from '@/core/math/daylight'
import { geographicToCartesian } from '@/core/projections/projection-math'
import { LineStrokeGeometry } from '@/core/rendering/shared/geometries/line-stroke-geometry'
import { LineStrokeMaterial } from '@/core/rendering/shared/geometries/line-stroke-material'
import { MapLineGeometry } from '@/core/rendering/shared/geometries/projected-line-geometry'
import { elevationKmToDisplayCoordinate } from '@/core/simulation/geography/elevation-units'
import { getMapStyleDocument, getMapStyleLayer, isMapStyleLayerVisible, matchesMapStyleLayerFilter, resolveEffectiveSurfaceMode, resolveMapStyleLayer } from '@/core/styles'

type LinePlacement
  = | { view: 'map', projection: MapProjection, centralMeridian: number, depth: number, viewportWidth: number, viewportHeight: number, renderOrder: number }
    | { view: 'globe', terrainVerticalScale: number, usesElevationGeometry: boolean, surfaceClearance: number, viewportWidth: number, viewportHeight: number, sunDirection?: readonly [number, number, number], renderOrder: number }

const MAX_GLOBE_LINE_ARC = 0.02

/** Compiles GeoJSON line features into one batched line geometry per style layer. */
export class StyledLineLayer implements StyledLayerBehavior {
  readonly group = new Group()
  private geometry: BufferGeometry | null = null
  private centerline: BufferGeometry | null = null
  private material: LineStrokeMaterial | null = null
  private readonly layerId: string
  private readonly view: LinePlacement['view']
  private readonly sourceId: string
  private readonly planetRadius: number
  private readonly features: GeoJsonFeature[] = []
  private lastStyleId = ''
  private lastStyleZoom = Number.NaN
  private lastViewZoom = 1
  private cachedFeatureStyles: { hex: number, opacity: number, width: number, dash: number, gap: number }[] | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    layerId: string,
    placement: LinePlacement,
  ) {
    this.layerId = layerId
    this.view = placement.view
    this.planetRadius = params.core.planetRadius
    this.group.name = `StyledLines:${layerId}:${placement.view}`
    const layer = getMapStyleLayer(params.appearance.mapStyle, layerId)
    this.sourceId = layer?.source ?? ''
    const source = layer && getMapStyleSource(layer.source, getMapStyleDocument(params.appearance.mapStyle).sources)
    if (!layer || layer.renderer !== 'line' || !source || source.kind !== 'geojson')
      return
    const overlayId = layer.overlay ?? source.overlay
    if (overlayId && !params.appearance.overlays[overlayId])
      return
    const collection = resolveGeoJsonSource(layer.source, mesh, data, params)?.data
    if (!collection)
      return
    const positions: number[] = []
    const brightnesses: number[] = []
    const lineDistances: number[] = []
    const featureIndices: number[] = []
    const appendVertex = (unit: readonly [number, number, number], elevation: number, distance: number) => {
      const radius = placement.view === 'globe'
        ? params.core.planetRadius + placement.surfaceClearance + elevation
        : 1
      positions.push(unit[0] * radius, unit[1] * radius, unit[2] * radius)
      const isSatellite = resolveEffectiveSurfaceMode(params.appearance) === 'satellite'
      const brightness = placement.view === 'globe' && isSatellite
        && params.appearance.overlays['day-night'] && placement.sunDirection
        ? getSurfaceDaylight(unit[0], unit[1], unit[2], ...placement.sunDirection)
        : 1
      brightnesses.push(brightness)
      lineDistances.push(distance)
    }
    for (const feature of collection.features) {
      const featureIndex = this.features.push(feature) - 1
      const seaRoute = feature.properties.kind === 'sea'
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
        let pathDistance = 0
        for (let index = 1; index < line.length; index++) {
          const start = line[index - 1]
          const end = line[index]
          const startUnit = geographicToCartesian(start[0] * Math.PI / 180, start[1] * Math.PI / 180)
          const endUnit = geographicToCartesian(end[0] * Math.PI / 180, end[1] * Math.PI / 180)
          const startAltitudeKm = (start[2] ?? 0) / 1000
          const endAltitudeKm = (end[2] ?? 0) / 1000
          const startElevation = placement.view === 'globe' && placement.usesElevationGeometry
            ? elevationKmToDisplayCoordinate(seaRoute ? Math.max(0, startAltitudeKm) : startAltitudeKm) * placement.terrainVerticalScale
            : 0
          const endElevation = placement.view === 'globe' && placement.usesElevationGeometry
            ? elevationKmToDisplayCoordinate(seaRoute ? Math.max(0, endAltitudeKm) : endAltitudeKm) * placement.terrainVerticalScale
            : 0
          const dot = Math.max(-1, Math.min(1,
            startUnit[0] * endUnit[0] + startUnit[1] * endUnit[1] + startUnit[2] * endUnit[2],
          ))
          const arc = Math.acos(dot)
          const segmentCount = placement.view === 'globe'
            ? Math.max(1, Math.ceil(arc / MAX_GLOBE_LINE_ARC))
            : 1
          const appendSample = (amount: number) => {
            const distance = pathDistance + arc * this.planetRadius * amount
            if (amount === 0) {
              appendVertex(startUnit, startElevation, distance)
              return
            }
            if (amount === 1) {
              appendVertex(endUnit, endElevation, distance)
              return
            }
            const x = startUnit[0] + (endUnit[0] - startUnit[0]) * amount
            const y = startUnit[1] + (endUnit[1] - startUnit[1]) * amount
            const z = startUnit[2] + (endUnit[2] - startUnit[2]) * amount
            const length = Math.hypot(x, y, z)
            appendVertex([x / length, y / length, z / length], startElevation + (endElevation - startElevation) * amount, distance)
          }
          for (let segment = 0; segment < segmentCount; segment++) {
            appendSample(segment / segmentCount)
            appendSample((segment + 1) / segmentCount)
            featureIndices.push(featureIndex, featureIndex)
          }
          pathDistance += arc * this.planetRadius
        }
      }
    }
    const sourceGeometry = new BufferGeometry()
    sourceGeometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    sourceGeometry.setAttribute('brightness', new BufferAttribute(new Float32Array(brightnesses), 1))
    sourceGeometry.setAttribute('lineDistance', new BufferAttribute(new Float32Array(lineDistances), 1))
    sourceGeometry.setAttribute('featureIndex', new BufferAttribute(new Uint32Array(featureIndices), 1))
    if (positions.length > 0)
      sourceGeometry.computeBoundingSphere()
    if (placement.view === 'map') {
      this.centerline = new MapLineGeometry().create(
        sourceGeometry,
        placement.projection,
        placement.centralMeridian,
        placement.depth,
      )
      sourceGeometry.dispose()
    }
    else {
      this.centerline = sourceGeometry
    }
    if ((this.centerline.getAttribute('position')?.count ?? 0) === 0) {
      this.centerline.dispose()
      this.centerline = null
      return
    }

    this.geometry = new LineStrokeGeometry().create(this.centerline)
    this.material = new LineStrokeMaterial(placement.view, placement.viewportWidth, placement.viewportHeight)
    const line = new Mesh(this.geometry, this.material)
    line.renderOrder = placement.renderOrder
    this.group.add(line)
    if (placement.view === 'map' && placement.projection.wrapX) {
      for (const offset of [-placement.projection.worldWidth, placement.projection.worldWidth]) {
        const copy = line.clone()
        copy.position.x = offset
        this.group.add(copy)
      }
    }
    this.updateStyleZoom(params.appearance.mapStyle, 0, placement.view === 'globe' ? this.planetRadius * 3.2 : 1)
  }

  updateStyle(context: StyledLayerUpdateContext): void {
    this.updateStyleZoom(context.styleId, context.styleZoom, context.viewZoom)
  }

  updateViewport(width: number, height: number): void {
    this.material?.setResolution(width, height)
    this.updateDistanceScale(this.lastViewZoom)
  }

  updateStyleZoom(styleId: string, zoom: number, viewZoom = 1): void {
    this.group.visible = isMapStyleLayerVisible(styleId, this.layerId, zoom, this.view)
    this.lastViewZoom = viewZoom
    this.updateDistanceScale(viewZoom)
    if (this.lastStyleId === styleId && Math.abs(zoom - this.lastStyleZoom) < 0.15)
      return
    this.lastStyleId = styleId
    this.lastStyleZoom = zoom
    if (!this.material)
      return
    if (!this.geometry)
      return

    const currentStyles = this.features.map((feature) => {
      const featurePaint = resolveMapStyleLayer(styleId, this.layerId, zoom, feature.properties)?.paint
      const visible = matchesMapStyleLayerFilter(styleId, this.layerId, zoom, feature.properties)
      const color = new Color(String(featurePaint?.['line-color'] ?? '#C88968'))
      const opacity = visible ? Math.max(0, Math.min(1, Number(featurePaint?.['line-opacity'] ?? 1))) : 0
      const rawWidth = Number(featurePaint?.['line-width'] ?? 1)
      const width = Number.isFinite(rawWidth) ? Math.max(0, rawWidth) : 1
      const dashArray = featurePaint?.['line-dasharray']
      const rawDash = Array.isArray(dashArray) ? Number(dashArray[0]) : 0
      const rawGap = Array.isArray(dashArray) ? Number(dashArray[1]) : 0
      const dash = Number.isFinite(rawDash) ? Math.max(0, rawDash) : 0
      const gap = Number.isFinite(rawGap) ? Math.max(0, rawGap) : 0
      return { color, hex: color.getHex(), opacity, width, dash, gap }
    })
    let stylesChanged = !this.cachedFeatureStyles || this.cachedFeatureStyles.length !== currentStyles.length
    if (!stylesChanged && this.cachedFeatureStyles) {
      for (let i = 0; i < currentStyles.length; i++) {
        if (currentStyles[i].hex !== this.cachedFeatureStyles[i].hex
          || Math.abs(currentStyles[i].opacity - this.cachedFeatureStyles[i].opacity) > 0.001
          || Math.abs(currentStyles[i].width - this.cachedFeatureStyles[i].width) > 0.001
          || Math.abs(currentStyles[i].dash - this.cachedFeatureStyles[i].dash) > 0.001
          || Math.abs(currentStyles[i].gap - this.cachedFeatureStyles[i].gap) > 0.001) {
          stylesChanged = true
          break
        }
      }
    }
    if (!stylesChanged)
      return
    this.cachedFeatureStyles = currentStyles.map(s => ({ hex: s.hex, opacity: s.opacity, width: s.width, dash: s.dash, gap: s.gap }))

    const colors = this.geometry.getAttribute('color') as BufferAttribute
    const opacities = this.geometry.getAttribute('featureOpacity') as BufferAttribute
    const indices = this.geometry.getAttribute('featureIndex') as BufferAttribute
    const brightness = this.geometry.getAttribute('brightness') as BufferAttribute
    const widths = this.geometry.getAttribute('strokeWidth') as BufferAttribute
    const dashes = this.geometry.getAttribute('dashLength') as BufferAttribute
    const gaps = this.geometry.getAttribute('gapLength') as BufferAttribute
    for (let vertex = 0; vertex < indices.count; vertex++) {
      const style = currentStyles[indices.getX(vertex)]
      if (!style)
        continue
      const light = brightness?.getX(vertex) ?? 1
      colors.setXYZ(vertex, style.color.r * light, style.color.g * light, style.color.b * light)
      opacities.setX(vertex, style.opacity)
      widths.setX(vertex, style.width)
      dashes.setX(vertex, style.dash)
      gaps.setX(vertex, style.gap)
    }
    colors.needsUpdate = true
    opacities.needsUpdate = true
    widths.needsUpdate = true
    dashes.needsUpdate = true
    gaps.needsUpdate = true
  }

  private updateDistanceScale(viewZoom: number): void {
    if (!this.material)
      return
    const resolution = this.material.uniforms.resolution.value as { x: number, y: number }
    // Keep one dash phase per geographic path; the globe scale uses the front surface depth.
    const scale = this.view === 'map'
      ? resolution.x * viewZoom / (2 * Math.PI * this.planetRadius)
      : resolution.y / (2 * Math.tan(45 * Math.PI / 360) * Math.max(viewZoom - this.planetRadius, 1))
    this.material.setDistanceScale(scale)
  }

  pickGeoJsonFeature(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): { sourceId: string, featureId: string | number } | null {
    if (!this.group.visible || !this.centerline)
      return null
    const positions = this.centerline.getAttribute('position')
    const indices = this.centerline.getAttribute('featureIndex')
    const distances = this.centerline.getAttribute('lineDistance')
    if (!positions || !indices || !distances)
      return null
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const a = new Vector3()
    const b = new Vector3()
    const offsets = this.view === 'map' && this.group.children.length > 1
      ? this.group.children.map(child => child.position.x)
      : [0]
    let nearest = Number.POSITIVE_INFINITY
    let chosen: GeoJsonFeature | undefined
    for (let vertex = 0; vertex + 1 < positions.count; vertex += 2) {
      const featureIndex = indices.getX(vertex)
      const feature = this.features[featureIndex]
      const style = this.cachedFeatureStyles?.[featureIndex]
      if (!feature || !style || style.opacity <= 0 || style.width <= 0)
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
        const tolerance = Math.max(6, style.width * 0.5 + 3)
        if (distance < tolerance * tolerance && distance < nearest) {
          if (style.dash > 0 && style.gap > 0 && this.material) {
            const pathDistance = distances.getX(vertex) + (distances.getX(vertex + 1) - distances.getX(vertex)) * t
            const patternLength = (style.dash + style.gap) * style.width
            const phase = (pathDistance * Number(this.material.uniforms.distanceScale.value)) % patternLength
            if (phase >= style.dash * style.width)
              continue
          }
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
    this.centerline?.dispose()
    this.material?.dispose()
  }
}
