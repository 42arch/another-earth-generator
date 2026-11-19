<script lang='ts'>
  import type { ClimateParameters, GeologyParameters, HydrologyParameters, LandformParameters, TerrainParameters } from '@another-earth/world-core'
  import type { Mutable } from '@/lib/mutable'
  import { TEMPERATURE_OFFSET_MAX_C, TEMPERATURE_OFFSET_MIN_C } from '@another-earth/world-core'
  import { CircleQuestionMark, Play, SlidersHorizontal, X } from '@lucide/svelte'
  import { t } from '@/lib/i18n'
  import Slider from '@/ui/components/Slider.svelte'
  import Tabs from '@/ui/components/Tabs.svelte'
  import Tooltip from '@/ui/components/Tooltip.svelte'
  import { appState } from '@/ui/state/app.svelte'

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
  const parameterTabs = $derived([
    { value: 'nature' as const, label: t('parameters.tabs.nature') },
    { value: 'civilization' as const, label: t('parameters.tabs.civilization') },
  ])
  const terrainControls = [
    { key: 'roughness', label: 'parameters.controls.roughness.label', description: 'parameters.controls.roughness.description', max: 0.5 },
    { key: 'terrainWarp', label: 'parameters.controls.terrainWarp.label', description: 'parameters.controls.terrainWarp.description', max: 1 },
    { key: 'smoothing', label: 'parameters.controls.smoothing.label', description: 'parameters.controls.smoothing.description', max: 1 },
    { key: 'hydraulicErosion', label: 'parameters.controls.hydraulicErosion.label', description: 'parameters.controls.hydraulicErosion.description', max: 1 },
    { key: 'glacialErosion', label: 'parameters.controls.glacialErosion.label', description: 'parameters.controls.glacialErosion.description', max: 1 },
    { key: 'ridgeSharpening', label: 'parameters.controls.ridgeSharpening.label', description: 'parameters.controls.ridgeSharpening.description', max: 1 },
  ] as const
  const hydrologyAreaSliderMax = 7
  const hydrologyAreaToSlider = (value: number) => Math.log10(value + 1)
  const hydrologyAreaFromSlider = (value: number) => Math.round(10 ** value - 1)
  const formatAreaKm2 = (value: number) => value.toLocaleString(appState.locale, { maximumFractionDigits: 0 })
</script>

