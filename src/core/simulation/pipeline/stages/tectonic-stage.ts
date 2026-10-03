import type { ISimulationStage, SimulationContext } from '../types'
import type { SphericalTectonicData } from '@/core/geology/geology-data'

export class TectonicStage implements ISimulationStage {
  name = 'MantleAndTectonics'

  execute(context: SimulationContext): void {
    const {
      outputToReference,
      referenceMantleFlow,
      referencePlates,
      regionPlate,
      regionSuperPlate,
      plateAngularVelocity,
      crust,
      boundaries,
    } = context

    if (!outputToReference || !referenceMantleFlow || !referencePlates || !regionPlate || !regionSuperPlate || !plateAngularVelocity || !crust || !boundaries) {
      throw new Error('Missing dependencies in TectonicStage')
    }

    const rawTectonics: SphericalTectonicData = {
      regionPlate,
      regionPrimaryPlate: regionSuperPlate,
      plateSeeds: referencePlates.plateSeeds,
      plateAngularVelocity,
      ...crust,
      ...boundaries,
    }

    const mantleFlow = this.projectRegionField(referenceMantleFlow, outputToReference)
    const mantle = this.buildDynamicTopography(mantleFlow)
    const tectonics = this.applyMantleStress(rawTectonics, mantleFlow)

    context.rawTectonics = rawTectonics
    context.mantleFlow = mantleFlow
    context.mantle = mantle
    context.tectonics = tectonics
  }

  private projectRegionField(
    reference: Float32Array,
    outputToReference: Uint32Array,
  ): Float32Array {
    const result = new Float32Array(outputToReference.length)
    for (let region = 0; region < result.length; region++)
      result[region] = reference[outputToReference[region]]
    return result
  }

  private buildDynamicTopography(mantleFlow: Float32Array): { elevationDelta: Float32Array, normalizedFlow: Float32Array } {
    const elevationDelta = new Float32Array(mantleFlow.length)
    const normalizedFlow = new Float32Array(mantleFlow.length)
    for (let region = 0; region < mantleFlow.length; region++) {
      const value = mantleFlow[region]
      elevationDelta[region] = value > 0 ? value * 0.035 : value * 0.025
      normalizedFlow[region] = value // Depending on what's expected downstream
    }
    return { elevationDelta, normalizedFlow }
  }

  private applyMantleStress(
    tectonics: SphericalTectonicData,
    mantleFlow: Float32Array,
  ): SphericalTectonicData {
    const regionStress = Float32Array.from(tectonics.regionStress)
    const regionCompression = Float32Array.from(tectonics.regionCompression)
    for (let region = 0; region < regionStress.length; region++) {
      if (regionStress[region] <= 1e-6)
        continue
      const multiplier = 1 + 0.4 * Math.max(-0.5, mantleFlow[region])
      regionStress[region] *= multiplier
      regionCompression[region] *= multiplier
    }
    return { ...tectonics, regionStress, regionCompression }
  }
}
