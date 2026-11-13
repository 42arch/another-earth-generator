import type { RenderGeometry, RegionSelection } from './map-render-data'
import type { GeographicLabelAnchor } from '@another-earth/cartography'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const WATER_SURFACE_OFFSET = 0.001
const GRATICULE_INTERVAL_DEGREES = 15
const GRATICULE_SAMPLE_STEP_DEGREES = 2
const GRATICULE_RADIUS = 1.003

export interface ScenePresentation {
  satellite: boolean
  atmosphere: boolean
  dayNight: boolean
  month: number
  axialTiltDegrees: number
}

export type SceneGeographicLabel = GeographicLabelAnchor & { readonly text: string }

export function disposeSceneObjects(group: THREE.Group): void {
  for (const child of [...group.children]) {
    child.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach(material => material.dispose())
      }
    })
    group.remove(child)
  }
}
function positionGeometry(positions: Float32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.02)
  return geometry
}

function addRadialNormals(geometry: THREE.BufferGeometry): void {
  const positions = geometry.getAttribute('position')
  const normals = new Float32Array(positions.count * 3)
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const x = positions.getX(vertex)
    const y = positions.getY(vertex)
    const z = positions.getZ(vertex)
    const length = Math.hypot(x, y, z) || 1
    normals[vertex * 3] = x / length
    normals[vertex * 3 + 1] = y / length
    normals[vertex * 3 + 2] = z / length
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
}

function createSatelliteSurfaceMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
}

function createStars(): THREE.Points {
  let state = 0x4a17e
  const random = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
  const count = 3000
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const y = random() * 2 - 1
    const theta = random() * Math.PI * 2
    const radius = 10 + random() * 5
    const ring = Math.sqrt(1 - y * y)
    positions[i * 3] = Math.cos(theta) * ring * radius
    positions[i * 3 + 1] = y * radius
    positions[i * 3 + 2] = Math.sin(theta) * ring * radius
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: '#ffffff',
    size: 0.02,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  }))
}

function createGraticule(): THREE.Group {
  const positions: number[] = []
  const appendPoint = (latitudeDegrees: number, longitudeDegrees: number) => {
    const latitude = THREE.MathUtils.degToRad(latitudeDegrees)
    const longitude = THREE.MathUtils.degToRad(longitudeDegrees)
    const horizontalRadius = Math.cos(latitude) * GRATICULE_RADIUS
    positions.push(
      Math.sin(longitude) * horizontalRadius,
      Math.sin(latitude) * GRATICULE_RADIUS,
      Math.cos(longitude) * horizontalRadius,
    )
  }
  const appendSegment = (latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) => {
    appendPoint(latitudeA, longitudeA)
    appendPoint(latitudeB, longitudeB)
  }

  for (let latitude = -90 + GRATICULE_INTERVAL_DEGREES; latitude < 90; latitude += GRATICULE_INTERVAL_DEGREES) {
    for (let longitude = -180; longitude < 180; longitude += GRATICULE_SAMPLE_STEP_DEGREES) {
      appendSegment(latitude, longitude, latitude, Math.min(180, longitude + GRATICULE_SAMPLE_STEP_DEGREES))
    }
  }
  for (let longitude = -180; longitude < 180; longitude += GRATICULE_INTERVAL_DEGREES) {
    for (let latitude = -90; latitude < 90; latitude += GRATICULE_SAMPLE_STEP_DEGREES) {
      appendSegment(latitude, longitude, Math.min(90, latitude + GRATICULE_SAMPLE_STEP_DEGREES), longitude)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeBoundingSphere()
  const material = new THREE.LineBasicMaterial({
    color: '#b8d6e8',
    transparent: true,
    opacity: 0.36,
    depthTest: true,
    depthWrite: false,
  })
  const lines = new THREE.LineSegments(geometry, material)
  lines.renderOrder = 4
  const group = new THREE.Group()
  group.name = 'GlobeGraticule'
  group.add(lines)
  group.visible = false
  return group
}

/** Port of the reference BackSide atmosphere, including its view-distance fade. */
function createAtmosphere(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1.08, 64, 64)
  const vertexShader = [
    'varying vec3 vNormal;',
    'varying vec3 vPosition;',
    'void main() {',
    '  vec4 modelPosition = modelMatrix * vec4(position, 1.0);',
    '  gl_Position = projectionMatrix * viewMatrix * modelPosition;',
    '  vNormal = (modelMatrix * vec4(normal, 0.0)).xyz;',
    '  vPosition = modelPosition.xyz;',
    '}',
  ].join('\n')
  const fragmentShader = [
    'uniform vec3 uAtmosphereColor;',
    'uniform float uPlanetRadius;',
    'varying vec3 vNormal;',
    'varying vec3 vPosition;',
    'void main() {',
    '  vec3 viewDirection = normalize(vPosition - cameraPosition);',
    '  vec3 normal = normalize(vNormal);',
    '  float edgeAlpha = smoothstep(0.0, 0.3, dot(viewDirection, normal));',
    '  float distanceFade = smoothstep(uPlanetRadius * 1.5, uPlanetRadius * 3.5, length(cameraPosition));',
    '  float alpha = edgeAlpha * distanceFade * 0.4;',
    '  gl_FragColor = vec4(uAtmosphereColor, alpha);',
    '}',
  ].join('\n')
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAtmosphereColor: { value: new THREE.Color('#3da5ff') },
      uPlanetRadius: { value: 1 },
    },
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const atmosphere = new THREE.Mesh(geometry, material)
  atmosphere.visible = false
  return atmosphere
}

