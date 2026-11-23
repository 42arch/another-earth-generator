import { describe, expect, it } from 'vitest'
import {
  describeGraticuleFeature,
  describePlateBoundary,
  findGeographicSubject,
  parseFeatureIndexPair,
  resolveProbeFocus,
} from './probe-focus'

describe('resolveProbeFocus', () => {
  it('uses the base surface when the click misses every vector and no thematic is on', () => {
    expect(resolveProbeFocus({ featureHit: null, activeThematicId: null })).toEqual({ kind: 'surface' })
  })

  it('reads the active thematic when the click does not hit a vector', () => {
    expect(resolveProbeFocus({ featureHit: null, activeThematicId: 'annual-temperature' })).toEqual({
      kind: 'thematic',
      id: 'annual-temperature',
    })
  })

  it('prefers the topmost clicked layer over the thematic underneath', () => {
    expect(resolveProbeFocus({
      featureHit: { layerId: 'overlay-river-polygons', sourceId: 'river-polygons' },
      activeThematicId: 'temperature',
    })).toEqual({ kind: 'overlay', id: 'rivers' })
  })

  it('distinguishes wind and ocean arrows that share a source', () => {
    expect(resolveProbeFocus({
      featureHit: { layerId: 'overlay-ocean-arrows', sourceId: 'circulation-vectors' },
      activeThematicId: 'wind-speed',
    })).toEqual({ kind: 'overlay', id: 'ocean-arrows' })
    expect(resolveProbeFocus({
      featureHit: { layerId: 'overlay-wind-arrows', sourceId: 'circulation-vectors' },
      activeThematicId: null,
    })).toEqual({ kind: 'overlay', id: 'wind-arrows' })
  })

  it('falls through an unknown hit to the active thematic', () => {
    expect(resolveProbeFocus({
      featureHit: { layerId: 'overlay-unknown', sourceId: 'not-a-source' },
      activeThematicId: 'koppen',
    })).toEqual({ kind: 'thematic', id: 'koppen' })
  })

  it('treats the parchment territory hit as the country face', () => {
    expect(resolveProbeFocus({
      featureHit: { layerId: 'overlay-polity-territory-hit', sourceId: 'polity-territory' },
      activeThematicId: null,
    })).toEqual({ kind: 'thematic', id: 'polity-territory' })
  })

  it('resolves a fill from its source when the layer id is unfamiliar', () => {
    expect(resolveProbeFocus({
      featureHit: { layerId: 'custom-settlements', sourceId: 'settlements' },
      activeThematicId: 'population-density',
    })).toEqual({ kind: 'overlay', id: 'settlements' })
  })
})

describe('probe feature ids', () => {
  it('parses plate boundaries and polity borders, including a chain suffix and an open frontier', () => {
    expect(parseFeatureIndexPair('plate-boundary:0:3:1', 'plate-boundary')).toEqual({ a: 0, b: 3 })
    expect(parseFeatureIndexPair('polity-border:-1:4', 'polity-border')).toEqual({ a: -1, b: 4 })
    expect(parseFeatureIndexPair('plate-boundary:0:1', 'polity-border')).toBeNull()
    expect(describePlateBoundary([{ id: 'plate:a' }, { id: 'plate:b' }, { id: 'plate:c' }], 'plate-boundary:0:2:1')).toEqual([
      '板块 1 · plate:a',
      '板块 3 · plate:c',
    ])
  })

  it('names graticule lines from their feature id', () => {
    expect(describeGraticuleFeature('graticule:lat:0')).toBe('赤道')
    expect(describeGraticuleFeature('graticule:lat:-15')).toBe('15°S 纬线')
    expect(describeGraticuleFeature('graticule:lon:0')).toBe('本初子午线')
    expect(describeGraticuleFeature('graticule:lon:180')).toBe('180° 经线')
    expect(describeGraticuleFeature('graticule:lon:-30')).toBe('30°W 经线')
    expect(describeGraticuleFeature('river:1')).toBeNull()
  })

  it('finds the geographic label that was clicked, not the cell underneath', () => {
    const subject = findGeographicSubject({
      continents: [{ id: 'continent:a', areaKm2: 1200, name: '维兰大陆' }],
      oceans: [{ id: 'ocean:b', areaKm2: 8000, name: '北溟' }],
      seas: [],
    }, 'ocean:b')
    expect(subject).toEqual({ name: '北溟洋', areaKm2: 8000 })
  })
})
