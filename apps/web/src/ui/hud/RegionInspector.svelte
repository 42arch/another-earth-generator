<script lang='ts'>
  import type { GenerationController } from '@/lib/generation/controller'
  import { KOPPEN_CLASS_LABELS_ZH } from '@another-earth/cartography'
  import { KOPPEN_CODES } from '@another-earth/world-core'
  import { NATURAL_BIOME_DEFINITIONS, NATURAL_LAND_COVER_DEFINITIONS } from '@another-earth/world-data'
  import { Satellite, X } from '@lucide/svelte'
  import { fly } from 'svelte/transition'
  import Badge from '@/ui/components/Badge.svelte'
  import { appState } from '@/ui/state/app.svelte'

  interface RegionInspection {
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
    readonly wind: { readonly east: number, readonly north: number } | null
    readonly ocean: { readonly east: number, readonly north: number, readonly warmth: number } | null
    readonly contributingAreaKm2: number
    readonly accumulatedFlowM3s: number
  }

  interface Props {
    open: boolean
    inspection: RegionInspection | null
  }

  const { open, inspection }: Props = $props()
  const compassDirections = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'] as const

  function formatCirculationVector(east: number, north: number, digits: number): string {
    const speedMps = Math.hypot(east, north)
    if (!Number.isFinite(speedMps))
      return '无数据'
    const speed = `${speedMps.toFixed(digits)} m/s`
    if (speedMps < 1e-4)
      return speed
    const sector = Math.round(Math.atan2(east, north) / (Math.PI / 4))
    return `${speed} · 向${compassDirections[(sector + 8) % 8]}`
  }
</script>

{#if open}
  <aside transition:fly={{ x: -300, duration: 200 }} class='pointer-events-auto fixed bottom-4 left-[calc(var(--app-sidebar-inset)+var(--app-sidebar-width)+0.75rem)] z-30 w-[340px] max-w-[calc(100vw-var(--app-sidebar-width)-2rem)] overflow-hidden rounded-xl border border-white/10 bg-[#1e1e20]/85 text-obs-text-main shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md'>
    <header class='flex items-center justify-between border-b border-white/6 px-4 py-2 select-none'>
      <div class='flex items-center gap-2'>
        <Satellite class='h-4 w-4 text-obs-primary' />
        <h2 class='m-0 pt-[2px] font-heading text-[13px] font-bold tracking-wide uppercase'>{inspection ? `REGION #${inspection.regionId}` : '行星探针读数'}</h2>
      </div>
      <div class='flex items-center gap-2'>
        {#if inspection}<Badge variant='slate' class='font-mono text-[9px] tracking-wider py-0.5 px-1.5'>MESH</Badge>{/if}
        <button type='button' onclick={() => appState.inspectorOpen = false} class='rounded-md p-1 text-obs-text-dim transition-colors hover:bg-white/6 hover:text-obs-text-main' title='关闭探针面板' aria-label='关闭探针面板'><X class='h-4 w-4' /></button>
      </div>
    </header>
    <div class='custom-scrollbar max-h-[calc(100dvh-12rem)] overflow-y-auto p-3.5 text-xs'>
      {#if inspection}
        {@const info = inspection}
        {@const biomeDef = NATURAL_BIOME_DEFINITIONS.find(d => d.id === info.regionFacts.potentialBiomeId)}
        {@const coverDef = NATURAL_LAND_COVER_DEFINITIONS.find(d => d.id === info.regionFacts.landCoverId)}
        {@const koppenCode = KOPPEN_CODES[info.regionFacts.koppenClass] ?? 'Ocean'}
        {@const koppenLabel = KOPPEN_CLASS_LABELS_ZH[info.regionFacts.koppenClass] ?? koppenCode}
        <section class='flex flex-col gap-3 text-xs' aria-label='选中区域'>
          <div class='flex flex-col gap-2.5 text-xs'>
            <div class='flex flex-col gap-1 rounded-lg border border-white/6 bg-white/2 p-2.5'>
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

            <dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-1.5 border-t border-white/6 pt-2' aria-label='地质与地形'>
              <dt class='text-obs-text-dim'>海陆与高程</dt>
              <dd>{info.regionFacts.land ? '陆地' : '海域'} · {info.regionFacts.elevationKm.toFixed(3)} km</dd>
              <dt class='text-obs-text-dim'>地形坡度</dt>
              <dd>{info.slopeDeg.toFixed(2)}°</dd>
              <dt class='text-obs-text-dim'>大陆 / 洋 / 海归属</dt>
              <dd>{info.continentLabel}</dd>
              <dt class='text-obs-text-dim'>构造板块 / 地壳</dt>
              <dd class='font-mono'>{info.regionFacts.plateId} · {info.regionFacts.crustType === 1 ? '大陆地壳' : '大洋地壳'}</dd>
            </dl>

            <dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-1.5 border-t border-white/6 pt-2' aria-label='区域气候'>
              <dt class='text-obs-text-dim'>第 {info.regionFacts.month + 1} 月气温 / 降水</dt>
              <dd>{info.regionFacts.temperatureC.toFixed(1)} °C / {info.regionFacts.precipitationMm.toFixed(1)} mm</dd>
              <dt class='text-obs-text-dim'>年均温 / 年总降水</dt>
              <dd>{info.regionFacts.annualMeanTemperatureC.toFixed(1)} °C / {info.regionFacts.annualPrecipitationMm.toFixed(0)} mm/年</dd>
              <dt class='text-obs-text-dim'>Köppen 气候带</dt>
              <dd>{koppenLabel}</dd>
              <dt class='text-obs-text-dim'>10m 月均风速</dt>
              <dd>{info.wind ? formatCirculationVector(info.wind.east, info.wind.north, 1) : '无数据'}</dd>
              <dt class='text-obs-text-dim'>表层洋流 / 暖度</dt>
              <dd>{info.ocean ? `${formatCirculationVector(info.ocean.east, info.ocean.north, 2)} (暖度 ${info.ocean.warmth.toFixed(2)})` : '无数据'}</dd>
            </dl>

            <dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-1.5 border-t border-white/6 pt-2' aria-label='区域生态'>
              <dt class='text-obs-text-dim'>潜在生物群系</dt>
              <dd>{biomeDef ? `${biomeDef.nameZh} · ${biomeDef.id}` : info.regionFacts.potentialBiomeId}</dd>
              <dt class='text-obs-text-dim'>自然地表覆盖</dt>
              <dd>{coverDef ? `${coverDef.nameZh} · ${coverDef.id}` : info.regionFacts.landCoverId}</dd>
              <dt class='text-obs-text-dim'>干旱指数 / 生长季</dt>
              <dd>{info.regionFacts.aridityIndex.toFixed(3)} / {info.regionFacts.growingSeasonMonths} 个月</dd>
            </dl>

            <dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-1.5 border-t border-white/6 pt-2' aria-label='区域水文'>
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
        </section>
      {:else}
        <div class='flex flex-col items-center gap-2 py-4 text-center text-xs text-obs-text-dim'>
          <Satellite class='h-6 w-6 animate-pulse text-obs-primary/60' />
          <span>点击行星地表区域，发射探针以获取环境数据</span>
        </div>
      {/if}
    </div>
  </aside>
{/if}
