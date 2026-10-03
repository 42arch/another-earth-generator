# 09 · Biomes and Ecosystems

[English](./09-biomes-and-ecosystems.md) | [简体中文](./09-biomes-and-ecosystems.zh-CN.md)

## Intuitive Understanding

The same amount of rain supports different vegetation in hot areas versus cold areas. The generator reads the temperature and precipitation of each month throughout the year, combines elevation, aridity, and Köppen climate zones, and classifies each final land region into a primary landscape type.

## Actual Output

The [BiomeStage](../../src/core/simulation/pipeline/stages/biome-stage.ts) runs after monthly climate and Köppen classification. Each region of the output mesh gets a `biomeClass`; it also saves annual average temperature, annual precipitation, aridity index, and growing season months weighted by the days in a month. Ocean is encoded as `0`. There are currently **15 classes: Ocean plus 14 land biomes**. See [biome-data.ts](../../src/core/ecology/biome-data.ts) for the full sequence.

| Code | Biome | Main Criteria or Landscape Clue |
| ---: | --- | --- |
| 0 | Ocean | Final land/sea mask is water |
| 1 | Tropical Rainforest | Hot all year, rainy, driest month still has rain |
| 2 | Tropical Seasonal Forest | Hot all year, with distinct wet/dry seasons |
| 3 | Savanna | Sufficient tropical heat, moisture below forest threshold |
| 4 | Hot Desert | Arid with higher annual average temperature |
| 5 | Cold Desert | Arid with lower annual average temperature |
| 6 | Semi-Arid Steppe | Low aridity index or Köppen semi-arid classes |
| 7 | Mediterranean Scrub | Summer-dry precipitation structure in temperate zones |
| 8 | Temperate Grassland | Annual rain or growing season insufficient for stable forest |
| 9 | Temperate Seasonal Forest | Temperate, forest region with enough rain |
| 10 | Temperate Rainforest | Temperate and very abundant rain |
| 11 | Boreal Forest (Taiga) | Distinct cold season, can grow in warm season |
| 12 | Tundra | Warmest month still cold or growing season too short |
| 13 | Ice Sheet | Warmest month below 0°C, or meets high-latitude snow retention approx |
| 14 | Alpine Tundra | High elevation and warmest month is relatively cold |

## Classification Sequence

The [Classifier](../../src/core/ecology/biome-classifier.ts) first handles year-round frozen and high alpine areas, then references Köppen **B** class to identify arid lands, and subsequently uses aridity index, warm month length, coldest month temperature, and precipitation seasonality to distinguish forests, grasslands, and tundras. When a region satisfies multiple intuitive descriptions, the **priority in the code** determines the final category; the table provides reading clues.

The aridity index is `annual precipitation / estimated annual potential evapotranspiration`. Potential evapotranspiration is approximated monthly from temperature, so it describes "how much precipitation there is relative to heat-driven water demand", and does not equal measured soil moisture. Growing season months count months with average temperatures above 5°C. Alpine tundra also requires an elevation of at least 2.8 km and a warmest month below 15°C.

The classifier uses the same monthly evapotranspiration demand approximation form as hydrology, but their output purposes differ: hydrology subtracts demand from monthly precipitation, while ecology uses the **ratio of annual precipitation to annual demand** to judge aridity. Tropical categories also look at whether the coldest month is at least 18°C, as well as the driest month's rain; temperate categories consider the cold season, warm season, and total rain simultaneously. The Köppen arid category participates preferentially in desert/grassland determination to avoid contradictory wet forest labels given by the two sets of rules for the same set of monthly climates.

## How to Read the Map

The "Biomes" layer displays the primary categories; the region inspector can show the name, aridity index, and growing season months. The classification result does not simulate species, vegetation succession, fires, or land use. The satellite imagery layer performs procedural coloring by combining ecology, climate, and topography, but its colors do not represent remote sensing observations.
