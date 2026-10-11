export type GeoJsonPosition = [longitude: number, latitude: number] | [longitude: number, latitude: number, altitude: number]

export type GeoJsonGeometry
  = | { type: 'Point', coordinates: GeoJsonPosition }
    | { type: 'MultiPoint', coordinates: GeoJsonPosition[] }
    | { type: 'LineString', coordinates: GeoJsonPosition[] }
    | { type: 'MultiLineString', coordinates: GeoJsonPosition[][] }
    | { type: 'Polygon', coordinates: GeoJsonPosition[][] }
    | { type: 'MultiPolygon', coordinates: GeoJsonPosition[][][] }

export interface GeoJsonFeature {
  type: 'Feature'
  id: string | number
  geometry: GeoJsonGeometry
  properties: Record<string, unknown>
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

export interface GeoJsonFeatureHit {
  layerId: string
  sourceId: string
  featureId: string | number
}

export type GeoJsonGeometryKind = 'point' | 'line' | 'polygon'

export function geoJsonGeometryKind(geometry: GeoJsonGeometry): GeoJsonGeometryKind {
  switch (geometry.type) {
    case 'Point':
    case 'MultiPoint':
      return 'point'
    case 'LineString':
    case 'MultiLineString':
      return 'line'
    default:
      return 'polygon'
  }
}

export function validateGeoJson(collection: unknown): string[] {
  const errors: string[] = []
  if (!collection || typeof collection !== 'object' || !('type' in collection) || collection.type !== 'FeatureCollection'
    || !('features' in collection) || !Array.isArray(collection.features)) {
    return ['Expected a GeoJSON FeatureCollection']
  }

  const seen = new Set<string | number>()
  const jsonValue = (value: unknown, ancestors = new Set<object>()): boolean => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
      return true
    if (typeof value === 'number')
      return Number.isFinite(value)
    if (typeof value !== 'object' || ancestors.has(value))
      return false
    const next = new Set(ancestors).add(value)
    if (Array.isArray(value))
      return value.every(item => jsonValue(item, next))
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      return false
    return Object.values(value).every(item => jsonValue(item, next))
  }
  const validPosition = (value: unknown): value is GeoJsonPosition => Array.isArray(value)
    && (value.length === 2 || value.length === 3)
    && value.every(item => typeof item === 'number' && Number.isFinite(item))
    && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90
  const validLine = (value: unknown): value is GeoJsonPosition[] => Array.isArray(value)
    && value.length >= 2 && value.every(validPosition)
  const validRing = (value: unknown): value is GeoJsonPosition[] => Array.isArray(value)
    && value.length >= 4 && value.every(validPosition)
    && value[0][0] === value.at(-1)?.[0] && value[0][1] === value.at(-1)?.[1]
  const unwrap = (ring: GeoJsonPosition[]): Array<[number, number]> => {
    const result: Array<[number, number]> = []
    let previous = ring[0][0]
    for (const point of ring) {
      let longitude = point[0]
      while (longitude - previous > 180)
        longitude -= 360
      while (longitude - previous < -180)
        longitude += 360
      result.push([longitude, point[1]])
      previous = longitude
    }
    return result
  }
  const ringArea = (ring: GeoJsonPosition[]): number => {
    const points = unwrap(ring)
    let area = 0
    for (let index = 1; index < points.length; index++)
      area += points[index - 1][0] * points[index][1] - points[index][0] * points[index - 1][1]
    return area * 0.5
  }
  const ringContains = (ring: GeoJsonPosition[], position: GeoJsonPosition): boolean => {
    const points = unwrap(ring)
    let inside = false
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]
      const b = points[index]
      const longitude = position[0] + 360 * Math.round((a[0] - position[0]) / 360)
      if ((a[1] > position[1]) !== (b[1] > position[1])
        && longitude < (b[0] - a[0]) * (position[1] - a[1]) / (b[1] - a[1]) + a[0]) {
        inside = !inside
      }
    }
    return inside
  }
  const validPolygon = (value: unknown): value is GeoJsonPosition[][] => {
    if (!Array.isArray(value) || value.length === 0 || !value.every(validRing))
      return false
    const rings = value as GeoJsonPosition[][]
    return rings.every(ring => Math.abs(ringArea(ring)) > 1e-10)
      && rings.slice(1).every(hole => ringContains(rings[0], hole[0]))
  }

  for (const [index, feature] of collection.features.entries()) {
    const prefix = `Feature ${index}`
    if (!feature || typeof feature !== 'object' || feature.type !== 'Feature') {
      errors.push(`${prefix} is not a Feature`)
      continue
    }
    if ((typeof feature.id !== 'string' && typeof feature.id !== 'number')
      || (typeof feature.id === 'number' && !Number.isFinite(feature.id)) || seen.has(feature.id)) {
      errors.push(`${prefix} requires a unique string or number id`)
    }
    else {
      seen.add(feature.id)
    }
    if (!feature.properties || typeof feature.properties !== 'object' || Array.isArray(feature.properties) || !jsonValue(feature.properties))
      errors.push(`${prefix} requires JSON-serializable object properties`)
    const geometry = feature.geometry
    if (!geometry || typeof geometry !== 'object') {
      errors.push(`${prefix} requires geometry`)
      continue
    }
    const coordinates = geometry.coordinates
    const valid = geometry.type === 'Point'
      ? validPosition(coordinates)
      : geometry.type === 'MultiPoint'
        ? Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(validPosition)
        : geometry.type === 'LineString'
          ? validLine(coordinates)
          : geometry.type === 'MultiLineString'
            ? Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(validLine)
            : geometry.type === 'Polygon'
              ? validPolygon(coordinates)
              : geometry.type === 'MultiPolygon'
                ? Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(validPolygon)
                : false
    if (!valid)
      errors.push(`${prefix} has invalid ${String(geometry.type)} coordinates`)
  }
  return errors
}
