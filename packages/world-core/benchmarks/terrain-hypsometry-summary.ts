import type { SphericalMesh } from '../src/mesh/spherical-mesh'

interface AreaBands {
  landAreaPct: number
  meanLandKm: number
  landUnder03Pct: number
  landUnder1Pct: number
  landOver25Pct: number
  landOver35Pct: number
  landOver45Pct: number
  meanOceanDepthKm: number
  oceanUnder1KmDepthPct: number
  oceanOver4KmDepthPct: number
  oceanOver6KmDepthPct: number
  minimumElevationKm: number
  maximumElevationKm: number
}

/** Area weighting is required because irregular Mesh regions are not equal-area. */
export function summarizeHypsometry(mesh: SphericalMesh, elevationKm: Float32Array): AreaBands {
  if (elevationKm.length !== mesh.regionCount)
    throw new Error('Hypsometry mesh mismatch')
  let landArea = 0
  let oceanArea = 0
  let landHeightArea = 0
  let oceanDepthArea = 0
  let landUnder03 = 0
  let landUnder1 = 0
  let landOver25 = 0
  let landOver35 = 0
  let landOver45 = 0
  let oceanUnder1 = 0
  let oceanOver4 = 0
  let oceanOver6 = 0
  let minimumElevationKm = Infinity
  let maximumElevationKm = -Infinity
  for (let region = 0; region < mesh.regionCount; region++) {
    const area = mesh.areaKm2[region]
    const height = elevationKm[region]
    minimumElevationKm = Math.min(minimumElevationKm, height)
    maximumElevationKm = Math.max(maximumElevationKm, height)
    if (height > 0) {
      landArea += area
      landHeightArea += height * area
      if (height < 0.3)
        landUnder03 += area
      if (height < 1)
        landUnder1 += area
      if (height >= 2.5)
        landOver25 += area
      if (height >= 3.5)
        landOver35 += area
      if (height >= 4.5)
        landOver45 += area
    }
    else {
      oceanArea += area
      oceanDepthArea -= height * area
      if (height > -1)
        oceanUnder1 += area
      if (height < -4)
        oceanOver4 += area
      if (height < -6)
        oceanOver6 += area
    }
  }
  if (landArea <= 0 || oceanArea <= 0)
    throw new Error('Hypsometry sample requires both land and ocean')
  return {
    landAreaPct: 100 * landArea / (landArea + oceanArea),
    meanLandKm: landHeightArea / landArea,
    landUnder03Pct: 100 * landUnder03 / landArea,
    landUnder1Pct: 100 * landUnder1 / landArea,
    landOver25Pct: 100 * landOver25 / landArea,
    landOver35Pct: 100 * landOver35 / landArea,
    landOver45Pct: 100 * landOver45 / landArea,
    meanOceanDepthKm: oceanDepthArea / oceanArea,
    oceanUnder1KmDepthPct: 100 * oceanUnder1 / oceanArea,
    oceanOver4KmDepthPct: 100 * oceanOver4 / oceanArea,
    oceanOver6KmDepthPct: 100 * oceanOver6 / oceanArea,
    minimumElevationKm,
    maximumElevationKm,
  }
}

