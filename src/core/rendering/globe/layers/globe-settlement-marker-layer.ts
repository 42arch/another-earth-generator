import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import type { Camera } from 'three'
import { BufferAttribute, BufferGeometry, Color, Group, Points, ShaderMaterial, Vector3 } from 'three'
import { elevationKmToDisplayCoordinate } from '@/core/geography/elevation-units'
import { createMapMarkerMaterial } from '@/core/rendering/shared/settlement-marker-material'

const RANK_COLOR = { village: 0xB7E4B3, town: 0xF4D777, city: 0xFFAE59, metropolis: 0xFF665C }
const RANK_LEVEL = { village: 0, town: 1, city: 2, metropolis: 3 }

export class GlobeSettlementMarkerLayer {
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
    const settlements = data.society?.settlements ?? []
    const positions = new Float32Array(settlements.length * 3)
    const colors = new Float32Array(settlements.length * 3)
    const markerLevels = new Float32Array(settlements.length)

    for (const settlement of settlements) {
      const elevation = elevationKmToDisplayCoordinate(data.geography.elevation[settlement.region])
      const offset = usesElevationGeometry ? elevation * terrainVerticalScale : 0
      const radius = params.core.planetRadius + offset + 0.22
      const source = settlement.region * 3
      const target = settlement.id * 3
      positions[target] = mesh.regionPosition[source] * radius
      positions[target + 1] = mesh.regionPosition[source + 1] * radius
      positions[target + 2] = mesh.regionPosition[source + 2] * radius
      const color = new Color(RANK_COLOR[settlement.rank])
      colors[target] = color.r
      colors[target + 1] = color.g
      colors[target + 2] = color.b
      markerLevels[settlement.id] = RANK_LEVEL[settlement.rank]
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
    this.points.renderOrder = 8
    this.points.visible = false
    this.group.add(this.points)
  }

  pick(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): number | null {
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const positions = this.points.geometry.getAttribute('position')
    const point = new Vector3()
    let nearest = 10 * 10
    let chosen: number | null = null

    for (let id = 0; id < positions.count; id++) {
      point.fromBufferAttribute(positions, id)
      if (point.dot(camera.position) <= point.lengthSq())
        continue
      const projected = point.clone().project(camera)
      if (projected.z < -1 || projected.z > 1)
        continue
      const dx = (projected.x + 1) * rect.width / 2 - x
      const dy = (1 - projected.y) * rect.height / 2 - y
      const distance = dx * dx + dy * dy
      if (distance < nearest) {
        nearest = distance
        chosen = id
      }
    }
    return chosen
  }

  dispose(): void {
    this.group.clear()
    this.points.geometry.dispose()
    this.points.material.dispose()
  }
}
