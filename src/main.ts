import { mount, unmount } from 'svelte'
import WorldEngine from '@/core/world/world-engine'
import AppUI from '@/ui/AppUI.svelte'
import { uiState } from '@/ui/state/ui-state.svelte'
import './style.css'

function main() {
  const appContainer = document.getElementById('app')
  const canvas = document.getElementById('globe-canvas')
  if (!(appContainer instanceof HTMLElement))
    throw new TypeError('App container element was not found')
  if (!(canvas instanceof HTMLCanvasElement))
    throw new TypeError('Globe canvas element was not found')

  const info = document.getElementById('globe-info')
  if (info)
    info.style.display = 'none'

  const worldEngine = new WorldEngine(canvas, info, uiState.params, {
    onRegionSelected: (regionInfo) => {
      uiState.selectedRegion = regionInfo
      if (regionInfo)
        uiState.inspectorOpen = true
    },
    onWorldSummary: (summary) => {
      uiState.worldSummary = summary
    },
  })

  // 初始化 Svelte 响应式状态与引擎绑定
  uiState.init(worldEngine)

  // 挂载 Svelte 5 游戏 UI
  const app = mount(AppUI, { target: appContainer })

  void uiState.regenerateWorld('正在生成初始世界…')

  const cleanup = () => {
    uiState.destroy()
    void unmount(app)
  }
  window.addEventListener('beforeunload', cleanup, { once: true })
  import.meta.hot?.dispose(() => {
    window.removeEventListener('beforeunload', cleanup)
    cleanup()
  })
}

try {
  main()
}
catch (error) {
  console.error('Failed to initialize the map generator', error)
}
