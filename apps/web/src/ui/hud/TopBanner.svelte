<script lang='ts'>
  import { Popover } from 'bits-ui'
  import Toggle from '@/ui/components/Toggle.svelte'
  import { appState } from '@/ui/state/app.svelte'

  interface Props {
    seed: string
    busy: boolean
    showSurface: boolean
    showFiveNeighborPoints: boolean
    rotate: boolean
    showAtmosphere: boolean
    showDayNight: boolean
    showRivers: boolean
    showLakes: boolean
    showGraticule: boolean
    satellite: boolean
    onRandomize: () => void
    onToggleSurface: (value: boolean) => void
    onToggleFiveNeighborPoints: (value: boolean) => void
    onToggleRotate: (value: boolean) => void
    onToggleAtmosphere: (value: boolean) => void
    onToggleDayNight: (value: boolean) => void
    onToggleRivers: (value: boolean) => void
    onToggleLakes: (value: boolean) => void
    onToggleGraticule: (value: boolean) => void
  }

  const {
    seed,
    busy,
    showSurface,
    showFiveNeighborPoints,
    rotate,
    showAtmosphere,
    showDayNight,
    showRivers,
    showLakes,
    showGraticule,
    satellite,
    onRandomize,
    onToggleSurface,
    onToggleFiveNeighborPoints,
    onToggleRotate,
    onToggleAtmosphere,
    onToggleDayNight,
    onToggleRivers,
    onToggleLakes,
    onToggleGraticule,
  }: Props = $props()
</script>

<header class='pointer-events-none fixed top-4 inset-x-0 z-40 flex justify-center'>
  <div class='pointer-events-auto flex items-center max-w-[calc(100vw-1rem)] overflow-x-auto custom-scrollbar p-1.5 bg-[#1e1e20]/85 backdrop-blur-md border border-white/10 rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.3)] gap-1'>
    <div class='flex shrink-0 items-center gap-1.5 px-3 py-1 bg-white/5 rounded-full border border-white/5 mr-2'>
      <span class='text-[10px] text-obs-text-muted uppercase'>种子</span>
      <span class='text-xs font-mono font-bold text-white'>{seed}</span>
    </div>
    <button type='button' aria-expanded={appState.parameterPanelOpen} onclick={() => appState.parameterPanelOpen = !appState.parameterPanelOpen} class="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer {appState.parameterPanelOpen ? 'bg-obs-primary text-white' : 'text-obs-text-muted hover:text-white hover:bg-white/10'}">参数</button>
    <button type='button' aria-expanded={appState.layerDrawerOpen} onclick={() => appState.layerDrawerOpen = !appState.layerDrawerOpen} class="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer {appState.layerDrawerOpen ? 'bg-obs-primary text-white' : 'text-obs-text-muted hover:text-white hover:bg-white/10'}">图层</button>
    <button type='button' aria-expanded={appState.inspectorOpen} onclick={() => appState.inspectorOpen = !appState.inspectorOpen} class="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer {appState.inspectorOpen ? 'bg-obs-primary text-white' : 'text-obs-text-muted hover:text-white hover:bg-white/10'}">侦测</button>
    <div class='w-px h-4 bg-white/10 mx-1'></div>
    <Popover.Root>
      <Popover.Trigger class='px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer text-obs-text-muted transition-colors hover:bg-white/10 hover:text-white'>显示</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={8} class='z-50 w-56 p-3 flex flex-col gap-2 rounded-xl bg-[#1e1e20]/95 backdrop-blur-md border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)]'>
          <Toggle label='表面显示' checked={showSurface} oncommit={onToggleSurface} />
          <Toggle label='五邻域中心' checked={showFiveNeighborPoints} oncommit={onToggleFiveNeighborPoints} />
          <Toggle label='经纬网格' checked={showGraticule} oncommit={onToggleGraticule} />
          <Toggle label='自转' checked={rotate} oncommit={onToggleRotate} />
          <Toggle label='大气光晕' checked={showAtmosphere} oncommit={onToggleAtmosphere} />
          <Toggle
            label='昼夜效果（卫星图）'
            checked={showDayNight}
            disabled={!satellite}
            oncommit={onToggleDayNight}
          />
          <Toggle label='河网' checked={showRivers} oncommit={onToggleRivers} />
          <Toggle label='湖泊' checked={showLakes} oncommit={onToggleLakes} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    <div class='w-px h-4 bg-white/10 mx-1'></div>
    <button type='button' onclick={onRandomize} disabled={busy} class='px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer bg-white/10 text-obs-text-muted transition-colors hover:bg-white/20 hover:text-white disabled:opacity-40'>随机</button>
  </div>
</header>
