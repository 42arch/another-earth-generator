/* eslint-disable antfu/no-top-level-await -- This diagnostic runs as a standalone jiti entry point. */
import type { ClimateArtifact, CryosphereArtifact, EcologyArtifact, HydrologyArtifact, SphericalMesh, TerrainArtifact } from '../src/index'
import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import {
  createEcologyPipeline,
  createHydrologyPipeline,
  DEFAULT_CLIMATE_PARAMETERS,
  DEFAULT_GEOLOGY_PARAMETERS,
  DEFAULT_HYDROLOGY_PARAMETERS,
  DEFAULT_LANDFORM_PARAMETERS,
  DEFAULT_TERRAIN_PARAMETERS,
  KOPPEN_CODES,
  StageCache,
} from '../src/index'

const input = {
  seed: '1024',
  config: {
    planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
    mesh: { subdivisionLevel: 7, irregularity: 0.75 },
    geology: DEFAULT_GEOLOGY_PARAMETERS,
    landforms: DEFAULT_LANDFORM_PARAMETERS,
    terrain: DEFAULT_TERRAIN_PARAMETERS,
    climate: { ...DEFAULT_CLIMATE_PARAMETERS, axialTiltDegrees: 23.5, precipitationScale: 1.8 },
    hydrology: DEFAULT_HYDROLOGY_PARAMETERS,
  },
}
const cache = new StageCache(512 * 2 ** 20)
const hydrology = await createHydrologyPipeline(cache).execute(input)
const ecology = await createEcologyPipeline(cache).execute({ ...input, config: { ...input.config, ecology: true } })
const mesh = hydrology.getOutput<SphericalMesh>('mesh')
const terrain = hydrology.getOutput<TerrainArtifact>('terrain')
const climate = hydrology.getOutput<ClimateArtifact>('climate-c0')
const snow = hydrology.getOutput<CryosphereArtifact>('cryosphere-i0')
const runoff = hydrology.getOutput<HydrologyArtifact>('hydrology-h0')
const biomes = ecology.getOutput<EcologyArtifact>('ecology-e0')
const labels = new Uint8Array(mesh.regionCount * 3)
const af = KOPPEN_CODES.indexOf('Af')
const ef = KOPPEN_CODES.indexOf('EF')
const baselineFile = process.argv[2]
let baseline: Buffer | undefined
if (baselineFile) {
  const previous = JSON.parse(readFileSync(baselineFile, 'utf8')) as { meshId: string, labels: string }
  if (previous.meshId !== mesh.meshId)
    throw new Error('Climate downstream comparison requires the same mesh')
  baseline = Buffer.from(previous.labels, 'base64')
  if (baseline.length !== labels.length)
    throw new Error('Invalid baseline label count')
}

let landArea = 0
let snowmelt = 0
let snowCover = 0
let annualRunoff = 0
let koppenChanged = 0
let biomeChanged = 0
let afGained = 0
let afGainedAcrossDriestMonth = 0
let afLost = 0
let efGained = 0
let efLost = 0
for (let r = 0; r < mesh.regionCount; r++) {
  if (!terrain.landMask[r])
    continue
  const area = mesh.areaKm2[r]
  landArea += area
  snowmelt += area * snow.annualSnowmeltMm[r]
  annualRunoff += area * runoff.annualRunoffMm[r]
  if (snow.monthlySnowWaterEquivalentMm[11 * mesh.regionCount + r] > 0)
    snowCover += area
  const koppen = climate.koppenClass[r]
  const biome = biomes.potentialBiomeIndex[r]
  let driest = Infinity
  for (let month = 0; month < 12; month++)
    driest = Math.min(driest, climate.precipitationMm[month * mesh.regionCount + r])
  labels[3 * r] = koppen
  labels[3 * r + 1] = biome
  labels[3 * r + 2] = Number(driest >= 60)
  if (baseline) {
    const formerKoppen = baseline[3 * r]
    koppenChanged += koppen !== formerKoppen ? area : 0
    biomeChanged += biome !== baseline[3 * r + 1] ? area : 0
    if (koppen === af && formerKoppen !== af) {
      afGained += area
      if (!baseline[3 * r + 2])
        afGainedAcrossDriestMonth += area
    }
    afLost += koppen !== af && formerKoppen === af ? area : 0
    efGained += koppen === ef && formerKoppen !== ef ? area : 0
    efLost += koppen !== ef && formerKoppen === ef ? area : 0
  }
}
if (process.argv[3]) {
  writeFileSync(process.argv[3], JSON.stringify({
    meshId: mesh.meshId,
    labels: Buffer.from(labels).toString('base64'),
  }))
}
process.stdout.write(`${JSON.stringify({
  seed: input.seed,
  level: input.config.mesh.subdivisionLevel,
  version: climate.algorithmVersion,
  meshId: mesh.meshId,
  landAnnualSnowmeltMm: snowmelt / landArea,
  landDecemberSnowAreaShare: snowCover / landArea,
  landAnnualRunoffMm: annualRunoff / landArea,
  riverSegments: runoff.rivers.length,
  transitionSharesOfLand: baseline
    ? { koppenChanged: koppenChanged / landArea, biomeChanged: biomeChanged / landArea, afGained: afGained / landArea, afGainedAcrossDriestMonth: afGainedAcrossDriestMonth / landArea, afLost: afLost / landArea, efGained: efGained / landArea, efLost: efLost / landArea }
    : undefined,
}, null, 2)}\n`)
