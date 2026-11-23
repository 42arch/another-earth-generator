import type { WorldMapReader } from '@another-earth/world-core'
import type { MapSourceRegistry } from '#sources/registry'
import type { GeoJsonFeature } from '#sources/types'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { SelectionLayer } from '#rendering/layers/selection-layer'

function registryFor(features: readonly GeoJsonFeature[], sourceId = 'settlements'): MapSourceRegistry {
  return {
    getSource(requestedId: string) {
      if (requestedId !== sourceId)
        throw new Error(`Unknown map source "${requestedId}"`)
      return {
        unavailable: false,
        kind: 'geojson' as const,
        data: {
          type: 'FeatureCollection' as const,
          features,
        },
      }
    },
  } as unknown as MapSourceRegistry
}

function layer(): SelectionLayer {
  return new SelectionLayer({ identity: { regionCount: 0 } } as WorldMapReader)
}

describe('selectionLayer', () => {
  it('rings a picked point feature and does not add a center dot', () => {
    const selection = layer()
    selection.updateSelection({
      regionId: null,
      featureId: 'settlement:capital',
      sourceId: 'settlements',
    }, registryFor([{
      type: 'Feature',
      id: 'settlement:capital',
      geometry: { type: 'Point', coordinates: [12, 34] },
      properties: {},
    }]))

    expect(selection.isFeatureHighlighted()).toBe(true)
    expect(selection.isRegionHighlighted()).toBe(false)
    const halo = selection.group.children.find(child => child.type === 'LineSegments' && child.visible)
    expect(halo).toBeInstanceOf(THREE.LineSegments)
    expect((halo as THREE.LineSegments).geometry.getAttribute('position').count).toBeGreaterThan(0)
    expect(selection.group.children.some(child => child.type === 'Mesh' && child.visible)).toBe(false)
    selection.dispose()
  })

  it('outlines the picked line and ignores a different source', () => {
    const selection = layer()
    const features: GeoJsonFeature[] = [{
      type: 'Feature',
      id: 'river:1',
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 0]] },
      properties: {},
    }]
    selection.updateSelection({
      regionId: null,
      featureId: 'river:1',
      sourceId: 'river-centerlines',
    }, registryFor(features, 'river-centerlines'))
    expect(selection.isFeatureHighlighted()).toBe(true)

    selection.updateSelection({
      regionId: null,
      featureId: 'river:1',
      sourceId: 'lake-polygons',
    }, registryFor(features, 'river-centerlines'))
    expect(selection.isFeatureHighlighted()).toBe(false)
    selection.dispose()
  })

  it('outlines a polygon feature instead of leaving the highlight empty', () => {
    const selection = layer()
    selection.updateSelection({
      regionId: null,
      featureId: 'polity:1',
      sourceId: 'polity-territory',
    }, registryFor([{
      type: 'Feature',
      id: 'polity:1',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [3, 0], [3, 2], [0, 2], [0, 0]]],
      },
      properties: {},
    }], 'polity-territory'))

    expect(selection.isFeatureHighlighted()).toBe(true)
    const fill = selection.group.children.find(child => child.name === 'FeatureHighlightFill')
    expect(fill).toBeInstanceOf(THREE.Mesh)
    expect(fill?.visible).toBe(true)
    expect((fill as THREE.Mesh).geometry.getAttribute('position').count).toBeGreaterThan(0)
    selection.dispose()
  })

  it('does not highlight a text label', () => {
    const selection = layer()
    selection.updateSelection({
      regionId: null,
      featureId: 'polity:1',
      sourceId: 'polity-labels',
    }, registryFor([{
      type: 'Feature',
      id: 'polity:1',
      geometry: { type: 'Point', coordinates: [8, 12] },
      properties: {},
    }], 'polity-labels'))

    expect(selection.isFeatureHighlighted()).toBe(false)
    selection.dispose()
  })
})
