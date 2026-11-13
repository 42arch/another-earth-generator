import type { ContentPack } from '@another-earth/world-data'
import type { FieldView } from './fields'
import type { WorldSnapshot } from './world-snapshot'
import { createFieldView } from './fields'
import { decodeWorldArchive, encodeWorldArchive } from './world-archive'
import { validateWorldSnapshot } from './world-validator'

export type WorldFieldName = 'plateIndex' | 'crustType' | 'elevationKm' | 'landMask' | 'continentIndex' | 'oceanIndex' | 'seaIndex'
  | 'temperatureC' | 'precipitationMm' | 'annualMeanTemperatureC' | 'annualPrecipitationMm' | 'koppenClass'
  | 'monthlySnowWaterEquivalentMm' | 'monthlySnowfallMm' | 'monthlySnowmeltMm'
  | 'downstreamRegion' | 'annualRunoffMm' | 'annualRunoffVolumeM3' | 'accumulatedAnnualFlowM3s' | 'contributingAreaKm2'
  | 'basinIndex' | 'riverIndex' | 'lakeIndex'
  | 'potentialBiomeIndex' | 'landCoverIndex' | 'aridityIndex' | 'growingSeasonMonths' | 'population'

/** Owns the last fully validated world; callers never receive its mutable arrays. */
export class WorldStore {
  #current?: WorldSnapshot

  get identity() {
    const world = this.#current
    return world ? Object.freeze({ snapshotId: world.snapshotId, worldId: world.metadata.worldId, revision: world.revision, regionCount: world.mesh.regionCount }) : null
  }

