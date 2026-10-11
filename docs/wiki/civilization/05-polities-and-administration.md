# 05 · Polities and Administration

[English](./05-polities-and-administration.md) | [简体中文](./05-polities-and-administration.zh-CN.md)

> Status: the first deterministic polity, capital, leading ownership, control strength, and first-level administration stage is implemented. Claims, vassalage, and historical events remain planned.

## Intuitive understanding

The polity layer shows who governs a place. Its boundaries may align with or differ from ethnicity, religion, and culture. Remote areas with poor connections are harder to govern; island territories need ports or historical links to explain their attachment.

## From political centers to territory

Choose political centers from settlements, with governing capacity based on accessible population, agricultural hinterland, and transport centrality. Spread governance cost from capitals and secondary centers. Roads and sea routes reduce cost; mountains, straits, distance, and weak supply raise it. Polities compete for effectively controlled cores within their budgets, then extend weaker peripheral claims across connected land. Independent land without a political center or route can remain unassigned. Overseas territories require reachable ports or an explicit event, not unrestricted influence across the sea.

Use an entity named `Polity` so city-states, kingdoms, republics, and leagues fit the same contract. Store primary polity ID and control strength per region. Capital, governing form, official language, and religion policy belong to the polity entity. Derive borders from neighboring regions with different owners rather than maintaining a separate authoritative drawing. Aggregate ethnic and religious composition from residents; official attributes do not replace resident statistics.

## Administration and acceptance

After polities form, divide them into administrative areas around regional towns with explicit parent polities. The first release describes primary governance. Claims, vassalage, disputed zones, and overlapping sovereignty need additional relations rather than overloading one `polityId`. Validate that capitals lie within governable territory, administrative parents are valid, land-border connectivity is sensible, and overseas territories have a transport explanation. Sum national population from residents and area from physical spherical area, never from cell count.

## Current implementation

`PolitiesAndAdministration` follows ethnicity and languages. Capital candidates are ranked by settlement hinterland population and market access. Every inhabited land component with a settlement receives at least one capital, while additional capitals are spaced apart. Governance spreads over land using terrain, biome, river, and road costs. The budget limits effective control; connected peripheral land can still belong to a polity at lower control strength. Independent land without a political center or route remains unassigned. Overseas reach uses selected port-to-port sea routes only. The renderer derives borders from adjacent `polityByRegion` values.

Districts spread from capitals and major settlements inside their parent polity; isolated controlled territory without a town receives a frontier district. Population is summed from authoritative resident counts and area from physical Voronoi cell area. The capital's leading language supplies the official language without replacing local resident composition. The religion stage can give limited patronage to a religion founded within a polity, while full religious policy and historical institutions remain unmodeled.
