import type { MapStyleLayer, MapStyleView } from '@/core/rendering/styles/style-spec'
import { hasGeoJsonSource } from '@/core/data-source/geojson-source-runtime'
import { getMapStyleSource } from '@/core/data-source/source-registry'
import { getMapStyleDocument } from '@/core/rendering/styles/style-runtime'

export function getSymbolStyleLayerEntries(
  styleId: string | undefined,
  view: MapStyleView,
  overlays: Record<string, boolean>,
): Array<{ layer: MapStyleLayer, order: number }> {
  const entries: Array<{ layer: MapStyleLayer, order: number }> = []
  const style = getMapStyleDocument(styleId)
  style.layers.forEach((layer, order) => {
    const source = getMapStyleSource(layer.source, style.sources)
    if (layer.renderer !== 'symbol' || source?.kind !== 'geojson' || !hasGeoJsonSource(layer.source))
      return
    if (layer.views && !layer.views.includes(view))
      return
    if (source.overlay && !overlays[source.overlay])
      return
    entries.push({ layer, order })
  })
  return entries
}
