export const MAX_HYDROLOGY_ITERATIONS = 4
export const HYDROLOGY_INFLOW_TOLERANCE = 0.02

export interface HydrologyDiagnostics {
  iterations: number
  converged: boolean
  maximumRelativeInflowChange: number
  changedLakeRegions: number
}
