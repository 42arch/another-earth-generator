# Another Earth

[English](README.md) | [简体中文](README.zh-CN.md)

A browser project for procedural planets and map exploration, built with TypeScript, Svelte 5, Vite, and a Bun workspace.

## Current capabilities

- Generate natural worlds on regular or perturbed spherical meshes from L0 to L8, with climate, hydrology, ecology, validated Schema 3 snapshots, and read-only queries.
- Explore worlds in a 3D globe or 2D atlas with thematic layers, six map styles, region inspection, and Worker-backed generation.
- Load built-in content and naming profiles; bilingual society packs are available as candidates for future civilization generation.

Initial civilization generation and browser project storage/import/export are not implemented yet. See [progress](docs/PROGRESS.md) for the current scope and validation status.

## Run locally

```sh
bun install
bun dev
```

Open the address printed by Vite. The workspace is served from `/`; L8 requires substantial memory.

## Documentation

The main documents are in Chinese.

| Document | Contents |
| --- | --- |
| [PRD](docs/PRD.md) | Product goals, user journeys, and scope |
| [Technical design](docs/TECHNICAL_DESIGN.md) | Current package boundaries and durable design decisions |
| [World data contracts](docs/WORLD_DATA_CONTRACTS.md) | Current snapshot, content, ownership, and archive contracts |
| [Generation pipeline](docs/GENERATION_PIPELINE.md) | Stages, signatures, randomness, caching, and Workers |
| [Progress](docs/PROGRESS.md) | Current capabilities, pending work, and validation status |
| [M1 implementation plan](docs/M1_IMPLEMENTATION_PLAN.md) | Climate, hydrology, erosion, ecology, and world publication |

`packages/world-core` owns generation and domain rules, `packages/world-data` owns content, `packages/cartography` owns mapping, and `apps/web` owns UI and Worker orchestration. `docs/old-src` contains reference code from feat-society and is not part of the new runtime. Historical document snapshots are linked from the current progress page and are not current specifications.
