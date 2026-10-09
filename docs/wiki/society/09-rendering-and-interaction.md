# 09 · Rendering, Interaction, and Statistics

[English](./09-rendering-and-interaction.md) | [简体中文](./09-rendering-and-interaction.zh-CN.md)

> Status: population, market-access, ethnicity, language, polity, and religion maps, settlement, route, border, and sacred-site overlays, the inspector, and resident statistics are implemented; culture remains a proposal.

The first five stages include [population-density, market-access, ethnicity, language, polity, and religion maps](../../../src/core/rendering/shared/world-colorizer.ts), 3D/2D settlement markers, roads, sea routes, borders, sacred sites, and region details. Routes are currently picked through their occupied regions; entity highlighting, place-name labels, and filters remain future work.

## Intuitive understanding

Select one human base map, then overlay cities, routes, borders, or sacred sites to compare where people live, who governs, and what residents identify with. Clicking a city should select the city; clicking empty ground should select its region. The 3D and 2D views share the selected entity.

## Existing layer system

The [layer registry](../../../src/core/world/layer-registry.ts) has `isBaseMap`, `canOverlay`, and a `human` category. Population, market, ethnicity, language, polity, and religion maps, plus settlement, route, border, and sacred-site overlays, are available through [LayerBar](../../../src/ui/hud/LayerBar.svelte). Future stages can add culture maps and place-name overlays.

Derive human surface colors once from spherical region data. The [globe renderer](../../../src/core/rendering/globe/renderer.ts) and [map view](../../../src/core/rendering/map/view.ts) draw them separately. Clip roads and borders at 2D projection seams; hide labels on the globe's back side. Control city and place-name density with zoom, importance, and collision rules. Existing human label CSS classes do not amount to a complete label renderer.

## Picking and inspector

The current [WorldEngine](../../../src/core/world/world-engine.ts) and [region inspector](../../../src/ui/hud/RegionInspector.svelte) show population, settlements, routes, nearest-market details, ethnic/language and primary-belief resident composition, and polity/district ownership. Markers take priority; routes are picked through their occupied regions; sacred sites are inspected through their regions. Later stages can add tagged targets.

## Legends, statistics, and performance

Current [layer statistics](../../../src/core/world/layer-statistics.ts) sum residents for ethnicity, languages, polities, and religion; polity rows also include physical area. Most other layers still use cell counts. Human legends distinguish density, resident share, area, and control strength. Religious shares come from residents, not the area labeled with a leading category. Entity highlighting and statistic filters remain future work.

Current [configuration](../../../src/core/simulation/config.ts) keeps `baseMap` and `overlays` under `appearance`, with population and transport controls under `society`. The latter trigger regeneration and are saved in share links. Ethnicity, languages, and religion have no separate controls yet; entity filters and zoom-dependent marker density remain future work.
