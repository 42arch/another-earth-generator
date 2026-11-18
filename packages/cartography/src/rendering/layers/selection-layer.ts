import type { WorldMapReader } from '@another-earth/world-core'
import type { MapProjection } from '#projections/map-projections'
import type { LonLatTuple, Vec3Tuple } from '#projections/spherical-math'
import type { GpuResourceTracker } from '#rendering/gpu-resource-tracker'
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

export interface SelectionState {
  readonly regionId: number | null
  readonly featureId?: string | null
}

/**
 * Built-in highlight layer for the active `selection` (`regionId` dual Voronoi cell ring
 * and optional `featureId` vector outline/marker) in both 3D `GlobeView` and 2D `AtlasView`.
 */
export class SelectionLayer {
  readonly group = new THREE.Group()
  private readonly reader: WorldMapReader
  private readonly projection?: MapProjection
  private readonly regionRingLine: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private readonly regionCenterDot: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  private readonly featureHighlightLine: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private lastRegionId: number | null = null
  private lastFeatureId: string | null = null
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

    const dotGeom = new THREE.SphereGeometry(0.0055, 12, 10)
    tracker?.trackGeometry(dotGeom)
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0x6EE7B7,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    })
    tracker?.trackMaterial(dotMat)

    this.regionCenterDot = new THREE.Mesh(dotGeom, dotMat)
    this.regionCenterDot.renderOrder = 102
    this.regionCenterDot.visible = false
    this.group.add(this.regionCenterDot)

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
    this.featureHighlightLine.renderOrder = 100
    this.featureHighlightLine.visible = false
    this.group.add(this.featureHighlightLine)
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

    if (regionId !== this.lastRegionId) {
      this.lastRegionId = regionId
      this.rebuildRegionRing(regionId)
    }

    if (featureId !== this.lastFeatureId) {
      this.lastFeatureId = featureId
      this.rebuildFeatureHighlight(featureId, registry, month)
    }
  }

  private rebuildRegionRing(regionId: number | null): void {
    if (regionId === null || !Number.isInteger(regionId) || regionId < 0 || regionId >= this.reader.identity.regionCount) {
      this.regionRingLine.visible = false
      this.regionCenterDot.visible = false
      return
    }

    const mesh = this.reader.mesh
    const degree = mesh.getRegionDegree(regionId)
    if (degree < 3) {
      this.regionRingLine.visible = false
      this.regionCenterDot.visible = false
      return
    }

    const centerOut = { x: 0, y: 0, z: 0 }
    mesh.getRegionCenter(regionId, centerOut)
    const [cx, cy, cz] = normalizeVec3(centerOut.x, centerOut.y, centerOut.z)

    if (this.projection) {
      const zOffset = 0.0085
      const [centerLon, centerLat] = cartesianToLonLatDeg(cx, cy, cz)
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
      this.regionRingLine.visible = segmentPositions.length > 0

      const [dotX, dotY] = this.projection.project(centerLon, centerLat)
      this.regionCenterDot.position.set(dotX, dotY, zOffset)
      this.regionCenterDot.visible = true
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
    this.regionRingLine.visible = true

    this.regionCenterDot.position.set(cx * radius, cy * radius, cz * radius)
    this.regionCenterDot.visible = true
  }

  private rebuildFeatureHighlight(
    featureId: string | null,
    registry?: MapSourceRegistry,
    month = 0,
  ): void {
    if (!featureId || !registry) {
      this.featureHighlightLine.visible = false
      return
    }

    const candidateSources = [
      'river-centerlines',
      'lake-polygons',
      'continent-areas',
      'plate-areas',
      'koppen-areas',
      'biome-areas',
      'land-cover-areas',
      'plate-boundaries',
      'coastlines',
    ]

    let matchedFeature: GeoJsonFeature | null = null
    for (const sourceId of candidateSources) {
      const src = registry.getSource(sourceId, { month })
      if (!src.unavailable && src.kind === 'geojson') {
        const hit = src.data.features.find(f => f.id === featureId)
        if (hit) {
          matchedFeature = hit
          break
        }
      }
    }

    if (!matchedFeature) {
      this.featureHighlightLine.visible = false
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

    const geom = matchedFeature.geometry
    if (geom.type === 'LineString') {
      appendLine(geom.coordinates)
    }
    else if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates)
        appendLine(line)
    }
    else if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates)
        appendLine(ring)
    }
    else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        for (const ring of poly)
          appendLine(ring)
      }
    }

    if (segmentPositions.length === 0) {
      this.featureHighlightLine.visible = false
      return
    }

    this.featureHighlightLine.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(segmentPositions), 3),
    )
    this.featureHighlightLine.geometry.computeBoundingSphere()
    this.featureHighlightLine.visible = true
  }

  isRegionHighlighted(): boolean {
    return this.regionRingLine.visible
  }

  isFeatureHighlighted(): boolean {
    return this.featureHighlightLine.visible
  }

  dispose(): void {
    if (this.disposed)
      return
    this.disposed = true
    this.group.clear()
    this.regionRingLine.geometry.dispose()
    this.regionRingLine.material.dispose()
    this.regionCenterDot.geometry.dispose()
    this.regionCenterDot.material.dispose()
    this.featureHighlightLine.geometry.dispose()
    this.featureHighlightLine.material.dispose()
  }
}
