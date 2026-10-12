import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { BufferGeometry, Color, Group, LineBasicMaterial, LineSegments } from 'three'
import { MapLineGeometry } from '@/core/rendering/map/line-geometry'
import { createClimateVectorGeometry } from '@/core/rendering/shared/climate-vector-geometry'
import { getMapStyleDocument, resolveEffectiveSurfaceMode } from '@/core/rendering/styles'

export class MapClimateVectorLayer {
  readonly group = new Group()

  private geometry: BufferGeometry | null = null
  private material: LineBasicMaterial | null = null
  private meshCopy: LineSegments | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ) {
    this.group.name = 'MapClimateVectors'
    this.build(mesh, data, params, projection, centralMeridian)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ): void {
    const mode = resolveEffectiveSurfaceMode(params.appearance)
    const vectors = data.climate?.displayVector
    if (!mesh || !data || (mode !== 'wind' && mode !== 'ocean-current') || vectors?.kind !== mode) {
      return
    }

    const tokens = getMapStyleDocument(params.appearance.mapStyle).tokens
    const thermalPalette = {
      cold: String(tokens.oceanCurrentCold ?? '#2166AC'),
      neutral: String(tokens.oceanCurrentNeutral ?? '#F7F7F7'),
      warm: String(tokens.oceanCurrentWarm ?? '#B2182B'),
    }

    const sourceGeometry = createClimateVectorGeometry(mesh, vectors, data.geography.landMask, 1, thermalPalette)
    if ((sourceGeometry.getAttribute('position')?.count ?? 0) === 0) {
      sourceGeometry.dispose()
      return
    }

    const mapLineGeometry = new MapLineGeometry()
    this.geometry = mapLineGeometry.create(
      sourceGeometry,
      projection,
      centralMeridian,
      0.4,
    )
    sourceGeometry.dispose()

    if ((this.geometry.getAttribute('position')?.count ?? 0) === 0) {
      this.geometry.dispose()
      this.geometry = null
      return
    }

    const windColor = new Color(String(tokens.wind ?? '#A9FFF1')).getHex()
    this.material = new LineBasicMaterial({
      color: mode === 'wind' ? windColor : 0xFFFFFF,
      vertexColors: mode === 'ocean-current',
      transparent: true,
      opacity: 0.94,
      depthTest: false,
      depthWrite: false,
    })

    this.meshCopy = new LineSegments(this.geometry, this.material)
    this.meshCopy.renderOrder = 5
    this.group.add(this.meshCopy)
  }

  updateLineWidth(_zoom: number): void {
    // LineSegments renders 1px batched lines in WebGL
  }

  updateViewport(_width: number, _height: number): void {
    // LineSegments does not require viewport resolution updates
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.geometry = null
    this.material?.dispose()
    this.material = null
    this.meshCopy = null
  }
}

