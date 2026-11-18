<script lang='ts'>
  import type { MapProjectionId, MapViewportMode } from '@another-earth/cartography'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { LayerStatistics } from '@/world-view/layer-statistics'
  import { AlertTriangle } from '@lucide/svelte'
  import GenerationLoading from '@/ui/hud/GenerationLoading.svelte'
  import LayerPanel from '@/ui/hud/LayerPanel.svelte'
  import LegendPanel from '@/ui/hud/LegendPanel.svelte'
  import MapControls from '@/ui/hud/MapControls.svelte'
  import OverviewPanel from '@/ui/hud/OverviewPanel.svelte'
  import ParameterPanel from '@/ui/hud/ParameterPanel.svelte'
  import RegionInspector from '@/ui/hud/RegionInspector.svelte'
  import ReloadPrompt from '@/ui/hud/ReloadPrompt.svelte'
  import Sidebar from '@/ui/hud/Sidebar.svelte'
  import { appState } from '@/ui/state/app.svelte'

  type OverviewPanelData = Pick<ComponentProps<typeof OverviewPanel>, 'worldSummary' | 'stages' | 'stats' | 'gpuCounts'>
  type ParameterPanelData = Pick<ComponentProps<typeof ParameterPanel>, 'level' | 'seed' | 'irregularity' | 'geologyParameters' | 'terrainParameters' | 'landformParameters' | 'climateParameters' | 'hydrologyParameters'>
  type LayerPanelState = Pick<ComponentProps<typeof LayerPanel>, 'styleId' | 'activeThematicId' | 'surfaceEnabled' | 'enabledOverlayIds' | 'showAtmosphere' | 'showDayNight' | 'showPolarIce'>
  type SettingsDisplayState = Pick<ComponentProps<typeof Sidebar>, 'graticuleEnabled' | 'cellWireframeEnabled' | 'rotate' | 'rotateSpeedDegreesPerSecond'>
  type GenerationLoadingState = ComponentProps<typeof GenerationLoading>['state']
  type RegionInspectionData = ComponentProps<typeof RegionInspector>['inspection']

  interface Props extends ParameterPanelData, LayerPanelState, SettingsDisplayState {
    busy: boolean
    generationLoadingState: GenerationLoadingState
    error: string
    inspection: RegionInspectionData
    viewMode: MapViewportMode
    projectionId: MapProjectionId
    onGenerate: () => void
    onForceRegenerate: () => void
    onChooseLevel: () => void
    hasGenerated: boolean
    onCancel: () => void
    onRandomize: () => void
    onSelectViewMode: (mode: MapViewportMode) => void
    onSelectProjection: (projectionId: MapProjectionId) => void
    onViewStateChange: () => void
    hasCirculation: boolean | undefined
    hasGeographicNames: boolean | undefined
    onZoom: (delta: number) => void
    onResetCamera: () => void
    onExportScene: () => void
    shareUrl: string
    viewport: Snippet
    layerStatistics?: LayerStatistics
    climateMonth: number
    copiedStats: boolean
    onClimateMonthChange: (month: number) => void
    onClimatePeriodChange: (monthly: boolean) => void
    onCopyStatistics: () => void
    overviewData: OverviewPanelData
  }

  let {
    busy,
    generationLoadingState,
    error,
    inspection,
    viewMode,
    projectionId,
    onGenerate,
    onForceRegenerate,
    onChooseLevel,
    hasGenerated,
    onCancel,
    onRandomize,
    onSelectViewMode,
    onSelectProjection,
    onViewStateChange,
    hasCirculation,
    hasGeographicNames,
    onZoom,
    onResetCamera,
    onExportScene,
    shareUrl,
    viewport,
    layerStatistics,
    climateMonth,
    copiedStats,
    onClimateMonthChange,
    onClimatePeriodChange,
    onCopyStatistics,
    overviewData,
    level = $bindable(),
    seed = $bindable(),
    irregularity = $bindable(),
    geologyParameters = $bindable(),
    terrainParameters = $bindable(),
    landformParameters = $bindable(),
    climateParameters = $bindable(),
    hydrologyParameters = $bindable(),
    styleId = $bindable(),
    activeThematicId = $bindable(),
    surfaceEnabled = $bindable(),
    enabledOverlayIds = $bindable(),
    graticuleEnabled = $bindable(),
    cellWireframeEnabled = $bindable(),
    rotate = $bindable(),
    rotateSpeedDegreesPerSecond = $bindable(),
    showAtmosphere = $bindable(),
    showDayNight = $bindable(),
    showPolarIce = $bindable(),
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

  <Sidebar
    {busy}
    {viewMode}
    {projectionId}
    {onViewStateChange}
    {onRandomize}
    onSelectViewMode={mode => onSelectViewMode(mode)}
    onSelectProjection={id => onSelectProjection(id)}
    {onExportScene}
    {shareUrl}
    bind:graticuleEnabled
    bind:cellWireframeEnabled
    bind:rotate
    bind:rotateSpeedDegreesPerSecond
  />

  <ParameterPanel
    open={appState.parameterPanelOpen}
    {busy}
    onClose={() => appState.parameterPanelOpen = false}
    {onGenerate}
    {onForceRegenerate}
    {onChooseLevel}
    {hasGenerated}
    bind:level
    bind:seed
    bind:irregularity
    bind:geologyParameters
    bind:terrainParameters
    bind:landformParameters
    bind:climateParameters
    bind:hydrologyParameters
  />
  <LayerPanel
    open={appState.layerDrawerOpen}
    onClose={() => appState.layerDrawerOpen = false}
    {onViewStateChange}
    {viewMode}
    {hasCirculation}
    {hasGeographicNames}
    bind:styleId
    bind:activeThematicId
    bind:surfaceEnabled
    bind:enabledOverlayIds
    bind:showAtmosphere
    bind:showDayNight
    bind:showPolarIce
  />
  <LegendPanel
    open={appState.legendVisible}
    onClose={() => appState.legendVisible = false}
    {layerStatistics}
    {activeThematicId}
    {climateMonth}
    {copiedStats}
    onClimateMonthChange={onClimateMonthChange}
    onClimatePeriodChange={onClimatePeriodChange}
    onCopyStatistics={onCopyStatistics}
  />
  <MapControls
    open={appState.mapControlsVisible}
    onZoomIn={() => onZoom(0.5)}
    onZoomOut={() => onZoom(-0.5)}
    onResetView={onResetCamera}
  />
  <OverviewPanel
    open={appState.overviewPanelOpen}
    onClose={() => appState.overviewPanelOpen = false}
    {...overviewData}
  />
  <RegionInspector open={appState.inspectorOpen} {inspection} />
  <GenerationLoading active={busy} state={generationLoadingState} onCancel={onCancel} />
  <ReloadPrompt />

  {#if error}
    <div class='pointer-events-auto fixed bottom-4 right-4 left-[calc(var(--app-sidebar-inset)+var(--app-sidebar-width)+0.75rem)] z-50 mx-auto max-w-xl rounded-xl border border-red-300/20 bg-[#1e1e20]/95 p-3 text-sm text-red-200 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-md' role='alert'>
      <div class='flex items-start gap-2'><AlertTriangle class='mt-0.5 h-4 w-4 shrink-0 text-red-300' /><span>{error}</span></div>
    </div>
  {/if}
</div>
