import * as THREE from 'three'
import { createDotTexture, disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, ThemeOption, VisualizerTheme } from '../types'

// A knot orbited by smaller knots, each orbited by smaller knots again:
// 26 torus knots in three sizes, every one a wobbling striped tube. Real
// meshes this time — the nesting is just the scene graph.
//
// Bass thickens the tubes, mids spin the orbits, highs ripple the tube
// surfaces, and kicks throw the rings of knots outward.

// One entry per size of knot, biggest first. `p` and `q` are the knot's
// windings; `children` knots orbit it at `orbit` (in its own units),
// each `scale` times its size.
const LEVELS = [
  { p: 2, q: 3, tubular: 220, radial: 18, children: 5, orbit: 3.0, scale: 0.4, ripples: 14, bands: 24 },
  { p: 3, q: 4, tubular: 160, radial: 14, children: 4, orbit: 2.7, scale: 0.38, ripples: 10, bands: 16 },
  { p: 2, q: 5, tubular: 110, radial: 10, children: 0, orbit: 0, scale: 0, ripples: 8, bands: 10 },
]
const STAR_COUNT = 500

const VERTEX_SHADER = /* glsl */ `
uniform float uWave;
uniform float uBass;
uniform float uHigh;
uniform float uRipples;
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec2 vUv;
void main() {
  vUv = uv;
  // uv.x runs once round the whole knot, so whole-number ripples meet up.
  float along = uv.x * 6.2831853;
  float disp = uBass * 0.1
    + sin(along * uRipples + uWave * 3.0) * (0.03 + uHigh * 0.12)
    + sin(along * 3.0 - uWave) * 0.05;
  vec4 mv = modelViewMatrix * vec4(position + normal * disp, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`

const FRAGMENT_SHADER = /* glsl */ `
uniform float uWave;
uniform float uFlash;
uniform float uBands;
uniform vec3 uColorA;
uniform vec3 uColorB;
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec2 vUv;
void main() {
  float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 2.0);
  // Stripes travelling along the tube.
  float band = 0.5 + 0.5 * sin(vUv.x * 6.2831853 * uBands - uWave * 2.0);
  vec3 color = mix(uColorA, uColorB, band);
  color = color * (0.12 + fresnel * 0.95) + uColorB * band * band * 0.15 + uFlash * 0.1;
  gl_FragColor = vec4(color, 1.0);
}
`

const OPTIONS: ThemeOption[] = [
  {
    id: 'colours',
    name: 'Colours',
    values: [
      { id: 'neon', name: 'Neon' },
      { id: 'gold', name: 'Gold' },
      { id: 'ice', name: 'Ice' },
      { id: 'shifting', name: 'Shifting' },
    ],
  },
]

// One base colour per size of knot, and the stripe colour they share.
interface Palette {
  levels: [number, number, number]
  stripe: number
}

const PALETTES: Record<string, Palette> = {
  neon: { levels: [0xff2fa0, 0x7a4bff, 0x22e0ff], stripe: 0xfff27a },
  gold: { levels: [0xff9a1f, 0xd4472a, 0xffd86e], stripe: 0xfff6e0 },
  ice: { levels: [0x2a6cff, 0x5fd6ff, 0xb48cff], stripe: 0xffffff },
}

