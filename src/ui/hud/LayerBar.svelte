<script lang='ts'>
  import type { GlobeDisplayMode } from '@/core/spherical/config'
  import type { AnalysisLayerKey, LayerKey } from '@/ui/state/layer-settings'
  import { Check, ChevronRight, Dices, Layers3, X } from '@lucide/svelte'
  import { fly } from 'svelte/transition'
  import CivButton from '@/ui/components/CivButton.svelte'
  import ParameterFields from '@/ui/hud/ParameterFields.svelte'
  import { ANALYSIS_LAYERS, DISPLAY_MODES, getContextSettings, LAYER_GROUPS, LAYER_SETTINGS, PARAMETER_GROUPS } from '@/ui/state/layer-settings'
  import { uiState } from '@/ui/state/ui-state.svelte'

  const context = $derived(getContextSettings(uiState.settingsContext))
  let parameterScroll: HTMLDivElement | undefined = $state()
  $effect(() => {
    // A new selection starts at its first parameter, regardless of the old scroll position.
    const selection = uiState.settingsContext
    if (selection && parameterScroll)
      parameterScroll.scrollTop = 0
  })
  const contextVisible = $derived(uiState.settingsContext.kind === 'theme'
    ? uiState.params.displayMode === uiState.settingsContext.key
    : uiState.params[uiState.settingsContext.key])
  const selectClass = 'min-w-0 flex-1 rounded border border-white/15 bg-[#20252b] px-2 py-1.5 text-xs text-white outline-none focus-visible:ring-2 focus-visible:ring-obs-amber'

  function isSelected(key: LayerKey) {
    return uiState.settingsContext.kind === 'layer' && uiState.settingsContext.key === key
  }

  function updateSeed(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    if (input.value === '' || !Number.isFinite(input.valueAsNumber))
      return
    uiState.updateParam('seed', Math.max(1, Math.min(9999, Math.round(input.valueAsNumber))))
  }
</script>

