# 01 · System Architecture and Data Flow

[English](./01-system-architecture.md) | [简体中文](./01-system-architecture.zh-CN.md)

## Intuitive Understanding

The system first determines "where plates, land, and mountains are" on the sphere, then calculates "where it is cold and where it rains in each month", and finally derives rivers and biomes from precipitation. The 3D globe and 2D map are just two ways of rendering this spherical data.

## Generation Pipeline

The [Worker Entry](../../src/core/simulation/worker/simulation.worker.ts) adds stages to the `PipelineScheduler` in the order of the table below. After one stage is completed, the next stage reads its results; the UI receives stage progress and elapsed time.

| Stage | Main Work | Output Location |
| --- | --- | --- |
| `MeshGeneration` | Build reference and output meshes, region mapping | `mesh`, `referenceMesh`, `outputToReference` |
| `PlateTectonics`, `SuperPlates` | Sub-plates, candidate continents, crust, superplates | Intermediate Context |
| `Projection`, `Tectonics` | Project macroscopic attributes, calculate boundaries, mantle, and tectonic fields | Intermediate Context |
| `ElevationAndTerrain` | Tectonic elevation, texture, post-processing, final land/sea | `data.geology`, `data.geography` |
| `SeasonalCirculation` | Wind, pressure, surface ocean currents for four seasonal anchors | `data.climate.circulation` |
| `MonthlyClimate` | 12-month temperature and precipitation | `data.climate.monthly` |
| `ClimateOutputProjection` | Project climate fields onto the output mesh | `outputProjection` / `outputMonthly` |
| `KoppenClimate`, `Biome` | Köppen climate and biome classification | `koppen`, `data.biome` |
| `SurfaceHydrology` | Annual effective runoff, drainage map, river networks | `data.hydrology` |

### Two Spatial Scales

The reference mesh is fixed to Icosphere Level 6, containing 40,962 regions. The output mesh is determined by detail parameters. When the terrain resolution is higher than the reference mesh, the climate is solved on the reference mesh, and then projected onto the output mesh according to the final land/sea and elevation; river networks are always solved on the output mesh. The macroscopic geological mapping of the reference mesh perturbs the boundaries, while the climate mapping samples by geographic location; their purposes are different.

## Data Contracts

The [World State Type](../../src/core/simulation/state.ts) divides the results into `geology`, `geography`, `climate`, `biome`, and `hydrology`. Large-scale region-by-region data uses continuous arrays like `Float32Array` and `Uint8Array`; region indices correspond to the same location within the same mesh.

- `candidateLandMask` is the candidate land/sea before tectonic topography; `landMask` is determined by the processed elevation and is the final land/sea used by climate and hydrology.
- Surface elevation and terrain increments are externally exposed in **km**; monthly precipitation in **mm/month**, monthly temperature in **°C**; hydrology `discharge` in **m³/s**.
- East-west and north-south components of wind and ocean currents are **relative transport strengths**, not m/s; `oceanWarmth` is a temperature anomaly proxy from -1 to 1, not °C.
- Seasonal arrays are arranged by "Season × Region", and monthly arrays are arranged by "Month × Region"; Month 0 represents January.

The main thread creates a new Worker for each generation. Upon completion, results are delivered via transferable `ArrayBuffer`, and mesh object access methods are restored. Generating results are reused when only layers, months, or views are switched; changing generation parameters triggers a new generation. The code entry points are [SimulationCore](../../src/core/world/simulation-core.ts) and [WorldEngine](../../src/core/world/world-engine.ts), respectively.

## Reproducibility and Limitations

Random fields use seeds to ensure the same configuration reproduces the same world. When comparing quality, the sphere area, adjacency connectivity, candidate vs. final land ratio, and large-scale contours across different detail levels should be checked simultaneously. The current pipeline has no lakes or human geography stages; lake surfaces cannot be inferred from the hydrology depression filling surface.
