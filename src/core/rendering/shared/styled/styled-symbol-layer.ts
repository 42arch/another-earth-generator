import type { Camera } from 'three'
import type { GeoJsonFeature, GeoJsonPosition, SymbolFeature } from '@/core/data-source'
import type SphericalMesh from '@/core/mesh/mesh'
import type { MapProjection } from '@/core/projections/map-projection'
import type { CollisionGrid, SettlementPickableLayer, StyledLayerBehavior, StyledLayerUpdateContext, SymbolCollisionBox, ViewportBounds } from '@/core/rendering/shared/styled/styled-layer-behavior'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import { FrontSide, Group, MeshBasicMaterial, Vector3 } from 'three'
import { BatchedText, Text } from 'troika-three-text'
import { getImportedGeoJsonSource, resolveGeoJsonSource, SYMBOL_SOURCE_ADAPTERS } from '@/core/data-source'
import { computeTangentBasis } from '@/core/mesh/tangent-basis'
import { getMapSymbolGlyph } from '@/core/rendering/shared/styled/map-symbols'
import { getMapStyleLayer, getMapStyleLayout, getMapStylePaint, isMapStyleLayerVisible, matchesMapStyleLayerFilter } from '@/core/styles'

type SymbolPlacement
  = | { view: 'map', projection: MapProjection, centralMeridian: number, renderOrder: number }
    | { view: 'globe', terrainVerticalScale: number, usesElevationGeometry: boolean, planetRadius: number, renderOrder: number }

interface PlacedGlyph {
  text: Text
  baseX: number
  baseY: number
  original: string
}

interface SymbolEntry {
  feature: SymbolFeature
  glyphs: PlacedGlyph[]
  icons: Text[]
  names: Text[]
  baseX: number
  baseY: number
  width: number
  height: number
  lastVisible?: boolean
}

function mapIconLabelOffset(iconSize: number, textOffsetRatio: number): number {
  return iconSize * textOffsetRatio * 0.75 + 0.002
}

