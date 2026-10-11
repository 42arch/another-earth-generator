import { mount } from 'svelte'
import WorldEngine from '@/core/world/world-engine'
import AppUI from '@/ui/AppUI.svelte'
import { getPipelineStageLabel } from '@/ui/hud/pipeline-stage-labels'
import { appState } from '@/ui/state/app.svelte'
import './style.css'

function main() {
  appState.restoreFromShareHash(window.location.hash)

  const appContainer = document.getElementById('app')
  const canvas = document.getElementById('globe-canvas')
  if (!(appContainer instanceof HTMLElement))
    throw new TypeError('App container element was not found')
  if (!(canvas instanceof HTMLCanvasElement))
    throw new TypeError('Globe canvas element was not found')

  const worldEngine = new WorldEngine(canvas, appState.params, {
    onRegionSelected: (regionInfo) => {
      appState.selectedRegion = regionInfo
      if (regionInfo?.settlement || regionInfo?.route)
        appState.inspectorOpen = true
    },
    onWorldSummary: (summary) => {
      appState.worldSummary = summary
    },
    onPipelineStageStart: (stageName) => {
      appState.setGenerating(true, getPipelineStageLabel(stageName))
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
