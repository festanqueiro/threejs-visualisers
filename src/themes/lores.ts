import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, createFullscreenQuad, disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, ThemeOption, VisualizerTheme } from '../types'

// A 90s demoscene plasma in big pixels, limited to a small palette and
// ordered-dithered between its colours like old hardware. Bass warps it,
// the overall level brightens it, mids and highs speed it up, and kicks
// jump it along with a flash.
//
// Almost no 3D: each frame is drawn on the CPU into a tiny pixel buffer
// (HEIGHT pixels tall, as wide as the aspect needs), uploaded as one
// texture and stretched over a fullscreen quad with nearest filtering so
// the pixels stay sharp. No bloom.

const HEIGHT = 90

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uPixels;
varying vec2 vUv;
void main() {
  // Rows are written top-down; texture row 0 is at the bottom.
  gl_FragColor = texture2D(uPixels, vec2(vUv.x, 1.0 - vUv.y));
}
`

const OPTIONS: ThemeOption[] = [
  {
    id: 'palette',
    name: 'Palette',
    values: [
      { id: 'shifting', name: 'Shifting' },
      { id: 'gameboy', name: 'Game Boy' },
      { id: 'amber', name: 'Amber' },
      { id: 'cga', name: 'CGA' },
    ],
  },
]

// Fixed palettes, darkest first. Shifting is rebuilt each frame from the hue.
const FIXED_PALETTES: Record<string, string[]> = {
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  amber: ['#0a0400', '#3a1c00', '#6b3500', '#9a4d00', '#c86600', '#ec8a10', '#ffb030', '#ffe0a0'],
  cga: ['#000000', '#aa00aa', '#ff55ff', '#00aaaa', '#55ffff', '#ffffff'],
}
const SHIFTING_STEPS = 8

// 4x4 ordered-dither thresholds (0..1), for shading between palette
// entries the way old hardware had to.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)

function create(): ThemeInstance {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10)
  const uniforms = { uPixels: { value: null as THREE.DataTexture | null } }
  scene.add(
    createFullscreenQuad(
      new THREE.ShaderMaterial({ uniforms, vertexShader: FULLSCREEN_VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER }),
    ),
  )

  // Sized by resize() to the current aspect.
  let width = 0
  let indices = new Uint8Array(0) // palette index per pixel, row 0 at the top
  let texture: THREE.DataTexture | null = null

  let paletteId = 'shifting'
  let palette: number[][] = []
  const colour = new THREE.Color()
  let plasmaShift = 0
  let plasmaTime = 0

  function resize(aspect: number): void {
    const next = Math.max(16, Math.round(HEIGHT * aspect))
    if (next === width) return
    width = next
    indices = new Uint8Array(width * HEIGHT)
    texture?.dispose()
    texture = new THREE.DataTexture(new Uint8Array(width * HEIGHT * 4), width, HEIGHT, THREE.RGBAFormat)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.colorSpace = THREE.SRGBColorSpace
    uniforms.uPixels.value = texture
  }

  function buildPalette(hue: number): void {
    const fixed = FIXED_PALETTES[paletteId]
    if (fixed) {
      palette = fixed.map((hex) => colour.set(hex).toArray().map((c) => Math.round(c * 255)))
      return
    }
    palette = []
    for (let i = 0; i < SHIFTING_STEPS; i++) {
      const k = i / (SHIFTING_STEPS - 1)
      colour.setHSL((hue + k * 0.3) % 1, 0.85, 0.03 + k * 0.62)
      palette.push(colour.toArray().map((c) => Math.round(c * 255)))
    }
  }

  function update(frame: AudioFrame): number {
    const { dt, bass, mid, high, energy, beat, flash, hue } = frame
    resize(camera.aspect)
    buildPalette(hue)
    const top = palette.length - 1

    // Quiet, it sits in the darker half of the palette; the louder it gets
    // (and on each kick) the higher up the palette it reaches.
    if (beat) plasmaShift += 0.6 + Math.random() * 1.2
    plasmaTime += dt * (0.5 + bass * 1.2 + (mid + high) * 0.8)
    const warp = 1 + bass * 1.5
    const range = top * Math.min(1, 0.45 + energy * 0.6)
    const boost = flash * top * 0.3
    for (let y = 0; y < HEIGHT; y++) {
      const fy = y / HEIGHT
      for (let x = 0; x < width; x++) {
        const fx = x / HEIGHT
        const v =
          Math.sin(fx * 6 * warp + plasmaTime) +
          Math.sin((fy * 5 + plasmaTime * 0.7) * warp) +
          Math.sin((fx * 4 + fy * 4) * warp - plasmaTime * 1.3) +
          Math.sin(Math.hypot(fx - 0.9, fy - 0.5) * 9 * warp - plasmaTime + plasmaShift)
        // v is -4..4; fold it into a repeating 0..1 band.
        const band = (v * 0.25 + 1 + plasmaShift * 0.1) % 1
        const level = band * range + boost + BAYER[(y & 3) * 4 + (x & 3)]
        indices[y * width + x] = Math.min(top, Math.floor(level))
      }
    }

    // Palette lookup into the texture.
    const data = texture!.image.data as Uint8Array
    for (let p = 0; p < indices.length; p++) {
      const [r, g, b] = palette[indices[p]]
      data[p * 4] = r
      data[p * 4 + 1] = g
      data[p * 4 + 2] = b
      data[p * 4 + 3] = 255
    }
    texture!.needsUpdate = true
    return 0
  }

  return {
    scene,
    camera,
    update,
    dispose: () => {
      texture?.dispose()
      disposeScene(scene)
    },
    setOption: (optionId, valueId) => {
      if (optionId === 'palette') paletteId = valueId
    },
  }
}

export const loresTheme: VisualizerTheme = { id: 'lores', name: 'LO-RES', create, options: OPTIONS }
