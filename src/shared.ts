import * as THREE from 'three'
import { logBinRanges, follow } from './audio'
import type { AudioFrame } from './types'

// Smoothed per-bar levels (0..1) over log-spaced frequency bands, for
// themes that draw a spectrum. Bin ranges are recomputed only when the
// analyser's bin count or sample rate changes (i.e. basically never).
export class SpectrumBars {
  readonly levels: Float32Array
  private ranges: Array<[number, number]> = []
  private rangesKey = ''

  constructor(
    private readonly bars: number,
    private readonly minHz = 30,
    private readonly maxHz = 16000,
  ) {
    this.levels = new Float32Array(bars)
  }

  update(frame: AudioFrame, attack = 0.6, release = 0.12): Float32Array {
    const { freq, sampleRate } = frame
    const key = `${freq.length}@${sampleRate}`
    if (freq.length > 0 && key !== this.rangesKey) {
      this.ranges = logBinRanges(freq.length, sampleRate, this.bars, this.minHz, this.maxHz)
      this.rangesKey = key
    }
    for (let i = 0; i < this.bars; i++) {
      let peak = 0
      if (freq.length > 0) {
        const [start, end] = this.ranges[i]
        for (let b = start; b <= end; b++) if (freq[b] > peak) peak = freq[b]
      }
      this.levels[i] = follow(this.levels[i], peak / 255, attack, release, frame.dt)
    }
    return this.levels
  }
}

// Round, soft-edged dot for particle fields — PointsMaterial draws hard
// squares otherwise.
export function createDotTexture(): THREE.Texture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

// Disposes every geometry/material/texture reachable from a scene — themes
// call this from dispose() instead of tracking each resource by hand.
export function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      material.dispose()
    }
  })
}

// A quad covering the whole viewport, for themes drawn entirely in a
// fragment shader. The vertex shader ignores the camera (clip-space
// passthrough), so the theme's camera only has to exist — its aspect
// (kept current by VisualizerEngine) is what the shader needs to keep
// shapes round.
export const FULLSCREEN_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export function createFullscreenQuad(material: THREE.ShaderMaterial): THREE.Mesh {
  material.depthTest = false
  material.depthWrite = false
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  quad.frustumCulled = false
  return quad
}

// Shared GLSL: value noise + fractal Brownian motion.
export const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) {
    value += amplitude * valueNoise(p);
    p = turn * p;
    amplitude *= 0.5;
  }
  return value;
}
`
