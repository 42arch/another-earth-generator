import type { MapProjection } from '@/core/projections/map-projection'
import { BufferAttribute, BufferGeometry } from 'three'
import { cartesianToGeographic, FULL_LONGITUDE, unwrapLongitudeNear, wrapLongitude } from '@/core/projections/projection-math'

interface LinePoint {
  longitude: number
  latitude: number
  color?: readonly [number, number, number]
}

export class MapLineGeometry {
  create(
    source: BufferGeometry,
    projection: MapProjection,
    centralMeridian: number,
    z: number,
  ): BufferGeometry {
    const sourcePositions = source.getAttribute('position') as BufferAttribute | undefined
    const sourceColors = source.getAttribute('color') as BufferAttribute | undefined
    const positions: number[] = []
    const colors: number[] = []
    const halfLongitude = FULL_LONGITUDE * 0.5

    if (sourcePositions) {
      for (let vertex = 0; vertex + 1 < sourcePositions.count; vertex += 2) {
        const start = this.getSourcePoint(sourcePositions, sourceColors, vertex, centralMeridian)
        const end = this.getSourcePoint(sourcePositions, sourceColors, vertex + 1, centralMeridian)
        end.longitude = unwrapLongitudeNear(end.longitude, start.longitude)

        for (const worldOffset of [-FULL_LONGITUDE, 0, FULL_LONGITUDE]) {
          const clipped = this.clipSegment(
            { ...start, longitude: start.longitude + worldOffset },
            { ...end, longitude: end.longitude + worldOffset },
            -halfLongitude,
            halfLongitude,
            projection.minimumLatitude,
            projection.maximumLatitude,
          )
          if (!clipped)
            continue
          const projectedStart = projection.projectRelative(
            clipped[0].longitude,
            clipped[0].latitude,
          )
          const projectedEnd = projection.projectRelative(
            clipped[1].longitude,
            clipped[1].latitude,
          )
          if (!projectedStart || !projectedEnd)
            continue
          positions.push(
            projectedStart.x, projectedStart.y, z,
            projectedEnd.x, projectedEnd.y, z,
          )
          if (clipped[0].color && clipped[1].color)
            colors.push(...clipped[0].color, ...clipped[1].color)
        }
      }
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    if (colors.length > 0)
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
    geometry.computeBoundingSphere()
    return geometry
  }

  private getSourcePoint(
    positions: BufferAttribute,
    colors: BufferAttribute | undefined,
    vertex: number,
    centralMeridian: number,
  ): LinePoint {
    const geographic = cartesianToGeographic(
      positions.getX(vertex),
      positions.getY(vertex),
      positions.getZ(vertex),
    )
    return {
      longitude: wrapLongitude(geographic.longitude - centralMeridian),
      latitude: geographic.latitude,
      color: colors
        ? [colors.getX(vertex), colors.getY(vertex), colors.getZ(vertex)]
        : undefined,
    }
  }

  private clipSegment(
    start: LinePoint,
    end: LinePoint,
    minimumLongitude: number,
    maximumLongitude: number,
    minimumLatitude: number,
    maximumLatitude: number,
  ): readonly [LinePoint, LinePoint] | null {
    let minimumAmount = 0
    let maximumAmount = 1

    const axes = [
      [start.longitude, end.longitude - start.longitude, minimumLongitude, maximumLongitude],
      [start.latitude, end.latitude - start.latitude, minimumLatitude, maximumLatitude],
    ] as const
    for (const [origin, difference, minimum, maximum] of axes) {
      if (Math.abs(difference) <= Number.EPSILON) {
        if (origin < minimum || origin > maximum)
          return null
        continue
      }
      const amountA = (minimum - origin) / difference
      const amountB = (maximum - origin) / difference
      minimumAmount = Math.max(0, Math.min(amountA, amountB))
      maximumAmount = Math.min(1, Math.max(amountA, amountB))
      if (minimumAmount > maximumAmount)
        return null
    }
    if (maximumAmount - minimumAmount <= 1e-12)
      return null

    return [
      this.interpolate(start, end, minimumAmount),
      this.interpolate(start, end, maximumAmount),
    ]
  }

  private interpolate(start: LinePoint, end: LinePoint, amount: number): LinePoint {
    return {
      longitude: start.longitude + (end.longitude - start.longitude) * amount,
      latitude: start.latitude + (end.latitude - start.latitude) * amount,
      color: start.color && end.color
        ? [
            start.color[0] + (end.color[0] - start.color[0]) * amount,
            start.color[1] + (end.color[1] - start.color[1]) * amount,
            start.color[2] + (end.color[2] - start.color[2]) * amount,
          ]
        : undefined,
    }
  }
}
