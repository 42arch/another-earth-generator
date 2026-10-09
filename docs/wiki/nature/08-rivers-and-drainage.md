# 08 · Runoff, Drainage, and River Networks

[English](./08-rivers-and-drainage.md) | [简体中文](./08-rivers-and-drainage.zh-CN.md)

## Intuitive Understanding

After rain falls on a region, part of it is offset by evaporation demand, and the rest flows downstream along the terrain. The more upstream neighbors and the more abundant the precipitation, the larger the downstream flow usually is. The generator selects river segments based on this and draws blue rivers on the sphere and map that widen with accumulated flow.

## Annual Effective Runoff

The [SurfaceHydrologyStage](../../../src/core/simulation/pipeline/stages/surface-hydrology-stage.ts) reads temperature and precipitation month by month on the **final output mesh**. Land regions first use temperature and days of the month to estimate potential evaporation demand, then take `max(0, monthly precipitation - evaporation demand)`; the sum over twelve months yields annual effective runoff in **mm/year**. This approximation has no soil water storage, groundwater, or cross-month snowmelt.

The current temperature-driven monthly evaporation demand is `days × 0.015 × max(0, T + 5)^1.45` mm, where `T` is the monthly average temperature in °C and `days` is the number of days in that month. This empirical formula is used for internal water allocation within the generator, not as a universal measured evaporation formula. Land effective runoff is the sum of twelve months of non-negative surplus; ocean cells do not produce land runoff.

## Building the Directed Drainage Graph

The [SurfaceHydrologyGenerator](../../../src/core/hydrology/surface-hydrology-generator.ts) first copies the true elevation, then uses Priority-Flood depression filling inward from coastal land regions. The filled `drainageElevation` is only used to find paths to the ocean, **it does not raise the true terrain, nor does it generate lake surfaces**. Complete land components without a coastal outlet use the lowest point as a closed sink.

For each land region, the code prioritizes the lower land neighbor with the steepest downhill slope on the filled surface; if there is no such neighbor but it borders the ocean, it directly enters the sea; the remaining flat areas drain along the parent nodes recorded during the depression filling process. `downstream` stores the downstream index; oceans and closed sinks are `-1`. `topologicalOrder` is the order from upstream to downstream, used to safely accumulate flow.

Slope comparison uses `filled elevation difference / spherical edge length`, so long and short edges are not treated as equally steep just because the elevation difference is the same. Priority-Flood propagates inward from the coast with a coastal outlet and breaks ties in flat areas using very small positive increments; parent nodes are still retained as fallbacks when selecting flow directions. After processing, a topological sort is performed by land in-degree; if a cycle exists in the drainage graph, the generator throws an error rather than quietly outputting incorrect rivers.

## Flow Accumulation and River Formation

Initial flow accumulation equals "annual effective runoff × unit sphere region area", then accumulates downstream in topological order:

```text
F(i) = max(0, runoff(i)) × area(i) + Σ F(upstream neighbors)
```

`flowAccumulation` retains this compatible value weighted by unit sphere area; `discharge` then converts it to **m³/s** using fixed physical radius and seconds/year. The threshold is jointly determined by total global land flow accumulation, the maximum value, and a minimum floor. Only land cells reaching the threshold and possessing a downstream neighbor enter the `riverMask`; isolated single-cell river segments are filtered. `riverOrder` grades based on tributary confluence relationships, capped at 15.

The current conversion constant comes from [hydrology-units.ts](../../../src/core/hydrology/hydrology-units.ts):

```text
discharge = flowAccumulation × (6,371,000 m)² / (1000 mm/m × 365 × 86,400 s)
```

The generator calculates the river threshold as `min(0.4 × max cell accumulation, max(0.02, 0.00008 × global sum of land accumulation))`. The global sum here repeatedly counts water passed downstream along channels, so the threshold is a **visual density parameter**, not a physical constant interpretable as global runoff yield. River order uses a Strahler-style approach: when tributaries of the same order meet, the downstream order increases by one.

This is an **annual average** river network. Month switching does not change river masks or widths. The model has not yet solved for flow-through lakes or seasonal drying. The `terrainErosion.flowAccumulation` from the terrain stage is a topography diagnostic produced before climate calculations and cannot be mixed with the final `hydrology.flowAccumulation`.

## How Rivers are Drawn

[RiverGeometry](../../../src/core/rendering/shared/river-geometry.ts) connects river segments into paths along downstream relationships, adjusts width by the square root of local flow accumulation, and then samples and smooths the spherical paths. The segments entering the sea fall near the shared land-sea boundary. The 3D globe uses ribbon geometry, while the 2D map projects the same path and clips at seams; display geometry does not participate in hydrological calculations.
