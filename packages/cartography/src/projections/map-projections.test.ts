import { describe, expect, it } from 'vitest'
import {
  ATLAS_WORLD_FIT_PADDING,
  computeAtlasFittedFrustum,
  EQUAL_EARTH_PROJECTION,
  EQUIRECTANGULAR_PROJECTION,
  MERCATOR_PROJECTION,
} from '#projections/map-projections'

describe('computeAtlasFittedFrustum', () => {
  it('contains a 2:1 world on a 16:9 fullscreen instead of cropping longitude', () => {
    const aspect = 16 / 9
    const fitted = computeAtlasFittedFrustum(0, aspect, EQUIRECTANGULAR_PROJECTION)

    expect(fitted.visibleWidth / fitted.visibleHeight).toBeCloseTo(aspect, 6)
    expect(fitted.visibleWidth).toBeGreaterThanOrEqual(EQUIRECTANGULAR_PROJECTION.worldWidth * ATLAS_WORLD_FIT_PADDING - 1e-9)
    expect(fitted.visibleHeight).toBeGreaterThan(EQUIRECTANGULAR_PROJECTION.worldHeight)
  })

  it('contains Equal Earth on a 16:9 viewport and Mercator on a square viewport', () => {
    const wide = computeAtlasFittedFrustum(0, 16 / 9, EQUAL_EARTH_PROJECTION)
    expect(wide.visibleWidth).toBeGreaterThanOrEqual(EQUAL_EARTH_PROJECTION.worldWidth * ATLAS_WORLD_FIT_PADDING - 1e-9)
    expect(wide.visibleHeight).toBeGreaterThanOrEqual(EQUAL_EARTH_PROJECTION.worldHeight * ATLAS_WORLD_FIT_PADDING - 1e-9)

    const square = computeAtlasFittedFrustum(0, 1, MERCATOR_PROJECTION)
    expect(square.visibleWidth).toBeGreaterThanOrEqual(MERCATOR_PROJECTION.worldWidth * ATLAS_WORLD_FIT_PADDING - 1e-9)
    expect(square.visibleHeight).toBeGreaterThanOrEqual(MERCATOR_PROJECTION.worldHeight * ATLAS_WORLD_FIT_PADDING - 1e-9)
  })

  it('keeps the whole map inside a wider-than-map viewport and halves the span at zoom 1', () => {
    const aspect = 2.4
    const fitted = computeAtlasFittedFrustum(0, aspect, EQUIRECTANGULAR_PROJECTION)
    expect(fitted.visibleHeight).toBeCloseTo(EQUIRECTANGULAR_PROJECTION.worldHeight * ATLAS_WORLD_FIT_PADDING, 6)
    expect(fitted.visibleWidth).toBeGreaterThan(EQUIRECTANGULAR_PROJECTION.worldWidth)

    const zoomed = computeAtlasFittedFrustum(1, aspect, EQUIRECTANGULAR_PROJECTION)
    expect(zoomed.visibleHeight).toBeCloseTo(fitted.visibleHeight / 2, 6)
    expect(zoomed.visibleWidth).toBeCloseTo(fitted.visibleWidth / 2, 6)
  })
})
