<script lang='ts'>
  import type { MapProjectionId, MapViewportMode } from '@another-earth/cartography'
  import { Check, Copy, Dices, Gauge, Globe, ImageDown, Layers, Map, Satellite, Settings, Share2, SlidersHorizontal } from '@lucide/svelte'
  import Slider from '@/ui/components/Slider.svelte'
  import Toggle from '@/ui/components/Toggle.svelte'
  import Tooltip from '@/ui/components/Tooltip.svelte'
  import { MAP_PROJECTION_OPTIONS, VIEW_MODE_OPTIONS } from '@/ui/hud/layer-presentation'
  import { appState, setExclusivePanel } from '@/ui/state/app.svelte'

  interface Props {
    busy: boolean
    viewMode: MapViewportMode
    projectionId: MapProjectionId
    onViewStateChange: () => void
    onRandomize: () => void
    onSelectViewMode: (mode: MapViewportMode) => void
    onSelectProjection: (projectionId: MapProjectionId) => void
    onExportScene: () => void
    shareUrl: string
    graticuleEnabled: boolean
    cellWireframeEnabled: boolean
    rotate: boolean
    rotateSpeedDegreesPerSecond: number
  }

  let {
    busy,
    viewMode,
    projectionId,
    onViewStateChange,
    onRandomize,
    onSelectViewMode,
    onSelectProjection,
    onExportScene,
    shareUrl,
    graticuleEnabled = $bindable(),
    cellWireframeEnabled = $bindable(),
    rotate = $bindable(),
    rotateSpeedDegreesPerSecond = $bindable(),
  }: Props = $props()

  let shareCopied = $state(false)
  let shareCopyTimer: ReturnType<typeof setTimeout> | undefined

  async function copyShareUrl(): Promise<void> {
    if (!shareUrl)
      return
    try {
      await navigator.clipboard.writeText(shareUrl)
      shareCopied = true
      if (shareCopyTimer)
        clearTimeout(shareCopyTimer)
      shareCopyTimer = setTimeout(() => {
        shareCopied = false
      }, 1600)
    }
    catch {
      shareCopied = false
    }
  }

  let rail = $state<HTMLElement | null>(null)
  let openCard = $state<'view' | 'share' | 'settings' | null>(null)

  const globeLabel = VIEW_MODE_OPTIONS.find(option => option.id === 'globe')?.label ?? '3D 星球'

  const iconButtonClass = (active: boolean) =>
    `flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
      active
        ? 'bg-obs-primary text-white'
        : 'text-obs-text-muted hover:bg-white/10 hover:text-white'
    }`

  function toggleCard(card: 'view' | 'share' | 'settings') {
    openCard = openCard === card ? null : card
  }

  function togglePanel(panel: 'parameters' | 'layers' | 'overview' | 'inspector') {
    openCard = null
    const isOpen = panel === 'parameters'
      ? appState.parameterPanelOpen
      : panel === 'layers'
      ? appState.layerDrawerOpen
      : panel === 'overview'
      ? appState.overviewPanelOpen
      : appState.inspectorOpen
    setExclusivePanel(isOpen ? null : panel)
  }

  function selectGlobe() {
    onSelectViewMode('globe')
    openCard = null
  }

  function selectProjection(id: MapProjectionId) {
    onSelectViewMode('atlas')
    onSelectProjection(id)
    openCard = null
  }

  function exportScene() {
    onExportScene()
  }

  function onPointerDown(event: PointerEvent) {
    if (!openCard)
      return
    const target = event.target
    if (target instanceof Node && rail?.contains(target))
      return
    openCard = null
  }
</script>

<svelte:window onpointerdown={onPointerDown} />

<aside
  bind:this={rail}
  class='pointer-events-auto fixed top-1/2 left-[var(--app-sidebar-inset)] -translate-y-1/2 z-[45] flex w-[var(--app-sidebar-width)] flex-col items-center rounded-xl border border-white/10 bg-[#1e1e20]/85 py-2 text-obs-text-main shadow-[4px_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-md'
  aria-label='工作台工具'
