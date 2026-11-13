<script lang='ts'>
  import { CircleQuestionMark } from '@lucide/svelte'
  import type { ClimateArtifact, CryosphereArtifact, EcologyArtifact, GeographicRegionsArtifact, GeologyArtifact, HydrologyArtifact, SphericalMesh, StagePlan, StaticLakeArtifact, TerrainArtifact } from '@another-earth/world-core'
  import { buildGeographicLabelAnchors } from '@another-earth/cartography'
  import type { GeologyTheme } from './map-theme-data'
  import type { RegionSelection, ViewStats } from './map-render-data'
  import { DEFAULT_CLIMATE_PARAMETERS, DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_HYDROLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS, KOPPEN_CODES, queryClimateRegion, queryEcologyRegion, queryGeologyRegion, queryHydrologyRegion, queryStaticLakeRegion, queryTerrainRegion } from '@another-earth/world-core'
  import { onMount } from 'svelte'
  import AppUI from '@/ui/AppUI.svelte'
  import Checkbox from '@/ui/components/Checkbox.svelte'
  import Select from '@/ui/components/Select.svelte'
  import Slider from '@/ui/components/Slider.svelte'
  import Tooltip from '@/ui/components/Tooltip.svelte'
  import { getPipelineStageLabel } from '@/ui/hud/pipeline-stage-labels'
  import { appState } from '@/ui/state/app.svelte'
  import { GenerationCancelledError, GenerationController } from '../lib/generation/controller'
  import { geographicNameLabel, geographicRegionLabel, geologyRegionColor, KOPPEN_LABELS } from './map-theme-data'
  import { buildLayerStatistics } from './layer-statistics'
  import { prepareMapOverlayGeometry } from './map-overlay-data'
  import { prepareRenderGeometry, prepareRegionSelection } from './map-render-data'
  import { createWorldScene } from './world-scene'
  import type { SceneGeographicLabel } from './world-scene'

  const terrainControls = [
    { key: 'roughness', label: '地形粗糙度', description: '调整地形噪声的起伏幅度，影响山地、平原和海岸的细节强弱。', max: 0.5 },
    { key: 'terrainWarp', label: '地形扭曲', description: '调整噪声坐标的弯曲程度，让地形纹理产生更多拉伸和转向。', max: 1 },
    { key: 'smoothing', label: '地形平滑', description: '调整高程平滑强度；数值较高时地形过渡更柔和，局部细节会减少。', max: 1 },
    { key: 'hydraulicErosion', label: '水力侵蚀', description: '调整简化水力侵蚀强度；当前实际作用会再乘以 0.5。', max: 1 },
    { key: 'glacialErosion', label: '冰川侵蚀', description: '调整简化冰川侵蚀强度，影响高地削蚀与山谷塑形。', max: 1 },
    { key: 'ridgeSharpening', label: '山脊锐化', description: '增强构造山脉和山脊的局部对比与陡峭感。', max: 1 },
  ] as const
  type GenerationKind = 'mesh' | 'geology' | 'terrain' | 'climate' | 'hydrology' | 'ecology' | 'world'
  const hydrologyAreaSliderMax = 7
  const hydrologyAreaToSlider = (value: number) => Math.log10(value + 1)
  const hydrologyAreaFromSlider = (value: number) => Math.round(10 ** value - 1)
  const formatAreaKm2 = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  const generationOptions: { label: string, value: GenerationKind }[] = [
    { label: '仅网格', value: 'mesh' },
    { label: '板块与地壳', value: 'geology' },
    { label: '基础地形', value: 'terrain' },
    { label: '气候', value: 'climate' },
    { label: '冰雪与水文', value: 'hydrology' },
    { label: '生物群系与自然覆盖', value: 'ecology' },
    { label: '完整自然世界', value: 'world' },
  ]
  const compassDirections = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'] as const

  function formatCirculationSpeed(speedMps: number | null, east: number, north: number, digits: number): string {
    if (speedMps === null)
      return '无数据'
    const speed = `${speedMps.toFixed(digits)} m/s`
    if (speedMps === 0)
      return speed
    const sector = Math.round(Math.atan2(east, north) / (Math.PI / 4))
    return `${speed} · 向${compassDirections[(sector + 8) % 8]}`
  }

  let viewportElement: HTMLDivElement
  let level = $state(7)
  let irregularity = $state(0.75)
  let seed = $state('1024')
  const mode = 'voronoi'
  let generationKind = $state<GenerationKind>('world')
  let loadedWorldSnapshotId = $state<string | null>(null)
  const geologyParameters = $state({ ...DEFAULT_GEOLOGY_PARAMETERS })
  const terrainParameters = $state({ ...DEFAULT_TERRAIN_PARAMETERS })
  const landformParameters = $state({ ...DEFAULT_LANDFORM_PARAMETERS })
  const climateParameters = $state({ ...DEFAULT_CLIMATE_PARAMETERS, axialTiltDegrees: 23.5, precipitationScale: 1.8 })
  const hydrologyParameters = $state({ ...DEFAULT_HYDROLOGY_PARAMETERS })
  let climateMonth = $state(0)
  let loadedClimate = $state.raw<ClimateArtifact | null>(null)
  let loadedCryosphere = $state.raw<CryosphereArtifact | null>(null)
  let loadedHydrology = $state.raw<HydrologyArtifact | null>(null)
  let loadedLakes = $state.raw<StaticLakeArtifact | null>(null)
  let loadedEcology = $state.raw<EcologyArtifact | null>(null)
  let selectedClimate = $state<ReturnType<typeof queryClimateRegion> | null>(null)
  let selectedHydrology = $state<ReturnType<typeof queryHydrologyRegion> | null>(null)
  let selectedLake = $state<ReturnType<typeof queryStaticLakeRegion> | null>(null)
  let selectedEcology = $state<ReturnType<typeof queryEcologyRegion> | null>(null)
  let loadedTerrain = $state.raw<TerrainArtifact | null>(null)
  let loadedRegions = $state.raw<GeographicRegionsArtifact | null>(null)
  let selectedTerrain = $state<ReturnType<typeof queryTerrainRegion> | null>(null)
  let geologyTheme = $state<GeologyTheme>('satellite')
  let loadedGeology = $state.raw<GeologyArtifact | null>(null)
  let selectedGeology = $state<ReturnType<typeof queryGeologyRegion> | null>(null)
  let stages = $state<readonly StagePlan[]>([])
  let wireframe = $state(false)
  let showSurface = $state(true)
  let showAtmosphere = $state(true)
  let showDayNight = $state(true)
  let showRivers = $state(true)
  let showLakes = $state(true)
  let showFiveNeighborPoints = $state(false)
  let showGraticule = $state(false)
  let rotate = $state(false)
  let busy = $state(false)
  let progress = $state(0)
  let message = $state('打开参数面板并配置生成选项。')
  let error = $state('')
  let stats = $state<ViewStats | null>(null)
  let selected = $state<RegionSelection | null>(null)
  let gpuGeometries = $state(0)
  let picking = $state(false)
  let controller: GenerationController | undefined
  let loadedMesh = $state.raw<SphericalMesh>()
  let pickReady = false
  let requestId = 0
  let pickId = 0
  let scene: ReturnType<typeof createWorldScene> | undefined
  let geographicLabels: SceneGeographicLabel[] = []
  const availableThemes = $derived.by(() => {
    const themes: { value: GeologyTheme, label: string }[] = []
    if (loadedGeology)
      themes.push({ value: 'plates', label: '运动板块' }, { value: 'candidate-land', label: '候选海陆' }, { value: 'crust', label: '地壳类型' }, { value: 'topology', label: '网格拓扑' })
    if (loadedTerrain)
      themes.push({ value: 'satellite', label: '卫星影像' }, { value: 'elevation', label: '基础高程（km）' }, { value: 'land', label: '基础海陆' }, { value: 'boundaries', label: '构造边界' }, { value: 'mantle', label: '地幔升降' }, { value: 'volcanism', label: '火山塑形贡献' }, { value: 'slope', label: '坡度' })
    if (loadedRegions)
      themes.push({ value: 'continents', label: '大陆、洋与海' })
    if (loadedClimate)
      themes.push(
        { value: 'temperature', label: '月平均气温（°C）' }, { value: 'precipitation', label: '月总降水（mm）' },
        { value: 'annual-temperature', label: '年平均气温（°C）' }, { value: 'annual-precipitation', label: '年总降水（mm/年）' },
        { value: 'koppen', label: 'Köppen 气候分类' }, { value: 'wind', label: '月风场' },
        { value: 'wind-speed', label: '估算 10 米风速（m/s）' }, { value: 'ocean-speed', label: '估算表层流速（m/s）' },
        { value: 'ocean-current', label: '洋流（流速底色）' },
      )
    if (loadedCryosphere)
      themes.push({ value: 'snow', label: '月末积雪水当量（mm）' })
    if (loadedHydrology)
      themes.push({ value: 'runoff', label: '年径流深（mm）' }, { value: 'rivers', label: '河网' }, { value: 'basins', label: '流域' })
    if (loadedLakes)
      themes.push({ value: 'lakes', label: '静态湖泊' })
    if (loadedEcology)
      themes.push({ value: 'biomes', label: '生物群系分类' }, { value: 'land-cover', label: '自然覆盖（群系归并）' })
    return themes
  })
  const layerStatistics = $derived.by(() => loadedMesh
    ? buildLayerStatistics(geologyTheme, {
        regionCount: loadedMesh.regionCount,
        geology: loadedGeology,
        terrain: loadedTerrain,
        regions: loadedRegions,
        climate: loadedClimate,
        cryosphere: loadedCryosphere,
        hydrology: loadedHydrology,
        lakes: loadedLakes,
        ecology: loadedEcology,
        mesh: loadedMesh,
        regionAreaKm2: loadedMesh.areaKm2,
        month: climateMonth,
      })
    : undefined)
  const hydrologySummary = $derived.by(() => {
    if (!loadedMesh || !loadedTerrain || !loadedHydrology)
      return undefined
    let landAreaKm2 = 0
    let riverAreaKm2 = 0
    for (let region = 0; region < loadedMesh.regionCount; region++) {
      if (!loadedTerrain.landMask[region])
        continue
      landAreaKm2 += loadedMesh.areaKm2[region]
      if (loadedHydrology.riverMask[region])
        riverAreaKm2 += loadedMesh.areaKm2[region]
    }
    const lakeAreasKm2 = (loadedLakes?.lakes ?? []).map(lake => lake.areaKm2).sort((a, b) => a - b)
    const middle = Math.floor(lakeAreasKm2.length / 2)
    const medianLakeAreaKm2 = lakeAreasKm2.length === 0
      ? null
      : lakeAreasKm2.length % 2 === 0
        ? (lakeAreasKm2[middle - 1] + lakeAreasKm2[middle]) / 2
        : lakeAreasKm2[middle]
    return {
      riverSegmentCount: loadedHydrology.rivers.length,
      effectiveRiverThresholdKm2: loadedHydrology.effectiveRiverThresholdKm2,
      riverCoveragePercent: landAreaKm2 > 0 ? riverAreaKm2 / landAreaKm2 * 100 : 0,
      lakeCount: lakeAreasKm2.length,
      totalLakeAreaKm2: lakeAreasKm2.reduce((sum, area) => sum + area, 0),
      medianLakeAreaKm2,
    }
  })

  function formatLayerPercentage(value: number): string {
    return value > 0 && value < 0.01 ? '<0.01%' : `${value.toFixed(2)}%`
  }

  function calculateRenderBytes(geometry: ReturnType<typeof prepareRenderGeometry>): number {
    return Object.values(geometry).reduce((sum, array) => sum + (ArrayBuffer.isView(array) ? array.byteLength : 0), 0)
  }

  function scenePresentation() {
    return {
      satellite: geologyTheme === 'satellite',
      atmosphere: showAtmosphere,
      dayNight: showDayNight,
      month: climateMonth,
      axialTiltDegrees: climateParameters.axialTiltDegrees,
    }
  }
  function options() {
    scene?.setOptions(wireframe, showSurface, rotate, showFiveNeighborPoints, showGraticule)
    scene?.setPresentation(scenePresentation())
  }
  async function generate(force = false) {
    if (!scene || !controller)
      return
    if (!seed.trim()) {
      error = '随机种子不能为空。'
      return
    }
    const id = ++requestId
    ++pickId
    busy = true
    progress = 0
    picking = false
    pickReady = false
    error = ''
    message = `正在生成 L${level} · 扰动 ${irregularity.toFixed(2)}…`
    try {
      const previousWorld = controller.publishedWorld
      const result = await controller.generate({ seed, ...(generationKind === 'world' ? { publication: { snapshotId: `snapshot:${crypto.randomUUID()}`, worldId: `world:${seed}`, name: `World ${seed}`, createdAt: new Date().toISOString(), revision: previousWorld?.worldId === `world:${seed}` ? previousWorld.revision + 1 : 0 } } : {}), config: { planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 }, mesh: { subdivisionLevel: level, irregularity }, ...(generationKind !== 'mesh' ? { geology: { ...geologyParameters } } : {}), ...(['terrain', 'climate', 'hydrology', 'ecology', 'world'].includes(generationKind) ? { terrain: { ...terrainParameters }, landforms: { ...landformParameters } } : {}), ...(['climate', 'hydrology', 'ecology', 'world'].includes(generationKind) ? { climate: { ...climateParameters } } : {}), ...(['hydrology', 'world'].includes(generationKind) ? { hydrology: { ...hydrologyParameters } } : {}), ...(['ecology', 'world'].includes(generationKind) ? { ecology: true as const } : {}) }, force })
      if (id !== requestId)
        return
      const preparing = performance.now()
      if (!result.terrain && ['satellite', 'elevation', 'land', 'boundaries', 'mantle', 'volcanism', 'uplift', 'relief', 'plains', 'slope'].includes(geologyTheme))
        geologyTheme = 'plates'
      if (!result.climate && !result.hydrology && ['temperature', 'precipitation', 'annual-temperature', 'annual-precipitation', 'koppen', 'wind', 'wind-speed', 'ocean-speed', 'ocean-current', 'snow', 'runoff', 'rivers', 'basins', 'lakes'].includes(geologyTheme))
        geologyTheme = 'plates'
      if (!result.ecology && ['biomes', 'land-cover'].includes(geologyTheme))
        geologyTheme = 'plates'
      if (result.terrain && !loadedTerrain)
        geologyTheme = 'satellite'
      if (result.climate && !loadedClimate && geologyTheme !== 'satellite')
        geologyTheme = 'temperature'
      if (!result.regions && geologyTheme === 'continents')
        geologyTheme = result.geology ? 'plates' : 'topology'
      if (result.hydrology && !loadedHydrology && geologyTheme !== 'satellite')
        geologyTheme = 'rivers'
      if (result.ecology && !['satellite', 'biomes', 'land-cover'].includes(geologyTheme))
        geologyTheme = 'biomes'
      const nextGeographicLabels: SceneGeographicLabel[] = result.regions
        ? buildGeographicLabelAnchors(result.mesh, result.regions).map(anchor => ({ ...anchor, text: geographicNameLabel(anchor.name, anchor.kind, 0) }))
        : []
      const overlays = prepareMapOverlayGeometry(result.mesh, geologyTheme, result.climate, climateMonth, result.terrain, result.hydrology, showRivers, result.lakes, showLakes)
      const geometry = prepareRenderGeometry(result.mesh, mode, geologyRegionColor(result.geology, geologyTheme, result.terrain, result.climate, climateMonth, result.cryosphere, result.hydrology, result.lakes, result.ecology, result.mesh, result.regions), geologyTheme === 'satellite' ? result.terrain?.landMask : undefined, overlays)
      const preparationMs = performance.now() - preparing
      scene.install(geometry, wireframe, showSurface, scenePresentation())
      geographicLabels = nextGeographicLabels
      scene.setGeographicLabels(geologyTheme === 'continents' ? geographicLabels : [])
      options()
      loadedMesh = result.mesh
      loadedGeology = result.geology ?? null
      loadedTerrain = result.terrain ?? null
      loadedRegions = result.regions ?? null
      loadedClimate = result.climate ?? null
      loadedCryosphere = result.cryosphere ?? null
      loadedHydrology = result.hydrology ?? null
      loadedLakes = result.lakes ?? null
      loadedEcology = result.ecology ?? null
      if (result.candidateWorld)
        controller.commitWorld(result.candidateWorld.snapshotId)
      loadedWorldSnapshotId = result.candidateWorld?.snapshotId ?? null
      stages = result.stages ?? []
      selected = null
      selectedGeology = null
      selectedTerrain = null
      selectedClimate = null
      selectedHydrology = null
      selectedLake = null
      selectedEcology = null
      stats = { level: result.mesh.subdivisionLevel, irregularity: result.mesh.irregularity, seed: result.mesh.seed, fiveNeighborRegions: geometry.fiveNeighborCenters.length / 3, regions: result.mesh.regionCount, edges: result.mesh.edgeRegions.length / 2, faces: result.mesh.triangles.length / 3, generationMs: result.pipelineMs, cacheHit: result.cacheHit, cacheBytes: result.cacheBytes, preparationMs, renderBytes: calculateRenderBytes(geometry), copyMs: result.copyMs, meshBytes: result.meshBytes, receiveMs: result.receiveMs, workerInitMs: controller.workerInitMs, hydrateMs: result.hydrateMs, postMessageMs: 0 }
      busy = false
      progress = 1
      pickReady = true
      message = `L${stats.level} · 扰动 ${stats.irregularity.toFixed(2)} ${loadedWorldSnapshotId ? '完整自然世界' : loadedEcology ? '初步生态' : loadedHydrology ? '冰雪与水文' : loadedClimate ? '气候' : loadedTerrain ? '基础地形' : loadedGeology ? '板块与地壳' : '网格'}已就绪`
    }
    catch (cause) {
      if (id !== requestId)
        return
      busy = false
      progress = 0
      pickReady = false
      if (cause instanceof GenerationCancelledError) {
        message = loadedMesh ? '生成已取消。旧网格仅供查看；重新生成后可选择区域。' : '生成已取消。'
      }
      else {
        error = cause instanceof Error ? cause.message : '生成失败，请重试。'
        message = loadedMesh ? '生成失败。旧网格仅供查看；重新生成后可选择区域。' : '生成失败。'
      }
    }
  }
  function cancel() {
    if (!busy)
      return
    ++requestId
    ++pickId
    controller?.cancel('hard')
    busy = false
    progress = 0
    pickReady = false
    message = loadedMesh ? '生成已取消。旧网格仅供查看；重新生成后可选择区域。Worker 缓存已清空。' : '生成已取消。Worker 缓存已清空。'
  }
  function chooseLevel() {
    rotate = false
    options()
  }
  function randomizeSeed() {
    const value = new Uint32Array(1)
    crypto.getRandomValues(value)
    seed = String((value[0] % 999999) + 1)
  }
  function randomizeAndGenerate() {
    randomizeSeed()
    void generate()
  }
  function setWireframe(value: boolean) {
    wireframe = value
    options()
  }
  function setSurface(value: boolean) {
    showSurface = value
    options()
  }
  function setFiveNeighborPoints(value: boolean) {
    showFiveNeighborPoints = value
    options()
  }
  function setGraticule(value: boolean) {
    showGraticule = value
    options()
  }
  function setRotate(value: boolean) {
    rotate = value
    options()
  }
  function setAtmosphere(value: boolean) {
    showAtmosphere = value
    options()
  }
  function setDayNight(value: boolean) {
    showDayNight = value
    options()
  }
  function setRivers(value: boolean) {
    showRivers = value
    refreshMap()
  }
  function setLakes(value: boolean) {
    showLakes = value
    refreshMap()
  }
  function refreshMap() {
    if (!loadedMesh || !scene || !stats || busy)
      return
    ++pickId
    picking = false
    const preparing = performance.now()
    const overlays = prepareMapOverlayGeometry(loadedMesh, geologyTheme, loadedClimate, climateMonth, loadedTerrain, loadedHydrology, showRivers, loadedLakes, showLakes)
    const geometry = prepareRenderGeometry(loadedMesh, mode, geologyRegionColor(loadedGeology, geologyTheme, loadedTerrain, loadedClimate, climateMonth, loadedCryosphere, loadedHydrology, loadedLakes, loadedEcology, loadedMesh, loadedRegions), geologyTheme === 'satellite' ? loadedTerrain?.landMask : undefined, overlays)
    scene.install(geometry, wireframe, showSurface, scenePresentation())
    scene.setGeographicLabels(geologyTheme === 'continents' ? geographicLabels : [])
    stats = { ...stats, preparationMs: performance.now() - preparing, renderBytes: calculateRenderBytes(geometry) }
    selected = null
    selectedGeology = null
    selectedTerrain = null
    selectedClimate = null
    selectedHydrology = null
    selectedLake = null
    selectedEcology = null
  }
  function chooseClimateMonth() {
    const prior = { selected, selectedGeology, selectedTerrain, selectedEcology }
    refreshMap()
    selected = prior.selected
    selectedGeology = prior.selectedGeology
    selectedTerrain = prior.selectedTerrain
    selectedEcology = prior.selectedEcology
    if (selected && loadedClimate) {
      selectedClimate = queryClimateRegion(loadedClimate, selected.region, climateMonth)
      selectedHydrology = loadedHydrology ? queryHydrologyRegion(loadedHydrology, selected.region, loadedClimate, loadedCryosphere ?? undefined) : null
      selectedLake = loadedLakes ? queryStaticLakeRegion(loadedLakes, selected.region) : null
      selectedEcology = loadedEcology ? queryEcologyRegion(loadedEcology, selected.region) : null
      scene?.showSelection(selected)
    }
    else {
      selectedClimate = null
      selectedHydrology = null
      selectedLake = null
      selectedEcology = null
    }
  }
  onMount(() => {
    try {
      scene = createWorldScene(viewportElement, (position) => {
        if (busy || !pickReady || !loadedMesh || !controller)
          return
        picking = true
        const id = ++pickId
        const mesh = loadedMesh
        Promise.resolve().then(() => loadedWorldSnapshotId ? controller!.pickWorld({ x: position.x, y: position.y, z: position.z }) : controller!.pick({ x: position.x, y: position.y, z: position.z })).then((region) => {
          if (id !== pickId || !pickReady || mesh !== loadedMesh)
            return
          selected = prepareRegionSelection(mesh, region)
          selectedGeology = loadedGeology ? queryGeologyRegion(loadedGeology, region) : null
          selectedTerrain = loadedTerrain ? queryTerrainRegion(loadedTerrain, region) : null
          selectedClimate = loadedClimate ? queryClimateRegion(loadedClimate, region, climateMonth) : null
          selectedHydrology = loadedHydrology ? queryHydrologyRegion(loadedHydrology, region, loadedClimate ?? undefined, loadedCryosphere ?? undefined) : null
          selectedLake = loadedLakes ? queryStaticLakeRegion(loadedLakes, region) : null
          selectedEcology = loadedEcology ? queryEcologyRegion(loadedEcology, region) : null
          scene?.showSelection(selected)
          picking = false
        }).catch((cause) => {
          if (id === pickId) {
            error = cause instanceof Error ? cause.message : '区域查询失败。'
            picking = false
          }
        })
      }, (count) => { gpuGeometries = count }, (text) => {
        error = text
      })
      controller = new GenerationController((state) => {
        if (state.status === 'running' && busy) {
          progress = state.pipelineProgress
          message = `${getPipelineStageLabel(state.stageId ?? 'mesh')} ${Math.round(state.pipelineProgress * 100)}%`
        }
        if (state.status === 'completed' && state.postMessageMs !== undefined && stats)
          stats = { ...stats, postMessageMs: state.postMessageMs }
      })
      if (new URLSearchParams(window.location.search).get('autogenerate') !== '0') {
        requestAnimationFrame(() => void generate())
      }
    }
    catch (cause) {
      error = cause instanceof Error ? cause.message : '无法启动 WebGL，请检查浏览器支持。'
    }
    return () => {
      ++pickId
      controller?.dispose()
      scene?.dispose()
    }
  })
