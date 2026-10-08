import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, createFullscreenQuad, disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, ThemeOption, VisualizerTheme } from '../types'

// One fractal object turning in the dark, raymarched: a kaleidoscopic IFS
// (space folded, turned and shrunk five times over), so it's all facets
// within facets, and never the same shape for long. Three squiggly ribbons
// orbit it.
//
// Mids move the fold angles so the crystal keeps re-forming, bass swells
// it, highs shake the ribbons, and each kick snaps the fold on a step.

const STEPS = 64

const FRAGMENT_SHADER = /* glsl */ `
uniform float uAspect;
uniform float uTime;
uniform float uOrbit;
uniform float uSpin;
uniform float uWave;
uniform float uFoldA;
uniform float uFoldB;
uniform float uSwell;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uFlash;
uniform vec3 uDeep;
uniform vec3 uFacet;
uniform vec3 uAccent;
uniform vec3 uRibbon;
uniform vec3 uVoid;
varying vec2 vUv;

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}
float hash2(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// How close the folds came to the centre on the way to the last crystal()
// result — colours the facets.
float trap;

// The crystal: mirror into one octant, sort the axes, turn by the fold
// angles, scale up about an offset, and repeat. It stays within about
// 1.3 units of the origin whatever the angles.
float crystal(vec3 p) {
  p /= uSwell;
  float bound = length(p) - 1.6;
  if (bound > 0.3) return bound * uSwell;
  float s = 1.0;
  trap = 1e3;
  for (int i = 0; i < 5; i++) {
    p = abs(p);
    if (p.x < p.y) p.xy = p.yx;
    if (p.x < p.z) p.xz = p.zx;
    if (p.y < p.z) p.yz = p.zy;
    p.xy *= rot(uFoldA);
    p.yz *= rot(uFoldB);
    p = p * 1.9 - vec3(0.9, 0.5, 0.22);
    s *= 1.9;
    trap = min(trap, length(p));
  }
  return sdBox(p, vec3(0.9)) / s * uSwell;
}

// A ring round the crystal whose line corkscrews as it goes.
float ribbon(vec3 p, float seed) {
  p.xy *= rot(seed * 1.1 + 0.4);
  p.yz *= rot(seed * 0.7 + uSpin * 0.15);
  p.xz *= rot(uSpin * (0.5 + 0.2 * seed));
  float a = atan(p.z, p.x);
  float turns = 9.0 + 3.0 * seed;
  float amp = 0.05 + uHigh * 0.1 + uMid * 0.05;
  float radius = 1.9 + 0.22 * seed;
  vec2 c = vec2(length(p.xz) - radius - amp * sin(a * turns + uWave * 3.0), p.y - amp * cos(a * turns + uWave * 3.0));
  return (length(c) - 0.028) / sqrt(1.0 + amp * amp * turns * turns / (radius * radius));
}

// Distance and material: 1 crystal, 2 ribbon.
vec2 map(vec3 p) {
  vec2 res = vec2(crystal(p), 1.0);
  float d = min(ribbon(p, 0.0), min(ribbon(p, 1.0), ribbon(p, 2.0)));
  if (d < res.x) res = vec2(d, 2.0);
  return res;
}

vec3 normalAt(vec3 p) {
  vec2 e = vec2(0.0015, -0.0015);
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

void main() {
  vec2 q = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0);
  float grain = hash2(floor(gl_FragCoord.xy) + floor(uTime * 12.0) * vec2(17.3, 41.7));

  // Circling the crystal, rising and falling; kicks push in a little.
  float elevation = 0.35 * sin(uTime * 0.13);
  float range = 4.9 - uFlash * 0.2;
  vec3 ro = range * vec3(sin(uOrbit) * cos(elevation), sin(elevation), cos(uOrbit) * cos(elevation));
  vec3 ww = normalize(-ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(q.x * uu + q.y * vv + 1.6 * ww);

  float t = 1.5;
  float steps = 0.0;
  vec2 hit = vec2(-1.0);
  for (int i = 0; i < ${STEPS}; i++) {
    vec2 h = map(ro + rd * t);
    if (h.x < 0.0015) { hit = h; break; }
    t += h.x;
    steps += 1.0;
    if (t > 9.0) break;
  }

  vec3 colour = mix(uVoid, uDeep * 0.4, exp(-dot(q, q) * 1.5));
  if (hit.y > 0.0) {
    vec3 p = ro + rd * t;
    // Sampled before the normal, whose taps would overwrite it.
    crystal(p);
    float folds = trap;
    vec3 n = normalAt(p);
    vec3 key = normalize(uu * -0.5 + vv * 0.7 + ww * -0.5);
    float diffuse = max(dot(n, key), 0.0);
    float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);

    if (hit.y == 1.0) {
      float occlusion = clamp(0.3 + 0.7 * map(p + n * 0.08).x / 0.08, 0.0, 1.0);
      colour = mix(uDeep, uFacet, smoothstep(0.2, 1.3, folds)) * (0.15 + 0.85 * diffuse) * occlusion;
      colour += uAccent * fresnel * 0.7;
      colour += vec3(1.0) * pow(max(dot(reflect(rd, n), key), 0.0), 24.0) * 0.5;
      colour *= 1.0 + uFlash * 0.5;
    } else {
      colour = uRibbon * (0.75 + uHigh * 0.6) + vec3(1.0) * fresnel * 0.3;
    }
  }
  // Rays that skim the crystal's edges pick up a glow.
  float grazed = steps / ${STEPS}.0;
  colour += uAccent * grazed * grazed * 0.45 * (0.6 + uBass);

  colour *= 0.93 + 0.14 * grain;
  colour *= 1.0 - 0.4 * smoothstep(0.8, 2.2, length(q));
  gl_FragColor = vec4(colour, 1.0);
}
`

