export const appState = $state({
  parameterPanelOpen: false,
  layerDrawerOpen: true,
  legendVisible: true,
  mapControlsVisible: false,
  overviewPanelOpen: false,
  inspectorOpen: false,
})

export type AppPanelId = 'parameters' | 'layers' | 'overview' | 'inspector'

export function setExclusivePanel(panel: AppPanelId | null): void {
  appState.parameterPanelOpen = panel === 'parameters'
  appState.layerDrawerOpen = panel === 'layers'
  appState.overviewPanelOpen = panel === 'overview'
  appState.inspectorOpen = panel === 'inspector'
}