function createWaterMesh(surfaceGeometry: THREE.BufferGeometry): THREE.Mesh | undefined {
  const landMask = surfaceGeometry.getAttribute('satelliteLandMask')
  const sourcePositions = surfaceGeometry.getAttribute('position')
  if (!landMask || !sourcePositions)
    return undefined

  let oceanVertexCount = 0
  for (let vertex = 0; vertex + 2 < landMask.count; vertex += 3) {
    if (landMask.getX(vertex) < 0.5 && landMask.getX(vertex + 1) < 0.5 && landMask.getX(vertex + 2) < 0.5)
      oceanVertexCount += 3
  }
  if (!oceanVertexCount)
    return undefined

  const positions = new Float32Array(oceanVertexCount * 3)
  let target = 0
  for (let vertex = 0; vertex + 2 < landMask.count; vertex += 3) {
    if (landMask.getX(vertex) >= 0.5 || landMask.getX(vertex + 1) >= 0.5 || landMask.getX(vertex + 2) >= 0.5)
      continue
    for (let corner = 0; corner < 3; corner++) {
      const source = vertex + corner
      const x = sourcePositions.getX(source)
      const y = sourcePositions.getY(source)
      const z = sourcePositions.getZ(source)
      const length = Math.hypot(x, y, z) || 1
      positions[target++] = x + x / length * WATER_SURFACE_OFFSET
      positions[target++] = y + y / length * WATER_SURFACE_OFFSET
      positions[target++] = z + z / length * WATER_SURFACE_OFFSET
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  addRadialNormals(geometry)
  geometry.computeBoundingSphere()
  const material = new THREE.MeshPhongMaterial({
    color: '#0c3a6e',
    transparent: true,
    opacity: 0.55,
    shininess: 120,
    specular: '#4488bb',
    depthWrite: false,
  })
  return new THREE.Mesh(geometry, material)
}

/** Disposable Web scene for the interactive world view. */
export function createWorldScene(host: HTMLElement, pick: (position: THREE.Vector3) => void, rendered: (geometries: number) => void, failed: (message: string) => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' })
  renderer.setClearColor('#030308')
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.domElement.setAttribute('aria-label', '球面网格视口')
  renderer.domElement.style.touchAction = 'none'
  host.append(renderer.domElement)
  const labelLayer = document.createElement('div')
  labelLayer.setAttribute('aria-hidden', 'true')
  labelLayer.style.position = 'absolute'
  labelLayer.style.inset = '0'
  labelLayer.style.overflow = 'hidden'
  labelLayer.style.pointerEvents = 'none'
  labelLayer.style.zIndex = '1'
  host.append(labelLayer)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#030308')
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 25)
  camera.position.set(0.5, 0.3, 3.1)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.minDistance = 1.15
  controls.maxDistance = 7
  controls.autoRotateSpeed = 0.6
  const base = new THREE.Group()
  const selection = new THREE.Group()
  const stars = createStars()
  const atmosphere = createAtmosphere()
  const graticule = createGraticule()
  const ambientLight = new THREE.AmbientLight('#aabbcc', 3.5)
  const sunlight = new THREE.DirectionalLight('#fff8ee', 1.5)
  sunlight.position.set(1.8, 1.2, 2.2)
  scene.add(base, selection, stars, atmosphere, graticule, ambientLight, sunlight)
  let lines: THREE.LineSegments | undefined
  let surface: THREE.Mesh | undefined
  let fiveNeighborPoints: THREE.Points | undefined
  let waterSurface: THREE.Mesh | undefined
  let climateVectors: THREE.LineSegments | undefined
  let inlandWaterSurface: THREE.Mesh | undefined
  let surfaceVisible = true
  let geographicLabels: { element: HTMLDivElement, position: THREE.Vector3 }[] = []
  let currentPresentation: ScenePresentation = { satellite: false, atmosphere: true, dayNight: true, month: 0, axialTiltDegrees: 23.5 }
  let frame = 0
  let disposed = false
  let visible = true
  const updateGeographicLabels = () => {
    const width = host.clientWidth
    const height = host.clientHeight
    const placed: { left: number, top: number, right: number, bottom: number }[] = []
    camera.updateMatrixWorld()
    for (const label of geographicLabels) {
      const element = label.element
      element.style.visibility = 'hidden'
      if (!surfaceVisible || !width || !height || camera.position.dot(label.position) <= 1.02) continue
      const projected = label.position.clone().multiplyScalar(1.012).project(camera)
      if (projected.z < -1 || projected.z > 1) continue
      const x = (projected.x + 1) * width / 2
      const y = (1 - projected.y) * height / 2
      const halfWidth = element.offsetWidth / 2
      const halfHeight = element.offsetHeight / 2
      const box = { left: x - halfWidth - 5, top: y - halfHeight - 5, right: x + halfWidth + 5, bottom: y + halfHeight + 5 }
      if (box.left < 8 || box.top < 8 || box.right > width - 8 || box.bottom > height - 8) continue
      if (placed.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) continue
      element.style.left = `${x}px`
      element.style.top = `${y}px`
      element.style.visibility = 'visible'
      placed.push(box)
    }
  }
  const draw = () => {
    frame = 0
    if (disposed || !visible)
      return
    controls.update()
    renderer.render(scene, camera)
    updateGeographicLabels()
    rendered(renderer.info.memory.geometries)
    if (controls.autoRotate)
      schedule()
  }
  function schedule() {
    if (!frame && !disposed && visible)
      frame = requestAnimationFrame(draw)
  }
  function setPresentation(next: ScenePresentation) {
    currentPresentation = next
    atmosphere.visible = Boolean(surface) && next.atmosphere
    if (waterSurface)
      waterSurface.visible = next.satellite && next.atmosphere && surfaceVisible
    if (next.satellite && next.dayNight) {
      // Retain the day/night contrast while keeping terrain readable on the night side.
      ambientLight.color.set('#50657a')
      ambientLight.intensity = 1.1
      sunlight.color.set('#fffaf0')
      sunlight.intensity = 4
      const month = THREE.MathUtils.clamp(Math.floor(next.month), 0, 11)
      let midpoint = 0
      for (let i = 0; i < month; i++)
        midpoint += MONTH_DAYS[i]
      midpoint += MONTH_DAYS[month] / 2
      const orbitalPhase = 2 * Math.PI * (midpoint - 79) / 365
      const tilt = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(next.axialTiltDegrees, 0, 90))
      const solarDeclination = Math.asin(Math.sin(tilt) * Math.sin(orbitalPhase))
      sunlight.position.set(0, 3 * Math.sin(solarDeclination), 3 * Math.cos(solarDeclination))
    }
    else if (next.satellite) {
      ambientLight.color.set('#aabbcc')
      ambientLight.intensity = 3.5
      sunlight.color.set('#fff8ee')
      sunlight.intensity = 1.5
      sunlight.position.set(1.8, 1.2, 2.2)
    }
    else {
      ambientLight.color.set('#ffffff')
      ambientLight.intensity = 1
      sunlight.intensity = 0
    }
    schedule()
  }
  controls.addEventListener('change', schedule)
  const resize = new ResizeObserver(() => {
    const width = host.clientWidth
    const height = host.clientHeight
    if (!width || !height)
      return
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    schedule()
  })
  resize.observe(host)
  const visibility = () => {
    visible = !document.hidden
    if (visible)
      schedule()
  }
  document.addEventListener('visibilitychange', visibility)
  const lost = (event: Event) => {
    event.preventDefault()
    controls.autoRotate = false
    failed('WebGL 上下文已丢失，请刷新页面后选择较低等级。')
  }
  renderer.domElement.addEventListener('webglcontextlost', lost)
  let downX = 0
  let downY = 0
  const down = (event: PointerEvent) => {
    downX = event.clientX
    downY = event.clientY
  }
  const raycaster = new THREE.Raycaster()
  const sphere = new THREE.Sphere(new THREE.Vector3(), 1)
  const hit = new THREE.Vector3()
  const up = (event: PointerEvent) => {
    if (event.button !== 0 || Math.hypot(event.clientX - downX, event.clientY - downY) > 5)
      return
    const rect = renderer.domElement.getBoundingClientRect()
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
    if (raycaster.ray.intersectSphere(sphere, hit))
      pick(hit)
  }
  renderer.domElement.addEventListener('pointerdown', down)
  renderer.domElement.addEventListener('pointerup', up)

  return {
    setGeographicLabels(labels: readonly SceneGeographicLabel[]) {
      geographicLabels = [...labels].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'continent' ? -1 : 1) || b.areaKm2 - a.areaKm2 || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(label => {
        const element = document.createElement('div')
        element.textContent = label.text
        element.style.position = 'absolute'
        element.style.transform = 'translate(-50%, -50%)'
        element.style.visibility = 'hidden'
        element.style.whiteSpace = 'nowrap'
        element.style.padding = '4px 8px'
        element.style.borderRadius = '4px'
        element.style.border = label.kind === 'continent' ? '1px solid rgba(255,220,160,0.45)' : '1px solid rgba(150,212,244,0.42)'
        element.style.background = label.kind === 'continent' ? 'rgba(25,29,30,0.72)' : 'rgba(7,31,52,0.7)'
        element.style.color = label.kind === 'continent' ? '#fff1d5' : '#d9f1ff'
        element.style.font = '600 13px/1.3 system-ui, sans-serif'
        element.style.letterSpacing = '0.06em'
        element.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)'
        return { element, position: new THREE.Vector3(...label.position).normalize() }
      })
      labelLayer.replaceChildren(...geographicLabels.map(label => label.element))
      schedule()
    },
    install(data: RenderGeometry, wireframe: boolean, showSurface: boolean, nextPresentation: ScenePresentation) {
      disposeSceneObjects(base)
      disposeSceneObjects(selection)
      renderer.setPixelRatio(window.devicePixelRatio)
      const geometry = positionGeometry(data.positions)
      addRadialNormals(geometry)
      geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
      if (data.satelliteLandMask)
        geometry.setAttribute('satelliteLandMask', new THREE.BufferAttribute(data.satelliteLandMask, 1))
      climateVectors = undefined
      inlandWaterSurface = undefined
      waterSurface = undefined
      const material = nextPresentation.satellite
        ? createSatelliteSurfaceMaterial()
        : new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
      surface = new THREE.Mesh(geometry, material)
      lines = new THREE.LineSegments(positionGeometry(data.lines), new THREE.LineBasicMaterial({ color: '#25445b' }))
      fiveNeighborPoints = new THREE.Points(positionGeometry(data.fiveNeighborCenters), new THREE.PointsMaterial({ color: '#e08b3d', size: 6, sizeAttenuation: false }))
      fiveNeighborPoints.visible = false
      surfaceVisible = showSurface
      surface.visible = showSurface
      lines.visible = wireframe
      base.add(surface, lines, fiveNeighborPoints)
      if (data.climateVectorPositions?.length) {
        const vectorGeometry = positionGeometry(data.climateVectorPositions)
        if (data.climateVectorColors)
          vectorGeometry.setAttribute('color', new THREE.BufferAttribute(data.climateVectorColors, 3))
        const vectorMaterial = new THREE.LineBasicMaterial({
          color: data.climateVectorKind === 'wind' ? '#A9FFF1' : '#ffffff',
          vertexColors: data.climateVectorKind === 'ocean-current',
          transparent: true,
          opacity: 0.92,
          depthTest: true,
          depthWrite: false,
        })
        climateVectors = new THREE.LineSegments(vectorGeometry, vectorMaterial)
        climateVectors.renderOrder = 5
        climateVectors.visible = showSurface
        base.add(climateVectors)
      }
      if (data.waterPositions?.length && data.waterIndices?.length) {
        const inlandWaterGeometry = positionGeometry(data.waterPositions)
        inlandWaterGeometry.setIndex(new THREE.BufferAttribute(data.waterIndices, 1))
        inlandWaterGeometry.computeVertexNormals()
        inlandWaterSurface = new THREE.Mesh(inlandWaterGeometry, new THREE.MeshBasicMaterial({
          color: '#6C9FB5',
          side: THREE.DoubleSide,
          transparent: false,
          depthTest: true,
          depthWrite: true,
          toneMapped: false,
        }))
        inlandWaterSurface.renderOrder = 7
        inlandWaterSurface.visible = showSurface
        base.add(inlandWaterSurface)
      }
      if (nextPresentation.satellite) {
        waterSurface = createWaterMesh(geometry)
        if (waterSurface)
          base.add(waterSurface)
      }
      setPresentation(nextPresentation)
      schedule()
    },
    showSelection(data: RegionSelection) {
      disposeSceneObjects(selection)
      selection.add(new THREE.LineSegments(positionGeometry(data.ring), new THREE.LineBasicMaterial({ color: '#facc15' })))
      const links = new THREE.LineSegments(positionGeometry(data.spokes), new THREE.LineBasicMaterial({ color: '#059669', depthTest: false }))
      links.renderOrder = 1
      selection.add(links)
      const geometry = positionGeometry(data.centers)
      const colors = new Float32Array(data.centers.length)
      for (let i = 0; i < colors.length; i += 3) {
        colors[i] = i === 0 ? 1 : 0.2
        colors[i + 1] = 0.85
        colors[i + 2] = i === 0 ? 0.1 : 0.6
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      selection.add(new THREE.Points(geometry, new THREE.PointsMaterial({ vertexColors: true, size: 9, sizeAttenuation: false })))
      schedule()
    },
    setOptions(wireframe: boolean, showSurface: boolean, rotate: boolean, showFiveNeighborPoints: boolean, showGraticule: boolean) {
      if (lines)
        lines.visible = wireframe
      if (surface)
        surface.visible = showSurface
      surfaceVisible = showSurface
      if (waterSurface)
        waterSurface.visible = currentPresentation.satellite && currentPresentation.atmosphere && surfaceVisible
      if (climateVectors)
        climateVectors.visible = showSurface
      if (inlandWaterSurface)
        inlandWaterSurface.visible = showSurface
      if (fiveNeighborPoints)
        fiveNeighborPoints.visible = showFiveNeighborPoints
      graticule.visible = showGraticule
      controls.autoRotate = rotate
      schedule()
    },
    setPresentation,
    dispose() {
      disposed = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      controls.dispose()
      document.removeEventListener('visibilitychange', visibility)
      renderer.domElement.removeEventListener('webglcontextlost', lost)
      renderer.domElement.removeEventListener('pointerdown', down)
      renderer.domElement.removeEventListener('pointerup', up)
      disposeSceneObjects(base)
      disposeSceneObjects(selection)
      scene.remove(stars, atmosphere, graticule)
      disposeSceneObjects(graticule)
      stars.geometry.dispose()
      stars.material.dispose()
      atmosphere.geometry.dispose()
      atmosphere.material.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      labelLayer.remove()
      renderer.domElement.remove()
    },
  }
}
