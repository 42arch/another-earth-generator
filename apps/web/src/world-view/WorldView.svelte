<script lang='ts'>
  import type {
    BuiltinMapStylePresetId,
    CartographySession,
    CartographyViewState,
    LegendDescriptor,
    MapPickResult,
    MapProjectionId,
    MapViewportMode,
  } from '@another-earth/cartography'
  import type { StagePlan, WorldMapReader } from '@another-earth/world-core'
  import {
    createCartographySession,
    DEFAULT_CARTOGRAPHY_VIEW_STATE,
    getBuiltinMapStylePreset,
    formatContinentDisplayName,
    formatOceanDisplayName,
    KOPPEN_CLASS_LABELS_ZH,
  } from '@another-earth/cartography'
  import {
    DEFAULT_CLIMATE_PARAMETERS,
    DEFAULT_GEOLOGY_PARAMETERS,
    DEFAULT_HYDROLOGY_PARAMETERS,
    DEFAULT_LANDFORM_PARAMETERS,
    DEFAULT_TERRAIN_PARAMETERS,
    KOPPEN_CODES,
  } from '@another-earth/world-core'
  import { NATURAL_BIOME_DEFINITIONS, NATURAL_LAND_COVER_DEFINITIONS } from '@another-earth/world-data'
  import { CircleQuestionMark } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import AppUI from '@/ui/AppUI.svelte'
  import Checkbox from '@/ui/components/Checkbox.svelte'
  import Slider from '@/ui/components/Slider.svelte'
  import Toggle from '@/ui/components/Toggle.svelte'
  import Tooltip from '@/ui/components/Tooltip.svelte'
  import {
    LAYER_GROUPS,
    OVERLAY_ITEMS,
    splitStyleDefaultLayers,
    STYLE_PRESET_CARDS,
    SURFACE_LAYER_ITEM,
  } from '@/ui/hud/layer-presentation'
  import { getPipelineStageLabel } from '@/ui/hud/pipeline-stage-labels'
  import { appState } from '@/ui/state/app.svelte'
  import { GenerationCancelledError, GenerationController } from '../lib/generation/controller'
  import { buildLayerStatisticsFromReader, formatLayerStatistics } from './layer-statistics'

  const terrainControls = [
    { key: 'roughness', label: '地形粗糙度', description: '调整地形噪声的起伏幅度，影响山地、平原和海岸的细节强弱。', max: 0.5 },
    { key: 'terrainWarp', label: '地形扭曲', description: '调整噪声坐标的弯曲程度，让地形纹理产生更多拉伸和转向。', max: 1 },
    { key: 'smoothing', label: '地形平滑', description: '调整高程平滑强度；数值较高时地形过渡更柔和，局部细节会减少。', max: 1 },
    { key: 'hydraulicErosion', label: '水力侵蚀', description: '调整简化水力侵蚀强度；当前实际作用会再乘以 0.5。', max: 1 },
    { key: 'glacialErosion', label: '冰川侵蚀', description: '调整简化冰川侵蚀强度，影响高地削蚀与山谷塑形。', max: 1 },
    { key: 'ridgeSharpening', label: '山脊锐化', description: '增强构造山脉和山脊的局部对比与陡峭感。', max: 1 },
  ] as const

  const hydrologyAreaSliderMax = 7
  const hydrologyAreaToSlider = (value: number) => Math.log10(value + 1)
  const hydrologyAreaFromSlider = (value: number) => Math.round(10 ** value - 1)
  const formatAreaKm2 = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  const compassDirections = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'] as const

  interface WorldPerformanceStats {
    readonly level: number
    readonly irregularity: number
    readonly seed: string
    readonly regions: number
    readonly corners: number
    readonly edges: number
    readonly cacheHit: boolean
    readonly cacheBytes: number
    readonly generationMs: number
    readonly workerInitMs: number
    readonly copyMs: number
    readonly postMessageMs: number
    readonly hydrateMs: number
    readonly receiveMs: number
    readonly meshBytes: number
    readonly preparationMs: number
  }

  interface SelectedRegionInspection {
    readonly regionId: number
    readonly coordinates: { readonly longitudeDegrees: number, readonly latitudeDegrees: number }
    readonly featureHit?: { readonly layerId: string, readonly sourceId: string, readonly featureId: string }
    readonly neighbors: readonly number[]
    readonly slopeDeg: number
    readonly regionFacts: ReturnType<GenerationController['queryWorldRegion']>
    readonly continentLabel: string
    readonly basin: ReturnType<GenerationController['queryWorldBasin']>
    readonly river: ReturnType<GenerationController['queryWorldRiver']>
    readonly lake: ReturnType<GenerationController['queryWorldLake']>
    readonly windText: string
    readonly oceanText: string
    readonly oceanWarmthText: string
    readonly biomeLabel: string
    readonly landCoverLabel: string
    readonly koppenLabel: string
    readonly contributingAreaKm2: number
    readonly accumulatedFlowM3s: number
  }

  function formatCirculationVector(east: number, north: number, available: boolean, digits: number): string {
    if (!available)
      return '无数据'
    const speedMps = Math.hypot(east, north)
    if (!Number.isFinite(speedMps))
      return '无数据'
    const speed = `${speedMps.toFixed(digits)} m/s`
    if (speedMps < 1e-4)
      return speed
    const sector = Math.round(Math.atan2(east, north) / (Math.PI / 4))
    return `${speed} · 向${compassDirections[(sector + 8) % 8]}`
  }

  function formatLayerPercentage(value: number): string {
    return value > 0 && value < 0.01 ? '<0.01%' : `${value.toFixed(2)}%`
  }

  let viewportElement: HTMLDivElement
  let level = $state(7)
  let irregularity = $state(0.75)
  let seed = $state('1024')

  const geologyParameters = $state({ ...DEFAULT_GEOLOGY_PARAMETERS })
  const terrainParameters = $state({ ...DEFAULT_TERRAIN_PARAMETERS })
  const landformParameters = $state({ ...DEFAULT_LANDFORM_PARAMETERS })
  const climateParameters = $state({ ...DEFAULT_CLIMATE_PARAMETERS, axialTiltDegrees: 23.5, precipitationScale: 1.8 })
  const hydrologyParameters = $state({ ...DEFAULT_HYDROLOGY_PARAMETERS })

  let viewMode = $state<MapViewportMode>(DEFAULT_CARTOGRAPHY_VIEW_STATE.viewMode)
  let projectionId = $state<MapProjectionId>(DEFAULT_CARTOGRAPHY_VIEW_STATE.projectionId)
  let styleId = $state<BuiltinMapStylePresetId>('satellite')
  let activeThematicId = $state<string | null>(null)
  let surfaceEnabled = $state(true)
  let enabledOverlayIds = $state<string[]>(['rivers', 'lakes', 'labels'])
  let graticuleEnabled = $state(false)
  let cellWireframeEnabled = $state(false)
  let climateMonth = $state(0)
  let rotate = $state(false)
  let showAtmosphere = $state(true)
  let showDayNight = $state(true)
  let selection = $state<{ regionId: number | null, featureId: string | null }>({
    regionId: null,
    featureId: null,
  })
  let lastPickResult = $state.raw<MapPickResult | null>(null)

  let activeReader = $state.raw<WorldMapReader | null>(null)
  let activeLegend = $state.raw<LegendDescriptor | null>(null)
  let stages = $state<readonly StagePlan[]>([])
  let stats = $state<WorldPerformanceStats | null>(null)
  let gpuCounts = $state({ geometries: 0, materials: 0, textures: 0 })

  let busy = $state(false)
  let progress = $state(0)
  let message = $state('打开参数面板并配置生成选项。')
  let error = $state('')
  let copiedStats = $state(false)

  let controller: GenerationController | undefined
  let session: CartographySession | undefined
  let prepareAbortController: AbortController | null = null
  let requestId = 0

  function buildViewState(): CartographyViewState {
    return {
      viewMode,
      projectionId,
      styleId,
      activeThematicId,
      surfaceEnabled,
      enabledOverlayIds: [
        ...enabledOverlayIds,
        ...(graticuleEnabled ? ['graticule'] : []),
        ...(cellWireframeEnabled ? ['cell-wireframe'] : []),
      ],
      climateMonth,
      globeEffects: {
        rotate,
        atmosphere: showAtmosphere,
        dayNight: showDayNight,
      },
      selection,
    }
  }

  function applySessionViewState(): void {
    if (!session)
      return
    session.setViewState(buildViewState())
    activeLegend = session.activeLegend
    gpuCounts = session.getActiveGpuResourceCounts()
  }

  function setOverlayEnabled(overlayId: string, enabled: boolean): void {
    const has = enabledOverlayIds.includes(overlayId)
    if (enabled && !has) {
      enabledOverlayIds = [...enabledOverlayIds, overlayId]
      applySessionViewState()
    }
    else if (!enabled && has) {
      enabledOverlayIds = enabledOverlayIds.filter(id => id !== overlayId)
      applySessionViewState()
    }
  }

  function selectViewMode(nextMode: MapViewportMode): void {
    if (viewMode === nextMode)
      return
    viewMode = nextMode
    applySessionViewState()
  }

  function selectProjection(nextProjection: MapProjectionId): void {
    if (projectionId === nextProjection)
      return
    projectionId = nextProjection
    applySessionViewState()
  }

  function applyStyleLayerDefaults(nextStyleId: BuiltinMapStylePresetId): void {
    const preset = getBuiltinMapStylePreset(nextStyleId)
    const defaults = splitStyleDefaultLayers(preset.defaultEnabledLayerIds ?? [SURFACE_LAYER_ITEM.id])
    surfaceEnabled = defaults.surfaceEnabled
    activeThematicId = defaults.thematicId
    enabledOverlayIds = defaults.overlayIds
    const globeEffects = preset.defaultGlobeEffects ?? { atmosphere: false, dayNight: false }
    showAtmosphere = globeEffects.atmosphere
    showDayNight = globeEffects.dayNight
  }

  function selectStylePreset(nextStyleId: BuiltinMapStylePresetId): void {
    if (styleId === nextStyleId)
      return
    styleId = nextStyleId
    applyStyleLayerDefaults(nextStyleId)
    applySessionViewState()
  }

  function selectThematic(thematicId: string | null): void {
    activeThematicId = activeThematicId === thematicId ? null : thematicId
    applySessionViewState()
  }

  function toggleSurfaceLayer(): void {
    surfaceEnabled = !surfaceEnabled
    applySessionViewState()
  }

  function chooseClimateMonth(): void {
    applySessionViewState()
  }

  function resetCamera(): void {
    session?.resetCamera()
  }

  const layerStatistics = $derived.by(() => {
    if (!activeReader)
      return undefined
    return buildLayerStatisticsFromReader(activeReader, {
      activeThematicId,
      styleId,
      month: climateMonth,
      legend: activeLegend,
    })
  })

  const worldSummary = $derived.by(() => {
    if (!activeReader)
      return undefined
    const count = activeReader.mesh.regionCount
    const landMask = activeReader.field('landMask')
    const elevation = activeReader.field('elevationKm')
    const riverIndex = activeReader.field('riverIndex')

    let totalAreaKm2 = 0
    let landAreaKm2 = 0
    let riverAreaKm2 = 0
    let minElevKm = Infinity
    let maxElevKm = -Infinity

    for (let r = 0; r < count; r++) {
      const area = activeReader.mesh.getRegionAreaKm2(r)
      totalAreaKm2 += area
      const elev = elevation.get(r)
      if (elev < minElevKm)
        minElevKm = elev
      if (elev > maxElevKm)
        maxElevKm = elev
      if (landMask.get(r) !== 0) {
        landAreaKm2 += area
        if (riverIndex.get(r) >= 0)
          riverAreaKm2 += area
      }
    }

    const geo = activeReader.geographicRegions()
    const rivers = activeReader.rivers()
    const lakes = activeReader.lakes()
    const basins = activeReader.basins()
    const plates = activeReader.plates()
    const lakeAreas = lakes.map(l => l.areaKm2).sort((a, b) => a - b)
    const mid = Math.floor(lakeAreas.length / 2)
    const medianLakeAreaKm2 = lakeAreas.length === 0
      ? null
      : lakeAreas.length % 2 === 0
      ? (lakeAreas[mid - 1] + lakeAreas[mid]) * 0.5
      : lakeAreas[mid]

    return {
      plateCount: plates.length,
      landCoveragePercent: totalAreaKm2 > 0 ? (landAreaKm2 / totalAreaKm2) * 100 : 0,
      minElevationKm: Number.isFinite(minElevKm) ? minElevKm : 0,
      maxElevationKm: Number.isFinite(maxElevKm) ? maxElevKm : 0,
      continentCount: geo?.continents.length ?? 0,
      oceanCount: geo?.oceans.length ?? 0,
      seaCount: geo?.seas.length ?? 0,
      basinCount: basins.length,
      riverCount: rivers.length,
      riverCoveragePercent: landAreaKm2 > 0 ? (riverAreaKm2 / landAreaKm2) * 100 : 0,
      lakeCount: lakes.length,
      totalLakeAreaKm2: lakeAreas.reduce((sum, a) => sum + a, 0),
      medianLakeAreaKm2,
    }
  })

  const selectedInspection = $derived.by<SelectedRegionInspection | null>(() => {
    if (!activeReader || !controller || selection.regionId === null)
      return null
    const regionId = selection.regionId
    if (regionId < 0 || regionId >= activeReader.mesh.regionCount)
      return null

    try {
      const regionFacts = controller.queryWorldRegion(regionId, climateMonth)
      const neighbors: number[] = []
      activeReader.mesh.forEachRegionNeighbor(regionId, (neighbor) => {
        neighbors.push(neighbor)
      })
      const slopeDeg = activeReader.field('slopeDeg').get(regionId)
      const contributingAreaKm2 = activeReader.field('contributingAreaKm2').get(regionId)
      const accumulatedFlowM3s = activeReader.field('accumulatedAnnualFlowM3s').get(regionId)

      const geo = activeReader.geographicRegions()
      let continentLabel = regionFacts.land ? '陆地' : '海洋'
      if (geo) {
        const cIdx = activeReader.field('continentIndex').get(regionId)
        const oIdx = activeReader.field('oceanIndex').get(regionId)
        const sIdx = activeReader.field('seaIndex').get(regionId)
        if (cIdx >= 0) {
          continentLabel = formatContinentDisplayName(geo.continents[cIdx]?.name, cIdx)
        }
        else if (oIdx >= 0) {
          continentLabel = formatOceanDisplayName(geo.oceans[oIdx]?.name, oIdx)
        }
        else if (sIdx >= 0) {
          continentLabel = `海 ${sIdx + 1}`
        }
      }

      let windText = '无数据'
      let oceanText = '无数据'
      let oceanWarmthText = '无数据'
      if (activeReader.capabilities.hasCirculation) {
        const wEast = activeReader.monthlyField('windEastMps', climateMonth).get(regionId)
        const wNorth = activeReader.monthlyField('windNorthMps', climateMonth).get(regionId)
        windText = formatCirculationVector(wEast, wNorth, true, 1)

        const oceanAvail = activeReader.field('oceanAvailable').get(regionId) !== 0 && !regionFacts.land
        if (oceanAvail) {
          const oEast = activeReader.monthlyField('oceanEastMps', climateMonth).get(regionId)
          const oNorth = activeReader.monthlyField('oceanNorthMps', climateMonth).get(regionId)
          const warmth = activeReader.monthlyField('oceanWarmth', climateMonth).get(regionId)
          oceanText = formatCirculationVector(oEast, oNorth, true, 2)
          oceanWarmthText = warmth.toFixed(2)
        }
      }

      const biomeDef = NATURAL_BIOME_DEFINITIONS.find(d => d.id === regionFacts.potentialBiomeId)
      const coverDef = NATURAL_LAND_COVER_DEFINITIONS.find(d => d.id === regionFacts.landCoverId)
      const koppenCode = KOPPEN_CODES[regionFacts.koppenClass] ?? 'Ocean'
      const koppenZh = KOPPEN_CLASS_LABELS_ZH[regionFacts.koppenClass] ?? koppenCode

      const basin = regionFacts.basinId ? controller.queryWorldBasin(regionFacts.basinId) : null
      const hitId = lastPickResult?.featureHit?.featureId
      const riverIdToQuery = hitId && lastPickResult?.featureHit?.sourceId.startsWith('river-')
        ? hitId
        : regionFacts.riverId
      const lakeIdToQuery = hitId && lastPickResult?.featureHit?.sourceId === 'lake-polygons'
        ? hitId
        : regionFacts.lakeId

      const river = riverIdToQuery ? controller.queryWorldRiver(riverIdToQuery) : null
      const lake = lakeIdToQuery ? controller.queryWorldLake(lakeIdToQuery) : null

      return {
        regionId,
        coordinates: lastPickResult?.coordinates ?? { longitudeDegrees: 0, latitudeDegrees: 0 },
        featureHit: lastPickResult?.featureHit,
        neighbors,
        slopeDeg,
        regionFacts,
        continentLabel,
        basin,
        river,
        lake,
        windText,
        oceanText,
        oceanWarmthText,
        biomeLabel: biomeDef ? `${biomeDef.nameZh} · ${biomeDef.id}` : regionFacts.potentialBiomeId,
        landCoverLabel: coverDef ? `${coverDef.nameZh} · ${coverDef.id}` : regionFacts.landCoverId,
        koppenLabel: koppenZh,
        contributingAreaKm2,
        accumulatedFlowM3s,
      }
    }
    catch {
      return null
    }
  })

  function handleViewportPick(result: MapPickResult): void {
    if (busy || !activeReader || result.snapshotId !== activeReader.identity.snapshotId)
      return
    lastPickResult = result
    selection = {
      regionId: result.regionId,
      featureId: result.featureHit?.featureId ?? null,
    }
    appState.inspectorOpen = true
    applySessionViewState()
  }

  async function generate(force = false): Promise<void> {
    if (!session || !controller)
      return
    if (!seed.trim()) {
      error = '随机种子不能为空。'
      return
    }

    prepareAbortController?.abort()
    const abortController = new AbortController()
    prepareAbortController = abortController

    const id = ++requestId
    busy = true
    progress = 0
    error = ''
    message = `正在生成 L${level} · 扰动 ${irregularity.toFixed(2)}…`

    try {
      const previousWorld = controller.publishedWorld
      const snapshotId = `snapshot:${crypto.randomUUID()}`
      const result = await controller.generate({
        seed,
        publication: {
          snapshotId,
          worldId: `world:${seed}`,
          name: `World ${seed}`,
          createdAt: new Date().toISOString(),
          revision: previousWorld?.worldId === `world:${seed}` ? previousWorld.revision + 1 : 0,
        },
        config: {
          planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
          mesh: { subdivisionLevel: level, irregularity },
          geology: { ...geologyParameters },
          terrain: { ...terrainParameters },
          landforms: { ...landformParameters },
          climate: { ...climateParameters },
          hydrology: { ...hydrologyParameters },
          ecology: true as const,
        },
        force,
      })

      if (id !== requestId || abortController.signal.aborted)
        return

      const candidateSnapshotId = result.candidateWorld?.snapshotId
      if (!candidateSnapshotId) {
        throw new Error('未能构建完整自然世界候选快照。')
      }

      const prepStart = performance.now()
      const candidateReader = controller.candidateMapReader(candidateSnapshotId)
      const nextSelection = { regionId: null, featureId: null }
      const nextViewState: CartographyViewState = {
        ...buildViewState(),
        selection: nextSelection,
      }

      const prepared = await session.prepareWorld(candidateReader, nextViewState, {
        signal: abortController.signal,
      })
      if (id !== requestId || abortController.signal.aborted) {
        prepared.dispose()
        return
      }

      controller.commitWorld(candidateSnapshotId)
      session.activateWorld(prepared)
      const preparationMs = performance.now() - prepStart

      const publishedReader = controller.publishedMapReader()
      activeReader = publishedReader
      activeLegend = session.activeLegend
      selection = nextSelection
      lastPickResult = null
      stages = result.stages ?? []
      gpuCounts = session.getActiveGpuResourceCounts()

      stats = {
        level: result.mesh.subdivisionLevel,
        irregularity: result.mesh.irregularity,
        seed: result.mesh.seed,
        regions: publishedReader.mesh.regionCount,
        corners: publishedReader.mesh.cornerCount,
        edges: publishedReader.mesh.edgeCount,
        cacheHit: result.cacheHit,
        cacheBytes: result.cacheBytes,
        generationMs: result.pipelineMs,
        workerInitMs: controller.workerInitMs,
        copyMs: result.copyMs,
        postMessageMs: controller.lastPostMessageMs,
        hydrateMs: result.hydrateMs,
        receiveMs: result.receiveMs,
        meshBytes: result.meshBytes,
        preparationMs,
      }

      busy = false
      progress = 1
      message = `L${stats.level} · 扰动 ${stats.irregularity.toFixed(2)} 完整自然世界已就绪`
    }
    catch (cause) {
      if (id !== requestId)
        return
      busy = false
      progress = 0
      if (cause instanceof GenerationCancelledError || (cause instanceof Error && cause.name === 'AbortError')) {
        message = activeReader ? '生成已取消，保留当前已发布世界。' : '生成已取消。'
      }
      else {
        error = cause instanceof Error ? cause.message : '生成失败，请重试。'
        message = activeReader ? '生成失败，已保留上一个有效世界。' : '生成失败。'
      }
    }
  }

  function cancel(): void {
    if (!busy)
      return
    ++requestId
    prepareAbortController?.abort()
    prepareAbortController = null
    controller?.cancel('hard')
    busy = false
    progress = 0
    message = activeReader ? '生成已取消，保留当前已发布世界。Worker 缓存已清空。' : '生成已取消。Worker 缓存已清空。'
  }

  function chooseLevel(): void {
    rotate = false
    applySessionViewState()
  }

  function randomizeSeed(): void {
    const value = new Uint32Array(1)
    crypto.getRandomValues(value)
    seed = String((value[0] % 999999) + 1)
  }

  function randomizeAndGenerate(): void {
    randomizeSeed()
    void generate()
  }

  async function copyStatisticsText(): Promise<void> {
    if (!layerStatistics || typeof navigator === 'undefined' || !navigator.clipboard)
      return
    try {
      await navigator.clipboard.writeText(formatLayerStatistics(layerStatistics))
      copiedStats = true
      setTimeout(() => {
        copiedStats = false
      }, 1500)
    }
    catch {
    // ignore clipboard errors in restricted environments
    }
  }

  onMount(() => {
    try {
      session = createCartographySession({
        host: viewportElement,
        onPick: handleViewportPick,
        onContextLost: () => {
          error = 'WebGL 上下文已丢失，正在等待恢复…'
        },
        onContextRestored: () => {
          error = ''
          if (session) {
            gpuCounts = session.getActiveGpuResourceCounts()
          }
        },
      })
      session.viewport.startLoop()

      controller = new GenerationController((state) => {
        if (state.status === 'running' && busy) {
          progress = state.pipelineProgress
          message = `${getPipelineStageLabel(state.stageId ?? 'mesh')} ${Math.round(state.pipelineProgress * 100)}%`
        }
        if (state.status === 'completed' && state.postMessageMs !== undefined && stats) {
          stats = { ...stats, postMessageMs: state.postMessageMs }
        }
      })

      if (new URLSearchParams(window.location.search).get('autogenerate') !== '0') {
        requestAnimationFrame(() => void generate())
      }
    }
    catch (cause) {
      error = cause instanceof Error ? cause.message : '无法启动 WebGL，请检查浏览器支持。'
    }

    return () => {
      ++requestId
      prepareAbortController?.abort()
      controller?.dispose()
      session?.dispose()
    }
  })
