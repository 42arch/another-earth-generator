import type SphericalMesh from '@/core/mesh/mesh'
import type { WorldConfig } from '@/core/simulation/config'
import type { WorldSimulationState } from '@/core/simulation/state'
import {
  FrontSide,
  Group,
  MeshBasicMaterial,
  Vector3,
} from 'three'
import { Text } from 'troika-three-text'
import { computeWorldLabels } from '@/core/rendering/shared/label-data'

export class GlobeLabelLayer {
  readonly group = new Group()
  private readonly texts: Text[] = []

  constructor(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    terrainVerticalScale: number,
  ) {
    this.group.name = 'GlobeLabels'
    this.build(mesh, data, params, terrainVerticalScale)
  }

  private build(
    mesh: SphericalMesh,
    data: WorldSimulationState,
    params: WorldConfig,
    terrainVerticalScale: number,
  ): void {
    const labels = computeWorldLabels(mesh, data, params)
    if (labels.length === 0)
      return

    const planetRadius = params.core.planetRadius
    const displacement = params.appearance.elevationDisplacement

    for (const item of labels) {
      for (const glyph of item.glyphs) {
        const elevation = data.geography.elevation[glyph.region]
        const terrainOffset = displacement ? elevation * terrainVerticalScale : 0
        const radius = planetRadius + terrainOffset + 0.45

        const pos = glyph.normal.clone().multiplyScalar(radius)

        const text = new Text()
        text.text = glyph.char
        text.font = '/fonts/noto-sans-sc-bold.woff'
        text.fontSize = item.fontSize
        text.color = item.color
        text.anchorX = 'center'
        text.anchorY = item.isCurved ? 'middle' : (item.offsetUpRatio ? 'bottom' : 'middle')
        text.depthOffset = -2
        text.outlineWidth = 0.14
        text.outlineColor = item.outlineColor
        text.outlineOpacity = 0.9

        text.material = new MeshBasicMaterial({
          side: FrontSide,
          depthTest: true,
          depthWrite: false,
        })

        if (!item.isCurved && item.offsetUpRatio) {
          const up = new Vector3().setFromMatrixColumn(glyph.matrix3D, 1)
          pos.add(up.multiplyScalar(item.offsetUpRatio))
        }

        text.position.copy(pos)
        text.rotation.setFromRotationMatrix(glyph.matrix3D)
        text.renderOrder = 9

        text.sync()
        this.texts.push(text)
        this.group.add(text)
      }
    }
  }

  dispose(): void {
    for (const text of this.texts) {
      this.group.remove(text)
      text.dispose()
    }
    this.texts.length = 0
  }
}
