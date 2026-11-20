<script lang='ts'>
  import type { BuiltinMapStylePresetId, MapViewportMode } from '@another-earth/cartography'
  import type { MessageKey } from '@/lib/i18n'
  import { getBuiltinMapStylePreset } from '@another-earth/cartography'
  import { Layers, X } from '@lucide/svelte'
  import { t } from '@/lib/i18n'
  import Checkbox from '@/ui/components/Checkbox.svelte'
  import Toggle from '@/ui/components/Toggle.svelte'
  import {
    climatePeriodByButtonId,
    climatePeriodForThematic,
    LAYER_GROUPS,
    OVERLAY_ITEMS,
    splitStyleDefaultLayers,
    STYLE_PRESET_CARDS,
    SURFACE_LAYER_ITEM,
  } from './layer-presentation'

  interface Props {
    open: boolean
    onClose: () => void
    onViewStateChange: () => void
    viewMode: MapViewportMode
    hasCirculation: boolean | undefined
    hasGeographicNames: boolean | undefined
    hasResources: boolean | undefined
    hasCivilization: boolean | undefined
    styleId: BuiltinMapStylePresetId
    activeThematicId: string | null
    surfaceEnabled: boolean
    enabledOverlayIds: string[]
    showAtmosphere: boolean
    showDayNight: boolean
    showPolarIce: boolean
  }

  let {
    open,
    onClose,
    onViewStateChange,
    viewMode,
    hasCirculation,
    hasGeographicNames,
    hasResources,
    hasCivilization,
    styleId = $bindable(),
    activeThematicId = $bindable(),
    surfaceEnabled = $bindable(),
    enabledOverlayIds = $bindable(),
    showAtmosphere = $bindable(),
    showDayNight = $bindable(),
    showPolarIce = $bindable(),
  }: Props = $props()

  const styleMessageKeys: Record<string, { label: MessageKey, description: MessageKey }> = {
    'satellite': { label: 'layers.styles.satellite.label', description: 'layers.styles.satellite.description' },
    'standard-atlas': { label: 'layers.styles.standardAtlas.label', description: 'layers.styles.standardAtlas.description' },
    'physical-relief': { label: 'layers.styles.physicalRelief.label', description: 'layers.styles.physicalRelief.description' },
    'political-atlas': { label: 'layers.styles.politicalAtlas.label', description: 'layers.styles.politicalAtlas.description' },
    'minimal-light': { label: 'layers.styles.minimalLight.label', description: 'layers.styles.minimalLight.description' },
    'minimal-dark': { label: 'layers.styles.minimalDark.label', description: 'layers.styles.minimalDark.description' },
    'historical-parchment': { label: 'layers.styles.historicalParchment.label', description: 'layers.styles.historicalParchment.description' },
  }

  const thematicMessageKeys: Record<string, MessageKey> = {
    'elevation': 'layers.thematic.elevation',
    'dem': 'layers.thematic.dem',
    'plates': 'layers.thematic.plates',
    'continents': 'layers.thematic.continents',
    'temperature': 'layers.thematic.temperature',
    'precipitation': 'layers.thematic.precipitation',
    'koppen': 'layers.thematic.koppen',
    'wind-speed': 'layers.thematic.windSpeed',
    'ocean-speed': 'layers.thematic.oceanSpeed',
    'snow': 'layers.thematic.snow',
    'runoff': 'layers.thematic.runoff',
    'basins': 'layers.thematic.basins',
    'biomes': 'layers.thematic.biomes',
    'land-cover': 'layers.thematic.landCover',
    'agricultural-potential': 'layers.thematic.agriculturalPotential',
    'deposit-richness': 'layers.thematic.depositRichness',
    'population-density': 'layers.thematic.populationDensity',
    'polity-territory': 'layers.thematic.polityTerritory',
    'culture-dominant': 'layers.thematic.cultureDominant',
    'religion-dominant': 'layers.thematic.religionDominant',
  }

  const groupMessageKeys: Record<string, MessageKey> = {
    'elevation': 'layers.groups.geology',
    'temperature': 'layers.groups.climate',
    'koppen': 'layers.groups.ecologyCover',
    'agricultural-potential': 'layers.groups.resourcesCivilization',
  }

  const overlayMessageKeys: Record<string, { label: MessageKey, description: MessageKey }> = {
    'rivers': { label: 'layers.overlays.rivers.label', description: 'layers.overlays.rivers.description' },
    'lakes': { label: 'layers.overlays.lakes.label', description: 'layers.overlays.lakes.description' },
    'coastlines': { label: 'layers.overlays.coastlines.label', description: 'layers.overlays.coastlines.description' },
    'plate-boundaries': { label: 'layers.overlays.plateBoundaries.label', description: 'layers.overlays.plateBoundaries.description' },
    'wind-arrows': { label: 'layers.overlays.windArrows.label', description: 'layers.overlays.windArrows.description' },
    'ocean-arrows': { label: 'layers.overlays.oceanArrows.label', description: 'layers.overlays.oceanArrows.description' },
    'labels': { label: 'layers.overlays.labels.label', description: 'layers.overlays.labels.description' },
    'polity-borders': { label: 'layers.overlays.polityBorders.label', description: 'layers.overlays.polityBorders.description' },
    'transport-routes': { label: 'layers.overlays.transportRoutes.label', description: 'layers.overlays.transportRoutes.description' },
    'settlements': { label: 'layers.overlays.settlements.label', description: 'layers.overlays.settlements.description' },
    'polity-labels': { label: 'layers.overlays.polityLabels.label', description: 'layers.overlays.polityLabels.description' },
    'settlement-labels': { label: 'layers.overlays.settlementLabels.label', description: 'layers.overlays.settlementLabels.description' },
  }

  function isCapabilityDisabled(requiresCapability: 'hasCirculation' | 'hasGeographicNames' | 'hasResources' | 'hasCivilization' | undefined): boolean {
    if (requiresCapability === 'hasCirculation')
      return hasCirculation === false
    if (requiresCapability === 'hasGeographicNames')
      return hasGeographicNames === false
    if (requiresCapability === 'hasResources')
      return hasResources === false
    if (requiresCapability === 'hasCivilization')
      return hasCivilization === false
    return false
  }

  function setOverlayEnabled(overlayId: string, enabled: boolean): void {
    const has = enabledOverlayIds.includes(overlayId)
    if (enabled && !has) {
      enabledOverlayIds = [...enabledOverlayIds, overlayId]
      onViewStateChange()
    }
    else if (!enabled && has) {
      enabledOverlayIds = enabledOverlayIds.filter(id => id !== overlayId)
      onViewStateChange()
    }
  }

  function selectStylePreset(nextStyleId: BuiltinMapStylePresetId): void {
    if (styleId === nextStyleId)
      return
    styleId = nextStyleId
    const preset = getBuiltinMapStylePreset(nextStyleId)
    const defaults = splitStyleDefaultLayers(preset.defaultEnabledLayerIds ?? [SURFACE_LAYER_ITEM.id])
    surfaceEnabled = defaults.surfaceEnabled
    activeThematicId = defaults.thematicId
    enabledOverlayIds = defaults.overlayIds
    const globeEffects = preset.defaultGlobeEffects ?? { atmosphere: false, dayNight: false }
    showAtmosphere = globeEffects.atmosphere
    showDayNight = globeEffects.dayNight
    onViewStateChange()
  }

  function selectThematic(thematicId: string | null): void {
    const current = climatePeriodForThematic(activeThematicId)
    const period = thematicId === null ? undefined : climatePeriodByButtonId(thematicId)
    if (period) {
      activeThematicId = current?.buttonId === thematicId ? null : period.annualId
    }
    else {
      activeThematicId = activeThematicId === thematicId ? null : thematicId
    }
    onViewStateChange()
  }

  function toggleSurfaceLayer(): void {
    surfaceEnabled = !surfaceEnabled
    onViewStateChange()
  }
