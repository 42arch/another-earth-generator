import type { MapPickResult } from '#picking/map-picker'
import type { MapProjectionId } from '#projections/map-projections'
import type { GpuResourceCounts } from '#rendering/gpu-resource-tracker'
import type { WorldViewportOptions } from '#rendering/viewport'
import type { CompiledMapStyle } from '#styles/compiler'
import type { LegendDescriptor, MapFontFaceDescriptor, MapStyleDocument, MapViewportMode } from '#styles/spec'
import type { WorldMapReader } from '@another-earth/world-core'
import type { GlobeLayerFilterState } from '#rendering/globe-view'
import { AtlasView } from '#rendering/atlas-view'
import { GlobeView } from '#rendering/globe-view'
import { GpuResourceTracker } from '#rendering/gpu-resource-tracker'
import { loadMapFontFaces } from '#rendering/layers/symbol-layer'
import { WorldViewport } from '#rendering/viewport'
import { MapSourceRegistry } from '#sources/registry'
import { StyleCompiler } from '#styles/compiler'
import { getBuiltinMapStylePreset, SATELLITE_STYLE_PRESET } from '#styles/presets'

export type { MapProjectionId } from '#projections/map-projections'

export interface CartographySessionOptions extends WorldViewportOptions {
  /** Optional custom font faces (`.woff2`, `.woff`, `.ttf`, `.otf`) to preload via the browser `FontFace` API. */
  readonly fonts?: readonly MapFontFaceDescriptor[]
}

export interface CartographyViewState {
  readonly viewMode: MapViewportMode
  readonly projectionId: MapProjectionId
  readonly styleId: string
  readonly customStyle?: MapStyleDocument
  readonly activeThematicId: string | null
  /** Draws the style's surface layers. Independent of the active thematic. */
  readonly surfaceEnabled: boolean
  readonly enabledOverlayIds: readonly string[]
  readonly climateMonth: number // 0..11
  readonly globeEffects: Readonly<{
    rotate: boolean
    atmosphere: boolean
    dayNight: boolean
  }>
  readonly selection: Readonly<{
    regionId: number | null
    featureId?: string | null
  }>
}

export const DEFAULT_CARTOGRAPHY_VIEW_STATE: CartographyViewState = Object.freeze({
  viewMode: 'globe',
  projectionId: 'equal-earth',
  styleId: 'satellite',
  activeThematicId: null,
  surfaceEnabled: true,
  enabledOverlayIds: Object.freeze(['rivers', 'lakes', 'coastlines', 'labels']),
  climateMonth: 0,
  globeEffects: Object.freeze({
    rotate: false,
    atmosphere: true,
    dayNight: false,
  }),
  selection: Object.freeze({
    regionId: null,
    featureId: null,
  }),
})

function layerFilterFromViewState(viewState: CartographyViewState): GlobeLayerFilterState {
  return {
    activeThematicId: viewState.activeThematicId,
    surfaceEnabled: viewState.surfaceEnabled,
    enabledOverlayIds: viewState.enabledOverlayIds,
    climateMonth: viewState.climateMonth,
    globeEffects: viewState.globeEffects,
    selection: viewState.selection,
  }
}

export interface PreparedWorldMap {
  readonly snapshotId: string
  dispose: () => void
}

interface InternalPreparedWorld extends PreparedWorldMap {
  readonly reader: WorldMapReader
  readonly registry: MapSourceRegistry
  readonly globeView: GlobeView
  atlasView: AtlasView | null
  readonly tracker: GpuResourceTracker
  readonly initialCompiledStyle: CompiledMapStyle
  readonly initialViewState: CartographyViewState
  readonly isDisposed: () => boolean
}

export interface CartographySession {
  readonly activeSnapshotId: string | null
  readonly activeLegend: LegendDescriptor | null
  prepareWorld: (
    reader: WorldMapReader,
    viewState: CartographyViewState,
    options?: { signal?: AbortSignal },
  ) => Promise<PreparedWorldMap>
  activateWorld: (prepared: PreparedWorldMap) => void
  setViewState: (next: CartographyViewState) => void
  loadFonts: (fonts: readonly MapFontFaceDescriptor[], options?: { signal?: AbortSignal }) => Promise<readonly string[]>
  resetCamera: () => void
  dispose: () => void
  readonly viewport: WorldViewport
  getActiveGlobeView: () => GlobeView | null
  getActiveAtlasView: () => AtlasView | null
  getActiveSourceRegistry: () => MapSourceRegistry | null
  getActiveGpuResourceCounts: () => GpuResourceCounts
  pickAtScreenPoint: (screenX: number, screenY: number) => MapPickResult | null
  simulateContextLost: () => void
  simulateContextRestored: () => void
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted)
    return
  const err = new Error('Cartography world preparation aborted')
  err.name = 'AbortError'
  throw err
}

