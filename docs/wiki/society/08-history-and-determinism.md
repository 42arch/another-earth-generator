# 08 · History and Determinism

[English](./08-history-and-determinism.md) | [简体中文](./08-history-and-determinism.zh-CN.md)

> Status: design draft. The generator currently has no human historical events or timeline.

## Intuitive understanding

History explains cross-border groups, overseas territories, denominations, and cultural transition zones on the present map. An event must change population, entities, or relations. A narrative with no corresponding state change cannot explain the map causally.

## From snapshot to events

First generate one coherent static snapshot and retain origins and key relations. Then add a bounded sequence of events such as migration, founding a town, polity split or union, denomination branching, and cultural contact. Each event needs at least an ordered time, type, participants, location, input state, and traceable effect. Migration changes population at both ends; state formation changes governance; branching changes resident affiliation or institutions.

Apply events in a fixed order, using random streams separate from nature and other social domains. Bound the event count and iteration count. Repeating a seed and configuration should reproduce event order, entity IDs, and final snapshot. A timeline UI needs reconstructable snapshots or checkpoints rather than reversing discarded side effects. Before a full timeline exists, the inspector can show only key events affecting the selected entity.

## Consistency checks

After every step, validate entity references, chronology, nonnegative population, conservation across migration, and event provenance for territorial changes. Events that change the total population, such as births or deaths, need an explicit cause. Narrative names, descriptions, and map labels derive from events and final state; they are not authoritative simulation data. Adding history should preserve deterministic boundaries around nature and the current static society snapshot.
