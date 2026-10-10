import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { DoubleSide, Group, Mesh, ShaderMaterial } from 'three'
import { MapSurfaceGeometry } from '@/core/rendering/map/surface-geometry'
import { CLOUD_FRAGMENT_SHADER, CLOUD_MAP_VERTEX_SHADER } from '@/core/rendering/shared/cloud-shaders'

export class MapCloudLayer {
  readonly group = new Group()

  private geometryBuilder = new MapSurfaceGeometry()
  private material: ShaderMaterial | null = null
  private geometry: ReturnType<typeof this.geometryBuilder.create> | null = null

  constructor(
    mesh: SphericalMesh,
    _data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ) {
    this.group.name = 'MapClouds'
    this.build(mesh, params, projection, centralMeridian)
  }

  private build(
    mesh: SphericalMesh,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ): void {
    if (!params.appearance.overlays.clouds)
      return

    this.geometry = this.geometryBuilder.create(
      mesh,
      new Float32Array(mesh.numRegions * 3),
      projection,
      centralMeridian,
      undefined,
      undefined,
      true,
    )
    this.geometry.translate(0, 0, 0.002)

    this.material = new ShaderMaterial({
      vertexShader: CLOUD_MAP_VERTEX_SHADER,
      fragmentShader: CLOUD_FRAGMENT_SHADER,
      uniforms: {
        uSeed: { value: params.core.seed },
        uCoverage: { value: 0.66 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    })

    const layer = new Mesh(this.geometry, this.material)
    layer.renderOrder = 6
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

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.material?.dispose()
  }
}
