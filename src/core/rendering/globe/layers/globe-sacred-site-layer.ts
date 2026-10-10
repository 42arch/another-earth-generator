import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { BufferAttribute, BufferGeometry, Color, Group, Points, ShaderMaterial, Vector3 } from 'three'
import { elevationKmToDisplayCoordinate } from '@/core/geography/elevation-units'
import { createMapMarkerMaterial } from '@/core/rendering/shared/settlement-marker-material'

export class GlobeSacredSiteLayer {
  readonly group = new Group()
  readonly points: Points<BufferGeometry, ShaderMaterial>

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    sunlight: Vector3,
    terrainVerticalScale: number,
    usesElevationGeometry: boolean,
  ) {
    const sites = data.society?.religions?.sacredSites ?? []
    const positions = new Float32Array(sites.length * 3)
    const colors = new Float32Array(sites.length * 3)
    const markerLevels = new Float32Array(sites.length).fill(2)
    const color = new Color(0xEAC2FF)

    for (const site of sites) {
      const source = site.region * 3
      const elevation = elevationKmToDisplayCoordinate(data.geography.elevation[site.region])
      const offset = usesElevationGeometry ? elevation * terrainVerticalScale : 0
      const radius = params.core.planetRadius + offset + 0.22
      const target = site.id * 3
      positions[target] = mesh.regionPosition[source] * radius
      positions[target + 1] = mesh.regionPosition[source + 1] * radius
      positions[target + 2] = mesh.regionPosition[source + 2] * radius
      colors[target] = color.r
      colors[target + 1] = color.g
      colors[target + 2] = color.b
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('color', new BufferAttribute(colors, 3))
    geometry.setAttribute('markerLevel', new BufferAttribute(markerLevels, 1))
    this.points = new Points(geometry, createMapMarkerMaterial(
      true,
      params.appearance.overlays['day-night'],
      sunlight,
    ))
    this.points.renderOrder = 9
    this.points.visible = false
    this.group.add(this.points)
  }

  dispose(): void {
    this.group.clear()
    this.points.geometry.dispose()
    this.points.material.dispose()
  }
}
