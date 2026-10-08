import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, createFullscreenQuad, disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, ThemeOption, VisualizerTheme } from '../types'

// Vaporwave: a striped sun sinking behind a neon grid that scrolls towards
// you, with odd shapes hanging in the sky — a wiggling torus, a tumbling
// Menger cube and a row of squiggles. The floor and sky are analytic; only
// the shapes are raymarched.
//
// Bass swells the sun and ripples the grid, mids speed the scroll, highs
// shake the torus and squiggles, kicks flash the grid lines.

const STEPS = 44

// The grid repeats every half unit, so the scroll distance wraps here to
// keep the shader's floats precise.
const WRAP = 100

const FRAGMENT_SHADER = /* glsl */ `
uniform float uAspect;
uniform float uSpread;
uniform float uFly;
uniform float uTime;
uniform float uSpin;
uniform float uWave;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uFlash;
uniform vec3 uSkyTop;
uniform vec3 uSkyLow;
uniform vec3 uSun;
uniform vec3 uPink;
uniform vec3 uCyan;
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

// Inigo Quilez's Menger sponge: a unit cube with crosses carved out of
// it at three scales.
float mengerCube(vec3 p) {
  float d = sdBox(p, vec3(1.0));
  float s = 1.0;
  for (int i = 0; i < 3; i++) {
    vec3 a = mod(p * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float da = max(r.x, r.y);
    float db = max(r.y, r.z);
    float dc = max(r.z, r.x);
    d = max(d, (min(da, min(db, dc)) - 1.0) / s);
  }
  return d;
}

// A torus whose tube snakes up and down and in and out as it goes round.
float wigglyTorus(vec3 p) {
  float a = atan(p.z, p.x);
  float amp = 0.05 + uHigh * 0.08 + uMid * 0.04;
  p.y -= amp * sin(a * 5.0 + uWave * 3.0);
  float ring = length(p.xz) - 0.5 * (1.0 + uBass * 0.12) - amp * 0.6 * cos(a * 3.0 - uWave * 2.0);
  return (length(vec2(ring, p.y)) - 0.13) * 0.6;
}

// A short tube along x, wiggling with the music.
float squiggle(vec3 p, float seed) {
  float amp = 0.05 + uMid * 0.07 + uHigh * 0.06;
  float freq = 11.0 + 4.0 * seed;
  float envelope = smoothstep(0.75, 0.3, abs(p.x));
  float y = amp * envelope * sin(p.x * freq + uWave * 4.0 + seed * 9.0);
  float d = length(vec2(p.y - y, p.z)) / sqrt(1.0 + amp * amp * freq * freq) - 0.03;
  return max(d, abs(p.x) - 0.75);
}

// Distance and material: 1 torus, 2 cube, 3 squiggle.
vec2 map(vec3 p) {
  float bob = sin(uTime * 0.7) * 0.06;

  vec3 a = p - vec3(-1.3 * uSpread, 1.0 + bob, -3.6);
  a.xy *= rot(0.5 + 0.2 * sin(uTime * 0.3));
  a.yz *= rot(uSpin * 0.6);
  vec2 res = vec2(wigglyTorus(a), 1.0);

  vec3 b = p - vec3(1.3 * uSpread, 0.95 - bob, -3.8);
  b.xz *= rot(uSpin * 0.4);
  b.xy *= rot(uSpin * 0.27);
  float d = mengerCube(b / 0.42) * 0.42;
  if (d < res.x) res = vec2(d, 2.0);

  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec3 c = p - vec3((fi - 1.0) * 1.5 * uSpread, 1.95 + 0.12 * sin(uTime * 0.5 + fi * 2.1), -4.6 + 0.3 * fi);
    c.xy *= rot(0.25 * sin(uTime * 0.4 + fi * 1.7));
    d = squiggle(c, fi);
    if (d < res.x) res = vec2(d, 3.0);
  }
  return res;
}

vec3 normalAt(vec3 p) {
  vec2 e = vec2(0.002, -0.002);
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

void main() {
  vec2 q = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0);
  float grain = hash2(floor(gl_FragCoord.xy) + floor(uTime * 12.0) * vec2(17.3, 41.7));

  vec3 ro = vec3(0.1 * sin(uTime * 0.21), 0.55 + 0.04 * sin(uTime * 0.33) + uFlash * uBass * 0.03, 0.0);
  vec3 rd = normalize(vec3(q.x, q.y + 0.12, -1.6));
  // Sky coordinates: the horizon is s.y = 0.
  vec2 s = rd.xy / -rd.z;

  // Sky and stars.
  float height = clamp(s.y / 0.6, 0.0, 1.0);
  vec3 colour = mix(uSkyLow, uSkyTop, pow(height, 0.6));
  vec2 cell = floor(s * 60.0);
  float star = hash2(cell);
  vec2 inCell = fract(s * 60.0) - 0.5 - (vec2(hash2(cell + 3.7), hash2(cell + 9.1)) - 0.5) * 0.6;
  float twinkle = 0.6 + 0.4 * sin(uTime * 3.0 + star * 40.0);
  colour += step(0.9, star) * (1.0 - smoothstep(0.0, 0.12, length(inCell))) * twinkle * height * (0.5 + uHigh);

  // The sun: slats cut out of its lower half, wider towards the bottom.
  vec2 sc = s - vec2(0.0, 0.14);
  float sunRadius = 0.17 * (1.0 + uBass * 0.1 + uFlash * 0.05);
  float sunDist = length(sc) - sunRadius;
  float v = sc.y / sunRadius;
  float gap = mix(0.5, 0.05, smoothstep(-1.0, 0.25, v));
  float slats = max(smoothstep(gap, gap + 0.08, fract(v * 7.0 + uTime * 0.15)), step(0.25, v));
  vec3 sunColour = mix(uPink, uSun, smoothstep(-0.8, 0.7, v));
  colour = mix(colour, sunColour, (1.0 - smoothstep(-0.004, 0.004, sunDist)) * slats);
  colour += uPink * 0.35 * exp(-max(sunDist, 0.0) * 9.0) * (1.0 + uFlash * 0.6);

  // The floor: a grid of half-unit cells, drawn analytically.
  if (rd.y < 0.0) {
    float t = -ro.y / rd.y;
    vec3 p = ro + rd * t;
    vec2 g = vec2(p.x + 0.06 * uBass * sin(p.z * 1.3 + uWave * 2.0), p.z + uFly) * 2.0;
    vec2 toLine = abs(fract(g - 0.5) - 0.5);
    // How much of the grid one pixel covers, so far lines fade, not shimmer.
    vec2 w = t * 0.008 * vec2(1.0, 1.0 / max(-rd.y, 0.03));
    vec2 lines = (1.0 - smoothstep(vec2(0.03), vec2(0.03) + w, toLine)) * min(vec2(1.0), 0.06 / w);
    float line = max(lines.x, lines.y);
    float swell = 0.5 + 0.5 * sin(p.z * 0.8 + uWave * 2.0);
    vec3 gridColour = mix(uPink, uCyan, 0.5 + 0.5 * sin(p.z * 0.4 + uWave)) * (0.8 + uFlash + uBass * 0.6 * swell);
    colour = mix(uSkyLow * 0.6, uSkyTop * 0.15, exp(-t * 0.1));
    colour += gridColour * line * exp(-t * 0.07);
    // The sun's reflection, a soft streak down the middle.
    colour += uSun * 0.12 * exp(-abs(p.x) * 0.5 / (1.0 + t * 0.1)) * smoothstep(2.0, 10.0, t);
  }

  // The shapes, which all sit between 2 and 7 units away.
  float t = 2.0;
  vec2 hit = vec2(-1.0);
  for (int i = 0; i < ${STEPS}; i++) {
    vec2 h = map(ro + rd * t);
    if (h.x < 0.002) { hit = h; break; }
    t += h.x;
    if (t > 7.0) break;
  }
  if (hit.y > 0.0) {
    vec3 p = ro + rd * t;
    vec3 n = normalAt(p);
    float diffuse = 0.5 + 0.5 * dot(n, normalize(vec3(-0.3, 0.6, 0.7)));
    float up = 0.5 + 0.5 * n.y;
    vec3 base = hit.y == 1.0 ? mix(uPink, uCyan, up) : hit.y == 2.0 ? mix(uCyan, uSun, up) : mix(uPink, uSun, up);
    colour = base * (0.25 + 0.85 * diffuse) * (1.0 + uFlash * 0.3);
    colour += vec3(1.0) * pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * 0.5;
  }

  // An old screen: scanlines, grain and dark corners.
  colour *= 1.0 - 0.07 * step(0.5, fract(gl_FragCoord.y * 0.25));
  colour *= 0.94 + 0.12 * grain;
  colour *= 1.0 - 0.35 * smoothstep(0.8, 2.2, length(q));
  gl_FragColor = vec4(colour, 1.0);
}
`

