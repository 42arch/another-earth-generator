<script lang='ts'>
  import type { ClimateParameters, GeologyParameters, HydrologyParameters, LandformParameters, TerrainParameters } from '@another-earth/world-core'
  import { TEMPERATURE_OFFSET_MAX_C, TEMPERATURE_OFFSET_MIN_C } from '@another-earth/world-core'
  import { CircleQuestionMark, Play, SlidersHorizontal, X } from '@lucide/svelte'
  import Tabs from '@/ui/components/Tabs.svelte'
  import Slider from '@/ui/components/Slider.svelte'
  import Tooltip from '@/ui/components/Tooltip.svelte'

  type Mutable<T> = { -readonly [K in keyof T]: T[K] }

  interface Props {
    open: boolean
    busy: boolean
    onClose: () => void
    onGenerate: () => void
    onForceRegenerate: () => void
    onChooseLevel: () => void
    hasGenerated: boolean
    level: number
    seed: string
    irregularity: number
    geologyParameters: Mutable<GeologyParameters>
    terrainParameters: Mutable<TerrainParameters>
    landformParameters: Mutable<LandformParameters>
    climateParameters: Mutable<ClimateParameters>
    hydrologyParameters: Mutable<HydrologyParameters>
  }

  let {
    open,
    busy,
    onClose,
    onGenerate,
    onForceRegenerate,
    onChooseLevel,
    hasGenerated,
    level = $bindable(),
    seed = $bindable(),
    irregularity = $bindable(),
    geologyParameters = $bindable(),
    terrainParameters = $bindable(),
    landformParameters = $bindable(),
    climateParameters = $bindable(),
    hydrologyParameters = $bindable(),
  }: Props = $props()

  type ParameterTab = 'nature' | 'civilization'
  let activeTab = $state<ParameterTab>('nature')
  const parameterTabs = [
    { value: 'nature' as const, label: '自然' },
    { value: 'civilization' as const, label: '文明' },
  ]
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
</script>

