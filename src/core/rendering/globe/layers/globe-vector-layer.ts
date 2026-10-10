import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Group, LineBasicMaterial, LineSegments } from 'three'
import { createClimateVectorGeometry } from '@/core/rendering/shared/climate-vector-geometry'

export class GlobeClimateVectorLayer {
  readonly group = new Group()

  private geometry: ReturnType<typeof createClimateVectorGeometry> | null = null
  private material: LineBasicMaterial | null = null
  private meshCopy: LineSegments | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
  ) {
    this.group.name = 'GlobeClimateVectors'
    this.build(mesh, data, params)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
  ): void {
    const mode = params.appearance.baseMap
    const vectors = data.climate?.displayVector
    if (!mesh || !data || (mode !== 'wind' && mode !== 'ocean-current') || vectors?.kind !== mode) {
      return
    }

    this.geometry = createClimateVectorGeometry(
      mesh,
      vectors,
      data.geography.landMask,
      params.core.planetRadius + 0.9,
    )

    if ((this.geometry.getAttribute('position')?.count ?? 0) === 0) {
      this.geometry.dispose()
      this.geometry = null
      return
    }

    this.material = new LineBasicMaterial({
      color: mode === 'wind' ? 0xA9FFF1 : 0xFFFFFF,
      vertexColors: mode === 'ocean-current',
      transparent: true,
      opacity: 0.92,
      depthTest: true,
      depthWrite: false,
    })

    this.meshCopy = new LineSegments(this.geometry, this.material)
    this.meshCopy.renderOrder = 5
    this.group.add(this.meshCopy)
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.material?.dispose()
  }
}
