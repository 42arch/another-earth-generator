import type { WorldMapReader } from '@another-earth/world-core'
import type { MapProjection } from '#projections/map-projections'
import type { LonLatTuple, Vec3Tuple } from '#projections/spherical-math'
import type { GpuResourceTracker } from '#rendering/gpu-resource-tracker'
import type { GeoJsonPolygonCoordinates } from '#rendering/layers/fill-layer'
import type { MapSourceRegistry } from '#sources/registry'
import type { GeoJsonFeature } from '#sources/types'
import * as THREE from 'three'
import { clipPolylineAtAntimeridian, clipRingToGeographicBox } from '#projections/seam-clipper'
import {
  cartesianToLonLatDeg,
  lonLatDegToCartesian,
  normalizeVec3,
  slerpVec3,
  sphericalAngleRad,
  unwrapLongitudeDegNear,
} from '#projections/spherical-math'
import { triangulateAtlasPolygon, triangulateSphericalPolygon } from '#rendering/layers/fill-layer'
import { BUILTIN_MAP_SOURCE_SCHEMAS } from '#sources/types'

const FEATURE_SOURCE_IDS = Object.values(BUILTIN_MAP_SOURCE_SCHEMAS)
  .filter(schema => schema.kind === 'geojson')
  .map(schema => schema.id)
const POINT_HALO_STEPS = 20
const POINT_HALO_RADIUS = 0.012
const LABEL_SOURCE_IDS = new Set(['geographic-labels', 'polity-labels', 'settlement-labels'])
const POLYGON_HIGHLIGHT_RADIUS = 1.00155

export interface SelectionState {
  readonly regionId: number | null
  readonly featureId?: string | null
  /** Source that owns `featureId`. Avoids scanning every vector source on each pick. */
  readonly sourceId?: string | null
}

/**
 * Highlights the picked map element. Lines are stroked, polygons are filled, and
 * point symbols get a ring. Text labels are not highlighted. A blank raster or
 * surface click outlines the Voronoi cell, without a center dot.
 */
export class SelectionLayer {
  readonly group = new THREE.Group()
  private readonly reader: WorldMapReader
  private readonly projection?: MapProjection
  private readonly regionRingLine: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private readonly featureHighlightLine: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private readonly featureHighlightFill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  private lastRegionId: number | null = null
  private lastFeatureKey = ''
  private regionRingAvailable = false
  private disposed = false

  constructor(
    reader: WorldMapReader,
    tracker?: GpuResourceTracker,
    options: { readonly projection?: MapProjection } = {},
  ) {
    this.reader = reader
    this.projection = options.projection
    this.group.name = 'SelectionLayer'
    this.group.renderOrder = 100

    const ringGeom = new THREE.BufferGeometry()
    ringGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    tracker?.trackGeometry(ringGeom)

    const ringMat = new THREE.LineBasicMaterial({
      color: 0x34D399,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    })
    tracker?.trackMaterial(ringMat)

    this.regionRingLine = new THREE.LineSegments(ringGeom, ringMat)
    this.regionRingLine.renderOrder = 101
    this.regionRingLine.visible = false
    this.group.add(this.regionRingLine)

    const featGeom = new THREE.BufferGeometry()
    featGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    tracker?.trackGeometry(featGeom)
    const featMat = new THREE.LineBasicMaterial({
      color: 0xFBBF24,
      transparent: true,
      opacity: 0.92,
      depthTest: true,
      depthWrite: false,
    })
    tracker?.trackMaterial(featMat)

    this.featureHighlightLine = new THREE.LineSegments(featGeom, featMat)
    this.featureHighlightLine.renderOrder = 97
    this.featureHighlightLine.visible = false
    this.group.add(this.featureHighlightLine)

    const fillGeom = new THREE.BufferGeometry()
    fillGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    tracker?.trackGeometry(fillGeom)
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0xFDE68A,
      transparent: true,
      opacity: 0.42,
      depthTest: true,
      depthWrite: false,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    tracker?.trackMaterial(fillMat)
    this.featureHighlightFill = new THREE.Mesh(fillGeom, fillMat)
    this.featureHighlightFill.name = 'FeatureHighlightFill'
    this.featureHighlightFill.renderOrder = 96
    this.featureHighlightFill.visible = false
    this.group.add(this.featureHighlightFill)
  }

