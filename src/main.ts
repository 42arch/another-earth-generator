import { mount } from 'svelte'
import WorldEngine from '@/core/world/world-engine'
import AppUI from '@/ui/AppUI.svelte'
import { appState } from '@/ui/state/app.svelte'
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

  const worldEngine = new WorldEngine(canvas, info, appState.params, {
    onRegionSelected: (regionInfo) => {
      appState.selectedRegion = regionInfo
    },
    onWorldSummary: (summary) => {
      appState.worldSummary = summary
    },
    onPipelineProgress: (text) => {
      appState.setGenerating(true, text)
    },
  })

  // 初始化 Svelte 响应式状态与引擎绑定
  appState.init(worldEngine)

  // 挂载 Svelte 5 游戏 UI
  mount(AppUI, { target: appContainer })

  requestAnimationFrame(() => {
    void appState.regenerateWorld('正在构建球面网格与地壳板块…')
  })

  window.addEventListener('beforeunload', () => {
    worldEngine.destroy()
  }, { once: true })
}

try {
  main()
}
catch (error) {
  console.error('Failed to initialize the map generator', error)
}
