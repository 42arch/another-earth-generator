import type { ContentPack, ValidationIssue, ValidationResult } from '@another-earth/world-data'
import type { WorldEntity } from '#generation/civilization/civilization-types'
import type { DenseField, NumericArray } from './fields'
import type { WorldSnapshot } from './world-snapshot'
import { calculateContentHash, calculateContentSignature, validateContentPack } from '@another-earth/world-data'

export interface WorldValidationOptions {
  /** structure skips O(N+E) dense-value/topology scans; never use it for publication. */
  readonly mode?: 'full' | 'structure'
}

/** Typed in-memory state only. A future file importer must decode untrusted data before calling this. */
export function validateWorldSnapshot(world: WorldSnapshot, packs: readonly ContentPack[], options: WorldValidationOptions = {}): ValidationResult {
  const issues: ValidationIssue[] = []
  const add = (code: ValidationIssue['code'], path: string, message: string) => {
    if (issues.length < 100)
      issues.push({ code, path, message })
  }
  const full = options.mode !== 'structure'
  const nonempty = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0
  const finite = (n: number) => Number.isFinite(n)
  const integer = (n: number) => Number.isSafeInteger(n) && n >= 0
  const { mesh, planet, metadata: m, nature: n, civilization: c } = world
  const count = mesh.regionCount
  const region = (r: number) => integer(r) && r < count
  if (world.schemaVersion !== 2)
    add('version', 'schemaVersion', 'Unsupported world schema')
  for (const [path, value] of Object.entries({ snapshotId: world.snapshotId, worldId: m.worldId, name: m.name, seed: m.seed, generatorVersion: m.generatorVersion, contentSignature: m.contentSignature, meshId: mesh.meshId })) {
    if (!nonempty(value))
      add('required', path, 'Required nonempty string')
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(m.createdAt) || !finite(Date.parse(m.createdAt)))
    add('required', 'metadata.createdAt', 'Expected UTC ISO timestamp')
  if (!integer(world.revision) || !finite(world.time.year))
    add('range', 'revision/time', 'Invalid revision or simulation year')
  if (!integer(count) || count < 1)
    add('range', 'mesh.regionCount', 'Expected positive safe integer')
  for (const key of ['physicalRadiusKm', 'rotationPeriodHours', 'orbitalPeriodDays'] as const) {
    if (!finite(planet[key]) || planet[key] <= 0)
      add('range', `planet.${key}`, 'Expected finite positive parameter')
  }
  if (!finite(planet.axialTiltDegrees) || planet.axialTiltDegrees < 0 || planet.axialTiltDegrees > 180)
    add('range', 'planet.axialTiltDegrees', 'Expected [0, 180] degrees')
  if (!finite(planet.seaLevelDatumKm) || planet.physicalRadiusKm + planet.seaLevelDatumKm <= 0)
    add('range', 'planet.seaLevelDatumKm', 'Invalid radial datum')
  const config = m.generationConfig
  if (!integer(config.regionCount) || config.regionCount !== count)
    add('range', 'metadata.generationConfig.regionCount', 'Mesh configuration mismatch')
  if (!config.mesh || !Number.isInteger(config.mesh.subdivisionLevel) || config.mesh.subdivisionLevel < 0 || config.mesh.subdivisionLevel > 8 || !finite(config.mesh.irregularity) || config.mesh.irregularity < 0 || config.mesh.irregularity > 1)
    add('range', 'metadata.generationConfig.mesh', 'Invalid mesh generation parameters')
  if (config.mesh && config.mesh.seed !== undefined && !((typeof config.mesh.seed === 'string' && nonempty(config.mesh.seed)) || (typeof config.mesh.seed === 'number' && Number.isSafeInteger(config.mesh.seed))))
    add('range', 'metadata.generationConfig.mesh.seed', 'Invalid mesh seed override')
  if (!m.provenance || !nonempty(m.provenance.configSignature) || !nonempty(m.provenance.stageVersions?.mesh) || !nonempty(m.provenance.artifactSignatures?.mesh))
    add('required', 'metadata.provenance', 'Mesh version and signatures are required')
  for (const key of ['physicalRadiusKm', 'rotationPeriodHours', 'orbitalPeriodDays', 'axialTiltDegrees', 'seaLevelDatumKm'] as const) {
    if (!finite(config.planet[key]) || config.planet[key] !== planet[key])
      add('range', `metadata.generationConfig.planet.${key}`, 'Generation input disagrees with snapshot planet')
  }
  const packIds = new Set<string>()
  const selected: ContentPack[] = []
  for (const [i, ref] of m.contentPacks.entries()) {
    if (packIds.has(ref.id))
      add('duplicate', `metadata.contentPacks[${i}]`, 'Duplicate pack ID')
    packIds.add(ref.id)
    const pack = packs.find(p => p.manifest.id === ref.id && p.manifest.version === ref.version && p.manifest.contentHash === ref.contentHash)
    if (!pack)
      add('reference', `metadata.contentPacks[${i}]`, 'Content version/hash not resolved')
    else selected.push(pack)
  }
  for (const pack of selected) {
    for (const issue of validateContentPack(pack, selected).issues) issues.push({ ...issue, path: `content.${pack.manifest.id}.${issue.path}` })
    if (pack.manifest.contentHash !== calculateContentHash(pack))
      add('reference', `content.${pack.manifest.id}.contentHash`, 'Content hash mismatch')
  }
  if (selected.length === m.contentPacks.length && m.contentSignature !== calculateContentSignature(selected))
    add('reference', 'metadata.contentSignature', 'Content signature mismatch')
  const contentIds = new Set<string>()
  for (const pack of selected) {
    for (const domain of ['names', 'cultures', 'religions', 'governments', 'resources', 'presets'] as const) {
      for (const entry of pack[domain]) {
        if (contentIds.has(entry.id))
          add('duplicate', 'content', `Conflicting ID ${entry.id}`)
        contentIds.add(entry.id)
      }
    }
  }
  const archetypes = {
    cultures: new Set(selected.flatMap(p => p.cultures.map(a => a.id))),
    religions: new Set(selected.flatMap(p => p.religions.map(a => a.id))),
    governments: new Set(selected.flatMap(p => p.governments.map(a => a.id))),
  }
  function field(path: string, f: DenseField<NumericArray>, dtype: string, length: number, valid: (v: number) => boolean) {
    if (f.meshId !== mesh.meshId)
      add('reference', `${path}.meshId`, 'Field belongs to another mesh')
    if (f.values.constructor.name !== dtype)
      add('dtype', path, `Expected ${dtype}`)
    if (f.values.length !== length)
      add('length', path, `Expected ${length} values`)
    if (full) {
      for (let i = 0; i < f.values.length; i++) {
        if (!finite(f.values[i]) || !valid(f.values[i])) {
          add('range', `${path}[${i}]`, 'Invalid field value')
          break
        }
      }
    }
  }
  const nonnegative = (v: number) => v >= 0
  field('geology.plateIndex', n.geology.plateIndex, 'Uint32Array', count, v => v < n.geology.plates.length)
  field('geology.crustType', n.geology.crustType, 'Uint8Array', count, v => v === 0 || v === 1)
  field('geography.elevationKm', n.geography.elevationKm, 'Float32Array', count, v => v + planet.physicalRadiusKm + planet.seaLevelDatumKm > 0)
  field('geography.landMask', n.geography.landMask, 'Uint8Array', count, v => v === 0 || v === 1)
  if (n.climate.monthsPerYear !== 12 || n.climate.layout !== 'month-major')
    add('range', 'climate.layout', 'Expected 12 month-major fields')
  field('climate.temperatureC', n.climate.temperatureC, 'Float32Array', 12 * count, v => v >= -273.15)
  field('climate.precipitationMm', n.climate.precipitationMm, 'Float32Array', 12 * count, nonnegative)
  field('hydrology.downstreamRegion', n.hydrology.downstreamRegion, 'Int32Array', count, v => v === -1 || region(v))
  field('hydrology.annualRunoffMm', n.hydrology.annualRunoffMm, 'Float32Array', count, nonnegative)
  field('ecology.potentialBiomeIndex', n.ecology.potentialBiomeIndex, 'Uint16Array', count, v => v < n.ecology.potentialBiomeIds.length)
  field('ecology.landCoverIndex', n.ecology.landCoverIndex, 'Uint16Array', count, v => v < n.ecology.landCoverIds.length)
  field('civilization.population', c.population, 'Float64Array', count, nonnegative)
  for (const [path, ids] of [['geology.plates', n.geology.plates.map(p => p.id)], ['ecology.potentialBiomeIds', n.ecology.potentialBiomeIds], ['ecology.landCoverIds', n.ecology.landCoverIds]] as const) {
    if (!ids.length || ids.some(id => !nonempty(id)) || new Set(ids).size !== ids.length)
      add('duplicate', path, 'Expected nonempty unique classification IDs')
  }
  if (!(mesh.centers instanceof Float64Array) || !(mesh.areaKm2 instanceof Float64Array) || !(mesh.neighbors instanceof Uint32Array) || !(mesh.neighborOffsets instanceof Uint32Array))
    add('dtype', 'mesh', 'Invalid topology storage types')
  if (mesh.centers.length !== 3 * count || mesh.areaKm2.length !== count || mesh.neighborOffsets.length !== count + 1)
    add('length', 'mesh', 'Topology array lengths mismatch')
  if (full && integer(count) && count > 0 && mesh.centers.length === 3 * count && mesh.areaKm2.length === count && mesh.neighborOffsets.length === count + 1) {
    for (let r = 0; r < count; r++) {
      const norm = Math.hypot(mesh.centers[3 * r], mesh.centers[3 * r + 1], mesh.centers[3 * r + 2])
      if (!finite(norm) || Math.abs(norm - 1) > 1e-6 || !finite(mesh.areaKm2[r]) || mesh.areaKm2[r] <= 0) {
        add('range', `mesh[${r}]`, 'Invalid unit center or area')
        break
      }
    }
    const totalArea = mesh.areaKm2.reduce((sum, area) => sum + area, 0)
    const expectedArea = 4 * Math.PI * planet.physicalRadiusKm ** 2
    if (!finite(expectedArea) || !finite(totalArea) || Math.abs(totalArea - expectedArea) > expectedArea * 1e-6)
      add('range', 'mesh.areaKm2', 'Region areas must cover the physical sphere within relative tolerance 1e-6')
    const offsets = mesh.neighborOffsets
    let csrValid = offsets.length === count + 1 && offsets[0] === 0 && offsets[count] === mesh.neighbors.length
    for (let r = 0; r < count && csrValid; r++) csrValid = offsets[r] <= offsets[r + 1]
    if (!csrValid) {
      add('topology', 'mesh.neighborOffsets', 'Invalid CSR offsets')
    }
    else {
      const edges = new Set<string>()
      for (let r = 0; r < count; r++) {
        for (let e = offsets[r]; e < offsets[r + 1]; e++) {
          const neighbor = mesh.neighbors[e]
          const key = `${r}:${neighbor}`
          if (!region(neighbor) || neighbor === r || edges.has(key))
            add('topology', `mesh.neighbors[${e}]`, 'Invalid or duplicate neighbor')
          edges.add(key)
        }
      }
      const visited = new Uint8Array(count)
      const queue = [0]
      visited[0] = 1
      for (let head = 0; head < queue.length; head++) {
        const r = queue[head]
        for (let e = offsets[r]; e < offsets[r + 1]; e++) {
          const next = mesh.neighbors[e]
          if (region(next) && !visited[next]) {
            visited[next] = 1
            queue.push(next)
          }
        }
      }
      if (queue.length !== count)
        add('topology', 'mesh.neighbors', 'Mesh must be connected')
      for (const edge of edges) {
        const [a, b] = edge.split(':')
        if (!edges.has(`${b}:${a}`)) {
          add('topology', 'mesh.neighbors', 'Adjacency must be reciprocal')
          break
        }
      }
    }
    const downstream = n.hydrology.downstreamRegion.values
    const colors = new Uint8Array(count)
    for (let r = 0; r < count; r++) {
      let at = r
      while (region(at) && colors[at] === 0) {
        colors[at] = 1
        at = downstream[at]
      }
      if (region(at) && colors[at] === 1) {
        add('topology', 'hydrology.downstreamRegion', 'Drainage cycle')
        break
      }
      at = r
      while (region(at) && colors[at] === 1) {
        colors[at] = 2
        at = downstream[at]
      }
    }
    for (let r = 0; r < count; r++) {
      if (n.geography.landMask.values[r] !== Number(n.geography.elevationKm.values[r] > 0)) {
        add('range', `geography.landMask[${r}]`, 'Mask disagrees with final elevation')
        break
      }
    }
  }
  if (c.meshId !== mesh.meshId)
    add('reference', 'civilization.meshId', 'Civilization belongs to another mesh')
  const allIds = new Set<string>()
  const entities = [c.species, c.cultures, c.religions, c.polities, c.settlements] as const
  function checkEntity(entity: WorldEntity) {
    if (!nonempty(entity.id) || !nonempty(entity.name))
      add('required', 'civilization.entities', 'Entity needs stable ID and name')
    if (allIds.has(entity.id))
      add('duplicate', `civilization.${entity.id}`, 'Duplicate entity ID')
    allIds.add(entity.id)
    if (!finite(entity.foundedAtYear) || entity.foundedAtYear > world.time.year)
      add('range', `civilization.${entity.id}.foundedAtYear`, 'Entity cannot be founded after snapshot time')
  }
  entities.forEach(list => list.forEach(checkEntity))
  const species = new Set(c.species.map(e => e.id))
  const cultures = new Map(c.cultures.map(e => [e.id, e]))
  const religions = new Set(c.religions.map(e => e.id))
  const polities = new Map(c.polities.map(e => [e.id, e]))
  const settlements = new Map(c.settlements.map(e => [e.id, e]))
  for (const e of c.cultures) {
    if (!species.has(e.speciesId) || !archetypes.cultures.has(e.archetypeId))
      add('reference', `cultures.${e.id}`, 'Invalid species or culture archetype')
  }
  for (const e of c.religions) {
    if (!archetypes.religions.has(e.archetypeId))
      add('reference', `religions.${e.id}`, 'Invalid religion archetype')
  }
  for (const e of c.polities) {
    if (!cultures.has(e.cultureId) || !archetypes.governments.has(e.governmentArchetypeId))
      add('reference', `polities.${e.id}`, 'Invalid culture or government archetype')
    if (e.capitalSettlementId !== null && settlements.get(e.capitalSettlementId)?.polityId !== e.id)
      add('reference', `polities.${e.id}.capitalSettlementId`, 'Capital must belong to polity')
  }
  const totals = new Map<number, number>()
  const urban = new Map<number, number>()
  for (const [i, g] of c.populationGroups.entries()) {
    if (!region(g.regionId) || !species.has(g.speciesId) || cultures.get(g.cultureId)?.speciesId !== g.speciesId || (g.religionId !== null && !religions.has(g.religionId)) || (g.polityId !== null && !polities.has(g.polityId)))
      add('reference', `populationGroups[${i}]`, 'Invalid region or affiliation')
    if (!finite(g.population) || g.population < 0)
      add('population', `populationGroups[${i}]`, 'Invalid population')
    totals.set(g.regionId, (totals.get(g.regionId) ?? 0) + g.population)
  }
  for (const e of c.settlements) {
    if (!region(e.regionId) || !cultures.has(e.cultureId) || (e.polityId !== null && !polities.has(e.polityId)))
      add('reference', `settlements.${e.id}`, 'Invalid region, culture or polity')
    if (!finite(e.population) || e.population < 0)
      add('population', `settlements.${e.id}`, 'Invalid population')
    urban.set(e.regionId, (urban.get(e.regionId) ?? 0) + e.population)
  }
  if (!config.civilizationEnabled && (entities.some(e => e.length > 0) || c.populationGroups.length > 0))
    add('population', 'civilization', 'Civilization disabled in generation configuration')
  if (full) {
    for (let r = 0; r < Math.min(count, c.population.values.length); r++) {
      const population = c.population.values[r]
      const tolerance = Math.max(1e-6, population * 1e-9)
      if (!finite(totals.get(r) ?? 0) || !finite(urban.get(r) ?? 0) || Math.abs((totals.get(r) ?? 0) - population) > tolerance || (urban.get(r) ?? 0) > population + tolerance) {
        add('population', `civilization.population[${r}]`, 'Composition or settlement population disagrees with region total')
        break
      }
    }
  }
  return { valid: issues.length === 0, issues }
}
