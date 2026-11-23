import type { GeoJsonSource, MapStyleDocument, TerritorySpineMetadata } from '../../index'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CollisionGrid, lonLatDegToCartesian, readTextOffsetEm, sampleSpineGlyphAnchors, sphericalAngleRad, StyleCompiler, SymbolLayer } from '../../index'

const OFFSET_EM_Y = -1.15
const TEXT_SIZE_PX = 16

function pointLabelDocument(offset: readonly [number, number]): MapStyleDocument {
  return {
    version: 1,
    id: 'label-offset',
    name: 'Label offset',
    tokens: {},
    layers: [
      {
        id: 'overlay-settlement-labels',
        type: 'symbol',
        source: 'settlement-labels',
        slot: 'overlay',
        overlayId: 'settlement-labels',
        layout: {
          'text-field': '甲',
          'symbol-placement': 'point',
          'text-size': TEXT_SIZE_PX,
          'text-offset': offset,
        },
        paint: {
          'text-color': '#111111',
        },
      },
    ],
  }
}

function pointLabelSource(): GeoJsonSource {
  return {
    unavailable: false,
    kind: 'geojson',
    sourceId: 'settlement-labels',
    snapshotId: 'snap:label-offset',
    adapterVersion: 'test',
    cacheKey: 'label-offset',
    geometryKind: 'point',
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'settlement:test',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: { displayName: '甲', tier: 'capital', priority: 10 },
        },
      ],
    },
  }
}

function longEquatorSpine(): TerritorySpineMetadata {
  const spanDeg = 80
  const spinePoints = Array.from({ length: 5 }, (_, index) => {
    const lon = -spanDeg / 2 + (spanDeg * index) / 4
    return lonLatDegToCartesian(lon, 0)
  })
  return {
    featureId: 'polity:long',
    displayName: '青瓦尔塔',
    kind: 'polity',
    areaKm2: 1_000_000,
    anchorRegion: 0,
    anchorPosition: spinePoints[2]!,
    anchorCoordinates: [0, 0],
    elongation: 2,
    isCurved: true,
    spinePoints,
    spineCoordinates: [],
  }
}

describe('atlas curved label tracking', () => {
  it('keeps tracked glyphs near the requested step instead of stretching along the spine', () => {
    const spine = longEquatorSpine()
    const stepRad = 0.012
    const tracked = sampleSpineGlyphAnchors(spine, '青瓦尔塔', [1, 0, 0], { glyphStepRad: stepRad, layout: 'tracked' })
    const fitted = sampleSpineGlyphAnchors(spine, '青瓦尔塔', [1, 0, 0], { glyphStepRad: stepRad, layout: 'fitted' })
    const span = (glyphs: typeof tracked) => sphericalAngleRad(glyphs[0]!.position, glyphs.at(-1)!.position)

    expect(tracked).toHaveLength(4)
    expect(span(tracked)).toBeCloseTo(stepRad * 3, 2)
    expect(span(fitted)).toBeGreaterThan(span(tracked) * 2)
  })
})

describe('settlement label text-offset', () => {
  it('reads em offsets and rejects non-numeric values', () => {
    expect(readTextOffsetEm([0.25, -1.15])).toEqual([0.25, -1.15])
    expect(readTextOffsetEm(null)).toEqual([0, 0])
    expect(readTextOffsetEm([Number.NaN, 2])).toEqual([0, 2])
  })

  it('keeps a point label above its anchor at both far and close zoom', () => {
    const compiled = new StyleCompiler().compile(pointLabelDocument([0, OFFSET_EM_Y]))
    const layer = new SymbolLayer(compiled.layers[0]!, pointLabelSource())
    const width = 1280
    const height = 720
    layer.setViewport(width, height, 1)
    layer.updateStyle(compiled.layers[0]!, 3)

    const liftAtDistance = (distance: number) => {
      const camera = new THREE.PerspectiveCamera(42, width / height, 0.02, 20)
      camera.position.set(0, 0, distance)
      camera.up.set(0, 1, 0)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld()
      layer.updatePlacement(camera, new CollisionGrid())

      const state = layer.getPlacementState('settlement:test')
      expect(state?.visible).toBe(true)
      const box = state!.screenBoxes[0]!
      const labelY = (box.minY + box.maxY) / 2
      const anchor = new THREE.Vector3(0, 0, 1.0005)
      anchor.project(camera)
      const anchorY = (1 - anchor.y) * 0.5 * height
      return anchorY - labelY
    }

    const farLift = liftAtDistance(3)
    const nearLift = liftAtDistance(1.35)
    const expectedLift = -OFFSET_EM_Y * TEXT_SIZE_PX * 1.15 * 0.85

    expect(farLift).toBeCloseTo(expectedLift, 0)
    expect(nearLift).toBeCloseTo(expectedLift, 0)
    expect(Math.abs(nearLift - farLift)).toBeLessThan(2)
    layer.dispose()
  })
})
