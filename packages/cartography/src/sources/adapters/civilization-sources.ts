import type { WorldMapReader } from '@another-earth/world-core'
import type { LonLatTuple, Vec3Tuple } from '#projections/spherical-math'
import type { DerivedRiverFeature } from '#sources/topology/hydrography-buffer'
import type { SharedBoundaryRelaxation } from '#sources/topology/spherical-smooth'
import type {
  GeoJsonFeature,
  GeoJsonLineStringGeometry,
  GeoJsonMultiPolygonGeometry,
  GeoJsonPointGeometry,
  GeoJsonPolygonGeometry,
  GeoJsonSource,
  RasterCellSource,
  RasterFieldDescriptor,
  SourceUnavailable,
  TerritorySpineMetadata,
} from '#sources/types'
import { cartesianToLonLatDeg, lonLatDegToCartesian, sphericalAngleRad } from '#projections/spherical-math'
import { buildHydrographyRivers, DISPLAYED_RIVER_MIN_STRAHLER } from '#sources/topology/hydrography-buffer'
import { traceClassificationRings } from '#sources/topology/ring-tracer'
import { alignInlandBoundariesToCoastline, catmullRomSmoothOpenPath } from '#sources/topology/spherical-smooth'
import { computeTerritorySpine } from '#sources/topology/territory-spine'
import { BUILTIN_MAP_SOURCE_SCHEMAS } from '#sources/types'
import { buildTiledSmoothedGroupPolygons, makePolygonGeometry } from './area-sources'

interface IndexedCornerEdge {
  readonly cornerA: number
  readonly cornerB: number
  readonly edgeId: number
}

interface CornerEdgeChain {
  readonly corners: number[]
  readonly edgeIds: number[]
  readonly closed: boolean
}

function chainIndexedCornerEdges(edges: readonly IndexedCornerEdge[]): CornerEdgeChain[] {
  if (edges.length === 0)
    return []

  const adjacency = new Map<number, { neighbor: number, edgeIndex: number }[]>()
  for (let i = 0; i < edges.length; i++) {
    const { cornerA, cornerB } = edges[i]
    let listA = adjacency.get(cornerA)
    if (!listA) {
      listA = []
      adjacency.set(cornerA, listA)
    }
    listA.push({ neighbor: cornerB, edgeIndex: i })
    let listB = adjacency.get(cornerB)
    if (!listB) {
      listB = []
      adjacency.set(cornerB, listB)
    }
    listB.push({ neighbor: cornerA, edgeIndex: i })
  }

  const visited = new Uint8Array(edges.length)
  const chains: CornerEdgeChain[] = []

  const traceFrom = (startCorner: number, firstEdgeIdx: number, nextCorner: number): CornerEdgeChain => {
    visited[firstEdgeIdx] = 1
    const corners = [startCorner, nextCorner]
    const edgeIds = [edges[firstEdgeIdx].edgeId]
    let curr = nextCorner
    let closed = false
    while (true) {
      const neighbors = adjacency.get(curr)
      if (!neighbors || neighbors.length !== 2)
        break
      const nextStep = neighbors.find(item => !visited[item.edgeIndex])
      if (!nextStep)
        break
      visited[nextStep.edgeIndex] = 1
      edgeIds.push(edges[nextStep.edgeIndex].edgeId)
      curr = nextStep.neighbor
      if (curr === startCorner) {
        closed = true
        break
      }
      corners.push(curr)
    }
    return { corners, edgeIds, closed }
  }

  for (const [corner, neighbors] of adjacency) {
    if (neighbors.length === 2)
      continue
    for (const step of neighbors) {
      if (visited[step.edgeIndex])
        continue
      chains.push(traceFrom(corner, step.edgeIndex, step.neighbor))
    }
  }

  for (let i = 0; i < edges.length; i++) {
    if (visited[i])
      continue
    const edge = edges[i]
    chains.push(traceFrom(edge.cornerA, i, edge.cornerB))
  }

  return chains
}

type PolygonOrMultiPolygon = GeoJsonPolygonGeometry | GeoJsonMultiPolygonGeometry

function unavailableSource(
  sourceId:
    | 'population-density'
    | 'resource-potential'
    | 'polity-territory'
    | 'culture-dominant'
    | 'religion-dominant'
    | 'polity-borders'
    | 'transport-routes'
    | 'settlements'
    | 'polity-labels'
    | 'settlement-labels',
  reader: WorldMapReader,
  cacheKey: string,
  reason: string,
): SourceUnavailable {
  return Object.freeze({
    unavailable: true as const,
    sourceId,
    snapshotId: reader.identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS[sourceId].adapterVersion,
    cacheKey,
    reason,
  })
}

