# 03 · Transport and Spatial Economy

[English](./03-transport-and-economy.md) | [简体中文](./03-transport-and-economy.zh-CN.md)

> Status: the second stage implements roads, limited sea routes, and market access; actual trade flows remain unmodelled.

## Current implementation

[TransportGenerator](../../../src/core/society/transport-generator.ts) expands weighted travel costs from settlements across final land. Relief, difficult biomes, and river crossings raise land resistance. Boundaries between settlement catchments yield candidate links; each connected land component gets a low-cost base network, with a few optional loops controlled by road connectivity. Road paths follow adjacent spherical mesh regions and never traverse ocean cells.

Settlements can reach a port through at most two adjacent land regions before entering an ocean cell. The land access path is included in the route geometry and cost. A separate ocean propagation creates sea-route candidates between ports. Routes within 1800 km-equivalent cost first connect separate land networks; a limited number of coastal shortcuts are then added when their cost including embarkation is at least 15% below travel through the selected road network, subject to a per-port degree cap. Winds and currents are not converted into ship speed.

After roads are selected, land travel cost is recomputed with a corridor discount. Per-region nearest market, access cost, and relative market-access score depend on hinterland size and cost decay. The panel adds road connectivity and terrain resistance. The route overlay, market-access base map, and inspector read the same spherical paths. Market access is a **proxy**, not trade value or elapsed travel time.

## Intuitive understanding

Transport connects productive hinterlands to settlements. Polities and religions can spread along these corridors, while mountains and straits raise actual travel cost. Roads should emerge from network choices rather than straight lines between arbitrary city pairs.

## Land and sea routes

The sections below give modelling rationale and future extensions; the current runtime behavior is summarized above.

The existing [spherical pathfinder](../../../src/core/math/pathfinder.ts) accepts passability, edge costs, and a heuristic. First form candidate links between nearby or complementary settlements, then find paths for those links. Start land edge cost with physical distance, adding slope, difficult land cover, river crossings, and discounts for reused roads. A heuristic must not exceed the minimum remaining travel cost; use zero if admissibility cannot be established. Connect each land component with a basic network, then add loops that meaningfully reduce detours. At high detail, find coarse corridors before local refinement rather than searching every city pair globally.

Coastal settlements can be port candidates. Sea routes are separate network edges with embarkation and voyage costs. Current [seasonal currents](../nature/06-seasonal-circulation.md) are relative proxies, not ship speeds to integrate into a travel time. Later, wind belts, seasons, and straits can modify reliability; the first release should not imply precise sailing times. Annual rivers do not automatically imply navigable waterways.

## Hinterlands and economic measures

Propagate travel cost from settlements to assign accessible market hinterlands. Town centrality can summarize reachable population, a production proxy, and route junctions. Production potential, accessibility, and market size can explain rank. Until supply, demand, and goods flows are solved, call the map “market access” or “potential connection,” not actual trade value.

Store sparse road and sea-route entities with spherical polylines, endpoint settlements, cost, and class. Store nearest market and access cost per region. Crossing a strait requires a sea link between ports; land routing must not pass through ocean cells. Picking a route should show endpoints, waypoints, and cost. Lines need the appropriate 2D projection-seam and 3D back-face handling.
