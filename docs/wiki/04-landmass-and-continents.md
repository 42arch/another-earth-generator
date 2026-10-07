# 04 · Landmasses, Coasts, and Islands

[English](./04-landmass-and-continents.md) | [简体中文](./04-landmass-and-continents.zh-CN.md)

## Intuitive Understanding

Continents are not created by painting whole plates as land. The system first generates a **candidate land/sea** map for topography, then superimposes tectonic, island arc, and hotspot elevations; the regions ultimately above sea level become land. Therefore, the candidate coast and the visible coast can differ.

## Candidate Continents

The [CandidateLandGenerator](../../src/core/geography/candidate-land-generator.ts) runs after major and microplate topology is set. It places continents on the 100-subdivision adjacency graph: seeds favor different moving plates, and growth favors staying within a plate while still allowing crossings. It then refines coasts on the reference mesh using distance fields and continuous noise. The target land ratio is given by `landCoverage`, default `0.30`, calculated by spherical region area. `continentCount` controls the number of major continent groups, and `continentSizeVariety` adjusts their area differences. Plates, candidate land/sea, continent IDs, and crust are projected to the output mesh via the same reference mapping, avoiding macroscopic attribute misalignment.

The generation process can be divided into three scales: first, disperse continent seeds on the subdivision adjacency graph and expand them to determine the orientation of continent groups; then, calculate the distance from the reference mesh to these groups and redraw coasts using lower-amplitude continuous noise so that coasts can cross plate boundaries without as many fragmented edges; finally, select candidate land approaching the target coverage ratio based on region **area** rather than region count. New candidate land expanding into former oceanic regions inherits neighboring continent IDs.

The target ratio here applies to **candidate** land and does not guarantee that final land is exactly 30%. Subsequent uplift and inundation will change the visible coastline. Oceanic crust and final sea level are also not the same concept: crust is a tectonic attribute, whereas land/sea depends on the elevation zero-line.

## The Formation of Islands

The [TectonicEdificeGenerator](../../src/core/geology/tectonic-edifice-generator.ts) adds elevation contributions such as island arcs, continental margin volcanic arcs, hotspot chains, and large igneous provinces to regions meeting tectonic conditions. `islandArcCount` is the upper limit for major island arc systems, `hotspotCount` controls the number of hotspot chains, and `islandDensity` affects island arc continuity and near-shore small island density. Parameters change the topographic genesis, not forcefully turn oceanic cells directly into land.

After processing the topography, the [TerrainPostProcessor](../../src/core/geography/terrain-post-processor.ts) locally interpolates land/sea boundaries during terrain warping and removes shallow, low-relief single-cell speckles according to cell area, candidate land/sea assignment, and tectonic uplift. The same rule applies at every resolution while preserving larger candidate islands and islands with substantial uplift. It then divides the final `landMask` at zero elevation. If island arcs or hotspots are uplifted high enough, they emerge above sea level; low-lying parts of candidate continents may also be covered by seawater. Subsequent climate, hydrology, and ecology use this final mask.

| Field | When Generated | Applied To |
| --- | --- | --- |
| `candidateLandMask` | After projecting reference mesh continent layout | Tectonic elevation, coast distance, crust attributes |
| `continentId` | When candidate continents generate | Retain candidate-continent affiliation for geological layout |
| `visibleContinentId` | After final terrain post-processing | Visible continent affiliation in the map layer, statistics, and region inspector |
| `landMask` | After final topography post-processing | Climate land/sea boundary, hydrology land, biome classification |

## Reading Tips

The "Continents" layer follows the final land/sea boundary: submerged candidate continents appear as ocean, while newly emerged coasts and islands inherit the nearest candidate continent ID. The display field `visibleContinentId` remains separate from the original `continentId`, so assigning a map color does not change candidate crust or terrain generation.

When increasing the detail level under the same seed, the macroscopic continent layout still comes from the fixed reference mesh, but local coasts may change. When comparing two precision levels, one should look at area and large-scale contours, not whether region-by-region indices are perfectly identical.
