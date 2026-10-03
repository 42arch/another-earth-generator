import {
  AdditiveBlending,
  BackSide,
  Color,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
} from 'three'

export class Atmosphere {
  public readonly group = new Group()

  constructor(radius: number) {
    // 折中方案：1.08 倍。既能覆盖绝大多数拉伸的山脉地形(通常约 1.04倍)，又不会显得光晕圈太宽太厚
    const geometry = new SphereGeometry(radius * 1.08, 64, 64)
    const material = new ShaderMaterial({
      uniforms: {
        uAtomsphereColor: { value: new Color('#3da5ff') }, // 统一纯净天蓝色光晕
        uPlanetRadius: { value: radius },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;

        void main() {
          vec4 modelPosition = modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * modelPosition;

          // Model normal
          vec3 modelNormal = (modelMatrix * vec4(normal, 0.0)).xyz;

          vNormal = modelNormal;
          vPosition = modelPosition.xyz;
        }
      `,
      fragmentShader: `
        uniform vec3 uAtomsphereColor;
        uniform float uPlanetRadius;

        varying vec3 vNormal;
        varying vec3 vPosition;

        void main() {
          vec3 viewDirection = normalize(vPosition - cameraPosition);
          vec3 normal = normalize(vNormal);

          // 1. 边缘发光 (BackSide) 
          // 把 0.6 改为 0.3，这样边缘透明区域过渡更快，能在视觉上进一步“削薄”光晕的厚度
          float edgeAlpha = dot(viewDirection, normal);
          edgeAlpha = smoothstep(0.0, 0.3, edgeAlpha);

          // 2. 距离衰减：离近时完全消失，离远时明显
          float dist = length(cameraPosition);
          // minDistance = 1.25*radius。设置 1.5 倍时才开始显现，3.5 倍时完全不透明
          float distanceFade = smoothstep(uPlanetRadius * 1.5, uPlanetRadius * 3.5, dist);

          // 最终混合 (将极限透明度压低至 0.4，让它成为极为柔和的若隐若现的光晕)
          float alpha = edgeAlpha * distanceFade * 0.4;

          gl_FragColor = vec4(uAtomsphereColor, alpha);
        }
      `,
      blending: AdditiveBlending,
      side: BackSide,
      transparent: true,
      depthWrite: false,
    })

    const mesh = new Mesh(geometry, material)
    this.group.add(mesh)
  }

  public dispose(): void {
    for (const child of this.group.children) {
      if (child instanceof Mesh) {
        child.geometry.dispose()
        if (child.material instanceof ShaderMaterial) {
          child.material.dispose()
        }
      }
    }
  }
}
