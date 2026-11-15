# Another Earth

[English](README.md) | [简体中文](README.zh-CN.md)

A browser project for procedural planets and map exploration, built with TypeScript, Svelte 5, Vite, and a pnpm workspace.

## Current capabilities

- Generate regular or perturbed spherical meshes from L0 to L8, reference geology, plates, candidate continents, crust, and base terrain.
- Use `/mesh-debug` to inspect mesh, geology, terrain themes, region properties, progress, and stage caching.
- Use content/world contracts, a generation pipeline, Worker copy transfers, and a minimal JSON archive codec.

M1.1 currently produces generation artifacts. The latest terrain version is `terrain-v20`; glacial and hydraulic erosion are deferred. Monthly climate, hydrology, ecology, complete world publication, civilization generation, formal 3D/2D maps, and browser project storage are not implemented yet. See [progress](docs/PROGRESS.md) for the current validation status.

## Run locally

```sh
pnpm install
pnpm dev
```

Open the address printed by Vite and visit `/mesh-debug`. The UI offers L4–L8; L8 requires substantial memory. This is a debugging view, not the full product workspace.

## Documentation

The main documents are in Chinese.

| Document | Contents |
| --- | --- |
| [PRD](docs/PRD.md) | Product goals, user journeys, and scope |
| [Technical design](docs/TECHNICAL_DESIGN.md) | Package boundaries, algorithms, target architecture, and decisions |
| [World data contracts](docs/WORLD_DATA_CONTRACTS.md) | Fields, units, identity, snapshots, artifacts, and ownership |
| [Generation pipeline](docs/GENERATION_PIPELINE.md) | Stages, signatures, randomness, caching, and Workers |
| [Progress](docs/PROGRESS.md) | Implemented features, pending work, validation, and measured baselines |
| [M1 implementation plan](docs/M1_IMPLEMENTATION_PLAN.md) | Climate, hydrology, erosion, ecology, and world publication |

`packages/world-core` owns generation and domain rules, `packages/world-data` owns content, `packages/cartography` defines the mapping boundary, and `apps/web` owns UI and Worker orchestration. `docs/old-src` contains reference code from feat-society and is not part of the new runtime.
