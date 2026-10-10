import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { WorldLabelItem } from '@/core/rendering/shared/label-data'
import type { SettlementLabelItem } from '@/core/rendering/shared/settlement-label-data'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { Group } from 'three'
import { Text } from 'troika-three-text'
import { computeWorldLabels } from '@/core/rendering/shared/label-data'
import { computeSettlementLabels } from '@/core/rendering/shared/settlement-label-data'

export interface BoundingBox2D {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export function boxesIntersect(a: BoundingBox2D, b: BoundingBox2D): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)
}

interface MapWorldLabelGlyph {
  meshCopies: Text[]
  baseX: number
  baseY: number
}

interface MapWorldLabelEntry {
  item: WorldLabelItem
  priority: number
  fontSize2D: number
  glyphs: MapWorldLabelGlyph[]
  centerBaseX: number
  centerBaseY: number
  bboxWidth: number
  bboxHeight: number
}

interface MapSettlementLabelEntry {
  item: SettlementLabelItem
  priority: number
  iconMeshes: Text[]
  nameMeshes: Text[]
  baseX: number
  baseY: number
}

export class MapLabelLayer {
  readonly group = new Group()

  private labelLayer: Group | null = null
  private settlementLabelLayer: Group | null = null

  private worldLabelEntries: MapWorldLabelEntry[] = []
  private labelMeshes: Text[] = []

  private settlementLabelEntries: MapSettlementLabelEntry[] = []
  private settlementLabelMeshes: Text[] = []

