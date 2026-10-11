import type { GeneratedSphericalWorld } from '@/core/simulation/pipeline/types'
import type { WorldSummaryInfo } from '@/core/world/world-info'

export function buildWorldSummary(world: GeneratedSphericalWorld): WorldSummaryInfo {
  const civilization = world.data.civilization
  const routes = civilization?.transport?.routes ?? []

  return {
    regionCount: world.mesh.numRegions,
    triangleCount: world.mesh.numTriangles,
    plateCount: new Set(world.data.geology.regionSuperPlate).size,
    totalPopulation: civilization?.totalPopulation ?? 0,
    settlementCount: civilization?.settlements.length ?? 0,
    roadCount: routes.filter(route => route.kind === 'road').length,
    seaRouteCount: routes.filter(route => route.kind === 'sea').length,
    ethnicGroupCount: civilization?.ethnicity?.groups.length ?? 0,
    languageCount: civilization?.ethnicity?.languages.length ?? 0,
    polityCount: civilization?.polities?.polities.length ?? 0,
    districtCount: civilization?.polities?.districts.length ?? 0,
    religionCount: civilization?.religions?.religions.length ?? 0,
    sacredSiteCount: civilization?.religions?.sacredSites.length ?? 0,
  }
}
