import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type { SphericalWorldData } from '@/core/spherical/spherical-world-data'
import type { PerspectiveCamera } from 'three'
import { Vector3 } from 'three'

type GlobeLabelKind
  = | 'polity'
    | 'culture'
    | 'religion'
    | 'capital'
    | 'city'
    | 'port'
    | 'town'

interface GlobeLabelCandidate {
  element: HTMLDivElement
  region: number
  kind: GlobeLabelKind
  priority: number
  minimumCameraDistance: number
  maximumCameraDistance: number
  width: number
  height: number
  surfaceNormal: Vector3
  worldPosition: Vector3
}

const DOMAIN_KINDS = new Set<GlobeLabelKind>(['polity', 'culture', 'religion'])
const LABEL_HORIZON_COSINE = 0.035
const LABEL_GRID_SIZE = 72

export class GlobeLabelLayer {
  private readonly root = document.createElement('div')
  private readonly projectedPosition = new Vector3()
  private readonly cameraVector = new Vector3()
  private occupiedCells = new Uint8Array(0)
  private occupiedColumns = 0
  private occupiedRows = 0
  private candidates: GlobeLabelCandidate[] = []

  constructor(canvas: HTMLCanvasElement) {
    this.root.className = 'map-label-layer'
    this.root.setAttribute('aria-hidden', 'true')
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
          mesh,
          params,
          data.human.politics.polities[polity].name,
          labelRegions[polity],
          'polity',
          140,
          params.displayMode === 'polities' ? 160 : 205,
          500,
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
          mesh,
          params,
          data.human.culture.cultures[culture].name,
          labelRegions[culture],
          'culture',
          140,
          160,
          500,
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
          mesh,
          params,
          data.human.religion.religions[religion].name,
          labelRegions[religion],
          'religion',
          140,
          155,
          500,
        )
      }
    }

    if (params.showSettlements)
      this.addSettlementLabels(mesh, data, params)
    this.candidates.sort((a, b) => b.priority - a.priority || a.region - b.region)
  }

  render(
    camera: PerspectiveCamera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    if (this.candidates.length === 0)
      return
    const cameraDistance = camera.position.length()
    const maximumLabels = viewportWidth < 640 ? 12 : viewportWidth < 1000 ? 24 : 40
    this.resetOccupiedCells(viewportWidth, viewportHeight)
    let visibleLabels = 0
    for (const candidate of this.candidates) {
      this.hide(candidate)
      if (
        cameraDistance < candidate.minimumCameraDistance
        || cameraDistance > candidate.maximumCameraDistance
        || visibleLabels >= maximumLabels
      ) {
        continue
      }
      this.cameraVector.copy(camera.position).sub(candidate.worldPosition)
      const facing = candidate.surfaceNormal.dot(this.cameraVector)
        / Math.max(this.cameraVector.length(), Number.EPSILON)
      if (facing <= LABEL_HORIZON_COSINE)
        continue
      const horizonOpacity = Math.min(1, (facing - LABEL_HORIZON_COSINE) / 0.16)
      const minimumDistanceOpacity = candidate.minimumCameraDistance > 0
        ? Math.min(1, (cameraDistance - candidate.minimumCameraDistance) / 24)
        : 1
      const maximumDistanceOpacity = Math.min(
        1,
        (candidate.maximumCameraDistance - cameraDistance) / 28,
      )
      const opacity = Math.max(
        0,
        horizonOpacity * minimumDistanceOpacity * maximumDistanceOpacity,
      )
      if (opacity < 0.08)
        continue

      this.projectedPosition.copy(candidate.worldPosition).project(camera)
      if (
        this.projectedPosition.z < -1
        || this.projectedPosition.z > 1
        || Math.abs(this.projectedPosition.x) > 1.08
        || Math.abs(this.projectedPosition.y) > 1.08
      ) {
        continue
      }
      const x = (this.projectedPosition.x * 0.5 + 0.5) * viewportWidth
      const y = (-this.projectedPosition.y * 0.5 + 0.5) * viewportHeight
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
      candidate.element.style.opacity = opacity.toFixed(3)
      candidate.element.style.visibility = 'visible'
      visibleLabels++
    }
  }

  clear(): void {
    this.candidates = []
    this.root.replaceChildren()
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none'
  }

  destroy(): void {
    this.clear()
    this.root.remove()
  }

  private addSettlementLabels(
    mesh: SphericalMesh,
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
      let kind: GlobeLabelKind
      let priority: number
      let maximumCameraDistance: number
      if (isCapital) {
        kind = 'capital'
        priority = 120
        maximumCameraDistance = 500
      }
      else if (settlementData.type === 'city') {
        kind = 'city'
        priority = 92
        maximumCameraDistance = tradeMode ? 360 : 320
      }
      else if (settlementData.isPort) {
        kind = 'port'
        priority = tradeMode ? 88 : 72
        maximumCameraDistance = tradeMode ? 310 : 250
      }
      else if (settlementData.type === 'town') {
        kind = 'town'
        priority = 56
        maximumCameraDistance = tradeMode ? 235 : 190
      }
      else {
        continue
      }
      priority += settlementData.prosperity * 8
      if (tradeMode)
        priority += data.human.trade.settlementMarketAccess[settlement] * 24
      this.addCandidate(
        mesh,
        params,
        settlementData.name,
        settlementData.region,
        kind,
        priority,
        0,
        maximumCameraDistance,
      )
    }
  }

  private addCandidate(
    mesh: SphericalMesh,
    params: GlobeGenParams,
    text: string,
    region: number,
    kind: GlobeLabelKind,
    priority: number,
    minimumCameraDistance: number,
    maximumCameraDistance: number,
  ): void {
    if (!text || region < 0)
      return
    const element = document.createElement('div')
    element.className = `map-label map-label--${kind}`
    element.textContent = text
    element.title = text
    this.root.append(element)
    const regionIndex = region * 3
    const surfaceNormal = new Vector3(
      mesh.regionPosition[regionIndex],
      mesh.regionPosition[regionIndex + 1],
      mesh.regionPosition[regionIndex + 2],
    ).normalize()
    const domainLabel = DOMAIN_KINDS.has(kind)
    const characterCount = Array.from(text).length
    this.candidates.push({
      element,
      region,
      kind,
      priority,
      minimumCameraDistance,
      maximumCameraDistance,
      width: domainLabel
        ? Math.min(200, Math.max(72, characterCount * 10 + 34))
        : Math.min(170, Math.max(50, characterCount * 7 + 26)),
      height: domainLabel ? 30 : 24,
      surfaceNormal,
      worldPosition: surfaceNormal.clone().multiplyScalar(params.planetRadius + 1.1),
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
    const labelRegion = new Int32Array(domainCount).fill(-1)
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
        labelRegion[domain] = region
      }
    }
    return labelRegion
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

  private hide(candidate: GlobeLabelCandidate): void {
    candidate.element.style.opacity = '0'
    candidate.element.style.visibility = 'hidden'
  }
}