  updateSelection(
    selection: SelectionState,
    registry?: MapSourceRegistry,
    month = 0,
  ): void {
    if (this.disposed)
      return

    const regionId = selection.regionId
    const featureId = selection.featureId ?? null
    const sourceId = selection.sourceId ?? null

    if (regionId !== this.lastRegionId) {
      this.lastRegionId = regionId
      this.rebuildRegionRing(regionId)
    }

    const featureKey = `${sourceId ?? ''}\0${featureId ?? ''}\0${month}`
    if (featureKey !== this.lastFeatureKey) {
      this.lastFeatureKey = featureKey
      this.rebuildFeatureHighlight(featureId, sourceId, registry, month)
    }

    this.regionRingLine.visible = this.isFeatureHighlighted() ? false : this.regionRingAvailable
  }

  private rebuildRegionRing(regionId: number | null): void {
    if (regionId === null || !Number.isInteger(regionId) || regionId < 0 || regionId >= this.reader.identity.regionCount) {
      this.regionRingAvailable = false
      this.regionRingLine.visible = false
      return
    }

    const mesh = this.reader.mesh
    const degree = mesh.getRegionDegree(regionId)
    if (degree < 3) {
      this.regionRingAvailable = false
      this.regionRingLine.visible = false
      return
    }

    if (this.projection) {
      const centerOut = { x: 0, y: 0, z: 0 }
      mesh.getRegionCenter(regionId, centerOut)
      const [cx, cy, cz] = normalizeVec3(centerOut.x, centerOut.y, centerOut.z)
      const zOffset = 0.0085
      const [centerLon] = cartesianToLonLatDeg(cx, cy, cz)
      const cornerOut = { x: 0, y: 0, z: 0 }
      const unwrapped: [number, number][] = []
      let minLon = Infinity
      let maxLon = -Infinity

      mesh.forEachRegionNeighbor(regionId, (_neighbor, cornerA) => {
        mesh.getCornerPosition(cornerA, cornerOut)
        const [rawLon, rawLat] = cartesianToLonLatDeg(cornerOut.x, cornerOut.y, cornerOut.z)
        const prevLon = unwrapped.length > 0 ? unwrapped[unwrapped.length - 1][0] : centerLon
        const uLon = unwrapLongitudeDegNear(rawLon, prevLon)
        unwrapped.push([uLon, rawLat])
        if (uLon < minLon)
          minLon = uLon
        if (uLon > maxLon)
          maxLon = uLon
      })

      const segmentPositions: number[] = []
      const maxLat = this.projection.maxLatitudeDegrees
      const minK = Math.floor((minLon + 180) / 360)
      const maxK = Math.floor((maxLon + 180 - 1e-9) / 360)
      for (let k = minK; k <= maxK; k++) {
        const shift = k * 360
        const shifted = unwrapped.map(([lon, lat]) => [lon - shift, lat] as [number, number])
        const clipped = clipRingToGeographicBox(shifted, -180, 180, -maxLat, maxLat)
        for (let i = 0; i < clipped.length; i++) {
          const a = clipped[i]
          const b = clipped[(i + 1) % clipped.length]
          const [ax, ay] = this.projection.project(a[0], a[1])
          const [bx, by] = this.projection.project(b[0], b[1])
          segmentPositions.push(ax, ay, zOffset, bx, by, zOffset)
        }
      }

      this.regionRingLine.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(segmentPositions), 3),
      )
      this.regionRingLine.geometry.computeBoundingSphere()
      this.regionRingAvailable = segmentPositions.length > 0
      this.regionRingLine.visible = this.regionRingAvailable
      return
    }

    const radius = 1.0045
    const corners: Vec3Tuple[] = []
    const cornerOut = { x: 0, y: 0, z: 0 }
    mesh.forEachRegionNeighbor(regionId, (_neighbor, cornerA) => {
      mesh.getCornerPosition(cornerA, cornerOut)
      const [nx, ny, nz] = normalizeVec3(cornerOut.x, cornerOut.y, cornerOut.z)
      corners.push([nx * radius, ny * radius, nz * radius])
    })

    const segmentPositions = new Float32Array(corners.length * 6)
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i]
      const b = corners[(i + 1) % corners.length]
      const base = i * 6
      segmentPositions[base] = a[0]
      segmentPositions[base + 1] = a[1]
      segmentPositions[base + 2] = a[2]
      segmentPositions[base + 3] = b[0]
      segmentPositions[base + 4] = b[1]
      segmentPositions[base + 5] = b[2]
    }

    this.regionRingLine.geometry.setAttribute('position', new THREE.BufferAttribute(segmentPositions, 3))
    this.regionRingLine.geometry.computeBoundingSphere()
    this.regionRingAvailable = true
    this.regionRingLine.visible = true
  }

  private rebuildFeatureHighlight(
    featureId: string | null,
    sourceId: string | null,
    registry?: MapSourceRegistry,
    month = 0,
  ): void {
    if (!featureId || !registry || (sourceId !== null && LABEL_SOURCE_IDS.has(sourceId))) {
      this.clearFeatureHighlight()
      return
    }

    const matchedFeature = this.findFeature(featureId, sourceId, registry, month)

    if (!matchedFeature) {
      this.clearFeatureHighlight()
      return
    }

    const segmentPositions: number[] = []
    const appendLine = (coords: readonly LonLatTuple[]): void => {
      if (this.projection) {
        const zOffset = 0.0082
        const clipped = clipPolylineAtAntimeridian(coords, 0)
        for (const part of clipped) {
          for (let i = 0; i < part.coordinates.length - 1; i++) {
            const a = part.coordinates[i]
            const b = part.coordinates[i + 1]
            const [ax, ay] = this.projection.project(a[0], a[1])
            const [bx, by] = this.projection.project(b[0], b[1])
            segmentPositions.push(ax, ay, zOffset, bx, by, zOffset)
          }
        }
        return
      }

      const radius = 1.0042
      const unitPts: Vec3Tuple[] = coords.map(([lon, lat]) => lonLatDegToCartesian(lon, lat))
      for (let i = 0; i < unitPts.length - 1; i++) {
        const a = unitPts[i]
        const b = unitPts[i + 1]
        const steps = Math.max(1, Math.ceil(sphericalAngleRad(a, b) / 0.03))
        for (let s = 0; s < steps; s++) {
          const p0 = slerpVec3(a, b, s / steps)
          const p1 = slerpVec3(a, b, (s + 1) / steps)
          segmentPositions.push(
            p0[0] * radius,
            p0[1] * radius,
            p0[2] * radius,
            p1[0] * radius,
            p1[1] * radius,
            p1[2] * radius,
          )
        }
      }
    }

    const fillPositions: number[] = []
    const geom = matchedFeature.geometry
    if (geom.type === 'Point') {
      this.appendPointHalo(geom.coordinates, segmentPositions)
    }
    else if (geom.type === 'LineString') {
      appendLine(geom.coordinates)
    }
    else if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates)
        appendLine(line)
    }
    else if (geom.type === 'Polygon') {
      // Territory polygons are split into spherical tiles. Stroking every ring
      // draws those tile seams inside the selected area.
      this.appendPolygonFill(geom.coordinates, fillPositions)
    }
    else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates)
        this.appendPolygonFill(poly, fillPositions)
    }

    this.showPositions(this.featureHighlightLine, segmentPositions)
    this.showPositions(this.featureHighlightFill, fillPositions)
  }

  private clearFeatureHighlight(): void {
    this.featureHighlightLine.visible = false
    this.featureHighlightFill.visible = false
  }

  private showPositions(object: THREE.LineSegments | THREE.Mesh, positions: number[]): void {
    if (positions.length === 0) {
      object.visible = false
      return
    }
    object.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
    object.geometry.computeBoundingSphere()
    object.visible = true
  }

  private appendPolygonFill(coordinates: GeoJsonPolygonCoordinates, positions: number[]): void {
    const result = this.projection
      ? triangulateAtlasPolygon(coordinates, this.projection, { zOffset: 0.0076 })
      : triangulateSphericalPolygon(coordinates, { radius: POLYGON_HIGHLIGHT_RADIUS })
    const values = result.positions
    for (let i = 0; i < values.length; i++)
      positions.push(values[i])
  }

  private findFeature(
    featureId: string,
    sourceId: string | null,
    registry: MapSourceRegistry,
    month: number,
  ): GeoJsonFeature | null {
    const sourceIds = sourceId ? [sourceId] : FEATURE_SOURCE_IDS
    for (const id of sourceIds) {
      let resolved
      try {
        resolved = registry.getSource(id, { month })
      }
      catch {
        continue
      }
      if (resolved.unavailable || resolved.kind !== 'geojson')
        continue
      const hit = resolved.data.features.find(feature => feature.id === featureId)
      if (hit)
        return hit
    }
    return null
  }

  private appendPointHalo(coordinates: LonLatTuple, segmentPositions: number[]): void {
    const [lon, lat] = coordinates
    if (this.projection) {
      const zOffset = 0.0082
      const [cx, cy] = this.projection.project(lon, lat)
      for (let i = 0; i < POINT_HALO_STEPS; i++) {
        const a0 = (i / POINT_HALO_STEPS) * Math.PI * 2
        const a1 = ((i + 1) / POINT_HALO_STEPS) * Math.PI * 2
        segmentPositions.push(
          cx + Math.cos(a0) * POINT_HALO_RADIUS,
          cy + Math.sin(a0) * POINT_HALO_RADIUS,
          zOffset,
          cx + Math.cos(a1) * POINT_HALO_RADIUS,
          cy + Math.sin(a1) * POINT_HALO_RADIUS,
          zOffset,
        )
      }
      return
    }

    const [cx, cy, cz] = lonLatDegToCartesian(lon, lat)
    const helper: Vec3Tuple = Math.abs(cz) < 0.9 ? [0, 0, 1] : [0, 1, 0]
    const ux = cy * helper[2] - cz * helper[1]
    const uy = cz * helper[0] - cx * helper[2]
    const uz = cx * helper[1] - cy * helper[0]
    const ulen = Math.hypot(ux, uy, uz) || 1
    const u0 = ux / ulen
    const u1 = uy / ulen
    const u2 = uz / ulen
    const v0 = cy * u2 - cz * u1
    const v1 = cz * u0 - cx * u2
    const v2 = cx * u1 - cy * u0
    const drawRadius = 1.0042
    const points: Vec3Tuple[] = []
    for (let i = 0; i < POINT_HALO_STEPS; i++) {
      const angle = (i / POINT_HALO_STEPS) * Math.PI * 2
      const ca = Math.cos(angle) * POINT_HALO_RADIUS
      const sa = Math.sin(angle) * POINT_HALO_RADIUS
      const x = cx + u0 * ca + v0 * sa
      const y = cy + u1 * ca + v1 * sa
      const z = cz + u2 * ca + v2 * sa
      const len = Math.hypot(x, y, z) || 1
      points.push([x / len * drawRadius, y / len * drawRadius, z / len * drawRadius])
    }
    for (let i = 0; i < points.length; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      segmentPositions.push(a[0], a[1], a[2], b[0], b[1], b[2])
    }
  }

  isRegionHighlighted(): boolean {
    return this.regionRingLine.visible
  }

  isFeatureHighlighted(): boolean {
    return this.featureHighlightLine.visible || this.featureHighlightFill.visible
  }

  dispose(): void {
    if (this.disposed)
      return
    this.disposed = true
    this.group.clear()
    this.regionRingLine.geometry.dispose()
    this.regionRingLine.material.dispose()
    this.featureHighlightLine.geometry.dispose()
    this.featureHighlightLine.material.dispose()
    this.featureHighlightFill.geometry.dispose()
    this.featureHighlightFill.material.dispose()
  }
}
