const PIPELINE_STAGE_LABELS: Record<string, string> = {
  'mesh': '正在构建球面拓扑网格…',
  'reference-mesh': '正在构建参考球面网格…',
  'reference-subdivisions': '正在细分参考网格…',
  'plate-topology': '正在生成构造板块…',
  'continental-crust': '正在生成大陆地壳…',
  'plate-dynamics': '正在计算板块运动…',
  'tectonics': '正在计算构造骨架…',
  'tectonic-elevation': '正在塑造基础高程…',
  'geology': '正在完成地质投影…',
  'terrain': '正在生成地形…',
  'geographic-regions': '正在划分大陆、洋与海…',
  'geographic-names': '正在命名大陆与大洋…',
  'climate-c0': '正在计算初步气候…',
  'cryosphere-i0': '正在计算积雪与融雪…',
  'hydrology-h0': '正在生成初步径流与河网…',
  'static-lakes-l1': '正在识别静态洼地湖泊…',
  'ecology-e0': '正在生成初步生态分类…',
}

export function getPipelineStageLabel(stageId: string): string {
  return PIPELINE_STAGE_LABELS[stageId] ?? `正在执行：${stageId}`
}
