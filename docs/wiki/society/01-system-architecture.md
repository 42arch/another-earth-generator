# 01 · Architecture and Data Contracts

[English](./01-system-architecture.md) | [简体中文](./01-system-architecture.zh-CN.md)

> Status: population, settlements, transport, market access, static ethnicity/languages, polities, first-level administration, and primary belief affiliation are implemented; culture and history remain proposals.

## Intuitive understanding

The human system reads the same planet's finalized land, terrain, climate, ecology, and rivers to answer where people live, how places connect, and who lives there. The 3D globe and 2D map display one shared spherical human result; neither view generates its own states or settlements.

## Pipeline position and inputs

The [Worker pipeline](../../../src/core/simulation/worker/simulation.worker.ts) runs `PopulationStage` after `SurfaceHydrologyStage`, using final `landMask`, `elevation`, `biome`, and `hydrology`; see the [nature architecture](../nature/01-system-architecture.md) and [hydrology chapter](../nature/08-rivers-and-drainage.md). Hydrology's `drainageElevation` is a routing surface, not a real lake or freshwater surface. Suitability and population are computed on the final output mesh.

`PopulationAndSettlements → TransportAndMarkets → EthnicityAndLanguages → PolitiesAndAdministration → ReligionsAndBeliefs` is implemented. The proposed continuation is `CulturesAndRegions → SocietyProjection`. Cross-domain feedback can use a bounded second pass, such as revising town rank after roads improve market access.

## Authoritative data

[WorldSimulationState](../../../src/core/simulation/state.ts) now has optional `society?: SocietyData`, implemented under `src/core/society/`. It currently stores habitability, population, settlements, routes, market access, ethnic/language data, polity/administration data, and primary belief affiliation; future stages can add three kinds of information:

| Kind | Example | Contract |
| --- | --- | --- |
| Per-region arrays | Population, suitability, polity ID, leading ethnic ID | Indices match the final output mesh; ocean and unassigned values have explicit sentinels |
| Sparse entities | Settlements, routes, polities, ethnic groups, languages, religions, cultures | Stable IDs; references point to regions or other entity IDs |
| Population composition | Region, ethnicity, religion, and corresponding population | One authoritative population total; leading labels are derived for display |

Queries such as “religion within an ethnic group” require a joint composition or resident cohorts. Separate marginal percentages cannot recover the intersection. Future language and cultural participation also need an explicit choice between exclusive and overlapping membership.

Convert spherical cell area to physical area before using it for population or settlement size. The display-only `core.planetRadius` must not change population. Human travel distances and river scale need a consistent physical radius and units. The [spherical distance tools](../../../src/core/math/distance-field.ts) return central angles; callers must convert them explicitly.

## Randomness and acceptance

Derive an independent human random stream from the world seed, then separate streams for population, transport, ethnicity, polities, religion, culture, and names. The same seed and configuration should reproduce entity IDs, population, and borders; changing religion parameters should not rearrange existing mountains or cities. Validate nonnegative population, zero settled population at sea, consistent region/cohort totals, valid entity references, and stable large-scale patterns across output resolutions.

The current [influence-spread utility](../../../src/core/math/influence-spread.ts) yields a winning source and influence margin that can serve as a prototype. Its `influence` is not a population share. Final human arrays should be transferred through the existing Worker result; switching views or layers must not regenerate society.
