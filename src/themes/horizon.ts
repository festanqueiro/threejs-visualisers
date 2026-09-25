import * as THREE from 'three'
import { SpectrumBars, createDotTexture, disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, VisualizerTheme } from '../types'

const COLS = 96
const ROWS = 64
const WIDTH = 44
const DEPTH = 52
const ROW_SPACING = DEPTH / ROWS
const STEP_SECONDS = 1 / 20 // one spectrum row per step
const VERTS_PER_ROW = COLS + 1
const STAR_COUNT = 800

const SUN_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// Classic synthwave sun: vertical gradient, with horizontal slats cut out
// of the lower half that drift downward.
const SUN_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform float uTime;
uniform float uGlow;
varying vec2 vUv;
void main() {
  vec3 color = mix(uBottom, uTop, vUv.y);
  if (vUv.y < 0.5) {
    float stripe = fract((vUv.y + uTime * 0.04) * 16.0);
    float gap = mix(0.5, 0.04, vUv.y * 2.0);
    if (stripe < gap) discard;
  }
  gl_FragColor = vec4(color * (0.55 + uGlow), 1.0);
}
`

// A synthwave wireframe landscape built from the spectrum as it scrolls
// toward the viewer — a flat road down the middle, mountains on either
// side (bass nearest the road, treble out at the edges), under a
// striped sun that pulses with the kick.
function create(): ThemeInstance {
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x000000, DEPTH * 0.3, DEPTH * 0.95)
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 300)

  // Plane in XZ: after rotateX, row 0 is the far edge and the last row
  // the nearest, with vertex index = row * VERTS_PER_ROW + col.
  const terrainGeometry = new THREE.PlaneGeometry(WIDTH, DEPTH, COLS, ROWS)
  terrainGeometry.rotateX(-Math.PI / 2)
  const positionAttribute = terrainGeometry.attributes.position as THREE.BufferAttribute
  const positions = positionAttribute.array as Float32Array

  // Solid black copy underneath so the grid hides lines behind mountains;
  // polygonOffset pushes it back just enough that the lines win.
  const occluder = new THREE.Mesh(
    terrainGeometry,
    new THREE.MeshBasicMaterial({ color: 0x000000, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
  )
  // Grid lines (no triangle diagonals) sharing the same position buffer.
  const gridIndices: number[] = []
  for (let r = 0; r <= ROWS; r++) {
    for (let c = 0; c < COLS; c++) gridIndices.push(r * VERTS_PER_ROW + c, r * VERTS_PER_ROW + c + 1)
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS; c++) gridIndices.push(r * VERTS_PER_ROW + c, (r + 1) * VERTS_PER_ROW + c)
  }
  const gridGeometry = new THREE.BufferGeometry()
  gridGeometry.setAttribute('position', positionAttribute)
  gridGeometry.setIndex(gridIndices)
  const gridMaterial = new THREE.LineBasicMaterial({ toneMapped: false })
  const grid = new THREE.LineSegments(gridGeometry, gridMaterial)
  const terrain = new THREE.Group()
  terrain.add(occluder, grid)
  scene.add(terrain)

  const heights = new Float32Array((ROWS + 1) * VERTS_PER_ROW)
  const spectrum = new SpectrumBars(COLS / 2 + 1, 30, 14000)

  const sunUniforms = {
    uTop: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
    uTime: { value: 0 },
    uGlow: { value: 0 },
  }
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(14, 64),
    new THREE.ShaderMaterial({ uniforms: sunUniforms, vertexShader: SUN_VERTEX_SHADER, fragmentShader: SUN_FRAGMENT_SHADER }),
  )
  sun.position.set(0, 9, -110)
  scene.add(sun)

  const starPositions = new Float32Array(STAR_COUNT * 3)
  for (let i = 0; i < STAR_COUNT; i++) {
    starPositions[i * 3] = (Math.random() - 0.5) * 300
    starPositions[i * 3 + 1] = 5 + Math.random() * 90
    starPositions[i * 3 + 2] = -120 - Math.random() * 20
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  const starMaterial = new THREE.PointsMaterial({
    size: 0.8,
    map: createDotTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  })
  scene.add(new THREE.Points(starGeometry, starMaterial))

  let stepAccumulator = 0

  function pushRow(levels: Float32Array): void {
    heights.copyWithin(VERTS_PER_ROW, 0, ROWS * VERTS_PER_ROW)
    const center = COLS / 2
    for (let c = 0; c <= COLS; c++) {
      const d = Math.abs(c - center) / center // 0 at the road, 1 at the edges
      const edge = THREE.MathUtils.smoothstep(d, 0.06, 0.35)
      const level = levels[Math.round(d * (levels.length - 1))]
      heights[c] = edge * (0.25 + level * level * 7 * (0.6 + d))
    }
    for (let i = 0; i < heights.length; i++) positions[i * 3 + 1] = heights[i]
    positionAttribute.needsUpdate = true
  }

  function update(frame: AudioFrame): number {
    const { t, dt, bass, high, flash, hue } = frame
    const levels = spectrum.update(frame, 0.7, 0.25)

    stepAccumulator += dt
    while (stepAccumulator >= STEP_SECONDS) {
      stepAccumulator -= STEP_SECONDS
      pushRow(levels)
    }
    // Slide smoothly between steps; each pushRow snaps back by one row.
    terrain.position.z = (stepAccumulator / STEP_SECONDS) * ROW_SPACING

    gridMaterial.color.setHSL((hue + 0.8) % 1, 0.95, 0.3 + flash * 0.15)
    sunUniforms.uTime.value = t
    sunUniforms.uGlow.value = bass * 0.35 + flash * 0.25
    sunUniforms.uTop.value.setHSL((hue + 0.12) % 1, 1, 0.6)
    sunUniforms.uBottom.value.setHSL((hue + 0.92) % 1, 1, 0.5)
    sun.scale.setScalar(1 + bass * 0.12)
    starMaterial.opacity = 0.5 + high * 0.5

    camera.position.set(Math.sin(t * 0.2) * 1.2, 2.2 + Math.sin(t * 0.33) * 0.3 - flash * 0.15, DEPTH / 2 - 3)
    camera.lookAt(0, 3, -DEPTH)

    return 0.45 + bass * 0.4 + flash * 0.3
  }

  return {
    scene,
    camera,
    update,
    dispose: () => {
      // Shares terrainGeometry's position buffer; disposeScene disposes both geometries.
      disposeScene(scene)
    },
  }
}

export const horizonTheme: VisualizerTheme = { id: 'horizon', name: 'Horizon', create }
