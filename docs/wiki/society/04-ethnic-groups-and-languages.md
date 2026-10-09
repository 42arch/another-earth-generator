# 04 · Ethnic Groups and Languages

[English](./04-ethnic-groups-and-languages.md) | [简体中文](./04-ethnic-groups-and-languages.zh-CN.md)

> Status: static ethnicity and language generation is implemented; historical migration, language shift, and entity highlighting remain future work.

## Current implementation

After transport, [EthnicityGenerator](../../../src/core/society/ethnicity-generator.ts) selects an origin in every inhabited land component and adds further origins according to settlement hinterland population and physical spacing. Up to three lowest-cost ethnic sources are retained per region. Diffusion across land uses the road, relief, difficult-biome, and river-crossing costs; crossing water requires a selected port-to-port sea route. Mixed resident counts are allocated from the existing `society.population`, so the per-region total is conserved.

Ethnic groups, languages, and language families are separate entities. Nearby origins may share a language, and related languages belong to one family. Speaker counts currently derive from ethnic resident composition and each group's primary language; bilingualism is not simulated. The ethnic and language maps show the largest local resident category with color strength indicating its share. The inspector shows local composition, and thematic statistics sum residents rather than leading-label cell counts. Origins are static model anchors, not historical migration evidence.

## Intuitive understanding

Ethnicity describes group identity; language describes communication traditions. They can be related without being the same field. An ethnic group may span borders, a city may contain several groups, and several groups may share a language.

## Origin, spread, and mixed communities

Choose separated origins in sufficiently populated areas, then spread through land corridors, roads, ports, and explainable sea connections. Travel cost, contact frequency, and historical migration shape distributions; mountains, straits, and distance raise isolation. Long isolation can produce related offshoot groups, while transport hubs can develop mixed populations. Natural biomes affect mobility and livelihoods but do not directly determine ethnic identity or language.

An ethnic entity should carry a stable ID, origin region, name, related groups, language links, and migration provenance. Represent language families, languages, and their users separately. Each inhabited region stores ethnic population counts. A “leading ethnic group” array is only a display cache derived from those counts; its leading share may be below 50%. Cross-border groups and diasporas are summaries of the same composition data. Keep homeland and current residence distinct.

## Connections to other domains

Ethnicity can influence cultural contact and political integration costs, but it must not automatically create a matching state or religion. State borders can split ethnic distributions; official and locally used languages are separate data. A migration event must subtract residents at the origin and add them at the destination, preserving global population unless an explicit population-change cause is recorded. Selecting a region should show counts and shares; selecting a group should highlight its current distribution, origin, and relevant migration paths.