  publish(candidate: WorldSnapshot, packs: readonly ContentPack[]): void {
    const owned = structuredClone(candidate)
    const seen = new Set<object>()
    const rejectSharedBuffers = (value: unknown): void => {
      if (!value || typeof value !== 'object' || seen.has(value))
        return
      seen.add(value)
      if (ArrayBuffer.isView(value)) {
        if (!(value.buffer instanceof ArrayBuffer))
          throw new TypeError('Shared buffers cannot be published as world facts')
        return
      }
      for (const child of Object.values(value)) rejectSharedBuffers(child)
    }
    rejectSharedBuffers(owned)
    const result = validateWorldSnapshot(owned, packs)
    if (!result.valid)
      throw new Error(`Invalid world snapshot: ${result.issues[0]?.path}: ${result.issues[0]?.message}`)
    if (this.#current?.metadata.worldId === owned.metadata.worldId
      && (owned.snapshotId === this.#current.snapshotId || owned.revision <= this.#current.revision))
      throw new Error('Published world revision must advance with a new snapshot ID')
    this.#current = owned
  }

  restore(archive: string, packs: readonly ContentPack[]): void {
    const candidate = decodeWorldArchive(archive, packs)
    this.#current = candidate
  }

  archive(packs: readonly ContentPack[]): string {
    return encodeWorldArchive(this.#require(), packs)
  }

  field(name: WorldFieldName): FieldView {
    const world = this.#require()
    switch (name) {
      case 'plateIndex': return createFieldView(world.nature.geology.plateIndex)
      case 'crustType': return createFieldView(world.nature.geology.crustType)
      case 'elevationKm': return createFieldView(world.nature.geography.elevationKm)
      case 'landMask': return createFieldView(world.nature.geography.landMask)
      case 'continentIndex': if (world.nature.geography.regions) return createFieldView(world.nature.geography.regions.continentIndex); break
      case 'oceanIndex': if (world.nature.geography.regions) return createFieldView(world.nature.geography.regions.oceanIndex); break
      case 'seaIndex': if (world.nature.geography.regions?.seaIndex) return createFieldView(world.nature.geography.regions.seaIndex); break
      case 'temperatureC': return createFieldView(world.nature.climate.temperatureC)
      case 'precipitationMm': return createFieldView(world.nature.climate.precipitationMm)
      case 'annualMeanTemperatureC': return createFieldView(world.nature.climate.annualMeanTemperatureC)
      case 'annualPrecipitationMm': return createFieldView(world.nature.climate.annualPrecipitationMm)
      case 'koppenClass': return createFieldView(world.nature.climate.koppenClass)
      case 'monthlySnowWaterEquivalentMm': return createFieldView(world.nature.hydrology.monthlySnowWaterEquivalentMm)
      case 'monthlySnowfallMm': return createFieldView(world.nature.hydrology.monthlySnowfallMm)
      case 'monthlySnowmeltMm': return createFieldView(world.nature.hydrology.monthlySnowmeltMm)
      case 'downstreamRegion': return createFieldView(world.nature.hydrology.downstreamRegion)
      case 'annualRunoffMm': return createFieldView(world.nature.hydrology.annualRunoffMm)
      case 'annualRunoffVolumeM3': return createFieldView(world.nature.hydrology.annualRunoffVolumeM3)
      case 'accumulatedAnnualFlowM3s': return createFieldView(world.nature.hydrology.accumulatedAnnualFlowM3s)
      case 'contributingAreaKm2': return createFieldView(world.nature.hydrology.contributingAreaKm2)
      case 'basinIndex': return createFieldView(world.nature.hydrology.basinIndex)
      case 'riverIndex': return createFieldView(world.nature.hydrology.riverIndex)
      case 'lakeIndex': return createFieldView(world.nature.hydrology.lakeIndex)
      case 'potentialBiomeIndex': return createFieldView(world.nature.ecology.potentialBiomeIndex)
      case 'landCoverIndex': return createFieldView(world.nature.ecology.landCoverIndex)
      case 'aridityIndex': return createFieldView(world.nature.ecology.aridityIndex)
      case 'growingSeasonMonths': return createFieldView(world.nature.ecology.growingSeasonMonths)
      case 'population': return createFieldView(world.civilization.population)
    }
    throw new Error('Geographic regions are unavailable in this world')
  }

  region(region: number, month = 0) {
    const world = this.#require()
    const count = world.mesh.regionCount
    if (!Number.isInteger(region) || region < 0 || region >= count || !Number.isInteger(month) || month < 0 || month >= 12)
      throw new RangeError('Invalid world region or month')
    const { geology, geography, climate, hydrology, ecology } = world.nature
    const basin = hydrology.basins[hydrology.basinIndex.values[region]]
    const river = hydrology.rivers[hydrology.riverIndex.values[region]]
    const lake = hydrology.lakes[hydrology.lakeIndex.values[region]]
    return Object.freeze({
      snapshotId: world.snapshotId,
      region,
      month,
      areaKm2: world.mesh.areaKm2[region],
      plateId: geology.plates[geology.plateIndex.values[region]].id,
      crustType: geology.crustType.values[region],
      elevationKm: geography.elevationKm.values[region],
      land: geography.landMask.values[region] === 1,
      continentId: geography.regions?.continents[geography.regions.continentIndex.values[region]]?.id ?? null,
      continentName: geography.regions?.continents[geography.regions.continentIndex.values[region]]?.name ?? null,
      oceanId: geography.regions?.oceans[geography.regions.oceanIndex.values[region]]?.id ?? null,
      oceanName: geography.regions?.oceans[geography.regions.oceanIndex.values[region]]?.name ?? null,
      seaId: geography.regions?.seas?.[geography.regions.seaIndex?.values[region] ?? -1]?.id ?? null,
      temperatureC: climate.temperatureC.values[month * count + region],
      precipitationMm: climate.precipitationMm.values[month * count + region],
      annualMeanTemperatureC: climate.annualMeanTemperatureC.values[region],
      annualPrecipitationMm: climate.annualPrecipitationMm.values[region],
      koppenClass: climate.koppenClass.values[region],
      snowWaterEquivalentMm: hydrology.monthlySnowWaterEquivalentMm.values[month * count + region],
      annualRunoffMm: hydrology.annualRunoffMm.values[region],
      downstreamRegion: hydrology.downstreamRegion.values[region],
      basinId: basin?.id ?? null,
      riverId: river?.id ?? null,
      lakeId: lake?.id ?? null,
      potentialBiomeId: ecology.potentialBiomeIds[ecology.potentialBiomeIndex.values[region]],
      landCoverId: ecology.landCoverIds[ecology.landCoverIndex.values[region]],
      aridityIndex: ecology.aridityIndex.values[region],
      growingSeasonMonths: ecology.growingSeasonMonths.values[region],
      population: world.civilization.population.values[region],
    })
  }

  basin(id: string) {
    const basin = this.#require().nature.hydrology.basins.find(basin => basin.id === id)
    return basin ? Object.freeze({ ...basin }) : null
  }

  continent(id: string) {
    const item = this.#require().nature.geography.regions?.continents.find(continent => continent.id === id)
    return item ? Object.freeze({ ...item }) : null
  }

  ocean(id: string) {
    const item = this.#require().nature.geography.regions?.oceans.find(ocean => ocean.id === id)
    return item ? Object.freeze({ ...item, ...(item.definingContinentIds ? { definingContinentIds: Object.freeze([...item.definingContinentIds]) } : {}) }) : null
  }

  sea(id: string) {
    const item = this.#require().nature.geography.regions?.seas?.find(sea => sea.id === id)
    return item ? Object.freeze({ ...item }) : null
  }

  river(id: string) {
    const river = this.#require().nature.hydrology.rivers.find(river => river.id === id)
    return river ? Object.freeze({ ...river, regions: Object.freeze(Array.from(river.regions)) }) : null
  }

  lake(id: string) {
    const lake = this.#require().nature.hydrology.lakes.find(lake => lake.id === id)
    return lake ? Object.freeze({ ...lake, regions: Object.freeze(Array.from(lake.regions)) }) : null
  }

  pick(position: { readonly x: number, readonly y: number, readonly z: number }): number {
    const world = this.#require()
    const { x, y, z } = position
    const length = Math.hypot(x, y, z)
    if (!Number.isFinite(length) || length <= 0)
      throw new RangeError('Invalid pick position')
    let best = -Infinity
    let index = 0
    for (let region = 0; region < world.mesh.regionCount; region++) {
      const dot = x * world.mesh.centers[3 * region] + y * world.mesh.centers[3 * region + 1] + z * world.mesh.centers[3 * region + 2]
      if (dot > best) {
        best = dot
        index = region
      }
    }
    return index
  }

  #require(): WorldSnapshot {
    if (!this.#current)
      throw new Error('No published world')
    return this.#current
  }
}
