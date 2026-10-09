# 07 · Cultures and Cultural Regions

[English](./07-cultures-and-regions.md) | [简体中文](./07-cultures-and-regions.zh-CN.md)

> Status: design draft. Current code has no cultural features or regions; the layer registry's `human` category is only a reserved entry point.

## Intuitive understanding

The culture layer should explain shared ways of living and traditions of contact rather than repaint ethnicity. Members of one ethnic group living apart for a long time can develop different cultures; a multiethnic port can develop a shared urban culture. Culture, ethnicity, religion, and states interact without sharing one set of boundaries.

## Traits and contact

Define a small number of explainable traits, such as language use, food resources and cooking traditions, building forms, trade habits, and festivals. Natural conditions supply resources and constraints; transport provides contact; migration and historical events change how traits spread. Traits should arise from rules and history, not a direct biome-to-ethnicity or biome-to-values lookup. A religious trait should reference actual belief composition rather than maintain a contradictory second source of data.

Group regions into cultural areas using trait similarity and contact strength. A culture entity can hold a name, core area, trait combination, and related cultures. A region may store a leading area ID and similarity for cartography while retaining underlying traits or resident participation. Show frontier areas with gradients, diversity, or transition zones. A leading cultural area is a map classification, not a claim that residents have one culture only.

## Layers and acceptance

The cultural inspector should list formation reasons and distinctive traits, not only a name. Overlapping state borders, ethnic distributions, or religious centers should reveal information that the other layers do not. Area statistics use physical spherical area. Population statistics need resident participation data; the area covered by a leading label is not the number of adherents. Names should use a stable seed and traceable language or historical source.
