import * as THREE from 'three'
import { SpectrumBars, createDotTexture, disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, VisualizerTheme } from '../types'

const RING_COUNT = 56
const RING_SEGMENTS = 128 // mirrored: 64 spectrum bars, drawn twice
const RING_SPACING = 1.1
const TUNNEL_DEPTH = RING_COUNT * RING_SPACING
const BASE_RADIUS = 2.4
const STREAK_COUNT = 1500

// Writes a spectrum-shaped ribbon (inner + outer edge per segment) into a
// ring's position buffer.
function stampRing(positions: Float32Array, levels: Float32Array, bass: number): void {
  const half = RING_SEGMENTS / 2
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const level = levels[i < half ? i : RING_SEGMENTS - 1 - i]
    const angle = (i / RING_SEGMENTS) * Math.PI * 2 + Math.PI / 2
    const inner = BASE_RADIUS - level * 0.9 - bass * 0.2
    const outer = inner + 0.02 + level * 0.05
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    positions.set([cos * inner, sin * inner, 0, cos * outer, sin * outer, 0], i * 6)
  }
}

// A tunnel of spectrum-shaped rings flying at the viewer. Each ring is
// stamped with the spectrum at the moment it's recycled to the far end,
// so the tunnel walls are a scrolling history of the track — loud
// passages close in on you, breakdowns open up.
function create(): ThemeInstance {
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x000000, TUNNEL_DEPTH * 0.35, TUNNEL_DEPTH * 0.95)
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 200)
  camera.position.set(0, 0, 2)

  const indices: number[] = []
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a = i * 2
    const b = ((i + 1) % RING_SEGMENTS) * 2
    indices.push(a, a + 1, b, b, a + 1, b + 1)
  }
  const spectrum = new SpectrumBars(RING_SEGMENTS / 2)
  const rings: Array<{ mesh: THREE.Mesh; positions: Float32Array; material: THREE.MeshBasicMaterial }> = []
  for (let r = 0; r < RING_COUNT; r++) {
    const positions = new Float32Array(RING_SEGMENTS * 6)
    stampRing(positions, spectrum.levels, 0)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    const material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    material.color.setHSL(r / RING_COUNT, 0.8, 0.3)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.z = -r * RING_SPACING
    scene.add(mesh)
    rings.push({ mesh, positions, material })
  }

  const streakPositions = new Float32Array(STREAK_COUNT * 3)
  for (let i = 0; i < STREAK_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2
    const radius = 0.3 + Math.random() * 1.8
    streakPositions[i * 3] = Math.cos(angle) * radius
    streakPositions[i * 3 + 1] = Math.sin(angle) * radius
    streakPositions[i * 3 + 2] = -Math.random() * TUNNEL_DEPTH
  }
  const streakGeometry = new THREE.BufferGeometry()
  streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3))
  const streakMaterial = new THREE.PointsMaterial({
    size: 0.05,
    map: createDotTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  scene.add(new THREE.Points(streakGeometry, streakMaterial))

  let twist = 0

  function update(frame: AudioFrame): number {
    const { t, dt, bass, mid, high, energy, flash, hue } = frame
    const levels = spectrum.update(frame, 0.7, 0.2)
    const speed = (5 + energy * 28 + flash * 18) * dt
    twist += dt * (0.1 + mid * 0.6)

    for (const ring of rings) {
      ring.mesh.position.z += speed
      if (ring.mesh.position.z > camera.position.z + 0.5) {
        ring.mesh.position.z -= TUNNEL_DEPTH
        stampRing(ring.positions, levels, bass)
        ring.mesh.geometry.attributes.position.needsUpdate = true
        ring.mesh.rotation.z = twist
        let loudness = 0
        for (let i = 0; i < levels.length; i++) loudness += levels[i]
        loudness /= levels.length
        ring.material.color.setHSL((hue + loudness * 0.3) % 1, 0.9, 0.15 + loudness * 0.3)
      }
      ring.mesh.scale.setScalar(1 + flash * 0.06)
    }

    for (let i = 0; i < STREAK_COUNT; i++) {
      const zi = i * 3 + 2
      streakPositions[zi] += speed * 1.6
      if (streakPositions[zi] > camera.position.z) streakPositions[zi] -= TUNNEL_DEPTH
    }
    streakGeometry.attributes.position.needsUpdate = true
    streakMaterial.color.setHSL((hue + 0.5) % 1, 0.5, 0.4 + high * 0.25)

    camera.rotation.z = Math.sin(t * 0.13) * 0.35 + twist * 0.2
    camera.position.x = Math.sin(t * 0.5) * 0.15
    camera.position.y = Math.cos(t * 0.37) * 0.15

    return 0.5 + bass * 0.5 + flash * 0.4
  }

  return { scene, camera, update, dispose: () => disposeScene(scene) }
}

export const warpTheme: VisualizerTheme = { id: 'warp', name: 'Warp', create }