</script>

<AppUI
  {seed}
  status={message}
  {busy}
  {progress}
  {error}
  hasSelection={Boolean(selectedInspection)}
  selectionLabel={selectedInspection ? `REGION #${selectedInspection.regionId}` : ''}
  {viewMode}
  {projectionId}
  onGenerate={() => generate()}
  onCancel={cancel}
  onRandomize={randomizeAndGenerate}
  onSelectViewMode={selectViewMode}
  onSelectProjection={selectProjection}
  onResetCamera={resetCamera}
>
  {#snippet viewport()}
    <div bind:this={viewportElement} class='absolute inset-0'></div>
    {#if !activeReader && !busy}
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
      <Slider label='细分等级' description='控制球面网格的细分程度；等级越高，区域数量以及内存和显存占用越大。' bind:value={level} min={4} max={8} step={1} decimals={0} formatValue={value => `L${value}`} onchange={chooseLevel} />
      <label class='flex flex-col gap-1 py-1 text-obs-text-main'>
        <span class='flex items-center gap-1.5 font-sans text-[11px] text-obs-text-muted'>
          随机种子
          <Tooltip content='决定生成随机序列；相同种子、参数和算法版本可复现相同结果。' delayDuration={100}>
            <span class='cursor-help text-obs-text-dim transition-colors hover:text-white'><CircleQuestionMark class='h-3 w-3' /></span>
          </Tooltip>
        </span>
        <input
          aria-label='随机种子'
          class='w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-2.5 py-1.5 font-mono text-xs text-obs-text-main outline-none transition-all focus:border-obs-primary/60 focus:ring-1 focus:ring-obs-primary/30'
          type='text'
          bind:value={seed}
          onkeydown={(event) => {
            if (event.key === 'Enter')
              generate()
          }}
        />
      </label>
    </div>
  {/snippet}

  {#snippet natureContent()}
    <div class='flex flex-col gap-4'>
      <section class='flex flex-col gap-2' aria-label='网格参数'>
        <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>球面网格</span><div class='flex-1 h-px bg-white/5'></div></div>
        <Slider label='网格规整度' description='控制球面采样点的位置扰动；数值越高，网格形状越不规则。' bind:value={irregularity} min={0} max={1} step={0.05} decimals={2} />
      </section>

      <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-3' aria-label='地质参数'>
        <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>构造与地质</span><div class='flex-1 h-px bg-white/5'></div></div>
        <Slider label='主板块数' description='主要运动板块的生成目标数；板块形状和可分区域会影响最终数量。' bind:value={geologyParameters.primaryPlateCount} min={2} max={100} step={1} decimals={0} />
        <Slider label='微板块目标数' description='在主要板块边界附近生成的微板块目标数；符合边界与连通条件的数量可能更少。' bind:value={geologyParameters.microPlateCount} min={0} max={100 - geologyParameters.primaryPlateCount} step={1} decimals={0} />
        <Slider label='板块面积差异' description='控制板块目标面积的差异程度；数值较高时，大板块和小板块的面积差距会增大。' bind:value={geologyParameters.plateSizeVariety} min={0} max={1} step={0.05} decimals={2} />
        <Slider label='候选大陆目标数' description='生成候选大陆区域的目标数量；受板块连通和面积约束，结果可能少于目标。' bind:value={geologyParameters.continentCount} min={1} max={100} step={1} decimals={0} />
        <Slider label='候选陆地目标比例' description='候选大陆所覆盖的球面面积比例。最终海岸线由高程和海平面共同决定，可能与候选范围不同。' bind:value={geologyParameters.candidateLandCoverage} min={0} max={1} step={0.05} decimals={2} formatValue={value => `${Math.round(value * 100)}%`} />
        <Slider label='候选大陆面积差异' description='控制不同候选大陆的目标面积差距；数值较高时，更容易形成大小悬殊的大陆。' bind:value={geologyParameters.continentSizeVariety} min={0} max={1} step={0.05} decimals={2} />
      </section>

      <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-3' aria-label='地形参数'>
        <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>地形与岛屿</span><div class='flex-1 h-px bg-white/5'></div></div>
        <Slider label='岛弧目标数' description='海洋俯冲带岛弧源点的数量上限；受合适的板块边界约束，不代表最终独立岛屿数。' bind:value={landformParameters.islandArcCount} min={0} max={100} step={1} decimals={0} />
        <Slider label='岛屿密度' description='调节岛弧地形片段和近岸小岛的生成倾向、影响范围与起伏；不直接指定最终岛屿数量。' bind:value={landformParameters.islandDensity} min={0} max={1} step={0.05} decimals={2} />
        <Slider label='热点目标数' description='地幔热点链的生成目标数；受可用热点位置和间距约束，最终数量可能更少。' bind:value={landformParameters.hotspotCount} min={0} max={100} step={1} decimals={0} />
        {#each terrainControls as parameter}
          <Slider label={parameter.label} description={parameter.description} bind:value={terrainParameters[parameter.key]} min={0} max={parameter.max} step={0.05} decimals={2} />
        {/each}
      </section>

      <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-3' aria-label='气候参数'>
        <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>气候与环境</span><div class='flex-1 h-px bg-white/5'></div></div>
        <Slider label='轴倾角（°）' description='控制行星自转轴相对公转平面的倾斜程度，影响季节温差和降水的季节分布。' bind:value={climateParameters.axialTiltDegrees} min={0} max={45} step={0.1} decimals={1} />
        <Slider label='公转周期（地球日）' description='控制一年的长度，决定气候季节循环的时间尺度。' bind:value={climateParameters.orbitalPeriodDays} min={300} max={430} step={0.25} decimals={2} />
        <Slider label='温度偏移（°C）' description='整体平移模型气温基线；正值使气候偏暖，负值使气候偏冷。' bind:value={climateParameters.temperatureOffsetC} min={-20} max={20} step={0.5} decimals={1} />
        <Slider label='降水倍率' description='按比例调整模型降水；数值越高，整体降水越多。' bind:value={climateParameters.precipitationScale} min={0} max={3} step={0.1} decimals={1} />
      </section>

      <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-3' aria-label='水文参数'>
        <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>冰雪与水文</span><div class='flex-1 h-px bg-white/5'></div></div>
        <Slider label='融雪系数（mm / °C / 月）' description='温度每高于融雪阈值 1°C 时，每月融化的雪水当量；属于简化温度指数模型。' bind:value={hydrologyParameters.degreeDayMeltFactorMmPerCMonth} min={0} max={100} step={0.5} decimals={1} />
        <Slider label='蒸散温度系数（mm / °C / 月）' description='温度升高时蒸散需求增加的幅度；属于温度指数近似，不是完整蒸散模型。' bind:value={hydrologyParameters.evapotranspirationFactorMmPerCMonth} min={0} max={100} step={0.5} decimals={1} />
        <div class='flex items-center gap-2 border-t border-white/[0.06] pt-2'><span class='font-sans text-[10px] uppercase tracking-wide text-obs-text-muted font-bold'>河流与湖泊</span><div class='flex-1 h-px bg-white/5'></div></div>
        <Slider label='河网密度倍率' description='倍率越低，汇水面积门槛越高、河道越少；默认 0.5，门槛为原默认值的两倍。受气候产流和地形汇流共同限制。' bind:value={hydrologyParameters.riverDensityMultiplier} min={0.25} max={2} step={0.05} decimals={2} />
        <Slider label='基准汇水面积' description='河道阈值取本值与 16 倍平均网格面积中的较大值，再由河网密度倍率缩放。面积采用对数刻度，范围 0–10,000,000 km²；基准越高通常河道越少。' bind:value={hydrologyParameters.minimumRiverDrainageAreaKm2} min={0} max={hydrologyAreaSliderMax} step={0.01} decimals={0} unit=' km²' toSlider={hydrologyAreaToSlider} fromSlider={hydrologyAreaFromSlider} formatValue={formatAreaKm2} />
        <Slider label='最小湖泊面积' description='只保留面积达到门槛的地形湖候选，不会扩大湖盆；0 表示沿用至少两个网格区域的筛选规则。面积采用对数刻度，范围 0–10,000,000 km²。' bind:value={hydrologyParameters.minimumLakeAreaKm2} min={0} max={hydrologyAreaSliderMax} step={0.01} decimals={0} unit=' km²' toSlider={hydrologyAreaToSlider} fromSlider={hydrologyAreaFromSlider} formatValue={formatAreaKm2} />
      </section>

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
      <div class='rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-obs-text-dim'>文明生成将在 M2 阶段接入。当前 M3 制图系统专注于完整自然世界快照的 3D 星球与 2D 地图集渲染。</div>
      <div class='flex flex-col gap-2 opacity-35' aria-disabled='true'>
        <div class='flex items-center justify-between py-1 text-[11px] text-obs-text-muted'><span>人口规模</span><span>待 M2 接入</span></div>
        <div class='h-1 rounded-full bg-white/[0.08]'></div>
        <div class='flex items-center justify-between py-1 text-[11px] text-obs-text-muted'><span>聚落密度</span><span>待 M2 接入</span></div>
        <div class='h-1 rounded-full bg-white/[0.08]'></div>
        <div class='flex items-center justify-between py-1 text-[11px] text-obs-text-muted'><span>道路连通度</span><span>待 M2 接入</span></div>
        <div class='h-1 rounded-full bg-white/[0.08]'></div>
      </div>
    </div>
  {/snippet}

  {#snippet layerContent()}
    <div class='flex flex-col gap-3'>
      <!-- 1. Base Map Style Presets -->
      <section class='flex flex-col gap-2' aria-label='地图风格'>
        <div class='flex items-center justify-between px-0.5'>
          <span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>1. 风格</span>
          <span class='text-[10px] text-obs-text-dim font-mono'>Style</span>
        </div>
        <div class='grid grid-cols-2 gap-1.5'>
          {#each STYLE_PRESET_CARDS as preset (preset.id)}
            <button
              type='button'
              aria-pressed={styleId === preset.id}
              onclick={() => selectStylePreset(preset.id)}
              class="flex flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer {styleId === preset.id ? 'border-obs-primary/50 bg-obs-primary/15 text-white' : 'border-white/[0.06] bg-white/[0.02] text-obs-text-muted hover:bg-white/[0.05]'}"
            >
              <div class='flex items-center gap-2'>
                <span class='h-3 w-3 shrink-0 rounded-full border border-white/20 shadow-sm' style:background={preset.swatch}></span>
                <span class='text-[11px] font-semibold leading-none'>{preset.label}</span>
              </div>
              <span class='text-[9px] leading-tight text-obs-text-dim'>{preset.subtitle}</span>
            </button>
          {/each}
        </div>
      </section>

      <!-- 2. Thematic Layers -->
      <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-2.5' aria-label='图层'>
        <div class='flex items-center justify-between px-0.5'>
          <span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>2. 图层</span>
          {#if activeThematicId !== null}
            <button
              type='button'
              onclick={() => selectThematic(null)}
              class='text-[10px] text-obs-primary hover:underline cursor-pointer'
            >
              返回仅底图
            </button>
          {:else}
            <span class='text-[10px] text-obs-text-dim font-mono'>Layers</span>
          {/if}
        </div>

        <label class='flex flex-col gap-1 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2 text-[11px] text-obs-text-muted'>
          <div class='flex items-center justify-between'>
            <span>气候与水文月份</span>
            <span class='font-mono text-[10px] text-obs-primary'>第 {climateMonth + 1} 月</span>
          </div>
          <input aria-label='月份' class='mt-1.5 w-full accent-obs-primary' type='range' min='0' max='11' step='1' bind:value={climateMonth} oninput={chooseClimateMonth} />
        </label>

        <div class='grid grid-cols-2 gap-1.5'>
          <button
            type='button'
            aria-pressed={surfaceEnabled}
            onclick={toggleSurfaceLayer}
            class="rounded-lg border px-2 py-1.5 text-left text-[10px] transition-colors cursor-pointer {surfaceEnabled ? 'border-obs-primary/45 bg-obs-primary/15 text-obs-primary font-medium' : 'border-white/[0.06] bg-white/[0.02] text-obs-text-muted hover:bg-white/[0.05]'}"
          >
            {SURFACE_LAYER_ITEM.label}
          </button>
        </div>

        <span class='px-0.5 text-[10px] font-medium text-obs-text-dim'>专题</span>
        {#each LAYER_GROUPS as group (group.label)}
          <div class='flex flex-col gap-1'>
            <span class='px-0.5 text-[10px] font-medium text-obs-text-dim'>{group.label}</span>
            <div class='grid grid-cols-2 gap-1.5'>
              {#each group.items as item (item.id)}
                <button
                  type='button'
                  aria-pressed={activeThematicId === item.id}
                  onclick={() => selectThematic(item.id)}
                  class="rounded-lg border px-2 py-1.5 text-left text-[10px] transition-colors cursor-pointer {activeThematicId === item.id ? 'border-obs-primary/45 bg-obs-primary/15 text-obs-primary font-medium' : 'border-white/[0.06] bg-white/[0.02] text-obs-text-muted hover:bg-white/[0.05]'}"
                >
                  {item.label}
                </button>
              {/each}
            </div>
          </div>
        {/each}

        {#if layerStatistics}
          <section class='mt-1 overflow-hidden rounded-xl border border-white/[0.07] bg-black/25' aria-label='图层图例与统计'>
            <div class='border-b border-white/[0.06] bg-white/[0.025] px-3 py-2'>
              <div class='flex items-center justify-between gap-2'>
                <span class='text-[11px] font-semibold text-obs-text-main'>图例统计 · {layerStatistics.title}</span>
                <div class='flex items-center gap-2'>
                  <span class='shrink-0 font-mono text-[9px] text-obs-text-dim'>{layerStatistics.totalCells.toLocaleString()} 区域</span>
                  <button
                    type='button'
                    onclick={copyStatisticsText}
                    class='rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] text-obs-text-muted hover:bg-white/10 hover:text-white cursor-pointer'
                  >
                    {copiedStats ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
              {#if layerStatistics.description}
                <p class='mt-1 text-[10px] leading-relaxed text-obs-text-dim'>{layerStatistics.description}</p>
              {/if}
              {#if layerStatistics.gradientStops && layerStatistics.gradientStops.length >= 2}
                <div class='mt-2 flex flex-col gap-1'>
                  <div
                    class='h-2 w-full rounded-full border border-white/10'
                    style:background={`linear-gradient(90deg, ${layerStatistics.gradientStops.map(s => s.color).join(', ')})`}
                  ></div>
                  <div class='flex justify-between font-mono text-[9px] text-obs-text-dim'>
                    <span>{layerStatistics.gradientStops[0].value}{layerStatistics.unit ? ` ${layerStatistics.unit}` : ''}</span>
                    <span>{layerStatistics.gradientStops.at(-1)?.value}{layerStatistics.unit ? ` ${layerStatistics.unit}` : ''}</span>
                  </div>
                </div>
              {/if}
            </div>
            <div class='flex flex-col gap-0.5 p-1.5 max-h-60 overflow-y-auto custom-scrollbar'>
              {#each layerStatistics.rows as row (row.key)}
                <div class='rounded-lg px-2 py-1.5 hover:bg-white/[0.04]'>
                  <div class='flex items-center gap-2 text-[10px]'>
                    <span class='h-2 w-2 shrink-0 rounded-full shadow-sm' style:background-color={row.color}></span>
                    <span class='min-w-0 flex-1 break-words leading-tight text-obs-text-main'>{row.label}</span>
                    <span class='font-mono tabular-nums text-obs-text-muted'>{row.count.toLocaleString()}</span>
                    <span class='w-12 text-right font-mono tabular-nums text-obs-primary'>{formatLayerPercentage(row.percentage)}</span>
                  </div>
                  <div class='ml-4 mt-0.5 text-[9px] text-obs-text-dim'>
                    面积 {row.areaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²
                  </div>
                  <div class='ml-4 mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]'>
                    <div class='h-full rounded-full' style:background-color={row.color} style:width={`${row.count > 0 ? Math.max(row.percentage, 0.3) : 0}%`}></div>
                  </div>
                </div>
              {/each}
            </div>
          </section>
        {/if}

        <div class='mt-1 flex flex-col gap-1.5 border-t border-white/[0.06] pt-2' aria-label='覆盖与注记'>
          <span class='px-0.5 text-[10px] font-medium text-obs-text-dim'>覆盖与注记</span>
          {#each OVERLAY_ITEMS as item (item.id)}
            <Checkbox
              label={item.label}
              description={item.description}
              checked={enabledOverlayIds.includes(item.id)}
              disabled={item.requiresCapability && activeReader ? !activeReader.capabilities[item.requiresCapability] : false}
              onchange={value => setOverlayEnabled(item.id, value)}
            />
          {/each}
        </div>
      </section>

      <section class='flex flex-col gap-1.5 border-t border-white/[0.06] pt-2.5' aria-label='辅助显示'>
        <div class='flex items-center justify-between px-0.5'>
          <span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>3. 辅助显示</span>
          <span class='text-[10px] text-obs-text-dim font-mono'>View</span>
        </div>
        <Toggle label='经纬网格' checked={graticuleEnabled} oncommit={(value) => { graticuleEnabled = value; applySessionViewState() }} />
        <Toggle label='Cell 边界网格' checked={cellWireframeEnabled} oncommit={(value) => { cellWireframeEnabled = value; applySessionViewState() }} />
        <Toggle label='自转' description='仅 3D 星球' checked={rotate} disabled={viewMode !== 'globe'} oncommit={(value) => { rotate = value; applySessionViewState() }} />
        <Toggle label='大气光晕' description='仅 3D 星球' checked={showAtmosphere} disabled={viewMode !== 'globe'} oncommit={(value) => { showAtmosphere = value; applySessionViewState() }} />
        <Toggle label='昼夜光照' description='仅 3D 星球' checked={showDayNight} disabled={viewMode !== 'globe'} oncommit={(value) => { showDayNight = value; applySessionViewState() }} />
      </section>
    </div>
  {/snippet}

  {#snippet overviewContent()}
    <div class='flex flex-col gap-3'>
      {#if !worldSummary && stages.length === 0 && !stats}
        <p class='rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-obs-text-dim'>生成完成后，这里显示行星自然概览、生成管线和网格性能。</p>
      {/if}
      {#if worldSummary}
        <section class='flex flex-col gap-2 text-[10px] text-obs-text-dim' aria-label='行星自然统计'>
          <div class='flex items-center justify-between'><span class='font-bold tracking-wider uppercase text-obs-primary/90'>行星自然概览</span><span class='font-mono'>World Summary</span></div>
          <dl class='grid grid-cols-2 gap-y-1.5'>
            <dt>构造板块数</dt><dd>{worldSummary.plateCount}</dd>
            <dt>陆地面积占比</dt><dd>{worldSummary.landCoveragePercent.toFixed(1)}%</dd>
            <dt>高程范围 (km)</dt><dd>{worldSummary.minElevationKm.toFixed(2)} / {worldSummary.maxElevationKm.toFixed(2)}</dd>
            <dt>大陆 / 洋 / 海</dt><dd>{worldSummary.continentCount} / {worldSummary.oceanCount} / {worldSummary.seaCount}</dd>
            <dt>水文流域数</dt><dd>{worldSummary.basinCount.toLocaleString()}</dd>
            <dt>河道段数</dt><dd>{worldSummary.riverCount.toLocaleString()}</dd>
            <dt>河网覆盖陆地</dt><dd>{worldSummary.riverCoveragePercent.toFixed(2)}%</dd>
            <dt>静态湖泊数</dt><dd>{worldSummary.lakeCount.toLocaleString()}</dd>
            <dt>湖泊总面积</dt><dd>{worldSummary.totalLakeAreaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</dd>
            <dt>湖泊中位面积</dt><dd>{worldSummary.medianLakeAreaKm2 === null ? '—' : `${worldSummary.medianLakeAreaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²`}</dd>
          </dl>
        </section>
      {/if}

      {#if stages.length}
        <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-2.5 text-[10px]' aria-label='阶段缓存'>
          <div class='flex items-center justify-between'><span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>生成管线</span><span class='text-obs-text-dim font-mono'>Stage Cache</span></div>
          <ul class='space-y-1 font-mono text-obs-text-dim'>
            {#each stages as stage (stage.stageId)}
              <li class='flex justify-between gap-2'>
                <span class='truncate'>{stage.stageId}:</span>
                <span class={stage.action === 'cache-hit' ? 'text-obs-primary' : 'text-obs-text-muted'}>&nbsp;{stage.action === 'cache-hit' ? 'Cache Hit' : 'Rebuilt'}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if stats}
        <section class='flex flex-col gap-2 border-t border-white/[0.06] pt-2.5 text-[10px]' aria-label='网格与性能统计'>
          <div class='flex items-center justify-between'><span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>网格与制图性能</span><span class='text-obs-text-dim font-mono'>Stats</span></div>
          <dl class='grid grid-cols-2 gap-y-1.5'>
            <dt>细分等级 / 种子</dt><dd class='break-all'>L{stats.level} / {stats.seed}</dd>
            <dt>Regions (Cells)</dt><dd>{stats.regions.toLocaleString()}</dd>
            <dt>Corners / Edges</dt><dd>{stats.corners.toLocaleString()} / {stats.edges.toLocaleString()}</dd>
            <dt>Pipeline</dt><dd>{stats.cacheHit ? 'Cache Hit' : 'Rebuilt'} ({stats.generationMs.toFixed(1)} ms)</dd>
            <dt>制图资源预备</dt><dd>{stats.preparationMs.toFixed(1)} ms</dd>
            <dt>主线程快照校验</dt><dd>{stats.hydrateMs.toFixed(1)} ms</dd>
            <dt>GPU 几何/材质/纹理</dt><dd>{gpuCounts.geometries} / {gpuCounts.materials} / {gpuCounts.textures}</dd>
          </dl>
        </section>
      {/if}
    </div>
  {/snippet}

  {#snippet inspectorContent()}
    <section class='flex flex-col gap-3 text-xs' aria-label='选中区域'>
      {#if selectedInspection}
        {@const info = selectedInspection}
        <div class='flex flex-col gap-2.5 text-xs'>
          <div class='flex flex-col gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5'>
            <p class='font-mono text-obs-primary font-semibold'>
              Region #{info.regionId} · {info.neighbors.length} 个相邻单元
            </p>
            <p class='font-mono text-[10px] text-obs-text-muted'>
              坐标 {info.coordinates.latitudeDegrees >= 0 ? `${info.coordinates.latitudeDegrees.toFixed(2)}°N` : `${Math.abs(info.coordinates.latitudeDegrees).toFixed(2)}°S`},
              {info.coordinates.longitudeDegrees >= 0 ? `${info.coordinates.longitudeDegrees.toFixed(2)}°E` : `${Math.abs(info.coordinates.longitudeDegrees).toFixed(2)}°W`}
              · 面积 {info.regionFacts.areaKm2.toLocaleString(undefined, { maximumFractionDigits: 1 })} km²
            </p>
            {#if info.featureHit}
              <p class='mt-0.5 rounded bg-obs-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-obs-primary'>
                命中要素：{info.featureHit.featureId} ({info.featureHit.sourceId})
              </p>
            {/if}
          </div>

          <dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-1.5 border-t border-white/[0.06] pt-2' aria-label='地质与地形'>
            <dt class='text-obs-text-dim'>海陆与高程</dt>
            <dd>{info.regionFacts.land ? '陆地' : '海域'} · {info.regionFacts.elevationKm.toFixed(3)} km</dd>
            <dt class='text-obs-text-dim'>地形坡度</dt>
            <dd>{info.slopeDeg.toFixed(2)}°</dd>
            <dt class='text-obs-text-dim'>大陆 / 洋 / 海归属</dt>
            <dd>{info.continentLabel}</dd>
            <dt class='text-obs-text-dim'>构造板块 / 地壳</dt>
            <dd class='font-mono'>{info.regionFacts.plateId} · {info.regionFacts.crustType === 1 ? '大陆地壳' : '大洋地壳'}</dd>
          </dl>

          <dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-1.5 border-t border-white/[0.06] pt-2' aria-label='区域气候'>
            <dt class='text-obs-text-dim'>第 {info.regionFacts.month + 1} 月气温 / 降水</dt>
            <dd>{info.regionFacts.temperatureC.toFixed(1)} °C / {info.regionFacts.precipitationMm.toFixed(1)} mm</dd>
            <dt class='text-obs-text-dim'>年均温 / 年总降水</dt>
            <dd>{info.regionFacts.annualMeanTemperatureC.toFixed(1)} °C / {info.regionFacts.annualPrecipitationMm.toFixed(0)} mm/年</dd>
            <dt class='text-obs-text-dim'>Köppen 气候带</dt>
            <dd>{info.koppenLabel}</dd>
            <dt class='text-obs-text-dim'>10m 月均风速</dt>
            <dd>{info.windText}</dd>
            <dt class='text-obs-text-dim'>表层洋流 / 暖度</dt>
            <dd>{info.oceanText}{info.oceanWarmthText !== '无数据' ? ` (暖度 ${info.oceanWarmthText})` : ''}</dd>
          </dl>

          <dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-1.5 border-t border-white/[0.06] pt-2' aria-label='区域生态'>
            <dt class='text-obs-text-dim'>潜在生物群系</dt>
            <dd>{info.biomeLabel}</dd>
            <dt class='text-obs-text-dim'>自然地表覆盖</dt>
            <dd>{info.landCoverLabel}</dd>
            <dt class='text-obs-text-dim'>干旱指数 / 生长季</dt>
            <dd>{info.regionFacts.aridityIndex.toFixed(3)} / {info.regionFacts.growingSeasonMonths} 个月</dd>
          </dl>

          <dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-1.5 border-t border-white/[0.06] pt-2' aria-label='区域水文'>
            <dt class='text-obs-text-dim'>月末积雪水当量</dt>
            <dd>{info.regionFacts.snowWaterEquivalentMm.toFixed(1)} mm</dd>
            <dt class='text-obs-text-dim'>年径流深</dt>
            <dd>{info.regionFacts.annualRunoffMm.toFixed(1)} mm/年</dd>
            <dt class='text-obs-text-dim'>汇流量 / 汇水面积</dt>
            <dd>{info.accumulatedFlowM3s.toFixed(2)} m³/s · {info.contributingAreaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</dd>
            <dt class='text-obs-text-dim'>下游流向</dt>
            <dd>{info.regionFacts.downstreamRegion < 0 ? (info.basin?.endorheic ? '内流汇点' : '海洋出口') : `Region #${info.regionFacts.downstreamRegion}`}</dd>
            <dt class='text-obs-text-dim'>所属流域</dt>
            <dd class='font-mono'>{info.regionFacts.basinId ?? '海洋'}</dd>
            {#if info.river}
              <dt class='text-obs-text-dim'>河道段详情</dt>
              <dd>{info.river.id} · {info.river.strahlerOrder} 级 · 年均流量 {info.river.annualMeanDischargeM3s.toFixed(1)} m³/s</dd>
            {/if}
            {#if info.lake}
              <dt class='text-obs-text-dim'>静态湖泊详情</dt>
              <dd>{info.lake.id} · {info.lake.endorheic ? '内流湖' : '外流湖'} · 面积 {info.lake.areaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</dd>
            {/if}
          </dl>
        </div>
      {:else}
        <p class='text-obs-text-dim'>点击 3D 星球或 2D 地图上的任意区域或河湖要素，查看权威世界快照读数。</p>
      {/if}
    </section>
  {/snippet}
</AppUI>