function buildRasterSource(
  sourceId: 'population-density' | 'resource-potential',
  reader: WorldMapReader,
  cacheKey: string,
  fields: Record<string, RasterFieldDescriptor>,
): RasterCellSource {
  const { snapshotId, regionCount } = reader.identity
  const { adapterVersion } = BUILTIN_MAP_SOURCE_SCHEMAS[sourceId]
  const frozenFields = Object.freeze({ ...fields })

  return Object.freeze({
    unavailable: false as const,
    kind: 'raster' as const,
    sourceId,
    snapshotId,
    adapterVersion,
    cacheKey,
    regionCount,
    fields: frozenFields,
    getCellValue(fieldName: string, region: number): number {
      const desc = frozenFields[fieldName]
      if (!desc)
        throw new Error(`Unknown raster field "${fieldName}" on source "${sourceId}"`)
      return desc.view.get(region)
    },
    isNoData(fieldName: string, region: number): boolean {
      const desc = frozenFields[fieldName]
      if (!desc)
        throw new Error(`Unknown raster field "${fieldName}" on source "${sourceId}"`)
      if (desc.availableMask && desc.availableMask.get(region) === 0)
        return true
      const value = desc.view.get(region)
      if (!Number.isFinite(value))
        return true
      return desc.noDataValue !== undefined && value === desc.noDataValue
    },
  })
}

export function buildPopulationDensityRasterSource(
  reader: WorldMapReader,
  cacheKey: string,
): RasterCellSource | SourceUnavailable {
  if (!reader.capabilities.hasCivilization) {
    return unavailableSource('population-density', reader, cacheKey, 'Civilization data is unavailable in this world snapshot')
  }
  return buildRasterSource('population-density', reader, cacheKey, {
    landMask: { name: 'landMask', view: reader.field('landMask') },
    population: { name: 'population', view: reader.field('population'), unit: '人' },
    populationDensity: { name: 'populationDensity', view: reader.field('populationDensity'), unit: '人/km²' },
    habitability: { name: 'habitability', view: reader.field('habitability') },
    carryingCapacityPerKm2: { name: 'carryingCapacityPerKm2', view: reader.field('carryingCapacityPerKm2'), unit: '人/km²' },
    transportAccessibility: { name: 'transportAccessibility', view: reader.field('transportAccessibility') },
  })
}

export function buildResourcePotentialRasterSource(
  reader: WorldMapReader,
  cacheKey: string,
): RasterCellSource | SourceUnavailable {
  if (!reader.capabilities.hasResources) {
    return unavailableSource('resource-potential', reader, cacheKey, 'Resource potential data is unavailable in this world snapshot')
  }
  return buildRasterSource('resource-potential', reader, cacheKey, {
    landMask: { name: 'landMask', view: reader.field('landMask') },
    agriculturalPotential: { name: 'agriculturalPotential', view: reader.field('agriculturalPotential') },
    forestryPotential: { name: 'forestryPotential', view: reader.field('forestryPotential') },
    fisheryPotential: { name: 'fisheryPotential', view: reader.field('fisheryPotential') },
    depositRichness: { name: 'depositRichness', view: reader.field('depositRichness') },
  })
}

