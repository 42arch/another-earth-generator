<script lang='ts'>
  import type { BuiltinMapStylePresetId, MapViewportMode } from '@another-earth/cartography'
  import { getBuiltinMapStylePreset } from '@another-earth/cartography'
  import { Layers, X } from '@lucide/svelte'
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
    styleId = $bindable(),
    activeThematicId = $bindable(),
    surfaceEnabled = $bindable(),
    enabledOverlayIds = $bindable(),
    showAtmosphere = $bindable(),
    showDayNight = $bindable(),
    showPolarIce = $bindable(),
  }: Props = $props()

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
  <aside class='pointer-events-auto fixed top-1/2 left-[calc(var(--app-sidebar-inset)+var(--app-sidebar-width)+0.75rem)] z-40 flex max-h-[calc(100dvh-2rem)] w-[340px] max-w-[calc(100vw-var(--app-sidebar-inset)-var(--app-sidebar-width)-2rem)] -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1e1e20]/85 text-obs-text-main shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md' aria-label='图层'>
    <header class='flex items-center justify-between border-b border-white/6 px-4 py-2'>
      <div class='flex items-center gap-2'><Layers class='h-4 w-4 text-obs-primary' /><h2 class='m-0 pt-[2px] font-heading text-[13px] font-bold tracking-wide'>图层</h2></div>
      <button type='button' onclick={onClose} class='rounded-md p-1 text-obs-text-dim transition-colors hover:bg-white/6 hover:text-obs-text-main' title='关闭图层面板' aria-label='关闭图层面板'><X class='h-4 w-4' /></button>
    </header>
    <div class='custom-scrollbar flex-1 overflow-y-auto p-3.5 text-xs'>
      <div class='flex flex-col gap-3'>
        <section class='flex flex-col gap-2' aria-label='地图风格'>
          <div class='flex items-center justify-between px-0.5'>
            <span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>风格</span>
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
                  <span class='text-[11px] font-semibold leading-none'>{preset.label}</span>
                </div>
                <span class='text-[9px] leading-tight text-obs-text-dim'>{preset.subtitle}</span>
              </button>
            {/each}
          </div>
        </section>

        <section class='flex flex-col gap-2 border-t border-white/6 pt-2.5' aria-label='图层'>
          <div class='flex items-center justify-between px-0.5'>
            <span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>图层</span>
            {#if activeThematicId !== null}
              <button
                type='button'
                onclick={() => selectThematic(null)}
                class='text-[10px] text-obs-primary hover:underline cursor-pointer'
              >
                返回仅底图
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
              {SURFACE_LAYER_ITEM.label}
            </button>
          </div>

          <span class='px-0.5 text-[10px] font-medium text-obs-text-dim'>专题</span>
          {#each LAYER_GROUPS as group (group.label)}
            <div class='flex flex-col gap-1'>
              <span class='px-0.5 text-[10px] font-medium text-obs-text-dim'>{group.label}</span>
              <div class='grid grid-cols-2 gap-1.5'>
                {#each group.items as item (item.id)}
                  {@const period = climatePeriodByButtonId(item.id)}
                  <button
                    type='button'
                    aria-pressed={period ? climatePeriodForThematic(activeThematicId)?.buttonId === item.id : activeThematicId === item.id}
                    onclick={() => selectThematic(item.id)}
                    class="rounded-lg border px-2 py-1.5 text-left text-[10px] transition-colors cursor-pointer {(period ? climatePeriodForThematic(activeThematicId)?.buttonId === item.id : activeThematicId === item.id) ? 'border-obs-primary/45 bg-obs-primary/15 text-obs-primary font-medium' : 'border-white/6 bg-white/2 text-obs-text-muted hover:bg-white/5'}"
                  >
                    {item.label}
                  </button>
                {/each}
              </div>
            </div>
          {/each}

          <div class='mt-1 flex flex-col gap-1.5 border-t border-white/6 pt-2' aria-label='覆盖与注记'>
            <span class='px-0.5 text-[10px] font-medium text-obs-text-dim'>覆盖与注记</span>
            {#each OVERLAY_ITEMS as item (item.id)}
              <Checkbox
                label={item.label}
                description={item.description}
                checked={enabledOverlayIds.includes(item.id)}
                disabled={item.requiresCapability === 'hasCirculation' ? hasCirculation === false : item.requiresCapability === 'hasGeographicNames' ? hasGeographicNames === false : false}
                onchange={value => setOverlayEnabled(item.id, value)}
              />
            {/each}
          </div>
        </section>

        <section class='flex flex-col gap-1.5 border-t border-white/6 pt-2.5' aria-label='辅助显示'>
          <div class='flex items-center justify-between px-0.5'>
            <span class='text-[10px] font-bold tracking-wider uppercase text-obs-primary/90'>辅助显示</span>
          </div>
          <Toggle label='大气光晕' description='仅 3D 星球' checked={showAtmosphere} disabled={viewMode !== 'globe'} oncommit={(value) => {
            showAtmosphere = value
            onViewStateChange()
          }} />
          <Toggle label='昼夜效果' description='仅 3D 星球' checked={showDayNight} disabled={viewMode !== 'globe'} oncommit={(value) => {
            showDayNight = value
            onViewStateChange()
          }} />
          <Toggle label='两极冰盖' description='仅仿真卫星' checked={showPolarIce} disabled={styleId !== 'satellite'} oncommit={(value) => {
            showPolarIce = value
            onViewStateChange()
          }} />
        </section>
      </div>
    </div>
  </aside>
{/if}