{#if uiState.layerDrawerOpen}
  <aside in:fly={{ x: -24, duration: 160 }} class='pointer-events-auto fixed bottom-18 left-4 top-16 z-40 flex w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-white/12 bg-[#20252b]/98 text-obs-text-main shadow-xl' aria-label='图层与设置'>
    <header class='flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3'>
      <div class='flex items-center gap-2'><Layers3 class='h-4 w-4 text-obs-amber' /><h2 class='m-0 text-sm font-semibold'>图层与设置</h2></div>
      <button type='button' onclick={() => uiState.layerDrawerOpen = false} class='rounded p-1 text-obs-text-dim hover:bg-white/8 hover:text-white' aria-label='关闭图层与设置'><X class='h-4 w-4' /></button>
    </header>

    <!-- Keep layer navigation reachable while the parameter section scrolls. -->
    <div class='custom-scrollbar max-h-[34%] shrink-0 space-y-2 overflow-y-auto border-b border-white/10 px-4 py-3 text-xs'>
      <div class='flex items-center gap-2'>
        <label for='map-theme' class='w-12 shrink-0 text-obs-text-muted'>主题</label>
        <select id='map-theme' class={selectClass} value={uiState.params.displayMode} onchange={event => uiState.setDisplayMode(event.currentTarget.value as GlobeDisplayMode)}>
          {#each DISPLAY_MODES as mode}<option value={mode.key}>{mode.label}</option>{/each}
        </select>
        <button type='button' onclick={() => uiState.setDisplayMode(uiState.params.displayMode)} class='rounded px-2 py-1.5 text-obs-text-muted hover:bg-white/6 hover:text-white' aria-label='编辑当前主题参数'>参数</button>
      </div>
      <div class='flex items-center gap-2'>
        <label for='analysis-layer' class='w-12 shrink-0 text-obs-text-muted'>分析</label>
        <select id='analysis-layer' class={selectClass} value={uiState.activeAnalysisLayer ?? ''} onchange={event => uiState.setAnalysisLayer(event.currentTarget.value as AnalysisLayerKey || null)}>
          <option value=''>无分析叠加</option>
          {#each ANALYSIS_LAYERS as key}<option value={key}>{LAYER_SETTINGS[key].label}</option>{/each}
        </select>
        <button type='button' disabled={!uiState.activeAnalysisLayer} onclick={() => uiState.setAnalysisLayer(uiState.activeAnalysisLayer)} class='rounded px-2 py-1.5 text-obs-text-muted hover:bg-white/6 hover:text-white disabled:opacity-30' aria-label='编辑当前分析参数'>参数</button>
      </div>
      <p class='pt-1 text-[11px] text-obs-text-dim'>勾选控制显示 · 点击名称打开相关设置</p>
      {#each LAYER_GROUPS as group}
        <section>
          <h3 class='mb-1 text-[11px] font-normal text-obs-text-dim'>{group.label}</h3>
          <div class='grid grid-cols-2 gap-x-2 gap-y-0.5'>
            {#each group.keys as key}
              {@const disabled = key === 'autoRotate' && uiState.viewMode === 'map'}
              <div class="flex items-center rounded border {isSelected(key) ? 'border-obs-amber/50 bg-obs-amber/10' : 'border-transparent hover:bg-white/5'}">
                <input type='checkbox' checked={uiState.params[key]} onchange={event => uiState.setLayerVisibility(key, event.currentTarget.checked)} {disabled} aria-label={`显示${LAYER_SETTINGS[key].label}`} class='ml-2 h-3.5 w-3.5 cursor-pointer accent-obs-amber disabled:opacity-30' />
                <button type='button' onclick={() => uiState.selectLayer(key)} {disabled} aria-pressed={isSelected(key)} class='flex min-w-0 flex-1 items-center justify-between py-1.5 pl-2 pr-1 text-left text-obs-text-muted hover:text-white disabled:opacity-30'>
                  {LAYER_SETTINGS[key].label}
                  {#if isSelected(key)}<ChevronRight class='h-3 w-3 text-obs-amber' />{/if}
                </button>
              </div>
            {/each}
          </div>
        </section>
      {/each}
    </div>

    <div bind:this={parameterScroll} class='custom-scrollbar min-h-0 flex-1 overflow-y-auto text-xs'>
      <details bind:open={uiState.generalSettingsOpen} class='border-b border-white/10 px-4'>
        <summary class='cursor-pointer py-3 font-medium text-obs-text-muted'>通用设置 <span class='ml-1 text-[11px] font-normal text-obs-text-dim'>种子、精度与基础地形</span></summary>
        <div class='space-y-3 pb-4'>
          <p class='text-[11px] leading-relaxed text-obs-text-dim'>用于整个世界，调整后统一应用。</p>
          <label for='world-seed' class='block text-obs-text-muted'>世界种子</label>
          <div class='flex gap-2'>
            <input id='world-seed' type='number' min='1' max='9999' step='1' value={uiState.params.seed} oninput={updateSeed} class='min-w-0 flex-1 rounded border border-white/15 bg-black/15 px-2 py-1.5 font-mono outline-none focus-visible:ring-2 focus-visible:ring-obs-amber' />
            <button type='button' onclick={() => uiState.randomizeDraftSeed()} class='flex items-center gap-1 rounded border border-white/15 px-2 hover:bg-white/5'><Dices class='h-3.5 w-3.5' />随机</button>
          </div>
          <div class='flex items-center gap-3'>
            <label for='world-quality' class='text-obs-text-muted'>地图精度</label>
            <select id='world-quality' class={selectClass} value={uiState.params.subdivision} onchange={event => uiState.updateParam('subdivision', Number(event.currentTarget.value))}>
              <option value={4}>快速预览</option><option value={5}>均衡</option><option value={6}>高精度（耗时较长）</option>
            </select>
          </div>
          <ParameterFields keys={PARAMETER_GROUPS.terrain.keys} />
          <details>
            <summary class='cursor-pointer py-2 text-obs-text-muted'>行星尺度</summary>
            <ParameterFields keys={['physicalRadiusMeters']} />
          </details>
          <button type='button' onclick={() => uiState.resetWorldSettings()} class='rounded border border-white/15 px-2 py-1.5 text-obs-text-muted hover:bg-white/5'>恢复全部生成参数默认值</button>
        </div>
      </details>

      {#key `${uiState.settingsContext.kind}:${uiState.settingsContext.key}`}
        <section class='space-y-3 p-4' aria-label={`${context.label}设置`}>
          <div class='flex items-center justify-between gap-2'>
            <h3 class='text-sm font-semibold text-white'>{context.label}设置</h3>
            {#if uiState.settingsContext.kind === 'layer'}
              <span class='text-[11px] text-obs-text-dim'>{contextVisible ? '图层已显示' : '图层已隐藏'}</span>
            {/if}
          </div>
          <p class='text-[11px] leading-relaxed text-obs-text-dim'>{context.note}</p>
          {#each context.groups as key}
            <div>
              <h4 class='mb-2 text-xs font-medium text-obs-text-muted'>{PARAMETER_GROUPS[key].label}</h4>
              <ParameterFields keys={PARAMETER_GROUPS[key].keys} />
            </div>
          {/each}
          {#each context.shared as key}
            <details class='border-t border-white/10'>
              <summary class='cursor-pointer py-3 text-obs-text-muted'>{PARAMETER_GROUPS[key].label}<span class='ml-2 text-[10px] text-obs-text-dim'>共享参数</span></summary>
              <ParameterFields keys={PARAMETER_GROUPS[key].keys} />
            </details>
          {/each}
        </section>
      {/key}
    </div>

    <footer class='shrink-0 border-t border-white/10 bg-black/15 p-3'>
      <p class='mb-2 text-[11px] text-obs-text-dim'>{uiState.hasPendingChanges ? `共 ${uiState.changedParamCount} 项待应用，包含其他图层中的修改` : '显示切换即时生效，生成参数修改后统一应用'}</p>
      <div class='flex items-center justify-end gap-2'>
        {#if uiState.hasPendingChanges}
          <CivButton variant='secondary' size='sm' onclick={() => uiState.discardChanges()}>放弃全部修改</CivButton>
        {/if}
        <CivButton variant='amber' size='sm' disabled={!uiState.hasPendingChanges || uiState.isGenerating} onclick={() => void uiState.applyChanges()}>
          <Check class='mr-1 h-3.5 w-3.5' />{uiState.hasPendingChanges ? '应用全部更改' : '已应用'}
        </CivButton>
      </div>
    </footer>
  </aside>
{/if}
