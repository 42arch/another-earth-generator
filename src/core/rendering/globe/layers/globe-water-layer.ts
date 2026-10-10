import type { BufferGeometry } from 'three'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Group, Mesh, MeshPhongMaterial, SphereGeometry } from 'three'
import { GlobeSurfaceGeometry } from '@/core/rendering/globe/surface-geometry'

const WATER_SURFACE_OFFSET = 0.1

export class GlobeWaterLayer {
  readonly group = new Group()

  private geometryBuilder = new GlobeSurfaceGeometry()
  private geometry: BufferGeometry | null = null
  private material: MeshPhongMaterial | null = null
  private meshCopy: Mesh | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    usesElevationGeometry: boolean,
  ) {
    this.group.name = 'GlobeWater'
    this.build(mesh, data, params, usesElevationGeometry)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    usesElevationGeometry: boolean,
  ): void {
    if (params.appearance.baseMap !== 'satellite' || !params.appearance.overlays.atmosphere) {
      return
    }

    const planetRadius = params.core.planetRadius
    if (usesElevationGeometry) {
      this.geometry = new SphereGeometry(planetRadius, 128, 128)
    }
    else if (mesh && data) {
      const oceanMask = Uint8Array.from(data.geography.landMask, land => land === 0 ? 1 : 0)
      this.geometry = this.geometryBuilder.create(
        mesh,
        planetRadius + WATER_SURFACE_OFFSET,
        new Float32Array(mesh.numRegions * 3),
        oceanMask,
      )
    }
    else {
      return
    }

    this.material = new MeshPhongMaterial({
      color: 0x0C3A6E,
      transparent: true,
      opacity: 0.55,
      shininess: 120,
      specular: 0x4488BB,
      depthWrite: false,
    })

    this.meshCopy = new Mesh(this.geometry, this.material)
    this.group.add(this.meshCopy)
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.material?.dispose()
  }
}
