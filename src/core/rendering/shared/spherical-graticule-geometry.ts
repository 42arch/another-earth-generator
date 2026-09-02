import { BufferAttribute, BufferGeometry } from 'three'

const DEGREES_TO_RADIANS = Math.PI / 180
const DEFAULT_INTERVAL_DEGREES = 15
const DEFAULT_SAMPLE_STEP_DEGREES = 2

export class SphericalGraticuleGeometry {
  create(
    radius: number,
    intervalDegrees = DEFAULT_INTERVAL_DEGREES,
    sampleStepDegrees = DEFAULT_SAMPLE_STEP_DEGREES,
  ): BufferGeometry {
    const interval = Math.max(1, intervalDegrees)
    const sampleStep = Math.max(0.5, sampleStepDegrees)
    const positions: number[] = []
    let latitudeLineCount = 0
    let longitudeLineCount = 0

    for (let latitude = -90 + interval; latitude < 90; latitude += interval) {
      for (let longitude = -180; longitude < 180; longitude += sampleStep) {
        this.appendSegment(
          positions,
          latitude,
          longitude,
          latitude,
          Math.min(180, longitude + sampleStep),
          radius,
        )
      }
      latitudeLineCount++
    }

    for (let longitude = -180; longitude < 180; longitude += interval) {
      for (let latitude = -90; latitude < 90; latitude += sampleStep) {
        this.appendSegment(
          positions,
          latitude,
          longitude,
          Math.min(90, latitude + sampleStep),
          longitude,
          radius,
        )
      }
      longitudeLineCount++
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(positions), 3),
    )
    geometry.userData.latitudeLineCount = latitudeLineCount
    geometry.userData.longitudeLineCount = longitudeLineCount
    geometry.computeBoundingSphere()
    return geometry
  }

  private appendSegment(
    positions: number[],
    latitudeA: number,
    longitudeA: number,
    latitudeB: number,
    longitudeB: number,
    radius: number,
  ): void {
    this.appendPoint(positions, latitudeA, longitudeA, radius)
    this.appendPoint(positions, latitudeB, longitudeB, radius)
  }

  private appendPoint(
    positions: number[],
    latitudeDegrees: number,
    longitudeDegrees: number,
    radius: number,
  ): void {
    const latitude = latitudeDegrees * DEGREES_TO_RADIANS
    const longitude = longitudeDegrees * DEGREES_TO_RADIANS
    const horizontalRadius = Math.cos(latitude) * radius
    positions.push(
      Math.cos(longitude) * horizontalRadius,
      Math.sin(latitude) * radius,
      Math.sin(longitude) * horizontalRadius,
    )
  }
}
