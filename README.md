# Another Earth Generator

[English](README.md) | [简体中文](README.zh-CN.md)

Generate a fictional Earth-like planet in your browser, and explore its nature, climate, and evolving civilization on 3D and 2D maps.

Play it at [another-earth.starllow.com](https://another-earth.starllow.com).

## Features

### The natural world

Starting from tectonic plates and terrain, it generates continents, oceans, mountains, islands, climate, wind and ocean currents, rivers, lakes, and ecosystems.

Change the random seed, and adjust how much land there is, how rugged the terrain is, and how warm or wet the climate is. The same settings always produce the same planet. Move through the months to see how temperature, precipitation, wind, ocean currents, and snow change with the seasons.

### Civilization

On top of those natural conditions, it places people and settlements, links them by land routes, river routes, and coastal sea lanes, and forms peoples, cultures, religions, towns, and countries.

You can adjust how large the population is, how densely towns are placed, and whether countries join into large realms or stay as many small states.

### Maps

View the world as a 3D globe or a flat map. Flat maps can use an equal-area projection, equirectangular, or Mercator.

Several map styles are available: satellite, a standard atlas, physical geography, political, light or dark thematic bases, and historical parchment.

You can view layers for elevation, tectonic plates, land and sea, temperature, precipitation, climate zones, wind and ocean currents, biomes, land cover, agricultural potential, minerals, population density, countries, cultures, and religions. Rivers, lakes, coastlines, place names, borders, transport routes, and towns can be drawn on top.

Select a region, a town, or a country to see its natural conditions and civilization. You can also view an overview of the whole planet, copy a share link, or export the current map as an image.

The interface is available in Simplified Chinese and English.

## Future

- Import and export a whole world.
- Custom map styles.
- Edit terrain and map layers.
- Simulate how civilizations change over time.
- A world encyclopedia and custom civilization packs.

## Code and development

The repository is a Bun workspace, built with TypeScript, Svelte 5, and Vite.

### Layout

| Path | Role |
| --- | --- |
| `packages/world-data` | Content definitions, society candidates, and name lexicons |
| `packages/world-core` | Planet generation, domain rules, and the published world |
| `packages/cartography` | Map data, styles, and 2D/3D rendering; it only reads the world |
| `apps/web` | The interface, the Worker, and browser-side orchestration |

In `apps/web/src`, `ui` is the interface, `world-view` is the map workspace, and `workers` runs generation.

### Run locally

```sh
bun install
bun dev
```

Open the address printed in the terminal. Higher subdivision levels use more memory.