function buildDominantCategoryPolygonSource(
  reader: WorldMapReader,
  sourceId: 'polity-territory' | 'culture-dominant' | 'religion-dominant',
  fieldName: 'dominantPolityIndex' | 'dominantCultureIndex' | 'dominantReligionIndex',
  propertyIndexKey: 'polityIndex' | 'cultureIndex' | 'religionIndex',
  cacheKey: string,
  sharedCornerPositions: Float64Array | undefined,
  buildMeta: (groupIndex: number) => {
    readonly id: string
    readonly name: string
    readonly extraProps: Readonly<Record<string, string | number | boolean | null>>
  } | null,
): GeoJsonSource<PolygonOrMultiPolygon> | SourceUnavailable {
  if (!reader.capabilities.hasCivilization) {
    return unavailableSource(sourceId, reader, cacheKey, 'Civilization data is unavailable in this world snapshot')
  }

  const { mesh, identity } = reader
  const count = mesh.regionCount
  const landMask = reader.field('landMask')
  const lakeIndex = sourceId === 'polity-territory' ? reader.field('lakeIndex') : null
  const field = reader.field(fieldName)
  const groupIds = new Int32Array(count).fill(-1)
  const areaByGroup = new Map<number, number>()
  const entityCount = fieldName === 'dominantPolityIndex'
    ? reader.polities().length
    : fieldName === 'dominantCultureIndex'
      ? reader.cultures().length
      : reader.religions().length

  // Ring tracing drops negative labels. This id stays outside real polity indexes
  // so unassigned land still becomes a polygon; the feature's groupIndex stays -1.
  const unassignedLandGroup = 1_000_000
  const includeUnassignedLand = sourceId === 'polity-territory'
  for (let r = 0; r < count; r++) {
    if (landMask.get(r) === 0 || (lakeIndex !== null && lakeIndex.get(r) >= 0))
      continue
    const idx = Math.floor(field.get(r))
    if (idx < 0 || idx >= entityCount) {
      if (!includeUnassignedLand)
        continue
      groupIds[r] = unassignedLandGroup
      areaByGroup.set(unassignedLandGroup, (areaByGroup.get(unassignedLandGroup) ?? 0) + mesh.getRegionAreaKm2(r))
      continue
    }
    groupIds[r] = idx
    areaByGroup.set(idx, (areaByGroup.get(idx) ?? 0) + mesh.getRegionAreaKm2(r))
  }

  const polygonsByGroup = buildTiledSmoothedGroupPolygons(mesh, groupIds, sharedCornerPositions)
  const sortedGroupIds = [...polygonsByGroup.keys()].sort((a, b) => a - b)

  const features: GeoJsonFeature<PolygonOrMultiPolygon>[] = []
  for (const gId of sortedGroupIds) {
    if (gId === unassignedLandGroup) {
      const polygons = polygonsByGroup.get(gId) ?? []
      const geometry = makePolygonGeometry(polygons)
      if (!geometry)
        continue
      features.push({
        type: 'Feature',
        id: 'polity:unassigned',
        geometry,
        properties: {
          id: 'polity:unassigned',
          groupIndex: -1,
          [propertyIndexKey]: -1,
          areaKm2: areaByGroup.get(gId) ?? 0,
          name: '无归属地',
          unassigned: true,
        },
      })
      continue
    }
    const meta = buildMeta(gId)
    if (!meta)
      continue
    const polygons = polygonsByGroup.get(gId) ?? []
    const geometry = makePolygonGeometry(polygons)
    if (!geometry)
      continue
    features.push({
      type: 'Feature',
      id: meta.id,
      geometry,
      properties: {
        id: meta.id,
        entityId: meta.id,
        groupIndex: gId,
        [propertyIndexKey]: gId,
        areaKm2: areaByGroup.get(gId) ?? 0,
        name: meta.name,
        ...meta.extraProps,
      },
    })
  }

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId,
    snapshotId: identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS[sourceId].adapterVersion,
    cacheKey,
    geometryKind: 'polygon' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}

export function buildPolityTerritorySource(
  reader: WorldMapReader,
  cacheKey: string,
  sharedCornerPositions?: Float64Array,
): GeoJsonSource<PolygonOrMultiPolygon> | SourceUnavailable {
  const polities = reader.polities()
  return buildDominantCategoryPolygonSource(
    reader,
    'polity-territory',
    'dominantPolityIndex',
    'polityIndex',
    cacheKey,
    sharedCornerPositions,
    (idx) => {
      const polity = polities[idx]
      if (!polity)
        return null
      return {
        id: polity.id,
        name: polity.name,
        extraProps: {
          sizeClass: polity.sizeClass ?? 'regional',
          archetypeId: polity.archetypeId,
        },
      }
    },
  )
}

export function buildCultureDominantSource(
  reader: WorldMapReader,
  cacheKey: string,
  sharedCornerPositions?: Float64Array,
): GeoJsonSource<PolygonOrMultiPolygon> | SourceUnavailable {
  const cultures = reader.cultures()
  return buildDominantCategoryPolygonSource(
    reader,
    'culture-dominant',
    'dominantCultureIndex',
    'cultureIndex',
    cacheKey,
    sharedCornerPositions,
    (idx) => {
      const culture = cultures[idx]
      if (!culture)
        return null
      return {
        id: culture.id,
        name: culture.name,
        extraProps: {
          peopleId: culture.peopleId,
        },
      }
    },
  )
}

export function buildReligionDominantSource(
  reader: WorldMapReader,
  cacheKey: string,
  sharedCornerPositions?: Float64Array,
): GeoJsonSource<PolygonOrMultiPolygon> | SourceUnavailable {
  const religions = reader.religions()
  return buildDominantCategoryPolygonSource(
    reader,
    'religion-dominant',
    'dominantReligionIndex',
    'religionIndex',
    cacheKey,
    sharedCornerPositions,
    (idx) => {
      const religion = religions[idx]
      if (!religion)
        return null
      return {
        id: religion.id,
        name: religion.name,
        extraProps: {
          archetypeId: religion.archetypeId,
        },
      }
    },
  )
}

/**
 * Land ownership used to stroke borders. Lakes keep the polity that already
 * owns them, so a lake inside one country is not a frontier ring.
 */
function polityBorderGroupIds(reader: WorldMapReader): Int32Array {
  const { mesh } = reader
  const count = mesh.regionCount
  const landMask = reader.field('landMask')
  const polityField = reader.field('dominantPolityIndex')
  const polityCount = reader.polities().length
  const groupIds = new Int32Array(count).fill(-1)
  for (let r = 0; r < count; r++) {
    if (landMask.get(r) === 0)
      continue
    const idx = Math.floor(polityField.get(r))
    if (idx >= 0 && idx < polityCount)
      groupIds[r] = idx
  }
  return groupIds
}

