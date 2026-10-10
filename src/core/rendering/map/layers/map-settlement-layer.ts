import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { BufferAttribute, BufferGeometry, Color, Group, Points } from 'three'
import { createMapMarkerMaterial } from '@/core/rendering/shared/settlement-marker-material'

export class MapSettlementLayer {
  readonly group = new Group()

  private settlementGeometry: BufferGeometry | null = null
  private settlementMaterial: ReturnType<typeof createMapMarkerMaterial> | null = null
  private sacredSiteGeometry: BufferGeometry | null = null
  private sacredSiteMaterial: ReturnType<typeof createMapMarkerMaterial> | null = null

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ) {
    this.group.name = 'MapSettlements'
    this.build(mesh, data, params, projection, centralMeridian)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ): void {
    if (params.appearance.overlays.cities && data.society) {
      const positions: number[] = []
      const colors: number[] = []
      const markerLevels: number[] = []
      const palette = { village: 0xB7E4B3, town: 0xF4D777, city: 0xFFAE59, metropolis: 0xFF665C }
      const level = { village: 0, town: 1, city: 2, metropolis: 3 }

      for (const settlement of data.society.settlements) {
        const projected = projection.project(
          mesh.regionLongitude[settlement.region],
          mesh.regionLatitude[settlement.region],
          centralMeridian,
        )
        if (!projected)
          continue
        positions.push(projected.x, projected.y, 0.5)
        const color = new Color(palette[settlement.rank])
        colors.push(color.r, color.g, color.b)
        markerLevels.push(level[settlement.rank])
      }

      if (positions.length > 0) {
        this.settlementGeometry = new BufferGeometry()
        this.settlementGeometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
        this.settlementGeometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
        this.settlementGeometry.setAttribute('markerLevel', new BufferAttribute(new Float32Array(markerLevels), 1))

        this.settlementMaterial = createMapMarkerMaterial(false)
        const layer = new Points(this.settlementGeometry, this.settlementMaterial)
        layer.renderOrder = 8
        layer.visible = false
        this.addWrappedCopies(layer, projection)
      }
    }

    if (params.appearance.overlays['sacred-sites'] && data.society?.religions) {
      const positions: number[] = []
      const colors: number[] = []
      const markerLevels: number[] = []
      const color = new Color(0xEAC2FF)

      for (const site of data.society.religions.sacredSites) {
        const projected = projection.project(
          mesh.regionLongitude[site.region],
          mesh.regionLatitude[site.region],
          centralMeridian,
        )
        if (projected) {
          positions.push(projected.x, projected.y, 0.56)
          colors.push(color.r, color.g, color.b)
          markerLevels.push(2)
        }
      }

      if (positions.length > 0) {
        this.sacredSiteGeometry = new BufferGeometry()
        this.sacredSiteGeometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
        this.sacredSiteGeometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
        this.sacredSiteGeometry.setAttribute('markerLevel', new BufferAttribute(new Float32Array(markerLevels), 1))

        this.sacredSiteMaterial = createMapMarkerMaterial(false)
        const layer = new Points(this.sacredSiteGeometry, this.sacredSiteMaterial)
        layer.renderOrder = 9
        layer.visible = false
        this.addWrappedCopies(layer, projection)
      }
    }
  }

  private addWrappedCopies(baseLayer: Points, projection: MapProjection): void {
    this.group.add(baseLayer)
    if (projection.wrapX) {
      const leftCopy = new Points(baseLayer.geometry, baseLayer.material)
      leftCopy.position.x = -projection.worldWidth
      leftCopy.renderOrder = baseLayer.renderOrder
      leftCopy.visible = baseLayer.visible

      const rightCopy = new Points(baseLayer.geometry, baseLayer.material)
      rightCopy.position.x = projection.worldWidth
      rightCopy.renderOrder = baseLayer.renderOrder
      rightCopy.visible = baseLayer.visible

      this.group.add(leftCopy, rightCopy)
    }
  }

  showPoints(): void {
    for (const child of this.group.children) {
      child.visible = true
    }
  }

  dispose(): void {
    this.group.clear()
    this.settlementGeometry?.dispose()
    this.settlementMaterial?.dispose()
    this.sacredSiteGeometry?.dispose()
    this.sacredSiteMaterial?.dispose()
  }
}
