import type { Camera } from 'three'
import type { GeoJsonFeature } from '@/core/data-source'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { GeographicFillTriangle } from '@/core/rendering/shared/geometries/surface-geometry-helpers'
import type { StyledLayerBehavior, StyledLayerUpdateContext } from '@/core/rendering/shared/styled/styled-layer-behavior'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, Raycaster, Vector2, Vector3 } from 'three'
import { getImportedGeoJsonSource, getLandAreaGeometry, resolveGeoJsonSource } from '@/core/data-source'
import { geographicToCartesian } from '@/core/projections/projection-math'
import { GlobeSurfaceGeometry } from '@/core/rendering/globe/surface-geometry'
import { MapSurfaceGeometry } from '@/core/rendering/map/surface-geometry'
import { triangulateGeoJsonFeature } from '@/core/rendering/shared/geometries/geojson-fill-triangulation'
import { getMapStyleLayer, isMapStyleLayerVisible, matchesMapStyleLayerFilter, resolveMapStyleLayer } from '@/core/styles'

type FillPlacement
  = | { view: 'map', projection: MapProjection, centralMeridian: number, renderOrder: number }
    | { view: 'globe', planetRadius: number, renderOrder: number }

const GLOBE_FILL_MAX_ARC = 0.1
const GLOBE_FILL_CLEARANCE = 0.08

function createGlobeGeometry(triangles: readonly GeographicFillTriangle[], radius: number): BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const normals: number[] = []
  const faceRegions: number[] = []
  const append = (a: Vector3, b: Vector3, c: Vector3, triangle: GeographicFillTriangle, depth = 0) => {
    const maxArc = Math.max(a.angleTo(b), b.angleTo(c), c.angleTo(a))
    if (maxArc > 0.24 && depth < 7) {
      const ab = a.clone().add(b).normalize()
      const bc = b.clone().add(c).normalize()
      const ca = c.clone().add(a).normalize()
      append(a, ab, ca, triangle, depth + 1)
      append(ab, b, bc, triangle, depth + 1)
      append(ca, bc, c, triangle, depth + 1)
      append(ab, bc, ca, triangle, depth + 1)
      return
    }
    for (const point of [a, b, c]) {
      positions.push(point.x * radius, point.y * radius, point.z * radius)
      normals.push(point.x, point.y, point.z)
      colors.push(...triangle.color)
    }
    faceRegions.push(triangle.featureIndex)
  }
  for (const triangle of triangles) {
    const vertices = triangle.vertices.map((point) => {
      const unit = geographicToCartesian(point[0] * Math.PI / 180, point[1] * Math.PI / 180)
      return new Vector3(...unit)
    })
    append(vertices[0], vertices[1], vertices[2], triangle)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.userData.faceRegions = new Uint32Array(faceRegions)
  geometry.computeBoundingSphere()
  return geometry
}

/** Shared GeoJSON polygon fill renderer for 2D maps and the globe. */
export class StyledFillLayer implements StyledLayerBehavior {
  readonly group = new Group()
  private readonly geometry: BufferGeometry
  private readonly material: MeshBasicMaterial
  private readonly features: GeoJsonFeature[]
  private readonly layerId: string
  private readonly sourceId: string
  private readonly view: FillPlacement['view']
  private readonly generatedLand: boolean
  private lastStyleId = ''
  private lastZoom = Number.NaN
  private cachedColors: Float32Array | null = null
  private cachedOpacities: Float32Array | null = null