/** Same corner and edge-midpoint relaxation used by polity border strokes. */
export function relaxPolityBorderBoundaries(
  reader: WorldMapReader,
  cornerPositions: Float64Array,
): SharedBoundaryRelaxation | null {
  if (!reader.capabilities.hasCivilization)
    return null

  const { mesh } = reader
  const landMask = reader.field('landMask')
  const groupIds = polityBorderGroupIds(reader)

  const coastlineEdgeIds: number[] = []
  const inlandEdgeIds: number[] = []
  mesh.forEachEdge((edgeId, regionA, regionB) => {
    const oceanA = landMask.get(regionA) === 0
    const oceanB = landMask.get(regionB) === 0
    if (oceanA !== oceanB) {
      coastlineEdgeIds.push(edgeId)
      return
    }
    const polityA = groupIds[regionA]
    const polityB = groupIds[regionB]
    if (polityA === polityB || (polityA < 0 && polityB < 0))
      return
    inlandEdgeIds.push(edgeId)
  })

  return alignInlandBoundariesToCoastline(
    mesh,
    cornerPositions,
    Uint32Array.from(coastlineEdgeIds),
    Uint32Array.from(inlandEdgeIds),
  )
}

export function buildPolityBordersSource(
  reader: WorldMapReader,
  cacheKey: string,
  sharedCornerPositions?: Float64Array,
): GeoJsonSource<GeoJsonLineStringGeometry> | SourceUnavailable {
  if (!reader.capabilities.hasCivilization) {
    return unavailableSource('polity-borders', reader, cacheKey, 'Civilization data is unavailable in this world snapshot')
  }

  const { mesh, identity } = reader
  const landMask = reader.field('landMask')
  const polities = reader.polities()
  const groupIds = polityBorderGroupIds(reader)

  const traced = traceClassificationRings(mesh, groupIds, sharedCornerPositions)
  const edgesByPair = new Map<string, {
    polityIndexA: number
    polityIndexB: number
    edges: IndexedCornerEdge[]
  }>()

  mesh.forEachEdge((edgeId, regionA, regionB, cornerA, cornerB) => {
    const oceanA = landMask.get(regionA) === 0
    const oceanB = landMask.get(regionB) === 0
    if (oceanA !== oceanB)
      return
    const pA = groupIds[regionA]
    const pB = groupIds[regionB]
    if (pA === pB || (pA < 0 && pB < 0))
      return

    const first = Math.min(pA, pB)
    const second = Math.max(pA, pB)
    const key = `${first}:${second}`
    let pair = edgesByPair.get(key)
    if (!pair) {
      pair = { polityIndexA: first, polityIndexB: second, edges: [] }
      edgesByPair.set(key, pair)
    }
    pair.edges.push({ cornerA, cornerB, edgeId })
  })

  const aligned = relaxPolityBorderBoundaries(reader, traced.cornerPositions)
  if (!aligned)
    return unavailableSource('polity-borders', reader, cacheKey, 'Civilization data is unavailable in this world snapshot')

  const features: GeoJsonFeature<GeoJsonLineStringGeometry>[] = []
  const sortedPairs = [...edgesByPair.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [key, pair] of sortedPairs) {
    const chains = chainIndexedCornerEdges(pair.edges)
    const isFrontier = pair.polityIndexA < 0 || pair.polityIndexB < 0
    const primaryIdx = pair.polityIndexB >= 0 ? pair.polityIndexB : pair.polityIndexA
    const polityA = pair.polityIndexA >= 0 ? (polities[pair.polityIndexA]?.id ?? null) : null
    const polityB = pair.polityIndexB >= 0 ? (polities[pair.polityIndexB]?.id ?? null) : null
    const primaryEntityId = polities[primaryIdx]?.id ?? null

    for (let idx = 0; idx < chains.length; idx++) {
      const chain = chains[idx]
      const coordinates: LonLatTuple[] = []
      for (let step = 0; step < chain.corners.length; step++) {
        const corner = chain.corners[step]
        const offset = 3 * corner
        coordinates.push(cartesianToLonLatDeg(
          aligned.corners[offset],
          aligned.corners[offset + 1],
          aligned.corners[offset + 2],
        ))
        const edgeId = chain.edgeIds[step]
        if (edgeId === undefined)
          continue
        const midpoint = aligned.edgeMidpoints.get(edgeId)
        if (midpoint)
          coordinates.push(cartesianToLonLatDeg(midpoint[0], midpoint[1], midpoint[2]))
      }
      if (chain.closed && coordinates.length > 0)
        coordinates.push([coordinates[0][0], coordinates[0][1]])
      const id = chains.length === 1 ? `polity-border:${key}` : `polity-border:${key}:${idx}`
      features.push({
        type: 'Feature',
        id,
        geometry: {
          type: 'LineString',
          coordinates,
        },
        properties: {
          id,
          entityId: primaryEntityId,
          polityA,
          polityB,
          polityIndexA: pair.polityIndexA,
          polityIndexB: pair.polityIndexB,
          isFrontier,
        },
      })
    }
  }

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'polity-borders',
    snapshotId: identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS['polity-borders'].adapterVersion,
    cacheKey,
    geometryKind: 'line' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}

