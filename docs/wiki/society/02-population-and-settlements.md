# 02 · Population, Habitability, and Settlements

[English](./02-population-and-settlements.md) | [简体中文](./02-population-and-settlements.zh-CN.md)

> Status: first stage implemented. The model now provides habitability, population density, and settlement centres; transport access and seasonal water supply remain future work.

## Current implementation

[PopulationGenerator](../../../src/core/society/population-generator.ts) combines annual temperature, growing season, aridity, slope, river distance, and coastal adjacency on final land into a 0–1 habitability score. Density is estimated from suitability; population uses physical spherical cell area. Ice sheets and oceans have no residents. Settlement candidates favour suitable river and coastal regions and are spaced by physical distance. Each settlement receives a land-connected hinterland; its rank depends on the served population. Urban residents are transferred from that hinterland, so settlement population is not added again to the world total.

The parameter panel offers population scale, settlement density, and urban concentration. The population base map is labelled people/km²; markers in both views open region and settlement details. Soils, roads, navigation, historical migration, and monthly water reliability are not yet modelled. These controls are generation multipliers, not hard target counts.

## Intuitive understanding

River valleys and plains often support more people, but agricultural potential, residential comfort, and transport centrality are different measures. Population should respond to production, freshwater access, and mobility; a city's size also needs support from its surrounding hinterland.

## From natural fields to population

Use final land cells, growing-season information from [biome data](../../../src/core/ecology/biome-data.ts), [monthly climate](../nature/07-atmosphere-and-climate.md), [final terrain](../nature/05-elevation-and-topography.md), and the [annual river network](../nature/08-rivers-and-drainage.md). Compute three explainable diagnostics first:

| Measure | Inputs | Purpose |
| --- | --- | --- |
| Production potential | Growing season, seasonal temperature and rain, gentle terrain | Estimate supported population; without soils, do not call it measured fertility |
| Residential conditions | Water access, temperature extremes, local slope | Limit settlement in harsh or water-poor areas |
| Centrality | River and coastal nodes, nearby hinterland, travel access | Select towns instead of distributing cities uniformly |

Current rivers are annual results. They do not establish monthly reliable water supply, navigability, or lake shores. Port suitability needs a separate coastal rule.

Compute carrying capacity per region, then multiply by physical cell area to obtain regional population. Select settlement candidates by potential while enforcing spacing in physical distance or travel cost. River confluences, coasts, and passes can raise centrality. Rank settlements using accessible hinterland population and travel cost, while retaining dispersed rural population. Regional population is the authoritative total; settlement population is an allocation or derived aggregation, never an additional amount added to the world total.

## Outputs and acceptance

Proposed outputs include per-region `habitability` and `population` fields plus sparse settlement entities with region, rank, estimated population, hinterland, and location reasons. Label density in people/km² and identify population as a model estimate. Ocean and uninhabitable cells have zero settled population; settlements remain on final land. Changing grid detail should not scale world population or major-city count with cell count. The inspector should explain why a city exists, for example a gentle hinterland near a major river and transport junction.
