# 10 · Rendering and Visualization

[English](./10-rendering-and-visualization.md) | [简体中文](./10-rendering-and-visualization.zh-CN.md)

## Intuitive Understanding

What you see in the 3D globe and 2D map is the **same world**. Changing views, layers, or months just picks values from existing arrays and recolors them; plates, land/sea, and rivers are not regenerated due to map projection.

## Two Views

The [WorldEngine](../../src/core/world/world-engine.ts) holds the generation results and coordinates the display. [RendererCore](../../src/core/world/renderer-core.ts) manages the globe and map views. [WorldColorizer](../../src/core/rendering/shared/world-colorizer.ts) maps fields of each spherical region to colors; both views reuse the same semantics.

The 3D globe forms a spherical triangle mesh from Voronoi regions, supporting visual elevation displacement, lighting, clouds, atmosphere, graticules, and river overlays. The 2D map projects the same regions onto a plane, offering Mercator and Equal Earth projections; geometry is clipped at seams and projection boundaries. Cyclical projections can show adjacent copies on the left and right. See [Globe Renderer](../../src/core/rendering/globe/renderer.ts), [Map View](../../src/core/rendering/map/view.ts), and [Projection Definitions](../../src/core/projections/d3-map-projection.ts) for related code.

3D elevation displacement is a visual exaggeration and does not change the physical km value of `geography.elevation`. 2D maps have no 3D height displacement.

### Geometry and Projection Details

The globe surface splits each Voronoi polygon from the center to the corners into triangles; vertices carry color and normal, and triangles correspond to region indices for picking. The map uses the same batch of spherical polygons but first unfolds longitude around the current central meridian, then clips at projection seams and latitude ranges. Mercator can loop horizontally; the Equal Earth projection retains the complete spherical outline and rejects clicks outside the outline during inverse projection.

The globe's [surface-geometry.ts](../../src/core/rendering/globe/surface-geometry.ts) and the map's [surface-geometry.ts](../../src/core/rendering/map/surface-geometry.ts) build geometry separately; region colors still come from the same coloring logic. Thus, the projection geometry can change while plate, elevation, and classification data do not.

## Currently Available Layers in the UI

The layer bar relies on [LayerBar.svelte](../../src/ui/hud/LayerBar.svelte), currently featuring:

| Layer | Data Read |
| --- | --- |
| Satellite, Topographic, Elevation | Final land/sea, elevation, climate, and ecological coloring |
| Plate Tectonics | Sub-plate index |
| Geometry Convergence | Upstream cell flow accumulation diagnostic from terrain stage |
| Monthly Temp, Monthly Precip | Output climate fields for the current month |
| Prevailing Winds, Ocean Currents | Relative vector fields for the current month; ocean current arrow color also denotes cold/warm proxy |
| Climate Class., Biomes | Köppen and ecological categories for final output regions |

"Geometry Convergence" is used to view topographic basin shapes, not annual flow in m³/s. Some tectonic and terrain diagnostic modes are still kept in the coloring code, but they are commented out in the layer bar and cannot be selected directly in the normal UI. Rivers and clouds are independent display toggles; rivers read the final annual hydrology results.

## Picking and Region Inspection

The 3D view picks surface triangles via a ray from the mouse position; the 2D view performs an inverse projection first, then locates the spherical region. The region inspector shows existing fields like lat/lon, elevation, plate, 12-month temp/precip, annual summary, Köppen category, and biome. The month selector affects monthly temp/precip and vector layers without recalculating the whole planet. See [RegionInspector.svelte](../../src/ui/hud/RegionInspector.svelte) for specific interactions.

When switching months, the main thread fetches the corresponding month from generation results and updates the colors or vector overlays; when switching globe/map, both views build their display geometry independently but share the world state. River ribbons, clouds, and graticules can be overlaid on different background colors. Because the river network is only generated at the annual scale, rivers on monthly precipitation maps are still the same annual river network.

Display color scales and arrow sizes are just encoding methods. To compare values, prioritize the region inspector and field units, and especially do not treat relative ocean current strength as m/s or the cold/warm indicator as °C.
