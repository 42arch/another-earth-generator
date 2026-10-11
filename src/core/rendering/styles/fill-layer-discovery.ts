import type { MapStyleLayer, MapStyleView } from '@/core/rendering/styles/style-spec'
import { hasGeoJsonSource } from '@/core/data-source/geojson-source-runtime'
import { getMapStyleSource } from '@/core/data-source/source-registry'
import { getMapStyleDocument } from '@/core/rendering/styles/style-runtime'

export function getFillStyleLayerEntries(
  styleId: string | undefined,
  view: MapStyleView,
  baseMap: string,
  overlays: Record<string, boolean>,
): Array<{ layer: MapStyleLayer, order: number }> {
  const style = getMapStyleDocument(styleId)
  const entries: Array<{ layer: MapStyleLayer, order: number }> = []
  style.layers.forEach((layer, order) => {
    const source = getMapStyleSource(layer.source, style.sources)
    if (layer.renderer !== 'fill' || source?.kind !== 'geojson' || source.geometry !== 'polygon'
      || !hasGeoJsonSource(layer.source)) {
      return
    }
    if (layer.views && !layer.views.includes(view))
      return
    if (layer.baseMaps && !layer.baseMaps.includes(baseMap))
      return
    if (source.overlay && !overlays[source.overlay])
      return
    entries.push({ layer, order })
  })
  return entries
}