/** One renderer for every style-document symbol layer; sources provide feature layout. */
export class StyledSymbolLayer implements StyledLayerBehavior, SettlementPickableLayer {
  readonly group = new Group()
  private readonly layerId: string
  private readonly sourceId: string
  private readonly placement: SymbolPlacement
  private readonly initialStyleId: string
  private readonly entries: SymbolEntry[] = []
  private readonly texts: Text[] = []
  private readonly batches: BatchedText[] = []
  private readonly batchMembers = new Map<BatchedText, Text[]>()
  private readonly material = new MeshBasicMaterial({ side: FrontSide, depthTest: true, depthWrite: false })
  private lastZoom = Number.NaN
  private lastStyleVisible: boolean | undefined

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    layerId: string,
    placement: SymbolPlacement,
  ) {
    this.layerId = layerId
    this.placement = placement
    this.initialStyleId = params.appearance.mapStyle
    this.group.name = `StyledSymbols:${layerId}:${placement.view}`
    const styleLayer = getMapStyleLayer(params.appearance.mapStyle, layerId)
    this.sourceId = styleLayer?.source ?? ''
    const collection = styleLayer?.renderer === 'symbol'
      ? resolveGeoJsonSource(styleLayer.source, mesh, data, params)?.data
      : undefined
    const adapter = styleLayer?.renderer === 'symbol' && !getImportedGeoJsonSource(styleLayer.source)
      ? SYMBOL_SOURCE_ADAPTERS[styleLayer.source]
      : undefined
    const sourceResult = adapter?.({ mesh, data, params })
    const features = (collection?.features ?? []).flatMap(feature =>
      sourceResult?.layout.get(feature.id) ?? this.genericPointFeature(feature, params) ?? [])
      .filter(feature => this.sourceId !== 'settlement-labels' || feature.properties.isSacredSite !== true)
    const iconBatches = new Map<string, BatchedText>()
    const nameBatches = new Map<string, BatchedText>()
    const getBatch = (kind: 'icon' | 'name', tier: string) => {
      const batches = kind === 'icon' ? iconBatches : nameBatches
      let batch = batches.get(tier)
      if (!batch) {
        batch = new BatchedText()
        batch.name = `${layerId}:${kind}:${tier}`
        batch.material = this.material
        batch.renderOrder = placement.renderOrder
        batch.frustumCulled = false
        batches.set(tier, batch)
        this.batches.push(batch)
        this.batchMembers.set(batch, [])
        this.group.add(batch)
      }
      return batch
    }

    for (const feature of features) {
      if (placement.view === 'map')
        this.buildMapFeature(feature, placement, getBatch)
      else
        this.buildGlobeFeature(feature, placement, data, getBatch)
    }
    for (const batch of this.batches)
      batch.sync()
    this.entries.sort((a, b) => b.feature.priority - a.feature.priority)
  }

  private genericPointFeature(feature: GeoJsonFeature, params: WorldConfig): SymbolFeature | null {
    const geometry = feature.geometry
    const anchor = geometry.type === 'Point'
      ? geometry.coordinates
      : geometry.type === 'MultiPoint'
        ? geometry.coordinates[0]
        : geometry.type === 'LineString'
          ? geometry.coordinates[Math.floor(geometry.coordinates.length / 2)]
          : geometry.type === 'MultiLineString'
            ? geometry.coordinates[0]?.[Math.floor((geometry.coordinates[0]?.length ?? 0) / 2)]
            : geometry.type === 'Polygon'
              ? this.polygonAnchor(geometry.coordinates[0])
              : this.polygonAnchor(geometry.coordinates[0]?.[0])
    if (!anchor)
      return null
    const [longitude, latitude] = anchor
    const lon = longitude * Math.PI / 180
    const lat = latitude * Math.PI / 180
    const normal = new Vector3(Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat))
    const { matrix: matrix3D, right } = computeTangentBasis(normal)
    const name = String(feature.properties.name ?? '')
    const iconImage = getMapStyleLayout(params.appearance.mapStyle, this.layerId, 'icon-image', 0, feature.properties)
    return {
      id: feature.id,
      name,
      properties: feature.properties,
      glyphs: [{ char: name, region: -1, lon, lat, normal, matrix3D, angle2D: 0 }],
      curved: false,
      priority: Number(feature.properties.priority ?? 0),
      fontSize2D: 0.045,
      fontSize3D: 1.1,
      color: 0xFFFFFF,
      haloColor: 0x202020,
      icon: typeof iconImage === 'string' && iconImage.length > 0
        ? { char: iconImage, color: 0xFFFFFF, size2D: 0.06, size3D: 1.3, right3D: right }
        : undefined,
    }
  }

  private polygonAnchor(ring: GeoJsonPosition[] | undefined): GeoJsonPosition | null {
    if (!ring || ring.length < 4)
      return null
    let longitude = 0
    let latitude = 0
    const count = ring.length - 1
    const reference = ring[0][0]
    for (let index = 0; index < count; index++) {
      let value = ring[index][0]
      while (value - reference > 180)
        value -= 360
      while (value - reference < -180)
        value += 360
      longitude += value
      latitude += ring[index][1]
    }
    return [((longitude / count + 180) % 360 + 360) % 360 - 180, latitude / count]
  }

  private makeText(content: string, font: string, size: number, color: number | string, halo: number | string, order: number): Text {
    const text = new Text()
    text.text = content
    text.font = font
    text.fontSize = size
    text.color = color
    text.outlineColor = halo
    text.outlineWidth = size * 0.1
    text.outlineOpacity = 1
    text.fillOpacity = 1
    text.depthOffset = -2
    text.renderOrder = order
    this.texts.push(text)
    return text
  }

  private addToBatch(batch: BatchedText, text: Text): void {
    text.updateMatrix()
    batch.addText(text)
    this.batchMembers.get(batch)?.push(text)
  }

  private buildMapFeature(
    feature: SymbolFeature,
    placement: Extract<SymbolPlacement, { view: 'map' }>,
    getBatch: (kind: 'icon' | 'name', tier: string) => BatchedText,
  ): void {
    const offsets = placement.projection.wrapX
      ? [-placement.projection.worldWidth, 0, placement.projection.worldWidth]
      : [0]
    const glyphs: PlacedGlyph[] = []
    const icons: Text[] = []
    const names: Text[] = []
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    const initialTextRatio = Number(getMapStyleLayout(this.initialStyleId, this.layerId, 'text-size', 0, feature.properties) ?? 1)
    const initialIconRatio = Number(getMapStyleLayout(this.initialStyleId, this.layerId, 'icon-size', 0, feature.properties) ?? initialTextRatio)
    const iconImage = String(getMapStyleLayout(this.initialStyleId, this.layerId, 'icon-image', 0, feature.properties) ?? '')
    const iconChar = iconImage ? getMapSymbolGlyph(iconImage) : (feature.icon?.char ?? '●')
    const textOffset = (getMapStyleLayout(this.initialStyleId, this.layerId, 'text-offset', 0, feature.properties) as [number, number]) ?? [0.65, 0]
    const labelAboveIcon = textOffset[1] > 0
    const baseFontSize2D = feature.fontSize2D ?? 0.038
    const baseIconSize2D = feature.icon?.size2D ?? 0.046
    const fontSize2D = baseFontSize2D * initialTextRatio
    const iconSize2D = baseIconSize2D * initialIconRatio
    const iconLabelOffset = mapIconLabelOffset(iconSize2D, labelAboveIcon ? textOffset[1] : textOffset[0])
    const iconColor = String(getMapStylePaint(this.initialStyleId, this.layerId, 'icon-color', 0, feature.properties) ?? feature.icon?.color ?? feature.color)
    const textColor = String(getMapStylePaint(this.initialStyleId, this.layerId, 'text-color', 0, feature.properties) ?? feature.color)
    const haloColor = String(getMapStylePaint(this.initialStyleId, this.layerId, 'text-halo-color', 0, feature.properties) ?? feature.haloColor)

    for (const glyph of feature.glyphs) {
      const position = placement.projection.project(glyph.lon, glyph.lat, placement.centralMeridian)
      if (!position)
        continue
      minX = Math.min(minX, position.x)
      maxX = Math.max(maxX, position.x)
      minY = Math.min(minY, position.y)
      maxY = Math.max(maxY, position.y)
      for (const offset of offsets) {
        if (feature.icon) {
          const icon = this.makeText(iconChar, '/fonts/map-symbols.woff', iconSize2D, iconColor, haloColor, placement.renderOrder)
          icon.anchorX = 'center'
          icon.anchorY = 'middle'
          icon.position.set(position.x + offset, position.y, 0.82)
          this.addToBatch(getBatch('icon', 'map'), icon)
          icons.push(icon)

          if (feature.properties.isSacredSite !== true) {
            const name = this.makeText(feature.name, '/fonts/noto-sans-sc-bold.woff', fontSize2D, textColor, haloColor, placement.renderOrder)
            name.anchorX = labelAboveIcon ? 'center' : 'left'
            name.anchorY = labelAboveIcon ? 'bottom' : 'middle'
            name.position.set(position.x + offset + (labelAboveIcon ? 0 : iconLabelOffset), position.y + (labelAboveIcon ? iconLabelOffset : 0), 0.82)
            this.addToBatch(getBatch('name', 'map'), name)
            names.push(name)
          }
        }
        else {
          const text = this.makeText(glyph.char, '/fonts/noto-sans-sc-bold.woff', fontSize2D, textColor, haloColor, placement.renderOrder)
          text.anchorX = 'center'
          text.anchorY = feature.curved ? 'middle' : feature.offsetUpRatio ? 'bottom' : 'middle'
          text.position.set(position.x + offset, position.y + (!feature.curved && feature.offsetUpRatio ? fontSize2D * 0.75 + 0.012 : 0), 0.75)
          if (feature.curved)
            text.rotation.z = glyph.angle2D
          text.sync()
          this.group.add(text)
          glyphs.push({ text, baseX: position.x, baseY: position.y, original: glyph.char })
        }
      }
    }
    if (!Number.isFinite(minX))
      return
    let width: number
    let height: number
    if (feature.icon && names.length === 0) {
      width = iconSize2D
      height = iconSize2D
    }
    else if (feature.icon && labelAboveIcon) {
      width = Math.max(iconSize2D, Array.from(feature.name).length * fontSize2D * 1.05)
      height = 2 * (iconLabelOffset + fontSize2D * 1.2)
    }
    else if (feature.curved) {
      width = Math.max(Array.from(feature.name).length * fontSize2D * 0.9, maxX - minX + fontSize2D * 1.2)
      height = Math.max(fontSize2D * 1.3, maxY - minY + fontSize2D * 1.2)
    }
    else {
      width = Array.from(feature.name).length * fontSize2D * 1.05
      height = fontSize2D * 1.2
    }
    this.entries.push({ feature, glyphs, icons, names, baseX: (minX + maxX) / 2, baseY: (minY + maxY) / 2, width, height })
  }

  private buildGlobeFeature(
    feature: SymbolFeature,
    placement: Extract<SymbolPlacement, { view: 'globe' }>,
    data: WorldSimulationState,
    getBatch: (kind: 'icon' | 'name', tier: string) => BatchedText,
  ): void {
    const glyphs: PlacedGlyph[] = []
    const icons: Text[] = []
    const names: Text[] = []
    const initialTextRatio = Number(getMapStyleLayout(this.initialStyleId, this.layerId, 'text-size', 0, feature.properties) ?? 1)
    const initialIconRatio = Number(getMapStyleLayout(this.initialStyleId, this.layerId, 'icon-size', 0, feature.properties) ?? initialTextRatio)
    const iconImage = String(getMapStyleLayout(this.initialStyleId, this.layerId, 'icon-image', 0, feature.properties) ?? '')
    const iconChar = iconImage ? getMapSymbolGlyph(iconImage) : (feature.icon?.char ?? '●')
    const textOffset = (getMapStyleLayout(this.initialStyleId, this.layerId, 'text-offset', 0, feature.properties) as [number, number]) ?? [0.65, 0]
    const labelAboveIcon = textOffset[1] > 0
    const baseFontSize3D = feature.fontSize3D ?? 1.0
    const baseIconSize3D = feature.icon?.size3D ?? 1.0
    const fontSize3D = baseFontSize3D * initialTextRatio
    const iconSize3D = baseIconSize3D * initialIconRatio
    const iconColor = String(getMapStylePaint(this.initialStyleId, this.layerId, 'icon-color', 0, feature.properties) ?? feature.icon?.color ?? feature.color)
    const textColor = String(getMapStylePaint(this.initialStyleId, this.layerId, 'text-color', 0, feature.properties) ?? feature.color)
    const haloColor = String(getMapStylePaint(this.initialStyleId, this.layerId, 'text-halo-color', 0, feature.properties) ?? feature.haloColor)

    for (const glyph of feature.glyphs) {
      const elevation = glyph.region >= 0 ? data.geography.elevation[glyph.region] : 0
      const radius = placement.planetRadius
        + (placement.usesElevationGeometry ? elevation * placement.terrainVerticalScale : 0)
        + (feature.icon ? 0.38 : 0.45)
      const position = glyph.normal.clone().multiplyScalar(radius)
      if (feature.icon) {
        const icon = this.makeText(iconChar, '/fonts/map-symbols.woff', iconSize3D, iconColor, haloColor, placement.renderOrder)
        icon.anchorX = 'center'
        icon.anchorY = 'middle'
        icon.position.copy(position)
        icon.rotation.setFromRotationMatrix(glyph.matrix3D)
        this.addToBatch(getBatch('icon', feature.tier ?? 'low'), icon)
        icons.push(icon)

        if (feature.properties.isSacredSite !== true) {
          const name = this.makeText(feature.name, '/fonts/noto-sans-sc-bold.woff', fontSize3D, textColor, haloColor, placement.renderOrder)
          name.anchorX = labelAboveIcon ? 'center' : 'left'
          name.anchorY = labelAboveIcon ? 'bottom' : 'middle'
          const labelDirection = labelAboveIcon
            ? new Vector3().setFromMatrixColumn(glyph.matrix3D, 1)
            : feature.icon.right3D.clone()
          const labelOffset = labelAboveIcon ? textOffset[1] : textOffset[0]
          name.position.copy(position).add(labelDirection.multiplyScalar(iconSize3D * labelOffset + 0.12))
          name.rotation.setFromRotationMatrix(glyph.matrix3D)
          this.addToBatch(getBatch('name', feature.tier ?? 'low'), name)
          names.push(name)
        }
      }
      else {
        const text = this.makeText(glyph.char, '/fonts/noto-sans-sc-bold.woff', fontSize3D, textColor, haloColor, placement.renderOrder)
        text.anchorX = 'center'
        text.anchorY = feature.curved ? 'middle' : feature.offsetUpRatio ? 'bottom' : 'middle'
        if (!feature.curved && feature.offsetUpRatio) {
          const up = new Vector3().setFromMatrixColumn(glyph.matrix3D, 1)
          position.add(up.multiplyScalar(feature.offsetUpRatio))
        }
        text.position.copy(position)
        text.rotation.setFromRotationMatrix(glyph.matrix3D)
        text.material = this.material
        text.sync()
        this.group.add(text)
        glyphs.push({ text, baseX: 0, baseY: 0, original: glyph.char })
      }
    }
    this.entries.push({ feature, glyphs, icons, names, baseX: 0, baseY: 0, width: 0, height: 0 })
  }

  updateStyle(context: StyledLayerUpdateContext): void {
    if (context.view === 'map') {
      this.updateMapZoom(
        context.styleId,
        context.viewZoom,
        context.styleZoom,
        context.collisionGrid,
        context.viewportBounds,
      )
    }
    else {
      this.updateGlobeZoom(context.styleId, context.styleZoom)
    }
  }

  updateMapZoom(
    styleId: string,
    cameraZoom: number,
    styleZoom: number,
    collisionGrid?: CollisionGrid,
    viewportBounds?: ViewportBounds,
  ): void {
    if (this.placement.view !== 'map')
      return

    const styleVisible = isMapStyleLayerVisible(styleId, this.layerId, styleZoom, 'map')
    this.group.visible = styleVisible
    if (!styleVisible) {
      for (const entry of this.entries)
        this.styleEntry(entry, styleId, styleZoom, 0, false)
      return
    }

    const textScale = Math.min(1, (1 + 0.16 * Math.log2(Math.max(1, cameraZoom))) / cameraZoom)
    const worldScale = Math.min(1, (1 + 0.14 * Math.log2(Math.max(1, cameraZoom))) / cameraZoom)
    const paddingX = 0.02 * textScale
    const paddingY = 0.012 * textScale

    const vpMinX = viewportBounds ? viewportBounds.minX - 0.2 : Number.NEGATIVE_INFINITY
    const vpMaxX = viewportBounds ? viewportBounds.maxX + 0.2 : Number.POSITIVE_INFINITY
    const vpMinY = viewportBounds ? viewportBounds.minY - 0.2 : Number.NEGATIVE_INFINITY
    const vpMaxY = viewportBounds ? viewportBounds.maxY + 0.2 : Number.POSITIVE_INFINITY
    const wrapX = this.placement.projection.wrapX
    const worldWidth = this.placement.projection.worldWidth

    for (const entry of this.entries) {
      const { feature } = entry

      if (viewportBounds && (entry.baseY + entry.height * 0.5 < vpMinY || entry.baseY - entry.height * 0.5 > vpMaxY)) {
        this.styleEntry(entry, styleId, styleZoom, 0, false)
        continue
      }

      if (viewportBounds) {
        let inViewportX = false
        if (wrapX) {
          const halfW = entry.width * 0.5
          if ((entry.baseX - worldWidth + halfW >= vpMinX && entry.baseX - worldWidth - halfW <= vpMaxX)
            || (entry.baseX + halfW >= vpMinX && entry.baseX - halfW <= vpMaxX)
            || (entry.baseX + worldWidth + halfW >= vpMinX && entry.baseX + worldWidth - halfW <= vpMaxX)) {
            inViewportX = true
          }
        }
        else {
          const halfW = entry.width * 0.5
          inViewportX = entry.baseX + halfW >= vpMinX && entry.baseX - halfW <= vpMaxX
        }
        if (!inViewportX) {
          this.styleEntry(entry, styleId, styleZoom, 0, false)
          continue
        }
      }

      const visible = (feature.mapMaxCameraZoom === undefined || cameraZoom < feature.mapMaxCameraZoom)
        && matchesMapStyleLayerFilter(styleId, this.layerId, styleZoom, feature.properties)
      if (!visible) {
        this.styleEntry(entry, styleId, styleZoom, 0, false)
        continue
      }

      const resolvedSize = Number(getMapStyleLayout(styleId, this.layerId, 'text-size', styleZoom, feature.properties) ?? 1)
      const initialSize = Number(getMapStyleLayout(styleId, this.layerId, 'text-size', 0, feature.properties) ?? 1)
      const resolvedIconSize = Number(getMapStyleLayout(styleId, this.layerId, 'icon-size', styleZoom, feature.properties) ?? resolvedSize)
      const textOffset = (getMapStyleLayout(styleId, this.layerId, 'text-offset', styleZoom, feature.properties) as [number, number]) ?? [0.65, 0]
      const labelAboveIcon = textOffset[1] > 0
      const baseIconSize = feature.icon?.size2D ?? 0.046
      const baseFontSize = feature.fontSize2D ?? 0.038
      const scale = (feature.icon ? textScale : worldScale) * resolvedSize / Math.max(initialSize, Number.EPSILON)
      const iconSizeVal = baseIconSize * resolvedIconSize * scale
      const width = feature.icon ? iconSizeVal : entry.width * scale
      const height = feature.icon ? iconSizeVal : entry.height * scale

      const box: SymbolCollisionBox = { minX: entry.baseX - width * 0.52 - paddingX, maxX: entry.baseX + width * 0.52 + paddingX, minY: entry.baseY - height * 0.52 - paddingY, maxY: entry.baseY + height * 0.52 + paddingY }

      const draw = !collisionGrid?.collides(box)
      if (draw && collisionGrid)
        collisionGrid.insert(box)

      this.styleEntry(entry, styleId, styleZoom, scale, draw)

      if (feature.icon && draw && entry.names.length > 0) {
        const nameSizeVal = baseFontSize * initialSize * scale
        const nameWidth = Array.from(feature.name).length * nameSizeVal * 1.05 + paddingX
        const labelOffset = mapIconLabelOffset(iconSizeVal, labelAboveIcon ? textOffset[1] : textOffset[0])
        const nameBox: SymbolCollisionBox = labelAboveIcon
          ? {
              minX: entry.baseX - nameWidth * 0.5,
              maxX: entry.baseX + nameWidth * 0.5,
              minY: entry.baseY + labelOffset - paddingY,
              maxY: entry.baseY + labelOffset + nameSizeVal * 1.2 + paddingY,
            }
          : {
              minX: entry.baseX + labelOffset,
              maxX: entry.baseX + labelOffset + nameWidth,
              minY: entry.baseY - nameSizeVal * 0.5 - paddingY,
              maxY: entry.baseY + nameSizeVal * 0.5 + paddingY,
            }

        const showName = !collisionGrid?.collides(nameBox, box)

        for (let index = 0; index < entry.names.length; index++) {
          const name = entry.names[index]
          const icon = entry.icons[index]
          name.position.x = icon.position.x + (labelAboveIcon ? 0 : labelOffset)
          name.position.y = icon.position.y + (labelAboveIcon ? labelOffset : 0)
          name.scale.set(showName ? scale : 0, showName ? scale : 0, showName ? 1 : 0)
          name.updateMatrix()
        }

        if (showName && collisionGrid)
          collisionGrid.insert(nameBox)
      }
    }
  }

  updateGlobeZoom(styleId: string, zoom: number): void {
    if (this.placement.view !== 'globe')
      return
    const styleVisible = isMapStyleLayerVisible(styleId, this.layerId, zoom, 'globe')
    const visibilityChanged = styleVisible !== this.lastStyleVisible
    this.group.visible = styleVisible
    if (Math.abs(zoom - this.lastZoom) < 0.15 && !visibilityChanged)
      return
    this.lastZoom = zoom
    this.lastStyleVisible = styleVisible
    for (const entry of this.entries) {
      const visible = this.group.visible
        && matchesMapStyleLayerFilter(styleId, this.layerId, zoom, entry.feature.properties)
      this.styleEntry(entry, styleId, zoom, 1, visible)
    }
  }

  private styleEntry(entry: SymbolEntry, styleId: string, zoom: number, scale: number, visible: boolean): void {
    if (!visible) {
      if (entry.lastVisible !== false) {
        entry.lastVisible = false
        for (const glyph of entry.glyphs) {
          glyph.text.visible = false
          glyph.text.scale.set(0, 0, 0)
        }
        for (const icon of entry.icons) {
          icon.visible = false
          icon.scale.set(0, 0, 0)
        }
        for (const name of entry.names) {
          name.visible = false
          name.scale.set(0, 0, 0)
        }
      }
      return
    }
    entry.lastVisible = true

    const { feature } = entry
    const textSize = Number(getMapStyleLayout(styleId, this.layerId, 'text-size', zoom, feature.properties) ?? 1)
    const initialTextSize = Number(getMapStyleLayout(styleId, this.layerId, 'text-size', 0, feature.properties) ?? 1)
    const textSizeScale = textSize / Math.max(initialTextSize, Number.EPSILON)
    const iconSize = Number(getMapStyleLayout(styleId, this.layerId, 'icon-size', zoom, feature.properties) ?? textSize)
    const initialIconSize = Number(getMapStyleLayout(styleId, this.layerId, 'icon-size', 0, feature.properties) ?? initialTextSize)
    const iconSizeScale = iconSize / Math.max(initialIconSize, Number.EPSILON)
    const iconImage = String(getMapStyleLayout(styleId, this.layerId, 'icon-image', zoom, feature.properties) ?? '')
    const text = String(getMapStyleLayout(styleId, this.layerId, 'text-field', zoom, feature.properties) ?? feature.name)
    const color = String(getMapStylePaint(styleId, this.layerId, 'text-color', zoom, feature.properties) ?? feature.color)
    const halo = String(getMapStylePaint(styleId, this.layerId, 'text-halo-color', zoom, feature.properties) ?? feature.haloColor)
    const haloWidth = Number(getMapStylePaint(styleId, this.layerId, 'text-halo-width', zoom, feature.properties) ?? 0.1)
    const opacity = Number(getMapStylePaint(styleId, this.layerId, 'text-opacity', zoom, feature.properties) ?? 1)
    const iconColor = String(getMapStylePaint(styleId, this.layerId, 'icon-color', zoom, feature.properties) ?? feature.icon?.color ?? color)

    const textMeshScale = this.placement.view === 'map' ? scale : textSizeScale
    const iconMeshScale = this.placement.view === 'map' ? scale * iconSizeScale : iconSizeScale
    const nameMeshScale = this.placement.view === 'map' ? scale : textSizeScale

    for (const glyph of entry.glyphs) {
      const mesh = glyph.text
      mesh.visible = true
      mesh.scale.set(textMeshScale, textMeshScale, textMeshScale)
      mesh.outlineColor = halo
      mesh.outlineOpacity = opacity
      mesh.fillOpacity = opacity
      mesh.color = color
      if (!feature.curved && glyph.original === feature.name && mesh.text !== text) {
        mesh.text = text
        mesh.sync()
      }
      mesh.updateMatrix()
    }
    for (const icon of entry.icons) {
      icon.visible = true
      icon.scale.set(iconMeshScale, iconMeshScale, iconMeshScale)
      icon.outlineColor = halo
      icon.outlineOpacity = opacity
      icon.fillOpacity = opacity
      icon.color = iconColor
      if (iconImage) {
        const glyphChar = getMapSymbolGlyph(iconImage)
        if (icon.text !== glyphChar) {
          icon.text = glyphChar
          icon.sync()
        }
      }
      icon.updateMatrix()
    }
    for (const name of entry.names) {
      name.visible = true
      name.scale.set(nameMeshScale, nameMeshScale, nameMeshScale)
      name.outlineColor = halo
      name.outlineOpacity = opacity
      name.fillOpacity = opacity
      name.color = color
      if (name.text !== text) {
        name.text = text
        name.sync()
      }
      name.updateMatrix()
    }
  }

  pickFeature(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    camera: Camera,
    include: (feature: SymbolFeature) => boolean,
  ): number | null {
    if (!this.group.visible)
      return null
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const point = new Vector3()
    let nearest = 12 * 12
    let chosen: number | null = null
    for (const entry of this.entries) {
      if (!include(entry.feature) || typeof entry.feature.id !== 'number')
        continue
      for (const icon of entry.icons) {
        if (!icon.visible || icon.scale.x <= 0 || icon.fillOpacity <= 0)
          continue
        point.copy(icon.position)
        if (this.placement.view === 'globe' && point.dot(camera.position) <= point.lengthSq())
          continue
        point.project(camera)
        if (point.z < -1 || point.z > 1)
          continue
        const dx = (point.x + 1) * rect.width / 2 - x
        const dy = (1 - point.y) * rect.height / 2 - y
        const distance = dx * dx + dy * dy
        if (distance < nearest) {
          nearest = distance
          chosen = entry.feature.id
        }
      }
    }
    return chosen
  }

  pickSettlementFeature(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): number | null {
    return this.pickFeature(event, canvas, camera, feature => !feature.properties.isSacredSite)
  }

  pickGeoJsonFeature(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): { sourceId: string, featureId: string | number } | null {
    if (!this.group.visible)
      return null
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const point = new Vector3()
    let nearest = 12 * 12
    let chosen: SymbolFeature | undefined
    for (const entry of this.entries) {
      for (const text of [...entry.icons, ...entry.names, ...entry.glyphs.map(glyph => glyph.text)]) {
        if (!text.visible || text.scale.x <= 0 || text.fillOpacity <= 0)
          continue
        point.copy(text.position)
        if (this.placement.view === 'globe' && point.dot(camera.position) <= point.lengthSq())
          continue
        point.project(camera)
        if (point.z < -1 || point.z > 1)
          continue
        const dx = (point.x + 1) * rect.width / 2 - x
        const dy = (1 - point.y) * rect.height / 2 - y
        const distance = dx * dx + dy * dy
        if (distance < nearest) {
          nearest = distance
          chosen = entry.feature
        }
      }
    }
    return chosen ? { sourceId: this.sourceId, featureId: chosen.id } : null
  }

  dispose(): void {
    this.group.clear()
    for (const batch of this.batches) {
      for (const text of this.batchMembers.get(batch) ?? [])
        batch.removeText(text)
      batch.dispose()
    }
    for (const text of this.texts)
      text.dispose()
    this.material.dispose()
    this.batches.length = 0
    this.texts.length = 0
    this.entries.length = 0
    this.batchMembers.clear()
  }
}
