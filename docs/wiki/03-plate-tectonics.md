# 03 · Plate Motion and Tectonics

[English](./03-plate-tectonics.md) | [简体中文](./03-plate-tectonics.zh-CN.md)

## Intuitive Understanding

Plates are moving crustal slabs. When adjacent plates move toward each other, mountains, volcanic arcs, and trenches may form; moving apart can create mid-ocean ridges or rift valleys; lateral sliding leaves strike-slip faults. The generator uses these relationships to provide large-scale "genetic skeletons" for topography.

## How Plates Form

The [PlateStage](../../src/core/simulation/pipeline/stages/plate-stage.ts) generates sub-plates on the reference mesh, then creates candidate continents and crust attributes based on the plate layout. Seeds are spread out as much as possible, plates grow by taking turns along adjacent regions, and then boundaries and fragmented pieces are processed. Each plate has an Euler rotation vector `ω`; the tangential velocity at a unit sphere position `p` is `v = ω × p`. This describes the local movement direction, not the true geological age or cm/yr speed.

The [PlatePhysicsProcessor](../../src/core/geology/plate-physics.ts) corrects initial motion based on area, crust, and boundary relationships. The [SuperPlateStage](../../src/core/simulation/pipeline/stages/super-plate-stage.ts) groups sub-plates into larger tectonic units, keeping major mountain belts and ridges continuous. The output retains `regionPlate` and `regionSuperPlate`: the former is useful for observing fine-grained plates, while the latter dominates large-scale boundaries.

## How Boundaries Affect Topography

The [Boundary Analyzer](../../src/core/geology/plate-boundary-analyzer.ts) compares the velocities on both sides of a shared edge, splitting the relative motion into a normal component across the boundary and a tangential component along the boundary. Normal convergence, divergence, and tangential slip support the classification of convergence, rifting, and strike-slip, respectively. Regional stress and subduction sides are then aggregated from edge-level results. When oceanic crust meets continental crust, density and crust type determine subduction polarity.

Expressed with adjacent plate velocity difference `Δv`, cross-edge normal `n`, and along-edge tangent `t`, boundary diagnosis uses:

```text
normalVelocity = Δv · n
shearVelocity  = |Δv · t|
edgeStress     = max(|normalVelocity|, shearVelocity)
```

The code uses a normal threshold of `0.003` to distinguish obvious convergence and rifting; the remaining inter-plate boundaries fall into the strike-slip category. These are **relative motion thresholds** within the generator, not Earth's measured plate velocities. Edge-level fields retain direction and intensity, while region-level fields aggregate neighbor interactions. When determining subduction, local crust attributes on both sides of the boundary are used, so a single plate can contain both candidate continents and oceanic crust participating in the judgment.

Boundary effects also decay inland instead of just being drawn on a single line. Tectonic elevation reads collision zones, ridges, faults, stress directions, and overriding/subducting sides to establish mountain belts, trenches, volcanic arcs, and rift valleys. A long-wave mantle field further modulates tectonic responses. See [Geology Data Types](../../src/core/geology/geology-data.ts) and [Tectonic Stage](../../src/core/simulation/pipeline/stages/tectonic-stage.ts) for related outputs.

The [ProjectionStage](../../src/core/simulation/pipeline/stages/projection-stage.ts) analyzes the boundaries of both sub-plates and superplates simultaneously. The main tectonic types use superplate boundaries as a skeleton, while sub-plate stress and direction are used for local modulation; the code applies weights of `0.58` and `0.88` respectively to these two layers of stress. In this way, not all internal sub-plate seams become major mountain systems, but the details still affect the morphology of mountain belts.

## How to Read the Map

The "Plate Tectonics" layer in the interface is colored by sub-plate index. The index color only helps distinguish regions; it does not directly represent motion direction, stress, or crust type. Finer tectonic diagnosis fields are stored internally, but the layer bar does not expose all diagnostic modes currently.