const OPTIONS: ThemeOption[] = [
  {
    id: 'colours',
    name: 'Colours',
    values: [
      { id: 'amethyst', name: 'Amethyst' },
      { id: 'ember', name: 'Ember' },
      { id: 'glacier', name: 'Glacier' },
      { id: 'shifting', name: 'Shifting' },
    ],
  },
]

interface Palette {
  deep: number
  facet: number
  accent: number
  ribbon: number
  void: number
}

const PALETTES: Record<string, Palette> = {
  amethyst: { deep: 0x3a1c71, facet: 0xd76d77, accent: 0x7fd8ff, ribbon: 0xffd86e, void: 0x05020f },
  ember: { deep: 0x5a0f0f, facet: 0xff8a3d, accent: 0xffe08a, ribbon: 0x6fe3ff, void: 0x0a0302 },
  glacier: { deep: 0x12355b, facet: 0xa8e6ff, accent: 0xffffff, ribbon: 0xff7ac8, void: 0x01060d },
}

function create(): ThemeInstance {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10)

  const uniforms = {
    uAspect: { value: 1 },
    uTime: { value: 0 },
    uOrbit: { value: 0 },
    uSpin: { value: 0 },
    uWave: { value: 0 },
    uFoldA: { value: 0 },
    uFoldB: { value: 0 },
    uSwell: { value: 1 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uFlash: { value: 0 },
    uDeep: { value: new THREE.Color() },
    uFacet: { value: new THREE.Color() },
    uAccent: { value: new THREE.Color() },
    uRibbon: { value: new THREE.Color() },
    uVoid: { value: new THREE.Color() },
  }
  scene.add(
    createFullscreenQuad(
      new THREE.ShaderMaterial({ uniforms, vertexShader: FULLSCREEN_VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER }),
    ),
  )

  // Shifting has no fixed palette: it's rebuilt every frame from the
  // frame's hue (see shiftColours).
  let shifting = false
  function setColours(paletteId: string): void {
    shifting = paletteId === 'shifting'
    if (shifting) return
    const palette = PALETTES[paletteId] ?? PALETTES.amethyst
    uniforms.uDeep.value.setHex(palette.deep)
    uniforms.uFacet.value.setHex(palette.facet)
    uniforms.uAccent.value.setHex(palette.accent)
    uniforms.uRibbon.value.setHex(palette.ribbon)
    uniforms.uVoid.value.setHex(palette.void)
  }
  setColours('amethyst')

  // Amethyst's layout, turned round the colour wheel.
  function shiftColours(hue: number): void {
    uniforms.uDeep.value.setHSL(hue, 0.6, 0.28)
    uniforms.uFacet.value.setHSL((hue + 0.2) % 1, 0.6, 0.64)
    uniforms.uAccent.value.setHSL((hue + 0.75) % 1, 1, 0.75)
    uniforms.uRibbon.value.setHSL((hue + 0.5) % 1, 1, 0.7)
    uniforms.uVoid.value.setHSL(hue, 0.7, 0.03)
  }

  // The fold angles wander with `phase`; each kick moves `kickTarget` on
  // a step and `kick` eases after it.
  let phase = 0
  let kick = 0
  let kickTarget = 0

  function update(frame: AudioFrame): number {
    const { dt, bass, mid, high, energy, beat, flash, hue } = frame
    if (shifting) shiftColours(hue)
    uniforms.uAspect.value = camera.aspect
    // Integrated, so the music changing never jumps anything.
    phase += dt * (0.12 + mid * 0.9)
    if (beat) kickTarget += 0.3
    kick += (kickTarget - kick) * (1 - Math.exp(-dt * 8))
    uniforms.uFoldA.value = 0.45 * Math.sin(phase * 0.7) + kick
    uniforms.uFoldB.value = 0.4 * Math.cos(phase * 0.53) + kick * 0.5
    uniforms.uSwell.value = 1 + bass * 0.18 + flash * 0.04
    uniforms.uOrbit.value += dt * (0.12 + energy * 0.4)
    uniforms.uSpin.value += dt * (0.3 + energy * 1.2 + flash * 0.8)
    uniforms.uWave.value += dt * (1 + high * 3 + mid * 2)
    uniforms.uTime.value += dt
    uniforms.uBass.value = bass
    uniforms.uMid.value = mid
    uniforms.uHigh.value = high
    uniforms.uFlash.value = flash
    return 0.3 + bass * 0.25 + flash * 0.3
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

export const crystalTheme: VisualizerTheme = { id: 'crystal', name: 'Crystal', create, options: OPTIONS }
