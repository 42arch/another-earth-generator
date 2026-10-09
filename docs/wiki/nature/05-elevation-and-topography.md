# 05 · Elevation and Topography

[English](./05-elevation-and-topography.md) | [简体中文](./05-elevation-and-topography.zh-CN.md)

## Intuitive Understanding

Plate boundaries only give the "position and direction" of mountains, trenches, and rift valleys; the elevation stage also needs to determine how wide and high they are, and how stable continents connect with deep ocean basins. Terrain post-processing then adds ridge textures, coastal bending, glaciers, and erosion to form a renderable continuous surface.

## Tectonic Skeleton

The [TectonicElevationGenerator](../../../src/core/geology/tectonic-elevation-generator.ts) combines candidate land/sea, plate stress, and multiple spherical distance fields to construct continental basements, shelves, slopes, ocean basins, orogens, mid-ocean ridges, and trenches. The subducting side causes asymmetrical topography across boundaries; local landforms like island arcs and hotspots are superimposed on the same elevation field. The [TerrainClassifier](../../../src/core/geology/terrain-classifier.ts) uses overlapping weights to describe cratons, basins, fold belts, and plateaus, without forcing each piece of land into a single category.

Directional Phasor ridges extend elongated ridges along convergence zones; mantle dynamic topography provides a broader background of upwelling and subsidence. These are all contributions to generating elevation, not independent surface heights. Specific weights are saved in the [Phasor Source Code](../../../src/core/geology/phasor-ridge-generator.ts) and [Mantle Source Code](../../../src/core/geology/mantle-dynamic-topography.ts).

## Post-Processing Sequence

The [TerrainPostProcessor](../../../src/core/geography/terrain-post-processor.ts) currently proceeds in this order:

1. Superimpose terrain textures and mantle dynamic topography, perform elevation curve reshaping.
2. Warp sampling locations on the sphere to bend coasts and mountain belts; the ocean mask is established at zero elevation at this point.
3. Perform edge-preserving smoothing and add two layers of smaller-scale details.
4. Run glacial, topography-driven hydraulic and thermal erosion, then sharpen ridges and execute soil creep.
5. Convert to physical elevation with mean sea level at `0 km`, and output the final `landMask`.

The hydraulic erosion here is run by the [Terrain Erosion Processor](../../../src/core/geography/terrain-erosion-processor.ts) **before the climate stage**, using topography and simplified flow accumulation. It is not a monthly precipitation-driven sediment conservation simulation; the current code also has no feedback loop to recalculate climate after erosion. The terrain erosion diagnostic `terrainErosion` and the final climate-driven `hydrology` river networks should be understood separately.

The terrain processor uses Priority-Flood during the erosion stage to find drainage paths and reshape valleys, so some operations here do modify the topography. The **final hydrological depression filling** in Chapter 08 only modifies a drainage copy. These two have similar uses but act at different times and differ in whether they modify the true elevation.

| Diagnostic Field | Meaning |
| --- | --- |
| `terrainTexture` | Elevation contributions from Phasor ridges, tectonic belt textures, coastal details, etc. |
| `terrainFinalization` | Increments from elevation curve reshaping and post-processing |
| `terrainErosion.glacialIndex` | Glacial impact index in the terrain stage |
| `terrainErosion.erosionDelta` / `depositionDelta` | Elevation changes from terrain erosion and deposition |
| `terrainErosion.flowAccumulation` | Topography-driven upstream cell flow accumulation diagnosis |

## Elevation, Land/Sea, and Display

The topography calculation internally uses calibrated morphological coordinates. Externally, `geography.elevation`, `baseElevation`, and terrain increments use **km**. [Unit Conversions](../../../src/core/geography/elevation-units.ts) centrally handles these calculations. The 3D globe can apply visual exaggeration to the elevation; this only affects geometric display and does not write back to the physical elevation.

For example, land elevation with internal non-negative morphological coordinate `t ≤ 1` is converted to `h = 6t⁴(5 − 4t)` km; underwater morphological coordinates are converted at 8 km per unit. The formula is an elevation mapping for this project, not a physical law of mountain formation. The outgoing hydrology stage reads the converted km elevation, not the internal `t`.

`roughness` controls texture intensity, `terrainWarp` controls spatial warping, `smoothing` controls smoothing, and `glacialErosion`, `hydraulicErosion`, and `ridgeSharpening` adjust corresponding post-processing. Parameters interact, so adjusting one parameter individually may not solely change one landscape.
