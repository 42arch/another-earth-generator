import type { WorldEntity } from '#generation/civilization/civilization-types'
import type { ContentPack, ValidationIssue, ValidationResult } from '@another-earth/world-data'
import type { DenseField, NumericArray } from './fields'
import type { WorldSnapshot } from './world-snapshot'
import { DEFAULT_CLIMATE_PARAMETERS } from '#generation/nature/climate/climate'
import { DEFAULT_HYDROLOGY_PARAMETERS } from '#generation/nature/hydrology/hydrology'
import { DEFAULT_GEOLOGY_PARAMETERS } from '#generation/stages/geology-stage'
import { DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS } from '#generation/stages/terrain-stage'
import { calculateContentHash, calculateContentSignature, validateContentPack } from '@another-earth/world-data'
import { WORLD_SCHEMA_VERSION } from './world-snapshot'

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
  if (world.schemaVersion !== WORLD_SCHEMA_VERSION)
    add('version', 'schemaVersion', 'Unsupported world schema')
  if (issues.length)
    return { valid: false, issues }
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
  const naturalStages = ['mesh', 'reference-mesh', 'reference-subdivisions', 'plate-topology', 'continental-crust', 'geological-mapping', 'geology', 'plate-dynamics', 'tectonics', 'tectonic-elevation', 'terrain', 'climate-c0', 'cryosphere-i0', 'hydrology-h0', 'static-lakes-l1', 'ecology-e0']
  if (!m.provenance || !nonempty(m.provenance.configSignature) || naturalStages.some(stage => !nonempty(m.provenance.stageVersions?.[stage]) || !nonempty(m.provenance.artifactSignatures?.[stage])))
    add('required', 'metadata.provenance', 'Complete natural stage versions and signatures are required')
  const requiredParameters = { geology: DEFAULT_GEOLOGY_PARAMETERS, landforms: DEFAULT_LANDFORM_PARAMETERS, terrain: DEFAULT_TERRAIN_PARAMETERS, climate: DEFAULT_CLIMATE_PARAMETERS, hydrology: DEFAULT_HYDROLOGY_PARAMETERS }
  for (const key of ['geology', 'landforms', 'terrain', 'climate', 'hydrology'] as const) {
    const parameters = config[key] as unknown as Record<string, number> | undefined
    if (!parameters || Object.keys(requiredParameters[key]).some(name => !finite(parameters[name])) || Object.values(parameters).some(value => typeof value !== 'number' || !finite(value)))
      add('range', `metadata.generationConfig.${key}`, 'Complete finite natural parameters are required')
  }
  if (config.hydrology && (config.hydrology.riverDensityMultiplier < 0.25 || config.hydrology.riverDensityMultiplier > 4 || config.hydrology.minimumLakeAreaKm2 < 0))
    add('range', 'metadata.generationConfig.hydrology', 'Invalid river density or minimum lake area')
  if (config.reference && (!Number.isInteger(config.reference.subdivisionLevel) || config.reference.subdivisionLevel < 2 || config.reference.subdivisionLevel > 6))
    add('range', 'metadata.generationConfig.reference', 'Invalid reference Mesh level')
  for (const key of ['physicalRadiusKm', 'rotationPeriodHours', 'orbitalPeriodDays', 'axialTiltDegrees', 'seaLevelDatumKm'] as const) {
    if (!finite(config.planet[key]) || config.planet[key] !== planet[key])
      add('range', `metadata.generationConfig.planet.${key}`, 'Generation input disagrees with snapshot planet')
  }
  for (const key of ['rotationPeriodHours', 'orbitalPeriodDays', 'axialTiltDegrees'] as const) {
    if (config.climate?.[key] !== planet[key])
      add('range', `metadata.generationConfig.climate.${key}`, 'Climate parameter disagrees with snapshot planet')
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
  const geographicRegions = n.geography.regions
  if (!geographicRegions && (m.provenance.stageVersions?.['geographic-regions'] || m.provenance.stageVersions?.['geographic-names']))
    add('required', 'geography.regions', 'Generated geographic classification is missing')
  if (geographicRegions) {
    if (!nonempty(m.provenance.stageVersions?.['geographic-regions']) || !nonempty(m.provenance.artifactSignatures?.['geographic-regions']))
      add('required', 'metadata.provenance.geographic-regions', 'Geographic classification provenance is required')
    const continents = geographicRegions.continents
    const oceans = geographicRegions.oceans
    const seas = geographicRegions.seas
    const classifiedWater = ['geographic-regions-v2', 'geographic-regions-v3'].includes(m.provenance.stageVersions?.['geographic-regions'] ?? '')
    if (classifiedWater && (!seas || !geographicRegions.seaIndex))
      add('required', 'geography.regions.seas', 'Sea classification is required')
    if (!Array.isArray(continents) || !Array.isArray(oceans) || (seas !== undefined && !Array.isArray(seas)))
      add('dtype', 'geography.regions', 'Expected continent and ocean tables')
    else {
      const ids = new Set<string>()
      const generatedNames = nonempty(m.provenance.stageVersions?.['geographic-names'])
      if (generatedNames && !nonempty(m.provenance.artifactSignatures?.['geographic-names']))
        add('required', 'metadata.provenance.geographic-names', 'Geographic naming signature is required')
      if (generatedNames && geographicRegions.nameContentSignature !== m.contentSignature)
        add('reference', 'geography.regions.nameContentSignature', 'Geographic names must match the recorded content packs')
      for (const [kind, table] of [['continents', continents], ['oceans', oceans], ['seas', seas ?? []]] as const) {
        for (let i = 0; i < table.length; i++) {
          const item = table[i]
          if (!nonempty(item.id) || ids.has(item.id) || !finite(item.areaKm2) || item.areaKm2 <= 0)
            add('range', `geography.regions.${kind}[${i}]`, 'Invalid unique geographic identity or area')
          ids.add(item.id)
        }
      }
      for (const [kind, table] of [['continents', continents], ['oceans', oceans]] as const) {
        const names = new Set<string>()
        for (let i = 0; i < table.length; i++) {
          const name = table[i].name
          if ((generatedNames || name !== undefined) && (!nonempty(name) || names.has(name)))
            add('required', `geography.regions.${kind}[${i}].name`, 'Expected a unique nonempty geographic name')
          if (nonempty(name)) names.add(name)
        }
      }
      for (let i = 0; i < oceans.length; i++) {
        const borders = oceans[i].definingContinentIds
        if (borders !== undefined && (!Array.isArray(borders) || borders.some(id => !continents.some(continent => continent.id === id))))
          add('reference', `geography.regions.oceans[${i}].definingContinentIds`, 'Invalid defining continent')
      }
      field('geography.regions.continentIndex', geographicRegions.continentIndex, 'Int32Array', count, v => v === -1 || (v >= 0 && v < continents.length))
      field('geography.regions.oceanIndex', geographicRegions.oceanIndex, 'Int32Array', count, v => v === -1 || (v >= 0 && v < oceans.length))
      if (geographicRegions.seaIndex)
        field('geography.regions.seaIndex', geographicRegions.seaIndex, 'Int32Array', count, v => v === -1 || (v >= 0 && v < (seas?.length ?? 0)))
      if (full && geographicRegions.continentIndex.values.length === count && geographicRegions.oceanIndex.values.length === count && (!geographicRegions.seaIndex || geographicRegions.seaIndex.values.length === count)) {
        const continentAreas = new Float64Array(continents.length)
        const oceanAreas = new Float64Array(oceans.length)
        const seaAreas = new Float64Array(seas?.length ?? 0)
        for (let r = 0; r < count; r++) {
          const continent = geographicRegions.continentIndex.values[r]
          const ocean = geographicRegions.oceanIndex.values[r]
          const sea = geographicRegions.seaIndex?.values[r] ?? -1
          if (n.geography.landMask.values[r]) {
            if (continent < 0 || continent >= continents.length || ocean !== -1 || sea !== -1) add('reference', `geography.regions[${r}]`, 'Land must belong to one continent')
            else continentAreas[continent] += mesh.areaKm2[r]
          }
          else if (continent !== -1 || ocean < -1 || ocean >= oceans.length || sea < -1 || sea >= seaAreas.length || (classifiedWater && (ocean >= 0) === (sea >= 0))) add('reference', `geography.regions[${r}]`, 'Invalid water assignment')
          else if (ocean >= 0) oceanAreas[ocean] += mesh.areaKm2[r]
          else if (sea >= 0) seaAreas[sea] += mesh.areaKm2[r]
        }
        for (let i = 0; i < continents.length; i++) if (Math.abs(continentAreas[i] - continents[i].areaKm2) > Math.max(1e-5, continentAreas[i] * 1e-9)) add('range', `geography.regions.continents[${i}].areaKm2`, 'Continent area disagrees with assigned regions')
        for (let i = 0; i < oceans.length; i++) if (Math.abs(oceanAreas[i] - oceans[i].areaKm2) > Math.max(1e-5, oceanAreas[i] * 1e-9)) add('range', `geography.regions.oceans[${i}].areaKm2`, 'Ocean area disagrees with assigned regions')
        for (let i = 0; i < seaAreas.length; i++) if (Math.abs(seaAreas[i] - seas![i].areaKm2) > Math.max(1e-5, seaAreas[i] * 1e-9)) add('range', `geography.regions.seas[${i}].areaKm2`, 'Sea area disagrees with assigned regions')
      }
    }
  }
  if (n.climate.monthsPerYear !== 12 || n.climate.layout !== 'month-major')
    add('range', 'climate.layout', 'Expected 12 month-major fields')
  field('climate.temperatureC', n.climate.temperatureC, 'Float32Array', 12 * count, v => v >= -273.15)
  field('climate.precipitationMm', n.climate.precipitationMm, 'Float32Array', 12 * count, nonnegative)
  field('climate.annualMeanTemperatureC', n.climate.annualMeanTemperatureC, 'Float32Array', count, v => v >= -273.15)
  field('climate.annualPrecipitationMm', n.climate.annualPrecipitationMm, 'Float32Array', count, nonnegative)
  field('climate.koppenClass', n.climate.koppenClass, 'Uint8Array', count, v => v <= 31)
  const circulation = n.climate.circulation
  if (circulation !== undefined) {
    if (!circulation || typeof circulation !== 'object') {
      add('dtype', 'climate.circulation', 'Expected climate circulation fields')
    }
    else {
      const anyFinite = () => true
      field('climate.circulation.windEastMps', circulation.windEastMps, 'Float32Array', 12 * count, anyFinite)
      field('climate.circulation.windNorthMps', circulation.windNorthMps, 'Float32Array', 12 * count, anyFinite)
      field('climate.circulation.oceanEastMps', circulation.oceanEastMps, 'Float32Array', 12 * count, anyFinite)
      field('climate.circulation.oceanNorthMps', circulation.oceanNorthMps, 'Float32Array', 12 * count, anyFinite)
      field('climate.circulation.oceanWarmth', circulation.oceanWarmth, 'Float32Array', 12 * count, v => v >= -1 - 1e-6 && v <= 1 + 1e-6)
      field('climate.circulation.oceanAvailable', circulation.oceanAvailable, 'Uint8Array', count, v => v === 0 || v === 1)
    }
  }
  field('hydrology.monthlySnowWaterEquivalentMm', n.hydrology.monthlySnowWaterEquivalentMm, 'Float32Array', 12 * count, nonnegative)
  field('hydrology.monthlySnowfallMm', n.hydrology.monthlySnowfallMm, 'Float32Array', 12 * count, nonnegative)
  field('hydrology.monthlySnowmeltMm', n.hydrology.monthlySnowmeltMm, 'Float32Array', 12 * count, nonnegative)
  field('hydrology.downstreamRegion', n.hydrology.downstreamRegion, 'Int32Array', count, v => v === -1 || region(v))
  field('hydrology.annualRunoffMm', n.hydrology.annualRunoffMm, 'Float32Array', count, nonnegative)
  field('hydrology.annualRunoffVolumeM3', n.hydrology.annualRunoffVolumeM3, 'Float64Array', count, nonnegative)
  field('hydrology.accumulatedAnnualFlowM3s', n.hydrology.accumulatedAnnualFlowM3s, 'Float64Array', count, nonnegative)
  field('hydrology.contributingAreaKm2', n.hydrology.contributingAreaKm2, 'Float64Array', count, nonnegative)
  field('hydrology.basinIndex', n.hydrology.basinIndex, 'Int32Array', count, v => v === -1 || (v >= 0 && v < n.hydrology.basins.length))
  field('hydrology.riverIndex', n.hydrology.riverIndex, 'Int32Array', count, v => v === -1 || (v >= 0 && v < n.hydrology.rivers.length))
  field('hydrology.lakeIndex', n.hydrology.lakeIndex, 'Int32Array', count, v => v === -1 || (v >= 0 && v < n.hydrology.lakes.length))
  field('ecology.potentialBiomeIndex', n.ecology.potentialBiomeIndex, 'Uint16Array', count, v => v < n.ecology.potentialBiomeIds.length)
  field('ecology.landCoverIndex', n.ecology.landCoverIndex, 'Uint16Array', count, v => v < n.ecology.landCoverIds.length)
  field('ecology.aridityIndex', n.ecology.aridityIndex, 'Float32Array', count, nonnegative)
  field('ecology.growingSeasonMonths', n.ecology.growingSeasonMonths, 'Uint8Array', count, v => v <= 12)
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
    const water = n.hydrology
    const basinArea = new Float64Array(water.basins.length)
    const basinRunoff = new Float64Array(water.basins.length)
    for (let r = 0; r < count; r++) {
      const land = n.geography.landMask.values[r] === 1
      const basin = water.basinIndex.values[r]
      const river = water.riverIndex.values[r]
      const lake = water.lakeIndex.values[r]
      if ((land && basin < 0) || (!land && basin !== -1) || (!land && (river !== -1 || lake !== -1)))
        add('reference', `hydrology.region[${r}]`, 'Water indices disagree with land mask')
      if (basin >= 0 && basin < water.basins.length) {
        basinArea[basin] += mesh.areaKm2[r]
        basinRunoff[basin] += water.annualRunoffVolumeM3.values[r]
      }
      if ((n.climate.koppenClass.values[r] === 0) !== !land)
        add('range', `climate.koppenClass[${r}]`, 'Ocean climate class disagrees with land mask')
      if (circulation && circulation.oceanAvailable.values.length === count
        && circulation.oceanEastMps.values.length === 12 * count
        && circulation.oceanNorthMps.values.length === 12 * count
        && circulation.oceanWarmth.values.length === 12 * count) {
        const available = circulation.oceanAvailable.values[r]
        if (land && available !== 0) {
          add('range', `climate.circulation.oceanAvailable[${r}]`, 'Ocean currents cannot be available on land')
        }
        else if (available === 0) {
          for (let month = 0; month < 12; month++) {
            const offset = month * count + r
            if (circulation.oceanEastMps.values[offset] !== 0
              || circulation.oceanNorthMps.values[offset] !== 0
              || circulation.oceanWarmth.values[offset] !== 0) {
              add('range', `climate.circulation[${offset}]`, 'Unavailable ocean current slots must store zero')
              break
            }
          }
        }
      }
      let annualTemperature = 0
      let annualPrecipitation = 0
      let snowStorage = 0
      for (let month = 0; month < 12; month++) {
        const offset = month * count + r
        annualTemperature += n.climate.temperatureC.values[offset] / 12
        annualPrecipitation += n.climate.precipitationMm.values[offset]
        snowStorage += water.monthlySnowfallMm.values[offset] - water.monthlySnowmeltMm.values[offset]
        if (Math.abs(snowStorage - water.monthlySnowWaterEquivalentMm.values[offset]) > Math.max(0.01, Math.abs(snowStorage) * 1e-5))
          add('range', `hydrology.monthlySnowWaterEquivalentMm[${offset}]`, 'Snow storage disagrees with snowfall and melt')
      }
      if (Math.abs(annualTemperature - n.climate.annualMeanTemperatureC.values[r]) > 0.001
        || Math.abs(annualPrecipitation - n.climate.annualPrecipitationMm.values[r]) > Math.max(0.01, annualPrecipitation * 1e-5))
        add('range', `climate.annual[${r}]`, 'Annual values disagree with monthly climate')
      const runoffVolume = water.annualRunoffMm.values[r] * mesh.areaKm2[r] * 1000
      if (Math.abs(runoffVolume - water.annualRunoffVolumeM3.values[r]) > Math.max(1, runoffVolume * 1e-5))
        add('range', `hydrology.annualRunoffVolumeM3[${r}]`, 'Runoff volume disagrees with depth and area')
    }
    const basinIds = new Set<string>()
    for (const [i, basin] of water.basins.entries()) {
      if (!nonempty(basin.id) || basinIds.has(basin.id) || !region(basin.outletRegion) || water.downstreamRegion.values[basin.outletRegion] !== -1
        || typeof basin.endorheic !== 'boolean' || !finite(basin.areaKm2) || basin.areaKm2 <= 0 || !finite(basin.annualRunoffM3) || basin.annualRunoffM3 < 0)
        add('reference', `hydrology.basins[${i}]`, 'Invalid basin identity, outlet or value')
      basinIds.add(basin.id)
      if (Math.abs(basin.areaKm2 - basinArea[i]) > Math.max(1e-3, basin.areaKm2 * 1e-5)
        || Math.abs(basin.annualRunoffM3 - basinRunoff[i]) > Math.max(1, basin.annualRunoffM3 * 1e-5))
        add('range', `hydrology.basins[${i}]`, 'Basin totals disagree with member regions')
    }
    const riverIds = new Set<string>()
    const riverMembers = new Uint8Array(count)
    for (const [i, river] of water.rivers.entries()) {
      if (!nonempty(river.id) || riverIds.has(river.id) || !(river.regions instanceof Uint32Array) || river.regions.length === 0
        || !region(river.sourceRegion) || !region(river.mouthRegion) || river.downstreamRiver < -1 || river.downstreamRiver >= water.rivers.length || river.downstreamRiver === i
        || !finite(river.annualMeanDischargeM3s) || river.annualMeanDischargeM3s < 0 || !integer(river.strahlerOrder) || river.strahlerOrder < 1 || typeof river.endorheic !== 'boolean') {
        add('reference', `hydrology.rivers[${i}]`, 'Invalid river identity, topology or value')
        continue
      }
      riverIds.add(river.id)
      if (river.regions[0] !== river.sourceRegion || river.regions[river.regions.length - 1] !== river.mouthRegion)
        add('topology', `hydrology.rivers[${i}]`, 'River endpoints disagree with members')
      if (river.downstreamRiver >= 0 && water.rivers[river.downstreamRiver]?.sourceRegion !== water.downstreamRegion.values[river.mouthRegion])
        add('topology', `hydrology.rivers[${i}]`, 'Downstream river connection disagrees with route')
      for (let at = 0; at < river.regions.length; at++) {
        const r = river.regions[at]
        if (!region(r) || water.riverIndex.values[r] !== i || riverMembers[r] || !n.geography.landMask.values[r]
          || (at + 1 < river.regions.length && water.downstreamRegion.values[r] !== river.regions[at + 1])) {
          add('topology', `hydrology.rivers[${i}].regions`, 'River members or route are invalid')
          break
        }
        riverMembers[r] = 1
      }
    }
    const lakeIds = new Set<string>()
    const lakeMembers = new Uint8Array(count)
    for (const [i, lake] of water.lakes.entries()) {
      if (!nonempty(lake.id) || lakeIds.has(lake.id) || !basinIds.has(lake.basinId) || !(lake.regions instanceof Uint32Array) || lake.regions.length < 2
        || typeof lake.endorheic !== 'boolean' || !finite(lake.areaKm2) || lake.areaKm2 <= 0 || !finite(lake.waterLevelKm)
        || (lake.spillRegion !== null && !region(lake.spillRegion)) || (lake.downstreamRegion !== null && !region(lake.downstreamRegion))) {
        add('reference', `hydrology.lakes[${i}]`, 'Invalid lake identity, basin or value')
        continue
      }
      lakeIds.add(lake.id)
      let area = 0
      let validMembers = true
      const members = new Set<number>()
      for (const r of lake.regions) {
        if (!region(r) || water.lakeIndex.values[r] !== i || lakeMembers[r] || !n.geography.landMask.values[r]
          || !(lake.waterLevelKm > n.geography.elevationKm.values[r])
          || water.basins[water.basinIndex.values[r]]?.id !== lake.basinId) {
          add('topology', `hydrology.lakes[${i}].regions`, 'Lake member is invalid')
          validMembers = false
          break
        }
        lakeMembers[r] = 1
        members.add(r)
        area += mesh.areaKm2[r]
      }
      if (validMembers) {
        const connected = new Set<number>([lake.regions[0]])
        const queue = [lake.regions[0]]
        for (let head = 0; head < queue.length; head++) {
          const r = queue[head]
          for (let edge = mesh.neighborOffsets[r]; edge < mesh.neighborOffsets[r + 1]; edge++) {
            const next = mesh.neighbors[edge]
            if (members.has(next) && !connected.has(next)) {
              connected.add(next)
              queue.push(next)
            }
          }
        }
        if (connected.size !== lake.regions.length)
          add('topology', `hydrology.lakes[${i}].regions`, 'Lake members are disconnected')
      }
      if ((lake.spillRegion === null) !== (lake.downstreamRegion === null)
        || (lake.spillRegion !== null && (!members.has(lake.spillRegion) || water.downstreamRegion.values[lake.spillRegion] !== lake.downstreamRegion)))
        add('topology', `hydrology.lakes[${i}].spillRegion`, 'Lake spill disagrees with drainage route')
      if (Math.abs(area - lake.areaKm2) > Math.max(1e-3, lake.areaKm2 * 1e-5))
        add('range', `hydrology.lakes[${i}].areaKm2`, 'Lake area disagrees with members')
    }
    for (let r = 0; r < count; r++) {
      if ((water.riverIndex.values[r] >= 0) !== Boolean(riverMembers[r]) || (water.lakeIndex.values[r] >= 0) !== Boolean(lakeMembers[r])) {
        add('reference', `hydrology.region[${r}]`, 'River or lake index lacks a matching member')
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
