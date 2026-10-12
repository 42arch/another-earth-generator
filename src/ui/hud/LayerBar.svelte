<script lang='ts'>
  import {
    Activity,
    Check,
    CloudRain,
    Compass,
    Copy,
    Globe,
    Layers,
    Map,
    MapPin,
    Mountain,
    Navigation,
    Sparkles,
    Tag,
    Thermometer,
    Waves,
    Wind,
    Workflow,
    X,
  } from '@lucide/svelte'
  import { fly } from 'svelte/transition'
  import { CARTOGRAPHIC_STYLES } from '@/core/rendering/styles/cartographic-styles'
  import { getMapStyleDocument } from '@/core/rendering/styles'
  import { hasLayerStatistics } from '@/core/world/layer-statistics'
  import Checkbox from '@/ui/components/Checkbox.svelte'
  import { formatLayerStatistics, getLayerStatisticColor } from '@/ui/hud/layer-presentation'
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

  // 地表底层物理场定义
  const SURFACE_FIELDS = [
    { id: 'default', name: '主题地表', icon: Map, desc: '跟随当前制图主题的默认地表着色' },
    { id: 'dem', name: '高程DEM', icon: Mountain, desc: '数字高程灰度模型' },
    { id: 'heightmap', name: '阶梯高度', icon: Mountain, desc: '经典多级等高阶梯调色' },
    { id: 'temperature', name: '月均气温', icon: Thermometer, desc: '地表月均温场连续色带' },
    { id: 'precipitation', name: '月降水', icon: CloudRain, desc: '月降水量分级色带' },
    { id: 'population', name: '人口密度', icon: Activity, desc: '人口空间对数分布密度' },
    { id: 'market-access', name: '市场潜力', icon: Compass, desc: '通达度与相对市场腹地潜力' },
    { id: 'geometric-flow', name: '几何汇流', icon: Workflow, desc: 'D8 汇流拓扑流域累积' },
    { id: 'wind', name: '盛行风', icon: Wind, desc: '三圈环流近地表风矢量场' },
    { id: 'ocean-current', name: '大洋环流', icon: Waves, desc: '风生大洋表层环流场' },
  ] as const

  // 专题区域多选填充
  const THEMATIC_FILLS = [
    { id: 'plates', name: '板块构造', desc: '独立运动板块分布（平滑面）', icon: Workflow },
    { id: 'continents', name: '大陆区划', desc: '自然构造大陆分区（平滑面）', icon: Globe },
    { id: 'koppen', name: '气候分类', desc: '柯本-盖革陆地区域（平滑面）', icon: Thermometer },
    { id: 'biome', name: '生物群系', desc: 'Whittaker 陆地生态群系（平滑面）', icon: Sparkles },
    { id: 'polities', name: '国家疆域', desc: '各政权主权控制范围', icon: Map },
    { id: 'ethnicity', name: '民族分布', desc: '优势民族人口分布区', icon: Globe },
    { id: 'languages', name: '语言区划', desc: '优势语言地理分布', icon: Tag },
    { id: 'religions', name: '宗教信仰', desc: '主流宗教与信仰分布', icon: Layers },
  ] as const

  // 要素图层分组
  const VECTOR_GROUPS = [
    {
      label: '水系与交通',
      items: [
        { id: 'rivers', name: '水系河流', icon: Waves },
        { id: 'routes', name: '道路与航线', icon: Navigation },
      ],
    },
    {
      label: '疆域与聚落',
      items: [
        { id: 'nation-borders', name: '国界线', icon: Map },
        { id: 'cities', name: '聚落中心', icon: MapPin },
        { id: 'sacred-sites', name: '宗教圣地', icon: Sparkles },
      ],
    },
    {
      label: '地名注记',
      items: [
        { id: 'nation-labels', name: '国家名称', icon: Tag },
        { id: 'ethnicity-labels', name: '民族名称', icon: Tag },
        { id: 'language-labels', name: '语言名称', icon: Tag },
        { id: 'religion-labels', name: '宗教名称', icon: Tag },
      ],
    },
  ] as const

  const heightmapOceanLegend = 'linear-gradient(to right, #061a33, #1a5f7a)'
  const heightmapLandLegend = 'linear-gradient(to right, #2d5a27, #c2b280, #ffffff)'
  const windStrengthLegend = $derived.by(() => {
    const tokens = getMapStyleDocument(appState.params.appearance.mapStyle).tokens
    const windColor = String(tokens.wind ?? '#A9FFF1')
    return `linear-gradient(to right, #0a131c, #1e5163, #38989b, ${windColor})`
  })
  const oceanCurrentSpeedLegend = $derived.by(() => {
    const tokens = getMapStyleDocument(appState.params.appearance.mapStyle).tokens
    const slow = String(tokens.oceanCurrentSpeedSlow ?? '#10355E')
    const fast = String(tokens.oceanCurrentSpeedFast ?? '#9ECAE1')
    return `linear-gradient(to right, #040a14, ${slow}, #2f84ba, ${fast})`
  })
  const oceanCurrentThermalLegend = $derived.by(() => {
    const tokens = getMapStyleDocument(appState.params.appearance.mapStyle).tokens
    const cold = String(tokens.oceanCurrentCold ?? '#2166AC')
    const neutral = String(tokens.oceanCurrentNeutral ?? '#F7F7F7')
    const warm = String(tokens.oceanCurrentWarm ?? '#B2182B')
    return `linear-gradient(to right, ${cold}, ${neutral}, ${warm})`
  })

  const monthNames = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月']

  // 当前有效底图模式识别
  const activeSurfaceMode = $derived.by(() => {
    const raw = appState.params.appearance.surfaceField ?? 'default'
    if (raw !== 'default')
      return raw
    if (appState.params.appearance.mapStyle === 'satellite')
      return 'satellite'
    return appState.params.appearance.baseMap
  })
