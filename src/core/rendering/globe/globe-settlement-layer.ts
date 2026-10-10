import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import {
  FrontSide,
  Group,
  MeshBasicMaterial,
} from 'three'
import { Text } from 'troika-three-text'
import { computeSettlementLabels } from '@/core/rendering/shared/settlement-label-data'

export class GlobeSettlementLayer {
  readonly group = new Group()
  readonly highTierGroup = new Group()
  readonly midTierGroup = new Group()
  readonly lowTierGroup = new Group()

  private readonly texts: Text[] = []

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    terrainVerticalScale: number,
  ) {
    this.group.name = 'GlobeSettlementLabels'
    this.highTierGroup.name = 'SettlementsHighTier'
    this.midTierGroup.name = 'SettlementsMidTier'
    this.lowTierGroup.name = 'SettlementsLowTier'

    this.group.add(this.highTierGroup)
    this.group.add(this.midTierGroup)
    this.group.add(this.lowTierGroup)

    this.build(mesh, data, params, terrainVerticalScale)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    terrainVerticalScale: number,
  ): void {
    const items = computeSettlementLabels(mesh, data, params)
    if (items.length === 0)
      return

    const planetRadius = params.core.planetRadius
    const displacement = params.appearance.elevationDisplacement

    for (const item of items) {
      const elevation = data.geography.elevation[item.region]
      const terrainOffset = displacement ? elevation * terrainVerticalScale : 0
      const radius = planetRadius + terrainOffset + 0.38
      const pos = item.normal.clone().multiplyScalar(radius)

      // 1. 矢量图标 (Maki Icon)
      const iconText = new Text()
      iconText.text = item.iconChar
      iconText.font = '/fonts/maki.woff'
      iconText.fontSize = item.iconSize3D
      iconText.color = item.iconColor
      iconText.anchorX = 'center'
      iconText.anchorY = 'middle'
      iconText.depthOffset = -2
      iconText.outlineWidth = item.iconSize3D * 0.10
      iconText.outlineColor = 0x050C16
      iconText.outlineOpacity = 0.95
      iconText.material = new MeshBasicMaterial({
        side: FrontSide,
        depthTest: true,
        depthWrite: false,
      })
      iconText.position.copy(pos)
      iconText.rotation.setFromRotationMatrix(item.matrix3D)
      iconText.renderOrder = 8.5
      iconText.sync()

      // 2. 聚落名称 (Settlement Name)
      const nameText = new Text()
      nameText.text = item.name
      nameText.font = '/fonts/noto-sans-sc-bold.woff'
      nameText.fontSize = item.fontSize3D
      nameText.color = item.nameColor
      nameText.anchorX = 'left'
      nameText.anchorY = 'middle'
      nameText.depthOffset = -2
      nameText.outlineWidth = item.fontSize3D * 0.09
      nameText.outlineColor = 0x050C16
      nameText.outlineOpacity = 0.95
      nameText.material = new MeshBasicMaterial({
        side: FrontSide,
        depthTest: true,
        depthWrite: false,
      })

      // 沿东向水平偏移，紧贴在矢量图标右侧
      const namePos = pos.clone().add(item.right3D.clone().multiplyScalar(item.iconSize3D * 0.70 + 0.14))
      nameText.position.copy(namePos)
      nameText.rotation.setFromRotationMatrix(item.matrix3D)
      nameText.renderOrder = 8.5
      nameText.sync()

      this.texts.push(iconText, nameText)

      // 按等级装入对应的 LOD Group
      if (item.tier === 'high') {
        this.highTierGroup.add(iconText, nameText)
      }
      else if (item.tier === 'mid') {
        this.midTierGroup.add(iconText, nameText)
      }
      else {
        this.lowTierGroup.add(iconText, nameText)
      }
    }
  }

  /**
   * 根据相机与星球中心的欧氏距离实时更新分级 LOD 显隐状态
   */
  updateLOD(distance: number): void {
    // 首都与特大都会：全景恒定可见
    this.highTierGroup.visible = true
    // 区域主要城市、海港与要塞：中景展开 (视距小于 265)
    this.midTierGroup.visible = distance < 265
    // 普通市镇与村落营寨：特写展开 (视距小于 185)
    this.lowTierGroup.visible = distance < 185
  }

  dispose(): void {
    this.highTierGroup.clear()
    this.midTierGroup.clear()
    this.lowTierGroup.clear()

    for (const text of this.texts) {
      text.dispose()
    }
    this.texts.length = 0
  }
}
