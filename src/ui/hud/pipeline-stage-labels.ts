const PIPELINE_STAGE_LABELS: Record<string, string> = {
  MeshGeneration: '正在构建球面拓扑网格…',
  PlateTectonics: '正在生成构造细分、主要板块与小板块…',
  ContinentalCrust: '正在布置大陆地壳与候选海陆…',
  PlateDynamics: '正在计算板块运动与地幔流…',
  DataProjection: '正在向高精度网格投影地壳特征…',
  MantleAndTectonics: '正在构建动态地形与应力强化…',
  ElevationAndTerrain: '正在生成地形与冰川、水力整形…',
  SeasonalCirculation: '正在计算四季风场与洋流…',
  MonthlyClimate: '正在计算 12 个月的气温与降水…',
  ClimateOutputProjection: '正在将气候细化到最终地形…',
  KoppenClimate: '正在依据 12 个月气候划分 Köppen 类型…',
  Biome: '正在依据气候与地形划分生物群系…',
  SurfaceHydrology: '正在汇集年径流并生成河流网…',
  PopulationAndSettlements: '正在计算宜居性、人口与聚落…',
  TransportAndMarkets: '正在连接聚落并计算市场可达性…',
  EthnicityAndLanguages: '正在生成人口构成、民族与语言…',
  PolitiesAndAdministration: '正在划分国家与行政区…',
  ReligionsAndBeliefs: '正在生成宗教起源、传播与居民信仰构成…',
}

export function getPipelineStageLabel(stageName: string): string {
  return PIPELINE_STAGE_LABELS[stageName] ?? `正在执行: ${stageName}`
}
