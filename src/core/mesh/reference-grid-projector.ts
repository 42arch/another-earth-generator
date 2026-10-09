import alea from 'alea'
import { createNoise3D } from 'simplex-noise'

/** Fixed Icosphere subdivision level for plate and continent generation (Level 6 = 40,962 regions). */
export const REFERENCE_REGION_LEVEL = 6

const LOW_PLATE_COUNT = 24
const LOW_PLATE_RANGE = 20
const PERTURB_BASE = 1.5
const PERTURB_LOW_PLATE_BONUS = 1
const FBM_BASE_FREQUENCY = 8
const FBM_OCTAVES = 2
const FBM_DECAY = 0.5
const FBM_FREQUENCY_MULTIPLIER = 2

/** Nearest-neighbor projection from output sites to reference sites on the unit sphere. */
export class ReferenceGridProjector {
  private readonly position: Float32Array
  private readonly left: Int32Array
  private readonly right: Int32Array
  private readonly root: number

  constructor(referencePosition: Float32Array) {
    const count = referencePosition.length / 3
    if (count === 0 || referencePosition.length % 3 !== 0)
      throw new Error('Reference grid must contain at least one xyz position')

    this.position = referencePosition
    this.left = new Int32Array(count).fill(-1)
    this.right = new Int32Array(count).fill(-1)
    const indices = new Int32Array(count)
    for (let index = 0; index < count; index++)
      indices[index] = index
    this.root = this.buildTree(indices, 0, count, 0)
  }

  project(outputPosition: Float32Array): Uint32Array {
    if (outputPosition.length % 3 !== 0)
      throw new Error('Output positions must be xyz triples')

    const result = new Uint32Array(outputPosition.length / 3)
    const best = { region: -1, distance: Infinity }
    for (let region = 0; region < result.length; region++) {
      const index = region * 3
      best.region = -1
      best.distance = Infinity
      this.nearest(
        this.root,
        outputPosition[index],
        outputPosition[index + 1],
        outputPosition[index + 2],
        best,
      )
      result[region] = best.region
    }
    return result
  }

  /** Projects through a multi-octave 3D displacement to break up coarse boundaries. */
  projectPerturbed(
    outputPosition: Float32Array,
    seed: number,
    requestedPlateCount: number,
  ): Uint32Array {
    if (outputPosition.length % 3 !== 0)
      throw new Error('Output positions must be xyz triples')

    const noise = createNoise3D(alea(seed + 999))
    const plateCount = Math.max(1, Math.floor(requestedPlateCount))
    const lowPlateFactor = Math.max(
      0,
      Math.min(1, (LOW_PLATE_COUNT - plateCount) / LOW_PLATE_RANGE),
    )
    const cellAngle = Math.PI / Math.sqrt(this.position.length / 3)
    const maximumAmplitude = cellAngle
      * (PERTURB_BASE + PERTURB_LOW_PLATE_BONUS * lowPlateFactor)
    const result = new Uint32Array(outputPosition.length / 3)
    const best = { region: -1, distance: Infinity }

    for (let region = 0; region < result.length; region++) {
      const index = region * 3
      const ox = outputPosition[index]
      const oy = outputPosition[index + 1]
      const oz = outputPosition[index + 2]
      let dx = 0
      let dy = 0
      let dz = 0
      let amplitude = maximumAmplitude
      let frequency = FBM_BASE_FREQUENCY
      for (let octave = 0; octave < FBM_OCTAVES; octave++) {
        dx += noise(ox * frequency, oy * frequency, oz * frequency) * amplitude
        dy += noise(
          ox * frequency + 100,
          oy * frequency + 100,
          oz * frequency + 100,
        ) * amplitude
        dz += noise(
          ox * frequency + 200,
          oy * frequency + 200,
          oz * frequency + 200,
        ) * amplitude
        amplitude *= FBM_DECAY
        frequency *= FBM_FREQUENCY_MULTIPLIER
      }

      let x = ox + dx
      let y = oy + dy
      let z = oz + dz
      const length = Math.hypot(x, y, z) || 1
      x /= length
      y /= length
      z /= length
      best.region = -1
      best.distance = Infinity
      this.nearest(this.root, x, y, z, best)
      result[region] = best.region
    }
    return result
  }

  private buildTree(indices: Int32Array, start: number, end: number, depth: number): number {
    if (start >= end)
      return -1

    const axis = depth % 3
    const pos = this.position
    indices.subarray(start, end).sort((a, b) => (
      pos[a * 3 + axis] - pos[b * 3 + axis] || a - b
    ))
    const middle = (start + end) >> 1
    const region = indices[middle]
    this.left[region] = this.buildTree(indices, start, middle, depth + 1)
    this.right[region] = this.buildTree(indices, middle + 1, end, depth + 1)
    return region
  }

  private nearest(
    region: number,
    x: number,
    y: number,
    z: number,
    best: { region: number, distance: number },
    depth = 0,
  ): void {
    if (region < 0)
      return

    const index = region * 3
    const dx = x - this.position[index]
    const dy = y - this.position[index + 1]
    const dz = z - this.position[index + 2]
    const distance = dx * dx + dy * dy + dz * dz
    if (distance < best.distance || (distance === best.distance && region < best.region)) {
      best.region = region
      best.distance = distance
    }

    const axis = depth % 3
    const axisDelta = (axis === 0 ? dx : axis === 1 ? dy : dz)
    const near = axisDelta < 0 ? this.left[region] : this.right[region]
    const far = axisDelta < 0 ? this.right[region] : this.left[region]
    this.nearest(near, x, y, z, best, depth + 1)
    if (axisDelta * axisDelta <= best.distance)
      this.nearest(far, x, y, z, best, depth + 1)
  }
}
