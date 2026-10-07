# 03 · Plate Motion and Tectonics

[English](./03-plate-tectonics.md) | [简体中文](./03-plate-tectonics.zh-CN.md)

## Intuitive Understanding

Plates are moving crustal slabs. When adjacent plates move toward each other, mountains, volcanic arcs, and trenches may form; moving apart can create mid-ocean ridges or rift valleys; lateral sliding leaves strike-slip faults. The generator uses these relationships to provide large-scale "genetic skeletons" for topography.

## How Plates Form

The [PlateStage](../../src/core/simulation/pipeline/stages/plate-stage.ts) generates a fixed set of 100 reference subdivisions, groups them into connected major plates of varied area, and splits a few independently moving microplates from their boundaries. Subdivision seeds are spread apart and grow through adjacent regions. The subdivision count is an internal constant, not a user control.

The [ContinentalCrustStage](../../src/core/simulation/pipeline/stages/continental-crust-stage.ts) then places candidate continents and crust using the established moving-plate layout. The [SuperPlateStage](../../src/core/simulation/pipeline/stages/super-plate-stage.ts) uses the [PlatePhysicsProcessor](../../src/core/geology/plate-physics.ts) to adjust motion based on area, crust, and boundary relationships. Each tectonic plate has an Euler rotation vector `ω`; the tangential velocity at a unit-sphere position `p` is `v = ω × p`. This describes local movement direction, not geological age or a measured cm/yr speed. `regionPlate` identifies reference subdivisions; `regionSuperPlate` identifies independently moving tectonic plates.

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

The [ProjectionStage](../../src/core/simulation/pipeline/stages/projection-stage.ts) derives tectonic stress from independently moving plate boundaries. Internal reference subdivisions inherit their plate's motion, so their seams do not create independent collision stress.

## How to Read the Map

The "Plate Tectonics" layer colors independently moving plates. Reference subdivisions remain available to the internal generator and region inspector but no longer have a separate layer. Index colors distinguish regions; they do not encode motion direction, stress, or crust type.
