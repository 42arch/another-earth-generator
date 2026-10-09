# 07 · Monthly Climate and Köppen Classification

[English](./07-atmosphere-and-climate.md) | [简体中文](./07-atmosphere-and-climate.zh-CN.md)

## Intuitive Understanding

The climate stage generates 12 months of average temperature and monthly precipitation for each region over a full year. It places latitude and season, land/sea differences, elevation, wind, moisture sources, and windward/leeward mountain aspects into the same simplified model. Colder alpine areas or arid inland regions are the result of the combined effect of these factors.

## Twelve Monthly Solves

The [MonthlyClimateStage](../../../src/core/simulation/pipeline/stages/monthly-climate-stage.ts) uses the four seasonal anchors to compute temperature and precipitation independently for each month. Each month first estimates temperature, then calculates precipitation, alternates correcting temperature and precipitation, and finally saves `temperatureC` and `precipitationMm`. Arrays are arranged by `month * regionCount + region`; precipitation units are **total mm for that calendar month**, not mm/year.

The [Monthly Temperature Model](../../../src/core/climate/monthly-temperature-generator.ts) uses latitude as a baseline, adjusted by solar season, land continentality, lapse rate, coastal cold/warm indicators, and cloud cover. Ocean cell temperatures are also model calculation results and should not be equated with measured sea surface temperatures. `temperatureOffsetC` adds a uniform offset to all months.

The [Monthly Precipitation Model](../../../src/core/climate/monthly-precipitation-generator.ts) propagates moisture supply from oceans and land for a finite number of hops along wind directions, then combines ITCZ, fronts, airflow convergence, subtropical highs, monsoons, and topography aspect to form precipitation. Windward uplift usually increases rain, and leeward descent usually reduces rain. `precipitationScale` adjusts the final daily precipitation rate. There is no explicit soil water storage, cloud microphysics, or globally strictly closed moisture conservation equations here.

The key step for monthly precipitation is to first calculate the contribution of upwind neighbors to the local cell, then retain a portion of the moisture based on topographic uplift and propagation loss. Ocean cells provide local moisture sources varying by temperature and cold/warm indicators; land cells also have simplified evapotranspiration supply, but no cross-month inventory. Finally, the modeled daily precipitation rate is converted to mm/month according to the days in that month. The precipitation difference on both sides of a mountain comes from the combined effects of wind direction, slope, and moisture decay, rather than a pre-painted "rain shadow mask".

## Climate Precision and Projection

When the output mesh is not larger than the reference mesh, climate is computed directly on the output mesh. When finer, monthly fields are generated on the reference mesh and projected to final regions by the [ClimateOutputStage](../../../src/core/simulation/pipeline/stages/climate-output-stage.ts); the projection considers final land/sea and elevation, recording correction factors for monthly precipitation. Full output monthly arrays can be saved when output regions do not exceed 250,000; when higher, they are sampled on demand. Thus, high-resolution images do not mean wind and precipitation are independently re-solved on each display cell.

Projection saves three nearby reference cells and their weights for each output cell. Land temperature is corrected based on the elevation difference between the fine and coarse meshes; precipitation is redistributed according to the difference in fine mesh windward slope relative to the coarse mesh. Subsequently, area-weighted global and land correction factors ensure the projection does not systematically increase or decrease the month's rainfall merely due to resampling. Corrections are numerical projection constraints, not true water mass closure.

## Köppen Climate Classification

The [KoppenClimateStage](../../../src/core/simulation/pipeline/stages/koppen-climate-stage.ts) reads the 12-month temperature and precipitation of final output regions. The classifier first determines Arid **B**, then Polar **E**, Tropical **A**, and distinguishes Temperate **C** from Continental **D** for the rest; subsequent letters describe seasonal moisture and summer heat. Annual average temperature is weighted by days per month, and annual precipitation is the 12-month sum. Oceans have an independent `Ocean` code.

Aridity thresholds depend on annual average temperature and the warm-half-year precipitation fraction; if annual rainfall is below half the threshold, it is classed as Desert `BW`, between half and the full threshold as Semi-Arid `BS`, further distinguished by `h` / `k` based on annual average temperature. Polar `ET` / `EF` checks if the warmest month reaches 0°C; Tropical `Af` / `Am` / `Aw` / `As` checks the coldest and driest months. The summer half-year in the Southern Hemisphere is opposite to the Northern Hemisphere, and the code tallies hemispheres separately.

See the [Köppen Classifier](../../../src/core/climate/koppen-climate-classifier.ts) for classification tables and thresholds. It is a diagnostic label made according to the generated climate, not another climate solver that will reverse-drive precipitation. The interface can toggle temperature, precipitation, and wind layers for months 1–12, and view annual summaries and Köppen categories.

## Numerical Boundaries

The model aims at interpretable virtual planet landscapes. East/north wind components are relative quantities; orographic rain, monsoons, cold waves, and oceanic influences are empirically calibrated. When comparing different seeds, observe large-scale latitudinal trends and differences across mountains; cell values should not be treated as real Earth weather station forecasts.
