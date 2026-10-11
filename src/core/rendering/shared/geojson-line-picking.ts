import type { Camera, Vector3 } from 'three'
import type { GeoJsonFeatureCollection, GeoJsonPosition } from '@/core/data-source/geojson'

/** Screen-space hit testing for width-aware GeoJSON lines that use ribbon geometry. */
export function pickGeoJsonLineFeature(
  source: GeoJsonFeatureCollection,
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: Camera,
  project: (position: GeoJsonPosition) => Vector3[],
  isHidden: (position: Vector3) => boolean = () => false,
): string | number | null {
  const rect = canvas.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  let nearest = 36
  let chosen: string | number | null = null
  for (const feature of source.features) {
    const lines = feature.geometry.type === 'LineString'
      ? [feature.geometry.coordinates]
      : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : []
    for (const line of lines) {
      for (let index = 1; index < line.length; index++) {
        const starts = project(line[index - 1])
        const ends = project(line[index])
        for (let copy = 0; copy < Math.min(starts.length, ends.length); copy++) {
          const a = starts[copy]
          const b = ends[copy]
          if (isHidden(a) && isHidden(b))
            continue
          a.project(camera)
          b.project(camera)
          if ((a.z < -1 && b.z < -1) || (a.z > 1 && b.z > 1))
            continue
          const ax = (a.x + 1) * rect.width / 2
          const ay = (1 - a.y) * rect.height / 2
          const bx = (b.x + 1) * rect.width / 2
          const by = (1 - b.y) * rect.height / 2
          const dx = bx - ax
          const dy = by - ay
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / Math.max(dx * dx + dy * dy, 1e-9)))
          const distance = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2
          if (distance < nearest) {
            nearest = distance
            chosen = feature.id
          }
        }
      }
    }
  }
  return chosen
}
