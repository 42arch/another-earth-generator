export const CLOUD_GLOBE_VERTEX_SHADER = `
  varying vec3 vCloudDirection;
  void main() {
    vCloudDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const CLOUD_MAP_VERTEX_SHADER = `
  attribute vec3 cloudDirection;
  varying vec3 vCloudDirection;
  void main() {
    vCloudDirection = normalize(cloudDirection);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** Shared spherical procedural texture so globe and map views show the same cloud pattern. */
export const CLOUD_FRAGMENT_SHADER = `
  uniform float uSeed;
  uniform float uCoverage;
  varying vec3 vCloudDirection;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float valueNoise(vec3 p) {
    vec3 cell = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash31(cell);
    float b = hash31(cell + vec3(1.0, 0.0, 0.0));
    float c = hash31(cell + vec3(0.0, 1.0, 0.0));
    float d = hash31(cell + vec3(1.0, 1.0, 0.0));
    float e = hash31(cell + vec3(0.0, 0.0, 1.0));
    float f1 = hash31(cell + vec3(1.0, 0.0, 1.0));
    float g = hash31(cell + vec3(0.0, 1.0, 1.0));
    float h = hash31(cell + vec3(1.0, 1.0, 1.0));
    float low = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    float high = mix(mix(e, f1, f.x), mix(g, h, f.x), f.y);
    return mix(low, high, f.z);
  }

  void main() {
    vec3 direction = normalize(vCloudDirection);
    float seed = uSeed * 0.001;
    vec3 offset = vec3(seed, seed * 1.71, seed * 2.37);

    float broad = valueNoise(direction * 4.2 + offset);
    float formation = valueNoise(direction * 12.5 - offset * 1.7);
    float puffs = valueNoise(direction * 31.0 + offset * 2.3);
    float edge = valueNoise(direction * 83.0 - offset * 0.8);
    float wisps = valueNoise(direction * 23.0 + offset * 0.6);

    float body = broad * 0.4 + formation * 0.42 + puffs * 0.18;
    body += (edge - 0.5) * 0.14;
    float threshold = mix(0.70, 0.46, clamp(uCoverage, 0.0, 1.0));
    float cloud = smoothstep(threshold, threshold + 0.17, body);
    float thinCloud = smoothstep(0.78, 0.92, wisps) * (1.0 - cloud) * 0.1;
    float alpha = clamp(cloud * 0.5 + thinCloud, 0.0, 0.56);
    if (alpha < 0.012)
      discard;

    vec3 sunDirection = normalize(vec3(0.62, 0.48, 0.62));
    float light = smoothstep(-0.2, 0.75, dot(direction, sunDirection));
    vec3 cloudColor = mix(vec3(0.76, 0.8, 0.85), vec3(0.98, 0.99, 1.0), light);
    gl_FragColor = vec4(cloudColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`
