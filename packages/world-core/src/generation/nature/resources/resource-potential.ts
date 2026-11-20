import type { ContentId, ResourceDefinitionView } from '#content/content-port'
import type { ClimateArtifact } from '#generation/nature/climate/climate'
import type { EcologyArtifact } from '#generation/nature/ecology/ecology'
import type { TerrainArtifact } from '#generation/nature/geography'
import type { GeologyArtifact } from '#generation/nature/geology'
import type { HydrologyArtifact } from '#generation/nature/hydrology/hydrology'
import type { ResourceDeposit } from '#generation/nature/nature-types'
import type { SphericalMesh } from '#mesh/spherical-mesh'
import { DeterministicRandom } from '#math/random'
import { greatCircleDistanceKm } from '#math/spherical'

export const RESOURCE_POTENTIAL_VERSION = 'resource-potential-v1' as const

export interface ResourcePotentialArtifact {
  readonly meshId: string
  readonly algorithmVersion: typeof RESOURCE_POTENTIAL_VERSION
  readonly regionCount: number
  readonly resourceIds: readonly ContentId[]
  readonly agriculturalPotential: Float32Array
  readonly forestryPotential: Float32Array
  readonly fisheryPotential: Float32Array
  readonly mineralPotential: Float32Array
  readonly energyPotential: Float32Array
  readonly deposits: readonly ResourceDeposit[]
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}

function smoothBand(value: number, low: number, optLow: number, optHigh: number, high: number): number {
  if (value <= low || value >= high)
    return 0
  if (value >= optLow && value <= optHigh)
    return 1
  if (value < optLow)
    return (value - low) / (optLow - low)
  return (high - value) / (high - optHigh)
}

function biomeCodeOf(ecology: Pick<EcologyArtifact, 'potentialBiomeIds' | 'potentialBiomeIndex'>, region: number): string {
  const idx = ecology.potentialBiomeIndex[region]
  const id = ecology.potentialBiomeIds[idx] ?? ''
  const slash = id.lastIndexOf('/')
  return slash >= 0 ? id.slice(slash + 1) : id
}

function landCoverCodeOf(ecology: Pick<EcologyArtifact, 'landCoverIds' | 'landCoverIndex'>, region: number): string {
  const idx = ecology.landCoverIndex[region]
  const id = ecology.landCoverIds[idx] ?? ''
  const slash = id.lastIndexOf('/')
  return slash >= 0 ? id.slice(slash + 1) : id
}

function distanceFromCoastHop(mesh: Pick<SphericalMesh, 'regionCount' | 'neighborOffsets' | 'neighbors'>, landMask: Uint8Array, maxHops = 5): { landFromSea: Uint8Array, seaFromLand: Uint8Array } {
  const n = mesh.regionCount
  const landFromSea = new Uint8Array(n).fill(255)
  const seaFromLand = new Uint8Array(n).fill(255)
  const landQueue: number[] = []
  const seaQueue: number[] = []
  for (let r = 0; r < n; r++) {
    const isLand = landMask[r] === 1
    let touchesOpposite = false
    for (let e = mesh.neighborOffsets[r]; e < mesh.neighborOffsets[r + 1]; e++) {
      const nb = mesh.neighbors[e]
      if ((landMask[nb] === 1) !== isLand) {
        touchesOpposite = true
        break
      }
    }
    if (touchesOpposite) {
      if (isLand) {
        landFromSea[r] = 1
        landQueue.push(r)
      }
      else {
        seaFromLand[r] = 1
        seaQueue.push(r)
      }
    }
  }
  for (let head = 0; head < landQueue.length; head++) {
    const r = landQueue[head]!
    const d = landFromSea[r]
    if (d >= maxHops)
      continue
    for (let e = mesh.neighborOffsets[r]; e < mesh.neighborOffsets[r + 1]; e++) {
      const nb = mesh.neighbors[e]
      if (landMask[nb] === 1 && landFromSea[nb] > d + 1) {
        landFromSea[nb] = d + 1
        landQueue.push(nb)
      }
    }
  }
  for (let head = 0; head < seaQueue.length; head++) {
    const r = seaQueue[head]!
    const d = seaFromLand[r]
    if (d >= maxHops)
      continue
    for (let e = mesh.neighborOffsets[r]; e < mesh.neighborOffsets[r + 1]; e++) {
      const nb = mesh.neighbors[e]
      if (landMask[nb] === 0 && seaFromLand[nb] > d + 1) {
        seaFromLand[nb] = d + 1
        seaQueue.push(nb)
      }
    }
  }
  return { landFromSea, seaFromLand }
}

