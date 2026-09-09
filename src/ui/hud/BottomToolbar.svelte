<script lang='ts'>
  import { Compass, Globe2, Info, Layers3, Map } from '@lucide/svelte'
  import { uiState } from '@/ui/state/ui-state.svelte'

  const baseButton = 'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/70'
</script>

<nav
  class='pointer-events-auto fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 rounded-lg border border-white/12 bg-[#20252b]/96 p-1.5 shadow-lg select-none'
  aria-label='地图工具'
>
  <button
    type='button'
    onclick={() => uiState.toggleMapDisplay()}
    aria-label='图层与设置'
    aria-expanded={uiState.layerDrawerOpen}
    class="{baseButton} {uiState.layerDrawerOpen ? 'border-obs-amber bg-obs-amber/12 text-white' : 'border-transparent text-obs-text-muted hover:bg-white/6 hover:text-white'}"
  >
    <Layers3 class='h-4 w-4' />
    <span class='hidden sm:inline'>图层与设置</span>
    {#if uiState.hasPendingChanges}
      <span class='rounded-full bg-obs-amber px-1.5 text-[10px] font-semibold text-slate-950'>{uiState.changedParamCount}</span>
    {/if}
  </button>

  {#if uiState.selectedRegion}
    <button
      type='button'
      onclick={() => uiState.inspectorOpen = !uiState.inspectorOpen}
      aria-label='区域信息'
      aria-expanded={uiState.inspectorOpen}
      class="{baseButton} {uiState.inspectorOpen ? 'border-obs-amber bg-obs-amber/12 text-white' : 'border-transparent text-obs-text-muted hover:bg-white/6 hover:text-white'}"
    >
      <Info class='h-4 w-4' />
      <span class='hidden md:inline'>区域信息</span>
    </button>
  {/if}

  <span class='mx-1 h-5 w-px bg-white/10'></span>

  <div class='flex rounded-md bg-black/20 p-0.5' aria-label='视图模式'>
    <button
      type='button'
      onclick={() => uiState.setViewMode('globe')}
      aria-pressed={uiState.viewMode === 'globe'}
      class="flex h-8 items-center gap-1.5 rounded px-2.5 text-xs transition-colors {uiState.viewMode === 'globe' ? 'bg-white/12 text-white' : 'text-obs-text-dim hover:text-white'}"
    >
      <Globe2 class='h-3.5 w-3.5' />3D
    </button>
    <button
      type='button'
      onclick={() => uiState.setViewMode('map')}
      aria-pressed={uiState.viewMode === 'map'}
      class="flex h-8 items-center gap-1.5 rounded px-2.5 text-xs transition-colors {uiState.viewMode === 'map' ? 'bg-white/12 text-white' : 'text-obs-text-dim hover:text-white'}"
    >
      <Map class='h-3.5 w-3.5' />2D
    </button>
  </div>

  {#if uiState.viewMode === 'map'}
    <button type='button' onclick={() => uiState.toggleMapProjection()} class='{baseButton} border-transparent text-obs-text-muted hover:bg-white/6 hover:text-white' title='切换地图投影'>
      {uiState.mapProjection === 'mercator' ? '墨卡托' : '等面积'}
    </button>
  {/if}

  <button type='button' onclick={() => uiState.resetCamera()} class='{baseButton} border-transparent px-2 text-obs-text-muted hover:bg-white/6 hover:text-white' title='重置视角' aria-label='重置视角'>
    <Compass class='h-4 w-4' />
  </button>
</nav>