  private lastDeclutterZoom = -1

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ) {
    this.group.name = 'MapLabelsRoot'
    this.build(mesh, data, params, projection, centralMeridian)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ): void {
    this.addLabels(mesh, data, params, projection, centralMeridian)
    this.addSettlementLabels(mesh, data, params, projection, centralMeridian)
  }

  private addLabels(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ): void {
    const labels = computeWorldLabels(mesh, data, params)
    if (labels.length === 0)
      return

    this.labelLayer = new Group()
    this.labelLayer.name = 'MapWorldLabels'

    const worldOffsets = projection.wrapX
      ? [-projection.worldWidth, 0, projection.worldWidth]
      : [0]

    for (const item of labels) {
      const fontSize = item.fontSize * 0.026
      const glyphEntries: MapWorldLabelGlyph[] = []
      let minX = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY

      for (const glyph of item.glyphs) {
        const projected = projection.project(glyph.lon, glyph.lat, centralMeridian)
        if (!projected)
          continue

        if (projected.x < minX)
          minX = projected.x
        if (projected.x > maxX)
          maxX = projected.x
        if (projected.y < minY)
          minY = projected.y
        if (projected.y > maxY)
          maxY = projected.y

        const meshCopies: Text[] = []
        for (const worldOffset of worldOffsets) {
          const text = new Text()
          text.text = glyph.char
          text.font = '/fonts/noto-sans-sc-bold.woff'
          text.fontSize = fontSize
          text.color = item.color
          text.anchorX = 'center'
          text.anchorY = item.isCurved ? 'middle' : (item.offsetUpRatio ? 'bottom' : 'middle')
          text.depthOffset = -2
          text.outlineWidth = fontSize * 0.10
          text.outlineColor = item.outlineColor
          text.outlineOpacity = 0.95

          const posX = projected.x + worldOffset
          const posY = projected.y + (!item.isCurved && item.offsetUpRatio ? fontSize * 0.75 + 0.012 : 0)
          text.position.set(posX, posY, 0.75)
          if (item.isCurved) {
            text.rotation.z = glyph.angle2D
          }
          text.renderOrder = 9

          text.sync()
          this.labelMeshes.push(text)
          this.labelLayer.add(text)
          meshCopies.push(text)
        }

        glyphEntries.push({
          meshCopies,
          baseX: projected.x,
          baseY: projected.y,
        })
      }

      if (glyphEntries.length === 0)
        continue

      const centerBaseX = (minX + maxX) * 0.5
      const centerBaseY = (minY + maxY) * 0.5
      const charCount = Array.from(item.name).length
      const bboxWidth = item.isCurved
        ? Math.max(charCount * fontSize * 0.9, maxX - minX + fontSize * 1.2)
        : charCount * fontSize * 1.05
      const bboxHeight = item.isCurved
        ? Math.max(fontSize * 1.3, maxY - minY + fontSize * 1.2)
        : fontSize * 1.2

      this.worldLabelEntries.push({
        item,
        priority: item.population ?? 1000,
        fontSize2D: fontSize,
        glyphs: glyphEntries,
        centerBaseX,
        centerBaseY,
        bboxWidth,
        bboxHeight,
      })
    }

    this.worldLabelEntries.sort((a, b) => b.priority - a.priority)
    this.group.add(this.labelLayer)
  }

  private addSettlementLabels(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    projection: MapProjection,
    centralMeridian: number,
  ): void {
    if (!params.appearance.overlays.cities && !params.appearance.overlays['sacred-sites'])
      return

    const items = computeSettlementLabels(mesh, data, params)
    if (items.length === 0)
      return

    this.settlementLabelLayer = new Group()
    this.settlementLabelLayer.name = 'MapSettlementLabels'

    const worldOffsets = projection.wrapX
      ? [-projection.worldWidth, 0, projection.worldWidth]
      : [0]

    const getPriority = (item: SettlementLabelItem): number => {
      const pop = (item.id < 100000 && data.society?.settlements[item.id])
        ? data.society.settlements[item.id].population || 0
        : 0
      if (item.isCapital)
        return 1000000 + pop
      if (item.isSacredSite)
        return 400000
      if (item.tier === 'high')
        return 500000 + pop
      if (item.tier === 'mid')
        return 100000 + pop
      return pop
    }

    for (const item of items) {
      const projected = projection.project(item.lon, item.lat, centralMeridian)
      if (!projected)
        continue

      const iconMeshes: Text[] = []
      const nameMeshes: Text[] = []

      for (const worldOffset of worldOffsets) {
        const iconText = new Text()
        iconText.text = item.iconChar
        iconText.font = '/fonts/maki.woff'
        iconText.fontSize = item.iconSize2D
        iconText.color = item.iconColor
        iconText.anchorX = 'center'
        iconText.anchorY = 'middle'
        iconText.depthOffset = -2
        iconText.outlineWidth = item.iconSize2D * 0.10
        iconText.outlineColor = 0x050C16
        iconText.outlineOpacity = 0.95
        iconText.position.set(projected.x + worldOffset, projected.y, 0.82)
        iconText.renderOrder = 8.5
        iconText.sync()

        const nameText = new Text()
        nameText.text = item.name
        nameText.font = '/fonts/noto-sans-sc-bold.woff'
        nameText.fontSize = item.fontSize2D
        nameText.color = item.nameColor
        nameText.anchorX = 'left'
        nameText.anchorY = 'middle'
        nameText.depthOffset = -2
        nameText.outlineWidth = item.fontSize2D * 0.10
        nameText.outlineColor = 0x050C16
        nameText.outlineOpacity = 0.95

        const nameX = projected.x + worldOffset + item.iconSize2D * 0.60 + 0.006
        const nameY = projected.y
        nameText.position.set(nameX, nameY, 0.82)
        nameText.renderOrder = 8.5
        nameText.sync()

        this.settlementLabelLayer.add(iconText)
        this.settlementLabelLayer.add(nameText)
        this.settlementLabelMeshes.push(iconText, nameText)
        iconMeshes.push(iconText)
        nameMeshes.push(nameText)
      }

      this.settlementLabelEntries.push({
        item,
        priority: getPriority(item),
        iconMeshes,
        nameMeshes,
        baseX: projected.x,
        baseY: projected.y,
      })
    }

    this.settlementLabelEntries.sort((a, b) => b.priority - a.priority)
    this.group.add(this.settlementLabelLayer)
  }

  updateLOD(zoom: number, force = false): void {
    if (!force && Math.abs(zoom - this.lastDeclutterZoom) < 0.015)
      return
    this.lastDeclutterZoom = zoom

    const textScale = Math.min(1.0, (1 + 0.16 * Math.log2(Math.max(1, zoom))) / zoom)
    const worldTextScale = Math.min(1.0, (1 + 0.14 * Math.log2(Math.max(1, zoom))) / zoom)
    const paddingX = 0.020 * textScale
    const paddingY = 0.012 * textScale
    const occupiedBoxes: BoundingBox2D[] = []

    if (this.labelLayer && this.worldLabelEntries.length > 0) {
      const showWorldLabels = zoom < 6.5

      if (!showWorldLabels) {
        for (const entry of this.worldLabelEntries) {
          for (const g of entry.glyphs) {
            for (const m of g.meshCopies) m.visible = false
          }
        }
      }
      else {
        for (const entry of this.worldLabelEntries) {
          const halfW = entry.bboxWidth * worldTextScale * 0.5 + paddingX
          const halfH = entry.bboxHeight * worldTextScale * 0.5 + paddingY
          const box: BoundingBox2D = {
            minX: entry.centerBaseX - halfW,
            maxX: entry.centerBaseX + halfW,
            minY: entry.centerBaseY - halfH,
            maxY: entry.centerBaseY + halfH,
          }

          let collides = false
          for (const occ of occupiedBoxes) {
            if (boxesIntersect(box, occ)) {
              collides = true
              break
            }
          }

          if (collides) {
            for (const g of entry.glyphs) {
              for (const m of g.meshCopies) m.visible = false
            }
          }
          else {
            for (const g of entry.glyphs) {
              for (const m of g.meshCopies) {
                m.visible = true
                m.scale.set(worldTextScale, worldTextScale, 1)
              }
            }
            occupiedBoxes.push(box)
          }
        }
      }
    }

    if (this.settlementLabelLayer && this.settlementLabelEntries.length > 0) {
      for (const entry of this.settlementLabelEntries) {
        for (let i = 0; i < entry.iconMeshes.length; i++) {
          const iconMesh = entry.iconMeshes[i]
          const nameMesh = entry.nameMeshes[i]
          iconMesh.scale.set(textScale, textScale, 1)
          nameMesh.scale.set(textScale, textScale, 1)
          // position is already set, except we might need to adjust name mesh slightly relative to icon based on textScale
          // but previous code did:
          // nameMesh.position.set(entry.baseX + worldOffset + nameOffset, entry.baseY, 0.82)
          // we can just re-read the current x position of iconMesh
          const worldOffset = iconMesh.position.x - entry.baseX
          const nameOffset = (entry.item.iconSize2D * 0.60 + 0.006) * textScale
          nameMesh.position.set(entry.baseX + worldOffset + nameOffset, entry.baseY, 0.82)
        }
      }

      for (const entry of this.settlementLabelEntries) {
        let tierAllowed = false
        if (zoom < 1.6) {
          tierAllowed = entry.item.tier === 'high' && (entry.item.isCapital || entry.priority > 600000)
        }
        else if (zoom < 3.2) {
          tierAllowed = entry.item.tier === 'high'
        }
        else if (zoom < 7.5) {
          tierAllowed = entry.item.tier === 'high' || entry.item.tier === 'mid'
        }
        else if (zoom < 14.0) {
          tierAllowed = entry.item.tier === 'high' || entry.item.tier === 'mid' || entry.item.rank === 'town'
        }
        else {
          tierAllowed = true
        }

        if (!tierAllowed) {
          for (const icon of entry.iconMeshes) icon.visible = false
          for (const name of entry.nameMeshes) name.visible = false
          continue
        }

        const iconHalf = entry.item.iconSize2D * textScale * 0.52 + paddingX
        const iconBox: BoundingBox2D = {
          minX: entry.baseX - iconHalf,
          maxX: entry.baseX + iconHalf,
          minY: entry.baseY - iconHalf,
          maxY: entry.baseY + iconHalf,
        }

        let iconCollides = false
        for (const box of occupiedBoxes) {
          if (boxesIntersect(iconBox, box)) {
            iconCollides = true
            break
          }
        }

        if (iconCollides) {
          for (const icon of entry.iconMeshes) icon.visible = false
          for (const name of entry.nameMeshes) name.visible = false
          continue
        }

        for (const icon of entry.iconMeshes) icon.visible = true
        occupiedBoxes.push(iconBox)

        const charLen = Array.from(entry.item.name).length
        const nameW = charLen * entry.item.fontSize2D * textScale * 1.05 + paddingX
        const nameH = entry.item.fontSize2D * textScale * 1.0 + paddingY
        const nameStartX = entry.baseX + (entry.item.iconSize2D * 0.60 + 0.006) * textScale
        const nameBox: BoundingBox2D = {
          minX: nameStartX,
          maxX: nameStartX + nameW,
          minY: entry.baseY - nameH * 0.5,
          maxY: entry.baseY + nameH * 0.5,
        }

        let nameCollides = false
        for (const box of occupiedBoxes) {
          if (box === iconBox)
            continue
          if (boxesIntersect(nameBox, box)) {
            nameCollides = true
            break
          }
        }

        if (nameCollides) {
          for (const name of entry.nameMeshes) name.visible = false
        }
        else {
          for (const name of entry.nameMeshes) name.visible = true
          occupiedBoxes.push(nameBox)
        }
      }
    }
  }

  dispose(): void {
    this.group.clear()
    this.worldLabelEntries = []
    for (const text of this.labelMeshes) text.dispose()
    this.labelMeshes = []

    this.settlementLabelEntries = []
    for (const text of this.settlementLabelMeshes) text.dispose()
    this.settlementLabelMeshes = []
  }
}