{#if open}
  <aside
    class='pointer-events-auto fixed top-4 bottom-4 left-[calc(var(--app-sidebar-inset)+var(--app-sidebar-width)+0.75rem)] z-40 flex w-[340px] max-w-[calc(100vw-var(--app-sidebar-width)-2rem)] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1e1e20]/85 text-obs-text-main shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md'
    aria-label={t('parameters.panel')}
  >
    <header class='flex items-center justify-between px-4 py-2 border-b border-white/8'>
      <div class='flex items-center gap-2'>
        <SlidersHorizontal class='w-4 h-4 text-obs-primary' />
        <div class='flex flex-col'>
          <h2 class='font-sans text-[13px] font-bold tracking-wide text-obs-text-main m-0 leading-none pt-[2px]'>{t('parameters.panel')}</h2>
        </div>
      </div>
      <button type='button' onclick={onClose} class='text-obs-text-dim hover:text-obs-text-main p-1 rounded-md hover:bg-white/6 transition-colors cursor-pointer' title={t('parameters.closePanel')} aria-label={t('parameters.closePanel')}>
        <X class='w-4 h-4' />
      </button>
    </header>

    <section class='shrink-0 px-4 pt-3'>
      <div class='flex items-center gap-2 mb-1'>
        <span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>{t('parameters.global')}</span>
        <div class='flex-1 h-px bg-white/5'></div>
      </div>
      <div class='flex flex-col gap-2'>
        <Slider label={t('parameters.subdivisionLevel')} description={t('parameters.subdivisionLevelDescription')} bind:value={level} min={4} max={8} step={1} decimals={0} formatValue={value => `L${value}`} onchange={onChooseLevel} />
        <label class='flex flex-col gap-1 py-1 text-obs-text-main'>
          <span class='flex items-center gap-1.5 font-sans text-[11px] text-obs-text-muted'>
            {t('parameters.randomSeed')}
            <Tooltip content={t('parameters.randomSeedDescription')} delayDuration={100}>
              <span class='cursor-help text-obs-text-dim transition-colors hover:text-white'><CircleQuestionMark class='h-3 w-3' /></span>
            </Tooltip>
          </span>
          <input
            aria-label={t('parameters.randomSeed')}
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

    <Tabs bind:value={activeTab} items={parameterTabs} ariaLabel={t('parameters.category')} class='min-h-0'>
      {#snippet content(tab)}
        {#if tab === 'nature'}
          <div class='flex flex-col gap-4'>
            <section class='flex flex-col gap-2' aria-label={t('parameters.sections.grid')}>
              <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>{t('parameters.sections.grid')}</span><div class='flex-1 h-px bg-white/5'></div></div>
              <Slider label={t('parameters.controls.irregularity.label')} description={t('parameters.controls.irregularity.description')} bind:value={irregularity} min={0} max={1} step={0.05} decimals={2} />
            </section>

            <section class='flex flex-col gap-2 border-t border-white/6 pt-3' aria-label={t('parameters.sections.geology')}>
              <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>{t('parameters.sections.geology')}</span><div class='flex-1 h-px bg-white/5'></div></div>
              <Slider label={t('parameters.controls.primaryPlateCount.label')} description={t('parameters.controls.primaryPlateCount.description')} bind:value={geologyParameters.primaryPlateCount} min={2} max={100} step={1} decimals={0} />
              <Slider label={t('parameters.controls.microPlateCount.label')} description={t('parameters.controls.microPlateCount.description')} bind:value={geologyParameters.microPlateCount} min={0} max={100 - geologyParameters.primaryPlateCount} step={1} decimals={0} />
              <Slider label={t('parameters.controls.plateSizeVariety.label')} description={t('parameters.controls.plateSizeVariety.description')} bind:value={geologyParameters.plateSizeVariety} min={0} max={1} step={0.05} decimals={2} />
              <Slider label={t('parameters.controls.continentCount.label')} description={t('parameters.controls.continentCount.description')} bind:value={geologyParameters.continentCount} min={1} max={100} step={1} decimals={0} />
              <Slider label={t('parameters.controls.candidateLandCoverage.label')} description={t('parameters.controls.candidateLandCoverage.description')} bind:value={geologyParameters.candidateLandCoverage} min={0} max={1} step={0.05} decimals={2} formatValue={value => `${Math.round(value * 100)}%`} />
              <Slider label={t('parameters.controls.continentSizeVariety.label')} description={t('parameters.controls.continentSizeVariety.description')} bind:value={geologyParameters.continentSizeVariety} min={0} max={1} step={0.05} decimals={2} />
            </section>

            <section class='flex flex-col gap-2 border-t border-white/6 pt-3' aria-label={t('parameters.sections.terrain')}>
              <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>{t('parameters.sections.terrain')}</span><div class='flex-1 h-px bg-white/5'></div></div>
              <Slider label={t('parameters.controls.islandArcCount.label')} description={t('parameters.controls.islandArcCount.description')} bind:value={landformParameters.islandArcCount} min={0} max={100} step={1} decimals={0} />
              <Slider label={t('parameters.controls.islandDensity.label')} description={t('parameters.controls.islandDensity.description')} bind:value={landformParameters.islandDensity} min={0} max={1} step={0.05} decimals={2} />
              <Slider label={t('parameters.controls.hotspotCount.label')} description={t('parameters.controls.hotspotCount.description')} bind:value={landformParameters.hotspotCount} min={0} max={100} step={1} decimals={0} />
              {#each terrainControls as parameter (parameter.key)}
                <Slider label={t(parameter.label)} description={t(parameter.description)} bind:value={terrainParameters[parameter.key]} min={0} max={parameter.max} step={0.05} decimals={2} />
              {/each}
            </section>

            <section class='flex flex-col gap-2 border-t border-white/6 pt-3' aria-label={t('parameters.sections.climate')}>
              <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>{t('parameters.sections.climate')}</span><div class='flex-1 h-px bg-white/5'></div></div>
              <Slider label={t('parameters.controls.axialTilt.label')} description={t('parameters.controls.axialTilt.description')} bind:value={climateParameters.axialTiltDegrees} min={0} max={45} step={0.1} decimals={1} />
              <Slider label={t('parameters.controls.orbitalPeriod.label')} description={t('parameters.controls.orbitalPeriod.description')} bind:value={climateParameters.orbitalPeriodDays} min={300} max={430} step={0.25} decimals={2} />
              <Slider label={t('parameters.controls.temperatureOffset.label')} description={t('parameters.controls.temperatureOffset.description')} bind:value={climateParameters.temperatureOffsetC} min={TEMPERATURE_OFFSET_MIN_C} max={TEMPERATURE_OFFSET_MAX_C} step={0.5} decimals={1} />
              <Slider label={t('parameters.controls.precipitationScale.label')} description={t('parameters.controls.precipitationScale.description')} bind:value={climateParameters.precipitationScale} min={0} max={3} step={0.1} decimals={1} />
            </section>

            <section class='flex flex-col gap-2 border-t border-white/6 pt-3' aria-label={t('parameters.sections.hydrology')}>
              <div class='flex items-center gap-2 mb-1'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>{t('parameters.sections.hydrology')}</span><div class='flex-1 h-px bg-white/5'></div></div>
              <Slider label={t('parameters.controls.degreeDayMeltFactor.label')} description={t('parameters.controls.degreeDayMeltFactor.description')} bind:value={hydrologyParameters.degreeDayMeltFactorMmPerCMonth} min={0} max={100} step={0.5} decimals={1} />
              <Slider label={t('parameters.controls.evapotranspirationFactor.label')} description={t('parameters.controls.evapotranspirationFactor.description')} bind:value={hydrologyParameters.evapotranspirationFactorMmPerCMonth} min={0} max={100} step={0.5} decimals={1} />
              <div class='flex items-center gap-2 border-t border-white/6 pt-2'><span class='font-sans text-[10px] uppercase tracking-wide text-obs-text-muted font-bold'>{t('parameters.sections.riversAndLakes')}</span><div class='flex-1 h-px bg-white/5'></div></div>
              <Slider label={t('parameters.controls.riverDensityMultiplier.label')} description={t('parameters.controls.riverDensityMultiplier.description')} bind:value={hydrologyParameters.riverDensityMultiplier} min={0.25} max={2} step={0.05} decimals={2} />
            <Slider label={t('parameters.controls.minimumRiverDrainageArea.label')} description={t('parameters.controls.minimumRiverDrainageArea.description')} bind:value={hydrologyParameters.minimumRiverDrainageAreaKm2} min={0} max={hydrologyAreaSliderMax} step={0.01} decimals={0} unit=' km²' toSlider={hydrologyAreaToSlider} fromSlider={hydrologyAreaFromSlider} formatValue={formatAreaKm2} />
              <Slider label={t('parameters.controls.minimumLakeArea.label')} description={t('parameters.controls.minimumLakeArea.description')} bind:value={hydrologyParameters.minimumLakeAreaKm2} min={0} max={hydrologyAreaSliderMax} step={0.01} decimals={0} unit=' km²' toSlider={hydrologyAreaToSlider} fromSlider={hydrologyAreaFromSlider} formatValue={formatAreaKm2} />
            </section>

            {#if level >= 6}<p class='rounded-md border border-obs-primary/10 bg-obs-primary/4 p-2 text-[10px] leading-relaxed text-obs-text-dim'>{t('parameters.highLevelWarning')}</p>{/if}
            {#if hasGenerated}
              <section class='border-t border-white/6 pt-3' aria-label={t('parameters.sections.generation')}>
                <button type='button' class='w-full rounded-md border border-white/8 bg-white/4 px-3 py-1.5 text-[11px] text-obs-text-muted transition-colors hover:bg-white/8 hover:text-white disabled:opacity-40' onclick={onForceRegenerate} disabled={busy}>{t('parameters.forceRegenerate')}</button>
              </section>
            {/if}
          </div>
        {:else}
          <div class='flex flex-col gap-3'>
            <div class='flex items-center gap-2'><span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>{t('parameters.civilization.populationAndSettlement')}</span><div class='flex-1 h-px bg-white/5'></div></div>
            <div class='rounded-lg border border-white/6 bg-white/2 p-3 text-[11px] leading-relaxed text-obs-text-dim'>{t('parameters.civilization.notAvailable')}</div>
            <div class='flex flex-col gap-2 opacity-35' aria-disabled='true'>
              <div class='flex items-center justify-between py-1 text-[11px] text-obs-text-muted'><span>{t('parameters.civilization.population')}</span><span>{t('parameters.civilization.pendingM2')}</span></div>
              <div class='h-1 rounded-full bg-white/8'></div>
              <div class='flex items-center justify-between py-1 text-[11px] text-obs-text-muted'><span>{t('parameters.civilization.settlementDensity')}</span><span>{t('parameters.civilization.pendingM2')}</span></div>
              <div class='h-1 rounded-full bg-white/8'></div>
              <div class='flex items-center justify-between py-1 text-[11px] text-obs-text-muted'><span>{t('parameters.civilization.roadConnectivity')}</span><span>{t('parameters.civilization.pendingM2')}</span></div>
              <div class='h-1 rounded-full bg-white/8'></div>
            </div>
          </div>
        {/if}
      {/snippet}
    </Tabs>

    <footer class='flex items-center justify-between px-4 py-2 border-t border-white/6 bg-black/10'>
      <span class='text-[10px] text-obs-text-dim'>{busy ? t('parameters.footer.busy') : t('parameters.footer.adjust')}</span>
      <button type='button' class='flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold tracking-wider text-obs-primary border border-obs-primary/40 rounded-md bg-obs-primary/15 hover:bg-obs-primary/25 hover:border-obs-primary/70 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed' onclick={onGenerate} disabled={busy}>
        <Play class='w-3 h-3 fill-current' />
        <span>{busy ? t('parameters.footer.generating') : t('parameters.footer.start')}</span>
      </button>
    </footer>
  </aside>
{/if}
