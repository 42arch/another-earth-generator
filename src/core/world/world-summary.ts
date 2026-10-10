import type { GeneratedSphericalWorld } from '@/core/simulation/pipeline/types'
import type { WorldSummaryInfo } from '@/core/world/world-info'

export function buildWorldSummary(world: GeneratedSphericalWorld): WorldSummaryInfo {
  const society = world.data.society
  const routes = society?.transport?.routes ?? []

  return {
    regionCount: world.mesh.numRegions,
    triangleCount: world.mesh.numTriangles,
    plateCount: new Set(world.data.geology.regionSuperPlate).size,
    totalPopulation: society?.totalPopulation ?? 0,
    settlementCount: society?.settlements.length ?? 0,
    roadCount: routes.filter(route => route.kind === 'road').length,
    seaRouteCount: routes.filter(route => route.kind === 'sea').length,
    ethnicGroupCount: society?.ethnicity?.groups.length ?? 0,
    languageCount: society?.ethnicity?.languages.length ?? 0,
    polityCount: society?.polities?.polities.length ?? 0,
    districtCount: society?.polities?.districts.length ?? 0,
    religionCount: society?.religions?.religions.length ?? 0,
    sacredSiteCount: society?.religions?.sacredSites.length ?? 0,
  }
}
