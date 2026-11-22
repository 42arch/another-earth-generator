import type { TerrainArtifact } from '#generation/nature/geography'
import type { HydrologyArtifact } from '#generation/nature/hydrology/hydrology'
import type { StaticLakeArtifact } from '#generation/nature/hydrology/lakes'
import type { ResourcePotentialArtifact } from '#generation/nature/resources/resource-potential'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import type { CivilizationParameters, SettlementTier } from './civilization-types'
import type { HabitabilityArtifact } from './habitability'
import { DeterministicRandom } from '#math/random'
import { greatCircleDistanceKm } from '#math/spherical'
import { SETTLEMENT_SUPPORT_AREA_KM2 } from './civilization-scale'

export { REFERENCE_TRAVEL_KM_PER_DAY, SETTLEMENT_SUPPORT_AREA_KM2 } from './civilization-scale'

export const POPULATION_SETTLEMENTS_VERSION = 'population-settlements-v5' as const

/** Sum of the site-score weights below. Dividing by it maps a score onto [0, 1]. */
const SETTLEMENT_SCORE_WEIGHT_TOTAL = 1
const MIN_IMMIGRATION_SHARE = 0.16
const MAX_IMMIGRATION_SHARE = 0.56

export interface SettlementSite {
  readonly id: string
  readonly regionId: number
  readonly tier: Exclude<SettlementTier, 'capital'>
  readonly isPort: boolean
  readonly population: number
  readonly foundedAtYear: number
  readonly score: number
}

export interface PopulationSettlementsArtifact {
  readonly meshId: string
  readonly algorithmVersion: typeof POPULATION_SETTLEMENTS_VERSION
  readonly regionCount: number
  readonly enabled: boolean
  readonly population: Float64Array
  readonly settlementSites: readonly SettlementSite[]
}

