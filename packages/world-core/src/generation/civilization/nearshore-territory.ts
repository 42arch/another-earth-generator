import type { SphericalMesh } from '#mesh/spherical-mesh'
import { IndexPriorityQueue } from '#generation/nature/common/priority-queue'
import { greatCircleDistanceKm } from '#math/spherical'
import { SETTLEMENT_SUPPORT_AREA_KM2 } from './civilization-scale'

export interface MaritimeTerritoryOptions {
  /** Max weighted water/crossing budget in km. `<= 0` disables sea projection. */
  readonly maxWaterBudgetKm: number
  /** Multiplier applied to water edge costs (e.g. from administrative capacity). Defaults to 1. */
  readonly seaCostMultiplier?: number
  /** Extra weighted cost added when re-entering sea from an acquired island. Omit to disable island hopping. */
  readonly islandHopPenaltyKm?: number
  /** Optional priority launch mask (e.g. owned ports) that starts at cost 0. */
  readonly prioritySourceMask?: Uint8Array
  /** Initial cost penalty in km for non-priority owned coastal regions when prioritySourceMask is set. */
  readonly nonPriorityPenaltyKm?: number
  /** Optional per-region traversal resistance (> 0). Defaults to 1 when omitted. */
  readonly movementCost?: Float32Array
  /** Optional per-polity multiplier applied to sea crossings (e.g. from mercantile/industrial traits). */
  readonly politySeaCostFactors?: readonly number[]
  /** Optional cooperative progress/cancellation callback. */
  readonly check?: () => void
}

/**
 * Projects maritime territorial claims from already-owned coasts onto unowned islands.
 *
 * Pass 1 searches across sea cells (and optionally across newly reached islands within
 * the cumulative budget) up to `maxWaterBudgetKm`.
 * Pass 2 partitions every reached unowned landmass completely with no inland distance cap,
 * so partially claimed islands cannot occur and existing territory remains untouched.
 */
