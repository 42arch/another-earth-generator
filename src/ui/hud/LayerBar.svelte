<script lang='ts'>
  import {
    Check,
    CircleQuestionMark,
    CloudRain,
    Copy,
    Layers,
    Map,
    Mountain,
    Satellite,
    Thermometer,
    Waves,
    Wind,
    Workflow,
    X,
  } from '@lucide/svelte'
  import Checkbox from '@/ui/components/Checkbox.svelte'
  import { fly } from 'svelte/transition'
  import {
    getHeightmapLandColor,
    getHeightmapOceanColor,
    HEIGHTMAP_MAX_LAND_ELEVATION_KM,
    HEIGHTMAP_MAX_OCEAN_DEPTH_KM,
  } from '@/core/rendering/shared/heightmap-color-scale'
  import {
    getOceanCurrentSpeedColor,
    getOceanCurrentThermalColor,
    getWindColor,
  } from '@/core/rendering/shared/climate-color-scale'
  import { formatLayerStatistics, hasLayerStatistics } from '@/core/world/layer-statistics'
  import Tooltip from '@/ui/components/Tooltip.svelte'
  import { appState } from '@/ui/state/app.svelte'

  const numberFormat = new Intl.NumberFormat('zh-CN')
  let copyStatus = $state<'idle' | 'copied' | 'error'>('idle')
  let resetTimer: ReturnType<typeof setTimeout> | undefined

  function percentage(value: number): string {
    return value > 0 && value < 0.01 ? '<0.01%' : `${value.toFixed(2)}%`
  }

  async function copyStatistics(): Promise<void> {
    const statistics = appState.layerStatistics
    if (!statistics)
      return
    try {
      await navigator.clipboard.writeText(formatLayerStatistics(statistics))
      copyStatus = 'copied'
    }
    catch {
      copyStatus = 'error'
    }
    if (resetTimer)
      clearTimeout(resetTimer)
    resetTimer = setTimeout(() => copyStatus = 'idle', 2400)
  }

  const displayModes = [
    { mode: 'satellite' as const, label: '卫星影像', icon: Satellite },
    { mode: 'heightmap' as const, label: '高度图', icon: Mountain },
    { mode: 'dem' as const, label: 'DEM图', icon: Mountain },
    { mode: 'plates' as const, label: '板块构造', icon: Workflow },
    { mode: 'continents' as const, label: '大陆区划', icon: Map },
    // { mode: 'crust' as const, label: '地壳类型', icon: Layers },
    // { mode: 'density' as const, label: '地壳密度', icon: CircleGauge },
    // { mode: 'subduction' as const, label: '俯冲极性', icon: ArrowDownUp },
    // { mode: 'stress' as const, label: '构造应力', icon: Activity },
    // { mode: 'mantle' as const, label: '地幔动态', icon: Orbit },
    // { mode: 'volcanism' as const, label: '火山构造', icon: Flame },
    // { mode: 'classification' as const, label: '地形分类', icon: Layers },
    // { mode: 'texture' as const, label: '地形纹理', icon: Activity },
    // { mode: 'finalization' as const, label: '最终整形', icon: CircleGauge },
    // { mode: 'glacial' as const, label: '冰川指数', icon: Mountain },
    { mode: 'geometric-flow' as const, label: '几何汇流', icon: Workflow },
    { mode: 'temperature' as const, label: '月均气温', icon: Thermometer },
    { mode: 'precipitation' as const, label: '月降水量', icon: CloudRain },
    { mode: 'wind' as const, label: '盛行风', icon: Wind },
    { mode: 'ocean-current' as const, label: '洋流', icon: Waves },
    { mode: 'koppen' as const, label: '气候分类', icon: Layers },
    { mode: 'biome' as const, label: '生物群系', icon: Layers },
  ]

  const heightmapOceanLegend = [8, 6, 4, 2, 0]
    .map((depth) => {
      const position = (HEIGHTMAP_MAX_OCEAN_DEPTH_KM - depth) / HEIGHTMAP_MAX_OCEAN_DEPTH_KM * 100
      return `${getHeightmapOceanColor(depth)} ${position}%`
    })
    .join(', ')
  const heightmapLandLegend = [0, 1, 2.5, 4.5, 6]
    .map((elevation) => {
      const position = elevation / HEIGHTMAP_MAX_LAND_ELEVATION_KM * 100
      return `${getHeightmapLandColor(elevation)} ${position}%`
    })
    .join(', ')
  const windStrengthLegend = [0, 0.25, 0.5, 0.75, 1]
    .map((strength, index, values) => `${getWindColor(strength)} ${index / (values.length - 1) * 100}%`)
    .join(', ')
  const oceanCurrentSpeedLegend = [0, 0.25, 0.5, 0.75, 1]
    .map((strength, index, values) => `${getOceanCurrentSpeedColor(strength)} ${index / (values.length - 1) * 100}%`)
    .join(', ')
  const oceanCurrentThermalLegend = [-1, -0.5, 0, 0.5, 1]
    .map((warmth, index, values) => `${getOceanCurrentThermalColor(warmth)} ${index / (values.length - 1) * 100}%`)
    .join(', ')

  const monthNames = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月']
