import type { MapStyleLayer, MapStyleView } from '@/core/rendering/styles/style-spec'
import { hasGeoJsonSource } from '@/core/data-source/geojson-source-runtime'
import { getMapStyleSource } from '@/core/data-source/source-registry'
import { getMapStyleDocument } from '@/core/rendering/styles/style-runtime'

/** Segmented lines use shared rendering; width-aware rivers use their ribbon renderer. */
export function getSegmentLineStyleLayerEntries(
  styleId: string | undefined,
  view: MapStyleView,
  overlays: Record<string, boolean>,
): Array<{ layer: MapStyleLayer, order: number }> {
  const entries: Array<{ layer: MapStyleLayer, order: number }> = []
  const style = getMapStyleDocument(styleId)
  style.layers.forEach((layer, order) => {
    const source = getMapStyleSource(layer.source, style.sources)
    if (layer.renderer !== 'line' || (layer.id === 'rivers' && layer.source === 'river-network') || source?.kind !== 'geojson' || (source.geometry !== 'line' && source.geometry !== 'polygon')
      || !hasGeoJsonSource(layer.source)) {
      return
    }
    if (layer.views && !layer.views.includes(view))
      return
    if (source.overlay && !overlays[source.overlay])
      return
    entries.push({ layer, order })
  })
  return entries
}

export function haveSegmentLineStyleOverlayChanges(
  styleId: string | undefined,
  previous: Record<string, boolean>,
  next: Record<string, boolean>,
): boolean {
  const style = getMapStyleDocument(styleId)
  return style.layers.some((layer) => {
    if (layer.renderer !== 'line' || !hasGeoJsonSource(layer.source))
      return false
    const overlay = getMapStyleSource(layer.source, style.sources)?.overlay
    return overlay !== undefined && previous[overlay] !== next[overlay]
  })
}
