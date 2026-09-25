import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import systemMbUrl from '../assets/system-mb.glb?url'
import { SpectrumBars, disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, ThemeOption, VisualizerTheme } from '../types'

// A Jamaican-style sound system stack, modelled on a classic outdoor set,
// out in a festival field in full sun: grass, a black scrim fence, trees,
// guy lines down from the top. The paint job is user-selectable (see
// PALETTES — MCO's teal/purple, black and white, or
// natural wood and black), rendered as worn paint over plywood: grain
// showing through, brush strokes, chips. Every row of boxes answers to its
// own slice of the spectrum:
//
//   top horn + tweeter bars   → tops      (domes shimmer, horn throats glow)
//   row 3 (2×10" boxes)       → low-mids (centre) / mids (sides)
//   row 2 (grille + horn cells) → bass    (cones pump, pressure rings)
//   row 1 (four scoops)       → sub       (big spring-driven excursion,
//                                           box recoil, pressure rings)
//
// Everything is procedural (geometry + canvas textures) — no assets.

// Teal/purple palette, taken from the UI of MCO (Music Collection Organizer),
// where these visualisers started.
const APP_SURFACE_RAISED = '#232833' // --color-surface-raised
const APP_BORDER = '#2b3140' // --color-border
const APP_TEXT_DIM = 0x9aa3b2 // --color-text-dim
const APP_ACCENT = 0x2dd4bf // --color-accent
const APP_ACCENT_STRONG = 0x14b8a6 // --color-accent-strong
const APP_SECONDARY = 0xa78bfa // --color-secondary
const BLACK_PAINT = '#16181b'
// Off-white: true white blows past the bloom threshold in full sun.
const WHITE_PAINT = '#d8d8d4'
const BLACK = 0x0a0c10
const BARE_WOOD = '#b98a5a'

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`

// A surface finish: `worn` = paint over plywood (brush strokes, chips back
// to bare wood); otherwise bare, sealed plywood in that colour.
interface Finish {
  color: string
  worn: boolean
}

interface Palette {
  cabinet: Finish // cabinet shells
  cabinetLight: Finish // tweeter bars
  accentA: Finish // scoop tops, side mid boxes, horn box
  accentB: Finish // row-2 driver panels, centre mid box
  scoopInner: Finish | null // inside the scoops' horn cells (null = matte black)
  scoopEdge: Finish // the scoop cells' front edge strips
  glow: number // horn throats + tweeter domes
  ring: number // pressure rings
}

const PALETTES: Record<string, Palette> = {
  app: {
    cabinet: { color: APP_SURFACE_RAISED, worn: true },
    cabinetLight: { color: APP_BORDER, worn: true },
    accentA: { color: hex(APP_ACCENT_STRONG), worn: true },
    accentB: { color: hex(APP_SECONDARY), worn: true },
    scoopInner: null,
    scoopEdge: { color: hex(APP_ACCENT_STRONG), worn: true },
    glow: APP_ACCENT,
    ring: APP_ACCENT,
  },
  // Black cabinets, white fronts; the app's teal accent in the glows.
  'black-white': {
    cabinet: { color: BLACK_PAINT, worn: true },
    cabinetLight: { color: BLACK_PAINT, worn: true },
    accentA: { color: WHITE_PAINT, worn: true },
    accentB: { color: WHITE_PAINT, worn: true },
    scoopInner: null,
    scoopEdge: { color: WHITE_PAINT, worn: true },
    glow: APP_ACCENT,
    ring: APP_ACCENT,
  },
  natural: {
    cabinet: { color: '#c48a4f', worn: false },
    cabinetLight: { color: '#d6a36c', worn: false },
    accentA: { color: BLACK_PAINT, worn: true },
    accentB: { color: '#c48a4f', worn: false },
    // Bare wood inside the horn cells, like the row-2 cells.
    scoopInner: { color: '#c48a4f', worn: false },
    scoopEdge: { color: '#c48a4f', worn: false },
    glow: 0xffc070,
    ring: 0xffffff,
  },
}

const OPTIONS: ThemeOption[] = [
  {
    id: 'stack',
    name: 'Stack',
    values: [
      { id: 'classic', name: 'Classic' },
      { id: 'mb', name: 'Mais Baixo' },
    ],
  },
  {
    id: 'colours',
    name: 'Colours',
    values: [
      { id: 'app', name: 'MCO' },
      { id: 'black-white', name: 'Black & White' },
      { id: 'natural', name: 'Natural' },
    ],
  },
  {
    id: 'background',
    name: 'Background',
    values: [
      { id: 'field', name: 'Field' },
      { id: 'urban', name: 'Urban' },
    ],
  },
]

// Band indices into the 5 log-spaced SpectrumBars (30Hz..16kHz):
// ~30-106Hz, ~106-374Hz, ~374Hz-1.3k, ~1.3-4.7k, ~4.7-16k.
const SUB = 0
const BASS = 1
const LOW_MID = 2
const MID = 3
const TOP = 4

// Horn-cell edge strips sit this far proud of the cabinet front, so their
// faces are never coplanar with the shell's front edges (which z-fights —
// flickering stripes along the corners).
const STRIP_PROUD = 0.004

// Bass cone spring (see update): stiffness sets how quickly a cone chases
// the level, damping just under critical gives a soft overshoot per kick.
const SPRING_STIFFNESS = 140
const SPRING_DAMPING = 2 * 0.6 * Math.sqrt(SPRING_STIFFNESS)

// A pressure ring fires when its driver's spring is past this excursion
// (in level units, ~0..1.2) and still moving outward faster than this —
// see update. The interval stops one push from firing twice.
// How far back the bass cones' "recent average" looks when picking out
// hits (see update).
const BASS_AVERAGE_SECONDS = 0.6

const RING_MIN_EXCURSION = 0.5
const RING_MIN_VELOCITY = 1.5
const RING_MIN_INTERVAL = 0.3

// Deterministic PRNG so textures look the same every time the theme opens.
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  repeat?: [number, number],
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext('2d')!, width, height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  if (repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(repeat[0], repeat[1])
  }
  return texture
}

function plywoodTexture(base: string, seed: number): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const random = mulberry32(seed)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 70; i++) {
      const y = random() * h
      const amplitude = 2 + random() * 6
      const phase = random() * Math.PI * 2
      ctx.strokeStyle = random() < 0.5 ? `rgba(0,0,0,${0.1 + random() * 0.2})` : `rgba(200,215,235,${0.03 + random() * 0.05})`
      ctx.lineWidth = 0.5 + random() * 2.5
      ctx.beginPath()
      for (let x = 0; x <= w; x += 8) {
        const yy = y + Math.sin(x / 40 + phase) * amplitude
        if (x === 0) ctx.moveTo(x, yy)
        else ctx.lineTo(x, yy)
      }
      ctx.stroke()
    }
  })
}

// Greyscale plywood grain (mid-grey = flat). It's the bump map under the
// paint, and is overlaid into the colour so the grain reads through.
function drawGrain(ctx: CanvasRenderingContext2D, w: number, h: number, random: () => number): void {
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, w, h)
  for (let i = 0; i < 140; i++) {
    const y = random() * h
    const amplitude = 3 + random() * 10
    const phase = random() * Math.PI * 2
    const shade = random() < 0.6 ? 70 + random() * 40 : 150 + random() * 40
    ctx.strokeStyle = `rgba(${shade},${shade},${shade},${0.25 + random() * 0.45})`
    ctx.lineWidth = 0.8 + random() * 3
    ctx.beginPath()
    for (let x = 0; x <= w; x += 8) {
      const yy = y + Math.sin(x / 70 + phase) * amplitude + Math.sin(x / 13 + phase * 2) * 0.8
      if (x === 0) ctx.moveTo(x, yy)
      else ctx.lineTo(x, yy)
    }
    ctx.stroke()
  }
}

// Worn paint over plywood: a solid coat with brush strokes, the grain
// telegraphing through it, and chips/scratches back to bare wood. Returns
// the colour map plus the grain as a bump map, so the sun picks out the
// relief.
// `chips` adds chips/scratches back to bare wood — off for the Mais Baixo
// model, whose UVs stretch a small patch of texture over whole panels and
// blow the chips up into big brown blotches.
function paintedWood(
  paint: string,
  seed: number,
  worn = true,
  chips = true,
): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const size = 512
  const grainCanvas = document.createElement('canvas')
  grainCanvas.width = grainCanvas.height = size
  drawGrain(grainCanvas.getContext('2d')!, size, size, mulberry32(seed))

  const map = canvasTexture(
    size,
    size,
    (ctx, w, h) => {
      const random = mulberry32(seed + 101)
      ctx.fillStyle = paint
      ctx.fillRect(0, 0, w, h)
      if (!worn) {
        // Bare, sealed plywood: just the grain, a little stronger.
        ctx.globalCompositeOperation = 'overlay'
        ctx.globalAlpha = 0.6
        ctx.drawImage(grainCanvas, 0, 0)
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
        return
      }
      // Brush strokes: long, mostly horizontal drags a shade lighter or
      // darker than the coat.
      for (let i = 0; i < 260; i++) {
        const light = random() < 0.5
        ctx.strokeStyle = light ? `rgba(255,255,255,${0.03 + random() * 0.06})` : `rgba(0,0,0,${0.04 + random() * 0.08})`
        ctx.lineWidth = 2 + random() * 9
        ctx.lineCap = 'round'
        const x = random() * w
        const y = random() * h
        const length = 60 + random() * 320
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.quadraticCurveTo(x + length / 2, y + (random() - 0.5) * 10, x + length, y + (random() - 0.5) * 6)
        ctx.stroke()
      }
      // Grain showing through the paint.
      ctx.globalCompositeOperation = 'overlay'
      ctx.globalAlpha = 0.4
      ctx.drawImage(grainCanvas, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      if (!chips) return
      // Chips back to bare wood, each with a darker, grimy rim.
      for (let i = 0; i < 26; i++) {
        const cx = random() * w
        const cy = random() * h
        const radius = 2 + random() * 9
        ctx.beginPath()
        for (let k = 0; k < 9; k++) {
          const angle = (k / 9) * Math.PI * 2
          const r = radius * (0.5 + random() * 0.8)
          const px = cx + Math.cos(angle) * r * 1.6
          const py = cy + Math.sin(angle) * r
          if (k === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        ctx.fillStyle = BARE_WOOD
        ctx.fill()
        ctx.strokeStyle = 'rgba(40,25,10,0.5)'
        ctx.lineWidth = 1
        ctx.stroke()
      }
      // Scratches.
      for (let i = 0; i < 40; i++) {
        ctx.strokeStyle = `rgba(185,138,90,${0.25 + random() * 0.4})`
        ctx.lineWidth = 0.6 + random() * 1.2
        const x = random() * w
        const y = random() * h
        const angle = (random() - 0.5) * 1.2
        const length = 8 + random() * 40
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length)
        ctx.stroke()
      }
    },
    [1, 1],
  )
  const bumpMap = new THREE.CanvasTexture(grainCanvas)
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping
  return { map, bumpMap }
}


// Clear summer sky: deep blue overhead, paling toward the horizon. Used
// as the (screen-space) scene background.
function skyTexture(): THREE.CanvasTexture {
  return canvasTexture(4, 512, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h)
    gradient.addColorStop(0, '#0f4fc4')
    gradient.addColorStop(0.55, '#2f80e2')
    gradient.addColorStop(1, '#9cc6f2')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, w, h)
  })
}

function grassTexture(): THREE.CanvasTexture {
  return canvasTexture(
    256,
    256,
    (ctx, w, h) => {
      const random = mulberry32(11)
      ctx.fillStyle = '#4c8a2c'
      ctx.fillRect(0, 0, w, h)
      for (let i = 0; i < 4000; i++) {
        const g = 110 + random() * 80
        ctx.strokeStyle = `rgba(${40 + random() * 50},${g},${20 + random() * 30},0.6)`
        ctx.lineWidth = 1
        const x = random() * w
        const y = random() * h
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + (random() - 0.5) * 3, y - 2 - random() * 5)
        ctx.stroke()
      }
    },
    [40, 40],
  )
}

// Black scrim on festival fencing: near-black with soft horizontal folds
// and a faint weave.
function fenceTexture(): THREE.CanvasTexture {
  return canvasTexture(
    512,
    128,
    (ctx, w, h) => {
      const random = mulberry32(21)
      ctx.fillStyle = '#16181a'
      ctx.fillRect(0, 0, w, h)
      for (let i = 0; i < 18; i++) {
        const y = random() * h
        const gradient = ctx.createLinearGradient(0, y - 6, 0, y + 6)
        gradient.addColorStop(0, 'rgba(255,255,255,0)')
        gradient.addColorStop(0.5, `rgba(255,255,255,${0.03 + random() * 0.05})`)
        gradient.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, y - 6, w, 12)
      }
      ctx.fillStyle = 'rgba(255,255,255,0.025)'
      for (let x = 0; x < w; x += 3) ctx.fillRect(x, 0, 1, h)
    },
    [8, 1],
  )
}

// A leafy broadleaf tree: trunk plus a cluster of low-poly foliage blobs.
function makeTree(scale: number, seed: number): THREE.Group {
  const random = mulberry32(seed)
  const tree = new THREE.Group()
  const bark = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 })
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 3, 8), bark)
  trunk.position.y = 1.5
  trunk.castShadow = true
  tree.add(trunk)
  const greens = [0x2f6b22, 0x3b7d2a, 0x285c1d, 0x4a8b33]
  for (let i = 0; i < 12; i++) {
    const blob = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.9 + random() * 0.8, 1),
      new THREE.MeshStandardMaterial({ color: greens[i % greens.length], roughness: 0.9, flatShading: true }),
    )
    const angle = random() * Math.PI * 2
    const spread = random() * 1.4
    blob.position.set(Math.cos(angle) * spread, 3.2 + random() * 1.8, Math.sin(angle) * spread * 0.7)
    blob.castShadow = true
    tree.add(blob)
  }
  tree.scale.setScalar(scale)
  return tree
}

// --- Urban backdrop: a European street fair ---------------------------------
// Built lazily the first time "Urban" is picked (see setBackground).

const FACADE_SHADE = 0.78
// The street is full of large, pale, sunlit surfaces that all cross the
// bloom threshold; bloom is scaled down while it's showing so the town
// doesn't turn to haze. (The horn glow is emissive, so it survives.)
const URBAN_BLOOM_SCALE = 0.35

function asphaltTexture(): THREE.CanvasTexture {
  return canvasTexture(
    256,
    256,
    (ctx, w, h) => {
      const random = mulberry32(31)
      ctx.fillStyle = '#3d3f42'
      ctx.fillRect(0, 0, w, h)
      for (let i = 0; i < 5000; i++) {
        const shade = 40 + random() * 60
        ctx.fillStyle = `rgba(${shade},${shade},${shade + 3},0.6)`
        ctx.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2)
      }
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = `rgba(20,20,22,${0.15 + random() * 0.2})`
        ctx.beginPath()
        ctx.ellipse(random() * w, random() * h, 10 + random() * 30, 6 + random() * 20, random() * Math.PI, 0, Math.PI * 2)
        ctx.fill()
      }
    },
    [30, 30],
  )
}

function pavingTexture(): THREE.CanvasTexture {
  return canvasTexture(
    256,
    256,
    (ctx, w, h) => {
      const random = mulberry32(37)
      ctx.fillStyle = '#8c8b86'
      ctx.fillRect(0, 0, w, h)
      const slab = 64
      for (let y = 0; y < h; y += slab) {
        for (let x = 0; x < w; x += slab) {
          const shade = 160 + random() * 30
          ctx.fillStyle = `rgb(${shade},${shade - 2},${shade - 8})`
          ctx.fillRect(x + 2, y + 2, slab - 4, slab - 4)
        }
      }
    },
    [30, 1.2],
  )
}

// A town-house front: floors of shuttered windows over a shopfront.
function facadeTexture(color: string, widthM: number, heightM: number, seed: number): THREE.CanvasTexture {
  const scale = 40 // px per metre
  return canvasTexture(Math.round(widthM * scale), Math.round(heightM * scale), (ctx, w, h) => {
    const random = mulberry32(seed)
    ctx.fillStyle = color
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 600; i++) {
      ctx.fillStyle = random() < 0.5 ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)'
      ctx.fillRect(random() * w, random() * h, 2 + random() * 8, 2 + random() * 8)
    }
    const floor = 3 * scale
    const shutters = random() < 0.6 ? ['#3f6b4a', '#6b4a32', '#4a5f7a'][Math.floor(random() * 3)] : null
    // Upper floors.
    const columns = Math.max(2, Math.floor(widthM / 1.7))
    const pitch = w / columns
    for (let top = h - floor * 2; top > floor * 0.3; top -= floor) {
      for (let c = 0; c < columns; c++) {
        const ww = 0.8 * scale
        const wh = 1.5 * scale
        const x = c * pitch + (pitch - ww) / 2
        const y = top + floor * 0.25
        if (shutters) {
          ctx.fillStyle = shutters
          ctx.fillRect(x - ww * 0.45, y, ww * 0.42, wh)
          ctx.fillRect(x + ww * 1.03, y, ww * 0.42, wh)
        }
        ctx.fillStyle = '#f2efe8'
        ctx.fillRect(x - 3, y - 3, ww + 6, wh + 6)
        const glass = ctx.createLinearGradient(x, y, x + ww, y + wh)
        glass.addColorStop(0, '#5d7486')
        glass.addColorStop(1, '#2c3a47')
        ctx.fillStyle = glass
        ctx.fillRect(x, y, ww, wh)
        ctx.fillStyle = '#f2efe8'
        ctx.fillRect(x + ww / 2 - 1.5, y, 3, wh)
        ctx.fillRect(x - 6, y + wh + 3, ww + 12, 5)
      }
    }
    // Ground-floor shopfront.
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.fillRect(0, h - floor, w, 6)
    const shopX = w * 0.1
    const shopW = w * 0.62
    const shopTop = h - floor * 0.78
    const shopGlass = ctx.createLinearGradient(0, shopTop, 0, h)
    shopGlass.addColorStop(0, '#3a4a58')
    shopGlass.addColorStop(1, '#1c242c')
    ctx.fillStyle = '#2a2a2a'
    ctx.fillRect(shopX - 4, shopTop - 4, shopW + 8, h - shopTop + 4)
    ctx.fillStyle = shopGlass
    ctx.fillRect(shopX, shopTop, shopW, h - shopTop)
    ctx.fillStyle = '#4a3326'
    ctx.fillRect(w * 0.78, h - floor * 0.72, w * 0.12, floor * 0.72)
    // Cornice band.
    ctx.fillStyle = 'rgba(0,0,0,0.15)'
    ctx.fillRect(0, 0, w, 10)
  })
}

// Striped canvas for awnings and the fair stalls' roofs.
function stripeTexture(a: string, b: string): THREE.CanvasTexture {
  return canvasTexture(
    64,
    8,
    (ctx, w, h) => {
      ctx.fillStyle = a
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = b
      for (let x = 0; x < w; x += 16) ctx.fillRect(x, 0, 8, h)
    },
    [4, 1],
  )
}

// A galvanised crowd-control barrier (the see-through "Vauban" kind),
// merged into a single geometry: end posts, rails, bars and feet.
function barrierGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const width = 2
  const height = 1.1
  const bar = (length: number, radius: number, x: number, y: number, horizontal: boolean) => {
    const g = new THREE.CylinderGeometry(radius, radius, length, 6)
    if (horizontal) g.rotateZ(Math.PI / 2)
    g.translate(x, y, 0)
    parts.push(g)
  }
  for (const x of [-width / 2, width / 2]) bar(height, 0.02, x, height / 2 + 0.05, false)
  bar(width, 0.018, 0, height, true)
  bar(width, 0.018, 0, 0.25, true)
  for (let i = 1; i < 14; i++) bar(height - 0.25, 0.007, -width / 2 + (i / 14) * width, (height + 0.25) / 2, false)
  for (const x of [-width / 2, width / 2]) {
    const foot = new THREE.BoxGeometry(0.05, 0.03, 0.7)
    foot.translate(x, 0.015, 0)
    parts.push(foot)
  }
  const merged = mergeGeometries(parts)!
  for (const part of parts) part.dispose()
  return merged
}

function makeStreetLamp(material: THREE.Material): THREE.Group {
  const lamp = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 4.2, 8), material)
  pole.position.y = 2.1
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), material)
  arm.rotation.z = Math.PI / 2
  arm.position.set(0.35, 4.1, 0)
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.35, 6), material)
  lantern.position.set(0.7, 3.95, 0)
  lamp.add(pole, arm, lantern)
  lamp.traverse((object) => (object.castShadow = true))
  return lamp
}

// A pop-up fair stall: four legs and a striped pyramid roof.
function makeStall(roof: THREE.Material, legs: THREE.Material): THREE.Group {
  const stall = new THREE.Group()
  const size = 2.6
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), legs)
      leg.position.set((x * size) / 2, 1.1, (z * size) / 2)
      stall.add(leg)
    }
  }
  const top = new THREE.Mesh(new THREE.ConeGeometry(size * 0.72, 0.9, 4, 1, true), roof)
  top.rotation.y = Math.PI / 4
  top.position.y = 2.2 + 0.45
  stall.add(top)
  stall.traverse((object) => (object.castShadow = true))
  return stall
}

interface UrbanBackdrop {
  group: THREE.Group
  flags: Array<{ mesh: THREE.Mesh; phase: number }>
}

function buildUrban(barrierMaterial: THREE.Material): UrbanBackdrop {
  const group = new THREE.Group()
  const random = mulberry32(41)

  const street = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.95 }))
  street.rotation.x = -Math.PI / 2
  street.receiveShadow = true
  group.add(street)

  // Faded centre line.
  const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.9 })
  for (let x = -30; x <= 30; x += 3) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.004, 0.12), lineMaterial)
    dash.position.set(x, 0.002, 6)
    dash.receiveShadow = true
    group.add(dash)
  }

  // Pavement + kerb along the building line.
  const FRONT_Z = -9.5
  const pavement = new THREE.Mesh(new THREE.BoxGeometry(60, 0.14, 2.6), new THREE.MeshStandardMaterial({ map: pavingTexture(), roughness: 0.9 }))
  pavement.position.set(0, 0.07, FRONT_Z + 1.3)
  pavement.receiveShadow = true
  group.add(pavement)
  const kerb = new THREE.Mesh(new THREE.BoxGeometry(60, 0.16, 0.18), new THREE.MeshStandardMaterial({ color: 0xb8b6ae, roughness: 0.8 }))
  kerb.position.set(0, 0.08, FRONT_Z + 2.6)
  group.add(kerb)

  // A terrace of town houses.
  const colors = ['#e8c9a0', '#d98f6f', '#f0e2c4', '#a9c1cc', '#b7c4a0', '#e6b8a2', '#cfc6b8', '#d9b36c']
  const awningColors: Array<[string, string]> = [
    ['#b83a3a', '#f2ede4'],
    ['#2f6b4f', '#f2ede4'],
    ['#2c4f7c', '#f2ede4'],
  ]
  let x = -26
  let index = 0
  while (x < 26) {
    const width = 4.5 + random() * 3
    const height = 9 + Math.floor(random() * 3) * 3
    const depth = 8
    const color = colors[index % colors.length]
    // Pale render in full sun reads as haze through the bloom — take the
    // facades down a notch (the map is multiplied by `color`).
    const plain = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(FACADE_SHADE), roughness: 0.9 })
    const front = new THREE.MeshStandardMaterial({
      map: facadeTexture(color, width, height, 50 + index),
      color: new THREE.Color(FACADE_SHADE, FACADE_SHADE, FACADE_SHADE),
      roughness: 0.85,
    })
    // BoxGeometry face order: +x, -x, +y, -y, +z (front), -z.
    const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), [plain, plain, plain, plain, front, plain])
    building.position.set(x + width / 2, height / 2, FRONT_Z - depth / 2)
    building.receiveShadow = true
    group.add(building)
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(width + 0.2, 0.35, 0.4), new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.8 }))
    cornice.position.set(x + width / 2, height - 0.2, FRONT_Z + 0.15)
    group.add(cornice)
    if (random() < 0.55) {
      const [a, b] = awningColors[Math.floor(random() * awningColors.length)]
      const awning = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 0.7, 1.3),
        new THREE.MeshStandardMaterial({ map: stripeTexture(a, b), roughness: 0.8, side: THREE.DoubleSide }),
      )
      awning.rotation.x = -Math.PI / 2 + 0.45
      awning.position.set(x + width * 0.46, 2.95, FRONT_Z + 0.6)
      awning.castShadow = true
      group.add(awning)
    }
    x += width
    index++
  }

  const iron = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.5, metalness: 0.6 })
  for (const lx of [-10, 10]) {
    const lamp = makeStreetLamp(iron)
    lamp.position.set(lx, 0.14, FRONT_Z + 2.2)
    if (lx > 0) lamp.rotation.y = Math.PI
    group.add(lamp)
  }

  // Fair stalls either side.
  const stallLegs = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.4, metalness: 0.6 })
  for (const [sx, a, b] of [
    [-8.2, '#b83a3a', '#f2ede4'],
    [8.4, '#2c4f7c', '#f2ede4'],
  ] as const) {
    const stall = makeStall(new THREE.MeshStandardMaterial({ map: stripeTexture(a, b), roughness: 0.8, side: THREE.DoubleSide }), stallLegs)
    stall.position.set(sx, 0, -3.5)
    stall.rotation.y = sx > 0 ? -0.2 : 0.2
    group.add(stall)
  }

  // Crowd barriers penning the stack in: a front row and both sides.
  const geometry = barrierGeometry()
  const place = (bx: number, bz: number, rotation: number) => {
    const barrier = new THREE.Mesh(geometry, barrierMaterial)
    barrier.position.set(bx, 0, bz)
    barrier.rotation.y = rotation
    barrier.castShadow = true
    group.add(barrier)
  }
  for (let i = 0; i < 5; i++) place(-4 + i * 2.02, 4.6, (random() - 0.5) * 0.06)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) place(side * 5.05, 3.55 - i * 2.02, Math.PI / 2 + (random() - 0.5) * 0.06)
  }

  // Bunting strung across the street.
  const flags: UrbanBackdrop['flags'] = []
  const flagColors = [0xd6453d, 0xf2c14e, 0x3a86c8, 0x3aa56b, 0xf2ede4, 0xe07a3f]
  const flagGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.16, 0, 0),
    new THREE.Vector3(0.16, 0, 0),
    new THREE.Vector3(0, -0.38, 0),
  ])
  flagGeometry.computeVertexNormals()
  const flagMaterials = flagColors.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide }))
  const cord = new THREE.LineBasicMaterial({ color: 0x2a2a2a })
  for (const [z, y, span, sag] of [
    [-8.2, 8.2, 30, 1.4],
    [-2.5, 7.4, 26, 1.1],
  ] as const) {
    const count = Math.round(span / 0.55)
    const points: THREE.Vector3[] = []
    for (let i = 0; i <= count; i++) {
      const f = i / count
      const px = -span / 2 + f * span
      const py = y - sag * 4 * f * (1 - f)
      points.push(new THREE.Vector3(px, py, z))
      if (i > 0 && i < count) {
        const flag = new THREE.Mesh(flagGeometry, flagMaterials[i % flagMaterials.length])
        flag.position.set(px, py, z)
        group.add(flag)
        flags.push({ mesh: flag, phase: i * 0.7 + z })
      }
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), cord))
  }

  return { group, flags }
}

// Perforated black grille (alpha-tested holes) for the row-2 drivers.
function grilleTexture(): THREE.CanvasTexture {
  return canvasTexture(
    64,
    64,
    (ctx, w, h) => {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'destination-out'
      for (let y = 4; y < h; y += 8) {
        for (let x = 4 + ((y / 8) % 2) * 4; x < w; x += 8) {
          ctx.beginPath()
          ctx.arc(x, y, 2.6, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    },
    [10, 10],
  )
}

interface Materials {
  cabinet: THREE.MeshStandardMaterial
  cabinetLight: THREE.MeshStandardMaterial
  accentA: THREE.MeshStandardMaterial
  accentB: THREE.MeshStandardMaterial
  scoopInner: THREE.MeshStandardMaterial
  scoopEdge: THREE.MeshStandardMaterial
  black: THREE.MeshStandardMaterial
  cone: THREE.MeshStandardMaterial
  rubber: THREE.MeshStandardMaterial
  metal: THREE.MeshStandardMaterial
  grille: THREE.MeshStandardMaterial
}

interface Driver {
  group: THREE.Group
  cone: THREE.Group
  surround: THREE.Mesh
  dome?: THREE.Mesh
  radius: number
}

// A cone driver facing +z: basket rim, rubber surround, concave paper
// cone and dust cap. `cone` (cone + cap) is what moves.
function makeDriver(radius: number, materials: Materials, options: { grille?: boolean; tweeter?: boolean } = {}): Driver {
  const group = new THREE.Group()
  const rim = new THREE.Mesh(new THREE.RingGeometry(radius * 0.9, radius * 1.08, 48), materials.metal)
  rim.position.z = 0.004
  group.add(rim)
  const surround = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.86, radius * 0.07, 10, 48), materials.rubber)
  surround.scale.z = 0.6
  group.add(surround)

  const cone = new THREE.Group()
  const depth = radius * (options.tweeter ? 0.15 : 0.45)
  const profile: THREE.Vector2[] = []
  for (let i = 0; i <= 10; i++) {
    const f = i / 10
    profile.push(new THREE.Vector2(radius * (0.28 + 0.54 * f), -depth * (1 - Math.pow(f, 0.7))))
  }
  const coneGeometry = new THREE.LatheGeometry(profile, 48)
  coneGeometry.rotateX(Math.PI / 2)
  cone.add(new THREE.Mesh(coneGeometry, materials.cone))

  const capGeometry = new THREE.SphereGeometry(radius * 0.3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)
  capGeometry.rotateX(Math.PI / 2)
  const dome = new THREE.Mesh(capGeometry, options.tweeter ? materials.metal.clone() : materials.cone)
  dome.position.z = -depth
  dome.scale.z = options.tweeter ? 0.9 : 0.5
  cone.add(dome)
  group.add(cone)
  const backing = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.1, 40), materials.rubber)
  backing.position.z = -depth - 0.03
  group.add(backing)

  if (options.grille) {
    const grille = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.02, 48), materials.grille)
    grille.position.z = radius * 0.45
    group.add(grille)
  }
  group.traverse((object) => {
    object.castShadow = true
    object.receiveShadow = true
  })
  return { group, cone, surround, dome: options.tweeter ? dome : undefined, radius }
}

// Five-sided plywood shell (open front) so recessed horn cells can sit
// inside it; the caller adds the front baffles/cells.
function makeShell(w: number, h: number, d: number, material: THREE.Material): THREE.Group {
  const t = 0.04
  const shell = new THREE.Group()
  const parts: Array<[number, number, number, number, number, number]> = [
    [w, t, d, 0, h / 2 - t / 2, 0],
    [w, t, d, 0, -h / 2 + t / 2, 0],
    [t, h, d, -w / 2 + t / 2, 0, 0],
    [t, h, d, w / 2 - t / 2, 0, 0],
    [w, h, t, 0, 0, -d / 2 + t / 2],
  ]
  for (const [pw, ph, pd, x, y, z] of parts) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), material)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    shell.add(mesh)
  }
  return shell
}

// A front baffle covering part of the cabinet front, inset slightly so the
// plywood edge frames it like in the photo, with real cut-outs for the
// drivers — a solid panel would hide their recessed cones.
function makeBaffle(
  w: number,
  h: number,
  material: THREE.Material,
  holes: Array<{ x: number; y: number; r: number } | { x: number; y: number; w: number; h: number }> = [],
): THREE.Mesh {
  const thickness = 0.03
  const shape = new THREE.Shape()
  shape.moveTo(-w / 2, -h / 2)
  shape.lineTo(w / 2, -h / 2)
  shape.lineTo(w / 2, h / 2)
  shape.lineTo(-w / 2, h / 2)
  shape.lineTo(-w / 2, -h / 2)
  for (const hole of holes) {
    const path = new THREE.Path()
    if ('r' in hole) {
      path.absarc(hole.x, hole.y, hole.r, 0, Math.PI * 2, true)
    } else {
      // Clockwise, opposite the outer contour, so it cuts rather than fills.
      path.moveTo(hole.x - hole.w / 2, hole.y - hole.h / 2)
      path.lineTo(hole.x - hole.w / 2, hole.y + hole.h / 2)
      path.lineTo(hole.x + hole.w / 2, hole.y + hole.h / 2)
      path.lineTo(hole.x + hole.w / 2, hole.y - hole.h / 2)
      path.lineTo(hole.x - hole.w / 2, hole.y - hole.h / 2)
    }
    shape.holes.push(path)
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 32 })
  geometry.translate(0, 0, -thickness / 2)
  // ExtrudeGeometry UVs are in shape units; scale down so the plywood
  // grain isn't stretched across the whole panel.
  const uv = geometry.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.8, uv.getY(i) * 0.8)
  const baffle = new THREE.Mesh(geometry, material)
  baffle.castShadow = true
  baffle.receiveShadow = true
  return baffle
}

// A grid of recessed horn mouths: a back panel `depth` deep plus
// dividers, with plywood strips on the dividers' front edges.
function makeCells(
  w: number,
  h: number,
  depth: number,
  cols: number,
  rows: number,
  inner: THREE.Material,
  edge: THREE.Material,
): { group: THREE.Group } {
  const group = new THREE.Group()
  const t = 0.035
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), inner)
  back.position.z = -depth
  back.receiveShadow = true
  group.add(back)
  const add = (mesh: THREE.Mesh) => {
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  for (let c = 0; c <= cols; c++) {
    const x = -w / 2 + (c / cols) * w
    const divider = new THREE.Mesh(new THREE.BoxGeometry(t, h, depth), inner)
    divider.position.set(x, 0, -depth / 2)
    add(divider)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(t + 0.01, h, 0.02), edge)
    strip.position.set(x, 0, STRIP_PROUD)
    add(strip)
  }
  for (let r = 0; r <= rows; r++) {
    const y = -h / 2 + (r / rows) * h
    const divider = new THREE.Mesh(new THREE.BoxGeometry(w, t, depth), inner)
    divider.position.set(0, y, -depth / 2)
    add(divider)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w, t + 0.01, 0.02), edge)
    strip.position.set(0, y, STRIP_PROUD)
    add(strip)
  }
  return { group }
}

// A rectangular horn flare (open frustum) facing +z, mouth at z=0.
function makeHorn(mouthW: number, mouthH: number, throatScale: number, depth: number, material: THREE.Material) {
  const geometry = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * throatScale, depth, 4, 1, true)
  geometry.rotateY(Math.PI / 4)
  geometry.rotateX(Math.PI / 2)
  geometry.translate(0, 0, -depth / 2)
  const horn = new THREE.Mesh(geometry, material)
  horn.scale.set(mouthW, mouthH, 1)
  horn.receiveShadow = true
  return horn
}

function create(): ThemeInstance {
  const scene = new THREE.Scene()
  const sky = skyTexture()
  scene.background = sky
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)

  const materials: Materials = {
    // Maps are assigned per palette by setVariant.
    cabinet: new THREE.MeshStandardMaterial({ bumpScale: 1.5, roughness: 0.62 }),
    cabinetLight: new THREE.MeshStandardMaterial({ bumpScale: 1.5, roughness: 0.62 }),
    accentA: new THREE.MeshStandardMaterial({ bumpScale: 1.5, roughness: 0.62 }),
    accentB: new THREE.MeshStandardMaterial({ bumpScale: 1.5, roughness: 0.62 }),
    scoopInner: new THREE.MeshStandardMaterial({ bumpScale: 1.5, roughness: 0.62 }),
    scoopEdge: new THREE.MeshStandardMaterial({ bumpScale: 1.5, roughness: 0.62 }),
    black: new THREE.MeshStandardMaterial({ color: BLACK, roughness: 0.9, side: THREE.DoubleSide }),
    cone: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.8 }),
    metal: new THREE.MeshStandardMaterial({ color: APP_TEXT_DIM, roughness: 0.45, metalness: 0.8 }),
    grille: new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.6,
      metalness: 0.4,
      alphaMap: grilleTexture(),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    }),
  }

  // --- Environment -------------------------------------------------------
  // Two switchable backdrops (see setBackground): the festival field below,
  // and an urban street fair built on first use.
  const fieldEnv = new THREE.Group()
  scene.add(fieldEnv)
  scene.add(new THREE.HemisphereLight(0xa8cfff, 0x4d6b2c, 1.0))
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.8)
  sun.position.set(4, 10, 7)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -10
  sun.shadow.camera.right = 10
  sun.shadow.camera.top = 10
  sun.shadow.camera.bottom = -4
  sun.shadow.camera.far = 40
  sun.shadow.bias = -0.0005
  // Offsets along the normal too — plain depth bias alone left shadow
  // acne shimmering on the cabinets as they recoil.
  sun.shadow.normalBias = 0.02
  scene.add(sun)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  fieldEnv.add(ground)

  // Festival fencing with black scrim behind the stack — gently wavy, on
  // posts.
  const FENCE_Z = -4.5
  const FENCE_HEIGHT = 1.9
  const fenceGeometry = new THREE.PlaneGeometry(40, FENCE_HEIGHT, 160, 1)
  const fencePositions = fenceGeometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < fencePositions.count; i++) {
    fencePositions.setZ(i, Math.sin(fencePositions.getX(i) * 1.3) * 0.06)
  }
  fenceGeometry.computeVertexNormals()
  const fence = new THREE.Mesh(
    fenceGeometry,
    new THREE.MeshStandardMaterial({ map: fenceTexture(), roughness: 0.75, side: THREE.DoubleSide }),
  )
  fence.position.set(0, FENCE_HEIGHT / 2 + 0.05, FENCE_Z)
  fence.receiveShadow = true
  fieldEnv.add(fence)
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.4, metalness: 0.7 })
  for (let x = -20; x <= 20; x += 3.5) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, FENCE_HEIGHT + 0.15, 6), postMaterial)
    post.position.set(x, (FENCE_HEIGHT + 0.15) / 2, FENCE_Z + 0.05)
    fieldEnv.add(post)
  }

  // Trees: the big one left of the stack, plus a scattered tree line
  // beyond the fence. They sway a touch in the breeze (see update).
  const trees: Array<{ tree: THREE.Group; phase: number }> = []
  for (const [x, z, scale, seed] of [
    [-8.5, -8.5, 1.1, 1],
    [9, -12, 1.1, 2],
    [-15, -16, 1.4, 3],
    [15, -18, 1.3, 4],
    [3, -22, 1.5, 5],
    [-4, -24, 1.2, 6],
  ] as const) {
    const tree = makeTree(scale, seed)
    tree.position.set(x, 0, z)
    tree.rotation.y = seed
    fieldEnv.add(tree)
    trees.push({ tree, phase: seed * 1.7 })
  }

  // Timber platform under the stack.
  const PLATFORM_HEIGHT = 0.14
  const deckMaterial = new THREE.MeshStandardMaterial({ map: plywoodTexture('#b89a72', 5), roughness: 0.9 })
  for (let s = 0; s < 10; s++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.035, 0.2), deckMaterial)
    plank.position.set(0, PLATFORM_HEIGHT - 0.0175, -0.95 + s * 0.21)
    plank.castShadow = true
    plank.receiveShadow = true
    scene.add(plank)
  }
  for (const bx of [-2.6, -0.9, 0.9, 2.6]) {
    const joist = new THREE.Mesh(new THREE.BoxGeometry(0.1, PLATFORM_HEIGHT - 0.035, 2.1), deckMaterial)
    joist.position.set(bx, (PLATFORM_HEIGHT - 0.035) / 2, 0)
    joist.castShadow = true
    scene.add(joist)
  }

  // The classic, procedural stack (its guy lines included) — hidden when
  // another stack is chosen (see setStack).
  const classicGroup = new THREE.Group()
  scene.add(classicGroup)

  // Guy lines from the top of the stack down to stakes either side.
  const lineMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3228, roughness: 0.8 })
  for (const side of [-1, 1]) {
    const from = new THREE.Vector3(side * 0.35, 4.85, 0)
    const to = new THREE.Vector3(side * 5.4, 0.02, -0.6)
    const length = from.distanceTo(to)
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, length, 5), lineMaterial)
    line.position.copy(from).add(to).multiplyScalar(0.5)
    line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
    line.castShadow = true
    classicGroup.add(line)
  }

  // --- The stack -----------------------------------------------------------
  interface Box {
    group: THREE.Object3D
    base: THREE.Vector3
    band: number
    shake: number
  }
  const boxes: Box[] = []
  // `position`/`velocity` are the bass drivers' spring state (see update).
  // `driver` is absent for a "virtual" driver — the Mais Baixo bins are
  // folded horns whose driver is hidden inside, but their spring still
  // drives the box recoil and pressure rings.
  interface DriverEntry {
    driver?: Driver
    band: number
    throw: number
    flutter: number
    position: number
    velocity: number
  }
  const drivers: DriverEntry[] = []
  interface PressureRing {
    mesh: THREE.Mesh
    age: number
    radius: number
    origin: THREE.Vector3
    source: DriverEntry
  }
  const pressureRings: PressureRing[] = []
  // `strength` scales the glow — the classic stack's small horn throats
  // can take full brightness; the model's whole horn columns can't.
  const hornGlows: Array<{ material: THREE.MeshStandardMaterial; strength: number }> = []
  const tweeterDomes: THREE.Mesh[] = []

  // Everything a stack animates, so update() can drive whichever stack is
  // showing (see setStack). The classic stack's rig is filled in below as
  // it's built; Mais Baixo's is built when its model loads.
  interface Rig {
    group: THREE.Group
    drivers: DriverEntry[]
    boxes: Box[]
    pressureRings: PressureRing[]
    hornGlows: Array<{ material: THREE.MeshStandardMaterial; strength: number }>
    tweeterDomes: THREE.Mesh[]
    // Camera framing: where it looks, its resting height and distance.
    view: { lookY: number; height: number; distance: number; sway: number }
  }
  const classicRig: Rig = {
    group: classicGroup,
    drivers,
    boxes,
    pressureRings,
    hornGlows,
    tweeterDomes,
    view: { lookY: 2.5, height: 1.9, distance: 9.2, sway: 1.3 },
  }
  let rig = classicRig

  const ringGeometry = new THREE.RingGeometry(0.92, 1, 64)
  function addPressureRing(
    worldCenter: THREE.Vector3,
    radius: number,
    source: DriverEntry,
    parent: THREE.Object3D = classicGroup,
    into: PressureRing[] = pressureRings,
  ) {
    const mesh = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    )
    mesh.position.copy(worldCenter)
    parent.add(mesh)
    into.push({ mesh, age: Infinity, radius, origin: worldCenter.clone(), source })
  }

  function addBox(group: THREE.Group, position: THREE.Vector3, band: number, shake: number) {
    group.position.copy(position)
    classicGroup.add(group)
    boxes.push({ group, base: position.clone(), band, shake })
  }

  function addDriver(parent: THREE.Group, x: number, y: number, z: number, radius: number, band: number, throwAmount: number, flutter: number, options: { grille?: boolean; tweeter?: boolean } = {}) {
    const driver = makeDriver(radius, materials, options)
    driver.group.position.set(x, y, z)
    parent.add(driver.group)
    const entry: DriverEntry = { driver, band, throw: throwAmount, flutter, position: 0, velocity: 0 }
    drivers.push(entry)
    if (driver.dome) tweeterDomes.push(driver.dome)
    return entry
  }

  // Row 1: four scoops — teal top baffle with an 18", black horn cells below.
  const ROW1_W = 1.15
  const ROW1_H = 2.0
  const ROW1_D = 1.2
  const row1Y = PLATFORM_HEIGHT + ROW1_H / 2
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * (ROW1_W + 0.02)
    const group = makeShell(ROW1_W, ROW1_H, ROW1_D, materials.cabinet)
    const baffleH = 0.9
    const baffle = makeBaffle(ROW1_W - 0.06, baffleH - 0.04, materials.accentA, [{ x: 0, y: 0, r: 0.4 }])
    baffle.position.set(0, ROW1_H / 2 - baffleH / 2, ROW1_D / 2 - 0.03)
    group.add(baffle)
    const scoopDriver = addDriver(group, 0, ROW1_H / 2 - baffleH / 2, ROW1_D / 2 - 0.005, 0.4, SUB, 0.18, 0)
    const cells = makeCells(ROW1_W - 0.06, ROW1_H - baffleH - 0.04, 0.9, 2, 2, materials.scoopInner, materials.scoopEdge)
    cells.group.position.set(0, -ROW1_H / 2 + (ROW1_H - baffleH) / 2, ROW1_D / 2 - 0.01)
    group.add(cells.group)
    const position = new THREE.Vector3(x, row1Y, 0)
    // For the sub band, `shake` is recoil per unit of cone excursion.
    addBox(group, position, SUB, 0.06)
    addPressureRing(new THREE.Vector3(x, row1Y + ROW1_H / 2 - baffleH / 2, ROW1_D / 2 + 0.05), 0.4, scoopDriver)
  }

  // Row 2: two wide boxes — grilled driver on the inner half, orange horn
  // cells on the outer half.
  const ROW2_W = 2.3
  const ROW2_H = 1.0
  const ROW2_D = 1.05
  const row2Y = PLATFORM_HEIGHT + ROW1_H + ROW2_H / 2
  for (const side of [-1, 1]) {
    const x = side * (ROW2_W / 2 + 0.01)
    const group = makeShell(ROW2_W, ROW2_H, ROW2_D, materials.cabinet)
    const half = ROW2_W / 2
    const driverX = -side * half / 2
    const baffle = makeBaffle(half - 0.04, ROW2_H - 0.06, materials.accentB, [{ x: 0, y: 0, r: 0.4 }])
    baffle.position.set(driverX, 0, ROW2_D / 2 - 0.02)
    group.add(baffle)
    const bassDriver = addDriver(group, driverX, 0, ROW2_D / 2 - 0.002, 0.4, BASS, 0.14, 0, { grille: true })
    const cells = makeCells(half - 0.04, ROW2_H - 0.06, 0.8, 2, 2, materials.cabinet, materials.accentB)
    cells.group.position.set(side * half / 2, 0, ROW2_D / 2 - 0.01)
    group.add(cells.group)
    addBox(group, new THREE.Vector3(x, row2Y, 0), BASS, 0.006)
    addPressureRing(new THREE.Vector3(x + driverX, row2Y, ROW2_D / 2 + 0.2), 0.4, bassDriver)
  }

  // Row 3: three boxes with two 10"s each — teal sides (mids), orange
  // centre (low-mids).
  const ROW3_W = 1.3
  const ROW3_H = 0.62
  const ROW3_D = 0.8
  const row3Y = PLATFORM_HEIGHT + ROW1_H + ROW2_H + ROW3_H / 2
  for (const slot of [-1, 0, 1]) {
    const band = slot === 0 ? LOW_MID : MID
    const group = makeShell(ROW3_W, ROW3_H, ROW3_D, materials.cabinet)
    const holeRadius = slot === 0 ? 0.27 : 0.21
    const baffle = makeBaffle(ROW3_W - 0.06, ROW3_H - 0.06, slot === 0 ? materials.accentB : materials.accentA, [
      { x: -0.3, y: 0, r: holeRadius },
      { x: 0.3, y: 0, r: holeRadius },
    ])
    baffle.position.set(0, 0, ROW3_D / 2 - 0.02)
    group.add(baffle)
    for (const dx of [-0.3, 0.3]) {
      if (slot === 0) {
        // The centre box's wider cut-outs show a black recess around each driver.
        const recess = new THREE.Mesh(new THREE.CircleGeometry(0.27, 40), materials.black)
        recess.position.set(dx, 0, ROW3_D / 2 - 0.13)
        group.add(recess)
      }
      addDriver(group, dx, 0, ROW3_D / 2, 0.21, band, 0.035, 0.008)
    }
    addBox(group, new THREE.Vector3(slot * (ROW3_W + 0.12), row3Y, 0.05), band, 0.003)
  }

  // Row 4: tweeter bars on the sides, teal horn box in the middle.
  const row4Base = PLATFORM_HEIGHT + ROW1_H + ROW2_H + ROW3_H
  for (const side of [-1, 1]) {
    const w = 1.05
    const h = 0.34
    const d = 0.6
    const group = makeShell(w, h, d, materials.cabinetLight)
    const tweeterXs = [-0.33, -0.11, 0.11, 0.33]
    const baffle = makeBaffle(
      w - 0.05,
      h - 0.05,
      materials.cabinetLight,
      tweeterXs.map((x) => ({ x, y: 0, r: 0.085 })),
    )
    baffle.position.set(0, 0, d / 2 - 0.02)
    group.add(baffle)
    for (const dx of tweeterXs) addDriver(group, dx, 0, d / 2, 0.075, TOP, 0.006, 0.004, { tweeter: true })
    addBox(group, new THREE.Vector3(side * 1.4, row4Base + h / 2, 0.1), TOP, 0.0015)
  }
  {
    const w = 1.2
    const h = 0.55
    const d = 0.7
    const group = makeShell(w, h, d, materials.cabinet)
    const tweeterSpots = [-0.47, 0.47].flatMap((x) => [-0.12, 0.12].map((y) => ({ x, y })))
    const baffle = makeBaffle(w - 0.05, h - 0.05, materials.accentA, [
      { x: 0, y: 0.02, w: 0.62, h: 0.4 },
      ...tweeterSpots.map(({ x, y }) => ({ x, y, r: 0.068 })),
    ])
    baffle.position.set(0, 0, d / 2 - 0.02)
    group.add(baffle)
    const horn = makeHorn(0.62, 0.4, 0.25, 0.45, materials.black)
    horn.position.set(0, 0.02, d / 2 - 0.004)
    group.add(horn)
    const glowMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, emissiveIntensity: 0 })
    const throat = new THREE.Mesh(new THREE.PlaneGeometry(0.62 * 0.25 * 0.9, 0.4 * 0.25 * 0.9), glowMaterial)
    throat.position.set(0, 0.02, d / 2 - 0.45)
    group.add(throat)
    hornGlows.push({ material: glowMaterial, strength: 1 })
    for (const { x, y } of tweeterSpots) addDriver(group, x, y, d / 2, 0.06, TOP, 0.005, 0.004, { tweeter: true })
    addBox(group, new THREE.Vector3(0, row4Base + h / 2, 0.08), TOP, 0.0015)

    // The big square horn on top.
    const topW = 0.95
    const topH = 0.62
    const topD = 0.8
    const top = makeShell(topW, topH, topD, materials.cabinet)
    const topHorn = makeHorn(topW - 0.08, topH - 0.08, 0.2, 0.6, materials.black)
    topHorn.position.set(0, 0, topD / 2)
    top.add(topHorn)
    const topGlowMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, emissiveIntensity: 0 })
    const topThroat = new THREE.Mesh(new THREE.PlaneGeometry((topW - 0.08) * 0.2 * 0.9, (topH - 0.08) * 0.2 * 0.9), topGlowMaterial)
    topThroat.position.set(0, 0, topD / 2 - 0.6)
    top.add(topThroat)
    hornGlows.push({ material: topGlowMaterial, strength: 1 })
    addBox(top, new THREE.Vector3(0, row4Base + h + topH / 2, 0.05), TOP, 0.002)
  }

  const spectrum = new SpectrumBars(5, 30, 16000)
  const bandAverages = new Float32Array(5)

  // --- Mais Baixo: a stack loaded from a Blender model ------------------------
  // Exported from SYSTEM_MB.blend by scripts/blender/export-system-mb.py:
  // four folded-horn bins (bin_1..4), two mid/top boxes (top_1, top_2) each
  // with a column of small horns (horns_1, horns_2) and a grilled driver
  // hole. The bins' drivers fire inside the horn, so they get "virtual"
  // drivers (springs with no cone) that still drive recoil and rings; a
  // real cone is added behind each grille.
  const MODEL_SCALE = 1.5 // the model is life-size (~2m); scaled up to hold the frame
  interface ModelStack {
    rig: Rig
    // Wood meshes and their original (textured) material, per paint slot.
    woodMeshes: Array<{ mesh: THREE.Mesh; original: THREE.Material; slot: 'accentA' | 'accentB' }>
    // Double-sided, bump-free copies of the palette's paint materials (see
    // applyModelFinish) — the imported geometry isn't reliably closed.
    painted: Record<'accentA' | 'accentB', THREE.MeshStandardMaterial>
  }
  let model: ModelStack | null = null
  let modelLoading = false
  let disposed = false
  let wantedStack = 'classic'

  function rigs(): Rig[] {
    return model ? [classicRig, model.rig] : [classicRig]
  }

  // Natural keeps the model's own plywood texture; the painted schemes
  // repaint bins and tops with the palette's two accent finishes.
  function applyModelFinish(stack: ModelStack) {
    for (const [slot, seed] of [
      ['accentA', 3],
      ['accentB', 4],
    ] as const) {
      stack.painted[slot].copy(materials[slot])
      // Chip-free paint (see paintedWood's `chips`).
      const finish = palette[slot]
      stack.painted[slot].map = cached(`${finish.color}|${finish.worn}|${seed}|nochips`, () =>
        paintedWood(finish.color, seed, finish.worn, false),
      ).map
      stack.painted[slot].side = THREE.DoubleSide
      // No bump relief on the model: three's derivative-based bump mapping
      // divides by the surface's screen-space slope, which is zero on some
      // faces of this imported, double-sided geometry — the resulting NaN
      // pixels get smeared across the whole frame by the bloom blur, i.e.
      // the screen flashes black. The grain still shows in the colour map.
      stack.painted[slot].bumpMap = null
      stack.painted[slot].needsUpdate = true
    }
    for (const { mesh, original, slot } of stack.woodMeshes) {
      mesh.material = appliedPaletteId === 'natural' ? original : stack.painted[slot]
    }
  }

  function buildModelStack(root: THREE.Object3D): ModelStack {
    const group = new THREE.Group()
    root.scale.setScalar(MODEL_SCALE)
    group.add(root)
    // Centre it on the platform, front facing the camera (+z).
    root.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(root)
    const centre = bounds.getCenter(new THREE.Vector3())
    root.position.set(-centre.x, PLATFORM_HEIGHT - bounds.min.y, -centre.z)
    root.updateMatrixWorld(true)

    const stack: ModelStack = {
      rig: {
        group,
        drivers: [],
        boxes: [],
        pressureRings: [],
        hornGlows: [],
        tweeterDomes: [],
        view: { lookY: 1.6, height: 1.5, distance: 7.2, sway: 1 },
      },
      woodMeshes: [],
      painted: { accentA: new THREE.MeshStandardMaterial(), accentB: new THREE.MeshStandardMaterial() },
    }
    const { rig: modelRig } = stack

    const hornMaterial = new THREE.MeshStandardMaterial({
      color: BLACK,
      roughness: 0.5,
      emissive: palette.glow,
      emissiveIntensity: 0,
      side: THREE.DoubleSide,
    })
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      const material = mesh.material as THREE.MeshStandardMaterial
      // The SketchUp→Blender import flagged the wood as alpha-blended,
      // which only causes depth-sorting glitches; it's opaque. Faces are
      // drawn from both sides as the imported geometry isn't reliably
      // closed/consistently wound.
      material.transparent = false
      material.depthWrite = true
      material.side = THREE.DoubleSide
      if (material.name === 'grille') {
        material.alphaTest = 0.5
        material.side = THREE.DoubleSide
      } else if (material.name === 'wood') {
        // Its pale texture in full sun crosses the bloom threshold and
        // washes out — take it down to a warmer, more matte plywood.
        material.color.setScalar(0.62)
        material.roughness = 0.85
        material.metalness = 0
        let part: THREE.Object3D | null = mesh
        while (part && !/^(bin|top)_/.test(part.name)) part = part.parent
        stack.woodMeshes.push({ mesh, original: material, slot: part?.name.startsWith('top') ? 'accentB' : 'accentA' })
      }
      let part: THREE.Object3D | null = mesh
      while (part && !part.name.startsWith('horns_')) part = part.parent
      if (part) mesh.material = hornMaterial
    })
    modelRig.hornGlows.push({ material: hornMaterial, strength: 0.03 })

    // Bins: virtual sub drivers → recoil and pressure rings from the horn
    // mouths (the lower part of each bin's front).
    for (let i = 1; i <= 4; i++) {
      const bin = root.getObjectByName(`bin_${i}`)
      if (!bin) continue
      const box = new THREE.Box3().setFromObject(bin)
      const size = box.getSize(new THREE.Vector3())
      const source: DriverEntry = { band: SUB, throw: 0.18, flutter: 0, position: 0, velocity: 0 }
      modelRig.drivers.push(source)
      // Recoil is applied to the bin node in the model's (scaled) space.
      modelRig.boxes.push({ group: bin, base: bin.position.clone(), band: SUB, shake: 0.06 / MODEL_SCALE })
      const mouth = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y + size.y * 0.3, box.max.z + 0.05)
      addPressureRing(mouth, size.x * 0.42, source, group, modelRig.pressureRings)
    }

    // Tops: a real cone behind each grille, on the mids.
    const grilles: THREE.Mesh[] = []
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh && (mesh.material as THREE.Material).name === 'grille') grilles.push(mesh)
    })
    for (const grille of grilles) {
      const box = new THREE.Box3().setFromObject(grille)
      const size = box.getSize(new THREE.Vector3())
      const centre = box.getCenter(new THREE.Vector3())
      const radius = Math.min(size.x, size.y) * 0.45
      const driver = makeDriver(radius, materials)
      driver.group.position.set(centre.x, centre.y, box.min.z - 0.03)
      group.add(driver.group)
      modelRig.drivers.push({ driver, band: MID, throw: 0.03, flutter: 0.006, position: 0, velocity: 0 })
    }
    return stack
  }

  function setStack(stackId: string) {
    wantedStack = stackId
    if (stackId === 'mb' && !model && !modelLoading) {
      modelLoading = true
      new GLTFLoader().load(
        systemMbUrl,
        (gltf) => {
          modelLoading = false
          if (disposed) {
            disposeScene(gltf.scene as unknown as THREE.Scene)
            return
          }
          model = buildModelStack(gltf.scene)
          model.rig.group.visible = false
          scene.add(model.rig.group)
          for (const ring of model.rig.pressureRings) (ring.mesh.material as THREE.MeshBasicMaterial).color.setHex(palette.ring)
          applyModelFinish(model)
          setStack(wantedStack)
        },
        undefined,
        (error) => {
          modelLoading = false
          console.error('failed to load the Mais Baixo model', error)
        },
      )
    }
    // Until the model has loaded (or if it failed), keep showing Classic.
    const useModel = stackId === 'mb' && model !== null
    rig = useModel && model ? model.rig : classicRig
    classicGroup.visible = !useModel
    if (model) model.rig.group.visible = useModel
  }

  // --- Paint jobs --------------------------------------------------------
  // Textures are generated the first time a palette is used and cached for
  // the theme's lifetime, so flipping back and forth is instant.
  const textureCache = new Map<string, { map: THREE.Texture; bumpMap?: THREE.Texture }>()
  function cached(key: string, build: () => { map: THREE.Texture; bumpMap?: THREE.Texture }) {
    let entry = textureCache.get(key)
    if (!entry) {
      entry = build()
      textureCache.set(key, entry)
    }
    return entry
  }
  function applyFinish(material: THREE.MeshStandardMaterial, finish: Finish | null, seed: number) {
    if (!finish) {
      material.map = null
      material.bumpMap = null
      material.color.setHex(BLACK)
      material.roughness = 0.9
      material.needsUpdate = true
      return
    }
    material.color.setHex(0xffffff)
    material.roughness = 0.62
    const { map, bumpMap } = cached(`${finish.color}|${finish.worn}|${seed}`, () => paintedWood(finish.color, seed, finish.worn))
    material.map = map
    material.bumpMap = bumpMap ?? null
    material.needsUpdate = true
  }
  let palette = PALETTES.app
  let appliedPaletteId: string | null = null
  function setColours(paletteId: string) {
    // The shell re-sends every option whenever any one changes; re-applying
    // the same palette would needlessly recompile the materials.
    if (paletteId === appliedPaletteId) return
    appliedPaletteId = paletteId
    palette = PALETTES[paletteId] ?? PALETTES.app
    applyFinish(materials.cabinet, palette.cabinet, 1)
    applyFinish(materials.cabinetLight, palette.cabinetLight, 2)
    applyFinish(materials.accentA, palette.accentA, 3)
    applyFinish(materials.accentB, palette.accentB, 4)
    applyFinish(materials.scoopInner, palette.scoopInner, 5)
    applyFinish(materials.scoopEdge, palette.scoopEdge, 6)
    for (const r of rigs()) {
      for (const ring of r.pressureRings) (ring.mesh.material as THREE.MeshBasicMaterial).color.setHex(palette.ring)
      for (const { material } of r.hornGlows) material.emissive.setHex(palette.glow)
    }
    if (model) applyModelFinish(model)
  }
  setColours('app')

  let urban: UrbanBackdrop | null = null
  const barrierMaterial = new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.35, metalness: 0.85 })
  function setBackground(backgroundId: string) {
    const isUrban = backgroundId === 'urban'
    if (isUrban && !urban) {
      urban = buildUrban(barrierMaterial)
      scene.add(urban.group)
    }
    fieldEnv.visible = !isUrban
    if (urban) urban.group.visible = isUrban
  }

  function setOption(optionId: string, valueId: string) {
    if (optionId === 'stack') setStack(valueId)
    else if (optionId === 'colours') setColours(valueId)
    else if (optionId === 'background') setBackground(valueId)
  }

  function update(frame: AudioFrame): number {
    const { t, dt, flash } = frame
    // Fast attack so cones visibly punch on kicks.
    const levels = spectrum.update(frame, 0.75, 0.25)
    const sub = levels[SUB]
    const bass = levels[BASS]
    const top = levels[TOP]
    // The beat detector's flash, scaled by how loud the sub actually is —
    // it fires on bass rising above its recent average, which happens as
    // readily in a quiet passage as in a heavy one; weighting by level
    // keeps the kick effects (lights, camera, cone punch) to loud kicks.
    const kick = flash * sub

    // Bass cones ride a slightly under-damped spring. They rest inside the
    // cabinet — sustained bass only nudges them forward a little — and
    // punch out on bass *hits* (the band rising above its own recent
    // average), then spring back in. Tracking the level itself kept them
    // parked out of the box through any sustained dub bassline. The
    // surround follows at half travel, so it reads as stretching rather
    // than the cone detaching. Mids/tops stay direct, with a fast flutter
    // that reads as vibration.
    const averaging = 1 - Math.exp(-dt / BASS_AVERAGE_SECONDS)
    let subExcursion = 0
    let subCount = 0
    for (const entry of rig.drivers) {
      const { driver, band, throw: throwAmount, flutter } = entry
      const level = levels[band]
      if (band <= BASS) {
        bandAverages[band] += (level - bandAverages[band]) * averaging
        const hit = Math.max(0, level - bandAverages[band])
        const target = Math.min(1.3, Math.pow(level, 1.3) * 0.3 + hit * 2.5 + kick * 0.2)
        const steps = 2
        const h = dt / steps
        for (let step = 0; step < steps; step++) {
          entry.velocity += ((target - entry.position) * SPRING_STIFFNESS - entry.velocity * SPRING_DAMPING) * h
          entry.position += entry.velocity * h
        }
        const excursion = Math.max(-0.1, entry.position) * throwAmount
        if (driver) {
          driver.cone.position.z = excursion
          driver.surround.position.z = excursion * 0.5
          // Head-on, forward travel alone barely reads — a slight swell
          // sells the cone coming out at the viewer.
          driver.cone.scale.setScalar(1 + excursion * 0.3)
          driver.surround.scale.set(1 + excursion * 0.15, 1 + excursion * 0.15, 0.6)
        }
        if (band === SUB) {
          subExcursion += excursion
          subCount++
        }
      } else if (driver) {
        const vibration = Math.sin(t * 70 + driver.radius * 50) * flutter * level
        driver.cone.position.z = Math.pow(level, 1.6) * throwAmount + vibration
      }
    }
    subExcursion /= Math.max(1, subCount)

    // Tweeter domes shimmer with the tops.
    for (const dome of rig.tweeterDomes) {
      const material = dome.material as THREE.MeshStandardMaterial
      material.emissive.setHex(palette.glow)
      material.emissiveIntensity = Math.pow(top, 1.5) * 1.6
      dome.scale.setScalar(1 + top * 0.25)
      dome.scale.z = 0.9 + top * 0.3
    }
    for (const { material, strength } of rig.hornGlows) {
      material.emissiveIntensity = (Math.pow(top, 1.3) * 4 + kick * 0.4) * strength
    }

    // The scoops recoil smoothly against their cones' push; the smaller
    // boxes rattle with their band.
    for (const box of rig.boxes) {
      if (box.band === SUB) {
        box.group.position.set(box.base.x, box.base.y, box.base.z - subExcursion * box.shake)
        continue
      }
      const level = levels[box.band]
      const amount = box.shake * level * level
      box.group.position.set(
        box.base.x + (Math.random() - 0.5) * amount,
        box.base.y + (Math.random() - 0.5) * amount,
        box.base.z + (Math.random() - 0.5) * amount * 0.5,
      )
    }

    // Pressure rings fire off the cones themselves: only when a cone is
    // already well out AND still being thrown forward fast — i.e. a real,
    // loud push. (Keying them off the beat detector instead fired mostly
    // in quiet passages: it looks for bass jumping above its own recent
    // average, which a sustained heavy bassline rarely does, while any
    // bass returning after a breakdown does.)
    for (const ring of rig.pressureRings) {
      const { position, velocity } = ring.source
      if (position > RING_MIN_EXCURSION && velocity > RING_MIN_VELOCITY && ring.age > RING_MIN_INTERVAL) {
        ring.age = 0
      }
      ring.age += dt
      const material = ring.mesh.material as THREE.MeshBasicMaterial
      const life = 1 - ring.age / 0.55
      if (life <= 0) {
        material.opacity = 0
        continue
      }
      const strength = ring.source.band === SUB ? sub : bass
      ring.mesh.scale.setScalar(ring.radius * (1 + ring.age * 4))
      ring.mesh.position.set(ring.origin.x, ring.origin.y, ring.origin.z + ring.age * 1.8)
      material.opacity = life * life * 0.35 * (0.4 + strength)
    }

    if (fieldEnv.visible) for (const { tree, phase } of trees) tree.rotation.z = Math.sin(t * 0.5 + phase) * 0.012
    if (urban?.group.visible) {
      for (const { mesh, phase } of urban.flags) mesh.rotation.x = Math.sin(t * 1.6 + phase) * 0.35
    }

    // Slow, low, admiring camera — plus a thump on the kick.
    const jolt = kick * 0.03
    const { view } = rig
    camera.position.set(
      Math.sin(t * 0.11) * view.sway + (Math.random() - 0.5) * jolt,
      view.height + Math.sin(t * 0.07) * 0.25 + (Math.random() - 0.5) * jolt,
      view.distance - Math.sin(t * 0.05) * view.distance * 0.1,
    )
    camera.lookAt(0, view.lookY, 0)

    const bloom = 0.1 + top * 0.3 + kick * 0.1
    return urban?.group.visible ? bloom * URBAN_BLOOM_SCALE : bloom
  }

  return {
    scene,
    camera,
    update,
    shadows: true,
    toneMapping: THREE.ACESFilmicToneMapping,
    setOption,
    dispose: () => {
      disposed = true
      ringGeometry.dispose()
      sky.dispose()
      barrierMaterial.dispose()
      disposeScene(scene)
      // Cached textures for palettes not currently applied aren't
      // reachable from the scene.
      for (const { map, bumpMap } of textureCache.values()) {
        map.dispose()
        bumpMap?.dispose()
      }
    },
  }
}

export const soundSystemTheme: VisualizerTheme = {
  id: 'soundsystem',
  name: 'Sound System',
  create,
  options: OPTIONS,
}