export function generatePopulationSettlements(
  mesh: Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers' | 'areaKm2' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>,
  terrain: Pick<TerrainArtifact, 'meshId' | 'landMask' | 'slopeRadians'>,
  hydrology: Pick<HydrologyArtifact, 'meshId' | 'downstreamRegion' | 'riverIndex' | 'accumulatedAnnualFlowM3s'>,
  lakes: Pick<StaticLakeArtifact, 'meshId' | 'lakeIndex'>,
  resources: Pick<ResourcePotentialArtifact, 'meshId' | 'agriculturalPotential' | 'fisheryPotential' | 'mineralPotential'>,
  habitability: Pick<HabitabilityArtifact, 'meshId' | 'habitability' | 'carryingCapacityPerKm2' | 'coastalMask' | 'lakeShoreMask' | 'portPotential'>,
  params: Pick<CivilizationParameters, 'enabled' | 'populationScale' | 'settlementDensity' | 'urbanConcentration'>,
  worldSeed: string,
  check?: (fraction: number) => void,
): PopulationSettlementsArtifact {
  const n = mesh.regionCount
  if (!Number.isFinite(params.urbanConcentration) || params.urbanConcentration < 0 || params.urbanConcentration > 1)
    throw new Error('Invalid urban concentration')
  if (!n || terrain.meshId !== mesh.meshId || hydrology.meshId !== mesh.meshId || lakes.meshId !== mesh.meshId || resources.meshId !== mesh.meshId || habitability.meshId !== mesh.meshId)
    throw new Error('Population and settlements stage received mismatched mesh artifacts')

  const population = new Float64Array(n)
  if (!params.enabled) {
    check?.(1)
    return {
      meshId: mesh.meshId,
      algorithmVersion: POPULATION_SETTLEMENTS_VERSION,
      regionCount: n,
      enabled: false,
      population,
      settlementSites: [],
    }
  }

  const rng = new DeterministicRandom(JSON.stringify([worldSeed, POPULATION_SETTLEMENTS_VERSION]))
  const upstreamRiverCount = new Uint8Array(n)
  for (let r = 0; r < n; r++) {
    const down = hydrology.downstreamRegion[r]
    if (down >= 0 && down < n && hydrology.riverIndex[r] >= 0)
      upstreamRiverCount[down]++
  }

  const candidateSites: { region: number, score: number, isPort: boolean }[] = []
  let inhabitedLandCount = 0
  let inhabitedAreaKm2 = 0

  for (let r = 0; r < n; r++) {
    if ((r & 1023) === 0)
      check?.((r / n) * 0.6)
    const hab = habitability.habitability[r]
    const cap = habitability.carryingCapacityPerKm2[r]
    if (terrain.landMask[r] !== 1 || lakes.lakeIndex[r] >= 0 || hab <= 0.01 || cap <= 0)
      continue

    const noise = 0.88 + rng.nextFloat() * 0.24
    const pop = Math.round(mesh.areaKm2[r] * cap * params.populationScale * noise)
    if (pop <= 0)
      continue
    population[r] = pop
    inhabitedLandCount++
    inhabitedAreaKm2 += mesh.areaKm2[r]!

    const isConfluence = upstreamRiverCount[r] >= 2
    const isPort = habitability.portPotential[r]! >= 0.5 && hab >= 0.14

    // Food, minerals, energy and access already enter the period-specific
    // habitability. Do not reward the same coast/resource a second time.
    const score = hab * 0.9
      + (isConfluence ? 0.06 : 0)
      + rng.nextFloat() * 0.04

    if (hab >= 0.12 && (pop / mesh.areaKm2[r]!) * SETTLEMENT_SUPPORT_AREA_KM2 >= 40)
      candidateSites.push({ region: r, score, isPort })
  }

  candidateSites.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.region - b.region))

  const referenceCells = inhabitedAreaKm2 / SETTLEMENT_SUPPORT_AREA_KM2
  const targetCount = inhabitedLandCount < 2
    ? inhabitedLandCount
    : Math.min(candidateSites.length, Math.max(2, Math.min(Math.floor(referenceCells * 0.22), Math.round(Math.sqrt(referenceCells) * 2.2 * params.settlementDensity))))

  const minSpacingKm = Math.max(Math.sqrt(SETTLEMENT_SUPPORT_AREA_KM2) * (2.1 / Math.sqrt(params.settlementDensity)), mesh.physicalRadiusKm * (0.042 / Math.sqrt(params.settlementDensity)))

  const selected: { region: number, score: number, isPort: boolean }[] = []
  const vecA = { x: 0, y: 0, z: 0 }
  const vecB = { x: 0, y: 0, z: 0 }

  const pickWithSpacing = (spacingKm: number) => {
    for (const candidate of candidateSites) {
      if (selected.length >= targetCount)
        break
      if (selected.some(item => item.region === candidate.region))
        continue
      vecA.x = mesh.centers[3 * candidate.region]
      vecA.y = mesh.centers[3 * candidate.region + 1]
      vecA.z = mesh.centers[3 * candidate.region + 2]
      let tooClose = false
      for (const existing of selected) {
        vecB.x = mesh.centers[3 * existing.region]
        vecB.y = mesh.centers[3 * existing.region + 1]
        vecB.z = mesh.centers[3 * existing.region + 2]
        if (greatCircleDistanceKm(vecA, vecB, mesh.physicalRadiusKm) < spacingKm) {
          tooClose = true
          break
        }
      }
      if (!tooClose)
        selected.push(candidate)
    }
  }

  pickWithSpacing(minSpacingKm)
  if (selected.length < Math.min(2, candidateSites.length))
    pickWithSpacing(Math.sqrt(SETTLEMENT_SUPPORT_AREA_KM2) * 0.9)

  selected.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.region - b.region))

  const siteRng = rng.fork('settlement-sites')
  // The support disc is about 63 km across. Searching twice as far covers an
  // equal area of land even when only a quarter of the directions are land,
  // so a straight coast can still fill the same target as an inland site.
  const supportRadiusKm = Math.sqrt(SETTLEMENT_SUPPORT_AREA_KM2 / Math.PI)
  const maxRecruitRadiusKm = supportRadiusKm * 2
  const baselinePopulation = population.slice()
  const recruited = new Float64Array(n)
  const settlementSites: SettlementSite[] = selected.map((site) => {
    const localDensity = baselinePopulation[site.region]! / mesh.areaKm2[site.region]!
    const supportedPopulation = localDensity * SETTLEMENT_SUPPORT_AREA_KM2
    const scoreShare = Math.min(1, Math.max(0, site.score / SETTLEMENT_SCORE_WEIGHT_TOTAL))
    const immigrationShare = Math.min(MAX_IMMIGRATION_SHARE, MIN_IMMIGRATION_SHARE + (MAX_IMMIGRATION_SHARE - MIN_IMMIGRATION_SHARE) * scoreShare * (params.urbanConcentration / 0.5))
    const desiredPopulation = Math.max(10, Math.round(supportedPopulation * immigrationShare))
    // Higher-scoring sites are served first and may search farther. Each donor
    // keeps at least 44% of its original residents, so a city cannot empty the
    // cells around it. Sea cells hold nobody and are walked past, not deducted.
    let needed = Math.max(0, desiredPopulation - population[site.region]!)
    if (needed > 0) {
      const seen = new Set<number>([site.region])
      const frontier = [site.region]
      const donors: { region: number, distance: number }[] = []
      for (let head = 0; head < frontier.length; head++) {
        const u = frontier[head]!
        for (let e = mesh.neighborOffsets[u]; e < mesh.neighborOffsets[u + 1]; e++) {
          const v = mesh.neighbors[e]!
          if (seen.has(v))
            continue
          seen.add(v)
          if (terrain.landMask[v] !== 1)
            continue
          const distance = greatCircleDistanceKm(
            { x: mesh.centers[3 * site.region], y: mesh.centers[3 * site.region + 1], z: mesh.centers[3 * site.region + 2] },
            { x: mesh.centers[3 * v], y: mesh.centers[3 * v + 1], z: mesh.centers[3 * v + 2] },
            mesh.physicalRadiusKm,
          )
          if (distance > maxRecruitRadiusKm * scoreShare * (0.5 + params.urbanConcentration))
            continue
          frontier.push(v)
          const available = Math.min(
            baselinePopulation[v]! * immigrationShare,
            baselinePopulation[v]! * MAX_IMMIGRATION_SHARE - recruited[v]!,
          )
          if (available > 0)
            donors.push({ region: v, distance })
        }
      }
      donors.sort((a, b) => a.distance - b.distance || a.region - b.region)
      for (const donor of donors) {
        const available = Math.min(
          baselinePopulation[donor.region]! * immigrationShare,
          baselinePopulation[donor.region]! * MAX_IMMIGRATION_SHARE - recruited[donor.region]!,
        )
        const moved = Math.min(needed, Math.max(0, available))
        if (moved <= 0)
          continue
        population[donor.region] = population[donor.region]! - moved
        population[site.region] = population[site.region]! + moved
        recruited[donor.region] = recruited[donor.region]! + moved
        needed -= moved
        if (needed <= 0)
          break
      }
    }
    const settlementPop = Math.min(population[site.region]!, desiredPopulation)
    const tier: SettlementSite['tier'] = settlementPop >= 1200
      ? 'city'
      : settlementPop >= 400
        ? 'town'
        : 'village'
    const foundedAtYear = -Math.round((120 + siteRng.nextInt(0, 1400)) * (tier === 'city' ? 1.25 : tier === 'town' ? 1.0 : 0.7))
    return {
      id: `settlement:${site.region}`,
      regionId: site.region,
      tier,
      isPort: site.isPort,
      population: settlementPop,
      foundedAtYear,
      score: site.score,
    }
  })

  check?.(1)
  return {
    meshId: mesh.meshId,
    algorithmVersion: POPULATION_SETTLEMENTS_VERSION,
    regionCount: n,
    enabled: true,
    population,
    settlementSites,
  }
}

