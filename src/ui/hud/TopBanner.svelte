<script lang='ts'>
  import { Popover } from 'bits-ui'
  import Toggle from '@/ui/components/Toggle.svelte'
  import { appState } from '@/ui/state/app.svelte'

  let shareStatus = $state<'idle' | 'copied' | 'error'>('idle')
  let shareStatusTimer: ReturnType<typeof setTimeout> | undefined

  async function copyShareLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(appState.createShareUrl())
      shareStatus = 'copied'
    }
    catch {
      shareStatus = 'error'
    }

    if (shareStatusTimer)
      clearTimeout(shareStatusTimer)
    shareStatusTimer = setTimeout(() => shareStatus = 'idle', 2400)
  }
</script>

<header class='pointer-events-none fixed top-4 inset-x-0 z-40 flex justify-center'>
  <div class='pointer-events-auto flex items-center max-w-[calc(100vw-1rem)] overflow-x-auto custom-scrollbar p-1.5 bg-[#1e1e20]/85 backdrop-blur-md border border-white/10 rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.3)] gap-1'>

    <!-- 种子显示区 -->
    <div class='flex items-center gap-1.5 px-3 py-1 bg-white/5 rounded-full border border-white/5 mr-2'>
      <span class='text-[10px] text-obs-text-muted uppercase'>种子</span>
      <span class='text-xs font-mono font-bold text-white'>{appState.params.core.seed}</span>
    </div>

    <!-- 模块切换 (类似截图左侧的工具) -->
    <button
      type='button'
      onclick={() => appState.parameterPanelOpen = !appState.parameterPanelOpen}
      class="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer {appState.parameterPanelOpen ? 'bg-obs-primary text-white' : 'text-obs-text-muted hover:text-white hover:bg-white/10'}"
    >
      参数
    </button>
    <button
      type='button'
      onclick={() => appState.toggleLayerDrawer()}
      class="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer {appState.layerDrawerOpen ? 'bg-obs-primary text-white' : 'text-obs-text-muted hover:text-white hover:bg-white/10'}"
    >
      图层
    </button>
    <button
      type='button'
      onclick={() => appState.inspectorOpen = !appState.inspectorOpen}
      class="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer {appState.inspectorOpen ? 'bg-obs-primary text-white' : 'text-obs-text-muted hover:text-white hover:bg-white/10'}"
    >
      侦测
    </button>

    <div class='w-px h-4 bg-white/10 mx-1'></div>

    <!-- 视角操作 -->
    <Popover.Root>
      <Popover.Trigger
        class='px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer text-obs-text-muted hover:text-white hover:bg-white/10'
      >
        视图
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          class='z-50 w-28 p-1.5 flex flex-col gap-0.5 rounded-xl bg-[#1e1e20]/95 backdrop-blur-md border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)]'
        >
          <button
            type='button'
            onclick={() => appState.setViewMode('globe')}
            class="px-3 py-2 text-left text-xs font-medium rounded-lg transition-colors cursor-pointer {appState.viewMode === 'globe' ? 'bg-obs-primary/15 text-obs-primary' : 'text-obs-text-muted hover:text-obs-text-main hover:bg-white/[0.04]'}"
          >
            3D 星球
          </button>
          <button
            type='button'
            onclick={() => {
              appState.setViewMode('map')
              appState.setMapProjection('equal-earth')
            }}
            class="px-3 py-2 text-left text-xs font-medium rounded-lg transition-colors cursor-pointer {appState.viewMode === 'map' && appState.mapProjection === 'equal-earth' ? 'bg-obs-primary/15 text-obs-primary' : 'text-obs-text-muted hover:text-obs-text-main hover:bg-white/[0.04]'}"
          >
            2D 等面积
          </button>
          <button
            type='button'
            onclick={() => {
              appState.setViewMode('map')
              appState.setMapProjection('mercator')
            }}
            class="px-3 py-2 text-left text-xs font-medium rounded-lg transition-colors cursor-pointer {appState.viewMode === 'map' && appState.mapProjection === 'mercator' ? 'bg-obs-primary/15 text-obs-primary' : 'text-obs-text-muted hover:text-obs-text-main hover:bg-white/[0.04]'}"
          >
            2D 墨卡托
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>

    <Popover.Root>
      <Popover.Trigger
        class='px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer text-obs-text-muted hover:text-white hover:bg-white/10'
      >
        显示
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          class='z-50 w-56 p-3 flex flex-col gap-2 rounded-xl bg-[#1e1e20]/95 backdrop-blur-md border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)]'
        >
          <Toggle
            label='经纬网格'
            checked={appState.params.appearance.showGraticule}
            oncommit={checked => appState.updateParam('appearance', 'showGraticule', checked)}
          />
          <Toggle
            label='河网显示'
            checked={appState.params.appearance.showRivers}
            oncommit={checked => appState.updateParam('appearance', 'showRivers', checked)}
          />
          <Toggle
            label='云层显示'
            checked={appState.params.appearance.showClouds}
            oncommit={checked => appState.updateParam('appearance', 'showClouds', checked)}
          />
          <Toggle
            label='Cell 网格'
            checked={appState.params.appearance.wireframe}
            oncommit={checked => appState.updateParam('appearance', 'wireframe', checked)}
          />
          <Toggle
            label='大气光晕'
            checked={appState.params.appearance.showAtmosphere}
            oncommit={checked => appState.updateParam('appearance', 'showAtmosphere', checked)}
          />
          <Toggle
            label='高度位移'
            checked={appState.params.appearance.elevationDisplacement}
            oncommit={checked => appState.updateParam('appearance', 'elevationDisplacement', checked)}
          />
          <div class={appState.viewMode === 'map' ? 'opacity-30 pointer-events-none' : ''}>
            <Toggle
              label='昼夜效果'
              checked={appState.params.appearance.showDayNight}
              oncommit={checked => appState.updateParam('appearance', 'showDayNight', checked)}
            />
          </div>
          <div class={appState.viewMode === 'map' ? 'opacity-30 pointer-events-none' : ''}>
            <Toggle
              label='自转'
              checked={appState.params.appearance.autoRotate}
              oncommit={checked => appState.updateParam('appearance', 'autoRotate', checked)}
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>

    <div class='w-px h-4 bg-white/10 mx-1'></div>

    <!-- 系统操作 -->
    <button
      type='button'
      onclick={() => appState.randomizeSeed()}
      class='px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer bg-white/10 text-obs-text-muted hover:text-white hover:bg-white/20'
    >
      随机
    </button>
    <button
      type='button'
      onclick={() => void copyShareLink()}
      class='flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer bg-white/10 text-obs-text-muted hover:text-white hover:bg-white/20'
      title={shareStatus === 'error' ? '复制失败，请检查浏览器剪贴板权限' : '分享参数面板中的生成选项'}
    >
      {#if shareStatus === 'copied'}
        <!-- <Check class='w-3.5 h-3.5' /> -->
        <span>已复制</span>
      {:else}
        <!-- <Share2 class='w-3.5 h-3.5' /> -->
        <span>{shareStatus === 'error' ? '复制失败' : '分享'}</span>
      {/if}
    </button>

  </div>
</header>
