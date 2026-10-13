import type { Camera, Scene } from 'three'
import type { GeoJsonFeatureHit } from '@/core/data-source'
import type { LayerFactoryContext } from '@/core/rendering/shared/styled/layer-factory'
import type { WorldConfig } from '@/core/simulation/config'
import { SceneLayerManager } from '@/core/rendering/scene-layer-manager'
import { shouldRebuildClimateVectors } from '@/core/rendering/shared/layers/overlay-reconciler'
import { StyledLayerManager } from '@/core/rendering/shared/styled/styled-layer-manager'

/**
 * 2D 地图与 3D 地球图层集的公共抽象基类
 * 统管场景图层管理器 (SceneLayerManager) 与样式驱动图层管理器 (StyledLayerManager) 的公共生命周期
 */
export abstract class BaseLayerSet<
  TContext extends { params: WorldConfig },
  TLayerId extends string,
  TFactoryContext extends LayerFactoryContext,
> {
  protected readonly manager: SceneLayerManager
  protected readonly styledLayers: StyledLayerManager
  protected readonly getContext: () => TContext | null

  constructor(
    scene: Scene,
    getContext: () => TContext | null,
  ) {
    this.getContext = getContext
    this.manager = new SceneLayerManager(scene, () => Boolean(this.getContext()))
    this.styledLayers = new StyledLayerManager(this.manager, () => {
      const context = this.getContext()
      return context ? this.getFactoryContext(context) : null
    })
  }

  protected abstract getFactoryContext(context: TContext): TFactoryContext
  public abstract updateOverlayVisibility(): void
  protected abstract create(id: TLayerId, context: TContext): any

  rebuild(id: TLayerId): void {
    const context = this.getContext()
    if (!context)
      return
    this.manager.dispose(id)
    this.updateOverlayVisibility()
  }

  reconcileAppearance(previous: WorldConfig, next: WorldConfig): void {
    if (shouldRebuildClimateVectors(previous, next)) {
      this.rebuild('vectors' as TLayerId)
    }
    this.styledLayers.reconcileAppearance(previous, next)
  }

  protected syncCommonOverlays(
    context: TContext,
    effectiveMode: string,
  ): void {
    const overlays = context.params.appearance.overlays
    this.manager.syncVisibility('clouds', overlays.clouds, () => this.create('clouds' as TLayerId, context))
    this.manager.syncVisibility('graticule', overlays.graticule, () => this.create('graticule' as TLayerId, context))
    this.manager.syncVisibility('cell-boundaries', overlays.wireframe, () => this.create('cell-boundaries' as TLayerId, context))

    const vectorMode = effectiveMode === 'wind' || effectiveMode === 'ocean-current'
    this.manager.syncVisibility('vectors', vectorMode, () => this.create('vectors' as TLayerId, context))
  }

  rebuildAll(): void {
    this.disposeAll()
    this.styledLayers.rebuildAll()
    this.updateOverlayVisibility()
  }

  disposeAll(): void {
    this.manager.disposeAll()
    this.styledLayers.resetTracking()
  }

  destroy(): void {
    this.styledLayers.destroy()
    this.disposeAll()
  }

  pickSettlement(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): number | null {
    return this.styledLayers.pickSettlement(event, canvas, camera)
  }

  pickGeoJsonFeature(event: PointerEvent, canvas: HTMLCanvasElement, camera: Camera): GeoJsonFeatureHit | null {
    return this.styledLayers.pickGeoJsonFeature(event, canvas, camera)
  }
}
