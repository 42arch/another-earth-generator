import type { DebugGeometry, DebugSelection } from './mesh-debug-data'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export function disposeDebugObjects(group: THREE.Group): void {
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

/** Disposable Web-only debug scene; no formal renderer or map layer contracts. */
export function createDebugScene(host: HTMLElement, pick: (position: THREE.Vector3) => void, rendered: (geometries: number) => void, failed: (message: string) => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' })
  renderer.setClearColor('#f1f5f9')
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.domElement.setAttribute('aria-label', '球面网格；拖动旋转，滚轮缩放，点击选择区域')
  renderer.domElement.style.touchAction = 'none'
  host.append(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 20)
  camera.position.set(0.5, 0.3, 3.1)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.minDistance = 1.15
  controls.maxDistance = 7
  controls.autoRotateSpeed = 0.6
  const base = new THREE.Group()
  const selection = new THREE.Group()
  scene.add(base, selection)
  let lines: THREE.LineSegments | undefined
  let surface: THREE.Mesh | undefined
  let frame = 0
  let disposed = false
  let visible = true
  const draw = () => {
    frame = 0
    if (disposed || !visible)
      return
    controls.update()
    renderer.render(scene, camera)
    rendered(renderer.info.memory.geometries)
    if (controls.autoRotate)
      schedule()
  }
  function schedule() {
    if (!frame && !disposed && visible)
      frame = requestAnimationFrame(draw)
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
    install(data: DebugGeometry, level: number, wireframe: boolean, showSurface: boolean) {
      disposeDebugObjects(base)
      disposeDebugObjects(selection)
      renderer.setPixelRatio(level >= 6 ? 1 : Math.min(devicePixelRatio, 2))
      const geometry = positionGeometry(data.positions)
      geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
      surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }))
      lines = new THREE.LineSegments(positionGeometry(data.lines), new THREE.LineBasicMaterial({ color: '#25445b' }))
      const points = new THREE.Points(positionGeometry(data.fiveNeighborCenters), new THREE.PointsMaterial({ color: '#e08b3d', size: 6, sizeAttenuation: false }))
      surface.visible = showSurface
      lines.visible = wireframe
      base.add(surface, lines, points)
      schedule()
    },
    showSelection(data: DebugSelection) {
      disposeDebugObjects(selection)
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
    setOptions(wireframe: boolean, showSurface: boolean, rotate: boolean) {
      if (lines)
        lines.visible = wireframe
      if (surface)
        surface.visible = showSurface
      controls.autoRotate = rotate
      schedule()
    },
    reset() {
      camera.position.set(0.5, 0.3, 3.1)
      controls.target.set(0, 0, 0)
      controls.update()
      schedule()
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      controls.dispose()
      document.removeEventListener('visibilitychange', visibility)
      renderer.domElement.removeEventListener('webglcontextlost', lost)
      renderer.domElement.removeEventListener('pointerdown', down)
      renderer.domElement.removeEventListener('pointerup', up)
      disposeDebugObjects(base)
      disposeDebugObjects(selection)
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
