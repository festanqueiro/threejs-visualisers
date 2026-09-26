import * as THREE from 'three'
import { disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, ThemeOption, VisualizerTheme } from '../types'

// Paint flicked at a black wall in thin, wiggling strokes that draw
// themselves on in a fraction of a second. Kicks flick a stroke (two on a
// heavy one) and the mids and highs keep a steady stream coming. Each
// stroke sinks from bright to a dark stain and then fades, so the wall
// keeps a dim history of the last few bars under the fresh paint.
//
// Drawn in screen space: y runs -1..1, x runs -aspect..aspect, and the
// vertex shaders map that straight to clip space (the theme's camera is
// unused beyond carrying the aspect ratio). Newer paint draws on top via
// renderOrder.

const MAX_STROKES = 40
const STROKE_POINTS = 48

const SCREEN_VERTEX_SHADER = /* glsl */ `
uniform float uAspect;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  gl_Position = vec4(world.x / uAspect, world.y, 0.0, 1.0);
}
`

const STROKE_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColour;
uniform float uBrightness;
uniform float uOpacity;
uniform float uReveal;
varying vec2 vUv;
void main() {
  if (vUv.x > uReveal) discard;
  float edge = 1.0 - abs(vUv.y * 2.0 - 1.0);
  float alpha = smoothstep(0.0, 0.35, edge) * uOpacity;
  if (alpha < 0.01) discard;
  // Hot core, like wet paint catching the light.
  vec3 colour = uColour * uBrightness * (0.8 + 0.6 * smoothstep(0.5, 1.0, edge));
  gl_FragColor = vec4(colour, alpha);
}
`

const OPTIONS: ThemeOption[] = [
  {
    id: 'colours',
    name: 'Colours',
    values: [
      { id: 'yellow', name: 'Yellow' },
      { id: 'shifting', name: 'Shifting' },
      { id: 'mixed', name: 'Mixed' },
    ],
  },
]

interface Mark {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  age: number
  alive: boolean
}

function makeMaterial(fragmentShader: string, aspect: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAspect: aspect,
      uColour: { value: new THREE.Color() },
      uBrightness: { value: 1 },
      uOpacity: { value: 0 },
      uReveal: { value: 0 },
    },
    vertexShader: SCREEN_VERTEX_SHADER,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
}

// A tapered ribbon along a wandering curve, in screen units: uv.x runs
// along it (0..1, for the draw-on reveal), uv.y across.
function strokeGeometry(geometry: THREE.BufferGeometry, aspect: number): void {
  const positions = new Float32Array(STROKE_POINTS * 2 * 3)
  const uvs = new Float32Array(STROKE_POINTS * 2 * 2)
  let x = (Math.random() * 2 - 1) * aspect * 0.8
  let y = (Math.random() * 2 - 1) * 0.8
  let heading = Math.random() * Math.PI * 2
  let turn = (Math.random() - 0.5) * 0.12
  const length = 1.2 + Math.random() * 1.8
  const step = length / (STROKE_POINTS - 1)
  const maxWidth = 0.004 + Math.random() * 0.016
  for (let i = 0; i < STROKE_POINTS; i++) {
    const t = i / (STROKE_POINTS - 1)
    // Thick near the start where the flick began, tapering to a point.
    const width = maxWidth * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.3 + 0.08)), 0.7) * (1 - t * 0.6)
    const nx = -Math.sin(heading)
    const ny = Math.cos(heading)
    positions.set([x + nx * width, y + ny * width, 0, x - nx * width, y - ny * width, 0], i * 6)
    uvs.set([t, 0, t, 1], i * 4)
    x += Math.cos(heading) * step
    y += Math.sin(heading) * step
    turn += (Math.random() - 0.5) * 0.06
    turn = Math.max(-0.12, Math.min(0.12, turn))
    heading += turn
  }
  const indices: number[] = []
  for (let i = 0; i < STROKE_POINTS - 1; i++) {
    const a = i * 2
    indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3)
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
}

function create(): ThemeInstance {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10)
  const aspect = { value: 16 / 9 }

  const strokes: Mark[] = []
  for (let i = 0; i < MAX_STROKES; i++) {
    const material = makeMaterial(STROKE_FRAGMENT_SHADER, aspect)
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
    mesh.frustumCulled = false
    mesh.visible = false
    scene.add(mesh)
    strokes.push({ mesh, material, age: 0, alive: false })
  }

  let colours = 'yellow'
  let hue = 0
  let order = 0
  let nextStroke = 0
  let strokeBudget = 0
  let idleBudget = 0

  function paintColour(target: THREE.Color): void {
    if (colours === 'yellow') target.setHSL(0.155 + (Math.random() - 0.5) * 0.03, 0.95, 0.5)
    else if (colours === 'mixed') target.setHSL(Math.random(), 0.9, 0.5)
    else target.setHSL((hue + (Math.random() - 0.5) * 0.08 + 1) % 1, 0.9, 0.5)
  }

  function flickStroke(): void {
    const mark = strokes[nextStroke]
    nextStroke = (nextStroke + 1) % MAX_STROKES
    const { mesh, material } = mark
    strokeGeometry(mesh.geometry, aspect.value)
    mesh.renderOrder = order++
    mesh.visible = true
    paintColour(material.uniforms.uColour.value)
    mark.age = 0
    mark.alive = true
  }

  function update(frame: AudioFrame): number {
    const { dt, bass, mid, high, beat, flash } = frame
    aspect.value = camera.aspect
    hue = frame.hue

    if (beat) {
      flickStroke()
      if (bass > 0.6) flickStroke()
    }
    strokeBudget += dt * (mid * 1.2 + high * 1.8)
    // With nothing playing, still the odd throw so the wall isn't empty.
    idleBudget += dt * 0.25
    while (strokeBudget >= 1) {
      strokeBudget -= 1
      flickStroke()
    }
    if (idleBudget >= 1) {
      idleBudget = 0
      if (bass + mid + high < 0.05) flickStroke()
    }

    // Strokes: draw on fast, stay hot briefly, then dim and fade.
    for (const mark of strokes) {
      if (!mark.alive) continue
      mark.age += dt
      const u = mark.material.uniforms
      u.uReveal.value = Math.min(1, mark.age / 0.22)
      u.uBrightness.value = 0.15 + 0.85 * Math.exp(-mark.age * 1.2)
      u.uOpacity.value = Math.exp(-mark.age * 0.6)
      if (u.uOpacity.value < 0.02) {
        mark.alive = false
        mark.mesh.visible = false
      }
    }
    return 0.35 + flash * 0.35
  }

  return {
    scene,
    camera,
    update,
    dispose: () => disposeScene(scene),
    setOption: (optionId, valueId) => {
      if (optionId === 'colours') colours = valueId
    },
  }
}

export const paintTheme: VisualizerTheme = { id: 'paint', name: 'Paint', create, options: OPTIONS }