export function validatePopulationSettlementsArtifact(output: PopulationSettlementsArtifact): void {
  const n = output.regionCount
  if (!output.meshId || output.algorithmVersion !== POPULATION_SETTLEMENTS_VERSION || !Number.isInteger(n) || n < 1)
    throw new Error('Invalid population settlements metadata')
  if (!(output.population instanceof Float64Array) || output.population.length !== n)
    throw new Error('Population array dtype or length mismatch')
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(output.population[i]) || output.population[i] < 0)
      throw new Error(`Invalid population at region ${i}`)
  }
  if (!output.enabled && (output.settlementSites.length > 0 || output.population.some(v => v !== 0)))
    throw new Error('Disabled civilization must emit zero population and empty settlements')
  const siteIds = new Set<string>()
  const urbanTotals = new Map<number, number>()
  for (const site of output.settlementSites) {
    if (!site.id || siteIds.has(site.id) || !Number.isSafeInteger(site.regionId) || site.regionId < 0 || site.regionId >= n)
      throw new Error('Invalid settlement site identity or region')
    siteIds.add(site.id)
    if (!Number.isFinite(site.population) || site.population < 0 || !Number.isFinite(site.foundedAtYear))
      throw new Error('Invalid settlement site population or year')
    urbanTotals.set(site.regionId, (urbanTotals.get(site.regionId) ?? 0) + site.population)
  }
  for (const [regionId, urban] of urbanTotals) {
    if (urban > output.population[regionId]! + Math.max(1e-6, output.population[regionId]! * 1e-9))
      throw new Error(`Settlement population exceeds region population at ${regionId}`)
  }
}
