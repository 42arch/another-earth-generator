import { ShaderMaterial, Vector3 } from 'three'

const VERTEX_SHADER = /* glsl */`
  attribute float markerLevel;
  varying vec3 vColor;
  varying float vMarkerLevel;
  varying float vDaylight;
  uniform float pixelRatio;
  uniform float uDayNightEnabled;
  uniform vec3 uSunDirection;

  void main() {
    vColor = color;
    vMarkerLevel = markerLevel;
    vec3 worldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    float sunCosine = dot(normalize(worldPosition), normalize(uSunDirection));
    float daylight = smoothstep(-0.12, 0.12, sunCosine);
    vDaylight = mix(1.0, 0.045 + daylight * 0.955, uDayNightEnabled);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = (4.0 + markerLevel) * pixelRatio;
  }
`

const FRAGMENT_SHADER = /* glsl */`
  varying vec3 vColor;
  varying float vMarkerLevel;
  varying float vDaylight;

  float ring(float distanceFromCenter, float radius, float width, float aa) {
    return 1.0 - smoothstep(width - aa, width + aa, abs(distanceFromCenter - radius));
  }

  float disk(float distanceFromCenter, float radius, float aa) {
    return 1.0 - smoothstep(radius - aa, radius + aa, distanceFromCenter);
  }

  void main() {
    float distanceFromCenter = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float aa = max(fwidth(distanceFromCenter), 0.015);
    float mark = disk(distanceFromCenter, 0.38, aa);

    if (vMarkerLevel > 0.5)
      mark = max(mark, ring(distanceFromCenter, 0.60, 0.12, aa));
    if (vMarkerLevel > 1.5) {
      mark = max(mark, ring(distanceFromCenter, 0.68, 0.09, aa));
      mark = max(mark, ring(distanceFromCenter, 0.40, 0.08, aa));
    }
    if (vMarkerLevel > 2.5) {
      mark = max(mark, ring(distanceFromCenter, 0.72, 0.075, aa));
      mark = max(mark, ring(distanceFromCenter, 0.52, 0.07, aa));
      mark = max(mark, ring(distanceFromCenter, 0.32, 0.06, aa));
    }

    float backing = disk(distanceFromCenter, 0.88, aa);
    if (backing < 0.02)
      discard;
    vec3 color = mix(vec3(0.07, 0.08, 0.09), vColor, mark);
    gl_FragColor = vec4(color * vDaylight, backing * 0.96);
    #include <colorspace_fragment>
  }
`

/** Small screen-space map symbols anchored to geographic positions. */
export function createMapMarkerMaterial(
  depthTest: boolean,
  dayNight = false,
  sunDirection = new Vector3(0, 0, 1),
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      pixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uDayNightEnabled: { value: dayNight ? 1 : 0 },
      uSunDirection: { value: sunDirection.clone().normalize() },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    vertexColors: true,
    transparent: true,
    depthTest,
    depthWrite: false,
  })
}