function create(): ThemeInstance {
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x000000, 0.02)
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100)
  camera.position.set(0, 0, 12)

  const levelUniforms = LEVELS.map((level) => ({
    uWave: { value: 0 },
    uBass: { value: 0 },
    uHigh: { value: 0 },
    uFlash: { value: 0 },
    uRipples: { value: level.ripples },
    uBands: { value: level.bands },
    uColorA: { value: new THREE.Color() },
    uColorB: { value: new THREE.Color() },
  }))
  const geometries = LEVELS.map((level) => new THREE.TorusKnotGeometry(1, 0.3, level.tubular, level.radial, level.p, level.q))
  const materials = levelUniforms.map(
    (uniforms) => new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER }),
  )

  // Each knot's children hang off pivots that turn about a tilted axis;
  // an arm holds the child out at the orbit radius. The knot meshes spin
  // on their own, so their spin doesn't drag the children round.
  const knots: Array<{ mesh: THREE.Mesh; spin: number }> = []
  const pivots: Array<{ pivot: THREE.Object3D; speed: number }> = []
  const arms: Array<{ arm: THREE.Object3D; orbit: number }> = []

  function build(levelIndex: number, parent: THREE.Object3D): void {
    const level = LEVELS[levelIndex]
    const mesh = new THREE.Mesh(geometries[levelIndex], materials[levelIndex])
    parent.add(mesh)
    knots.push({ mesh, spin: (knots.length % 2 === 0 ? 1 : -1) * (0.6 + levelIndex * 0.5) })
    for (let i = 0; i < level.children; i++) {
      const tilt = new THREE.Object3D()
      tilt.rotation.set(0.3 * Math.sin(i * 2.1 + levelIndex), 0, (i - (level.children - 1) / 2) * 0.35)
      const pivot = new THREE.Object3D()
      pivot.rotation.y = (i / level.children) * Math.PI * 2
      const arm = new THREE.Object3D()
      arm.position.x = level.orbit
      arm.scale.setScalar(level.scale)
      parent.add(tilt)
      tilt.add(pivot)
      pivot.add(arm)
      pivots.push({ pivot, speed: (levelIndex % 2 === 0 ? 1 : -1) * (1 + levelIndex * 1.4) })
      arms.push({ arm, orbit: level.orbit })
      build(levelIndex + 1, arm)
    }
  }
  const root = new THREE.Group()
  scene.add(root)
  build(0, root)

  const starPositions = new Float32Array(STAR_COUNT * 3)
  const starPoint = new THREE.Vector3()
  for (let i = 0; i < STAR_COUNT; i++) {
    starPoint.randomDirection().multiplyScalar(14 + Math.random() * 14)
    starPoint.toArray(starPositions, i * 3)
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  const starMaterial = new THREE.PointsMaterial({
    size: 0.12,
    map: createDotTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const stars = new THREE.Points(starGeometry, starMaterial)
  scene.add(stars)

  // Shifting has no fixed palette: it's rebuilt every frame from the
  // frame's hue (see shiftColours).
  let shifting = false
  function setColours(paletteId: string): void {
    shifting = paletteId === 'shifting'
    if (shifting) return
    const palette = PALETTES[paletteId] ?? PALETTES.neon
    levelUniforms.forEach((uniforms, i) => {
      uniforms.uColorA.value.setHex(palette.levels[i])
      uniforms.uColorB.value.setHex(palette.stripe)
    })
    starMaterial.color.setHex(palette.stripe)
  }
  setColours('neon')

  // Each size of knot a third of the way further round the colour wheel.
  function shiftColours(hue: number): void {
    levelUniforms.forEach((uniforms, i) => {
      uniforms.uColorA.value.setHSL((hue + i * 0.33) % 1, 0.95, 0.55)
      uniforms.uColorB.value.setHSL((hue + 0.5) % 1, 0.9, 0.75)
    })
    starMaterial.color.setHSL((hue + 0.5) % 1, 0.6, 0.7)
  }

  let wave = 0

  function update(frame: AudioFrame): number {
    const { t, dt, bass, mid, high, energy, flash, hue } = frame
    if (shifting) shiftColours(hue)

    // Integrated, so the music changing never jumps anything.
    wave += dt * (1 + high * 3 + mid * 2)
    for (const uniforms of levelUniforms) {
      uniforms.uWave.value = wave
      uniforms.uBass.value = bass
      uniforms.uHigh.value = high
      uniforms.uFlash.value = flash
    }

    for (const { mesh, spin } of knots) {
      mesh.rotation.x += dt * spin * (0.2 + energy * 0.8)
      mesh.rotation.y += dt * spin * 0.15
    }
    for (const { pivot, speed } of pivots) pivot.rotation.y += dt * speed * (0.12 + mid * 0.9)
    const throwOut = 1 + flash * 0.25 + bass * 0.1
    for (const { arm, orbit } of arms) arm.position.x = orbit * throwOut
    root.rotation.y += dt * 0.08
    root.rotation.x = Math.sin(t * 0.11) * 0.3

    stars.rotation.y -= dt * 0.02
    starMaterial.size = 0.1 + high * 0.14

    camera.position.x = Math.sin(t * 0.21) * 0.9
    camera.position.y = Math.cos(t * 0.17) * 0.6
    camera.position.z = 12 - flash * 0.5
    camera.lookAt(0, 0, 0)

    return 0.45 + bass * 0.5 + flash * 0.35
  }

  return {
    scene,
    camera,
    update,
    dispose: () => disposeScene(scene),
    setOption: (optionId, valueId) => {
      if (optionId === 'colours') setColours(valueId)
    },
  }
}

export const tangleTheme: VisualizerTheme = { id: 'tangle', name: 'Tangle', create, options: OPTIONS }
