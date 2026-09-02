import type { MapProjection } from '@/core/projections/map-projection'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import { BufferAttribute, BufferGeometry } from 'three'
import { cartesianToGeographic, FULL_LONGITUDE, unwrapLongitudeNear, wrapLongitude } from '@/core/projections/projection-math'

interface UnwrappedPoint {
  longitude: number
  latitude: number
}

export class MapSurfaceGeometry {
  create(
    mesh: SphericalMesh,
    colors: Float32Array,
    projection: MapProjection,
    centralMeridian: number,
    regionMask?: Uint8Array,
  ): BufferGeometry {
    const positions: number[] = []
    const vertexColors: number[] = []
    const faceRegions: number[] = []
    const halfLongitude = FULL_LONGITUDE * 0.5

    for (let region = 0; region < mesh.numRegions; region++) {
      if (regionMask && regionMask[region] === 0)
        continue

      const centerLongitude = wrapLongitude(mesh.regionLongitude[region] - centralMeridian)
      const center: UnwrappedPoint = {
        longitude: centerLongitude,
        latitude: mesh.regionLatitude[region],
      }
      const start = mesh.voronoi.cellCornerOffsets[region]
      const end = mesh.voronoi.cellCornerOffsets[region + 1]

      for (let index = start; index < end; index++) {
        const cornerA = mesh.voronoi.cellCorners[index]
        const cornerB = mesh.voronoi.cellCorners[index + 1 < end ? index + 1 : start]
        const triangle = [
          center,
          this.getCorner(mesh, cornerA, centralMeridian, centerLongitude),
          this.getCorner(mesh, cornerB, centralMeridian, centerLongitude),
        ]
        const minimumLongitude = Math.min(
          triangle[0].longitude,
          triangle[1].longitude,
          triangle[2].longitude,
        )
        const maximumLongitude = Math.max(
          triangle[0].longitude,
          triangle[1].longitude,
          triangle[2].longitude,
        )

        for (const worldOffset of [-FULL_LONGITUDE, 0, FULL_LONGITUDE]) {
          if (
            maximumLongitude + worldOffset < -halfLongitude
            || minimumLongitude + worldOffset > halfLongitude
          ) {
            continue
          }
          const shifted = worldOffset === 0
            ? triangle
            : triangle.map(point => ({
                longitude: point.longitude + worldOffset,
                latitude: point.latitude,
              }))

          const clipped = this.clipGeographicRange(
            shifted,
            -halfLongitude,
            halfLongitude,
            projection.minimumLatitude,
            projection.maximumLatitude,
          )
          this.appendPolygon(
            positions,
            vertexColors,
            faceRegions,
            clipped,
            region,
            colors,
            projection,
          )
        }
      }
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(vertexColors), 3))
    geometry.userData.faceRegions = new Uint32Array(faceRegions)
    geometry.computeBoundingSphere()
    return geometry
  }

  updateColors(geometry: BufferGeometry, colors: Float32Array): void {
    const faceRegions = geometry.userData.faceRegions as Uint32Array | undefined
    const colorAttribute = geometry.getAttribute('color') as BufferAttribute | undefined
    if (!faceRegions || !colorAttribute)
      return

    for (let face = 0; face < faceRegions.length; face++) {
      const source = faceRegions[face] * 3
      const target = face * 9
      for (let vertex = 0; vertex < 3; vertex++) {
        const offset = target + vertex * 3
        colorAttribute.array[offset] = colors[source]
        colorAttribute.array[offset + 1] = colors[source + 1]
        colorAttribute.array[offset + 2] = colors[source + 2]
      }
    }
    colorAttribute.needsUpdate = true
  }

  private getCorner(
    mesh: SphericalMesh,
    corner: number,
    centralMeridian: number,
    referenceLongitude: number,
  ): UnwrappedPoint {
    const index = corner * 3
    const geographic = cartesianToGeographic(
      mesh.voronoi.cornerPosition[index],
      mesh.voronoi.cornerPosition[index + 1],
      mesh.voronoi.cornerPosition[index + 2],
    )
    const relativeLongitude = wrapLongitude(geographic.longitude - centralMeridian)
    return {
      longitude: unwrapLongitudeNear(relativeLongitude, referenceLongitude),
      latitude: geographic.latitude,
    }
  }

  private appendPolygon(
    positions: number[],
    vertexColors: number[],
    faceRegions: number[],
    polygon: readonly UnwrappedPoint[],
    region: number,
    colors: Float32Array,
    projection: MapProjection,
  ): void {
    if (polygon.length < 3)
      return
    const first = projection.projectRelative(polygon[0].longitude, polygon[0].latitude)
    if (!first)
      return
    const colorIndex = region * 3

    for (let index = 1; index < polygon.length - 1; index++) {
      const second = projection.projectRelative(polygon[index].longitude, polygon[index].latitude)
      const third = projection.projectRelative(polygon[index + 1].longitude, polygon[index + 1].latitude)
      if (!second || !third)
        continue
      const signedArea = (second.x - first.x) * (third.y - first.y)
        - (second.y - first.y) * (third.x - first.x)
      if (Math.abs(signedArea) <= 1e-12)
        continue
      positions.push(
        first.x, first.y, 0,
        second.x, second.y, 0,
        third.x, third.y, 0,
      )
      for (let vertex = 0; vertex < 3; vertex++) {
        vertexColors.push(
          colors[colorIndex],
          colors[colorIndex + 1],
          colors[colorIndex + 2],
        )
      }
      faceRegions.push(region)
    }
  }

  private clipGeographicRange(
    polygon: readonly UnwrappedPoint[],
    minimumLongitude: number,
    maximumLongitude: number,
    minimumLatitude: number,
    maximumLatitude: number,
  ): UnwrappedPoint[] {
    return this.clipAgainstLatitude(
      this.clipAgainstLatitude(
        this.clipAgainstLongitude(
          this.clipAgainstLongitude(polygon, minimumLongitude, true),
          maximumLongitude,
          false,
        ),
        minimumLatitude,
        true,
      ),
      maximumLatitude,
      false,
    )
  }

  private clipAgainstLongitude(
    polygon: readonly UnwrappedPoint[],
    boundary: number,
    keepGreater: boolean,
  ): UnwrappedPoint[] {
    if (polygon.length === 0)
      return []
    const result: UnwrappedPoint[] = []
    let previous = polygon[polygon.length - 1]
    let previousInside = keepGreater
      ? previous.longitude >= boundary
      : previous.longitude <= boundary

    for (const current of polygon) {
      const currentInside = keepGreater
        ? current.longitude >= boundary
        : current.longitude <= boundary
      if (currentInside !== previousInside)
        result.push(this.intersectLongitude(previous, current, boundary))
      if (currentInside)
        result.push(current)
      previous = current
      previousInside = currentInside
    }
    return result
  }

  private intersectLongitude(
    start: UnwrappedPoint,
    end: UnwrappedPoint,
    longitude: number,
  ): UnwrappedPoint {
    const difference = end.longitude - start.longitude
    const amount = Math.abs(difference) > Number.EPSILON
      ? (longitude - start.longitude) / difference
      : 0
    return {
      longitude,
      latitude: start.latitude + (end.latitude - start.latitude) * amount,
    }
  }

  private clipAgainstLatitude(
    polygon: readonly UnwrappedPoint[],
    boundary: number,
    keepGreater: boolean,
  ): UnwrappedPoint[] {
    if (polygon.length === 0)
      return []
    const result: UnwrappedPoint[] = []
    let previous = polygon[polygon.length - 1]
    let previousInside = keepGreater
      ? previous.latitude >= boundary
      : previous.latitude <= boundary

    for (const current of polygon) {
      const currentInside = keepGreater
        ? current.latitude >= boundary
        : current.latitude <= boundary
      if (currentInside !== previousInside)
        result.push(this.intersectLatitude(previous, current, boundary))
      if (currentInside)
        result.push(current)
      previous = current
      previousInside = currentInside
    }
    return result
  }

  private intersectLatitude(
    start: UnwrappedPoint,
    end: UnwrappedPoint,
    latitude: number,
  ): UnwrappedPoint {
    const difference = end.latitude - start.latitude
    const amount = Math.abs(difference) > Number.EPSILON
      ? (latitude - start.latitude) / difference
      : 0
    return {
      longitude: start.longitude + (end.longitude - start.longitude) * amount,
      latitude,
    }
  }
}