function scoreDepositRegion(
  def: ResourceDefinitionView,
  region: number,
  terrain: Pick<TerrainArtifact, 'landMask' | 'elevationKm' | 'slopeRadians' | 'boundaryType' | 'stress' | 'volcanicCoordinate' | 'depositionCoordinate' | 'foldBelt'>,
  geology: Pick<GeologyArtifact, 'crustType' | 'thicknessKm'>,
  hydrology: Pick<HydrologyArtifact, 'riverIndex' | 'accumulatedAnnualFlowM3s'>,
  agriculturalPotential: Float32Array,
  forestryPotential: Float32Array,
  fisheryPotential: Float32Array,
  landFromSea: Uint8Array,
): { score: number, primaryFactor: string } {
  const tags = new Set(def.geologyTags)
  const isLand = terrain.landMask[region] === 1
  if (def.category === 'biological' && tags.has('coastal')) {
    const fish = fisheryPotential[region]
    if (fish <= 0.15)
      return { score: 0, primaryFactor: 'coastal-upwelling' }
    const factor = isLand ? 'estuary-fisheries' : 'coastal-upwelling'
    return { score: fish, primaryFactor: factor }
  }
  if (!isLand)
    return { score: 0, primaryFactor: 'none' }

  if (def.category === 'biological') {
    if (tags.has('forest') || tags.has('temperate') || tags.has('boreal')) {
      return { score: forestryPotential[region], primaryFactor: 'dense-forest-biome' }
    }
    const agri = agriculturalPotential[region]
    const riverBonus = hydrology.riverIndex[region] >= 0 ? 0.15 : 0
    return { score: clamp01(agri * 0.9 + riverBonus), primaryFactor: riverBonus > 0 ? 'alluvial-river-plain' : 'fertile-lowland' }
  }

  const boundary = terrain.boundaryType[region]
  const orogenSignal = clamp01(Math.max(boundary === 1 ? 0.55 : 0, terrain.foldBelt[region] * 0.7 + terrain.stress[region] * 0.35))
  const volcanicSignal = clamp01(Math.max(terrain.volcanicCoordinate[region], boundary === 1 ? 0.3 : 0, boundary === 2 ? 0.35 : 0))
  const shieldSignal = clamp01(geology.crustType[region] === 1
    ? (1 - volcanicSignal * 0.6) * clamp01((geology.thicknessKm[region] - 26) / 22) * (1 - clamp01(terrain.slopeRadians[region] / 0.25) * 0.3)
    : 0)
  const basinSignal = clamp01(
    clamp01(terrain.depositionCoordinate[region] * 1.6) * 0.55
    + clamp01(1 - terrain.elevationKm[region] / 1.5) * 0.3
    + (1 - clamp01(terrain.slopeRadians[region] / 0.18)) * 0.15,
  )

  if (def.category === 'energy') {
    const score = clamp01(
      (tags.has('basin') || tags.has('sedimentary') || tags.has('foreland') ? basinSignal * 0.78 : basinSignal * 0.45)
      + (terrain.foldBelt[region] > 0.1 ? 0.18 : 0)
      + (landFromSea[region] <= 3 ? 0.08 : 0),
    )
    const primaryFactor = basinSignal >= 0.45 ? 'sedimentary-basin' : 'foreland-depression'
    return { score, primaryFactor }
  }

  // Mineral deposits
  let score = 0
  let primaryFactor = 'continental-shield'
  if (tags.has('volcanic-arc') || tags.has('hotspot')) {
    score = clamp01(volcanicSignal * 0.65 + orogenSignal * 0.35)
    primaryFactor = volcanicSignal >= orogenSignal ? 'volcanic-arc' : 'convergent-orogen'
  }
  else if (tags.has('orogen') && tags.has('continental-shield')) {
    score = clamp01(Math.max(orogenSignal * 0.85, shieldSignal * 0.8) + 0.15 * Math.min(orogenSignal, shieldSignal))
    primaryFactor = orogenSignal >= shieldSignal ? 'convergent-orogen' : 'continental-shield'
  }
  else {
    score = clamp01(orogenSignal * 0.45 + volcanicSignal * 0.3 + shieldSignal * 0.25)
    primaryFactor = orogenSignal >= volcanicSignal ? 'orogen-belt' : 'tectonic-magmatism'
  }
  if (terrain.elevationKm[region] > 4.5)
    score *= 0.85
  return { score, primaryFactor }
}

