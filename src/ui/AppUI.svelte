<script lang='ts'>
  import Loading from '@/ui/components/Loading.svelte'
  import BottomToolbar from '@/ui/hud/BottomToolbar.svelte'
  import LayerBar from '@/ui/hud/LayerBar.svelte'
  import ParameterPanel from '@/ui/hud/ParameterPanel.svelte'
  import RegionInspector from '@/ui/hud/RegionInspector.svelte'
  import ReloadPrompt from '@/ui/hud/ReloadPrompt.svelte'
  import TopBanner from '@/ui/hud/TopBanner.svelte'
  import { appState } from '@/ui/state/app.svelte'

  $effect(() => {
    if (appState.engine) {
      appState.engine.setRegionPickingEnabled(appState.inspectorOpen)
    }
  })
</script>

<div class='relative w-full h-full pointer-events-none select-none overflow-hidden'>
  <!-- 创世星盘加载遮罩 -->
  <Loading />

  <!-- 顶部极简状态栏 -->
  <TopBanner />

  <!-- 侧边参数抽屉 -->
  <ParameterPanel />

  <!-- 右侧图层 -->
  <LayerBar />

  <!-- 左下角地块与聚落详报 -->
  {#if appState.inspectorOpen}
    <RegionInspector />
  {/if}

  <!-- 底部集成悬浮操作栏 -->
  <BottomToolbar />

  <!-- PWA 更新提示 -->
  <ReloadPrompt />
</div>
