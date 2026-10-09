# 06 · Religions and Beliefs

[English](./06-religions-and-beliefs.md) | [简体中文](./06-religions-and-beliefs.zh-CN.md)

> Status: the first release generates religion entities, nearby same-land branches, origin sacred sites, exclusive primary affiliation, and unaffiliated residents. Historical events and overlapping practices remain planned.

## Intuitive understanding

A religion may begin in one city, spread along trade routes, cross ethnic and national boundaries, and form branches. A state may support one faith, but an official religion is not the belief of every resident.

## Origins and spread

Choose origins or religious centers among existing settlements, then spread through migration, roads, ports, and urban contact. Community transmission retains some affiliation among migrants; institutions and sacred sites increase contact; polity policy changes propagation conditions. Spread should depend on resident population and opportunities for contact. Transport and policy provide pathways, not a rule forcing everyone of one ethnicity or state into the same faith.

A religion entity can record an origin, name, related denominations, institutional centers, and sacred sites. Parent-child relations express branching, while local synthesis can retain provenance. Resident cohorts should include primary religious affiliation and count, reconciling with the population total; “unaffiliated” needs an explicit category. If the first release uses exclusive primary affiliation, label shares accordingly. Multiple simultaneous practices need a separate model; overlapping participation shares should not be forced to add to 100%.

## Layers and acceptance

The religion base map can show the largest resident affiliation and its share. Desaturated color or a separate diversity measure can indicate mixed regions. Sacred sites are optional point overlays, and polity borders can remain visible on the religion map. Aggregate statistics by residents, not by the number of cells bearing a leading label. Cross-border spread needs a reachable route or historical event. Selecting a religion should show its origin, centers, main corridors, and resident distribution.

## Current implementation

`ReligionsAndBeliefs` follows polities. Origins are selected from settlements by hinterland population and market access, with at least one origin on each inhabited land component that has a settlement. A later nearby origin on the same land component may retain a parent-religion link. Each origin creates an optional sacred-site marker. Ethnicity, language, and polity do not directly determine a resident's religion.

Religions spread over adjacent land and selected port-to-port sea routes. Roads, market contact, and polity patronage lower cost; borders modestly raise it. Residents of the originating ethnic group provide only a small inheritance weight. Each region retains up to three leading influences plus an explicit unaffiliated category, then allocates its authoritative resident population to exclusive primary affiliations. A polity patronizes the first selected origin in its territory, which does not imply universal adherence. Ocean and uninhabited land have no belief population; statistics aggregate residents rather than leading-map cells.

Branch relationships, patronage, and affiliation are static model outputs. The stage does not yet model timelines, policy choice, joint ethnicity/religion cohorts, conversion events, overlapping practices, or later pilgrimage networks. Sacred sites currently mark origin settlements only.
