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
  import type { ComponentProps } from 'svelte'
  import type GenerationLoading from '@/ui/hud/GenerationLoading.svelte'
  import type OverviewPanel from '@/ui/hud/OverviewPanel.svelte'
  import type RegionInspector from '@/ui/hud/RegionInspector.svelte'
  import type { ShareParameters } from '@/ui/hud/share-link'
  import {
    createCartographySession,
    DEFAULT_CARTOGRAPHY_VIEW_STATE,
    formatContinentDisplayName,
    formatOceanDisplayName,
  } from '@another-earth/cartography'
  import {
    DEFAULT_CLIMATE_PARAMETERS,
    DEFAULT_GEOLOGY_PARAMETERS,
    DEFAULT_HYDROLOGY_PARAMETERS,
    DEFAULT_LANDFORM_PARAMETERS,
    DEFAULT_TERRAIN_PARAMETERS,
  } from '@another-earth/world-core'
  import { onMount } from 'svelte'
  import AppUI from '@/ui/AppUI.svelte'
  import { climatePeriodForThematic } from '@/ui/hud/layer-presentation'
  import { applyShareHash, createShareUrl } from '@/ui/hud/share-link'
  import { appState, setExclusivePanel } from '@/ui/state/app.svelte'
  import { GenerationCancelledError, GenerationController } from '../lib/generation/controller'
  import { buildLayerStatisticsFromReader, formatLayerStatistics } from './layer-statistics'

  type WorldPerformanceStats = NonNullable<ComponentProps<typeof OverviewPanel>['stats']>
  type RegionInspectionData = ComponentProps<typeof RegionInspector>['inspection']
  type GenerationLoadingState = ComponentProps<typeof GenerationLoading>['state']

  let viewportElement: HTMLDivElement
  let level = $state(7)
  let irregularity = $state(0.75)
  let seed = $state('1024')
  let shareUrl = $state('')

  let geologyParameters = $state({ ...DEFAULT_GEOLOGY_PARAMETERS })
  let terrainParameters = $state({ ...DEFAULT_TERRAIN_PARAMETERS })
  let landformParameters = $state({ ...DEFAULT_LANDFORM_PARAMETERS })
  let climateParameters = $state({ ...DEFAULT_CLIMATE_PARAMETERS, axialTiltDegrees: 23.5, precipitationScale: 1.8 })
  let hydrologyParameters = $state({ ...DEFAULT_HYDROLOGY_PARAMETERS })

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
  let showPolarIce = $state(true)
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
  let generationLoadingState = $state<GenerationLoadingState>({ status: 'idle' })
  let error = $state('')
  let copiedStats = $state(false)

  let controller: GenerationController | undefined
  let session: CartographySession | undefined
  let zoomAnimationFrame: number | null = null
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
        polarIce: showPolarIce,
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

  function setClimatePeriodMonthly(monthly: boolean): void {
    const period = climatePeriodForThematic(activeThematicId)
    if (!period)
      return
    activeThematicId = monthly ? period.monthlyId : period.annualId
    applySessionViewState()
  }

  function chooseClimateMonth(): void {
    applySessionViewState()
  }

  function resetCamera(): void {
    if (zoomAnimationFrame !== null) {
      cancelAnimationFrame(zoomAnimationFrame)
      zoomAnimationFrame = null
    }
    session?.resetCamera()
  }

  function zoomMap(delta: number): void {
    const viewport = session?.viewport
    const pose = viewport?.getCenterCoordinates()
    if (!viewport || !pose)
      return
    if (zoomAnimationFrame !== null)
      cancelAnimationFrame(zoomAnimationFrame)

    const startZoom = pose.styleZoom
    const targetZoom = Math.max(0, Math.min(12, startZoom + delta))
    const startedAt = performance.now()
    const durationMs = 180
    const animate = (now: number) => {
      const currentViewport = session?.viewport
      if (!currentViewport)
        return
      const progress = Math.min(1, (now - startedAt) / durationMs)
      const eased = 1 - (1 - progress) ** 3
      currentViewport.setCenterCoordinates(
        pose.longitudeDegrees,
        pose.latitudeDegrees,
        startZoom + (targetZoom - startZoom) * eased,
      )
      currentViewport.renderFrame()
      if (progress < 1)
        zoomAnimationFrame = requestAnimationFrame(animate)
      else
        zoomAnimationFrame = null
    }
    zoomAnimationFrame = requestAnimationFrame(animate)
  }

  function currentShareParameters(): ShareParameters {
    return {
      seed,
      level,
      irregularity,
      primaryPlateCount: geologyParameters.primaryPlateCount,
      microPlateCount: geologyParameters.microPlateCount,
      plateSizeVariety: geologyParameters.plateSizeVariety,
      continentCount: geologyParameters.continentCount,
      continentSizeVariety: geologyParameters.continentSizeVariety,
      candidateLandCoverage: geologyParameters.candidateLandCoverage,
      islandArcCount: landformParameters.islandArcCount,
      islandDensity: landformParameters.islandDensity,
      hotspotCount: landformParameters.hotspotCount,
      roughness: terrainParameters.roughness,
      terrainWarp: terrainParameters.terrainWarp,
      smoothing: terrainParameters.smoothing,
      glacialErosion: terrainParameters.glacialErosion,
      hydraulicErosion: terrainParameters.hydraulicErosion,
      ridgeSharpening: terrainParameters.ridgeSharpening,
      axialTiltDegrees: climateParameters.axialTiltDegrees,
      orbitalPeriodDays: climateParameters.orbitalPeriodDays,
      temperatureOffsetC: climateParameters.temperatureOffsetC,
      precipitationScale: climateParameters.precipitationScale,
      degreeDayMeltFactorMmPerCMonth: hydrologyParameters.degreeDayMeltFactorMmPerCMonth,
      evapotranspirationFactorMmPerCMonth: hydrologyParameters.evapotranspirationFactorMmPerCMonth,
      riverDensityMultiplier: hydrologyParameters.riverDensityMultiplier,
      minimumRiverDrainageAreaKm2: hydrologyParameters.minimumRiverDrainageAreaKm2,
      minimumLakeAreaKm2: hydrologyParameters.minimumLakeAreaKm2,
    }
  }

  function applyShareParameters(parameters: ShareParameters): void {
    seed = String(parameters.seed)
    level = Number(parameters.level)
    irregularity = Number(parameters.irregularity)
    geologyParameters.primaryPlateCount = Number(parameters.primaryPlateCount)
    geologyParameters.microPlateCount = Number(parameters.microPlateCount)
    geologyParameters.plateSizeVariety = Number(parameters.plateSizeVariety)
    geologyParameters.continentCount = Number(parameters.continentCount)
    geologyParameters.continentSizeVariety = Number(parameters.continentSizeVariety)
    geologyParameters.candidateLandCoverage = Number(parameters.candidateLandCoverage)
    landformParameters.islandArcCount = Number(parameters.islandArcCount)
    landformParameters.islandDensity = Number(parameters.islandDensity)
    landformParameters.hotspotCount = Number(parameters.hotspotCount)
    terrainParameters.roughness = Number(parameters.roughness)
    terrainParameters.terrainWarp = Number(parameters.terrainWarp)
    terrainParameters.smoothing = Number(parameters.smoothing)
    terrainParameters.glacialErosion = Number(parameters.glacialErosion)
    terrainParameters.hydraulicErosion = Number(parameters.hydraulicErosion)
    terrainParameters.ridgeSharpening = Number(parameters.ridgeSharpening)
    climateParameters.axialTiltDegrees = Number(parameters.axialTiltDegrees)
    climateParameters.orbitalPeriodDays = Number(parameters.orbitalPeriodDays)
    climateParameters.temperatureOffsetC = Number(parameters.temperatureOffsetC)
    climateParameters.precipitationScale = Number(parameters.precipitationScale)
    hydrologyParameters.degreeDayMeltFactorMmPerCMonth = Number(parameters.degreeDayMeltFactorMmPerCMonth)
    hydrologyParameters.evapotranspirationFactorMmPerCMonth = Number(parameters.evapotranspirationFactorMmPerCMonth)
    hydrologyParameters.riverDensityMultiplier = Number(parameters.riverDensityMultiplier)
    hydrologyParameters.minimumRiverDrainageAreaKm2 = Number(parameters.minimumRiverDrainageAreaKm2)
    hydrologyParameters.minimumLakeAreaKm2 = Number(parameters.minimumLakeAreaKm2)
  }

  function publishGeneratedShareUrl(parameters: ShareParameters, generationId: number): void {
    void createShareUrl(parameters).then((url) => {
      if (generationId !== requestId)
        return
      shareUrl = url
      window.history.replaceState(window.history.state, '', url)
    })
  }

  function exportSceneImage(): void {
    const canvas = session?.viewport.canvas
    if (!canvas)
      return
    const link = document.createElement('a')
    link.href = canvas.toDataURL('image/png')
    link.download = `another-earth-${seed || 'scene'}.png`
    link.click()
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

  const selectedInspection = $derived.by<RegionInspectionData>(() => {
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

      let wind: { east: number, north: number } | null = null
      let ocean: { east: number, north: number, warmth: number } | null = null
      if (activeReader.capabilities.hasCirculation) {
        wind = {
          east: activeReader.monthlyField('windEastMps', climateMonth).get(regionId),
          north: activeReader.monthlyField('windNorthMps', climateMonth).get(regionId),
        }

        const oceanAvail = activeReader.field('oceanAvailable').get(regionId) !== 0 && !regionFacts.land
        if (oceanAvail) {
          ocean = {
            east: activeReader.monthlyField('oceanEastMps', climateMonth).get(regionId),
            north: activeReader.monthlyField('oceanNorthMps', climateMonth).get(regionId),
            warmth: activeReader.monthlyField('oceanWarmth', climateMonth).get(regionId),
          }
        }
      }

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
        wind,
        ocean,
        contributingAreaKm2,
        accumulatedFlowM3s,
      }
    }
    catch {
      return null
    }
  })

  function handleViewportPick(result: MapPickResult): void {
    if (!appState.inspectorOpen || busy || !activeReader || result.snapshotId !== activeReader.identity.snapshotId)
      return
    lastPickResult = result
    selection = {
      regionId: result.regionId,
      featureId: result.featureHit?.featureId ?? null,
    }
    setExclusivePanel('inspector')
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
    const generatedParameters = currentShareParameters()
    busy = true
    generationLoadingState = { status: 'starting', level, irregularity }
    error = ''

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

      publishGeneratedShareUrl(generatedParameters, id)
      busy = false
      generationLoadingState = { status: 'completed', level: stats.level, irregularity: stats.irregularity }
    }
    catch (cause) {
      if (id !== requestId)
        return
      busy = false
      if (cause instanceof GenerationCancelledError || (cause instanceof Error && cause.name === 'AbortError')) {
        generationLoadingState = { status: 'cancelled', hasPublishedWorld: activeReader !== null, cacheCleared: false }
      }
      else {
        error = cause instanceof Error ? cause.message : '生成失败，请重试。'
        generationLoadingState = { status: 'failed', hasPublishedWorld: activeReader !== null }
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
    generationLoadingState = { status: 'cancelled', hasPublishedWorld: activeReader !== null, cacheCleared: true }
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
    let disposed = false
    void (async () => {
      const restored = await applyShareHash(window.location.hash)
      if (disposed)
        return
      if (restored)
        applyShareParameters(restored)
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
            generationLoadingState = {
              status: 'pipeline',
              stageId: state.stageId,
              progress: state.pipelineProgress,
            }
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
    })()

    return () => {
      disposed = true
      ++requestId
      prepareAbortController?.abort()
      if (zoomAnimationFrame !== null)
        cancelAnimationFrame(zoomAnimationFrame)
      controller?.dispose()
      session?.dispose()
    }
  })