export function generateResourcePotential(
  resources: readonly ResourceDefinitionView[],
  mesh: Pick<SphericalMesh, 'meshId' | 'regionCount' | 'centers' | 'areaKm2' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>,
  geology: Pick<GeologyArtifact, 'meshId' | 'crustType' | 'thicknessKm'>,
  terrain: Pick<TerrainArtifact, 'meshId' | 'elevationKm' | 'landMask' | 'slopeRadians' | 'boundaryType' | 'stress' | 'volcanicCoordinate' | 'depositionCoordinate' | 'foldBelt'>,
  climate: Pick<ClimateArtifact, 'meshId' | 'annualMeanTemperatureC' | 'annualPrecipitationMm' | 'oceanReference' | 'referenceRegionCount' | 'circulation' | 'projectedCirculation'>,
  hydrology: Pick<HydrologyArtifact, 'meshId' | 'riverIndex' | 'accumulatedAnnualFlowM3s'>,
  ecology: Pick<EcologyArtifact, 'meshId' | 'potentialBiomeIds' | 'landCoverIds' | 'potentialBiomeIndex' | 'landCoverIndex' | 'aridityIndex' | 'growingSeasonMonths'>,
  worldSeed: string,
  check?: (fraction: number) => void,
): ResourcePotentialArtifact {
  const n = mesh.regionCount
  if (!n || terrain.meshId !== mesh.meshId || geology.meshId !== mesh.meshId || climate.meshId !== mesh.meshId || hydrology.meshId !== mesh.meshId || ecology.meshId !== mesh.meshId)
    throw new Error('Resource potential stage received mismatched mesh artifacts')

  const sortedResources = [...resources].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const resourceIds = Object.freeze(sortedResources.map(item => item.id as ContentId))
  const agriculturalPotential = new Float32Array(n)
  const forestryPotential = new Float32Array(n)
  const fisheryPotential = new Float32Array(n)
  const mineralPotential = new Float32Array(n)
  const energyPotential = new Float32Array(n)
  const { landFromSea, seaFromLand } = distanceFromCoastHop(mesh, terrain.landMask, 5)

  for (let r = 0; r < n; r++) {
    if ((r & 1023) === 0)
      check?.((r / n) * 0.55)
    const isLand = terrain.landMask[r] === 1
    const biome = biomeCodeOf(ecology, r)
    const cover = landCoverCodeOf(ecology, r)

    if (isLand) {
      const tempScore = smoothBand(climate.annualMeanTemperatureC[r], -2, 10, 24, 34)
      const growthScore = clamp01(ecology.growingSeasonMonths[r] / 8)
      const moistureScore = smoothBand(ecology.aridityIndex[r], 0.12, 0.55, 1.8, 3.6)
      const slopeScore = clamp01(1 - terrain.slopeRadians[r] / 0.28)
      const elevationScore = clamp01(1 - Math.max(0, terrain.elevationKm[r] - 0.3) / 2.8)
      const alluvialBonus = clamp01(terrain.depositionCoordinate[r] * 1.5) * 0.22 + (hydrology.riverIndex[r] >= 0 ? 0.16 : 0)
      const biomeMul = biome === 'IceSheet' || biome === 'AlpineTundra' || biome === 'Tundra'
        ? 0.02
        : biome === 'HotDesert' || biome === 'ColdDesert'
          ? (hydrology.riverIndex[r] >= 0 ? 0.35 : 0.04)
          : 1
      agriculturalPotential[r] = clamp01((tempScore * 0.28 + growthScore * 0.24 + moistureScore * 0.26 + slopeScore * 0.12 + elevationScore * 0.1) * biomeMul + alluvialBonus * biomeMul)

      const forestCoverBase = cover === 'Forest'
        ? 0.85
        : cover === 'Savanna'
          ? 0.42
          : cover === 'Shrubland'
            ? 0.26
            : cover === 'Grassland'
              ? 0.15
              : 0
      const forestSlope = clamp01(1 - Math.max(0, terrain.slopeRadians[r] - 0.12) / 0.45)
      const precipBonus = smoothBand(climate.annualPrecipitationMm[r], 200, 750, 2600, 4800)
      forestryPotential[r] = clamp01(forestCoverBase * (0.55 + 0.3 * precipBonus + 0.15 * forestSlope))

      const coastalAccess = landFromSea[r] === 1 ? 0.78 : landFromSea[r] === 2 ? 0.28 : 0
      const riverEstuary = landFromSea[r] === 1 && hydrology.riverIndex[r] >= 0 ? 0.22 : 0
      const riverFishery = hydrology.riverIndex[r] >= 0 ? clamp01(Math.log10(Math.max(10, hydrology.accumulatedAnnualFlowM3s[r])) / 5) * 0.4 : 0
      const tempMarine = smoothBand(climate.annualMeanTemperatureC[r], -4, 4, 24, 33)
      fisheryPotential[r] = clamp01((coastalAccess + riverEstuary + riverFishery * 0.6) * (0.45 + 0.55 * tempMarine))

      const orogen = clamp01(Math.max(terrain.boundaryType[r] === 1 ? 0.55 : 0, terrain.foldBelt[r] * 0.65 + terrain.stress[r] * 0.35))
      const volcanic = clamp01(terrain.volcanicCoordinate[r])
      const shield = geology.crustType[r] === 1 ? clamp01((geology.thicknessKm[r] - 25) / 22) : 0
      mineralPotential[r] = clamp01(orogen * 0.5 + volcanic * 0.3 + shield * 0.2)
      energyPotential[r] = clamp01(clamp01(terrain.depositionCoordinate[r] * 1.5) * 0.6 + (terrain.foldBelt[r] > 0.1 ? 0.2 : 0) + (elevationScore * 0.2))
    }
    else {
      const seaHop = seaFromLand[r]
      if (seaHop <= 4) {
        const shelfFactor = seaHop === 1 ? 0.85 : seaHop === 2 ? 0.58 : seaHop === 3 ? 0.32 : 0.14
        const lat = Math.abs(Math.asin(Math.max(-1, Math.min(1, mesh.centers[3 * r + 1]))))
        const upwellingFactor = smoothBand(lat, 0.05, 0.25, 1.05, 1.48)
        let warmthGradient = 0
        const oceanRef = climate.oceanReference[r]
        if (oceanRef >= 0) {
          const source = climate.projectedCirculation ? r : oceanRef
          const count = climate.projectedCirculation ? n : climate.referenceRegionCount
          const warmth = (climate.projectedCirculation ?? climate.circulation).oceanWarmth
          let sum = 0
          for (let s = 0; s < 4; s++)
            sum += Math.abs(warmth[s * count + source] ?? 0)
          warmthGradient = clamp01((sum / 4) * 1.5)
        }
        fisheryPotential[r] = clamp01(shelfFactor * (0.55 + 0.3 * upwellingFactor + 0.15 * warmthGradient))
      }
    }
  }

  // Select well-spaced deposits for each resource definition
  const deposits: ResourceDeposit[] = []
  const meanRegionAreaKm2 = mesh.areaKm2.reduce((sum, a) => sum + a, 0) / n
  const spacingKm = Math.max(Math.sqrt(meanRegionAreaKm2) * 3.2, mesh.physicalRadiusKm * 0.09)
  const targetMaxPerResource = Math.max(4, Math.min(36, Math.round(Math.sqrt(n) * 0.45)))
  const rng = new DeterministicRandom(JSON.stringify([worldSeed, RESOURCE_POTENTIAL_VERSION, 'deposits']))

  const vecA = { x: 0, y: 0, z: 0 }
  const vecB = { x: 0, y: 0, z: 0 }

  for (let idx = 0; idx < sortedResources.length; idx++) {
    const def = sortedResources[idx]!
    check?.(0.55 + ((idx + 1) / Math.max(1, sortedResources.length)) * 0.4)
    const defRng = rng.fork(def.id)
    const candidates: { region: number, score: number, primaryFactor: string }[] = []

    for (let r = 0; r < n; r++) {
      const { score, primaryFactor } = scoreDepositRegion(
        def,
        r,
        terrain,
        geology,
        hydrology,
        agriculturalPotential,
        forestryPotential,
        fisheryPotential,
        landFromSea,
      )
      if (score >= 0.38)
        candidates.push({ region: r, score: score + defRng.nextFloat() * 0.06, primaryFactor })
    }
    candidates.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.region - b.region))

    const chosen: number[] = []
    for (const candidate of candidates) {
      if (chosen.length >= targetMaxPerResource)
        break
      vecA.x = mesh.centers[3 * candidate.region]
      vecA.y = mesh.centers[3 * candidate.region + 1]
      vecA.z = mesh.centers[3 * candidate.region + 2]
      let tooClose = false
      for (const other of chosen) {
        vecB.x = mesh.centers[3 * other]
        vecB.y = mesh.centers[3 * other + 1]
        vecB.z = mesh.centers[3 * other + 2]
        if (greatCircleDistanceKm(vecA, vecB, mesh.physicalRadiusKm) < spacingKm) {
          tooClose = true
          break
        }
      }
      if (tooClose)
        continue
      chosen.push(candidate.region)
      deposits.push({
        id: `deposit:${def.id}:${candidate.region}`,
        resourceId: def.id as ContentId,
        regionId: candidate.region,
        category: def.category,
        richness: clamp01(Math.max(0.2, candidate.score)),
        primaryFactor: candidate.primaryFactor,
      })
    }
  }

  check?.(1)
  return {
    meshId: mesh.meshId,
    algorithmVersion: RESOURCE_POTENTIAL_VERSION,
    regionCount: n,
    resourceIds,
    agriculturalPotential,
    forestryPotential,
    fisheryPotential,
    mineralPotential,
    energyPotential,
    deposits,
  }
}