</script>

<AppUI
  {seed}
  status={message}
  {busy}
  {progress}
  {error}
  hasSelection={Boolean(selected)}
  selectionLabel={selected ? `SECTOR ${selected.region}` : ''}
  {showSurface}
  {showFiveNeighborPoints}
  {rotate}
  {showAtmosphere}
  {showDayNight}
  {showRivers}
  {showLakes}
  {showGraticule}
  satellite={geologyTheme === 'satellite'}
  onGenerate={() => generate()}
  onCancel={cancel}
  onRandomize={randomizeAndGenerate}
  onToggleSurface={setSurface}
  onToggleFiveNeighborPoints={setFiveNeighborPoints}
  onToggleRotate={setRotate}
  onToggleAtmosphere={setAtmosphere}
  onToggleDayNight={setDayNight}
  onToggleRivers={setRivers}
  onToggleLakes={setLakes}
  onToggleGraticule={setGraticule}
>
  {#snippet viewport()}
    <div bind:this={viewportElement} class='absolute inset-0'></div>
    {#if !loadedMesh && !busy}
      <section class='pointer-events-none absolute inset-x-0 top-1/2 mx-auto flex max-w-sm -translate-y-1/2 flex-col items-center gap-3 px-6 text-center'>
        <div class='flex h-20 w-20 items-center justify-center rounded-full border border-obs-primary/20 bg-[#1e1e20]/50 text-obs-primary/80 shadow-[0_0_48px_rgba(22,119,255,0.12)] backdrop-blur-sm'>
          <span class='font-heading text-3xl font-light'>AE</span>
        </div>
        <h1 class='font-heading text-sm font-semibold tracking-[0.16em] text-obs-text-main'>ANOTHER EARTH</h1>
        <p class='text-xs leading-relaxed text-obs-text-muted'>正在准备默认星球；你也可以调整参数后重新生成。</p>
      </section>
    {/if}
  {/snippet}

  {#snippet coreContent()}
    <div class='flex flex-col gap-2'>
      <Select label='生成内容' description='选择要运行的生成步骤；较完整的选项会自动包含所需的上游结果。' bind:value={generationKind} options={generationOptions} />
      <Slider label='细分等级' description='控制球面网格的细分程度；等级越高，区域数量以及内存和显存占用越大。' bind:value={level} min={4} max={8} step={1} decimals={0} formatValue={value => `L${value}`} onchange={chooseLevel} />
      <label class='flex flex-col gap-1 py-1 text-obs-text-main'>
        <span class='flex items-center gap-1.5 font-sans text-[11px] text-obs-text-muted'>
          随机种子
          <Tooltip content='决定生成随机序列；相同种子、参数和算法版本可复现相同结果。仅生成规则网格且扰动为 0 时，种子不影响网格。' delayDuration={100}>
            <span class='cursor-help text-obs-text-dim transition-colors hover:text-white'><CircleQuestionMark class='h-3 w-3' /></span>
          </Tooltip>
        </span>
        <input aria-label='随机种子' class='w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-2.5 py-1.5 font-mono text-xs text-obs-text-main outline-none transition-all focus:border-obs-primary/60 focus:ring-1 focus:ring-obs-primary/30' type='text' bind:value={seed} onkeydown={(event) => {
          if (event.key === 'Enter')
            generate()
        }} />
      </label>
    </div>
  {/snippet}

  {#snippet natureContent()}
    <div class='flex flex-col gap-4'>
      <section class='flex flex-col gap-2' aria-label='网格参数'>
        <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>球面网格</span><div class='flex-1 h-px bg-white/5'></div></div>
        <Slider label='网格规整度' description='控制球面采样点的位置扰动；数值越高，网格形状越不规则。' bind:value={irregularity} min={0} max={1} step={0.05} decimals={2} />
      </section>
      {#if generationKind !== 'mesh'}
        <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-3' aria-label='地质参数'>
          <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>构造与地质</span><div class='flex-1 h-px bg-white/5'></div></div>
          <Slider label='主板块数' description='主要运动板块的生成目标数；板块形状和可分区域会影响最终数量。' bind:value={geologyParameters.primaryPlateCount} min={2} max={100} step={1} decimals={0} />
          <Slider label='微板块目标数' description='在主要板块边界附近生成的微板块目标数；符合边界与连通条件的数量可能更少。' bind:value={geologyParameters.microPlateCount} min={0} max={100 - geologyParameters.primaryPlateCount} step={1} decimals={0} />
          <Slider label='板块面积差异' description='控制板块目标面积的差异程度；数值较高时，大板块和小板块的面积差距会增大。' bind:value={geologyParameters.plateSizeVariety} min={0} max={1} step={0.05} decimals={2} />
          <Slider label='候选大陆目标数' description='生成候选大陆区域的目标数量；受板块连通和面积约束，结果可能少于目标。' bind:value={geologyParameters.continentCount} min={1} max={100} step={1} decimals={0} />
          <Slider label='候选陆地目标比例' description='候选大陆所覆盖的球面面积比例。最终海岸线由高程和海平面共同决定，可能与候选范围不同。' bind:value={geologyParameters.candidateLandCoverage} min={0} max={1} step={0.05} decimals={2} formatValue={value => `${Math.round(value * 100)}%`} />
          <Slider label='候选大陆面积差异' description='控制不同候选大陆的目标面积差距；数值较高时，更容易形成大小悬殊的大陆。' bind:value={geologyParameters.continentSizeVariety} min={0} max={1} step={0.05} decimals={2} />
        </section>
      {/if}
      {#if ['terrain', 'climate', 'hydrology', 'ecology', 'world'].includes(generationKind)}
        <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-3' aria-label='地形参数'>
          <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>地形与岛屿</span><div class='flex-1 h-px bg-white/5'></div></div>
          <Slider label='岛弧目标数' description='海洋俯冲带岛弧源点的数量上限；受合适的板块边界约束，不代表最终独立岛屿数。' bind:value={landformParameters.islandArcCount} min={0} max={100} step={1} decimals={0} />
          <Slider label='岛屿密度' description='调节岛弧地形片段和近岸小岛的生成倾向、影响范围与起伏；不直接指定最终岛屿数量。' bind:value={landformParameters.islandDensity} min={0} max={1} step={0.05} decimals={2} />
          <Slider label='热点目标数' description='地幔热点链的生成目标数；受可用热点位置和间距约束，最终数量可能更少。' bind:value={landformParameters.hotspotCount} min={0} max={100} step={1} decimals={0} />
          {#each terrainControls as parameter}
            <Slider label={parameter.label} description={parameter.description} bind:value={terrainParameters[parameter.key]} min={0} max={parameter.max} step={0.05} decimals={2} />
          {/each}
        </section>
      {/if}
      {#if ['climate', 'hydrology', 'ecology', 'world'].includes(generationKind)}
        <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-3' aria-label='气候参数'>
          <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>气候与环境</span><div class='flex-1 h-px bg-white/5'></div></div>
          <Slider label='轴倾角（°）' description='控制行星自转轴相对公转平面的倾斜程度，影响季节温差和降水的季节分布。' bind:value={climateParameters.axialTiltDegrees} min={0} max={45} step={0.1} decimals={1} />
          <Slider label='公转周期（地球日）' description='控制一年的长度，决定气候季节循环的时间尺度。' bind:value={climateParameters.orbitalPeriodDays} min={300} max={430} step={0.25} decimals={2} />
          <Slider label='温度偏移（°C）' description='整体平移模型气温基线；正值使气候偏暖，负值使气候偏冷。' bind:value={climateParameters.temperatureOffsetC} min={-20} max={20} step={0.5} decimals={1} />
          <Slider label='降水倍率' description='按比例调整模型降水；数值越高，整体降水越多。' bind:value={climateParameters.precipitationScale} min={0} max={3} step={0.1} decimals={1} />
        </section>
      {/if}
      {#if generationKind === 'hydrology' || generationKind === 'world'}
        <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-3' aria-label='水文参数'>
          <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>冰雪与水文</span><div class='flex-1 h-px bg-white/5'></div></div>
          <Slider label='融雪系数（mm / °C / 月）' description='温度每高于融雪阈值 1°C 时，每月融化的雪水当量；属于简化温度指数模型。' bind:value={hydrologyParameters.degreeDayMeltFactorMmPerCMonth} min={0} max={100} step={0.5} decimals={1} />
          <Slider label='蒸散温度系数（mm / °C / 月）' description='温度升高时蒸散需求增加的幅度；属于温度指数近似，不是完整蒸散模型。' bind:value={hydrologyParameters.evapotranspirationFactorMmPerCMonth} min={0} max={100} step={0.5} decimals={1} />
          <div class='flex items-center gap-2 border-t border-white/[0.06] pt-2'><span class='font-sans text-[10px] uppercase tracking-wide text-obs-text-muted font-bold'>河流与湖泊</span><div class='flex-1 h-px bg-white/5'></div></div>
          <Slider label='河网密度倍率' description='倍率越高，允许达到河道门槛的区域越多；默认 1 保持当前密度。受气候产流和地形汇流共同限制。' bind:value={hydrologyParameters.riverDensityMultiplier} min={0.5} max={2} step={0.05} decimals={2} />
          <Slider label='基准汇水面积' description='河道阈值取本值与 16 倍平均网格面积中的较大值，再由河网密度倍率缩放。面积采用对数刻度，范围 0–10,000,000 km²；基准越高通常河道越少。' bind:value={hydrologyParameters.minimumRiverDrainageAreaKm2} min={0} max={hydrologyAreaSliderMax} step={0.01} decimals={0} unit=' km²' toSlider={hydrologyAreaToSlider} fromSlider={hydrologyAreaFromSlider} formatValue={formatAreaKm2} />
          <Slider label='最小湖泊面积' description='只保留面积达到门槛的地形湖候选，不会扩大湖盆；0 表示沿用至少两个网格区域的筛选规则。面积采用对数刻度，范围 0–10,000,000 km²。' bind:value={hydrologyParameters.minimumLakeAreaKm2} min={0} max={hydrologyAreaSliderMax} step={0.01} decimals={0} unit=' km²' toSlider={hydrologyAreaToSlider} fromSlider={hydrologyAreaFromSlider} formatValue={formatAreaKm2} />
        </section>
      {/if}
      {#if level >= 6}<p class='rounded-md border border-obs-primary/10 bg-obs-primary/[0.04] p-2 text-[10px] leading-relaxed text-obs-text-dim'>高等级网格包含大量区域，显存和内存占用较高。</p>{/if}
      {#if stats}
        <section class='border-t border-white/[0.06] pt-3' aria-label='生成操作'>
          <button type='button' class='w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] text-obs-text-muted transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40' onclick={() => generate(true)} disabled={busy}>强制重算</button>
        </section>
      {/if}
    </div>
  {/snippet}

  {#snippet civilizationContent()}
    <div class='flex flex-col gap-3'>
      <div class='flex items-center gap-2'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>人口与聚落</span><div class='flex-1 h-px bg-white/5'></div></div>
      <div class='rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-obs-text-dim'>文明生成尚未迁移。此处保留参考 UI 的参数分组位置；控件将在 M1 算法与流程重迁之后接入。</div>
      <div class='flex flex-col gap-2 opacity-35' aria-disabled='true'>
        <div class='flex items-center justify-between py-1 text-[11px] text-obs-text-muted'><span>人口规模</span><span>未接入</span></div>
        <div class='h-1 rounded-full bg-white/[0.08]'></div>
        <div class='flex items-center justify-between py-1 text-[11px] text-obs-text-muted'><span>聚落密度</span><span>未接入</span></div>
        <div class='h-1 rounded-full bg-white/[0.08]'></div>
        <div class='flex items-center justify-between py-1 text-[11px] text-obs-text-muted'><span>道路连通度</span><span>未接入</span></div>
        <div class='h-1 rounded-full bg-white/[0.08]'></div>
      </div>
    </div>
  {/snippet}

  {#snippet layerContent()}
    <div class='flex flex-col gap-3'>
      <section class='flex flex-col gap-2'>
        <div class='flex items-center justify-between px-0.5'><span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>1. 制图样式</span><span class='text-[10px] text-obs-text-dim font-mono'>Map Style</span></div>
        <div class='grid grid-cols-2 gap-1.5'>
          {#each ['标准地图', '自然地理', '生态地图'] as style}
            <button type='button' disabled title='正式地图样式尚未接入' class='flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-left text-[11px] text-obs-text-dim opacity-40'><span class='h-3.5 w-3.5 rounded-full border border-white/20 bg-obs-primary/20'></span>{style}</button>
          {/each}
        </div>
      </section>
      <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-2'>
        <div class='flex items-center justify-between px-0.5'><span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>2. 专题面与可用数据</span><span class='text-[10px] text-obs-text-dim font-mono'>Thematic Layers</span></div>
        {#if !availableThemes.length}
          <p class='rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-center text-[10px] text-obs-text-dim'>生成地质或自然数据后可切换专题。</p>
        {/if}
        <div class='grid grid-cols-2 gap-1.5'>
          {#each availableThemes as theme}
            <button
              type='button'
              aria-pressed={geologyTheme === theme.value}
              onclick={() => {
                geologyTheme = theme.value
                refreshMap()
              }}
              class="rounded-lg border px-2 py-1.5 text-left text-[10px] transition-colors {geologyTheme === theme.value ? 'border-obs-primary/40 bg-obs-primary/10 text-obs-primary' : 'border-white/[0.06] bg-white/[0.02] text-obs-text-muted hover:bg-white/[0.05]'}"
            >
              {theme.label}
            </button>
          {/each}
        </div>
        {#if loadedClimate}
          <label class='flex flex-col gap-1 rounded-lg border border-white/[0.04] bg-white/[0.02] px-2.5 py-2 text-[11px] text-obs-text-muted'>显示月份（季节水热强迫）
            <input aria-label='月份' class='mt-2 w-full accent-obs-primary' type='range' min='0' max='11' step='1' bind:value={climateMonth} oninput={chooseClimateMonth} />
            <span class='text-right font-mono text-[10px] text-obs-primary'>第 {climateMonth + 1} 月</span>
          </label>
        {/if}
        {#if layerStatistics}
          <section class='overflow-hidden rounded-xl border border-white/[0.07] bg-black/25' aria-label='图层图例与统计'>
            <div class='border-b border-white/[0.06] bg-white/[0.025] px-3 py-2'>
              <div class='flex items-center justify-between gap-2'>
                <span class='text-[11px] font-semibold text-obs-text-main'>图例统计 · {layerStatistics.title}</span>
                <span class='shrink-0 font-mono text-[9px] text-obs-text-dim'>{layerStatistics.totalCells.toLocaleString()} 区域</span>
              </div>
              {#if layerStatistics.description}<p class='mt-1 text-[10px] leading-relaxed text-obs-text-dim'>{layerStatistics.description}</p>{/if}
              {#if geologyTheme === 'wind'}
                <div class='mt-1.5 flex items-center gap-1.5 text-[9px] text-obs-text-dim'><span class='font-mono text-sm leading-none text-[#A9FFF1]'>→</span><span>箭头方向</span></div>
              {:else if geologyTheme === 'ocean-current'}
                <div class='mt-1.5 flex items-center gap-1.5 text-[9px] text-obs-text-dim'><span class='font-mono text-sm leading-none text-white'>→</span><span>方向</span><span class='h-1 w-8 rounded-full' style='background:linear-gradient(90deg,#2166AC,#F7F7F7,#B2182B)'></span><span>冷 → 暖</span></div>
              {/if}
            </div>
            <div class='flex flex-col gap-0.5 p-1.5'>
              {#each layerStatistics.rows as row (row.key)}
                <div class='rounded-lg px-2 py-1.5 hover:bg-white/[0.04]'>
                  <div class='flex items-center gap-2 text-[10px]'>
                    <span class='h-2 w-2 shrink-0 rounded-full shadow-sm' style:background-color={row.color}></span>
                    <span class='min-w-0 flex-1 break-words leading-tight text-obs-text-main'>{row.label}</span>
                    <span class='font-mono tabular-nums text-obs-text-muted'>{row.count.toLocaleString()}</span>
                    <span class='w-12 text-right font-mono tabular-nums text-obs-primary'>{formatLayerPercentage(row.percentage)}</span>
                  </div>
                  {#if row.areaKm2 !== undefined}<div class='ml-4 mt-0.5 text-[9px] text-obs-text-dim'>面积 {row.areaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</div>{/if}
                  <div class='ml-4 mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]'>
                    <div class='h-full rounded-full' style:background-color={row.color} style:width={`${row.count > 0 ? Math.max(row.percentage, 0.3) : 0}%`}></div>
                  </div>
                </div>
              {/each}
            </div>
          </section>
        {/if}
        <p class='text-[10px] leading-relaxed text-obs-text-dim'>图层仅在对应数据产物存在时可选；专题颜色只改变显示。</p>
      </section>
      <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-2'>
        <div class='flex items-center justify-between px-0.5'><span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>3. 矢量要素与注记</span><span class='text-[10px] text-obs-text-dim font-mono'>Vectors</span></div>
        <div class='flex flex-col gap-1.5'>
          <Checkbox
            label='水系河流（专题显示）'
            checked={geologyTheme === 'rivers'}
            onchange={(value) => {
              if (value) {
                geologyTheme = 'rivers'
                refreshMap()
              }
            }}
          />
          <Checkbox
            label='静态湖泊（专题显示）'
            checked={geologyTheme === 'lakes'}
            onchange={(value) => {
              if (value) {
                geologyTheme = 'lakes'
                refreshMap()
              }
            }}
            disabled={!loadedLakes}
          />
          <Checkbox label='国界与地名（未接入）' checked={false} disabled />
        </div>
      </section>
      <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-2'>
        <div class='flex items-center justify-between px-0.5'><span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>4. 环境与辅助</span><span class='text-[10px] text-obs-text-dim font-mono'>Environment</span></div>
        <Checkbox label='显示 Cell 网格' description='显示球面区域边界线。' checked={wireframe} onchange={setWireframe} />
        <div class='rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-[10px] leading-relaxed text-obs-text-dim'>河流与湖泊是独立水文产物，不参与生物群系和自然覆盖分类。</div>
      </section>
      {#if loadedGeology}
        <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-2 text-[10px] text-obs-text-dim' aria-label='地质结果'>
          <div class='flex items-center justify-between'><span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>生成统计</span><span class='font-mono'>Geology</span></div>
          <dl class='grid grid-cols-2 gap-y-1.5'><dt>参考区域数</dt><dd>{loadedGeology.referenceRegionCount.toLocaleString()}</dd><dt>运动板块数</dt><dd>{loadedGeology.plates.length}</dd><dt>微板块目标 / 实际</dt><dd>{loadedGeology.statistics.requestedMicroPlateCount} / {loadedGeology.statistics.actualMicroPlateCount}</dd><dt>候选大陆数</dt><dd>{loadedGeology.continents.length}</dd></dl>
        </section>
      {/if}
      {#if loadedTerrain}
        <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-2 text-[10px] text-obs-text-dim' aria-label='最终地形统计'><div class='flex items-center justify-between'><span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>最终地形</span></div><dl class='grid grid-cols-2 gap-y-1.5'><dt title='按球面区域实际面积加权'>陆地面积占比</dt><dd>{(loadedTerrain.statistics.landCoverage * 100).toFixed(1)}%</dd><dt>海陆变化区域</dt><dd>{loadedTerrain.statistics.changedCoastRegions.toLocaleString()}</dd><dt>陆地连通分量</dt><dd>{loadedTerrain.statistics.landComponentCount}</dd><dt>最低 / 最高（km）</dt><dd>{loadedTerrain.statistics.minimumElevationKm.toFixed(2)} / {loadedTerrain.statistics.maximumElevationKm.toFixed(2)}</dd></dl></section>
      {/if}
      {#if loadedRegions}
        <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-2 text-[10px] text-obs-text-dim' aria-label='大陆与海域统计'><div class='flex items-center justify-between'><span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>大陆与海域</span></div><dl class='grid grid-cols-2 gap-y-1.5'><dt>大陆数</dt><dd>{loadedRegions.continents.length}</dd><dt>洋数</dt><dd>{loadedRegions.oceans.length}</dd><dt>海数</dt><dd>{loadedRegions.seas.length}</dd></dl></section>
      {/if}
      {#if hydrologySummary}
        <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-2 text-[10px] text-obs-text-dim' aria-label='河流与湖泊生成统计'>
          <div class='flex items-center justify-between'><span class='font-bold tracking-wider uppercase text-obs-primary/90'>河流与湖泊</span><span class='font-mono'>Hydrology</span></div>
          <dl class='grid grid-cols-2 gap-y-1.5'>
            <dt>河道段数</dt><dd>{hydrologySummary.riverSegmentCount.toLocaleString()}</dd>
            <dt title='按含河道网格的面积占陆地面积计算，不代表实际水面宽度'>河道网格占陆地</dt><dd>{hydrologySummary.riverCoveragePercent.toFixed(2)}%</dd>
            <dt>有效汇水门槛</dt><dd>{hydrologySummary.effectiveRiverThresholdKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</dd>
            <dt>湖泊数</dt><dd>{hydrologySummary.lakeCount.toLocaleString()}</dd>
            <dt>湖泊总面积</dt><dd>{hydrologySummary.totalLakeAreaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</dd>
            <dt>湖泊中位面积</dt><dd>{hydrologySummary.medianLakeAreaKm2 === null ? '—' : `${hydrologySummary.medianLakeAreaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²`}</dd>
          </dl>
          <p class='border-t border-white/[0.06] pt-1 leading-relaxed'>河道和湖泊数量由种子、地形与气候共同决定；参数调整后需重新生成。</p>
        </section>
      {/if}
      {#if loadedEcology}<p class='border-t border-white/[0.06] pt-2 text-[10px] leading-relaxed text-obs-text-dim'>生物群系依据气候与地形生成；雪冰与自然覆盖均为模型分类结果。</p>{/if}
      {#if stages.length}
        <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-2 text-[10px]' aria-label='阶段缓存'><div class='flex items-center justify-between'><span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>生成管线</span><span class='text-obs-text-dim font-mono'>Stage Cache</span></div><ul class='space-y-1 font-mono text-obs-text-dim'>{#each stages as stage}<li class='flex justify-between gap-2'><span class='truncate'>{stage.stageId}:</span><span class={stage.action === 'cache-hit' ? 'text-obs-primary' : 'text-obs-text-muted'}>&nbsp;{stage.action === 'cache-hit' ? 'Cache Hit' : 'Rebuilt'}</span></li>{/each}</ul></section>
      {/if}
      {#if stats}
        <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-2 text-[10px]' aria-label='网格统计'>
          <div class='flex items-center justify-between'><span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>网格与性能</span><span class='text-obs-text-dim font-mono'>Mesh Stats</span></div>
          <dl class='grid grid-cols-2 gap-y-1.5'>
            <dt>已加载等级</dt><dd>L{stats.level}</dd>
            <dt>扰动 / 随机种子</dt><dd class='break-all'>{stats.irregularity.toFixed(2)} / {stats.seed}</dd>
            <dt>Regions / V</dt><dd>{stats.regions.toLocaleString()}</dd>
            <dt>五邻域</dt><dd>{stats.fiveNeighborRegions.toLocaleString()}</dd>
            <dt>Edges / E</dt><dd>{stats.edges.toLocaleString()}</dd>
            <dt>Faces / F</dt><dd>{stats.faces.toLocaleString()}</dd>
            <dt>V − E + F</dt><dd>{stats.regions - stats.edges + stats.faces}</dd>
            <dt>Pipeline</dt><dd>{stats.cacheHit ? 'Cache Hit' : 'Rebuilt'}</dd>
            <dt>Pipeline 耗时</dt><dd>{stats.generationMs.toFixed(1)} ms</dd>
            <dt>Worker 初始化</dt><dd>{stats.workerInitMs.toFixed(1)} ms</dd>
            <dt>传输副本</dt><dd>{stats.copyMs.toFixed(1)} ms</dd>
            <dt>postMessage</dt><dd>{stats.postMessageMs.toFixed(1)} ms</dd>
            <dt>主线程校验</dt><dd>{stats.hydrateMs.toFixed(1)} ms</dd>
            <dt>请求往返</dt><dd>{stats.receiveMs.toFixed(1)} ms</dd>
            <dt>传输数组</dt><dd>{(stats.meshBytes / 2 ** 20).toFixed(1)} MiB</dd>
            <dt>缓存数组</dt><dd>{(stats.cacheBytes / 2 ** 20).toFixed(1)} MiB</dd>
            <dt>显示数据准备</dt><dd>{stats.preparationMs.toFixed(1)} ms</dd>
            <dt>显示数组</dt><dd>{(stats.renderBytes / 2 ** 20).toFixed(1)} MiB</dd>
            <dt>GPU 几何体</dt><dd>{gpuGeometries}</dd>
          </dl>
        </section>
      {/if}
    </div>
  {/snippet}

  {#snippet inspectorContent()}
    <section class='flex flex-col gap-3 text-xs' aria-label='选中区域'>
      {#if picking}<p role='status' class='text-obs-text-dim'>正在查询最近区域…</p>{/if}
      {#if selected}
        <div class='flex flex-col gap-2 text-xs'>
          <p class='font-mono text-obs-primary'>Region #{selected.region} · {selected.neighbors.length} 个邻居</p>
          <p class='text-obs-text-muted'>面积 {selected.areaKm2.toLocaleString(undefined, { maximumFractionDigits: 2 })} km²</p>
          <p class='break-words text-[10px] text-obs-text-dim'>邻居：{selected.neighbors.join(', ')}</p>
          {#if selectedGeology}<dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-2 break-all'><dt class='text-obs-text-dim'>地质 / 普通参考区域</dt><dd>{selectedGeology.referenceRegion} / {selectedGeology.geographicReferenceRegion}</dd><dt class='text-obs-text-dim'>运动板块</dt><dd class='font-mono'>{selectedGeology.plateId}</dd><dt class='text-obs-text-dim'>基础细分索引</dt><dd>{selectedGeology.subdivisionIndex}</dd><dt class='text-obs-text-dim'>候选大陆</dt><dd class='font-mono'>{selectedGeology.continentId ?? '海洋'}</dd><dt class='text-obs-text-dim'>地壳</dt><dd>{selectedGeology.crustType === 'continental' ? '大陆地壳' : '海洋地壳'} · {selectedGeology.thicknessKm.toFixed(1)} km · {selectedGeology.densityGcm3.toFixed(2)} g/cm³</dd></dl>{/if}
          {#if selectedTerrain}<dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-2' aria-label='区域地形'><dt class='text-obs-text-dim'>最终高程 / 海陆</dt><dd>{selectedTerrain.elevationKm.toFixed(3)} km · {selectedTerrain.land ? '陆地' : '水域'}</dd><dt class='text-obs-text-dim'>坡度</dt><dd>{(selectedTerrain.slopeRadians * 180 / Math.PI).toFixed(2)}°</dd><dt class='text-obs-text-dim'>构造边界 / 应力</dt><dd>{['无边界', '汇聚', '张裂', '走滑'][selectedTerrain.boundaryType]} / {selectedTerrain.stress.toFixed(3)}</dd><dt class='text-obs-text-dim'>地幔 / 火山塑形</dt><dd>{selectedTerrain.mantleFlow.toFixed(3)} / {selectedTerrain.volcanicCoordinate.toFixed(3)}</dd></dl>{/if}
          {#if loadedRegions}<dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-2' aria-label='大陆与海域归属'><dt class='text-obs-text-dim'>大陆 / 洋 / 海</dt><dd>{geographicRegionLabel(loadedRegions, selected.region)}</dd></dl>{/if}
          {#if selectedClimate}
            <dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-2' aria-label='区域气候'>
              <dt class='text-obs-text-dim'>第 {selectedClimate.month + 1} 月气温</dt><dd>{selectedClimate.temperatureC.toFixed(1)} °C</dd>
              <dt class='text-obs-text-dim'>第 {selectedClimate.month + 1} 月降水</dt><dd>{selectedClimate.precipitationMm.toFixed(1)} mm</dd>
              <dt class='text-obs-text-dim'>年平均气温</dt><dd>{selectedClimate.annualMeanTemperatureC.toFixed(1)} °C</dd>
              <dt class='text-obs-text-dim'>年总降水</dt><dd>{selectedClimate.annualPrecipitationMm.toFixed(0)} mm/年</dd>
              <dt class='text-obs-text-dim'>初步 Köppen 类型</dt><dd>{KOPPEN_CODES[selectedClimate.koppenClass]} · {KOPPEN_LABELS[selectedClimate.koppenClass]}</dd>
              <dt class='text-obs-text-dim'>估算 10 米风速／吹向</dt><dd>{formatCirculationSpeed(selectedClimate.windSpeedMps, selectedClimate.windEast, selectedClimate.windNorth, 1)}</dd>
              <dt class='text-obs-text-dim'>估算表层流速／流向</dt><dd>{formatCirculationSpeed(selectedClimate.oceanSpeedMps, selectedClimate.oceanEast, selectedClimate.oceanNorth, 2)}</dd>
              <dt class='text-obs-text-dim'>洋流暖度代理</dt><dd>{selectedClimate.oceanCurrentAvailable ? selectedClimate.oceanWarmth.toFixed(2) : '无数据'}</dd>
            </dl>
          {/if}
          {#if selectedEcology}<dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-2' aria-label='区域生态'><dt class='text-obs-text-dim'>生物群系（潜在）</dt><dd>{selectedEcology.potentialBiomeLabel} · {selectedEcology.potentialBiomeCode}</dd><dt class='text-obs-text-dim'>自然覆盖（归并）</dt><dd>{selectedEcology.landCoverLabel} · {selectedEcology.landCoverCode}</dd><dt class='text-obs-text-dim'>干旱指数</dt><dd>{selectedEcology.aridityIndex.toFixed(3)}</dd><dt class='text-obs-text-dim'>生长季</dt><dd>{selectedEcology.growingSeasonMonths} / 12</dd></dl>{/if}
          {#if selectedHydrology}<dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-2' aria-label='区域水文'><dt class='text-obs-text-dim'>年径流深 / 局地产流</dt><dd>{selectedHydrology.annualRunoffMm.toFixed(1)} mm / {selectedHydrology.annualRunoffVolumeM3.toExponential(2)} m³/年</dd><dt class='text-obs-text-dim'>汇流量 / 汇水面积</dt><dd>{selectedHydrology.accumulatedFlowM3s.toFixed(2)} m³/s · {selectedHydrology.contributingAreaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</dd><dt class='text-obs-text-dim'>下游区域</dt><dd>{selectedHydrology.downstreamRegion < 0 ? (selectedHydrology.basinId === null ? '海洋' : selectedHydrology.basinEndorheic ? '内流汇点' : '海洋出口') : `Region #${selectedHydrology.downstreamRegion}`}</dd><dt class='text-obs-text-dim'>流域</dt><dd>{selectedHydrology.basinId ?? '海洋'}</dd><dt class='text-obs-text-dim'>河道段</dt><dd>{selectedHydrology.riverSegments.map(river => `${river.id} · ${river.strahlerOrder}级`).join('；') || '非河道区域'}</dd></dl>{/if}
          {#if geologyTheme === 'lakes'}{#if selectedLake}<dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-2' aria-label='区域湖泊'><dt class='text-obs-text-dim'>静态湖泊</dt><dd class='break-all'>{selectedLake.id}</dd><dt class='text-obs-text-dim'>湖泊类型</dt><dd>{selectedLake.endorheic ? '内流终止盆地' : '有溢流路径'}</dd><dt class='text-obs-text-dim'>水位 / 面积</dt><dd>{selectedLake.waterLevelKm.toFixed(3)} km / {selectedLake.areaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</dd><dt class='text-obs-text-dim'>流域</dt><dd class='break-all'>{selectedLake.basinId}</dd></dl>{:else}<p class='text-obs-text-dim'>该区域不属于静态湖泊。</p>{/if}{/if}
        </div>
      {:else}
        <p class='text-obs-text-dim'>点击球面查看最近区域及邻接关系。</p>
      {/if}
      <div class='flex flex-col gap-1 border-t border-white/[0.06] pt-3 text-[10px] text-obs-text-dim'><p><span class='text-amber-400'>●</span> 五邻域中心 <span class='text-yellow-400'>●</span> 选中区域</p><p><span class='text-emerald-400'>●</span> 相邻中心与连线</p></div>
    </section>
  {/snippet}
</AppUI>
