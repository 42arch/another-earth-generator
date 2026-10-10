declare module 'troika-three-text' {
  import type { ColorRepresentation, Material, Mesh } from 'three'

  export class Text extends Mesh {
    text: string
    font: string | null
    fontSize: number
    color: ColorRepresentation
    anchorX: 'left' | 'center' | 'right' | number | string
    anchorY: 'top' | 'top-baseline' | 'top-cap' | 'top-ex' | 'middle' | 'bottom-baseline' | 'bottom' | number | string
    curveRadius: number
    depthOffset: number
    direction: 'auto' | 'ltr' | 'rtl'
    fillOpacity: number
    fontStyle: 'normal' | 'italic'
    fontWeight: 'normal' | 'bold' | number
    glyphGeometryDetail: number
    gpuAccelerateSDF: boolean
    letterSpacing: number
    lineHeight: number | 'normal'
    material: Material
    maxWidth: number
    outlineBlur: number | string
    outlineColor: ColorRepresentation
    outlineOffsetX: number | string
    outlineOffsetY: number | string
    outlineOpacity: number
    outlineWidth: number | string
    strokeColor: ColorRepresentation
    strokeOpacity: number
    strokeWidth: number | string
    textAlign: 'left' | 'right' | 'center' | 'justify'
    whiteSpace: 'normal' | 'nowrap'
    overflowWrap: 'normal' | 'break-word'

    sync(callback?: () => void): void
    dispose(): void
  }

  export function preloadFont(
    options: {
      font?: string | null
      characters?: string | string[]
      sdfGlyphSize?: number
    },
    callback?: () => void,
  ): void

  export function configureTextBuilder(config: {
    useWorker?: boolean
    unicodeFontsURL?: string
  }): void
}