{#if open}
  <aside
    class='pointer-events-auto fixed top-4 bottom-4 left-[calc(var(--app-sidebar-inset)+var(--app-sidebar-width)+0.75rem)] z-40 flex w-[340px] max-w-[calc(100vw-var(--app-sidebar-width)-2rem)] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1e1e20]/85 text-obs-text-main shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md'
    aria-label='参数设置'
  >
    <header class='flex items-center justify-between px-4 py-2 border-b border-white/8'>
      <div class='flex items-center gap-2'>
        <SlidersHorizontal class='w-4 h-4 text-obs-primary' />
        <div class='flex flex-col'>
          <h2 class='font-sans text-[13px] font-bold tracking-wide text-obs-text-main m-0 leading-none pt-[2px]'>参数设置</h2>
        </div>
      </div>
      <button type='button' onclick={onClose} class='text-obs-text-dim hover:text-obs-text-main p-1 rounded-md hover:bg-white/6 transition-colors cursor-pointer' title='关闭参数面板' aria-label='关闭参数面板'>
        <X class='w-4 h-4' />
      </button>
    </header>

    <section class='shrink-0 px-4 pt-3'>
      <div class='flex items-center gap-2 mb-1'>
        <span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>全局参数</span>
        <div class='flex-1 h-px bg-white/5'></div>
      </div>
      <div class='flex flex-col gap-2'>
        <Slider label='细分等级' description='控制球面网格的细分程度；等级越高，区域数量以及内存和显存占用越大。' bind:value={level} min={4} max={8} step={1} decimals={0} formatValue={value => `L${value}`} onchange={onChooseLevel} />
        <label class='flex flex-col gap-1 py-1 text-obs-text-main'>
          <span class='flex items-center gap-1.5 font-sans text-[11px] text-obs-text-muted'>
            随机种子
            <Tooltip content='决定生成随机序列；相同种子、参数和算法版本可复现相同结果。' delayDuration={100}>
              <span class='cursor-help text-obs-text-dim transition-colors hover:text-white'><CircleQuestionMark class='h-3 w-3' /></span>
            </Tooltip>
          </span>
          <input
            aria-label='随机种子'
            class='w-full rounded-md border border-white/10 bg-white/4 px-2.5 py-1.5 font-mono text-xs text-obs-text-main outline-none transition-all focus:border-obs-primary/60 focus:ring-1 focus:ring-obs-primary/30'
            type='text'
            bind:value={seed}
            onkeydown={(event) => {
              if (event.key === 'Enter')
                onGenerate()
            }}
          />
        </label>
      </div>
    </section>

    <Tabs bind:value={activeTab} items={parameterTabs} ariaLabel='参数类别' class='min-h-0'>
      {#snippet content(tab)}
        {#if tab === 'nature'}
          <div class='flex flex-col gap-4'>
            <section class='flex flex-col gap-2' aria-label='网格参数'>
              <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>球面网格</span><div class='flex-1 h-px bg-white/5'></div></div>
              <Slider label='网格规整度' description='控制球面采样点的位置扰动；数值越高，网格形状越不规则。' bind:value={irregularity} min={0} max={1} step={0.05} decimals={2} />
            </section>

            <section class='flex flex-col gap-2 border-t border-white/6 pt-3' aria-label='地质参数'>
              <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>构造与地质</span><div class='flex-1 h-px bg-white/5'></div></div>
              <Slider label='主板块数' description='主要运动板块的生成目标数；板块形状和可分区域会影响最终数量。' bind:value={geologyParameters.primaryPlateCount} min={2} max={100} step={1} decimals={0} />
              <Slider label='微板块目标数' description='在主要板块边界附近生成的微板块目标数；符合边界与连通条件的数量可能更少。' bind:value={geologyParameters.microPlateCount} min={0} max={100 - geologyParameters.primaryPlateCount} step={1} decimals={0} />
              <Slider label='板块面积差异' description='控制板块目标面积的差异程度；数值较高时，大板块和小板块的面积差距会增大。' bind:value={geologyParameters.plateSizeVariety} min={0} max={1} step={0.05} decimals={2} />
              <Slider label='候选大陆目标数' description='生成候选大陆区域的目标数量；受板块连通和面积约束，结果可能少于目标。' bind:value={geologyParameters.continentCount} min={1} max={100} step={1} decimals={0} />
              <Slider label='候选陆地目标比例' description='候选大陆所覆盖的球面面积比例。最终海岸线由高程和海平面共同决定，可能与候选范围不同。' bind:value={geologyParameters.candidateLandCoverage} min={0} max={1} step={0.05} decimals={2} formatValue={value => `${Math.round(value * 100)}%`} />
              <Slider label='候选大陆面积差异' description='控制不同候选大陆的目标面积差距；数值较高时，更容易形成大小悬殊的大陆。' bind:value={geologyParameters.continentSizeVariety} min={0} max={1} step={0.05} decimals={2} />
            </section>

            <section class='flex flex-col gap-2 border-t border-white/6 pt-3' aria-label='地形参数'>
              <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>地形与岛屿</span><div class='flex-1 h-px bg-white/5'></div></div>
              <Slider label='岛弧目标数' description='海洋俯冲带岛弧源点的数量上限；受合适的板块边界约束，不代表最终独立岛屿数。' bind:value={landformParameters.islandArcCount} min={0} max={100} step={1} decimals={0} />
              <Slider label='岛屿密度' description='调节岛弧地形片段和近岸小岛的生成倾向、影响范围与起伏；不直接指定最终岛屿数量。' bind:value={landformParameters.islandDensity} min={0} max={1} step={0.05} decimals={2} />
              <Slider label='热点目标数' description='地幔热点链的生成目标数；受可用热点位置和间距约束，最终数量可能更少。' bind:value={landformParameters.hotspotCount} min={0} max={100} step={1} decimals={0} />
              {#each terrainControls as parameter}
                <Slider label={parameter.label} description={parameter.description} bind:value={terrainParameters[parameter.key]} min={0} max={parameter.max} step={0.05} decimals={2} />
              {/each}
            </section>

            <section class='flex flex-col gap-2 border-t border-white/6 pt-3' aria-label='气候参数'>
              <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>气候与环境</span><div class='flex-1 h-px bg-white/5'></div></div>
              <Slider label='轴倾角（°）' description='控制行星自转轴相对公转平面的倾斜程度，影响季节温差和降水的季节分布。' bind:value={climateParameters.axialTiltDegrees} min={0} max={45} step={0.1} decimals={1} />
              <Slider label='公转周期（地球日）' description='控制一年的长度，决定气候季节循环的时间尺度。' bind:value={climateParameters.orbitalPeriodDays} min={300} max={430} step={0.25} decimals={2} />
              <Slider label='温度偏移（°C）' description='整体平移月气温。负端到 −40°C，热带海面降到海水冰点以下；正端到 +60°C，热带顶到月温上限，高海拔的最暖月也能升过冰点。' bind:value={climateParameters.temperatureOffsetC} min={TEMPERATURE_OFFSET_MIN_C} max={TEMPERATURE_OFFSET_MAX_C} step={0.5} decimals={1} />
              <Slider label='降水倍率' description='按比例调整模型降水；数值越高，整体降水越多。' bind:value={climateParameters.precipitationScale} min={0} max={3} step={0.1} decimals={1} />
            </section>

            <section class='flex flex-col gap-2 border-t border-white/6 pt-3' aria-label='水文参数'>
              <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>冰雪与水文</span><div class='flex-1 h-px bg-white/5'></div></div>
              <Slider label='融雪系数（mm / °C / 月）' description='温度每高于融雪阈值 1°C 时，每月融化的雪水当量；属于简化温度指数模型。' bind:value={hydrologyParameters.degreeDayMeltFactorMmPerCMonth} min={0} max={100} step={0.5} decimals={1} />
              <Slider label='蒸散温度系数（mm / °C / 月）' description='温度升高时蒸散需求增加的幅度；属于温度指数近似，不是完整蒸散模型。' bind:value={hydrologyParameters.evapotranspirationFactorMmPerCMonth} min={0} max={100} step={0.5} decimals={1} />
              <div class='flex items-center gap-2 border-t border-white/6 pt-2'><span class='font-sans text-[10px] uppercase tracking-wide text-obs-text-muted font-bold'>河流与湖泊</span><div class='flex-1 h-px bg-white/5'></div></div>
              <Slider label='河网密度倍率' description='倍率越低，汇水面积门槛越高、河道越少；默认 0.5，门槛为原默认值的两倍。受气候产流和地形汇流共同限制。' bind:value={hydrologyParameters.riverDensityMultiplier} min={0.25} max={2} step={0.05} decimals={2} />
              <Slider label='基准汇水面积' description='河道阈值取本值与 16 倍平均网格面积中的较大值，再由河网密度倍率缩放。面积采用对数刻度，范围 0–10,000,000 km²；基准越高通常河道越少。' bind:value={hydrologyParameters.minimumRiverDrainageAreaKm2} min={0} max={hydrologyAreaSliderMax} step={0.01} decimals={0} unit=' km²' toSlider={hydrologyAreaToSlider} fromSlider={hydrologyAreaFromSlider} formatValue={formatAreaKm2} />
              <Slider label='最小湖泊面积' description='在气候筛选之后，再去掉面积小于该值的湖。平均水深不足 1 m 的填洼薄膜不会成湖。0 表示面积上只保留至少两个网格区域的湖盆。面积采用对数刻度，范围 0–10,000,000 km²。' bind:value={hydrologyParameters.minimumLakeAreaKm2} min={0} max={hydrologyAreaSliderMax} step={0.01} decimals={0} unit=' km²' toSlider={hydrologyAreaToSlider} fromSlider={hydrologyAreaFromSlider} formatValue={formatAreaKm2} />
            </section>

            {#if level >= 6}<p class='rounded-md border border-obs-primary/10 bg-obs-primary/4 p-2 text-[10px] leading-relaxed text-obs-text-dim'>高等级网格包含大量区域，显存和内存占用较高。</p>{/if}
            {#if hasGenerated}
              <section class='border-t border-white/6 pt-3' aria-label='生成操作'>
                <button type='button' class='w-full rounded-md border border-white/8 bg-white/4 px-3 py-1.5 text-[11px] text-obs-text-muted transition-colors hover:bg-white/8 hover:text-white disabled:opacity-40' onclick={onForceRegenerate} disabled={busy}>强制重算</button>
              </section>
            {/if}
          </div>
        {:else}
          <div class='flex flex-col gap-3'>
            <div class='flex items-center gap-2'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>人口与聚落</span><div class='flex-1 h-px bg-white/5'></div></div>
            <div class='rounded-lg border border-white/6 bg-white/2 p-3 text-[11px] leading-relaxed text-obs-text-dim'>文明生成将在 M2 阶段接入。当前 M3 制图系统专注于完整自然世界快照的 3D 星球与 2D 地图集渲染。</div>
            <div class='flex flex-col gap-2 opacity-35' aria-disabled='true'>
              <div class='flex items-center justify-between py-1 text-[11px] text-obs-text-muted'><span>人口规模</span><span>待 M2 接入</span></div>
              <div class='h-1 rounded-full bg-white/8'></div>
              <div class='flex items-center justify-between py-1 text-[11px] text-obs-text-muted'><span>聚落密度</span><span>待 M2 接入</span></div>
              <div class='h-1 rounded-full bg-white/8'></div>
              <div class='flex items-center justify-between py-1 text-[11px] text-obs-text-muted'><span>道路连通度</span><span>待 M2 接入</span></div>
              <div class='h-1 rounded-full bg-white/8'></div>
            </div>
          </div>
        {/if}
      {/snippet}
    </Tabs>

    <footer class='flex items-center justify-between px-4 py-2 border-t border-white/6 bg-black/10'>
      <span class='text-[10px] text-obs-text-dim'>{busy ? '生成进行中…' : '调整参数后手动执行'}</span>
      <button type='button' class='flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold tracking-wider text-obs-primary border border-obs-primary/40 rounded-md bg-obs-primary/15 hover:bg-obs-primary/25 hover:border-obs-primary/70 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed' onclick={onGenerate} disabled={busy}>
        <Play class='w-3 h-3 fill-current' />
        <span>{busy ? '生成中…' : '开始生成'}</span>
      </button>
    </footer>
  </aside>
{/if}
