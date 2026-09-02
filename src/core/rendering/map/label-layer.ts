import type { MapProjection } from '@/core/projections/map-projection'
import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type { SphericalWorldData } from '@/core/spherical/spherical-world-data'
import type { OrthographicCamera } from 'three'
import { Vector3 } from 'three'

type MapLabelKind
  = | 'polity'
    | 'culture'
    | 'religion'
    | 'capital'
    | 'city'
    | 'port'
    | 'town'

interface MapLabelCandidate {
  element: HTMLDivElement
  region: number
  kind: MapLabelKind
  priority: number
  minimumZoom: number
  width: number
  height: number
}

const DOMAIN_KINDS = new Set<MapLabelKind>(['polity', 'culture', 'religion'])
const LABEL_GRID_SIZE = 72

export class MapLabelLayer {
  private readonly root = document.createElement('div')
  private readonly projectedPosition = new Vector3()
  private occupiedCells = new Uint8Array(0)
  private occupiedColumns = 0
  private occupiedRows = 0
  private candidates: MapLabelCandidate[] = []

  constructor(canvas: HTMLCanvasElement) {
    this.root.className = 'map-label-layer'
    this.root.setAttribute('aria-hidden', 'true')
    this.root.style.display = 'none'
    const container = canvas.parentElement ?? document.body
    container.append(this.root)
  }

  rebuild(
    mesh: SphericalMesh,
    data: SphericalWorldData,
    params: GlobeGenParams,
  ): void {
    this.clear()
    if (!params.showMapLabels)
      return

    if (params.displayMode === 'polities' || params.displayMode === 'terrain') {
      const labelRegions = this.findDomainLabelRegions(
        mesh,
        data.human.politics.regionPolity,
        data.human.politics.polities.length,
      )
      for (let polity = 0; polity < data.human.politics.polities.length; polity++) {
        this.addCandidate(
          data.human.politics.polities[polity].name,
          labelRegions[polity],
          'polity',
          140,
          1,
        )
      }
    }

    if (params.displayMode === 'cultures') {
      const labelRegions = this.findDomainLabelRegions(
        mesh,
        data.human.culture.regionCulture,
        data.human.culture.cultures.length,
      )
      for (let culture = 0; culture < data.human.culture.cultures.length; culture++) {
        this.addCandidate(
          data.human.culture.cultures[culture].name,
          labelRegions[culture],
          'culture',
          140,
          1,
        )
      }
    }

    if (params.displayMode === 'religions') {
      const labelRegions = this.findDomainLabelRegions(
        mesh,
        data.human.religion.regionReligion,
        data.human.religion.religions.length,
      )
      for (let religion = 0; religion < data.human.religion.religions.length; religion++) {
        this.addCandidate(
          data.human.religion.religions[religion].name,
          labelRegions[religion],
          'religion',
          140,
          1,
        )
      }
    }

    if (params.showSettlements)
      this.addSettlementLabels(data, params)
    this.candidates.sort((a, b) => b.priority - a.priority || a.region - b.region)
  }

  render(
    mesh: SphericalMesh,
    camera: OrthographicCamera,
    projection: MapProjection,
    centralMeridian: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    if (this.candidates.length === 0)
      return
    const maximumLabels = viewportWidth < 640 ? 18 : viewportWidth < 1000 ? 34 : 56
    this.resetOccupiedCells(viewportWidth, viewportHeight)
    let visibleLabels = 0

    for (const candidate of this.candidates) {
      this.hide(candidate)
      if (camera.zoom < candidate.minimumZoom || visibleLabels >= maximumLabels)
        continue
      const mapPosition = projection.project(
        mesh.regionLongitude[candidate.region],
        mesh.regionLatitude[candidate.region],
        centralMeridian,
      )
      if (!mapPosition)
        continue

      const screenPosition = this.findVisibleWorldCopy(
        mapPosition.x,
        mapPosition.y,
        projection.worldWidth,
        projection.wrapX,
        camera,
      )
      if (!screenPosition)
        continue
      const x = (screenPosition.x * 0.5 + 0.5) * viewportWidth
      const y = (-screenPosition.y * 0.5 + 0.5) * viewportHeight
      const domainLabel = DOMAIN_KINDS.has(candidate.kind)
      const left = x - candidate.width * 0.5
      const right = x + candidate.width * 0.5
      const top = domainLabel ? y - candidate.height * 0.5 : y - candidate.height - 8
      const bottom = domainLabel ? y + candidate.height * 0.5 : y - 5
      if (
        left < 8
        || right > viewportWidth - 8
        || top < 8
        || bottom > viewportHeight - 8
        || this.overlapsOccupiedCell(left, right, top, bottom)
      ) {
        continue
      }

      this.occupyCells(left, right, top, bottom)
      candidate.element.style.transform = domainLabel
        ? `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`
        : `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`
      candidate.element.style.opacity = Math.min(
        1,
        Math.max(
          domainLabel ? 0.48 : 0.28,
          (camera.zoom - candidate.minimumZoom) / 0.5,
        ),
      ).toFixed(3)
      candidate.element.style.visibility = 'visible'
      visibleLabels++
    }
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none'
  }

