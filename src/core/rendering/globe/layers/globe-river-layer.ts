import type { Camera } from 'three'
import type { GeoJsonFeatureCollection, GeoJsonPosition } from '@/core/data-source/geojson'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Color, DoubleSide, Group, Mesh, MeshLambertMaterial, NotEqualStencilFunc, ReplaceStencilOp, Vector3 } from 'three'
import { resolveGeoJsonSource } from '@/core/data-source/geojson-source-runtime'
import { riverStrokePaths } from '@/core/data-source/river-geojson'
import { geographicToCartesian } from '@/core/projections/projection-math'
import { pickGeoJsonLineFeature } from '@/core/rendering/shared/geojson-line-picking'
import { RiverGeometry } from '@/core/rendering/shared/river-geometry'
import { getMapStylePaint } from '@/core/rendering/styles/style-runtime'
import { elevationKmToDisplayCoordinate } from '@/core/simulation/geography/elevation-units'

export class GlobeRiverLayer {
  readonly group = new Group()

  private riverGeometryBuilder = new RiverGeometry()
  private geometry: ReturnType<typeof this.riverGeometryBuilder.createFromPaths> | null = null
  private material: MeshLambertMaterial | null = null
  private basePositions: Float32Array | null = null
  private baseStyleWidth = 1
  private lastAppliedStyleWidth = Number.NaN
  private source: GeoJsonFeatureCollection | null = null
  private readonly planetRadius: number
  private readonly terrainVerticalScale: number
  private readonly usesElevationGeometry: boolean

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    terrainVerticalScale: number,
    usesElevationGeometry: boolean,
  ) {
    this.group.name = 'GlobeRivers'
    this.planetRadius = params.core.planetRadius
    this.terrainVerticalScale = terrainVerticalScale
    this.usesElevationGeometry = usesElevationGeometry
    this.build(mesh, data, params, terrainVerticalScale, usesElevationGeometry)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    terrainVerticalScale: number,
    usesElevationGeometry: boolean,
  ): void {
    if (!params.appearance.overlays.rivers) {
      return
    }

    const riverClearance = usesElevationGeometry ? 0.22 : 0.05
    const styleId = params.appearance.mapStyle
    this.baseStyleWidth = Number(getMapStylePaint(styleId, 'rivers', 'line-width', 0) ?? 1)
    const source = resolveGeoJsonSource('river-network', mesh, data, params)?.data
    if (!source)
      return
    this.source = source
    this.geometry = this.riverGeometryBuilder.createFromPaths(
      riverStrokePaths(source, (flowAccumulation, order) => {
        const color = new Color(String(getMapStylePaint(styleId, 'rivers', 'line-color', 0, { flowAccumulation, order }) ?? '#6C9FB5'))
        return [color.r, color.g, color.b]
      }, usesElevationGeometry ? terrainVerticalScale : 0, this.baseStyleWidth),
      params.core.planetRadius + riverClearance,
    )

    if ((this.geometry.getAttribute('position')?.count ?? 0) === 0) {
      this.geometry.dispose()
      this.geometry = null
      return
    }

    this.material = new MeshLambertMaterial({
      color: 0xFFFFFF,
      vertexColors: true,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: Number(getMapStylePaint(params.appearance.mapStyle, 'rivers', 'line-opacity', 0) ?? 0.8),
      side: DoubleSide,
      toneMapped: false,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: NotEqualStencilFunc,
      stencilZPass: ReplaceStencilOp,
    })
    this.basePositions = (this.geometry.getAttribute('position').array as Float32Array).slice()

    const meshCopy = new Mesh(this.geometry, this.material)
    meshCopy.renderOrder = 7
    this.group.add(meshCopy)
  }

  updateWidthScale(styleWidth: number): void {
    if (!this.geometry || !this.basePositions || Math.abs(styleWidth - this.lastAppliedStyleWidth) < 0.03)
      return
    this.lastAppliedStyleWidth = styleWidth
    const positions = this.geometry.getAttribute('position')
    const values = positions.array as Float32Array
    const scale = styleWidth / Math.max(this.baseStyleWidth, Number.EPSILON)
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
    this.geometry.computeBoundingSphere()
  }

  pickFeature(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): { sourceId: string, featureId: string | number } | null {
    if (!this.group.visible || !this.source)
      return null
    const featureId = pickGeoJsonLineFeature(this.source, event, canvas, camera, (coordinate: GeoJsonPosition) => {
      const unit = geographicToCartesian(coordinate[0] * Math.PI / 180, coordinate[1] * Math.PI / 180)
      const terrain = this.usesElevationGeometry
        ? elevationKmToDisplayCoordinate((coordinate[2] ?? 0) / 1000) * this.terrainVerticalScale
        : 0
      const radius = this.planetRadius + (this.usesElevationGeometry ? 0.22 : 0.05) + terrain
      return [new Vector3(unit[0] * radius, unit[1] * radius, unit[2] * radius)]
    }, point => point.dot(camera.position) <= point.lengthSq())
    return featureId === null ? null : { sourceId: 'river-network', featureId }
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.material?.dispose()
  }
}
