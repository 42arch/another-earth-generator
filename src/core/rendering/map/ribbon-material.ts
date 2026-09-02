import { Color, DoubleSide, ShaderMaterial, Vector2 } from 'three'

const VERTEX_SHADER = /* glsl */ `
  attribute vec2 previous;
  attribute vec2 next;
  attribute float side;
  attribute float lineWidth;
  attribute vec3 color;

  uniform vec2 resolution;

  varying vec3 vColor;

  void main() {
    vec4 currentClip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec4 previousClip = projectionMatrix * modelViewMatrix * vec4(previous, position.z, 1.0);
    vec4 nextClip = projectionMatrix * modelViewMatrix * vec4(next, position.z, 1.0);

    vec2 currentScreen = currentClip.xy / currentClip.w * resolution;
    vec2 previousScreen = previousClip.xy / previousClip.w * resolution;
    vec2 nextScreen = nextClip.xy / nextClip.w * resolution;
    vec2 direction = nextScreen - previousScreen;
    if (dot(direction, direction) < 0.0001)
      direction = nextScreen - currentScreen;
    if (dot(direction, direction) < 0.0001)
      direction = currentScreen - previousScreen;
    direction = normalize(direction);

    vec2 normal = vec2(-direction.y, direction.x);
    vec2 offset = normal * lineWidth * 0.5 * side;
    currentClip.xy += offset * 2.0 / resolution * currentClip.w;

    gl_Position = currentClip;
    vColor = color;
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 strokeColor;
  uniform float strokeOpacity;

  varying vec3 vColor;

  void main() {
    gl_FragColor = vec4(strokeColor * vColor, strokeOpacity);
  }
`

export class MapRibbonMaterial extends ShaderMaterial {
  constructor(
    color: number,
    opacity: number,
    width: number,
    height: number,
  ) {
    super({
      uniforms: {
        resolution: { value: new Vector2(Math.max(1, width), Math.max(1, height)) },
        strokeColor: { value: new Color(color) },
        strokeOpacity: { value: opacity },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: opacity < 1,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    })
  }

  setResolution(width: number, height: number): void {
    const resolution = this.uniforms.resolution.value as Vector2
    resolution.set(Math.max(1, width), Math.max(1, height))
  }
}
