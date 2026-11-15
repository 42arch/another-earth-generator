<script lang='ts'>
  import type { MapProjectionId, MapViewportMode } from '@another-earth/cartography'
  import { MAP_PROJECTION_OPTIONS, VIEW_MODE_OPTIONS } from '@/ui/hud/layer-presentation'
  import { appState } from '@/ui/state/app.svelte'

  interface Props {
    seed: string
    busy: boolean
    viewMode: MapViewportMode
    projectionId: MapProjectionId
    onRandomize: () => void
    onSelectViewMode: (mode: MapViewportMode) => void
    onSelectProjection: (projectionId: MapProjectionId) => void
    onResetCamera: () => void
  }

  const {
    seed,
    busy,
    viewMode,
    projectionId,
    onRandomize,
    onSelectViewMode,
    onSelectProjection,
    onResetCamera,
  }: Props = $props()
</script>

<header class='pointer-events-none fixed top-4 inset-x-0 z-40 flex justify-center'>
  <div class='pointer-events-auto flex items-center max-w-[calc(100vw-1rem)] overflow-x-auto custom-scrollbar p-1.5 bg-[#1e1e20]/85 backdrop-blur-md border border-white/10 rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.3)] gap-1'>
    <div class='flex shrink-0 items-center gap-1.5 px-3 py-1 bg-white/5 rounded-full border border-white/5 mr-1'>
      <span class='text-[10px] text-obs-text-muted uppercase'>种子</span>
      <span class='text-xs font-mono font-bold text-white'>{seed}</span>
    </div>

    <div class='flex shrink-0 items-center rounded-full bg-white/[0.04] p-0.5 border border-white/[0.06]' role='group' aria-label='视图模式'>
      {#each VIEW_MODE_OPTIONS as option (option.id)}
        <button
          type='button'
          aria-pressed={viewMode === option.id}
          onclick={() => onSelectViewMode(option.id)}
          class="px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer {viewMode === option.id ? 'bg-obs-primary text-white shadow-sm' : 'text-obs-text-muted hover:text-white'}"
        >
          {option.label}
        </button>
      {/each}
    </div>

    {#if viewMode === 'atlas'}
      <div class='flex shrink-0 items-center rounded-full bg-white/[0.04] p-0.5 border border-white/[0.06]' role='group' aria-label='地图投影'>
        {#each MAP_PROJECTION_OPTIONS as proj (proj.id)}
          <button
            type='button'
            aria-pressed={projectionId === proj.id}
            onclick={() => onSelectProjection(proj.id)}
            title={proj.label}
            class="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer {projectionId === proj.id ? 'bg-white/15 text-white' : 'text-obs-text-muted hover:text-white'}"
          >
            {proj.shortLabel}
          </button>
        {/each}
      </div>
    {/if}

    <div class='w-px h-4 bg-white/10 mx-1'></div>
    <button type='button' aria-expanded={appState.parameterPanelOpen} onclick={() => appState.parameterPanelOpen = !appState.parameterPanelOpen} class="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer {appState.parameterPanelOpen ? 'bg-obs-primary text-white' : 'text-obs-text-muted hover:text-white hover:bg-white/10'}">参数</button>
    <button type='button' aria-expanded={appState.layerDrawerOpen} onclick={() => appState.layerDrawerOpen = !appState.layerDrawerOpen} class="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer {appState.layerDrawerOpen ? 'bg-obs-primary text-white' : 'text-obs-text-muted hover:text-white hover:bg-white/10'}">图层</button>
    <button type='button' aria-expanded={appState.overviewPanelOpen} onclick={() => appState.overviewPanelOpen = !appState.overviewPanelOpen} class="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer {appState.overviewPanelOpen ? 'bg-obs-primary text-white' : 'text-obs-text-muted hover:text-white hover:bg-white/10'}">概览</button>
    <button type='button' aria-expanded={appState.inspectorOpen} onclick={() => appState.inspectorOpen = !appState.inspectorOpen} class="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer {appState.inspectorOpen ? 'bg-obs-primary text-white' : 'text-obs-text-muted hover:text-white hover:bg-white/10'}">侦测</button>
    <div class='w-px h-4 bg-white/10 mx-1'></div>

    <button
      type='button'
      onclick={onResetCamera}
      title='重置相机至初始视角与比例尺'
      class='px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer text-obs-text-muted transition-colors hover:bg-white/10 hover:text-white'
    >
      重置视角
    </button>

    <div class='w-px h-4 bg-white/10 mx-1'></div>
    <button type='button' onclick={onRandomize} disabled={busy} class='px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer bg-white/10 text-obs-text-muted transition-colors hover:bg-white/20 hover:text-white disabled:opacity-40'>随机</button>
  </div>
</header>
