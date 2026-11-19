<script lang='ts'>
  import type { MessageKey } from '@/lib/i18n'
  import type { LayerStatistics } from '@/world-view/layer-statistics'
  import { Check, Copy, Map, X } from '@lucide/svelte'
  import { t } from '@/lib/i18n'
  import Slider from '@/ui/components/Slider.svelte'
  import Toggle from '@/ui/components/Toggle.svelte'
  import { appState } from '@/ui/state/app.svelte'
  import { climatePeriodForThematic, MONTHLY_ONLY_THEMATIC_IDS } from './layer-presentation'

  interface Props {
    open: boolean
    onClose: () => void
    layerStatistics?: LayerStatistics
    activeThematicId: string | null
    climateMonth: number
    copiedStats: boolean
    onClimateMonthChange: (month: number) => void
    onClimatePeriodChange: (monthly: boolean) => void
    onCopyStatistics: () => void
  }

  const {
    open,
    onClose,
    layerStatistics,
    activeThematicId,
    climateMonth,
    copiedStats,
    onClimateMonthChange,
    onClimatePeriodChange,
    onCopyStatistics,
  }: Props = $props()

  function gradientBackground(stops: NonNullable<LayerStatistics['gradientStops']>): string {
    const start = stops[0].value
    const span = stops.at(-1)!.value - start
    return `linear-gradient(90deg, ${stops.map(stop => `${stop.color} ${span > 0 ? (stop.value - start) / span * 100 : 0}%`).join(', ')})`
  }

  function formatLayerPercentage(value: number): string {
    return value > 0 && value < 0.01 ? '<0.01%' : `${value.toFixed(2)}%`
  }

  const titleKeys: Record<string, MessageKey> = {
    'satellite': 'legend.titles.base',
    'standard-atlas': 'legend.titles.base',
    'physical-relief': 'legend.titles.base',
    'minimal-light': 'legend.titles.base',
    'minimal-dark': 'legend.titles.base',
    'historical-parchment': 'legend.titles.base',
    'temperature': 'legend.titles.temperature',
    'annual-temperature': 'legend.titles.annualTemperature',
    'precipitation': 'legend.titles.precipitation',
    'annual-precipitation': 'legend.titles.annualPrecipitation',
    'wind-speed': 'legend.titles.windSpeed',
    'annual-wind-speed': 'legend.titles.annualWindSpeed',
    'ocean-speed': 'legend.titles.oceanSpeed',
    'annual-ocean-speed': 'legend.titles.annualOceanSpeed',
    'koppen': 'legend.titles.koppen',
    'biomes': 'legend.titles.biomes',
    'land-cover': 'legend.titles.landCover',
    'elevation': 'legend.titles.elevation',
    'dem': 'legend.titles.dem',
    'plates': 'legend.titles.plates',
    'continents': 'legend.titles.continents',
    'runoff': 'legend.titles.runoff',
    'snow': 'legend.titles.snow',
    'basins': 'legend.titles.basins',
  }

  function statisticsTitle(mode: string, title: string, month?: number): string {
    const key = titleKeys[mode]
    if (!key)
      return title
    return t(key, { month: (month ?? 0) + 1 })
  }

  function rowLabel(key: string, fallback: string): string {
    if (key === 'land')
      return t('legend.rows.land')
    if (key === 'ocean')
      return t('legend.rows.ocean')
    if (key === 'no-data')
      return t('legend.rows.noData')
    return fallback
  }
</script>

