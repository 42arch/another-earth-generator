import type { WorldMapReader } from '@another-earth/world-core'

export interface PolityCensusSettlement {
  readonly id: string
  readonly name: string
  readonly tier: string
  readonly population: number
  readonly isPort: boolean
}

export interface PolityCensus {
  readonly population: number
  readonly areaKm2: number
  readonly densityPerKm2: number
  readonly settlementCount: number
  readonly capitalCount: number
  readonly cityCount: number
  readonly townCount: number
  readonly villageCount: number
  readonly portCount: number
  readonly leadingSettlements: readonly PolityCensusSettlement[]
}

export interface PolityCensusInput {
  readonly regionCount: number
  readonly polityIndexAt: (region: number) => number
  readonly populationAt: (region: number) => number
  readonly areaKm2At: (region: number) => number
  readonly lakeIndexAt: (region: number) => number
  readonly polities: readonly { readonly id: string }[]
  readonly settlements: readonly {
    readonly id: string
    readonly name: string
    readonly polityId: string | null
    readonly tier?: string
    readonly population: number
    readonly isPort?: boolean
  }[]
}

const LEADING_SETTLEMENT_LIMIT = 4

/**
 * Country totals are not stored on a polity. Population is the sum of owned
 * land cells. Area skips lake cells, matching the territory tally used to
 * classify polity size. Settlement population is already inside the cell total.
 */
export function buildPolityCensus(input: PolityCensusInput): ReadonlyMap<string, PolityCensus> {
  const population = new Float64Array(input.polities.length)
  const areaKm2 = new Float64Array(input.polities.length)
  for (let region = 0; region < input.regionCount; region++) {
    const polityIndex = input.polityIndexAt(region)
    if (polityIndex < 0 || polityIndex >= input.polities.length)
      continue
    population[polityIndex] += input.populationAt(region)
    if (input.lakeIndexAt(region) < 0)
      areaKm2[polityIndex] += input.areaKm2At(region)
  }

  const settlementsByPolity = new Map<string, PolityCensusInput['settlements'][number][]>()
  for (const settlement of input.settlements) {
    if (!settlement.polityId)
      continue
    const list = settlementsByPolity.get(settlement.polityId)
    if (list)
      list.push(settlement)
    else
      settlementsByPolity.set(settlement.polityId, [settlement])
  }

  const byId = new Map<string, PolityCensus>()
  for (let index = 0; index < input.polities.length; index++) {
    const polity = input.polities[index]
    if (!polity)
      continue
    const owned = settlementsByPolity.get(polity.id) ?? []
    let capitalCount = 0
    let cityCount = 0
    let townCount = 0
    let villageCount = 0
    let portCount = 0
    for (const settlement of owned) {
      if (settlement.isPort)
        portCount++
      switch (settlement.tier) {
        case 'capital':
          capitalCount++
          break
        case 'city':
          cityCount++
          break
        case 'village':
          villageCount++
          break
        default:
          townCount++
          break
      }
    }
    const leading = [...owned].sort((a, b) => b.population - a.population || a.name.localeCompare(b.name))
    const landArea = areaKm2[index] ?? 0
    const people = population[index] ?? 0
    byId.set(polity.id, {
      population: people,
      areaKm2: landArea,
      densityPerKm2: landArea > 0 ? people / landArea : 0,
      settlementCount: owned.length,
      capitalCount,
      cityCount,
      townCount,
      villageCount,
      portCount,
      leadingSettlements: leading.slice(0, LEADING_SETTLEMENT_LIMIT).map(settlement => ({
        id: settlement.id,
        name: settlement.name,
        tier: settlement.tier ?? 'town',
        population: settlement.population,
        isPort: settlement.isPort === true,
      })),
    })
  }
  return byId
}

let cachedSnapshotId = ''
let cachedCensus: ReadonlyMap<string, PolityCensus> | null = null

export function polityCensusForReader(reader: WorldMapReader): ReadonlyMap<string, PolityCensus> {
  if (cachedCensus && cachedSnapshotId === reader.identity.snapshotId)
    return cachedCensus
  const owners = reader.field('dominantPolityIndex')
  const population = reader.field('population')
  const lakes = reader.field('lakeIndex')
  cachedSnapshotId = reader.identity.snapshotId
  cachedCensus = buildPolityCensus({
    regionCount: reader.mesh.regionCount,
    polityIndexAt: region => owners.get(region),
    populationAt: region => population.get(region),
    areaKm2At: region => reader.mesh.getRegionAreaKm2(region),
    lakeIndexAt: region => lakes.get(region),
    polities: reader.polities(),
    settlements: reader.settlements(),
  })
  return cachedCensus
}