>
  <Tooltip content='随机' side='right'>
    <button type='button' class={iconButtonClass(false)} aria-label='随机' onclick={onRandomize} disabled={busy}>
      <Dices class='h-4 w-4' />
    </button>
  </Tooltip>

  <div class='mt-2 flex w-full flex-col items-center gap-1 px-1.5'>
    <div class='relative'>
      <Tooltip content='视图' side='right'>
        <button
          type='button'
          class={iconButtonClass(openCard === 'view')}
          aria-expanded={openCard === 'view'}
          aria-haspopup='dialog'
          aria-label='视图'
          onclick={() => toggleCard('view')}
        >
          {#if viewMode === 'globe'}
            <Globe class='h-4 w-4' />
          {:else}
            <Map class='h-4 w-4' />
          {/if}
        </button>
      </Tooltip>

      {#if openCard === 'view'}
        <div
          class='absolute top-0 left-[calc(100%+0.625rem)] z-50 w-52 rounded-xl border border-white/10 bg-[#1e1e20]/95 p-2 text-obs-text-main shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md'
          role='dialog'
          aria-label='视图选择'
        >
          <p class='m-0 px-2 pt-1 pb-1 text-[10px] font-semibold tracking-wide text-obs-text-dim uppercase'>3D</p>
          <button
            type='button'
            class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors {viewMode === 'globe' ? 'bg-obs-primary text-white' : 'text-obs-text-muted hover:bg-white/10 hover:text-white'}"
            aria-pressed={viewMode === 'globe'}
            onclick={selectGlobe}
          >
            <Globe class='h-3.5 w-3.5 shrink-0' />
            {globeLabel}
          </button>

          <p class='m-0 px-2 pt-2.5 pb-1 text-[10px] font-semibold tracking-wide text-obs-text-dim uppercase'>2D</p>
          <div class='flex flex-col gap-0.5' role='group' aria-label='地图投影'>
            {#each MAP_PROJECTION_OPTIONS as proj (proj.id)}
              <button
                type='button'
                class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors {viewMode === 'atlas' && projectionId === proj.id ? 'bg-obs-primary text-white' : 'text-obs-text-muted hover:bg-white/10 hover:text-white'}"
                aria-pressed={viewMode === 'atlas' && projectionId === proj.id}
                title={proj.label}
                onclick={() => selectProjection(proj.id)}
              >
                <Map class='h-3.5 w-3.5 shrink-0' />
                {proj.shortLabel}
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <Tooltip content='参数' side='right'>
      <button type='button' class={iconButtonClass(appState.parameterPanelOpen)} aria-expanded={appState.parameterPanelOpen} aria-label='参数' onclick={() => togglePanel('parameters')}>
        <SlidersHorizontal class='h-4 w-4' />
      </button>
    </Tooltip>
    <Tooltip content='图层' side='right'>
      <button type='button' class={iconButtonClass(appState.layerDrawerOpen)} aria-expanded={appState.layerDrawerOpen} aria-label='图层' onclick={() => togglePanel('layers')}>
        <Layers class='h-4 w-4' />
      </button>
    </Tooltip>
    <Tooltip content='概览' side='right'>
      <button type='button' class={iconButtonClass(appState.overviewPanelOpen)} aria-expanded={appState.overviewPanelOpen} aria-label='概览' onclick={() => togglePanel('overview')}>
        <Gauge class='h-4 w-4' />
      </button>
    </Tooltip>
    <Tooltip content='侦测' side='right'>
      <button type='button' class={iconButtonClass(appState.inspectorOpen)} aria-expanded={appState.inspectorOpen} aria-label='侦测' onclick={() => togglePanel('inspector')}>
        <Satellite class='h-4 w-4' />
      </button>
    </Tooltip>
  </div>

  <div class='mt-2 flex w-full flex-col items-center gap-1 border-t border-white/10 px-1.5 pt-2 pb-0.5'>
    <div class='relative'>
      <Tooltip content='分享' side='right'>
        <button
          type='button'
          class={iconButtonClass(openCard === 'share')}
          aria-expanded={openCard === 'share'}
          aria-haspopup='dialog'
          aria-label='分享'
          onclick={() => toggleCard('share')}
        >
          <Share2 class='h-4 w-4' />
        </button>
      </Tooltip>
      {#if openCard === 'share'}
        <div
          class='absolute bottom-0 left-[calc(100%+0.625rem)] z-50 w-72 rounded-xl border border-white/10 bg-[#1e1e20]/85 p-2 text-obs-text-main shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md'
          role='dialog'
          aria-label='分享'
        >
          <p class='m-0 px-2 pt-1 pb-1.5 text-[10px] font-semibold tracking-wide text-obs-text-dim uppercase'>分享</p>
          <div class='mb-1.5 flex items-center gap-1 rounded-lg border border-white/10 bg-black/25 px-2 py-1.5'>
            <input
              class='min-w-0 flex-1 bg-transparent font-mono text-[10px] text-obs-text-main outline-none'
              aria-label='分享链接'
              readonly
              value={shareUrl}
            />
            <button
              type='button'
              class='flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-obs-text-muted transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40'
              aria-label={shareCopied ? '已复制' : '复制链接'}
              title={shareCopied ? '已复制' : '复制链接'}
              onclick={copyShareUrl}
              disabled={!shareUrl}
            >
              {#if shareCopied}
                <Check class='h-3.5 w-3.5' />
              {:else}
                <Copy class='h-3.5 w-3.5' />
              {/if}
            </button>
          </div>
          <button
            type='button'
            class='flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-obs-text-muted transition-colors hover:bg-white/10 hover:text-white'
            onclick={exportScene}
          >
            <ImageDown class='h-3.5 w-3.5 shrink-0' />
            导出图片
          </button>
        </div>
      {/if}
    </div>
    <div class='relative'>
      <Tooltip content='设置' side='right'>
        <button
          type='button'
          class={iconButtonClass(openCard === 'settings')}
          aria-expanded={openCard === 'settings'}
          aria-haspopup='dialog'
          aria-label='设置'
          onclick={() => toggleCard('settings')}
        >
          <Settings class='h-4 w-4' />
        </button>
      </Tooltip>
      {#if openCard === 'settings'}
        <div
          class='absolute bottom-0 left-[calc(100%+0.625rem)] z-50 w-64 rounded-xl border border-white/10 bg-[#1e1e20]/95 p-3 text-obs-text-main shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md'
          role='dialog'
          aria-label='设置'
        >
          <p class='m-0 px-1 pt-0.5 pb-1.5 text-[10px] font-semibold tracking-wide text-obs-text-dim uppercase'>设置</p>
          <Toggle label='图例显示' checked={appState.legendVisible} oncommit={value => appState.legendVisible = value} />
          <Toggle label='地图导航' checked={appState.mapControlsVisible} oncommit={value => appState.mapControlsVisible = value} />
          <Toggle label='经纬网格' checked={graticuleEnabled} oncommit={(value) => {
            graticuleEnabled = value
            onViewStateChange()
          }} />
          <Toggle label='Cell 边界网格' checked={cellWireframeEnabled} oncommit={(value) => {
            cellWireframeEnabled = value
            onViewStateChange()
          }} />
          <Toggle label='自转' description='仅 3D 星球' checked={rotate} disabled={viewMode !== 'globe'} oncommit={(value) => {
            rotate = value
            onViewStateChange()
          }} />
          {#if rotate && viewMode === 'globe'}
            <div class='pl-2'>
              <Slider
                label='自转速度'
                description='地球绕极轴向东转动的角速度。'
                bind:value={rotateSpeedDegreesPerSecond}
                min={0.1}
                max={30}
                step={0.1}
                decimals={1}
                unit='°/秒'
                onchange={onViewStateChange}
              />
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</aside>
