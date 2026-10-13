import { DoubleSide, ShaderMaterial, Vector2 } from 'three'

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 other;
  attribute float side;
  attribute float along;
  attribute float lineDistance;
  attribute float strokeWidth;
  attribute float dashLength;
  attribute float gapLength;
  attribute float featureOpacity;
  attribute vec3 color;

  uniform vec2 resolution;
  uniform float distanceScale;

  varying vec3 vColor;
  varying float vOpacity;
  varying float vDistance;
  varying float vDashLength;
  varying float vGapLength;

  void main() {
    vec4 currentClip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec4 otherClip = projectionMatrix * modelViewMatrix * vec4(other, 1.0);
    vec2 currentScreen = currentClip.xy / max(currentClip.w, 0.0001) * resolution * 0.5;
    vec2 otherScreen = otherClip.xy / max(otherClip.w, 0.0001) * resolution * 0.5;
    vec2 direction = along < 0.5 ? otherScreen - currentScreen : currentScreen - otherScreen;
    float directionLength = length(direction);
    direction = directionLength > 0.0001 ? direction / directionLength : vec2(1.0, 0.0);
    vec2 normal = vec2(-direction.y, direction.x);
    float halfWidth = max(strokeWidth, 0.0) * 0.5;
    float cap = (along * 2.0 - 1.0) * halfWidth;
    vec2 screenPosition = currentScreen + normal * side * halfWidth + direction * cap;
    currentClip.xy = screenPosition * 2.0 / resolution * currentClip.w;
    gl_Position = currentClip;

    vColor = color;
    vOpacity = featureOpacity;
    vDistance = lineDistance * distanceScale + cap;
    vDashLength = dashLength * strokeWidth;
    vGapLength = gapLength * strokeWidth;
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  varying float vOpacity;
  varying float vDistance;
  varying float vDashLength;
  varying float vGapLength;

  void main() {
    if (vOpacity <= 0.0)
      discard;
    if (vDashLength > 0.0 && vGapLength > 0.0) {
      float period = vDashLength + vGapLength;
      if (mod(vDistance, period) >= vDashLength)
        discard;
    }
    gl_FragColor = vec4(vColor, vOpacity);
    #include <colorspace_fragment>
  }
`

export class LineStrokeMaterial extends ShaderMaterial {
  constructor(view: 'map' | 'globe', width: number, height: number) {
    super({
      uniforms: {
        resolution: { value: new Vector2(Math.max(1, width), Math.max(1, height)) },
        distanceScale: { value: 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: view === 'globe',
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    })
  }

  setResolution(width: number, height: number): void {
    (this.uniforms.resolution.value as Vector2).set(Math.max(1, width), Math.max(1, height))
  }

  setDistanceScale(scale: number): void {
    this.uniforms.distanceScale.value = Math.max(0, scale)
  }
}
