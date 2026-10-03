# 02 · Spherical Mesh and Topology

[English](./02-spherical-mesh.md) | [简体中文](./02-spherical-mesh.zh-CN.md)

## Intuitive Understanding

The entire planet is first divided into many adjacent "blocks". Each block has a center, an area, and neighbors. Plate expansion, moisture propagation, and runoff convergence all run along this spherical adjacency graph, so map projection will not change the physical geography results.

## From Icosphere to Regions

The [IcosphereBuilder](../../src/core/mesh/icosphere-builder.ts) starts with a regular icosahedron, subdivides each triangle into four, and projects new vertices onto the unit sphere. At Level `L`, the number of vertices and regions is `10 × 4^L + 2`: Level 6 has 40,962 regions, and the default Level 7 has 163,842 regions. The vertices become the centers of Voronoi regions, and the triangular faces determine adjacency.

`irregularity` perturbs the region centers in the tangent plane. When the perturbation is non-zero, the code **rebuilds the triangulation** using stereographic projection and Delaunator, then calculates adjacency, latitude/longitude, and region areas. Therefore, "each block in an irregular grid has 5 or 6 neighbors" is not guaranteed by the code; do not treat the degree of a regular Icosphere as a universal constraint.

The region area `regionArea` is the **unit sphere area**, and the global sum should be close to `4π`. When physical area is needed, multiply by the square of the physical radius. Adjacency is stored in CSR format: `neighborOffsets[i]` to `neighborOffsets[i+1]` is the slice of region `i`'s neighbors in `neighbors`. This avoids allocating independent arrays for each block when traversing a large number of regions.

| Field | Meaning in each region | Typical use |
| --- | --- | --- |
| `regionPosition` | 3D center on unit sphere | Great circle distance, spherical tangent vector |
| `regionLatitude` / `regionLongitude` | Lat/Lon of the center in radians | Climate latitudinal zones, map projection |
| `regionArea` | Area on the unit sphere | Continent coverage, runoff weight |
| `neighborOffsets` / `neighbors` | Adjacent region indices | Plate expansion, moisture propagation, drainage |
| `triangles` | Triangular faces formed by region centers | Voronoi dual and geometry construction |

The great circle angular distance between two unit directions `a` and `b` is `acos(clamp(a·b, −1, 1))`. If an algorithm requires a distance in km, multiply it by the physical radius; do not treat the rendering sphere radius as the physical earth radius.

## Fixed Reference Mesh

The [MeshStage](../../src/core/simulation/pipeline/stages/mesh-stage.ts) always builds a Level 6 reference mesh, and builds the output mesh according to detail parameters; they share the same object when the levels are identical. Plates, continents, and crust are first determined on the reference mesh, then projected to the output mesh via `outputToReference`. The mapping query points are perturbed by deterministic noise so macroscopic boundaries do not show regular sampling aliasing. Climate uses another purely geographic mapping to prevent climate fields from twisting along tectonic boundaries.

In high-detail mode, climate is still calculated on the coarser grid, and then projected to the output mesh; final drainage and rivers use the actual adjacency of the output mesh. Changing output precision will affect local shapes and numerical discretization, not guaranteeing that every block is identical.

Reference and output mappings use [ReferenceGridProjector](../../src/core/mesh/reference-grid-projector.ts). `outputToReference` is one reference region corresponding to each output region, used for discrete plate and candidate continent IDs. Continuous climate fields require multi-region weighted sampling, hence a [separate climate output projector](../../src/core/climate/climate-output-projector.ts) is used. Mixing these two mappings causes climate fields near coasts to shift along plate boundaries.

## Terminology and Checking

A **Voronoi region** is the spherical extent "closest to this center"; the **dual triangulation** connects adjacent region centers; the **great circle distance** is the shortest arc length on the sphere. When checking the mesh, you should verify bi-directional adjacency, region connectivity, positive area, and total area sum. See [SphericalMesh](../../src/core/mesh/mesh.ts) and [Voronoi Builder](../../src/core/mesh/voronoi.ts) for related data structures.