  constructor(mesh: SphericalMesh, data: WorldSimulationState, params: WorldConfig, layerId: string, placement: FillPlacement) {
    this.layerId = layerId
    this.view = placement.view
    this.group.name = `StyledFill:${layerId}:${placement.view}`
    const styleLayer = getMapStyleLayer(params.appearance.mapStyle, layerId)
    const sourceId = styleLayer?.source ?? ''
    this.sourceId = sourceId
    const collection = resolveGeoJsonSource(sourceId, mesh, data, params)?.data
    const generatedLand = sourceId === 'land-areas' && !getImportedGeoJsonSource(sourceId)
    this.generatedLand = generatedLand
    const sourceFeatures = collection?.features ?? []
    this.features = generatedLand && sourceFeatures.length === 0
      ? [{ type: 'Feature', id: 'land', geometry: { type: 'MultiPolygon', coordinates: [] }, properties: { kind: 'land' } }]
      : sourceFeatures
    if (generatedLand) {
      // Use the shared coast as the polygon boundary. Interior cell fans provide
      // a stable triangulation for large landmasses, islands and lake holes.
      const { landMask, smoothedCorners } = getLandAreaGeometry(mesh, data)
      const cornerPositions = smoothedCorners
      const colors = new Float32Array(mesh.numRegions * 3).fill(1)
      this.geometry = placement.view === 'map'
        ? new MapSurfaceGeometry().create(mesh, colors, placement.projection, placement.centralMeridian, landMask, undefined, false, undefined, cornerPositions)
        : new GlobeSurfaceGeometry().create(mesh, placement.planetRadius + 0.18, colors, landMask, undefined, 0, 1, undefined, undefined, cornerPositions)
      this.geometry.userData.faceRegions = new Uint32Array(this.geometry.getAttribute('position').count / 3)
    }
    else {
      const triangles: GeographicFillTriangle[] = []
      for (const [index, feature] of this.features.entries()) {
        const paint = resolveMapStyleLayer(params.appearance.mapStyle, layerId, 0, feature.properties)?.paint
        const fillColor = new Color(String(paint?.['fill-color'] ?? '#B8D8A0'))
        const maxArc = placement.view === 'globe' ? GLOBE_FILL_MAX_ARC : undefined
        for (const triangle of triangulateGeoJsonFeature(feature, index, [fillColor.r, fillColor.g, fillColor.b], maxArc))
          triangles.push(triangle)
      }
      // A spherical triangle is a flat chord in WebGL; leave room for its inward sagitta.
      const globeFillRadius = placement.view === 'globe'
        ? placement.planetRadius * (2 - Math.cos(GLOBE_FILL_MAX_ARC / Math.sqrt(3))) + GLOBE_FILL_CLEARANCE
        : 0
      this.geometry = placement.view === 'map'
        ? new MapSurfaceGeometry().createFromGeographicTriangles(triangles, placement.projection, placement.centralMeridian)
        : createGlobeGeometry(triangles, globeFillRadius)
    }
    const featureOpacity = new Float32Array(this.geometry.getAttribute('position').count)
    if (generatedLand)
      featureOpacity.fill(1)
    this.geometry.setAttribute('featureOpacity', new BufferAttribute(featureOpacity, 1))
    this.material = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float featureOpacity;\nvarying float vFeatureOpacity;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFeatureOpacity = featureOpacity;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFeatureOpacity;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vFeatureOpacity;')
    }
    const surface = new Mesh(this.geometry, this.material)
    surface.renderOrder = placement.renderOrder
    if (placement.view === 'map')
      surface.position.z = 0.12
    this.group.add(surface)
    if (placement.view === 'map' && placement.projection.wrapX) {
      for (const offset of [-placement.projection.worldWidth, placement.projection.worldWidth]) {
        const copy = surface.clone()
        copy.position.x = offset
        this.group.add(copy)
      }
    }
    this.updateStyleZoom(params.appearance.mapStyle, 0)
  }

  updateStyle(context: StyledLayerUpdateContext): void {
    this.updateStyleZoom(context.styleId, context.styleZoom)
  }

  updateStyleZoom(styleId: string, zoom: number): void {
    this.group.visible = isMapStyleLayerVisible(styleId, this.layerId, zoom, this.view)
    if (this.generatedLand) {
      const properties = this.features[0].properties
      const paint = resolveMapStyleLayer(styleId, this.layerId, zoom, properties)?.paint
      const opacity = Math.max(0, Math.min(1, Number(paint?.['fill-opacity'] ?? 1)))
      this.group.visible = this.group.visible && matchesMapStyleLayerFilter(styleId, this.layerId, zoom, properties) && opacity > 0
      this.material.color.set(String(paint?.['fill-color'] ?? '#B8D8A0'))
      this.material.opacity = opacity
      return
    }
    if (styleId === this.lastStyleId && Math.abs(zoom - this.lastZoom) < 0.15)
      return
    this.lastStyleId = styleId
    this.lastZoom = zoom
    const colors = new Float32Array(this.features.length * 3)
    const opacities = new Float32Array(this.features.length)
    let dirty = !this.cachedColors || !this.cachedOpacities
    for (const [index, feature] of this.features.entries()) {
      const visible = matchesMapStyleLayerFilter(styleId, this.layerId, zoom, feature.properties)
      const paint = resolveMapStyleLayer(styleId, this.layerId, zoom, feature.properties)?.paint
      const color = new Color(String(paint?.['fill-color'] ?? '#B8D8A0'))
      const r = color.r
      const g = color.g
      const b = color.b
      const opacity = visible ? Math.max(0, Math.min(1, Number(paint?.['fill-opacity'] ?? 1))) : 0
      colors[index * 3] = r
      colors[index * 3 + 1] = g
      colors[index * 3 + 2] = b
      opacities[index] = opacity
      if (!dirty && this.cachedColors && this.cachedOpacities) {
        if (Math.abs(opacity - this.cachedOpacities[index]) > 0.001
          || Math.abs(r - this.cachedColors[index * 3]) > 0.002
          || Math.abs(g - this.cachedColors[index * 3 + 1]) > 0.002
          || Math.abs(b - this.cachedColors[index * 3 + 2]) > 0.002) {
          dirty = true
        }
      }
    }
    if (!dirty)
      return
    this.cachedColors = colors
    this.cachedOpacities = opacities
    new MapSurfaceGeometry().updateColors(this.geometry, colors)
    const faceRegions = this.geometry.userData.faceRegions as Uint32Array
    const opacityAttribute = this.geometry.getAttribute('featureOpacity') as BufferAttribute
    for (let face = 0; face < faceRegions.length; face++) {
      const opacity = opacities[faceRegions[face]]
      opacityAttribute.setX(face * 3, opacity)
      opacityAttribute.setX(face * 3 + 1, opacity)
      opacityAttribute.setX(face * 3 + 2, opacity)
    }
    opacityAttribute.needsUpdate = true
  }

  pickGeoJsonFeature(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): { sourceId: string, featureId: string | number } | null {
    if (!this.group.visible)
      return null
    const rect = canvas.getBoundingClientRect()
    const pointer = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    )
    const raycaster = new Raycaster()
    raycaster.setFromCamera(pointer, camera)
    this.group.updateMatrixWorld(true)
    for (const hit of raycaster.intersectObjects(this.group.children, true)) {
      if (hit.faceIndex == null)
        continue
      const faceRegions = this.geometry.userData.faceRegions as Uint32Array
      const opacityAttribute = this.geometry.getAttribute('featureOpacity') as BufferAttribute
      if (opacityAttribute.getX(hit.faceIndex * 3) <= 0)
        continue
      const feature = this.features[faceRegions[hit.faceIndex]]
      if (feature)
        return { sourceId: this.sourceId, featureId: feature.id }
    }
    return null
  }

  dispose(): void {
    this.group.clear()
    this.geometry.dispose()
    this.material.dispose()
  }
}