/**
 * Several routes often share the same coastal or road cells. Each dashed copy
 * starts its pattern at a different distance, so the gaps of one fill the dashes
 * of another and the stack looks solid. Draw each undirected step once.
 */
function undirectedStepKey(mode: string, a: number, b: number): string {
  return a < b ? `${mode}:${a}:${b}` : `${mode}:${b}:${a}`
}

function unclaimedRouteRuns(regions: readonly number[], mode: string, claimed: Set<string>): number[][] {
  const runs: number[][] = []
  let current: number[] = []
  const flush = () => {
    if (current.length >= 2)
      runs.push(current)
    current = []
  }
  for (let i = 0; i < regions.length - 1; i++) {
    const a = regions[i]!
    const b = regions[i + 1]!
    const key = undirectedStepKey(mode, a, b)
    if (claimed.has(key)) {
      flush()
      continue
    }
    claimed.add(key)
    if (current.length === 0) {
      current.push(a)
    }
    current.push(b)
  }
  flush()
  return runs
}

/** Region-center chains are angular. A spherical Catmull-Rom keeps the endpoints and rounds each bend. */
function smoothTransportRoute(coords: readonly LonLatTuple[]): LonLatTuple[] {
  if (coords.length < 3)
    return [...coords]
  const controls: Vec3Tuple[] = []
  for (const [lon, lat] of coords) {
    const point = lonLatDegToCartesian(lon, lat)
    const previous = controls.at(-1)
    if (!previous || sphericalAngleRad(previous, point) > 1e-4)
      controls.push(point)
  }
  if (controls.length < 3)
    return controls.map(point => cartesianToLonLatDeg(point[0], point[1], point[2]))
  return catmullRomSmoothOpenPath(controls, undefined, 4).points.map(point => cartesianToLonLatDeg(point[0], point[1], point[2]))
}

interface RiverPlacement {
  readonly feature: DerivedRiverFeature
  readonly step: number
}

interface RouteStroke {
  readonly mode: string
  readonly coordinates: LonLatTuple[]
}

interface RiverRunSegment {
  readonly kind: 'river' | 'road'
  readonly regions: number[]
}

function displayedRiverPlacements(rivers: readonly DerivedRiverFeature[]): Map<number, RiverPlacement> {
  const placements = new Map<number, RiverPlacement>()
  for (const feature of rivers) {
    if (feature.strahlerOrder < DISPLAYED_RIVER_MIN_STRAHLER)
      continue
    for (let step = 0; step < feature.regionIds.length; step++)
      placements.set(feature.regionIds[step]!, { feature, step })
  }
  return placements
}

function regionCenterLine(
  mesh: WorldMapReader['mesh'],
  regions: readonly number[],
  centerOut: { x: number, y: number, z: number },
): LonLatTuple[] {
  return regions.map((region) => {
    mesh.getRegionCenter(region, centerOut)
    return cartesianToLonLatDeg(centerOut.x, centerOut.y, centerOut.z)
  })
}

function copyCoord(coord: LonLatTuple): LonLatTuple {
  return [coord[0], coord[1]]
}

/** Adjacent steps belong to this run. A longer gap is open only when no earlier route already drew it. */
function riverGapOpen(feature: DerivedRiverFeature, fromStep: number, toStep: number, claimed: Set<string>): boolean {
  const lo = Math.min(fromStep, toStep)
  const hi = Math.max(fromStep, toStep)
  if (hi - lo <= 1)
    return true
  for (let step = lo; step < hi; step++) {
    if (claimed.has(undirectedStepKey('river', feature.regionIds[step]!, feature.regionIds[step + 1]!)))
      return false
  }
  return true
}

function sliceDisplayedCenterline(feature: DerivedRiverFeature, steps: readonly number[]): LonLatTuple[] {
  let lo = steps[0]!
  let hi = steps[0]!
  for (const step of steps) {
    if (step < lo)
      lo = step
    if (step > hi)
      hi = step
  }
  const from = Math.min(feature.centerlineVertexIndex[lo]!, feature.centerlineVertexIndex[hi]!)
  const to = Math.max(feature.centerlineVertexIndex[lo]!, feature.centerlineVertexIndex[hi]!)
  const coords = feature.centerlineCoords.slice(from, to + 1).map(copyCoord)
  if (steps[steps.length - 1]! < steps[0]!)
    coords.reverse()
  return coords
}

