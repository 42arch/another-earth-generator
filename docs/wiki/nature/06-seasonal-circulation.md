# 06 · Seasonal Winds and Surface Currents

[English](./06-seasonal-circulation.md) | [简体中文](./06-seasonal-circulation.zh-CN.md)

## Intuitive Understanding

The position of direct sunlight moves north and south with the seasons, and land warming and cooling change nearby pressure and wind. Wind carries moisture to land and also pushes surface seawater. The arrows in the interface can be used to observe relative flow directions; they are not in-situ measured wind speeds or ocean current velocities.

## Four Seasonal Anchors

The [SeasonalCirculationStage](../../../src/core/simulation/pipeline/stages/seasonal-circulation-stage.ts) builds a climate calculation surface from final elevation and land/sea. When the output mesh is finer than the reference mesh, it first aggregates to the reference mesh by area; in this way, the computational load for seasonal circulation does not grow proportionally with the highest display precision.

The [Seasonal Wind Generator](../../../src/core/climate/seasonal-wind-generator.ts) separately calculates four sets of fields near the spring equinox, summer solstice, autumn equinox, and winter solstice: solar declination, longitudinal Intertropical Convergence Zone (ITCZ) latitude, pressure, east/north wind components, and an east-coast monsoon term. The ITCZ is a tropical zonal region where trade winds from both hemispheres converge and convective rainfall easily occurs. The model uses latitude bands, land-sea thermal differences, topography, and pressure gradients to build approximate wind fields; `pressureHpa` is a model pressure field, not numerical weather prediction.

Each season saves `windEast` and `windNorth`, the eastward and northward components, in the local tangent plane on the sphere. When displayed, these are combined into arrows; the monthly precipitation model also uses them to determine from which neighbor moisture arrives, and whether airflow is rising or falling along slopes. The spring equinox is the 0th anchor, and the four sets of arrays are indexed by `season * regionCount + region`; ITCZ latitude is saved in 72 longitude bins.

The monthly stage interpolates wind, pressure, and ocean current forcing between adjacent seasonal anchors using mid-month dates in a non-leap year. Monthly temperature and precipitation are still computed month-by-month; it does not simply interpolate four precipitation maps into twelve. See [monthly-forcing.ts](../../../src/core/climate/monthly-forcing.ts) for interpolation methods.

## Surface Ocean Currents and Cold/Warm Indicators

The [SeasonalOceanGenerator](../../../src/core/climate/seasonal-ocean-generator.ts) first finds the influence ranges of east and west coasts within the ocean domain formed by the final land/sea, then combines latitudinal band flow directions, wind fields, and coastal boundary effects into `oceanEast`, `oceanNorth`. An approximate rule for circumpolar flow is also applied to continuous oceanic passages around 60° latitude. Finally, the fields are smoothed only within the ocean mask.

Coastal classification establishes seeds based on the east/west direction of land adjacent to ocean cells, then propagates coastal distance along the **ocean adjacency graph**. Latitude bands determine the mainstream directions of the equator, trade winds, mid-latitude westerlies, and high latitudes; when approaching east/west coasts, the north/south components are modified to form the visual structure of boundary currents. Circumpolar passages are approximately judged by whether high-latitude longitude bins all have ocean cells. This is an explicit rule combination, not a stream function integrated from wind stress curl.

`oceanWarmth` is a **relative cold/warm proxy from -1 to 1**: it provides a warm/cold boundary current tendency based on latitudinal bands and coastal positions, participating in temperature and ocean moisture supply calculations. It is not sea surface temperature in °C, nor does it represent how much heat seawater actually carries. The current implementation lacks volume fluxes across shared edges, mass-conserving transport across basins, explicit upwelling, or sea ice evolution; these phenomena cannot be quantitatively derived from this field.

## How to Read the Ocean Current Layer

Ocean current arrows represent the modeled surface flow direction, brightness represents relative strength, and arrow color corresponds to the cold/warm indicator. Land has no ocean current values. Vectors in high-detail worlds are mapped to the output mesh for display; arrow length and color are used to compare spatial differences within the same world and cannot be directly converted to m/s or °C.