</script>

{#if appState.layerDrawerOpen}
  <aside
    transition:fly={{ x: 320, duration: 220 }}
    class='pointer-events-auto fixed right-4 top-16 bottom-20 z-40 w-[23.5rem] max-w-[calc(100vw-32px)] bg-[#1a1b1e]/90 backdrop-blur-xl border border-white/[0.12] rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.6)] flex flex-col text-obs-text-main overflow-hidden'
  >
    <!-- 面板顶栏 -->
    <header class='flex items-center justify-between px-4 py-3 border-b border-white/[0.08] select-none bg-white/[0.02]'>
      <div class='flex items-center gap-2'>
        <div class='p-1.5 rounded-lg bg-obs-primary/15 text-obs-primary border border-obs-primary/20'>
          <Layers class='w-4 h-4' />
        </div>
        <div>
          <h2 class='font-heading text-xs font-bold tracking-wider uppercase text-obs-text-main m-0 leading-tight'>
            地图与地理图层
          </h2>
          <span class='text-[10px] text-obs-text-dim leading-none'>分层控制与正交专题分析</span>
        </div>
      </div>

      <button
        type='button'
        onclick={() => appState.layerDrawerOpen = false}
        class='text-obs-text-dim hover:text-obs-text-main p-1.5 rounded-lg hover:bg-white/[0.08] transition-colors cursor-pointer'
        title='关闭图层面板'
      >
        <X class='w-4 h-4' />
      </button>
    </header>

    <!-- 滚动内容容器 -->
    <div class='flex-1 overflow-y-auto p-3.5 flex flex-col gap-4 custom-scrollbar text-xs'>
      <!-- 1. 顶栏：制图风格（Theme & Style） -->
      <section class='flex flex-col gap-1.5'>
        <div class='flex items-center justify-between px-0.5'>
          <span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>1. 制图主题风格</span>
          <span class='text-[10px] text-obs-text-dim font-mono'>MapStyle</span>
        </div>
        <div class='grid grid-cols-4 gap-1.5'>
          {#each Object.values(CARTOGRAPHIC_STYLES) as style}
            {@const isActive = appState.params.appearance.mapStyle === style.id}
            <button
              type='button'
              onclick={() => appState.setMapStyle(style.id)}
              aria-pressed={isActive}
              title={style.description}
              class="flex flex-col items-center justify-center gap-1 rounded-xl border p-2 transition-all cursor-pointer {isActive ? 'border-obs-primary/60 bg-obs-primary/20 text-obs-primary shadow-sm shadow-obs-primary/20 font-semibold' : 'border-white/[0.08] bg-white/[0.02] text-obs-text-muted hover:bg-white/[0.06] hover:text-obs-text-main'}"
            >
              <span class='h-3.5 w-3.5 rounded-full border border-black/30 shadow-inner' style:background-color={style.swatch}></span>
              <span class='text-[11px] leading-none'>{style.name}</span>
            </button>
          {/each}
        </div>
      </section>

      <!-- 2. 第一区：底层地表（Surface Field） -->
      <section class='flex flex-col gap-2 pt-2 border-t border-white/[0.06]'>
        <div class='flex items-center justify-between px-0.5'>
          <span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>2. 底层地表（单选）</span>
          <span class='text-[10px] text-obs-text-dim font-mono'>Surface Field</span>
        </div>
        <div class='grid grid-cols-4 gap-1'>
          {#each SURFACE_FIELDS as field}
            {@const isSelected = activeSurfaceMode === field.id || (field.id === 'default' && (activeSurfaceMode === 'cartographic' || activeSurfaceMode === 'satellite'))}
            {@const Icon = field.icon}
            <button
              type='button'
              onclick={() => appState.setSurfaceField(field.id)}
              title={field.desc}
              class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all text-left cursor-pointer border {isSelected ? 'bg-obs-primary/20 text-obs-primary border-obs-primary/50 font-semibold' : 'text-obs-text-muted hover:text-obs-text-main hover:bg-white/[0.04] border-transparent'}"
            >
              <Icon class="w-3.5 h-3.5 shrink-0 {isSelected ? 'text-obs-primary' : 'opacity-70'}" />
              <span class='leading-none text-[11px] truncate'>{field.name}</span>
            </button>
          {/each}
        </div>

        <!-- 气候月份选择 -->
        {#if ['temperature', 'precipitation', 'wind', 'ocean-current'].includes(activeSurfaceMode)}
          <div class='flex items-center justify-between px-2 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04]'>
            <span class='text-[11px] text-obs-text-muted'>显示月份（季节水热强迫）</span>
            <select
              class='rounded-lg border border-white/[0.12] bg-[#141517] px-2 py-1 text-obs-text-main text-[11px] outline-none cursor-pointer'
              value={appState.params.appearance.climateMonth}
              onchange={event => appState.updateParam('appearance', 'climateMonth', Number(event.currentTarget.value))}
            >
              {#each monthNames as name, index}
                <option value={index}>{name}</option>
              {/each}
            </select>
          </div>
        {/if}
      </section>

      <!-- 3. 第二区：专题区域（Thematic Fills） -->
      <section class='flex flex-col gap-2 pt-2 border-t border-white/[0.06]'>
        <div class='flex items-center justify-between px-0.5'>
          <div class='flex items-center gap-1'>
            <span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>3. 专题面（多选叠加）</span>
            <span class='text-[9px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-obs-text-dim'>独立图层</span>
          </div>
          <span class='text-[10px] text-obs-text-dim font-mono'>Thematic Fills</span>
        </div>
        <div class='grid grid-cols-2 gap-1.5'>
          {#each THEMATIC_FILLS as thematic}
            {@const isChecked = Boolean(appState.params.appearance.thematicFills?.[thematic.id]) || activeSurfaceMode === thematic.id}
            {@const Icon = thematic.icon}
            <div
              class="flex items-center justify-between px-2.5 py-1.5 rounded-xl border transition-colors {isChecked ? 'border-obs-primary/30 bg-obs-primary/10' : 'border-white/[0.06] bg-white/[0.02]'}"
              title={thematic.desc}
            >
              <span class="flex items-center gap-1.5 text-[11px] {isChecked ? 'text-obs-primary font-medium' : 'text-obs-text-muted'}"><Icon class='w-3 h-3' />{thematic.name}</span>
              <Checkbox
                label=''
                checked={isChecked}
                onchange={() => appState.toggleThematicFill(thematic.id)}
              />
            </div>
          {/each}
        </div>
      </section>

      <!-- 4. 第三区：要素图层（Vector & Annotations） -->
      <section class='flex flex-col gap-2 pt-2 border-t border-white/[0.06]'>
        <div class='flex items-center justify-between px-0.5'>
          <span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>4. 矢量要素与注记</span>
          <span class='text-[10px] text-obs-text-dim font-mono'>Vectors</span>
        </div>
        <div class='flex flex-col gap-2'>
          {#each VECTOR_GROUPS as group}
            <div class='flex flex-col gap-1 px-1'>
              <span class='text-[9px] font-medium text-obs-text-dim/60'>{group.label}</span>
              <div class='grid grid-cols-2 gap-1.5'>
                {#each group.items as item}
                  {@const Icon = item.icon}
                  <div class='flex items-center justify-between px-2 py-1 rounded-lg bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.05] transition-colors'>
                    <div class='flex items-center gap-1.5'>
                      <Icon class='w-3 h-3 text-obs-text-dim' />
                      <span class='text-[11px] text-obs-text-main'>{item.name}</span>
                    </div>
                    <Checkbox
                      label=''
                      checked={Boolean(appState.params.appearance.overlays[item.id])}
                      onchange={() => appState.toggleOverlay(item.id)}
                    />
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </section>

      <!-- 5. 第四区：环境与物理辅助（Environment & Aux） -->
      <section class='flex flex-col gap-2 pt-2 border-t border-white/[0.06]'>
        <div class='flex items-center justify-between px-0.5'>
          <span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>5. 环境与辅助</span>
          <span class='text-[10px] text-obs-text-dim font-mono'>Environment</span>
        </div>
        <div class='grid grid-cols-2 gap-1.5 px-1'>
          <div class='flex items-center justify-between px-2 py-1 rounded-lg bg-white/[0.02] border border-white/[0.04]'>
            <span class='text-[11px] text-obs-text-main'>大气圈微光</span>
            <Checkbox
              label=''
              checked={Boolean(appState.params.appearance.overlays.atmosphere)}
              onchange={() => appState.toggleOverlay('atmosphere')}
            />
          </div>
          <div class='flex items-center justify-between px-2 py-1 rounded-lg bg-white/[0.02] border border-white/[0.04]'>
            <span class='text-[11px] text-obs-text-main'>动态云层</span>
            <Checkbox
              label=''
              checked={Boolean(appState.params.appearance.overlays.clouds)}
              onchange={() => appState.toggleOverlay('clouds')}
            />
          </div>
          <div class='flex items-center justify-between px-2 py-1 rounded-lg bg-white/[0.02] border border-white/[0.04]'>
            <span class='text-[11px] text-obs-text-main'>昼夜光照分界</span>
            <Checkbox
              label=''
              checked={Boolean(appState.params.appearance.overlays['day-night'])}
              onchange={() => appState.toggleOverlay('day-night')}
            />
          </div>
          <div class='flex items-center justify-between px-2 py-1 rounded-lg bg-white/[0.02] border border-white/[0.04]'>
            <span class='text-[11px] text-obs-text-main'>经纬网格</span>
            <Checkbox
              label=''
              checked={Boolean(appState.params.appearance.overlays.graticule)}
              onchange={() => appState.toggleOverlay('graticule')}
            />
          </div>
          <div class='flex items-center justify-between px-2 py-1 rounded-lg bg-white/[0.02] border border-white/[0.04]'>
            <span class='text-[11px] text-obs-text-main'>球面网格线框</span>
            <Checkbox
              label=''
              checked={Boolean(appState.params.appearance.overlays.wireframe)}
              onchange={() => appState.toggleOverlay('wireframe')}
            />
          </div>
          <div class='flex items-center justify-between px-2 py-1 rounded-lg bg-white/[0.02] border border-white/[0.04]'>
            <span class='text-[11px] text-obs-text-main'>真实高程起伏</span>
            <Checkbox
              label=''
              checked={Boolean(appState.params.appearance.elevationDisplacement)}
              onchange={() => appState.toggleLayer('elevationDisplacement')}
            />
          </div>
        </div>
      </section>

      <!-- 6. 图例说明 & 物理统计 -->
      <section class='flex flex-col gap-2 pt-2 border-t border-white/[0.06]'>
        <div class='flex items-center justify-between px-0.5'>
          <span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>图例说明</span>
          <span class='text-[10px] text-obs-text-dim font-mono'>{activeSurfaceMode}</span>
        </div>

        {#if activeSurfaceMode === 'satellite'}
          <div class='flex flex-col gap-1.5 px-1 text-[10px] text-obs-text-dim'>
            <div class='flex items-center gap-2'><span>干旱</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#b9a27a] via-[#8e8851] to-[#315b2b]'></i><span>湿润植被</span></div>
            <div class='flex items-center gap-2'><span>低地森林</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#3b6230] via-[#777565] to-[#d5e0e5]'></i><span>高山雪线</span></div>
          </div>
        {:else if activeSurfaceMode === 'dem'}
          <div class='flex items-center gap-2 px-1 text-[10px] text-obs-text-dim'>
            <span>海平面(0m)</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-black to-white border border-white/20'></i><span>珠峰(8848m)</span>
          </div>
        {:else if activeSurfaceMode === 'heightmap'}
          <div class='flex flex-col gap-1.5 px-1 text-[10px] text-obs-text-dim'>
            <div class='flex items-center gap-2'><span>深海</span><i class='h-1.5 flex-1 rounded-full border border-white/20' style={`background: ${heightmapOceanLegend}`}></i><span>浅海</span></div>
            <div class='flex items-center gap-2'><span>沿海平原</span><i class='h-1.5 flex-1 rounded-full border border-white/20' style={`background: ${heightmapLandLegend}`}></i><span>高原山脉</span></div>
          </div>
        {:else if activeSurfaceMode === 'temperature'}
          <div class='flex items-center gap-2 px-1 text-[10px] text-obs-text-dim'>
            <span>−30°C</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#2e52b8] via-[#e0eddb] to-[#dc451f]'></i><span>40°C</span>
          </div>
        {:else if activeSurfaceMode === 'precipitation'}
          <div class='flex items-center gap-2 px-1 text-[10px] text-obs-text-dim'>
            <span>0 mm</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#cca66b] via-[#57ad7d] to-[#144092]'></i><span>600+ mm</span>
          </div>
        {:else if activeSurfaceMode === 'wind'}
          <div class='flex items-center gap-2 px-1 text-[10px] text-obs-text-dim'>
            <span>微风</span><i class='h-1.5 flex-1 rounded-full border border-white/20' style={`background: ${windStrengthLegend}`}></i><span>强气流</span>
          </div>
        {:else if activeSurfaceMode === 'ocean-current'}
          <div class='flex items-center gap-2 px-1 text-[10px] text-obs-text-dim'>
            <span>寒流</span><i class='h-1.5 flex-1 rounded-full border border-white/20' style={`background: ${oceanCurrentThermalLegend}`}></i><span>暖流</span>
          </div>
          <div class='flex items-center gap-2 px-1 text-[10px] text-obs-text-dim'>
            <span>缓流</span><i class='h-1.5 flex-1 rounded-full border border-white/20' style={`background: ${oceanCurrentSpeedLegend}`}></i><span>急流</span>
          </div>
        {:else if activeSurfaceMode === 'population'}
          <div class='flex items-center gap-2 px-1 text-[10px] text-obs-text-dim'>
            <span>稀疏</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#2e3b31] via-[#dcb040] to-[#f54a2b]'></i><span>高密度</span>
          </div>
          <div class='px-1 text-[10px] text-obs-text-dim'>模型总人口 {numberFormat.format(Math.round(appState.worldSummary.totalPopulation))} · 聚落 {numberFormat.format(appState.worldSummary.settlementCount)} 处</div>
        {:else if activeSurfaceMode === 'market-access'}
          <div class='flex items-center gap-2 px-1 text-[10px] text-obs-text-dim'>
            <span>交通阻隔</span><i class='h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#292e38] via-[#479494] to-[#f7c24f]'></i><span>贸易枢纽</span>
          </div>
          <div class='px-1 text-[10px] text-obs-text-dim'>陆路 {numberFormat.format(appState.worldSummary.roadCount)} 条 · 航线 {numberFormat.format(appState.worldSummary.seaRouteCount)} 条</div>
        {:else}
          <div class='px-1 text-[10px] text-obs-text-dim leading-relaxed'>
            遵循地球物理与气候地理自洽演化，通过 Map Style 声明表达式渲染。
          </div>
        {/if}

        <!-- 专题统计信息卡片 -->
        {#if hasLayerStatistics(appState.params.appearance.baseMap)}
          <div class='flex flex-col gap-1.5 mt-1'>
            <div class='flex items-center justify-between'>
              <span class='text-[10px] uppercase tracking-wider text-obs-text-dim font-medium'>当前要素分布统计</span>
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

            <div class='flex flex-col bg-black/30 rounded-xl border border-white/[0.06] overflow-hidden'>
              {#if appState.layerStatistics}
                <div class='px-3 py-2 border-b border-white/[0.04] bg-white/[0.01]'>
                  <div class='text-[11px] font-semibold text-obs-text-main'>{appState.layerStatistics.title}</div>
                  <div class='mt-0.5 text-[10px] text-obs-text-dim'>
                    {#if appState.layerStatistics.measure === 'people'}
                      占模型总人口 {numberFormat.format(Math.round(appState.layerStatistics.totalPopulation ?? 0))} 人
                    {:else}
                      占全部 {numberFormat.format(appState.layerStatistics.totalCells)} 单元
                    {/if}
                  </div>
                  {#if appState.layerStatistics.description}
                    <p class='mt-1.5 text-[10px] leading-relaxed text-obs-text-dim'>{appState.layerStatistics.description}</p>
                  {/if}
                </div>
                <div class='flex flex-col px-1.5 py-1.5'>
                  {#each appState.layerStatistics.rows as item (item.key)}
                    {@const color = getLayerStatisticColor(appState.layerStatistics.mode, item, appState.params.appearance.mapStyle)}
                    <div class='rounded-lg px-2 py-1.5 hover:bg-white/[0.04] transition-colors'>
                      <div class='flex items-center gap-2 text-[10px]'>
                        <span class='w-2 h-2 rounded-full shrink-0 shadow-sm' style:background-color={color}></span>
                        <span class='flex-1 min-w-0 break-words leading-tight text-obs-text-main'>{item.label}</span>
                        <span class='font-mono text-obs-text-muted tabular-nums'>{numberFormat.format(appState.layerStatistics.measure === 'people' ? Math.round(item.count) : item.count)}</span>
                        <span class='font-mono text-obs-primary tabular-nums w-12 text-right'>{percentage(item.percentage)}</span>
                      </div>
                      {#if item.areaKm2 !== undefined}<div class='ml-4 text-[9px] text-obs-text-dim'>面积 {numberFormat.format(Math.round(item.areaKm2))} km²</div>{/if}
                      <div class='ml-4 mt-1.5 h-1 rounded-full bg-white/[0.06] overflow-hidden'>
                        <div class='h-full rounded-full transition-all' style:background-color={color} style:width={`${item.count > 0 ? Math.max(item.percentage, 0.3) : 0}%`}></div>
                      </div>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class='py-4 text-center text-[10px] text-obs-text-dim'>世界生成完成后显示详细统计</div>
              {/if}
            </div>
          </div>
        {/if}
      </section>
    </div>
  </aside>
{/if}