  clear(): void {
    this.candidates = []
    this.root.replaceChildren()
  }

  destroy(): void {
    this.clear()
    this.root.remove()
  }

  private addSettlementLabels(
    data: SphericalWorldData,
    params: GlobeGenParams,
  ): void {
    const capitalSettlements = new Set(
      data.human.politics.polities.map(polity => polity.capitalSettlement),
    )
    const tradeMode = params.displayMode === 'trade'
    for (let settlement = 0; settlement < data.human.settlements.length; settlement++) {
      const settlementData = data.human.settlements[settlement]
      const isCapital = capitalSettlements.has(settlement)
      let kind: MapLabelKind
      let priority: number
      let minimumZoom: number
      if (isCapital) {
        kind = 'capital'
        priority = 120
        minimumZoom = 1
      }
      else if (settlementData.type === 'city') {
        kind = 'city'
        priority = 92
        minimumZoom = 1.35
      }
      else if (settlementData.isPort) {
        kind = 'port'
        priority = tradeMode ? 88 : 72
        minimumZoom = tradeMode ? 1.6 : 2.1
      }
      else if (settlementData.type === 'town') {
        kind = 'town'
        priority = 56
        minimumZoom = tradeMode ? 2.2 : 3
      }
      else {
        continue
      }
      priority += settlementData.prosperity * 8
      if (tradeMode)
        priority += data.human.trade.settlementMarketAccess[settlement] * 24
      this.addCandidate(
        settlementData.name,
        settlementData.region,
        kind,
        priority,
        minimumZoom,
      )
    }
  }

  private addCandidate(
    text: string,
    region: number,
    kind: MapLabelKind,
    priority: number,
    minimumZoom: number,
  ): void {
    if (!text || region < 0)
      return
    const element = document.createElement('div')
    element.className = `map-label map-label--${kind}`
    element.textContent = text
    element.title = text
    this.root.append(element)
    const domainLabel = DOMAIN_KINDS.has(kind)
    const characterCount = Array.from(text).length
    this.candidates.push({
      element,
      region,
      kind,
      priority,
      minimumZoom,
      width: domainLabel
        ? Math.min(200, Math.max(72, characterCount * 10 + 34))
        : Math.min(170, Math.max(50, characterCount * 7 + 26)),
      height: domainLabel ? 30 : 24,
    })
  }

