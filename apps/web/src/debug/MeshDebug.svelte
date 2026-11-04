<script lang='ts'>
  import type { SphericalMesh } from '@another-earth/world-core'
  import type { DebugMode, DebugSelection, DebugStats } from './mesh-debug-data'
  import { onMount } from 'svelte'
  import { GenerationCancelledError, GenerationController } from '../lib/generation/controller'
  import { prepareDebugGeometry, prepareDebugSelection } from './mesh-debug-data'
  import { createDebugScene } from './mesh-debug-scene'

  let viewport: HTMLDivElement
  let level = $state(2)
  let irregularity = $state(0)
  let seed = $state('42')
  let mode = $state<DebugMode>('voronoi')
  let wireframe = $state(true)
  let showSurface = $state(true)
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
    scene?.setOptions(wireframe, showSurface, rotate)
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
      const result = await controller.generate({ seed, config: { planet: { physicalRadiusKm: 6371 }, mesh: { subdivisionLevel: level, irregularity } }, force })
      if (id !== requestId)
        return
      const preparing = performance.now()
      const geometry = prepareDebugGeometry(result.mesh, mode)
      const preparationMs = performance.now() - preparing
      scene.install(geometry, result.mesh.subdivisionLevel, wireframe, showSurface)
      options()
      loadedMesh = result.mesh
      selected = null
      stats = { level: result.mesh.subdivisionLevel, irregularity: result.mesh.irregularity, seed: result.mesh.seed, fiveNeighborRegions: geometry.fiveNeighborCenters.length / 3, regions: result.mesh.regionCount, edges: result.mesh.edgeRegions.length / 2, faces: result.mesh.triangles.length / 3, generationMs: result.pipelineMs, cacheHit: result.cacheHit, cacheBytes: result.cacheBytes, preparationMs, renderBytes: Object.values(geometry).reduce((sum, array) => sum + array.byteLength, 0), copyMs: result.copyMs, meshBytes: result.meshBytes, receiveMs: result.receiveMs, workerInitMs: controller.workerInitMs, hydrateMs: result.hydrateMs, postMessageMs: 0 }
      busy = false
      pickReady = true
      message = `L${stats.level} · 扰动 ${stats.irregularity.toFixed(2)} 网格已就绪`
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
    const geometry = prepareDebugGeometry(loadedMesh, mode)
    scene.install(geometry, loadedMesh.subdivisionLevel, wireframe, showSurface)
    stats = { ...stats, preparationMs: performance.now() - preparing, renderBytes: Object.values(geometry).reduce((sum, array) => sum + array.byteLength, 0) }
    selected = null
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
          message = `Pipeline ${Math.round(state.pipelineProgress * 100)}% · ${state.detail ?? 'mesh'}`
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
    <span class='text-xs text-slate-500'>M0.3 · 球面拓扑检查</span>
  </header>
  <div class='grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[19rem_1fr]'>
    <aside class='space-y-6 overflow-auto border-r border-slate-200 bg-white p-5'>
      <section class='space-y-3' aria-label='网格参数'>
        <h2 class='text-sm font-semibold'>球面网格</h2>
        <label class='block text-sm'>细分等级
          <select class='mt-1 w-full rounded border border-slate-300 bg-white p-2' bind:value={level} onchange={chooseLevel}>
            {#each Array.from({ length: 8 }, (_, i) => i) as l}
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
        <p class='text-xs leading-relaxed text-slate-500'>扰动 0 使用原始 Icosphere 拓扑，Seed 不影响结果；大于 0 时按 Seed 扰动并重新构建球面 Delaunay。</p>
        {#if level >= 6}<p class='text-xs leading-relaxed text-slate-500'>高等级采用单倍像素比，默认关闭网格线与自动旋转。L7 约 16 万区域，加载时仍可切换等级。</p>{/if}
        <div class='space-y-2 text-sm'>
          <label class='flex items-center gap-2'><input type='checkbox' bind:checked={wireframe} onchange={options} />显示线框</label>
          <label class='flex items-center gap-2'><input type='checkbox' bind:checked={showSurface} onchange={options} />显示表面</label>
          <label class='flex items-center gap-2'><input type='checkbox' bind:checked={rotate} onchange={options} />自动旋转</label>
        </div>
        <div class='flex gap-2'>
          <button class='rounded border border-slate-300 px-3 py-2 text-xs hover:bg-slate-100' onclick={() => scene?.reset()}>重置视角</button>
          <button class='rounded bg-sky-700 px-3 py-2 text-xs text-white hover:bg-sky-800' onclick={() => generate()}>Generate</button>
          <button class='rounded border border-slate-300 px-3 py-2 text-xs hover:bg-slate-100' onclick={cancel} disabled={!busy}>Cancel</button>
        </div>
      </section>
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
            <dt>请求往返</dt><dd>{stats.receiveMs.toFixed(1)} ms</dd><dt>Mesh 数组</dt><dd>{(stats.meshBytes / 2 ** 20).toFixed(1)} MiB</dd>
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
        {:else}<p class='text-slate-500'>点击球面查看最近区域及邻接关系。</p>{/if}
        <p><span class='text-amber-600'>●</span> 五邻域中心 <span class='text-yellow-600'>●</span> 选中区域</p>
        <p><span class='text-emerald-600'>●</span> 相邻中心与连线</p>
      </section>
    </aside>
    <main class='relative min-h-[65dvh] overflow-hidden' aria-label='Mesh 可视化' aria-busy={busy}>
      <div bind:this={viewport} class='absolute inset-0'></div>
      <div class='pointer-events-none absolute left-4 top-4 rounded border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-600' role='status' aria-live='polite'>
        {#if busy}<span class='mr-2 inline-block h-2 w-2 rounded-full bg-sky-600'></span>{/if}{message}
      </div>
      {#if error}<div class='absolute inset-x-4 bottom-16 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800' role='alert'>{error}</div>{/if}
      <p class='pointer-events-none absolute bottom-4 left-4 rounded bg-white/90 px-3 py-2 text-xs text-slate-500'>拖动旋转 · 滚轮 / 双指缩放 · 点击选择</p>
    </main>
  </div>
</div>
