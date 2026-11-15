<script lang='ts'>
  import type { MapProjectionId, MapViewportMode } from '@another-earth/cartography'
  import type { Snippet } from 'svelte'
  import { AlertTriangle } from '@lucide/svelte'
  import Loading from '@/ui/components/Loading.svelte'
  import LayerBar from '@/ui/hud/LayerBar.svelte'
  import OverviewPanel from '@/ui/hud/OverviewPanel.svelte'
  import ParameterPanel from '@/ui/hud/ParameterPanel.svelte'
  import RegionInspector from '@/ui/hud/RegionInspector.svelte'
  import ReloadPrompt from '@/ui/hud/ReloadPrompt.svelte'
  import TopBanner from '@/ui/hud/TopBanner.svelte'
  import { appState } from '@/ui/state/app.svelte'

  interface Props {
    seed: string
    status: string
    busy: boolean
    progress: number
    error: string
    hasSelection: boolean
    selectionLabel: string
    viewMode: MapViewportMode
    projectionId: MapProjectionId
    onGenerate: () => void
    onCancel: () => void
    onRandomize: () => void
    onSelectViewMode: (mode: MapViewportMode) => void
    onSelectProjection: (projectionId: MapProjectionId) => void
    onResetCamera: () => void
    viewport: Snippet
    coreContent: Snippet
    natureContent: Snippet
    civilizationContent: Snippet
    layerContent: Snippet
    overviewContent: Snippet
    inspectorContent: Snippet
  }

  const {
    seed,
    status,
    busy,
    progress,
    error,
    hasSelection,
    selectionLabel,
    viewMode,
    projectionId,
    onGenerate,
    onCancel,
    onRandomize,
    onSelectViewMode,
    onSelectProjection,
    onResetCamera,
    viewport,
    coreContent,
    natureContent,
    civilizationContent,
    layerContent,
    overviewContent,
    inspectorContent,
  }: Props = $props()
</script>

<svelte:head>
  <title>Another Earth Generator</title>
  <meta name='description' content='Another Earth 创世工作台' />
</svelte:head>

<div class='relative h-dvh w-screen overflow-hidden bg-obs-bg text-obs-text-main'>
  <main class='absolute inset-0 overflow-hidden' aria-label='行星视口' aria-busy={busy}>
    {@render viewport()}
  </main>

  <TopBanner
    {seed}
    {busy}
    {viewMode}
    {projectionId}
    {onRandomize}
    onSelectViewMode={mode => onSelectViewMode(mode)}
    onSelectProjection={id => onSelectProjection(id)}
    {onResetCamera}
  />

  <ParameterPanel
    open={appState.parameterPanelOpen}
    {busy}
    onClose={() => appState.parameterPanelOpen = false}
    {onGenerate}
    {coreContent}
    {natureContent}
    {civilizationContent}
  />
  <LayerBar open={appState.layerDrawerOpen} onClose={() => appState.layerDrawerOpen = false}>
    {@render layerContent()}
  </LayerBar>
  <OverviewPanel open={appState.overviewPanelOpen} onClose={() => appState.overviewPanelOpen = false}>
    {@render overviewContent()}
  </OverviewPanel>
  <RegionInspector open={appState.inspectorOpen} {hasSelection} {selectionLabel}>
    {@render inspectorContent()}
  </RegionInspector>
  <Loading active={busy} message={status} {progress} onCancel={onCancel} />
  <ReloadPrompt needRefresh={false} />

  {#if error}
    <div class='pointer-events-auto fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-xl border border-red-300/20 bg-[#1e1e20]/95 p-3 text-sm text-red-200 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-md' role='alert'>
      <div class='flex items-start gap-2'><AlertTriangle class='mt-0.5 h-4 w-4 shrink-0 text-red-300' /><span>{error}</span></div>
    </div>
  {/if}
</div>