export function claimMaritimeTerritory(
  mesh: Pick<SphericalMesh, 'regionCount' | 'centers' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>,
  landMask: Uint8Array,
  regionPolity: Int32Array,
  options: MaritimeTerritoryOptions,
): void {
  const n = mesh.regionCount
  const maxBudget = options.maxWaterBudgetKm
  if (!n || !Number.isFinite(maxBudget) || maxBudget <= 0)
    return

  const seaCostMultiplier = options.seaCostMultiplier ?? 1
  const allowHopping = options.islandHopPenaltyKm !== undefined && Number.isFinite(options.islandHopPenaltyKm)
  const islandHopPenaltyKm = allowHopping ? Math.max(0, options.islandHopPenaltyKm!) : Infinity
  const prioritySourceMask = options.prioritySourceMask
  const nonPriorityPenaltyKm = prioritySourceMask ? Math.max(0, options.nonPriorityPenaltyKm ?? 0) : 0
  const movementCost = options.movementCost
  const politySeaCostFactors = options.politySeaCostFactors
  const politySeaFactorOf = (polity: number): number => {
    const f = politySeaCostFactors?.[polity]
    return f !== undefined && Number.isFinite(f) && f > 0 ? f : 1
  }
  const check = options.check

  const distance = new Float32Array(n).fill(Infinity)
  const owner = new Int32Array(n).fill(-1)
  const processed = new Uint8Array(n)
  const queue = new IndexPriorityQueue(Math.min(n, 8192))
  const a = { x: 0, y: 0, z: 0 }
  const b = { x: 0, y: 0, z: 0 }

  const stepDistance = (u: number, v: number): number => {
    a.x = mesh.centers[3 * u]
    a.y = mesh.centers[3 * u + 1]
    a.z = mesh.centers[3 * u + 2]
    b.x = mesh.centers[3 * v]
    b.y = mesh.centers[3 * v + 1]
    b.z = mesh.centers[3 * v + 2]
    return greatCircleDistanceKm(a, b, mesh.physicalRadiusKm)
  }

  const relax = (v: number, cost: number, polity: number) => {
    const next = Math.fround(cost)
    if (next >= distance[v]!)
      return
    distance[v] = next
    owner[v] = polity
    queue.push(v, next)
  }

  for (let r = 0; r < n; r++) {
    if ((r & 4095) === 0)
      check?.()
    if (landMask[r] !== 1 || regionPolity[r]! < 0)
      continue
    let touchesSea = false
    for (let e = mesh.neighborOffsets[r]; e < mesh.neighborOffsets[r + 1]; e++) {
      if (landMask[mesh.neighbors[e]!] === 0) {
        touchesSea = true
        break
      }
    }
    if (!touchesSea)
      continue
    const startCost = prioritySourceMask && prioritySourceMask[r] !== 1 ? nonPriorityPenaltyKm : 0
    if (startCost < maxBudget)
      relax(r, startCost, regionPolity[r]!)
  }

  let iterations = 0
  while (queue.size > 0) {
    if ((iterations++ & 4095) === 0)
      check?.()
    const u = queue.pop()
    if (processed[u])
      continue
    processed[u] = 1

    const uIsLand = landMask[u] === 1
    const uIsUnownedLand = uIsLand && regionPolity[u]! < 0

    if (uIsUnownedLand && !allowHopping)
      continue

    for (let e = mesh.neighborOffsets[u]; e < mesh.neighborOffsets[u + 1]; e++) {
      const v = mesh.neighbors[e]!
      const vIsLand = landMask[v] === 1

      if (uIsLand) {
        if (vIsLand) {
          // Only newly reached unowned islands may transit inland to reach their opposite shore
          // for budgeted island hopping; inland transit counts in full against the remaining budget.
          if (!uIsUnownedLand || regionPolity[v]! >= 0)
            continue
          const next = distance[u]! + stepDistance(u, v)
          if (next <= maxBudget)
            relax(v, next, owner[u]!)
          continue
        }
        // Coast -> sea crossing; coast lies halfway along the discrete land/sea edge.
        const seaResistance = movementCost ? movementCost[v]! : 1
        const hopCost = uIsUnownedLand ? islandHopPenaltyKm : 0
        const next = distance[u]! + hopCost + stepDistance(u, v) * 0.5 * seaResistance * seaCostMultiplier * politySeaFactorOf(owner[u]!)
        if (next <= maxBudget)
          relax(v, next, owner[u]!)
        continue
      }

      // Sea -> sea or sea -> unowned land
      if (vIsLand && regionPolity[v]! >= 0)
        continue
      const seaResistance = vIsLand
        ? (movementCost ? movementCost[u]! : 1)
        : (movementCost ? 0.5 * (movementCost[u]! + movementCost[v]!) : 1)
      const waterFraction = vIsLand ? 0.5 : 1
      const next = distance[u]! + stepDistance(u, v) * waterFraction * seaResistance * seaCostMultiplier * politySeaFactorOf(owner[u]!)
      if (next <= maxBudget)
        relax(v, next, owner[u]!)
    }
  }

  // Pass 2: all reached landings compete simultaneously by crossing + inland km with no inland cap.
  processed.fill(0)
  for (let r = 0; r < n; r++) {
    if ((r & 4095) === 0)
      check?.()
    if (landMask[r] === 1 && regionPolity[r]! < 0 && owner[r]! >= 0)
      queue.push(r, distance[r]!)
  }
  while (queue.size > 0) {
    if ((iterations++ & 4095) === 0)
      check?.()
    const u = queue.pop()
    if (processed[u])
      continue
    processed[u] = 1
    for (let e = mesh.neighborOffsets[u]; e < mesh.neighborOffsets[u + 1]; e++) {
      const v = mesh.neighbors[e]!
      if (landMask[v] === 1 && regionPolity[v]! < 0)
        relax(v, distance[u]! + stepDistance(u, v), owner[u]!)
    }
  }

  for (let r = 0; r < n; r++) {
    if (landMask[r] === 1 && regionPolity[r]! < 0 && owner[r]! >= 0)
      regionPolity[r] = owner[r]!
  }
}

/** Completes fixed-range nearshore land ownership without island hopping on the caller-owned array. */
export function claimNearshoreTerritory(
  mesh: Pick<SphericalMesh, 'regionCount' | 'centers' | 'neighborOffsets' | 'neighbors' | 'physicalRadiusKm'>,
  landMask: Uint8Array,
  regionPolity: Int32Array,
  check?: () => void,
): void {
  claimMaritimeTerritory(mesh, landMask, regionPolity, {
    maxWaterBudgetKm: Math.sqrt(SETTLEMENT_SUPPORT_AREA_KM2),
    check,
  })
}
