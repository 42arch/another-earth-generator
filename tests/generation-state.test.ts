import type WorldEngine from '@/core/world/world-engine'
import { describe, expect, it, vi } from 'vitest'
import { UIState } from '@/ui/state/ui-state.svelte'
import { LAYER_SETTINGS, PARAMETER_GROUPS, THEME_SETTINGS } from '@/ui/state/layer-settings'
import { PARAMETERS } from '@/ui/state/parameter-catalog'
import { PARAMETER_STAGE } from '@/core/world/generation-plan'

function createState() {
  const engine = {
    updateParams: vi.fn(), updateAppearance: vi.fn(),
    regenerate: vi.fn().mockResolvedValue(undefined),
    cancelGeneration: vi.fn(), destroy: vi.fn(),
  }
  const state = new UIState()
  state.engine = engine as unknown as WorldEngine
  return { state, engine }
}

describe('generation UI state', () => {
  it('batches world parameters until apply and keeps appearance changes immediate', async () => {
    const { state, engine } = createState()
    state.updateParam('infiltration', 0.3)
    state.updateParam('religionCount', 8)
    state.updateParam('showRivers', false)
    expect(engine.updateAppearance).toHaveBeenCalledOnce()
    expect(engine.regenerate).not.toHaveBeenCalled()
    expect(state.changedParamCount).toBe(2)
    await state.applyChanges()
    expect(engine.regenerate).toHaveBeenCalledExactlyOnceWith('hydrology', expect.any(Function))
    expect(state.changedParamCount).toBe(0)
    expect(state.isGenerating).toBe(false)
  })

  it('discards pending generation parameters without reverting appearance', () => {
    const { state } = createState()
    state.updateParam('infiltration', 0.4)
    state.updateParam('showRivers', false)
    state.discardChanges()
    expect(state.params.infiltration).toBe(state.appliedParams.infiltration)
    expect(state.params.showRivers).toBe(false)
  })

  it('allows only one analysis overlay at a time', () => {
    const { state, engine } = createState()
    state.setAnalysisLayer('showTemperature')
    state.setAnalysisLayer('showPrecipitation')
    expect(state.params.showTemperature).toBe(false)
    expect(state.params.showPrecipitation).toBe(true)
    expect(engine.updateAppearance).toHaveBeenCalledTimes(2)
  })

  it('selects newly enabled layers without hiding other overlays or losing drafts', () => {
    const { state, engine } = createState()
    state.selectLayer('showRivers')
    state.updateParam('riverMinLength', 7)
    state.setLayerVisibility('showRoads', true)
    expect(state.settingsContext).toEqual({ kind: 'layer', key: 'showRoads' })
    expect(state.params.showRivers).toBe(true)
    state.setLayerVisibility('showRoads', false)
    expect(state.settingsContext.key).toBe('showRoads')
    state.selectLayer('showRivers')
    expect(state.params.riverMinLength).toBe(7)
    expect(state.changedParamCount).toBe(1)
    expect(engine.regenerate).not.toHaveBeenCalled()
  })

  it('shares water drafts across contexts and preserves them when hiding or closing panels', () => {
    const { state } = createState()
    state.selectLayer('showRivers')
    state.updateParam('infiltration', 0.3)
    state.selectLayer('showFlux')
    state.setLayerVisibility('showRivers', false)
    expect(state.settingsContext.key).toBe('showFlux')
    expect(state.params.infiltration).toBe(0.3)
    state.closePanels()
    state.openSettings()
    expect(state.layerDrawerOpen).toBe(true)
    expect(state.settingsContext.key).toBe('showFlux')
    expect(state.params.infiltration).toBe(0.3)
  })

  it('switches themes and analysis contexts independently of feature visibility', () => {
    const { state } = createState()
    state.selectLayer('showRoads')
    state.setDisplayMode('cultures')
    expect(state.settingsContext).toEqual({ kind: 'theme', key: 'cultures' })
    expect(state.params.showRoads).toBe(true)
    state.selectLayer('showTemperature')
    state.selectLayer('showPrecipitation')
    expect(state.settingsContext.key).toBe('showPrecipitation')
    expect(state.params.showTemperature).toBe(false)
    expect(state.params.showRoads).toBe(true)
    expect(state.params.displayMode).toBe('cultures')
    expect(state.hasPendingChanges).toBe(false)
  })

  it('keeps all generation parameters reachable through general or contextual settings', () => {
    const reachable = new Set<string>(['seed', 'subdivision', 'physicalRadiusMeters', ...PARAMETER_GROUPS.terrain.keys])
    for (const context of [...Object.values(THEME_SETTINGS), ...Object.values(LAYER_SETTINGS)]) {
      for (const group of [...context.groups, ...context.shared]) {
        for (const key of PARAMETER_GROUPS[group].keys) {
          expect(PARAMETERS[key]).toBeDefined()
          reachable.add(key)
        }
      }
    }
    const generationKeys = Object.entries(PARAMETER_STAGE).filter(([, stage]) => stage !== null).map(([key]) => key)
    expect([...reachable].sort()).toEqual(generationKeys.sort())
  })

  it('clears loading and exposes a retryable error when generation fails', async () => {
    const { state, engine } = createState()
    engine.regenerate.mockRejectedValueOnce(new Error('failed'))
    await state.regenerateWorld()
    expect(state.isGenerating).toBe(false)
    expect(state.generationError).toBe('failed')
    await state.regenerateWorld()
    expect(state.generationError).toBeNull()
    expect(state.isGenerating).toBe(false)
  })

  it('does not let an older completion clear a newer loading state', async () => {
    const { state, engine } = createState()
    let firstResolve!: () => void
    let secondResolve!: () => void
    engine.regenerate.mockImplementationOnce(() => new Promise<void>((resolve) => { firstResolve = resolve }))
    engine.regenerate.mockImplementationOnce(() => new Promise<void>((resolve) => { secondResolve = resolve }))
    const first = state.regenerateWorld()
    const second = state.regenerateWorld()
    firstResolve()
    await first
    expect(state.isGenerating).toBe(true)
    secondResolve()
    await second
    expect(state.isGenerating).toBe(false)
  })

  it('cancels generation while preserving unapplied edits', () => {
    const { state, engine } = createState()
    state.updateParam('infiltration', 0.4)
    state.cancelGeneration()
    expect(engine.regenerate).not.toHaveBeenCalled()
    expect(engine.cancelGeneration).toHaveBeenCalledOnce()
    expect(state.hasPendingChanges).toBe(true)
    expect(state.isGenerating).toBe(false)
  })
})