function claimRiverSteps(feature: DerivedRiverFeature, steps: readonly number[], claimed: Set<string>): void {
  let lo = steps[0]!
  let hi = steps[0]!
  for (const step of steps) {
    if (step < lo)
      lo = step
    if (step > hi)
      hi = step
  }
  for (let step = lo; step < hi; step++)
    claimed.add(undirectedStepKey('river', feature.regionIds[step]!, feature.regionIds[step + 1]!))
}

function takeRiverSpans(
  feature: DerivedRiverFeature,
  steps: readonly number[],
  claimed: Set<string>,
): { steps: number[], coordinates: LonLatTuple[] }[] {
  const groups: number[][] = []
  let current = [steps[0]!]
  for (let i = 1; i < steps.length; i++) {
    const next = steps[i]!
    if (riverGapOpen(feature, current.at(-1)!, next, claimed)) {
      current.push(next)
    }
    else {
      groups.push(current)
      current = [next]
    }
  }
  groups.push(current)
  const spans: { steps: number[], coordinates: LonLatTuple[] }[] = []
  for (const group of groups) {
    if (new Set(group).size < 2)
      continue
    spans.push({ steps: group, coordinates: sliceDisplayedCenterline(feature, group) })
    claimRiverSteps(feature, group, claimed)
  }
  return spans
}

function stitchDisplayedRiverCells(
  regions: readonly number[],
  placements: Map<number, RiverPlacement>,
  claimed: Set<string>,
): LonLatTuple[] {
  const coords: LonLatTuple[] = []
  const push = (coord: LonLatTuple) => {
    const last = coords.at(-1)
    if (!last || last[0] !== coord[0] || last[1] !== coord[1])
      coords.push(coord)
  }
  const pushExtension = (feature: DerivedRiverFeature, reverse: boolean) => {
    const mouthStep = feature.regionIds.length - 1
    const mouthVertex = feature.centerlineVertexIndex[mouthStep]
    const downVertex = feature.downstreamVertexIndex
    if (mouthVertex === undefined || downVertex < 0 || downVertex <= mouthVertex)
      return
    const points = feature.centerlineCoords.slice(mouthVertex, downVertex + 1)
    if (reverse) {
      for (let point = points.length - 1; point >= 0; point--)
        push(copyCoord(points[point]!))
    }
    else {
      for (const point of points)
        push(copyCoord(point))
    }
  }

  let index = 0
  while (index < regions.length) {
    const current = placements.get(regions[index]!)
    if (!current)
      break
    let end = index + 1
    while (end < regions.length && placements.get(regions[end]!)?.feature === current.feature)
      end++
    const steps = regions.slice(index, end).map(region => placements.get(region)!.step)
    const previousRegion = index > 0 ? regions[index - 1] : undefined
    const mouthStep = current.feature.regionIds.length - 1
    if (previousRegion === current.feature.downstreamRegionId && steps[0] === mouthStep)
      pushExtension(current.feature, true)
    if (new Set(steps).size >= 2) {
      for (const span of takeRiverSpans(current.feature, steps, claimed)) {
        for (const coord of span.coordinates)
          push(coord)
      }
    }
    else {
      const vertex = current.feature.centerlineVertexIndex[steps[0]!]
      const point = vertex === undefined ? undefined : current.feature.centerlineCoords[vertex]
      if (point)
        push(copyCoord(point))
    }
    const nextRegion = regions[end]
    if (nextRegion === current.feature.downstreamRegionId && steps.at(-1) === mouthStep)
      pushExtension(current.feature, false)
    index = end
  }
  return coords
}

/**
 * River strokes follow the centerlines the map draws, including across confluences.
 * A displayed river is split into a new segment at every tributary, and many of
 * those segments are a single cell. Cells off those rivers are drawn as roads.
 */
