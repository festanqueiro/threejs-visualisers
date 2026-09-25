import * as THREE from 'three'
import { SpectrumBars, createDotTexture, disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, VisualizerTheme } from '../types'

const RING_BARS = 128 // mirrored: the first half is drawn again, flipped, so the ring is symmetric
const RING_RADIUS = 2.1
const PARTICLE_COUNT = 3000
const TUNNEL_DEPTH = 40

// Ashima Arts / Stefan Gustavson 3D simplex noise (MIT) — drives the
// core blob's surface displacement.
const SIMPLEX_NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`

const CORE_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uBass;
uniform float uHigh;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vDisp;
${SIMPLEX_NOISE_GLSL}
void main() {
  float slow = snoise(normal * 1.4 + vec3(uTime * 0.25));
  float fast = snoise(normal * 4.0 + vec3(uTime * 0.9));
  float disp = slow * (0.12 + uBass * 0.55) + fast * (0.02 + uHigh * 0.22);
  vDisp = disp;
  vec4 mv = modelViewMatrix * vec4(position + normal * disp, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`

const CORE_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uFlash;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vDisp;
void main() {
  float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.0);
  vec3 color = mix(uColorA, uColorB, clamp(vDisp * 2.5 + 0.5, 0.0, 1.0));
  color = color * (0.05 + fresnel * 0.9) + uFlash * 0.12;
  gl_FragColor = vec4(color, 1.0);
}
`

// A noise-displaced glowing core that swells with the bass, a mirrored
// log-frequency spectrum ring around it, and a particle field streaming
// toward the viewer whose speed follows overall energy.
function create(): ThemeInstance {
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x000000, 0.045)
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 0, 6)

  const coreUniforms = {
    uTime: { value: 0 },
    uBass: { value: 0 },
    uHigh: { value: 0 },
    uFlash: { value: 0 },
    uColorA: { value: new THREE.Color() },
    uColorB: { value: new THREE.Color() },
  }
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.1, 48),
    new THREE.ShaderMaterial({
      uniforms: coreUniforms,
      vertexShader: CORE_VERTEX_SHADER,
      fragmentShader: CORE_FRAGMENT_SHADER,
    }),
  )
  scene.add(core)

  // Bars are unit-height boxes with their base at the origin, so scaling
  // Y grows them outward from the ring.
  const barGeometry = new THREE.BoxGeometry(0.035, 1, 0.035)
  barGeometry.translate(0, 0.5, 0)
  const ring = new THREE.InstancedMesh(barGeometry, new THREE.MeshBasicMaterial({ toneMapped: false }), RING_BARS)
  scene.add(ring)
  const spectrum = new SpectrumBars(RING_BARS / 2)
  const barMatrix = new THREE.Matrix4()
  const barPosition = new THREE.Vector3()
  const barQuaternion = new THREE.Quaternion()
  const barScale = new THREE.Vector3(1, 1, 1)
  const zAxis = new THREE.Vector3(0, 0, 1)
  const barColor = new THREE.Color()

  const particlePositions = new Float32Array(PARTICLE_COUNT * 3)
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2
    const radius = 3 + Math.random() * 6
    particlePositions[i * 3] = Math.cos(angle) * radius
    particlePositions[i * 3 + 1] = Math.sin(angle) * radius
    particlePositions[i * 3 + 2] = -Math.random() * TUNNEL_DEPTH + 6
  }
  const particleGeometry = new THREE.BufferGeometry()
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))
  const particleMaterial = new THREE.PointsMaterial({
    size: 0.08,
    map: createDotTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const particles = new THREE.Points(particleGeometry, particleMaterial)
  scene.add(particles)

  function update(frame: AudioFrame): number {
    const { t, dt, bass, mid, high, energy, flash, hue } = frame

    coreUniforms.uTime.value = t
    coreUniforms.uBass.value = bass
    coreUniforms.uHigh.value = high
    coreUniforms.uFlash.value = flash
    coreUniforms.uColorA.value.setHSL(hue, 0.9, 0.5)
    coreUniforms.uColorB.value.setHSL((hue + 0.35) % 1, 0.9, 0.6)
    core.scale.setScalar(1 + bass * 0.35 + flash * 0.08)
    core.rotation.y += dt * (0.15 + mid * 0.6)
    core.rotation.x += dt * 0.07

    const levels = spectrum.update(frame)
    const half = RING_BARS / 2
    for (let i = 0; i < RING_BARS; i++) {
      const mirrored = i < half ? i : RING_BARS - 1 - i
      const level = levels[mirrored]
      const angle = (i / RING_BARS) * Math.PI * 2 + Math.PI / 2
      const radius = RING_RADIUS + bass * 0.3
      barPosition.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
      barQuaternion.setFromAxisAngle(zAxis, angle - Math.PI / 2)
      barScale.set(1, 0.04 + level * level * 2.2, 1)
      barMatrix.compose(barPosition, barQuaternion, barScale)
      ring.setMatrixAt(i, barMatrix)
      barColor.setHSL((hue + (mirrored / half) * 0.25) % 1, 0.9, 0.2 + level * 0.3)
      ring.setColorAt(i, barColor)
    }
    ring.instanceMatrix.needsUpdate = true
    if (ring.instanceColor) ring.instanceColor.needsUpdate = true
    ring.rotation.z += dt * (0.05 + high * 0.3)

    const speed = (1.5 + energy * 18 + flash * 10) * dt
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const zi = i * 3 + 2
      particlePositions[zi] += speed
      if (particlePositions[zi] > 6) particlePositions[zi] -= TUNNEL_DEPTH
    }
    particleGeometry.attributes.position.needsUpdate = true
    particles.rotation.z += dt * 0.03
    particleMaterial.color.setHSL((hue + 0.5) % 1, 0.7, 0.35 + high * 0.25)
    particleMaterial.size = 0.06 + high * 0.12

    camera.position.x = Math.sin(t * 0.21) * 0.6
    camera.position.y = Math.cos(t * 0.17) * 0.4
    camera.position.z = 6 - flash * 0.35
    camera.lookAt(0, 0, 0)

    return 0.5 + bass * 0.6 + flash * 0.4
  }

  return {
    scene,
    camera,
    update,
    dispose: () => {
      ring.dispose()
      disposeScene(scene)
    },
  }
}

export const nebulaTheme: VisualizerTheme = { id: 'nebula', name: 'Nebula', create }