export function validateResourcePotentialArtifact(output: ResourcePotentialArtifact): void {
  const n = output.regionCount
  if (!output.meshId || output.algorithmVersion !== RESOURCE_POTENTIAL_VERSION || !Number.isInteger(n) || n < 1)
    throw new Error('Invalid resource potential metadata')
  for (const field of [output.agriculturalPotential, output.forestryPotential, output.fisheryPotential, output.mineralPotential, output.energyPotential]) {
    if (!(field instanceof Float32Array) || field.length !== n)
      throw new Error('Resource potential field dtype or length mismatch')
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(field[i]) || field[i] < 0 || field[i] > 1)
        throw new Error(`Invalid resource potential value at ${i}`)
    }
  }
  const declared = new Set(output.resourceIds)
  const depositIds = new Set<string>()
  for (const deposit of output.deposits) {
    if (!deposit.id || depositIds.has(deposit.id) || !declared.has(deposit.resourceId))
      throw new Error('Invalid or duplicate deposit identity')
    depositIds.add(deposit.id)
    if (!Number.isSafeInteger(deposit.regionId) || deposit.regionId < 0 || deposit.regionId >= n)
      throw new Error('Invalid deposit region')
    if (!Number.isFinite(deposit.richness) || deposit.richness <= 0 || deposit.richness > 1 || !deposit.primaryFactor.trim())
      throw new Error('Invalid deposit richness or factor')
  }
}
