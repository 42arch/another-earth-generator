<script lang='ts'>
  import type { StagePlan } from '@another-earth/world-core'
  import { Gauge, X } from '@lucide/svelte'
  import Toggle from '@/ui/components/Toggle.svelte'

  interface WorldSummary {
    readonly plateCount: number
    readonly landCoveragePercent: number
    readonly minElevationKm: number
    readonly maxElevationKm: number
    readonly continentCount: number
    readonly oceanCount: number
    readonly seaCount: number
    readonly basinCount: number
    readonly riverCount: number
    readonly riverCoveragePercent: number
    readonly lakeCount: number
    readonly totalLakeAreaKm2: number
    readonly medianLakeAreaKm2: number | null
    readonly hasResources: boolean
    readonly hasCivilization: boolean
    readonly depositCount: number
    readonly totalPopulation: number
    readonly settlementCount: number
    readonly polityCount: number
    readonly cultureCount: number
    readonly peopleCount: number
    readonly religionCount: number
    readonly transportRouteCount: number
  }

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

  interface GpuResourceCounts {
    readonly geometries: number
    readonly materials: number
    readonly textures: number
  }

  interface Props {
    open: boolean
    onClose: () => void
    worldSummary: WorldSummary | undefined
    stages: readonly StagePlan[]
    stats: WorldPerformanceStats | null
    gpuCounts: GpuResourceCounts
  }

  const { open, onClose, worldSummary, stages, stats, gpuCounts }: Props = $props()
  let debugInfoVisible = $state(false)
</script>

{#if open}
  <aside
    class='pointer-events-auto fixed top-4 bottom-4 left-[calc(var(--app-sidebar-inset)+var(--app-sidebar-width)+0.75rem)] z-40 flex w-[340px] max-w-[calc(100vw-var(--app-sidebar-inset)-var(--app-sidebar-width)-2rem)] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1e1e20]/85 text-obs-text-main shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md'
    aria-label='概览'
  >
    <header class='flex items-center justify-between border-b border-white/6 px-4 py-2'>
      <div class='flex items-center gap-2'><Gauge class='h-4 w-4 text-obs-primary' /><h2 class='m-0 pt-[2px] font-heading text-[13px] font-bold tracking-wide'>概览</h2></div>
      <button type='button' onclick={onClose} class='rounded-md p-1 text-obs-text-dim transition-colors hover:bg-white/6 hover:text-obs-text-main' title='关闭概览面板' aria-label='关闭概览面板'><X class='h-4 w-4' /></button>
    </header>
    <div class='custom-scrollbar flex-1 overflow-y-auto p-3.5 text-xs'>
      <div class='flex flex-col gap-3'>
        <Toggle
          label='开发调试信息'
          description='显示生成管线与网格、制图性能数据。'
          checked={debugInfoVisible}
          oncommit={value => debugInfoVisible = value}
        />
        {#if !worldSummary && stages.length === 0 && !stats}
          <p class='rounded-lg border border-white/6 bg-white/2 p-3 text-[11px] leading-relaxed text-obs-text-dim'>生成完成后，这里显示行星自然概览；开启开发调试信息后可查看生成管线和网格性能。</p>
        {/if}
        {#if worldSummary}
          <section class='flex flex-col gap-2 text-[10px]' aria-label='行星自然统计'>
            <div class='flex items-center justify-between'><span class='font-bold tracking-wider uppercase text-obs-primary/90'>行星自然概览</span></div>
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
          {#if worldSummary.hasResources || worldSummary.hasCivilization}
            <section class='flex flex-col gap-2 border-t border-white/6 pt-2.5 text-[10px]' aria-label='资源与初始文明概览'>
              <div class='flex items-center justify-between'><span class='font-bold tracking-wider uppercase text-obs-primary/90'>资源与初始文明</span></div>
              <dl class='grid grid-cols-2 gap-y-1.5'>
                {#if worldSummary.hasResources}
                  <dt>资源矿点数</dt><dd>{worldSummary.depositCount.toLocaleString()}</dd>
                {/if}
                {#if worldSummary.hasCivilization}
                  <dt>全球总人口</dt><dd>{Math.round(worldSummary.totalPopulation).toLocaleString()}</dd>
                  <dt>聚落数</dt><dd>{worldSummary.settlementCount.toLocaleString()}</dd>
                  <dt>国家政体数</dt><dd>{worldSummary.polityCount.toLocaleString()}</dd>
                  <dt>族群 / 文化 / 宗教</dt><dd>{worldSummary.peopleCount} / {worldSummary.cultureCount} / {worldSummary.religionCount}</dd>
                  <dt>交通航路数</dt><dd>{worldSummary.transportRouteCount.toLocaleString()}</dd>
                {:else}
                  <dt>初始文明</dt><dd class='text-obs-text-dim'>已跳过（仅自然与资源）</dd>
                {/if}
              </dl>
            </section>
          {/if}
        {/if}
        {#if debugInfoVisible && stats}
          <section class='flex flex-col gap-2 border-t border-white/6 pt-2.5 text-[10px] text-obs-text-dim' aria-label='网格与性能统计'>
            <div class='flex items-center justify-between'><span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>网格与制图性能</span></div>
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
        {#if debugInfoVisible && stages.length}
          <section class='flex flex-col gap-2 border-t border-white/6 pt-2.5 text-[10px]' aria-label='阶段缓存'>
            <div class='flex items-center justify-between'><span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>生成管线</span></div>
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
      </div>
    </div>
  </aside>
{/if}
