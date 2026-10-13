import type { BufferGeometry } from 'three'
import type { OverlayViewOptions } from './overlay-view-options'
import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Color, Group, LineBasicMaterial, LineSegments } from 'three'
import { createClimateVectorGeometry } from '@/core/rendering/shared/geometries/climate-vector-geometry'
import { MapLineGeometry } from '@/core/rendering/shared/geometries/projected-line-geometry'
import { getMapStyleDocument, resolveEffectiveSurfaceMode } from '@/core/styles'

/**
 * 统一盛行风与大洋洋流动态矢量场覆盖图层（兼具球面 3D 与投影 2D 渲染）
 */
export class ClimateVectorOverlayLayer {
  readonly group = new Group()

  private geometry: BufferGeometry | null = null
  private material: LineBasicMaterial | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    options: OverlayViewOptions,
  ) {
    this.group.name = options.view === 'globe' ? 'GlobeClimateVectors' : 'MapClimateVectors'
    this.build(mesh, data, params, options)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    options: OverlayViewOptions,
  ): void {
    const mode = resolveEffectiveSurfaceMode(params.appearance)
    const vectors = data.climate?.displayVector
    if ((mode !== 'wind' && mode !== 'ocean-current') || vectors?.kind !== mode)
      return

    const tokens = getMapStyleDocument(params.appearance.mapStyle).tokens
    const thermalPalette = {
      cold: String(tokens.oceanCurrentCold ?? '#2166AC'),
      neutral: String(tokens.oceanCurrentNeutral ?? '#F7F7F7'),
      warm: String(tokens.oceanCurrentWarm ?? '#B2182B'),
    }

    if (options.view === 'globe') {
      this.geometry = createClimateVectorGeometry(
        mesh,
        vectors,
        data.geography.landMask,
        options.planetRadius + 0.9,
        thermalPalette,
      )
    }
    else {
      const sourceGeometry = createClimateVectorGeometry(mesh, vectors, data.geography.landMask, 1, thermalPalette)
      if ((sourceGeometry.getAttribute('position')?.count ?? 0) === 0) {
        sourceGeometry.dispose()
        return
      }
      const mapLineGeometry = new MapLineGeometry()
      this.geometry = mapLineGeometry.create(
        sourceGeometry,
        options.projection,
        options.centralMeridian,
        0.4,
      )
      sourceGeometry.dispose()
    }

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
      opacity: options.view === 'globe' ? 0.92 : 0.94,
      depthTest: options.view === 'globe',
      depthWrite: false,
    })

    const line = new LineSegments(this.geometry, this.material)
    line.renderOrder = 5
    this.group.add(line)
  }

  dispose(): void {
    this.group.clear()
    this.geometry?.dispose()
    this.geometry = null
    this.material?.dispose()
    this.material = null
  }
}
