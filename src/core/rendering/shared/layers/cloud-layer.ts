import type { BufferGeometry } from 'three'
import type { OverlayViewOptions } from './overlay-view-options'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { DoubleSide, Group, Mesh, ShaderMaterial } from 'three'
import { GlobeSurfaceGeometry } from '@/core/rendering/globe/surface-geometry'
import { MapSurfaceGeometry } from '@/core/rendering/map/surface-geometry'
import { CLOUD_FRAGMENT_SHADER, CLOUD_GLOBE_VERTEX_SHADER, CLOUD_MAP_VERTEX_SHADER } from '@/core/rendering/shared/geometries/cloud-shaders'
import { addWrappedCopies } from '@/core/rendering/shared/layers/wrap-copies'

const OCEAN_DEPTH_SCALE = 0.3
const CLOUD_LAYER_OFFSET = 1.0

/**
 * 统一行星动态云层覆盖图层（兼具球面 3D 与投影 2D 渲染）
 */
export class CloudOverlayLayer {
  readonly group = new Group()

  private globeGeometryBuilder = new GlobeSurfaceGeometry()
  private mapGeometryBuilder = new MapSurfaceGeometry()
  private geometry: BufferGeometry | null = null
  private material: ShaderMaterial | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    options: OverlayViewOptions,
  ) {
    this.group.name = options.view === 'globe' ? 'GlobeClouds' : 'MapClouds'
    this.build(mesh, data, params, options)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    options: OverlayViewOptions,
  ): void {
    if (options.view === 'globe') {
      this.geometry = this.globeGeometryBuilder.create(
        mesh,
        options.planetRadius + CLOUD_LAYER_OFFSET,
        new Float32Array(mesh.numRegions * 3),
        undefined,
        options.usesElevationGeometry ? data.geography.elevation : undefined,
        options.terrainVerticalScale,
        OCEAN_DEPTH_SCALE,
      )
    }
    else {
      this.geometry = this.mapGeometryBuilder.create(
        mesh,
        new Float32Array(mesh.numRegions * 3),
        options.projection,
        options.centralMeridian,
        undefined,
        undefined,
        true,
      )
      this.geometry.translate(0, 0, 0.002)
    }

    this.material = new ShaderMaterial({
      vertexShader: options.view === 'globe' ? CLOUD_GLOBE_VERTEX_SHADER : CLOUD_MAP_VERTEX_SHADER,
      fragmentShader: CLOUD_FRAGMENT_SHADER,
      uniforms: {
        uSeed: { value: params.core.seed },
        uCoverage: { value: 0.66 },
      },
      transparent: true,
      depthTest: options.view === 'globe',
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    })

    const layer = new Mesh(this.geometry, this.material)
    layer.renderOrder = 6

    if (options.view === 'globe')
      this.group.add(layer)
    else
      addWrappedCopies(this.group, layer, options.projection)

    this.group.visible = Boolean(params.appearance.overlays.clouds)
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.geometry = null
    this.material?.dispose()
    this.material = null
  }
}
