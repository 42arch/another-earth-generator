<script lang='ts'>
  import BottomToolbar from '@/ui/hud/BottomToolbar.svelte'
  import CivLoading from '@/ui/components/CivLoading.svelte'
  import CodexDrawer from '@/ui/hud/CodexDrawer.svelte'
  import LayerBar from '@/ui/hud/LayerBar.svelte'
  import RegionInspector from '@/ui/hud/RegionInspector.svelte'
  import TopBanner from '@/ui/hud/TopBanner.svelte'
  import { uiState } from '@/ui/state/ui-state.svelte'
</script>

<div class='relative w-full h-full pointer-events-none select-none overflow-hidden font-serif'>
  <!-- 创世星盘加载遮罩 -->
  <CivLoading />

  <!-- 顶部极简状态栏 -->
  <TopBanner />

  <!-- 创世神典侧边参数抽屉 -->
  <CodexDrawer />

  <!-- 右侧图层与视界面板 -->
  <LayerBar />

  <!-- 左下角地块与聚落详报 -->
  {#if uiState.inspectorOpen}
    <RegionInspector />
  {/if}

  <!-- 底部集成悬浮操作栏 -->
  <BottomToolbar />
</div>