</script>

{#if appState.layerDrawerOpen}
  <aside
    transition:fly={{ x: 300, duration: 200 }}
    class='pointer-events-auto fixed right-4 top-16 bottom-20 z-40 w-[22rem] max-w-[calc(100vw-32px)] bg-[#1e1e20]/85 backdrop-blur-md border border-white/10 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] flex flex-col text-obs-text-main overflow-hidden'
  >
    <!-- 头部 -->
    <header class='flex items-center justify-between px-4 py-2 border-b border-white/[0.06] select-none'>
      <div class='flex items-center justify-center gap-2'>
        <Layers class='w-4 h-4 text-obs-primary' />
        <h2 class='font-heading text-sm font-bold tracking-wider uppercase text-obs-text-main m-0 leading-tight'>
          图层
        </h2>
      </div>

      <button
        type='button'
        onclick={() => appState.layerDrawerOpen = false}
        class='text-obs-text-dim hover:text-obs-text-main p-1 rounded-md hover:bg-white/[0.06] transition-colors cursor-pointer'
        title='关闭图层面板'
      >
        <X class='w-4 h-4' />
      </button>
    </header>

    <!-- 滚动内容区 -->
    <div class='flex-1 overflow-y-auto p-3.5 flex flex-col gap-3 custom-scrollbar text-xs'>
      <!-- 着色模式 -->
      <div class='flex flex-col gap-1.5'>
        <div class='grid grid-cols-4 gap-1'>
          {#each displayModes as item}
            {@const Icon = item.icon}
            <button
              type='button'
              onclick={() => appState.setDisplayMode(item.mode)}
              title={item.label}
              class="flex flex-row items-center gap-1 p-1.5 rounded-lg transition-all text-center cursor-pointer border {appState.params.appearance.displayMode === item.mode ? 'bg-obs-primary/15 text-obs-primary border-obs-primary/50 font-semibold' : 'text-obs-text-muted hover:text-obs-text-main hover:bg-white/[0.04] border-transparent'}"
            >
              <Icon class="w-3 h-3 shrink-0 {appState.params.appearance.displayMode === item.mode ? 'text-obs-primary' : 'opacity-80'}" />
              <span class='leading-none text-[11px] whitespace-nowrap overflow-hidden text-ellipsis'>{item.label}</span>
            </button>
          {/each}
        </div>

        {#if appState.params.appearance.displayMode === 'temperature' || appState.params.appearance.displayMode === 'precipitation' || appState.params.appearance.displayMode === 'wind' || appState.params.appearance.displayMode === 'ocean-current'}
          <label class='flex items-center justify-between gap-2 px-1 pt-2 text-[11px] text-obs-text-muted'>
            <span>显示月份</span>
            <select
              class='rounded-md border border-white/[0.12] bg-obs-surface px-2 py-1 text-obs-text-main'
              value={appState.params.appearance.climateMonth}
              onchange={event => appState.updateParam('appearance', 'climateMonth', Number(event.currentTarget.value))}
            >
              {#each monthNames as name, index}
                <option value={index}>{name}</option>
              {/each}
            </select>
          </label>
        {/if}
        {#if appState.params.appearance.displayMode === 'continents' || appState.params.appearance.displayMode === 'plates' || appState.params.appearance.displayMode === 'biome' || appState.params.appearance.displayMode === 'koppen'}
          {@const boundaryMode = appState.params.appearance.displayMode}
          {@const boundaryOptionMap = {
            plates: 'showPlateBoundaries',
            continents: 'showContinentBoundaries',
            biome: 'showBiomeBoundaries',
            koppen: 'showKoppenBoundaries',
          } as const}
          {@const boundaryOption = boundaryOptionMap[boundaryMode as keyof typeof boundaryOptionMap]}
          <div class='flex items-center gap-2 px-1 pt-2 text-[11px] text-obs-text-muted'>
            <Checkbox
              label='显示区域边界'
              checked={appState.params.appearance[boundaryOption]}
              onchange={() => appState.toggleLayer(boundaryOption)}
            />
            <Tooltip content='隐藏同类区域内部网格线，只显示类别不同区域之间的边界。'>
              <span class='inline-flex cursor-help text-obs-text-dim hover:text-obs-text-main transition-colors'>
                <CircleQuestionMark class='h-3 w-3' />
              </span>
            </Tooltip>
          </div>
        {/if}
        <!--
        {#if appState.params.appearance.displayMode === 'crust'}
          <div class='flex items-center gap-3 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#b88447]'></i>大陆地壳</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#144d85]'></i>海洋地壳</span>
          </div>
        {:else if appState.params.appearance.displayMode === 'density'}
          <div class='flex items-center gap-2 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span>低密度</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#f5c752] to-[#40147a]'></i><span>高密度</span>
          </div>
        {:else if appState.params.appearance.displayMode === 'subduction'}
        -->
        <!--
        {#if appState.params.appearance.displayMode === 'subduction'}
          <div class='flex items-center gap-3 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#ff7314]'></i>上覆侧</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#268cff]'></i>俯冲侧</span>
          </div>
        {:else if appState.params.appearance.displayMode === 'stress'}
          <div class='flex items-center gap-2 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span>低应力</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#04050a] via-[#73105e] to-[#fff273]'></i><span>高应力</span>
          </div>
        {:else if appState.params.appearance.displayMode === 'volcanism'}
          <div class='grid grid-cols-2 gap-x-3 gap-y-1 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#1abfff]'></i>岛弧</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#ff3d0f]'></i>陆缘火山弧</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#ffd114]'></i>热点链</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#b833ff]'></i>大型火成岩省</span>
          </div>
        {:else if appState.params.appearance.displayMode === 'mantle'}
          <div class='flex items-center gap-2 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span>下沉</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#156bff] via-[#070811] to-[#ff3d0f]'></i><span>上涌</span>
          </div>
        {:else if appState.params.appearance.displayMode === 'classification'}
          <div class='grid grid-cols-2 gap-x-3 gap-y-1 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#bdaa47]'></i>克拉通</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#1f7ab8]'></i>盆地</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#f04014]'></i>褶皱带</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#9e45d1]'></i>高原</span>
          </div>
        {:else if appState.params.appearance.displayMode === 'texture'}
          <div class='grid grid-cols-2 gap-x-3 gap-y-1 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#b84dff]'></i>方向性山脊</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#ff6614]'></i>构造带纹理</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#14ccb8]'></i>表面细节</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#ff2e8c]'></i>海岸细化</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#add133]'></i>陆地背景</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#4db8ff]'></i>物理尺度细节</span>
          </div>
        -->
        {#if appState.params.appearance.displayMode === 'satellite'}
          <div class='flex flex-col gap-1.5 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <div class='flex items-center gap-2'><span>干旱</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#b9a27a] via-[#8e8851] to-[#315b2b]'></i><span>湿润</span></div>
            <div class='flex items-center gap-2'><span>低地</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#3b6230] via-[#777565] to-[#d5e0e5]'></i><span>高山雪线</span></div>
          </div>
        {:else if appState.params.appearance.displayMode === 'dem'}
          <div class='flex items-center gap-2 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span>低谷/深海</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-black to-white border border-white/20'></i><span>高山</span>
          </div>
        {:else if appState.params.appearance.displayMode === 'heightmap'}
          <div class='flex flex-col gap-1.5 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <div class='flex items-center gap-2'><span>深海</span><i class='h-1.5 flex-1 rounded-full border border-white/20' style={`background: linear-gradient(to right, ${heightmapOceanLegend})`}></i><span>浅海</span></div>
            <div class='flex items-center gap-2'><span>低地</span><i class='h-1.5 flex-1 rounded-full border border-white/20' style={`background: linear-gradient(to right, ${heightmapLandLegend})`}></i><span>高山</span></div>
          </div>
          <!--
        {:else if appState.params.appearance.displayMode === 'finalization'}
          <div class='grid grid-cols-2 gap-x-3 gap-y-1 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#ff9e1f]'></i>高程抬升</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#1f94ff]'></i>高程压低</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#ff33b8]'></i>洼地填平</span>
          </div>
        -->
        {:else if appState.params.appearance.displayMode === 'geometric-flow'}
          <div class='flex items-center gap-2 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span>低汇流</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#030509] via-[#0a6bb8] to-[#b8fff5]'></i><span>高汇流</span>
          </div>
          <div class='px-1 text-[9px] text-obs-text-dim/80'>沿地形排水图累加上游单元数量，用于观察流域几何</div>
        {:else if appState.params.appearance.displayMode === 'glacial'}
          <div class='flex items-center gap-2 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span>无冰川</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#030509] via-[#1f7ae6] to-[#f0faff]'></i><span>强冰川</span>
          </div>
        {:else if appState.params.appearance.displayMode === 'koppen'}
          <div class='grid grid-cols-2 gap-x-3 gap-y-1 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#127a47]'></i>A 热带</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#ec632b]'></i>B 干旱</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#2fac87]'></i>C 温带</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#5b61b0]'></i>D 大陆性</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#c3d6df]'></i>E 极地</span>
          </div>
        {:else if appState.params.appearance.displayMode === 'biome'}
          <div class='grid grid-cols-2 gap-x-3 gap-y-1 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#091f47]'></i>海洋</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#0d6b2e]'></i>热带雨林</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#1f9438]'></i>热带季节林</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#ada838]'></i>稀树草原</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#d47a38]'></i>热沙漠</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#a67a6b]'></i>冷沙漠</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#b8ad66]'></i>半干旱草原</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#ad9447]'></i>地中海灌丛</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#7a9e52]'></i>温带草原</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#2e7a47]'></i>温带季节林</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#29997a]'></i>温带雨林</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#336b80]'></i>针叶林</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#8eadd2]'></i>苔原</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#e6eff5]'></i>冰原</span>
            <span class='flex items-center gap-1'><i class='w-2 h-2 rounded-sm bg-[#bad4ca]'></i>高山苔原</span>
          </div>
        {:else if appState.params.appearance.displayMode === 'temperature'}
          <div class='flex items-center gap-2 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span>−30°C</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#2e52b8] via-[#e0eddb] to-[#db451f]'></i><span>40°C</span>
          </div>
        {:else if appState.params.appearance.displayMode === 'precipitation'}
          <div class='flex items-center gap-2 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span>0 mm</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#cca66b] via-[#57ad7d] to-[#144092]'></i><span>600+ mm</span>
          </div>
        {:else if appState.params.appearance.displayMode === 'wind'}
          <div class='flex items-center gap-2 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span>弱</span><i class='h-1.5 flex-1 rounded-full border border-white/20' style={`background: linear-gradient(to right, ${windStrengthLegend})`}></i><span>强</span>
          </div>
          <div class='px-1 text-[9px] leading-relaxed text-obs-text-dim'>底色表示相对风力并与地形融合；箭头表示气流方向。仅为相对值，非 m/s。</div>
        {:else if appState.params.appearance.displayMode === 'ocean-current'}
          <div class='flex items-center gap-2 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span>冷</span><i class='h-1.5 flex-1 rounded-full border border-white/20' style={`background: linear-gradient(to right, ${oceanCurrentThermalLegend})`}></i><span>暖</span>
          </div>
          <div class='flex items-center gap-2 px-1 pt-1 text-[10px] text-obs-text-dim'>
            <span>弱</span><i class='h-1.5 flex-1 rounded-full border border-white/20' style={`background: linear-gradient(to right, ${oceanCurrentSpeedLegend})`}></i><span>强</span>
          </div>
          <div class='px-1 text-[9px] text-obs-text-dim'>箭头颜色表示海温异常指标；底色深浅表示相对流速。指标非 °C，流速非 m/s。</div>
        {/if}
      </div>

      {#if hasLayerStatistics(appState.params.appearance.displayMode)}
        <!-- 图层统计 -->
        <div class='flex flex-col gap-1.5 mt-2'>
        <div class='flex items-center justify-between'>
          <span class='text-[10px] uppercase tracking-wider text-obs-text-dim font-medium'>当前图层统计</span>
          <button
            type='button'
            onclick={copyStatistics}
            disabled={!appState.layerStatistics}
            class='flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-obs-text-muted hover:text-obs-text-main hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer'
            title='复制统计数据'
          >
            {#if copyStatus === 'copied'}
              <Check class='w-3 h-3 text-obs-primary' />
            {:else}
              <Copy class='w-3 h-3' />
            {/if}
          </button>
        </div>

        <div class='flex flex-col bg-black/20 rounded-lg border border-white/[0.04] overflow-hidden'>
          {#if appState.layerStatistics}
            <div class='px-3 py-2 border-b border-white/[0.04]'>
              <div class='text-[11px] font-semibold text-obs-text-main'>{appState.layerStatistics.title}</div>
              <div class='mt-0.5 text-[10px] text-obs-text-dim'>占全部 {numberFormat.format(appState.layerStatistics.totalCells)} 单元</div>
              {#if appState.layerStatistics.plateCounts}
                <div class='mt-2 flex gap-3 text-[10px] text-obs-text-main'>
                  <span>主要板块 <strong class='font-mono text-obs-primary'>{appState.layerStatistics.plateCounts.primary}</strong></span>
                  <span>小板块 <strong class='font-mono text-obs-primary'>{appState.layerStatistics.plateCounts.micro}</strong></span>
                </div>
              {/if}
              {#if appState.layerStatistics.description}
                <p class='mt-1.5 text-[10px] leading-relaxed text-obs-text-dim'>{appState.layerStatistics.description}</p>
              {/if}
            </div>
            <div class='flex flex-col px-1.5 py-1.5'>
              {#each appState.layerStatistics.rows as item (item.key)}
                <div class='rounded-md px-1.5 py-1.5 hover:bg-white/[0.04]'>
                  <div class='flex items-center gap-2 text-[10px]'>
                    <span class='w-2 h-2 rounded-sm shrink-0' style:background-color={item.color}></span>
                    <span class='flex-1 min-w-0 break-words leading-tight text-obs-text-main'>{item.label}</span>
                    <span class='font-mono text-obs-text-muted tabular-nums'>{numberFormat.format(item.count)}</span>
                    <span class='font-mono text-obs-primary tabular-nums w-12 text-right'>{percentage(item.percentage)}</span>
                  </div>
                  <div class='ml-4 mt-1.5 h-1 rounded-full bg-white/[0.06] overflow-hidden'>
                    <div class='h-full rounded-full' style:background-color={item.color} style:width={`${item.count > 0 ? Math.max(item.percentage, 0.3) : 0}%`}></div>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <div class='py-4 text-center text-[10px] text-obs-text-dim'>世界生成完成后显示统计</div>
          {/if}
        </div>
        </div>
      {/if}
    </div>
  </aside>
{/if}
