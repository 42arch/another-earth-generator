<script lang='ts'>
  import type { ClimateArtifact, CryosphereArtifact, GeologyArtifact, HydrologyArtifact, SphericalMesh, StagePlan, TerrainArtifact } from '@another-earth/world-core'
  import type { GeologyTheme } from './geology-debug-data'
  import type { DebugMode, DebugSelection, DebugStats } from './mesh-debug-data'
  import { DEFAULT_CLIMATE_PARAMETERS, DEFAULT_GEOLOGY_PARAMETERS, DEFAULT_HYDROLOGY_PARAMETERS, DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS, KOPPEN_CODES, queryClimateRegion, queryGeologyRegion, queryHydrologyRegion, queryTerrainRegion } from '@another-earth/world-core'
  import { onMount } from 'svelte'
  import { GenerationCancelledError, GenerationController } from '../lib/generation/controller'
  import { geologyRegionColor, SLOPE_LEGEND_TICKS, slopeDisplayPosition, slopeLegendGradient } from './geology-debug-data'
  import { prepareDebugGeometry, prepareDebugSelection } from './mesh-debug-data'
  import { createDebugScene } from './mesh-debug-scene'

  const terrainControls = [
    { key: 'roughness', label: '地形粗糙度', max: 0.5 },
    { key: 'terrainWarp', label: '地形扭曲', max: 1 },
    { key: 'smoothing', label: '地形平滑', max: 1 },
    { key: 'hydraulicErosion', label: '水力侵蚀（整体减半）', max: 1 },
    { key: 'glacialErosion', label: '冰川侵蚀', max: 1 },
    { key: 'ridgeSharpening', label: '山脊锐化', max: 1 },
  ] as const

  let viewport: HTMLDivElement
  let level = $state(4)
  let irregularity = $state(0)
  let seed = $state('42')
  let mode = $state<DebugMode>('voronoi')
  let generationKind = $state<'mesh' | 'geology' | 'terrain' | 'climate' | 'hydrology'>('mesh')
  const geologyParameters = $state({ ...DEFAULT_GEOLOGY_PARAMETERS })
  const terrainParameters = $state({ ...DEFAULT_TERRAIN_PARAMETERS })
  const landformParameters = $state({ ...DEFAULT_LANDFORM_PARAMETERS })
  const climateParameters = $state({ ...DEFAULT_CLIMATE_PARAMETERS })
  const hydrologyParameters = $state({ ...DEFAULT_HYDROLOGY_PARAMETERS })
  let climateMonth = $state(0)
  let loadedClimate = $state.raw<ClimateArtifact | null>(null)
  let loadedCryosphere = $state.raw<CryosphereArtifact | null>(null)
  let loadedHydrology = $state.raw<HydrologyArtifact | null>(null)
  let selectedClimate = $state<ReturnType<typeof queryClimateRegion> | null>(null)
  let selectedHydrology = $state<ReturnType<typeof queryHydrologyRegion> | null>(null)
  let seaLevelDatumKm = $state(0)
  let loadedTerrain = $state.raw<TerrainArtifact | null>(null)
  let selectedTerrain = $state<ReturnType<typeof queryTerrainRegion> | null>(null)
  let geologyTheme = $state<GeologyTheme>('plates')
  let loadedGeology = $state.raw<GeologyArtifact | null>(null)
  let selectedGeology = $state<ReturnType<typeof queryGeologyRegion> | null>(null)
  let stages = $state<readonly StagePlan[]>([])
  let wireframe = $state(true)
  let showSurface = $state(true)
  let showFiveNeighborPoints = $state(false)
  let rotate = $state(false)
  let busy = $state(false)
  let message = $state('设置参数后点击 Generate。')
  let error = $state('')
  let stats = $state<DebugStats | null>(null)
  let selected = $state<DebugSelection | null>(null)
  let gpuGeometries = $state(0)
  let picking = $state(false)
  let controller: GenerationController | undefined
  let loadedMesh: SphericalMesh | undefined
  let pickReady = false
  let requestId = 0
  let pickId = 0
  let scene: ReturnType<typeof createDebugScene> | undefined

  function options() {
    scene?.setOptions(wireframe, showSurface, rotate, showFiveNeighborPoints)
  }
  async function generate(force = false) {
    if (!scene || !controller)
      return
    if (!seed.trim()) {
      error = 'Seed 不能为空。'
      return
    }
    const id = ++requestId
    ++pickId
    busy = true
    picking = false
    pickReady = false
    error = ''
    message = `正在生成 L${level} · 扰动 ${irregularity.toFixed(2)}…`
    try {
      const result = await controller.generate({ seed, config: { planet: { physicalRadiusKm: 6371, seaLevelDatumKm }, mesh: { subdivisionLevel: level, irregularity }, ...(generationKind !== 'mesh' ? { geology: { ...geologyParameters } } : {}), ...(['terrain', 'climate', 'hydrology'].includes(generationKind) ? { terrain: { ...terrainParameters }, landforms: { ...landformParameters } } : {}), ...(['climate', 'hydrology'].includes(generationKind) ? { climate: { ...climateParameters } } : {}), ...(generationKind === 'hydrology' ? { hydrology: { ...hydrologyParameters } } : {}) }, force })
      if (id !== requestId)
        return
      const preparing = performance.now()
      if (!result.terrain && ['elevation', 'land', 'boundaries', 'mantle', 'volcanism', 'uplift', 'relief', 'plains', 'slope'].includes(geologyTheme))
        geologyTheme = 'plates'
      if (!result.climate && !result.hydrology && ['temperature', 'precipitation', 'wind', 'ocean-current', 'snow', 'runoff', 'rivers', 'basins'].includes(geologyTheme))
        geologyTheme = 'plates'
      if (result.terrain && !loadedTerrain)
        geologyTheme = 'elevation'
      if (result.climate && !loadedClimate)
        geologyTheme = 'temperature'
      if (result.hydrology && !loadedHydrology)
        geologyTheme = 'rivers'
      const geometry = prepareDebugGeometry(result.mesh, mode, geologyRegionColor(result.geology, geologyTheme, result.terrain, result.climate, climateMonth, result.cryosphere, result.hydrology))
      const preparationMs = performance.now() - preparing
      scene.install(geometry, result.mesh.subdivisionLevel, wireframe, showSurface)
      options()
      loadedMesh = result.mesh
      loadedGeology = result.geology ?? null
      loadedTerrain = result.terrain ?? null
      loadedClimate = result.climate ?? null
      loadedCryosphere = result.cryosphere ?? null
      loadedHydrology = result.hydrology ?? null
      stages = result.stages ?? []
      selected = null
      selectedGeology = null
      selectedTerrain = null
      selectedClimate = null
      selectedHydrology = null
      stats = { level: result.mesh.subdivisionLevel, irregularity: result.mesh.irregularity, seed: result.mesh.seed, fiveNeighborRegions: geometry.fiveNeighborCenters.length / 3, regions: result.mesh.regionCount, edges: result.mesh.edgeRegions.length / 2, faces: result.mesh.triangles.length / 3, generationMs: result.pipelineMs, cacheHit: result.cacheHit, cacheBytes: result.cacheBytes, preparationMs, renderBytes: Object.values(geometry).reduce((sum, array) => sum + array.byteLength, 0), copyMs: result.copyMs, meshBytes: result.meshBytes, receiveMs: result.receiveMs, workerInitMs: controller.workerInitMs, hydrateMs: result.hydrateMs, postMessageMs: 0 }
      busy = false
      pickReady = true
      message = `L${stats.level} · 扰动 ${stats.irregularity.toFixed(2)} ${loadedHydrology ? '初步水文 H0 / 冰雪 I0' : loadedClimate ? '初步气候 C0' : loadedTerrain ? '基础地形 T0' : loadedGeology ? '板块与地壳' : '网格'}已就绪`
    }
    catch (cause) {
      if (id !== requestId)
        return
      busy = false
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
    pickReady = false
    message = loadedMesh ? '生成已取消。旧网格仅供查看；重新生成后可选择区域。Worker 缓存已清空。' : '生成已取消。Worker 缓存已清空。'
  }
  function chooseLevel() {
    wireframe = level < 6
    rotate = false
    options()
  }
  function chooseMode() {
    if (!loadedMesh || !scene || !stats || busy)
      return
    ++pickId
    picking = false
    const preparing = performance.now()
    const geometry = prepareDebugGeometry(loadedMesh, mode, geologyRegionColor(loadedGeology, geologyTheme, loadedTerrain, loadedClimate, climateMonth, loadedCryosphere, loadedHydrology))
    scene.install(geometry, loadedMesh.subdivisionLevel, wireframe, showSurface)
    stats = { ...stats, preparationMs: performance.now() - preparing, renderBytes: Object.values(geometry).reduce((sum, array) => sum + array.byteLength, 0) }
    selected = null
    selectedGeology = null
    selectedTerrain = null
    selectedClimate = null
    selectedHydrology = null
  }
  function chooseClimateMonth() {
    const prior = { selected, selectedGeology, selectedTerrain }
    chooseMode()
    selected = prior.selected
    selectedGeology = prior.selectedGeology
    selectedTerrain = prior.selectedTerrain
    if (selected && loadedClimate) {
      selectedClimate = queryClimateRegion(loadedClimate, selected.region, climateMonth)
      selectedHydrology = loadedHydrology ? queryHydrologyRegion(loadedHydrology, selected.region, loadedClimate, loadedCryosphere ?? undefined) : null
      scene?.showSelection(selected)
    }
    else {
      selectedClimate = null
      selectedHydrology = null
    }
  }
  onMount(() => {
    try {
      scene = createDebugScene(viewport, (position) => {
        if (busy || !pickReady || !loadedMesh || !controller)
          return
        picking = true
        const id = ++pickId
        const mesh = loadedMesh
        controller.pick({ x: position.x, y: position.y, z: position.z }).then((region) => {
          if (id !== pickId || !pickReady || mesh !== loadedMesh)
            return
          selected = prepareDebugSelection(mesh, region)
          selectedGeology = loadedGeology ? queryGeologyRegion(loadedGeology, region) : null
          selectedTerrain = loadedTerrain ? queryTerrainRegion(loadedTerrain, region) : null
          selectedClimate = loadedClimate ? queryClimateRegion(loadedClimate, region, climateMonth) : null
          selectedHydrology = loadedHydrology ? queryHydrologyRegion(loadedHydrology, region, loadedClimate ?? undefined, loadedCryosphere ?? undefined) : null
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
        if (state.status === 'running' && busy)
          message = `Pipeline ${Math.round(state.pipelineProgress * 100)}% · ${state.stageId ?? 'mesh'} · ${state.detail ?? ''}`
        if (state.status === 'completed' && state.postMessageMs !== undefined && stats)
          stats = { ...stats, postMessageMs: state.postMessageMs }
      })
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

<svelte:head><title>Mesh Debug · Another Earth</title></svelte:head>

<div class='min-h-screen bg-slate-50 text-slate-900'>
  <header class='flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5'>
    <div class='flex items-baseline gap-4'><a href='/' class='font-semibold'>Another Earth</a><h1 class='text-sm text-slate-500'>Mesh Debug</h1></div>
    <span class='text-xs text-slate-500'>Mesh / M1.3 · 初步水文</span>
  </header>
  <div class='grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[19rem_1fr]'>
    <aside class='space-y-6 overflow-auto border-r border-slate-200 bg-white p-5'>
      <section class='space-y-3' aria-label='网格参数'>
        <h2 class='text-sm font-semibold'>球面网格</h2>
        <label class='block text-sm'>生成内容
          <select class='mt-1 w-full rounded border border-slate-300 bg-white p-2' bind:value={generationKind}>
            <option value='mesh'>仅网格</option><option value='geology'>板块与地壳（M1.1A）</option><option value='terrain'>基础地形 T0（M1.1B）</option><option value='climate'>初步气候 C0（M1.2）</option><option value='hydrology'>冰雪 I0 / 水文 H0（M1.3A）</option>
          </select>
        </label>
        <label class='block text-sm'>细分等级
          <select class='mt-1 w-full rounded border border-slate-300 bg-white p-2' bind:value={level} onchange={chooseLevel}>
            {#each Array.from({ length: 5 }, (_, i) => i + 4) as l}
              <option value={l}>L{l} · {(10 * 4 ** l + 2).toLocaleString()} Regions</option>
            {/each}
          </select>
        </label>
        <label class='block text-sm'>可视化模式
          <select class='mt-1 w-full rounded border border-slate-300 bg-white p-2' bind:value={mode} onchange={chooseMode} disabled={busy}>
            <option value='voronoi'>Spherical Voronoi</option><option value='icosphere'>Icosphere</option>
          </select>
        </label>
        <label class='block text-sm'>顶点扰动 <span class='font-mono tabular-nums'>{irregularity.toFixed(2)}</span>
          <input class='mt-2 w-full accent-sky-700' type='range' min='0' max='1' step='0.05' bind:value={irregularity} />
        </label>
        <label class='block text-sm'>Seed
          <input class='mt-1 w-full rounded border border-slate-300 bg-white p-2 font-mono' type='text' bind:value={seed} onkeydown={(event) => {
            if (event.key === 'Enter')
              generate()
          }} />
        </label>
        <p class='text-xs leading-relaxed text-slate-500'>仅网格模式下，扰动 0 使用原始 Icosphere 拓扑，Seed 不影响结果；大于 0 时按 Seed 扰动并重新构建球面 Delaunay。</p>
        {#if level >= 6}<p class='text-xs leading-relaxed text-slate-500'>高等级采用单倍像素比，默认关闭网格线与自动旋转。L8 约 65 万区域，显存和内存占用较高。</p>{/if}
        <div class='space-y-2 text-sm'>
          <label class='flex items-center gap-2'><input type='checkbox' bind:checked={wireframe} onchange={options} />显示线框</label>
          <label class='flex items-center gap-2'><input type='checkbox' bind:checked={showSurface} onchange={options} />显示表面</label>
          <label class='flex items-center gap-2'><input type='checkbox' bind:checked={showFiveNeighborPoints} onchange={options} />显示五邻域中心（橙点）</label>
          <label class='flex items-center gap-2'><input type='checkbox' bind:checked={rotate} onchange={options} />自动旋转</label>
        </div>
        <div class='grid grid-cols-2 gap-2'>
          <button class='rounded border border-slate-300 px-3 py-2 text-xs hover:bg-slate-100' onclick={() => scene?.reset()}>重置视角</button>
          <button class='rounded bg-sky-700 px-3 py-2 text-xs text-white hover:bg-sky-800' onclick={() => generate()}>Generate</button>
          <button class='rounded border border-slate-300 px-3 py-2 text-xs hover:bg-slate-100' onclick={() => generate(true)}>强制重算</button>
          <button class='rounded border border-slate-300 px-3 py-2 text-xs hover:bg-slate-100' onclick={cancel} disabled={!busy}>Cancel</button>
        </div>
      </section>
      {#if generationKind !== 'mesh'}
        <section class='space-y-3 border-t border-slate-200 pt-4' aria-label='地质参数'>
          <h2 class='text-sm font-semibold'>板块与候选大陆</h2>
          <label class='block text-sm'>主板块数
            <input aria-label='主板块数' class='mt-1 w-full rounded border border-slate-300 p-2' type='number' min='2' max='100' step='1' bind:value={geologyParameters.primaryPlateCount} />
          </label>
          <label class='block text-sm'>微板块目标数
            <input aria-label='微板块目标数' class='mt-1 w-full rounded border border-slate-300 p-2' type='number' min='0' max={100 - geologyParameters.primaryPlateCount} step='1' bind:value={geologyParameters.microPlateCount} />
          </label>
          <label class='block text-sm'>板块面积差异
            <input class='mt-2 w-full' type='range' min='0' max='1' step='0.05' bind:value={geologyParameters.plateSizeVariety} />
          </label>
          <label class='block text-sm'>候选大陆目标数
            <input aria-label='候选大陆目标数' class='mt-1 w-full rounded border border-slate-300 p-2' type='number' min='1' max='100' step='1' bind:value={geologyParameters.continentCount} />
          </label>
          <label class='block text-sm'>候选陆地目标比例 {Math.round(geologyParameters.candidateLandCoverage * 100)}%
            <input aria-label='候选陆地目标比例' class='mt-2 w-full' type='range' min='0' max='1' step='0.05' bind:value={geologyParameters.candidateLandCoverage} />
          </label>
          <label class='block text-sm'>候选大陆面积差异
            <input class='mt-2 w-full' type='range' min='0' max='1' step='0.05' bind:value={geologyParameters.continentSizeVariety} />
          </label>
          <p class='text-xs leading-relaxed text-slate-500'>参考网格固定 L6。候选大陆用于约束地壳，最终地形可能改变海岸；微板块数量为生成目标。微板块实际数量受边界连通性约束。</p>
        </section>
      {/if}
      {#if generationKind === 'terrain' || generationKind === 'climate' || generationKind === 'hydrology'}
        <section class='space-y-3 border-t border-slate-200 pt-4' aria-label='地形参数'>
          <h2 class='text-sm font-semibold'>构造与基础地形 T0</h2>
          <p class='text-xs leading-relaxed text-slate-500'>侵蚀在高程转为 km 前参与 T0 地形塑形；水力参数控制下游汇流刻槽，冰川参数控制高纬/高海拔地形塑形。当前不读取降雨和气候。</p>
          <label class='block text-sm'>岛弧目标数
            <input class='mt-1 w-full rounded border border-slate-300 p-2' type='number' min='0' max='100' step='1' bind:value={landformParameters.islandArcCount} />
          </label>
          <label class='block text-sm'>岛屿密度
            <input class='mt-2 w-full' type='range' min='0' max='1' step='0.05' bind:value={landformParameters.islandDensity} />
          </label>
          <label class='block text-sm'>热点目标数
            <input class='mt-1 w-full rounded border border-slate-300 p-2' type='number' min='0' max='100' step='1' bind:value={landformParameters.hotspotCount} />
          </label>
          {#each terrainControls as parameter}
            <label class='block text-sm'>{parameter.label} {terrainParameters[parameter.key].toFixed(2)}
              <input aria-label={parameter.label} class='mt-2 w-full' type='range' min='0' max={parameter.max} step='0.05' bind:value={terrainParameters[parameter.key]} />
            </label>
          {/each}
          <label class='block text-sm'>海平面基准（km）
            <input aria-label='海平面基准（km）' class='mt-1 w-full rounded border border-slate-300 p-2' type='number' step='0.1' bind:value={seaLevelDatumKm} />
          </label>
          <p class='text-xs leading-relaxed text-slate-500'>高程使用 km；本阶段侵蚀不使用气候或降雨数据，也不生成正式河网。</p>
        </section>
      {/if}
      {#if generationKind === 'climate' || generationKind === 'hydrology'}
        <section class='space-y-3 border-t border-slate-200 pt-4' aria-label='气候参数'>
          <h2 class='text-sm font-semibold'>类地气候参数</h2>
          <p class='text-xs text-slate-500'>当前模型限定半径 6,371 km、自转 24 小时。</p>
          <label class='block text-sm'>轴倾角（°）<input class='mt-1 w-full rounded border p-2' type='number' min='0' max='45' step='0.1' bind:value={climateParameters.axialTiltDegrees} /></label>
          <label class='block text-sm'>公转周期（地球日）<input class='mt-1 w-full rounded border p-2' type='number' min='300' max='430' step='0.25' bind:value={climateParameters.orbitalPeriodDays} /></label>
          <label class='block text-sm'>温度偏移（°C）<input class='mt-1 w-full rounded border p-2' type='number' min='-20' max='20' step='0.5' bind:value={climateParameters.temperatureOffsetC} /></label>
          <label class='block text-sm'>降水倍率<input class='mt-1 w-full rounded border p-2' type='number' min='0' max='3' step='0.1' bind:value={climateParameters.precipitationScale} /></label>
        </section>
      {/if}
      {#if generationKind === 'hydrology'}
        <section class='space-y-3 border-t border-slate-200 pt-4' aria-label='水文参数'>
          <h2 class='text-sm font-semibold'>初步冰雪与径流</h2>
          <p class='text-xs leading-relaxed text-slate-500'>温度指数近似，不代表全球蒸散或冰川质量平衡标定。河道至少汇集 16 个平均网格面积；低级支流在专题图中淡化显示。</p>
          <label class='block text-sm'>融雪系数（mm / °C / 月）<input class='mt-1 w-full rounded border p-2' type='number' min='0' max='100' step='0.5' bind:value={hydrologyParameters.degreeDayMeltFactorMmPerCMonth} /></label>
          <label class='block text-sm'>蒸散温度系数（mm / °C / 月）<input class='mt-1 w-full rounded border p-2' type='number' min='0' max='100' step='0.5' bind:value={hydrologyParameters.evapotranspirationFactorMmPerCMonth} /></label>
          <label class='block text-sm'>最小河道汇水面积（km²）<input class='mt-1 w-full rounded border p-2' type='number' min='0' step='100' bind:value={hydrologyParameters.minimumRiverDrainageAreaKm2} /></label>
        </section>
      {/if}
      {#if loadedGeology}
        <section class='space-y-3 border-t border-slate-200 pt-4 text-xs' aria-label='地质结果'>
          <h2 class='text-sm font-semibold'>已加载地质结果</h2>
          <label class='block text-sm'>地质专题
            <select class='mt-1 w-full rounded border border-slate-300 bg-white p-2' bind:value={geologyTheme} onchange={chooseMode} disabled={busy}>
              <option value='plates'>运动板块</option><option value='continents'>候选大陆归属</option><option value='candidate-land'>候选海陆</option><option value='crust'>地壳类型</option><option value='topology'>网格拓扑</option>
              {#if loadedTerrain}
                <option value='elevation'>基础高程（km）</option><option value='land'>基础海陆</option><option value='boundaries'>构造边界</option><option value='mantle'>地幔升降</option><option value='volcanism'>火山塑形贡献</option><option value='slope'>坡度</option>
              {/if}
              {#if loadedClimate}
                <option value='temperature'>月平均气温（°C）</option><option value='precipitation'>月总降水（mm）</option><option value='wind'>月风场（东西／南北）</option><option value='ocean-current'>洋流暖度代理</option>
              {/if}
              {#if loadedCryosphere}<option value='snow'>月末积雪水当量（mm）</option>{/if}
              {#if loadedHydrology}<option value='runoff'>年径流深（mm）</option><option value='rivers'>河网</option><option value='basins'>流域</option>{/if}
            </select>
          </label>
          {#if loadedClimate}
            <label class='block text-sm'>月份 {climateMonth + 1}
              <input class='mt-2 w-full' type='range' min='0' max='11' step='1' bind:value={climateMonth} oninput={chooseClimateMonth} />
            </label>
            <p class='text-slate-500'>C0 为侵蚀前初步气候；12 个等时长季节箱。温度蓝冷红暖，降水棕干蓝湿；风场红为向东、蓝为向西、绿分量向北；洋流红暖蓝冷。风和洋流为相对模型量。</p>
          {/if}
          <dl class='grid grid-cols-2 gap-y-2'>
            <dt>参考区域数</dt><dd>{loadedGeology.referenceRegionCount.toLocaleString()}</dd>
            <dt>运动板块数</dt><dd>{loadedGeology.plates.length}</dd>
            <dt>微板块 目标 / 实际</dt><dd>{loadedGeology.statistics.requestedMicroPlateCount} / {loadedGeology.statistics.actualMicroPlateCount}</dd>
            <dt>候选大陆数</dt><dd>{loadedGeology.continents.length}</dd>
            <dt>候选陆地目标</dt><dd>{(loadedGeology.statistics.targetCandidateLandCoverage * 100).toFixed(1)}%</dd>
            <dt>参考网格候选陆地</dt><dd>{(loadedGeology.statistics.referenceCandidateLandCoverage * 100).toFixed(1)}%</dd>
            <dt>输出网格候选陆地</dt><dd>{(loadedGeology.statistics.outputCandidateLandCoverage * 100).toFixed(1)}%</dd>
          </dl>
          <p class='text-slate-500'>板块与大陆以不同颜色区分。候选海陆：绿为陆地、蓝为海洋；地壳：棕为大陆地壳、蓝为海洋地壳。</p>
          {#if loadedTerrain}
            <div class='space-y-2 border-t border-slate-200 pt-3' aria-label='最终地形统计'>
              <h3 class='font-semibold'>最终地形</h3>
              <dl class='grid grid-cols-2 gap-y-2'>
                <dt>最终陆地比例</dt><dd>{(loadedTerrain.statistics.landCoverage * 100).toFixed(1)}%</dd>
                <dt>海陆变化区域</dt><dd>{loadedTerrain.statistics.changedCoastRegions.toLocaleString()}</dd>
                <dt>陆地连通分量</dt><dd>{loadedTerrain.statistics.landComponentCount}</dd>
                <dt>最低 / 最高（km）</dt><dd>{loadedTerrain.statistics.minimumElevationKm.toFixed(2)} / {loadedTerrain.statistics.maximumElevationKm.toFixed(2)}</dd>
              </dl>
              <p class='text-slate-500'>高程：深蓝海底、浅蓝近海，陆地由绿过渡至黄褐和红色高山。边界：红为汇聚、青为张裂、黄为走滑。</p>
            </div>
          {/if}
          <ul class='space-y-1 font-mono' aria-label='阶段缓存'>
            {#each stages as stage}<li>{stage.stageId}: {stage.action === 'cache-hit' ? 'Cache Hit' : 'Rebuilt'}</li>{/each}
          </ul>
        </section>
      {/if}
      <section class='space-y-2 border-t border-slate-200 pt-4 text-xs' aria-label='网格统计'>
        <h2 class='text-sm font-semibold'>网格统计</h2>
        {#if stats}
          <dl class='grid grid-cols-2 gap-y-2 font-mono'>
            <dt>已加载等级</dt><dd>L{stats.level}</dd><dt>扰动 / Seed</dt><dd class='break-all'>{stats.irregularity.toFixed(2)} / {stats.seed}</dd>
            <dt>Regions / V</dt><dd>{stats.regions.toLocaleString()}</dd><dt>五邻域</dt><dd>{stats.fiveNeighborRegions.toLocaleString()}</dd>
            <dt>Edges / E</dt><dd>{stats.edges.toLocaleString()}</dd><dt>Faces / F</dt><dd>{stats.faces.toLocaleString()}</dd>
            <dt>V − E + F</dt><dd>{stats.regions - stats.edges + stats.faces}</dd>
            <dt>Pipeline</dt><dd>{stats.cacheHit ? 'Cache Hit' : 'Rebuilt'}</dd><dt>Pipeline 耗时</dt><dd>{stats.generationMs.toFixed(1)} ms</dd>
            <dt>Worker 初始化</dt><dd>{stats.workerInitMs.toFixed(1)} ms</dd><dt>传输副本</dt><dd>{stats.copyMs.toFixed(1)} ms</dd>
            <dt>postMessage</dt><dd>{stats.postMessageMs.toFixed(1)} ms</dd><dt>主线程校验</dt><dd>{stats.hydrateMs.toFixed(1)} ms</dd>
            <dt>请求往返</dt><dd>{stats.receiveMs.toFixed(1)} ms</dd><dt>传输数组</dt><dd>{(stats.meshBytes / 2 ** 20).toFixed(1)} MiB</dd>
            <dt>缓存数组</dt><dd>{(stats.cacheBytes / 2 ** 20).toFixed(1)} MiB</dd><dt>显示数据准备</dt><dd>{stats.preparationMs.toFixed(1)} ms</dd>
            <dt>显示数组</dt><dd>{(stats.renderBytes / 2 ** 20).toFixed(1)} MiB</dd><dt>GPU 几何体</dt><dd>{gpuGeometries}</dd>
          </dl>
          <p class='text-slate-500'>物理半径 6,371 km · 显示半径 1</p>
        {/if}
      </section>
      <section class='space-y-2 border-t border-slate-200 pt-4 text-xs' aria-label='选中区域'>
        <h2 class='text-sm font-semibold'>Region 检查</h2>
        {#if picking}<p role='status'>正在查询最近区域…</p>{/if}
        {#if selected}
          <p class='font-mono'>Region #{selected.region} · {selected.neighbors.length} 个邻居</p>
          <p>面积 {selected.areaKm2.toLocaleString(undefined, { maximumFractionDigits: 2 })} km²</p>
          <p class='break-words text-slate-500'>邻居：{selected.neighbors.join(', ')}</p>
          {#if selectedGeology}
            <dl class='space-y-2 break-all'>
              <dt>地质 / 普通参考区域</dt><dd>{selectedGeology.referenceRegion} / {selectedGeology.geographicReferenceRegion}</dd>
              <dt>运动板块（{selectedGeology.plateKind === 'primary' ? '主板块' : '微板块'}）</dt><dd class='font-mono'>{selectedGeology.plateId}</dd>
              <dt>基础细分索引</dt><dd>{selectedGeology.subdivisionIndex}</dd>
              <dt>候选大陆</dt><dd class='font-mono'>{selectedGeology.continentId ?? '海洋'}</dd>
              <dt>地壳</dt><dd>{selectedGeology.crustType === 'continental' ? '大陆地壳' : '海洋地壳'} · {selectedGeology.thicknessKm.toFixed(1)} km · {selectedGeology.densityGcm3.toFixed(2)} g/cm³</dd>
            </dl>
          {/if}
          {#if selectedTerrain}
            <dl class='space-y-2' aria-label='区域地形'>
              <dt>最终高程 / 海陆</dt><dd>{selectedTerrain.elevationKm.toFixed(3)} km · {selectedTerrain.land ? '陆地' : '海洋'}</dd>
              <dt>坡度</dt><dd>{(selectedTerrain.slopeRadians * 180 / Math.PI).toFixed(2)}°</dd>
              <dt>构造边界 / 相对应力</dt><dd>{['无边界', '汇聚', '张裂', '走滑'][selectedTerrain.boundaryType]} / {selectedTerrain.stress.toFixed(3)}</dd>
              <dt>构造区域隆起（塑形坐标）</dt><dd>{selectedTerrain.regionalUpliftCoordinate.toFixed(4)}</dd>
              <dt>地幔 / 火山塑形</dt><dd>{selectedTerrain.mantleFlow.toFixed(3)} / {selectedTerrain.volcanicCoordinate.toFixed(3)}</dd>
            </dl>
          {/if}
          {#if selectedClimate}
            <dl class='space-y-2' aria-label='区域气候'>
              <dt>第 {selectedClimate.month + 1} 月气温</dt><dd>{selectedClimate.temperatureC.toFixed(1)} °C</dd>
              <dt>第 {selectedClimate.month + 1} 月降水</dt><dd>{selectedClimate.precipitationMm.toFixed(1)} mm</dd>
              <dt>年均温 / 年降水</dt><dd>{selectedClimate.annualMeanTemperatureC.toFixed(1)} °C / {selectedClimate.annualPrecipitationMm.toFixed(0)} mm</dd>
              <dt>初步 Köppen 类型</dt><dd>{KOPPEN_CODES[selectedClimate.koppenClass]}</dd>
              <dt>风向东 / 向北（相对量）</dt><dd>{selectedClimate.windEast.toFixed(2)} / {selectedClimate.windNorth.toFixed(2)}</dd>
              <dt>洋流向东 / 向北（相对量）</dt><dd>{selectedClimate.oceanEast.toFixed(2)} / {selectedClimate.oceanNorth.toFixed(2)}</dd>
              <dt>洋流暖度代理</dt><dd>{selectedClimate.oceanWarmth.toFixed(2)}</dd>
            </dl>
          {/if}
          {#if selectedHydrology}
            <dl class='space-y-2' aria-label='区域水文'>
              <dt>年径流深 / 局地产流</dt><dd>{selectedHydrology.annualRunoffMm.toFixed(1)} mm / {selectedHydrology.annualRunoffVolumeM3.toExponential(2)} m³/年</dd>
              <dt>汇流量</dt><dd>{selectedHydrology.accumulatedFlowM3s.toFixed(2)} m³/s</dd>
              <dt>汇水面积</dt><dd>{selectedHydrology.contributingAreaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</dd>
              <dt>下游区域</dt><dd>{selectedHydrology.downstreamRegion < 0 ? (selectedHydrology.basinId === null ? '海洋' : selectedHydrology.basinEndorheic ? '内流汇点' : '海洋出口') : `Region #${selectedHydrology.downstreamRegion}`}</dd>
              <dt>流域</dt><dd>{selectedHydrology.basinId ?? '海洋'}</dd>
              {#if selectedHydrology.basinId}<dt>流域面积</dt><dd>{selectedHydrology.basinAreaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</dd>{/if}
              <dt>当前月融雪 / 径流</dt><dd>{selectedHydrology.monthlySnowmeltMm[climateMonth].toFixed(1)} / {selectedHydrology.monthlyRunoffMm[climateMonth].toFixed(1)} mm</dd>
              <dt>当前月蒸散</dt><dd>{selectedHydrology.monthlyEvapotranspirationMm[climateMonth].toFixed(1)} mm</dd>
              <dt>河道段</dt><dd>{selectedHydrology.riverSegments.map(river => `${river.id} · ${river.strahlerOrder}级`).join('；') || '非河道区域'}</dd>
              {#if loadedCryosphere}<dt>月末积雪水当量</dt><dd>{loadedCryosphere.monthlySnowWaterEquivalentMm[climateMonth * loadedCryosphere.regionCount + selected.region].toFixed(1)} mm</dd>{/if}
            </dl>
          {/if}
        {:else}<p class='text-slate-500'>点击球面查看最近区域及邻接关系。</p>{/if}
        <p><span class='text-amber-600'>●</span> 五邻域中心 <span class='text-yellow-600'>●</span> 选中区域</p>
        <p><span class='text-emerald-600'>●</span> 相邻中心与连线</p>
      </section>
    </aside>
    <main class='relative min-h-[65dvh] overflow-hidden' aria-label='Mesh 可视化' aria-busy={busy}>
      <div bind:this={viewport} class='absolute inset-0'></div>
      {#if loadedTerrain && geologyTheme === 'elevation'}
        <section class='pointer-events-none absolute bottom-14 right-4 w-64 rounded border border-slate-200 bg-white/95 p-3 text-xs text-slate-700 shadow-sm' aria-label='高程图例'>
          <h2 class='mb-2 font-semibold'>高程（km）</h2>
          <div class='mb-1 flex justify-between text-[10px] text-slate-500'><span>海洋</span><span>海平面</span></div>
          <div class='h-3 rounded-sm' style='background: linear-gradient(to right, #061a33 0%, #174d81 60%, #367eae 100%)'></div>
          <div class='mt-1 flex justify-between font-mono text-[10px]'><span>-10</span><span>-4</span><span>0</span></div>
          <div class='mb-1 mt-2 flex justify-between text-[10px] text-slate-500'><span>陆地</span><span>高山</span></div>
          <div class='h-3 rounded-sm' style='background: linear-gradient(to right, #075537 0%, #27853c 15.38%, #9bc75a 38.46%, #efd18c 53.85%, #ba4033 76.92%, #a72f2f 100%)'></div>
          <div class='mt-1 flex justify-between font-mono text-[10px]'><span>0</span><span>1</span><span>2.5</span><span>3.5</span><span>5</span><span>6.5</span></div>
        </section>
      {/if}
      {#if loadedTerrain && geologyTheme === 'slope'}
        <section class='pointer-events-none absolute bottom-14 right-4 w-64 rounded border border-slate-200 bg-white/95 p-3 text-xs text-slate-700 shadow-sm' aria-label='坡度图例'>
          <h2 class='mb-2 font-semibold'>坡度（°，对数色阶）</h2>
          <div class='h-3 rounded-sm' style={`background: ${slopeLegendGradient}`}></div>
          <div class='relative mt-1 h-4 font-mono text-[10px]'>
            {#each SLOPE_LEGEND_TICKS as degrees, index}
              <span class='absolute' style={`left: ${slopeDisplayPosition(degrees) * 100}%; transform: translateX(${index === 0 ? '0' : index === SLOPE_LEGEND_TICKS.length - 1 ? '-100%' : '-50%'})`}>{degrees}</span>
            {/each}
          </div>
          <p class='mt-1 text-[10px] text-slate-500'>绿色为缓坡，黄橙为中坡，红紫为陡坡；45°以上按最高档显示。</p>
        </section>
      {/if}
      <div class='pointer-events-none absolute left-4 top-4 rounded border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-600' role='status' aria-live='polite'>
        {#if busy}<span class='mr-2 inline-block h-2 w-2 rounded-full bg-sky-600'></span>{/if}{message}
      </div>
      {#if error}<div class='absolute inset-x-4 bottom-16 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800' role='alert'>{error}</div>{/if}
      <p class='pointer-events-none absolute bottom-4 left-4 rounded bg-white/90 px-3 py-2 text-xs text-slate-500'>拖动旋转 · 滚轮 / 双指缩放 · 点击选择</p>
    </main>
  </div>
</div>