function riverStrokesForRun(
  run: readonly number[],
  placements: Map<number, RiverPlacement>,
  claimed: Set<string>,
  mesh: WorldMapReader['mesh'],
  centerOut: { x: number, y: number, z: number },
): RouteStroke[] {
  const segments: RiverRunSegment[] = []
  for (const region of run) {
    const placement = placements.get(region)
    const last = segments.at(-1)
    if (placement && last?.kind === 'river') {
      last.regions.push(region)
      continue
    }
    if (!placement && last?.kind === 'road') {
      last.regions.push(region)
      continue
    }
    segments.push(placement
      ? { kind: 'river', regions: [region] }
      : { kind: 'road', regions: [region] })
  }

  const normalized: RiverRunSegment[] = []
  for (const segment of segments) {
    const kind = segment.kind === 'river' && segment.regions.length >= 2 ? 'river' : 'road'
    const last = normalized.at(-1)
    if (kind === 'road' && last?.kind === 'road') {
      last.regions.push(...segment.regions)
      continue
    }
    normalized.push({
      kind,
      regions: [...segment.regions],
    })
  }

  const strokes: RouteStroke[] = []
  for (let i = 0; i < normalized.length; i++) {
    const segment = normalized[i]!
    if (segment.kind === 'river') {
      const line = stitchDisplayedRiverCells(segment.regions, placements, claimed)
      if (line.length >= 2)
        strokes.push({ mode: 'river', coordinates: line })
      continue
    }
    const regions = [...segment.regions]
    const previous = normalized[i - 1]
    const next = normalized[i + 1]
    if (previous?.kind === 'river')
      regions.unshift(previous.regions.at(-1)!)
    if (next?.kind === 'river')
      regions.push(next.regions[0]!)
    let open: number[] = []
    const flushRoad = () => {
      if (open.length >= 2) {
        strokes.push({
          mode: 'road',
          coordinates: smoothTransportRoute(regionCenterLine(mesh, open, centerOut)),
        })
      }
      open = []
    }
    for (let edge = 0; edge < regions.length - 1; edge++) {
      const key = undirectedStepKey('road', regions[edge]!, regions[edge + 1]!)
      if (claimed.has(key)) {
        flushRoad()
        continue
      }
      claimed.add(key)
      if (open.length === 0)
        open.push(regions[edge]!)
      open.push(regions[edge + 1]!)
    }
    flushRoad()
  }
  return strokes
}

export function buildTransportRoutesSource(
  reader: WorldMapReader,
  cacheKey: string,
  derivedRivers?: readonly DerivedRiverFeature[],
): GeoJsonSource<GeoJsonLineStringGeometry> | SourceUnavailable {
  if (!reader.capabilities.hasCivilization) {
    return unavailableSource('transport-routes', reader, cacheKey, 'Civilization data is unavailable in this world snapshot')
  }

  const { mesh, identity } = reader
  const routes = reader.transportRoutes()
  const centerOut = { x: 0, y: 0, z: 0 }
  const features: GeoJsonFeature<GeoJsonLineStringGeometry>[] = []
  const claimedSteps = new Set<string>()
  const placements = displayedRiverPlacements(derivedRivers ?? buildHydrographyRivers(reader))

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i]
    const regions: number[] = []
    reader.forEachTransportRouteRegion(i, region => regions.push(region))
    const runs = unclaimedRouteRuns(regions, route.mode, claimedSteps)
    const strokes: RouteStroke[] = []
    for (const run of runs) {
      if (route.mode === 'river')
        strokes.push(...riverStrokesForRun(run, placements, claimedSteps, mesh, centerOut))
      else
        strokes.push({ mode: route.mode, coordinates: smoothTransportRoute(regionCenterLine(mesh, run, centerOut)) })
    }
    const visible = strokes.filter(stroke => stroke.coordinates.length >= 2)
    for (let part = 0; part < visible.length; part++) {
      const stroke = visible[part]!
      features.push({
        type: 'Feature',
        id: visible.length === 1 ? route.id : `${route.id}#${part}`,
        geometry: {
          type: 'LineString',
          coordinates: stroke.coordinates,
        },
        properties: {
          id: route.id,
          entityId: route.id,
          mode: stroke.mode,
          fromNodeId: route.fromNodeId,
          toNodeId: route.toNodeId,
          cost: route.cost,
          trafficScore: route.trafficScore,
        },
      })
    }
  }

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'transport-routes',
    snapshotId: identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS['transport-routes'].adapterVersion,
    cacheKey,
    geometryKind: 'line' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}

function settlementSymbolShape(tier: string | undefined): 'star' | 'double-ring' | 'circle' {
  if (tier === 'capital')
    return 'star'
  if (tier === 'city')
    return 'double-ring'
  return 'circle'
}

export function buildSettlementsSource(
  reader: WorldMapReader,
  cacheKey: string,
): GeoJsonSource<GeoJsonPointGeometry> | SourceUnavailable {
  if (!reader.capabilities.hasCivilization) {
    return unavailableSource('settlements', reader, cacheKey, 'Civilization data is unavailable in this world snapshot')
  }

  const { mesh, identity } = reader
  const settlements = reader.settlements()
  const centerOut = { x: 0, y: 0, z: 0 }
  const features: GeoJsonFeature<GeoJsonPointGeometry>[] = settlements.map((s) => {
    mesh.getRegionCenter(s.regionId, centerOut)
    const coords = cartesianToLonLatDeg(centerOut.x, centerOut.y, centerOut.z)
    const tier = s.tier ?? 'town'
    return {
      type: 'Feature',
      id: s.id,
      geometry: {
        type: 'Point',
        coordinates: coords,
      },
      properties: {
        id: s.id,
        entityId: s.id,
        name: s.name,
        tier,
        isPort: Boolean(s.isPort),
        population: s.population,
        polityId: s.polityId,
        cultureId: s.cultureId,
        regionId: s.regionId,
        symbolShape: settlementSymbolShape(tier),
      },
    }
  })

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'settlements',
    snapshotId: identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS.settlements.adapterVersion,
    cacheKey,
    geometryKind: 'point' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}