/**
 * Creates a `CartographySession` managing atomic world preparation (`prepareWorld`),
 * activation (`activateWorld`), style/viewState hot-switching (`setViewState` across 3D `GlobeView` and 2D `AtlasView`),
 * deterministic GPU resource disposal, and `webglcontextlost`/`webglcontextrestored` recovery.
 */
export function createCartographySession(options: CartographySessionOptions = {}): CartographySession {
  const compiler = new StyleCompiler()
  const compiledPresetCache = new Map<string, CompiledMapStyle>()
  const sessionFonts: readonly MapFontFaceDescriptor[] = options.fonts ? [...options.fonts] : []

  let activePrepared: InternalPreparedWorld | null = null
  let currentViewState: CartographyViewState = DEFAULT_CARTOGRAPHY_VIEW_STATE
  let currentCompiledStyle: CompiledMapStyle = compileBuiltinOrFallback('satellite')
  let activeLegend: LegendDescriptor | null = null
  let isContextLost = false
  let sessionDisposed = false

  const viewport = new WorldViewport({
    ...options,
    onContextLost: () => {
      isContextLost = true
      options.onContextLost?.()
    },
    onContextRestored: () => {
      isContextLost = false
      restoreWebGlContextResources()
      options.onContextRestored?.()
    },
  })

  function compileBuiltinOrFallback(styleId: string): CompiledMapStyle {
    const cached = compiledPresetCache.get(styleId)
    if (cached)
      return cached
    const preset = getBuiltinMapStylePreset(styleId) ?? SATELLITE_STYLE_PRESET
    const compiled = compiler.compile(preset)
    compiledPresetCache.set(preset.id, compiled)
    return compiled
  }

  function resolveCompiledStyle(viewState: CartographyViewState): CompiledMapStyle {
    if (viewState.customStyle) {
      return compiler.compile(viewState.customStyle)
    }
    const preset = getBuiltinMapStylePreset(viewState.styleId)
    if (!preset) {
      return compiler.compile({
        ...SATELLITE_STYLE_PRESET,
        id: viewState.styleId,
      })
    }
    return compileBuiltinOrFallback(preset.id)
  }

  function ensureAtlasViewForPrepared(
    prepared: InternalPreparedWorld,
    compiledStyle: CompiledMapStyle,
    viewState: CartographyViewState,
  ): AtlasView {
    if (!prepared.atlasView) {
      const size = viewport.getSize()
      const atlasView = new AtlasView(prepared.reader, prepared.registry, {
        projectionId: viewState.projectionId,
        domElement: viewport.canvas,
        tracker: prepared.tracker,
      })
      atlasView.resize(size.width, size.height, size.pixelRatio)
      const pose = prepared.globeView.getCenterCoordinates()
      atlasView.setCenterCoordinates(pose.longitudeDegrees, pose.latitudeDegrees, pose.styleZoom)
      atlasView.applyStyleAndState(compiledStyle, layerFilterFromViewState(viewState))
      prepared.atlasView = atlasView
    }
    else {
      if (prepared.atlasView.getProjection().id !== viewState.projectionId) {
        prepared.atlasView.setProjection(viewState.projectionId)
      }
      prepared.atlasView.applyStyleAndState(compiledStyle, layerFilterFromViewState(viewState))
    }
    return prepared.atlasView
  }

  function restoreWebGlContextResources(): void {
    if (sessionDisposed || !activePrepared)
      return
    const prevReader = activePrepared.reader
    const prevRegistry = activePrepared.registry
    const prevPose = viewport.getCenterCoordinates() ?? activePrepared.globeView.getCenterCoordinates()

    activePrepared.globeView.dispose()
    activePrepared.atlasView?.dispose()
    activePrepared.tracker.disposeAll()

    const tracker = new GpuResourceTracker()
    const size = viewport.getSize()
    const globeView = new GlobeView(prevReader, prevRegistry, {
      domElement: viewport.canvas,
      tracker,
    })
    globeView.resize(size.width, size.height, size.pixelRatio)
    globeView.setCenterCoordinates(prevPose.longitudeDegrees, prevPose.latitudeDegrees, prevPose.styleZoom)
    globeView.applyStyleAndState(currentCompiledStyle, layerFilterFromViewState(currentViewState))

    let atlasView: AtlasView | null = null
    if (currentViewState.viewMode === 'atlas') {
      atlasView = new AtlasView(prevReader, prevRegistry, {
        projectionId: currentViewState.projectionId,
        domElement: viewport.canvas,
        tracker,
      })
      atlasView.resize(size.width, size.height, size.pixelRatio)
      atlasView.setCenterCoordinates(prevPose.longitudeDegrees, prevPose.latitudeDegrees, prevPose.styleZoom)
      atlasView.applyStyleAndState(currentCompiledStyle, layerFilterFromViewState(currentViewState))
    }

    let rebuiltDisposed = false
    const rebuilt: InternalPreparedWorld = {
      snapshotId: prevReader.identity.snapshotId,
      reader: prevReader,
      registry: prevRegistry,
      globeView,
      atlasView,
      tracker,
      initialCompiledStyle: currentCompiledStyle,
      initialViewState: currentViewState,
      isDisposed: () => rebuiltDisposed,
      dispose: () => {
        if (rebuiltDisposed)
          return
        rebuiltDisposed = true
        rebuilt.globeView.dispose()
        rebuilt.atlasView?.dispose()
        rebuilt.tracker.disposeAll()
        prevRegistry.clear()
      },
    }
    activePrepared = rebuilt
    viewport.setActiveViews(prevReader, globeView, atlasView, currentViewState.viewMode)
    viewport.renderFrame()
  }

  async function prepareWorld(
    reader: WorldMapReader,
    viewState: CartographyViewState,
    prepOptions: { signal?: AbortSignal } = {},
  ): Promise<PreparedWorldMap> {
    if (sessionDisposed)
      throw new Error('CartographySession has been disposed')

    const { signal } = prepOptions
    throwIfAborted(signal)

    const tracker = new GpuResourceTracker()
    const registry = new MapSourceRegistry(reader)
    let globeView: GlobeView | null = null
    let atlasView: AtlasView | null = null
    let preparedDisposed = false

    const cleanupCandidate = (): void => {
      if (preparedDisposed)
        return
      preparedDisposed = true
      globeView?.dispose()
      atlasView?.dispose()
      tracker.disposeAll()
      registry.clear()
    }

    try {
      const compiledStyle = resolveCompiledStyle(viewState)
      await loadMapFontFaces([...sessionFonts, ...compiledStyle.fonts], { signal })
      throwIfAborted(signal)

      const size = viewport.getSize()
      globeView = new GlobeView(reader, registry, {
        domElement: viewport.canvas,
        tracker,
      })
      globeView.resize(size.width, size.height, size.pixelRatio)

      globeView.applyStyleAndState(compiledStyle, layerFilterFromViewState(viewState))

      if (viewState.viewMode === 'atlas') {
        atlasView = new AtlasView(reader, registry, {
          projectionId: viewState.projectionId,
          domElement: viewport.canvas,
          tracker,
        })
        atlasView.resize(size.width, size.height, size.pixelRatio)
        const pose = globeView.getCenterCoordinates()
        atlasView.setCenterCoordinates(pose.longitudeDegrees, pose.latitudeDegrees, pose.styleZoom)
        atlasView.applyStyleAndState(compiledStyle, layerFilterFromViewState(viewState))
      }

      await Promise.resolve()
      throwIfAborted(signal)

      const prepared: InternalPreparedWorld = {
        snapshotId: reader.identity.snapshotId,
        reader,
        registry,
        globeView,
        atlasView,
        tracker,
        initialCompiledStyle: compiledStyle,
        initialViewState: viewState,
        isDisposed: () => preparedDisposed,
        dispose: () => {
          if (preparedDisposed)
            return
          preparedDisposed = true
          prepared.globeView.dispose()
          prepared.atlasView?.dispose()
          prepared.tracker.disposeAll()
          prepared.registry.clear()
        },
      }
      return prepared
    }
    catch (err) {
      cleanupCandidate()
      throw err
    }
  }

  function activateWorld(prepared: PreparedWorldMap): void {
    if (sessionDisposed)
      throw new Error('CartographySession has been disposed')

    const candidate = prepared as InternalPreparedWorld
    if (!candidate || typeof candidate.isDisposed !== 'function' || candidate.isDisposed()) {
      throw new Error('Cannot activate a disposed or invalid PreparedWorldMap')
    }

    const previous = activePrepared
    if (previous && previous !== candidate) {
      const pose = viewport.getCenterCoordinates() ?? previous.globeView.getCenterCoordinates()
      candidate.globeView.setCenterCoordinates(pose.longitudeDegrees, pose.latitudeDegrees, pose.styleZoom)
      candidate.atlasView?.setCenterCoordinates(pose.longitudeDegrees, pose.latitudeDegrees, pose.styleZoom)
    }

    activePrepared = candidate
    currentViewState = candidate.initialViewState
    currentCompiledStyle = candidate.initialCompiledStyle
    activeLegend = currentCompiledStyle.getActiveLegend(currentViewState.activeThematicId)

    if (currentViewState.viewMode === 'atlas' && !candidate.atlasView) {
      ensureAtlasViewForPrepared(candidate, currentCompiledStyle, currentViewState)
    }

    viewport.setActiveViews(
      candidate.reader,
      candidate.globeView,
      candidate.atlasView,
      currentViewState.viewMode,
    )
    if (!isContextLost) {
      viewport.renderFrame()
    }

    if (previous && previous !== candidate) {
      previous.dispose()
    }
  }

  function setViewState(next: CartographyViewState): void {
    if (sessionDisposed)
      return

    const prevMode = currentViewState.viewMode
    const nextCompiledStyle = resolveCompiledStyle(next)
    currentViewState = next
    currentCompiledStyle = nextCompiledStyle
    activeLegend = currentCompiledStyle.getActiveLegend(currentViewState.activeThematicId)

    if (nextCompiledStyle.fonts.length > 0) {
      void loadMapFontFaces(nextCompiledStyle.fonts).then(() => {
        if (sessionDisposed || !activePrepared || isContextLost)
          return
        activePrepared.globeView.refreshSymbolGlyphAtlases()
        activePrepared.atlasView?.refreshSymbolGlyphAtlases()
        viewport.renderFrame()
      })
    }

    if (activePrepared && !isContextLost) {
      const filterState = layerFilterFromViewState(currentViewState)

      if (currentViewState.viewMode === 'atlas') {
        const atlasView = ensureAtlasViewForPrepared(activePrepared, currentCompiledStyle, currentViewState)
        viewport.setActiveViews(
          activePrepared.reader,
          activePrepared.globeView,
          atlasView,
          prevMode,
        )
        if (prevMode !== 'atlas') {
          viewport.setViewMode('atlas')
        }
      }
      else {
        activePrepared.globeView.applyStyleAndState(currentCompiledStyle, filterState)
        if (prevMode !== 'globe') {
          viewport.setViewMode('globe')
        }
      }

      viewport.renderFrame()
    }
  }

  async function loadFonts(
    fonts: readonly MapFontFaceDescriptor[],
    fontOptions: { signal?: AbortSignal } = {},
  ): Promise<readonly string[]> {
    if (sessionDisposed)
      throw new Error('CartographySession has been disposed')
    const loaded = await loadMapFontFaces(fonts, fontOptions)
    if (activePrepared && !isContextLost) {
      activePrepared.globeView.refreshSymbolGlyphAtlases()
      activePrepared.atlasView?.refreshSymbolGlyphAtlases()
      viewport.renderFrame()
    }
    return loaded
  }

  function resetCamera(): void {
    if (sessionDisposed || !activePrepared)
      return
    activePrepared.globeView.resetCamera()
    activePrepared.atlasView?.resetCamera()
    if (!isContextLost) {
      viewport.renderFrame()
    }
  }

  function dispose(): void {
    if (sessionDisposed)
      return
    sessionDisposed = true
    viewport.dispose()
    if (activePrepared) {
      activePrepared.dispose()
      activePrepared = null
    }
    activeLegend = null
  }

  return {
    get activeSnapshotId() {
      return activePrepared?.snapshotId ?? null
    },
    get activeLegend() {
      return activeLegend
    },
    prepareWorld,
    activateWorld,
    setViewState,
    loadFonts,
    resetCamera,
    dispose,
    viewport,
    getActiveGlobeView: () => activePrepared?.globeView ?? null,
    getActiveAtlasView: () => activePrepared?.atlasView ?? null,
    getActiveSourceRegistry: () => activePrepared?.registry ?? null,
    getActiveGpuResourceCounts: () => activePrepared?.tracker.getCounts() ?? { geometries: 0, materials: 0, textures: 0 },
    pickAtScreenPoint: (screenX: number, screenY: number) => viewport.pickAtScreenPoint(screenX, screenY),
    simulateContextLost: () => {
      isContextLost = true
      options.onContextLost?.()
    },
    simulateContextRestored: () => {
      isContextLost = false
      restoreWebGlContextResources()
      options.onContextRestored?.()
    },
  }
}
