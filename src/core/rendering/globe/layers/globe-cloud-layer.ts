import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { DoubleSide, Group, Mesh, ShaderMaterial } from 'three'
import { GlobeSurfaceGeometry } from '@/core/rendering/globe/surface-geometry'
import { CLOUD_FRAGMENT_SHADER, CLOUD_GLOBE_VERTEX_SHADER } from '@/core/rendering/shared/cloud-shaders'

const OCEAN_DEPTH_SCALE = 0.3

const CLOUD_LAYER_OFFSET = 1.0

export class GlobeCloudLayer {
  readonly group = new Group()

  private geometryBuilder = new GlobeSurfaceGeometry()
  private geometry: ReturnType<typeof this.geometryBuilder.create> | null = null
  private material: ShaderMaterial | null = null
  private meshCopy: Mesh | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    terrainVerticalScale: number,
    usesElevationGeometry: boolean,
  ) {
    this.group.name = 'GlobeClouds'
    this.build(mesh, data, params, terrainVerticalScale, usesElevationGeometry)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    terrainVerticalScale: number,
    usesElevationGeometry: boolean,
  ): void {
    if (!params.appearance.overlays.clouds || !data) {
      return
    }

    this.geometry = this.geometryBuilder.create(
      mesh,
      params.core.planetRadius + CLOUD_LAYER_OFFSET,
      new Float32Array(mesh.numRegions * 3),
      undefined,
      usesElevationGeometry ? data.geography.elevation : undefined,
      terrainVerticalScale,
      OCEAN_DEPTH_SCALE,
    )

    this.material = new ShaderMaterial({
      vertexShader: CLOUD_GLOBE_VERTEX_SHADER,
      fragmentShader: CLOUD_FRAGMENT_SHADER,
      uniforms: {
        uSeed: { value: params.core.seed },
        uCoverage: { value: 0.66 },
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    })

    this.meshCopy = new Mesh(this.geometry, this.material)
    this.meshCopy.renderOrder = 6
    this.group.add(this.meshCopy)
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.material?.dispose()
  }
}