  private findDomainLabelRegions(
    mesh: SphericalMesh,
    regionOwner: Int16Array,
    domainCount: number,
  ): Int32Array {
    const centroid = new Float64Array(domainCount * 3)
    for (let region = 0; region < mesh.numRegions; region++) {
      const domain = regionOwner[region]
      if (domain < 0)
        continue
      const source = region * 3
      const target = domain * 3
      const weight = mesh.regionArea[region]
      centroid[target] += mesh.regionPosition[source] * weight
      centroid[target + 1] += mesh.regionPosition[source + 1] * weight
      centroid[target + 2] += mesh.regionPosition[source + 2] * weight
    }
    for (let domain = 0; domain < domainCount; domain++) {
      const target = domain * 3
      const length = Math.hypot(
        centroid[target],
        centroid[target + 1],
        centroid[target + 2],
      )
      if (length <= Number.EPSILON)
        continue
      centroid[target] /= length
      centroid[target + 1] /= length
      centroid[target + 2] /= length
    }
    const labelRegions = new Int32Array(domainCount).fill(-1)
    const bestAlignment = new Float32Array(domainCount).fill(-Infinity)
    for (let region = 0; region < mesh.numRegions; region++) {
      const domain = regionOwner[region]
      if (domain < 0)
        continue
      const source = region * 3
      const target = domain * 3
      const alignment = mesh.regionPosition[source] * centroid[target]
        + mesh.regionPosition[source + 1] * centroid[target + 1]
        + mesh.regionPosition[source + 2] * centroid[target + 2]
      if (alignment > bestAlignment[domain]) {
        bestAlignment[domain] = alignment
        labelRegions[domain] = region
      }
    }
    return labelRegions
  }

  private findVisibleWorldCopy(
    x: number,
    y: number,
    worldWidth: number,
    wrapX: boolean,
    camera: OrthographicCamera,
  ): Vector3 | null {
    let best: Vector3 | null = null
    const worldOffsets = wrapX ? [-worldWidth, 0, worldWidth] : [0]
    for (const worldOffset of worldOffsets) {
      this.projectedPosition.set(x + worldOffset, y, 0.8).project(camera)
      if (
        this.projectedPosition.z < -1
        || this.projectedPosition.z > 1
        || Math.abs(this.projectedPosition.x) > 1.08
        || Math.abs(this.projectedPosition.y) > 1.08
      ) {
        continue
      }
      if (!best || Math.abs(this.projectedPosition.x) < Math.abs(best.x))
        best = this.projectedPosition.clone()
    }
    return best
  }

  private resetOccupiedCells(viewportWidth: number, viewportHeight: number): void {
    const columns = Math.max(1, Math.ceil(viewportWidth / LABEL_GRID_SIZE))
    const rows = Math.max(1, Math.ceil(viewportHeight / LABEL_GRID_SIZE))
    if (columns !== this.occupiedColumns || rows !== this.occupiedRows) {
      this.occupiedColumns = columns
      this.occupiedRows = rows
      this.occupiedCells = new Uint8Array(columns * rows)
    }
    else {
      this.occupiedCells.fill(0)
    }
  }

  private overlapsOccupiedCell(
    left: number,
    right: number,
    top: number,
    bottom: number,
  ): boolean {
    const minimumX = Math.max(0, Math.floor(left / LABEL_GRID_SIZE))
    const maximumX = Math.min(this.occupiedColumns - 1, Math.floor(right / LABEL_GRID_SIZE))
    const minimumY = Math.max(0, Math.floor(top / LABEL_GRID_SIZE))
    const maximumY = Math.min(this.occupiedRows - 1, Math.floor(bottom / LABEL_GRID_SIZE))
    for (let y = minimumY; y <= maximumY; y++) {
      for (let x = minimumX; x <= maximumX; x++) {
        if (this.occupiedCells[y * this.occupiedColumns + x] !== 0)
          return true
      }
    }
    return false
  }

  private occupyCells(left: number, right: number, top: number, bottom: number): void {
    const minimumX = Math.max(0, Math.floor(left / LABEL_GRID_SIZE))
    const maximumX = Math.min(this.occupiedColumns - 1, Math.floor(right / LABEL_GRID_SIZE))
    const minimumY = Math.max(0, Math.floor(top / LABEL_GRID_SIZE))
    const maximumY = Math.min(this.occupiedRows - 1, Math.floor(bottom / LABEL_GRID_SIZE))
    for (let y = minimumY; y <= maximumY; y++) {
      for (let x = minimumX; x <= maximumX; x++)
        this.occupiedCells[y * this.occupiedColumns + x] = 1
    }
  }

  private hide(candidate: MapLabelCandidate): void {
    candidate.element.style.opacity = '0'
    candidate.element.style.visibility = 'hidden'
  }
}