</script>

<AppUI
  {busy}
  {generationLoadingState}
  bind:level
  bind:seed
  bind:irregularity
  bind:geologyParameters
  bind:terrainParameters
  bind:landformParameters
  bind:climateParameters
  bind:hydrologyParameters
  bind:styleId
  bind:activeThematicId
  bind:surfaceEnabled
  bind:enabledOverlayIds
  bind:graticuleEnabled
  bind:cellWireframeEnabled
  bind:rotate
  bind:showAtmosphere
  bind:showDayNight
  bind:showPolarIce
  {error}
  inspection={selectedInspection}
  {viewMode}
  {projectionId}
  onGenerate={() => generate()}
  onForceRegenerate={() => {
    void generate(true)
  }}
  onChooseLevel={chooseLevel}
  hasGenerated={stats !== null}
  onViewStateChange={applySessionViewState}
  hasCirculation={activeReader?.capabilities.hasCirculation}
  hasGeographicNames={activeReader?.capabilities.hasGeographicNames}
  onCancel={cancel}
  onRandomize={randomizeAndGenerate}
  onSelectViewMode={selectViewMode}
  onSelectProjection={selectProjection}
  onZoom={zoomMap}
  onResetCamera={resetCamera}
  onExportScene={exportSceneImage}
  {shareUrl}
  {layerStatistics}
  {climateMonth}
  {copiedStats}
  onClimateMonthChange={(month) => {
    climateMonth = month
    chooseClimateMonth()
  }}
  onClimatePeriodChange={setClimatePeriodMonthly}
  onCopyStatistics={copyStatisticsText}
  overviewData={{
    worldSummary,
    stages,
    stats,
    gpuCounts,
  }}
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

</AppUI>
