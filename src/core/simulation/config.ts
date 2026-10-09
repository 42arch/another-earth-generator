/** Fixed reference subdivisions for candidate land and local plate construction. */
export const REFERENCE_PLATE_SUBDIVISION_COUNT = 100

export interface WorldConfig {
  core: {
    seed: number
    /** Icosphere subdivision level for the output mesh (Level L → 10×4^L+2 regions). */
    detail: number
    /** Vertex displacement strength, from a regular to an irregular Voronoi grid. */
    irregularity: number
    planetRadius: number
  }
  geology: {
    /** Broad independently moving tectonic plates. */
    primaryPlateCount: number
    /** Small independently moving plates placed near broad boundaries. */
    microPlateCount: number
    /** Variation in target areas of broad plates. */
    plateSizeVariety: number
    /** Number of separated plate groups assigned as candidate continents. */
    continentCount: number
    /** Allowed variation between continent target areas, from uniform to varied. */
    continentSizeVariety: number
    /** Target fraction of the spherical surface covered by candidate land. */
    landCoverage: number
    /** Maximum number of major oceanic island-arc systems. */
    islandArcCount: number
    /** Controls the continuity and frequency of tectonic and nearshore islands. */
    islandDensity: number
    /** Number of mantle-hotspot volcanic chains. */
    hotspotCount: number
  }
  terrain: {
    /** Fractal terrain and coastline detail strength. */
    roughness: number
    /** Spherical domain-warp strength applied to the completed elevation field. */
    terrainWarp: number
    /** Bilateral smoothing strength applied after terrain warping. */
    smoothing: number
    /** High-latitude and high-elevation ice-flow erosion strength. */
    glacialErosion: number
    /** Terrain-driven hydraulic erosion strength. */
    hydraulicErosion: number
    /** Ridge and valley contrast applied after erosion stages. */
    ridgeSharpening: number
  }
  climate: {
    /** Planetary axial tilt in degrees; four circulation anchors span one orbit. */
    axialTiltDeg: number
    /** Additive offset applied to every monthly temperature, in degrees Celsius. */
    temperatureOffsetC: number
    /** Converts the generated daily precipitation rate to calibrated rainfall. */
    precipitationScale: number
  }
  society: {
    /** Global multiplier for resident population. */
    populationScale: number
    /** Relative number of settlement centres. */
    settlementDensity: number
    /** Share of hinterland residents concentrated in settlements. */
    urbanization: number
    /** Relative number of redundant road connections. */
    roadConnectivity: number
    /** Extra land travel resistance from relief and difficult biomes. */
    terrainResistance: number
  }
  appearance: {
    baseMap: string
    overlays: Record<string, boolean>
    /** Zero-based calendar month used by the climate layers. */
    climateMonth: number
    /** Whether terrain elevation displaces the 3D globe surface. */
    elevationDisplacement: boolean
    autoRotate: boolean
  }
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  core: {
    seed: 1024,
    detail: 163842,
    irregularity: 0.75,
    planetRadius: 100,
  },
  geology: {
    primaryPlateCount: 10,
    microPlateCount: 14,
    plateSizeVariety: 0.8,
    continentCount: 7,
    continentSizeVariety: 0.35,
    landCoverage: 0.3,
    islandArcCount: 6,
    islandDensity: 0.65,
    hotspotCount: 5,
  },
  terrain: {
    roughness: 0.4,
    terrainWarp: 0.75,
    smoothing: 0.1,
    glacialErosion: 0.5,
    hydraulicErosion: 0.5,
    ridgeSharpening: 0.5,
  },
  climate: {
    axialTiltDeg: 23.5,
    temperatureOffsetC: 0,
    precipitationScale: 1.8,
  },
  society: {
    populationScale: 1,
    settlementDensity: 1,
    urbanization: 0.35,
    roadConnectivity: 0.35,
    terrainResistance: 1,
  },
  appearance: {
    baseMap: 'satellite',
    overlays: {
      'rivers': true,
      'cities': true,
      'routes': true,
      'nation-borders': true,
      'sacred-sites': true,
      'atmosphere': true,
      'day-night': true,
    },
    climateMonth: 0,
    elevationDisplacement: false,
    autoRotate: false,
  },
}

export function cloneWorldConfig(config: WorldConfig): WorldConfig {
  return {
    core: { ...config.core },
    geology: { ...config.geology },
    terrain: { ...config.terrain },
    climate: { ...config.climate },
    society: { ...config.society },
    appearance: {
      ...config.appearance,
      overlays: { ...config.appearance.overlays },
      elevationDisplacement: config.appearance.elevationDisplacement ?? false,
      autoRotate: config.appearance.autoRotate ?? false,
    },
  }
}