{#if open}
  <aside class='pointer-events-auto fixed right-4 bottom-4 z-30 flex max-h-[min(70dvh,36rem)] w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1e1e20]/85 text-obs-text-main shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md' aria-label={t('legend.panel')}>
    <header class='flex items-center justify-between border-b border-white/6 px-4 py-2'>
      <div class='flex items-center gap-2'>
        <Map class='h-4 w-4 text-obs-primary' />
        <h2 class='m-0 pt-[2px] font-heading text-[13px] font-bold tracking-wide'>{t('legend.panel')}</h2>
      </div>
      <button type='button' onclick={onClose} class='rounded-md p-1 text-obs-text-dim transition-colors hover:bg-white/6 hover:text-obs-text-main' title={t('legend.closePanel')} aria-label={t('legend.closePanel')}>
        <X class='h-4 w-4' />
      </button>
    </header>
    <div class='custom-scrollbar overflow-y-auto px-3 py-1 pb-3 text-xs'>
      <section class='mt-1 overflow-hidden' aria-label={t('legend.monthAndLegend')}>
        {#if layerStatistics}
          {@const climatePeriod = climatePeriodForThematic(activeThematicId)}
          {@const monthControlVisible = (climatePeriod !== undefined && activeThematicId === climatePeriod.monthlyId) || MONTHLY_ONLY_THEMATIC_IDS.includes(activeThematicId as typeof MONTHLY_ONLY_THEMATIC_IDS[number])}
          {#if climatePeriod}
            <div class='border-b border-white/6 px-3 py-1'>
              <Toggle
                label={t('legend.periodByMonth')}
                description={activeThematicId === climatePeriod.monthlyId ? t('legend.currentMonth') : t('legend.currentYear')}
                descriptionAriaLabel={t('layers.descriptionFor', { label: t('legend.periodByMonth') })}
                checked={activeThematicId === climatePeriod.monthlyId}
                oncommit={onClimatePeriodChange}
              />
            </div>
          {/if}
          {#if monthControlVisible}
            <div class='border-b border-white/6 px-3 py-1.5'>
              <Slider
                label={t('legend.monthSlider')}
                value={climateMonth}
                min={0}
                max={11}
                step={1}
                formatValue={month => t('legend.monthNumber', { month: month + 1 })}
                onchange={onClimateMonthChange}
              />
            </div>
          {/if}
          <div class='border-b border-white/6 px-2 pt-0 pb-2' aria-label={t('legend.layerStatistics')}>
            <div class='flex items-center justify-between gap-2'>
              <span class='text-[11px] font-semibold text-obs-text-main'>{t('legend.layerStatistics')} · {statisticsTitle(layerStatistics.mode, layerStatistics.title, layerStatistics.month)}</span>
              <div class='flex items-center gap-2'>
                <span class='shrink-0 font-mono text-[9px] text-obs-text-dim'>{t('legend.regions', { count: layerStatistics.totalCells.toLocaleString(appState.locale) })}</span>
                <button
                  type='button'
                  onclick={onCopyStatistics}
                  class='rounded border border-white/10 bg-white/5 p-1 text-obs-text-muted hover:bg-white/10 hover:text-white cursor-pointer'
                  title={t('legend.copyStatistics')}
                  aria-label={copiedStats ? t('legend.copiedStatistics') : t('legend.copyStatistics')}
                >
                  {#if copiedStats}<Check class='h-3 w-3 text-emerald-300' />{:else}<Copy class='h-3 w-3' />{/if}
                </button>
              </div>
            </div>
            {#if layerStatistics.description}
              <p class='mt-1 text-[10px] leading-relaxed text-obs-text-dim'>{layerStatistics.description}</p>
            {/if}
            {#if layerStatistics.gradientStops && layerStatistics.gradientStops.length >= 2}
              <div class='mt-2 flex flex-col gap-1'>
                <div class='h-2 w-full rounded-full border border-white/10' style:background={gradientBackground(layerStatistics.gradientStops)}></div>
                <div class='flex justify-between font-mono text-[9px] text-obs-text-dim'>
                  <span>{layerStatistics.gradientStops[0].value}{layerStatistics.unit ? ` ${layerStatistics.unit}` : ''}</span>
                  <span>{layerStatistics.gradientStops.at(-1)?.value}{layerStatistics.unit ? ` ${layerStatistics.unit}` : ''}</span>
                </div>
              </div>
            {/if}
          </div>
          <div class='flex max-h-60 flex-col gap-0.5 overflow-y-auto p-1.5 custom-scrollbar'>
            {#each layerStatistics.rows as row (row.key)}
              <div class='rounded-lg px-2 py-1.5 hover:bg-white/4'>
                <div class='flex items-center gap-2 text-[10px]'>
                  <span class='h-2 w-2 shrink-0 rounded-full shadow-sm' style:background-color={row.color}></span>
                  <span class='min-w-0 flex-1 wrap-break-word leading-tight text-obs-text-main'>{rowLabel(row.key, row.label)}</span>
                  <span class='font-mono tabular-nums text-obs-text-muted'>{row.count.toLocaleString(appState.locale)}</span>
                  <span class='w-12 text-right font-mono tabular-nums text-obs-primary'>{formatLayerPercentage(row.percentage)}</span>
                </div>
                <div class='ml-4 mt-0.5 text-[9px] text-obs-text-dim'>{t('legend.rowArea', { area: row.areaKm2.toLocaleString(appState.locale, { maximumFractionDigits: 0 }) })}</div>
                <div class='ml-4 mt-1 h-1 overflow-hidden rounded-full bg-white/6'>
                  <div class='h-full rounded-full' style:background-color={row.color} style:width={`${row.count > 0 ? Math.max(row.percentage, 0.3) : 0}%`}></div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  </aside>
{/if}