const OPTIONS: ThemeOption[] = [
  {
    id: 'colours',
    name: 'Colours',
    values: [
      { id: 'sunset', name: 'Sunset' },
      { id: 'mall', name: 'Mall' },
      { id: 'midnight', name: 'Midnight' },
      { id: 'shifting', name: 'Shifting' },
    ],
  },
]

interface Palette {
  skyTop: number
  skyLow: number
  sun: number
  pink: number
  cyan: number
}

const PALETTES: Record<string, Palette> = {
  sunset: { skyTop: 0x1a0b3b, skyLow: 0x7a2a8c, sun: 0xffd866, pink: 0xff3fa4, cyan: 0x3fe0ff },
  mall: { skyTop: 0x4a8fb0, skyLow: 0xf2a6cf, sun: 0xfff3b0, pink: 0xff8ad1, cyan: 0x6ff2e0 },
  midnight: { skyTop: 0x02030f, skyLow: 0x1b1464, sun: 0xff5e7a, pink: 0x9d4bff, cyan: 0x29f0ff },
}

function create(): ThemeInstance {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10)

  const uniforms = {
    uAspect: { value: 1 },
    uSpread: { value: 1 },
    uFly: { value: 0 },
    uTime: { value: 0 },
    uSpin: { value: 0 },
    uWave: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uFlash: { value: 0 },
    uSkyTop: { value: new THREE.Color() },
    uSkyLow: { value: new THREE.Color() },
    uSun: { value: new THREE.Color() },
    uPink: { value: new THREE.Color() },
    uCyan: { value: new THREE.Color() },
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
    const palette = PALETTES[paletteId] ?? PALETTES.sunset
    uniforms.uSkyTop.value.setHex(palette.skyTop)
    uniforms.uSkyLow.value.setHex(palette.skyLow)
    uniforms.uSun.value.setHex(palette.sun)
    uniforms.uPink.value.setHex(palette.pink)
    uniforms.uCyan.value.setHex(palette.cyan)
  }
  setColours('sunset')

  // Sunset's layout, turned round the colour wheel.
  function shiftColours(hue: number): void {
    uniforms.uSkyTop.value.setHSL(hue, 0.7, 0.14)
    uniforms.uSkyLow.value.setHSL((hue + 0.08) % 1, 0.55, 0.36)
    uniforms.uSun.value.setHSL((hue + 0.4) % 1, 1, 0.7)
    uniforms.uPink.value.setHSL((hue + 0.15) % 1, 1, 0.62)
    uniforms.uCyan.value.setHSL((hue + 0.6) % 1, 1, 0.62)
  }

  function update(frame: AudioFrame): number {
    const { dt, bass, mid, high, energy, flash, hue } = frame
    if (shifting) shiftColours(hue)
    uniforms.uAspect.value = camera.aspect
    // On narrow screens the shapes close in so they stay in view.
    uniforms.uSpread.value = Math.min(1, Math.max(0.45, camera.aspect / 1.78))
    // Integrated, so the music changing never jumps anything.
    uniforms.uFly.value = (uniforms.uFly.value + dt * (0.6 + mid * 2.2 + bass * 0.8)) % WRAP
    uniforms.uSpin.value += dt * (0.3 + energy * 1.2 + flash * 0.8)
    uniforms.uWave.value += dt * (1 + high * 3 + mid * 2)
    uniforms.uTime.value += dt
    uniforms.uBass.value = bass
    uniforms.uMid.value = mid
    uniforms.uHigh.value = high
    uniforms.uFlash.value = flash
    return 0.3 + bass * 0.2 + flash * 0.3
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

export const vaporTheme: VisualizerTheme = { id: 'vapor', name: 'Vapor', create, options: OPTIONS }