</script>

{#if open}
  <aside class='pointer-events-auto fixed top-1/2 left-[calc(var(--app-sidebar-inset)+var(--app-sidebar-width)+0.75rem)] z-40 flex max-h-[calc(100dvh-2rem)] w-[340px] max-w-[calc(100vw-var(--app-sidebar-inset)-var(--app-sidebar-width)-2rem)] -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1e1e20]/85 text-obs-text-main shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md' aria-label={t('layers.panel')}>
    <header class='flex items-center justify-between border-b border-white/6 px-4 py-2'>
      <div class='flex items-center gap-2'><Layers class='h-4 w-4 text-obs-primary' /><h2 class='m-0 pt-[2px] font-heading text-[13px] font-bold tracking-wide'>{t('layers.panel')}</h2></div>
      <button type='button' onclick={onClose} class='rounded-md p-1 text-obs-text-dim transition-colors hover:bg-white/6 hover:text-obs-text-main' title={t('layers.closePanel')} aria-label={t('layers.closePanel')}><X class='h-4 w-4' /></button>
    </header>
    <div class='custom-scrollbar flex-1 overflow-y-auto p-3.5 text-xs'>
      <div class='flex flex-col gap-3'>
        <section class='flex flex-col gap-2' aria-label={t('layers.mapStyle')}>
          <div class='flex items-center justify-between px-0.5'>
            <span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>{t('layers.style')}</span>
          </div>
          <div class='grid grid-cols-2 gap-1.5'>
            {#each STYLE_PRESET_CARDS as preset (preset.id)}
              <button
                type='button'
                aria-pressed={styleId === preset.id}
                onclick={() => selectStylePreset(preset.id)}
                class="flex flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer {styleId === preset.id ? 'border-obs-primary/50 bg-obs-primary/15 text-white' : 'border-white/6 bg-white/2 text-obs-text-muted hover:bg-white/5'}"
              >
                <div class='flex items-center gap-2'>
                  <span class='h-3 w-3 shrink-0 rounded-full border border-white/20 shadow-sm' style:background={preset.swatch}></span>
                  <span class='text-[11px] font-semibold leading-none'>{t(styleMessageKeys[preset.id].label)}</span>
                </div>
                <span class='text-[9px] leading-tight text-obs-text-dim'>{t(styleMessageKeys[preset.id].description)}</span>
              </button>
            {/each}
          </div>
        </section>

        <section class='flex flex-col gap-2 border-t border-white/6 pt-2.5' aria-label={t('layers.baseMap')}>
          <div class='flex items-center justify-between px-0.5'>
            <span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>{t('layers.baseMap')}</span>
            {#if activeThematicId !== null}
              <button
                type='button'
                onclick={() => selectThematic(null)}
                class='text-[10px] text-obs-primary hover:underline cursor-pointer'
              >
                {t('layers.backToBaseMap')}
              </button>
            {/if}
          </div>

          <div class='grid grid-cols-2 gap-1.5'>
            <button
              type='button'
              aria-pressed={surfaceEnabled}
              onclick={toggleSurfaceLayer}
              class="rounded-lg border px-2 py-1.5 text-left text-[10px] transition-colors cursor-pointer {surfaceEnabled ? 'border-obs-primary/45 bg-obs-primary/15 text-obs-primary font-medium' : 'border-white/6 bg-white/2 text-obs-text-muted hover:bg-white/5'}"
            >
              {t('layers.surface')}
            </button>
          </div>

          <span class='px-0.5 text-[10px] font-medium text-obs-text-dim'>{t('layers.thematicTitle')}</span>
          {#each LAYER_GROUPS as group (group.label)}
            <div class='flex flex-col gap-1'>
              <span class='px-0.5 text-[10px] font-medium text-obs-text-dim'>{t(groupMessageKeys[group.items[0]?.id ?? ''])}</span>
              <div class='grid grid-cols-2 gap-1.5'>
                {#each group.items as item (item.id)}
                  {@const period = climatePeriodByButtonId(item.id)}
                  {@const itemDisabled = isCapabilityDisabled(item.requiresCapability)}
                  <button
                    type='button'
                    disabled={itemDisabled}
                    aria-pressed={period ? climatePeriodForThematic(activeThematicId)?.buttonId === item.id : activeThematicId === item.id}
                    onclick={() => selectThematic(item.id)}
                    class="rounded-lg border px-2 py-1.5 text-left text-[10px] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed {(period ? climatePeriodForThematic(activeThematicId)?.buttonId === item.id : activeThematicId === item.id) ? 'border-obs-primary/45 bg-obs-primary/15 text-obs-primary font-medium' : 'border-white/6 bg-white/2 text-obs-text-muted hover:bg-white/5'}"
                  >
                    {t(thematicMessageKeys[item.id])}
                  </button>
                {/each}
              </div>
            </div>
          {/each}

          <div class='mt-1 flex flex-col gap-1.5 border-t border-white/6 pt-2' aria-label={t('layers.overlaysAndLabels')}>
            <span class='px-0.5 text-[10px] font-medium text-obs-text-dim'>{t('layers.overlaysAndLabels')}</span>
            {#each OVERLAY_ITEMS as item (item.id)}
              <Checkbox
                label={t(overlayMessageKeys[item.id].label)}
                description={t(overlayMessageKeys[item.id].description)}
                descriptionAriaLabel={t('layers.descriptionFor', { label: t(overlayMessageKeys[item.id].label) })}
                checked={enabledOverlayIds.includes(item.id)}
                disabled={isCapabilityDisabled(item.requiresCapability)}
                onchange={value => setOverlayEnabled(item.id, value)}
              />
            {/each}
          </div>
        </section>

        <section class='flex flex-col gap-1.5 border-t border-white/6 pt-2.5' aria-label={t('layers.auxiliaryDisplay')}>
          <div class='flex items-center justify-between px-0.5'>
            <span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>{t('layers.auxiliaryDisplay')}</span>
          </div>
          <Toggle label={t('layers.atmosphere')} description={t('layers.globeOnly')} descriptionAriaLabel={t('layers.descriptionFor', { label: t('layers.atmosphere') })} checked={showAtmosphere} disabled={viewMode !== 'globe'} oncommit={(value) => {
            showAtmosphere = value
            onViewStateChange()
          }} />
          <Toggle label={t('layers.dayNight')} description={t('layers.globeOnly')} descriptionAriaLabel={t('layers.descriptionFor', { label: t('layers.dayNight') })} checked={showDayNight} disabled={viewMode !== 'globe'} oncommit={(value) => {
            showDayNight = value
            onViewStateChange()
          }} />
          <Toggle label={t('layers.polarIce')} description={t('layers.satelliteOnly')} descriptionAriaLabel={t('layers.descriptionFor', { label: t('layers.polarIce') })} checked={showPolarIce} disabled={styleId !== 'satellite'} oncommit={(value) => {
            showPolarIce = value
            onViewStateChange()
          }} />
        </section>
      </div>
    </div>
  </aside>
{/if}