export function buildPolityLabelsSource(
  reader: WorldMapReader,
  cacheKey: string,
): GeoJsonSource<GeoJsonPointGeometry> | SourceUnavailable {
  if (!reader.capabilities.hasCivilization) {
    return unavailableSource('polity-labels', reader, cacheKey, 'Civilization data is unavailable in this world snapshot')
  }

  const { mesh, identity } = reader
  const polities = reader.polities()
  const polityField = reader.field('dominantPolityIndex')
  const landMask = reader.field('landMask')
  const membersByPolity: number[][] = Array.from({ length: polities.length }, () => [])
  const areaByPolity = new Float64Array(polities.length)

  for (let r = 0; r < mesh.regionCount; r++) {
    if (landMask.get(r) === 0)
      continue
    const idx = Math.floor(polityField.get(r))
    if (idx >= 0 && idx < polities.length) {
      membersByPolity[idx].push(r)
      areaByPolity[idx] += mesh.getRegionAreaKm2(r)
    }
  }

  const features: GeoJsonFeature<GeoJsonPointGeometry>[] = []
  const spines = new Map<string, TerritorySpineMetadata>()

  for (let i = 0; i < polities.length; i++) {
    const polity = polities[i]
    const members = membersByPolity[i]
    if (!polity.name || members.length === 0)
      continue
    const areaKm2 = areaByPolity[i]
    const spine = computeTerritorySpine(mesh, {
      featureId: polity.id,
      displayName: polity.name,
      kind: 'polity',
      areaKm2,
      memberRegions: members,
    })
    spines.set(polity.id, spine)
    features.push({
      type: 'Feature',
      id: polity.id,
      geometry: {
        type: 'Point',
        coordinates: spine.anchorCoordinates,
      },
      properties: {
        id: polity.id,
        entityId: polity.id,
        kind: 'polity',
        name: polity.name,
        displayName: polity.name,
        areaKm2,
        priority: areaKm2 + (polity.sizeClass === 'empire' ? 1e8 : polity.sizeClass === 'kingdom' ? 5e7 : 0),
        elongation: spine.elongation,
        curved: spine.isCurved,
      },
    })
  }

  features.sort((a, b) => Number(b.properties.priority) - Number(a.properties.priority))

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'polity-labels',
    snapshotId: identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS['polity-labels'].adapterVersion,
    cacheKey,
    geometryKind: 'point' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
    spines,
  })
}

export function buildSettlementLabelsSource(
  reader: WorldMapReader,
  cacheKey: string,
): GeoJsonSource<GeoJsonPointGeometry> | SourceUnavailable {
  if (!reader.capabilities.hasCivilization) {
    return unavailableSource('settlement-labels', reader, cacheKey, 'Civilization data is unavailable in this world snapshot')
  }

  const { mesh, identity } = reader
  const settlements = reader.settlements()
  const centerOut = { x: 0, y: 0, z: 0 }
  const features: GeoJsonFeature<GeoJsonPointGeometry>[] = settlements.map((s) => {
    mesh.getRegionCenter(s.regionId, centerOut)
    const coords = cartesianToLonLatDeg(centerOut.x, centerOut.y, centerOut.z)
    const tier = s.tier ?? 'town'
    const tierBoost = tier === 'capital' ? 1e9 : tier === 'city' ? 5e8 : tier === 'town' ? 1e8 : 0
    const priority = tierBoost + s.population
    return {
      type: 'Feature',
      id: `settlement-label:${s.id}`,
      geometry: {
        type: 'Point',
        coordinates: coords,
      },
      properties: {
        id: `settlement-label:${s.id}`,
        entityId: s.id,
        kind: 'settlement',
        name: s.name,
        displayName: s.name,
        tier,
        isPort: Boolean(s.isPort),
        population: s.population,
        priority,
        curved: false,
      },
    }
  })

  features.sort((a, b) => Number(b.properties.priority) - Number(a.properties.priority))

  return Object.freeze({
    unavailable: false as const,
    kind: 'geojson' as const,
    sourceId: 'settlement-labels',
    snapshotId: identity.snapshotId,
    adapterVersion: BUILTIN_MAP_SOURCE_SCHEMAS['settlement-labels'].adapterVersion,
    cacheKey,
    geometryKind: 'point' as const,
    data: Object.freeze({
      type: 'FeatureCollection' as const,
      features: Object.freeze(features),
    }),
  })
}
