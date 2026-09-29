import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, createFullscreenQuad, disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, ThemeOption, VisualizerTheme } from '../types'

// A flight through the dark, raymarched: yellow spheres hang along the
// way, a chain of white spheres spirals off into the distance, and squiggly
// yellow sound waves float past. Shaded like an illustration — grainy,
// stippled gradients that boil a little, like hand-drawn animation.
//
// Mids and bass speed the flight and wind the white spiral round; a bass
// swell travels down the chain; highs and mids shake the squiggles; kicks
// flash the light, pulse the yellow spheres and jolt the camera.

const STEPS = 60

// Everything repeats every WRAP units along z (spheres and squiggles
// every 2, the spiral every 3), so the
// flight distance wraps there to keep the shader's floats precise.
const WRAP = 600

const FRAGMENT_SHADER = /* glsl */ `
uniform float uAspect;
uniform float uFly;
uniform float uTime;
uniform float uSpin;
uniform float uWave;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uFlash;
uniform vec3 uBlue;
uniform vec3 uViolet;
uniform vec3 uYellow;
uniform vec3 uWhite;
uniform vec3 uVoid;
varying vec2 vUv;

const float TAU = 6.2831853;
const float CELLS = ${WRAP / 2}.0; // squiggle/sphere cells per wrap

float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float hash2(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// One yellow sphere per 2-unit cell, off to the sides.
float yellowSphere(vec3 p, float k) {
  float id = mod(k, CELLS);
  float angle = hash1(id) * TAU;
  float radius = (0.06 + 0.1 * hash1(id + 3.1)) * (1.0 + uFlash * 0.35 * hash1(id + 5.7));
  vec3 c = vec3(cos(angle) * 0.8, sin(angle) * 0.8 + sin(uTime * 1.1 + id) * 0.05, k * 2.0 + 1.0 + (hash1(id + 7.3) - 0.5) * 0.8);
  return length(p - c) - radius;
}

// The white chain: spheres every 0.3 units on a helix round the flight
// path, clear of the camera; a bass swell travels down it.
float whiteSphere(vec3 p, float n) {
  float z = n * 0.3;
  float angle = z * TAU / 3.0 + uSpin;
  float swell = 0.5 + 0.5 * sin(z * 1.7 + uWave * 2.0);
  vec3 c = vec3(cos(angle) * 0.45, sin(angle) * 0.45, z);
  return length(p - c) - 0.105 * (1.0 + uBass * 0.45 * swell);
}

// A squiggle along one of four sides of each cell, wiggling with the music.
float squiggle(vec3 p, float k) {
  float id = mod(k, CELLS);
  float side = floor(hash1(id + 11.3) * 4.0);
  vec2 w = p.xy;
  if (side == 1.0) w = vec2(p.y, -p.x);
  else if (side == 2.0) w = -p.xy;
  else if (side == 3.0) w = vec2(-p.y, p.x);
  float u = p.z - (k * 2.0 + 1.0);
  float amp = 0.035 + uMid * 0.08 + uHigh * 0.06;
  float freq = 14.0 + 10.0 * hash1(id + 2.2);
  float envelope = smoothstep(0.7, 0.35, abs(u));
  float y = (hash1(id + 4.4) - 0.5) * 1.0 + amp * envelope * sin(u * freq + uWave * 4.0 + id);
  float d = length(vec2(w.x + 0.94, (w.y - y) / sqrt(1.0 + amp * amp * freq * freq))) - 0.018;
  return max(d, abs(u) - 0.7);
}

// Distance and material: 1 yellow sphere, 2 white sphere, 3 squiggle.
vec2 map(vec3 p) {
  vec2 res = vec2(1e3, 1.0);

  float k = floor(p.z / 2.0);
  float kn = k + (fract(p.z / 2.0) > 0.5 ? 1.0 : -1.0);
  float d = min(yellowSphere(p, k), yellowSphere(p, kn));
  if (d < res.x) res = vec2(d, 1.0);

  float n = floor(p.z / 0.3);
  d = min(whiteSphere(p, n), whiteSphere(p, n + 1.0));
  if (d < res.x) res = vec2(d, 2.0);

  d = min(squiggle(p, k), squiggle(p, kn));
  if (d < res.x) res = vec2(d, 3.0);
  return res;
}

vec3 normalAt(vec3 p, float t) {
  vec2 e = vec2(0.0006, -0.0006) * (1.0 + t * 0.5);
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

// Stippled shading: a smooth gradient pushed part-way to dots of full
// light or shadow, with a grain that re-rolls 12 times a second.
float grain;
float stipple(float s) {
  s = clamp(s, 0.0, 1.0);
  return mix(s, step(grain, s), 0.45);
}

void main() {
  vec2 q = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0);
  grain = hash2(floor(gl_FragCoord.xy) + floor(uTime * 12.0) * vec2(17.3, 41.7));

  // Onwards, drifting and rolling a little; kicks jolt it.
  float jolt = uFlash * uBass * 0.02;
  vec3 ro = vec3(0.1 * sin(uTime * 0.23) + jolt * sin(uTime * 90.0), 0.08 * sin(uTime * 0.17) + jolt * cos(uTime * 70.0), -uFly);
  vec3 ww = normalize(vec3(0.12 * sin(uTime * 0.11), 0.08 * sin(uTime * 0.13), -1.0));
  float roll = 0.18 * sin(uTime * 0.07);
  vec3 up = vec3(sin(roll), cos(roll), 0.0);
  vec3 uu = normalize(cross(ww, up));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(q.x * uu + q.y * vv + 1.6 * ww);

  float t = 0.0;
  vec2 hit = vec2(-1.0);
  for (int i = 0; i < ${STEPS}; i++) {
    vec2 h = map(ro + rd * t);
    if (h.x < 0.001 * (1.0 + t)) { hit = h; break; }
    t += h.x * 0.9;
    if (t > 22.0) break;
  }

  // A faint glow far ahead, so the dark has depth.
  vec3 colour = mix(uVoid, uBlue * 0.35, exp(-dot(q, q) * 1.2));
  vec3 background = colour;
  if (hit.y >= 0.0) {
    vec3 p = ro + rd * t;
    vec3 n = normalAt(p, t);
    vec3 key = normalize(vec3(-0.45, 0.7, 0.55));
    float occlusion = clamp(0.3 + 0.7 * map(p + n * 0.15).x / 0.15, 0.0, 1.0);
    float light = 1.0 / (1.0 + t * t * 0.025) * (1.0 + uFlash * 0.5);

    if (hit.y == 1.0) {
      float s = (0.5 + 0.5 * dot(n, key)) * light * occlusion;
      colour = mix(uViolet * 0.55, uYellow * 1.1, stipple(s * 1.2));
    } else if (hit.y == 2.0) {
      float s = (0.5 + 0.5 * dot(n, key)) * light * occlusion;
      colour = mix(uBlue * 0.6, uWhite, stipple(s * 1.25));
    } else {
      float s = (0.6 + 0.4 * dot(n, key)) * light;
      colour = mix(uViolet * 0.6, uYellow * 1.2, stipple(s * 1.3));
    }
    // Rim light from the distance.
    colour += uWhite * pow(1.0 - max(dot(n, -rd), 0.0), 4.0) * 0.12 * light;
    colour = mix(colour, background, 1.0 - exp(-t * 0.1));
  }

  colour *= 0.92 + 0.16 * grain;
  colour = mix(colour, uVoid, smoothstep(0.9, 2.2, length(q)) * 0.6);
  gl_FragColor = vec4(colour, 1.0);
}
`

const OPTIONS: ThemeOption[] = [
  {
    id: 'colours',
    name: 'Colours',
    values: [
      { id: 'dream', name: 'Dream' },
      { id: 'candy', name: 'Candy' },
      { id: 'noir', name: 'Noir' },
      { id: 'shifting', name: 'Shifting' },
    ],
  },
]

interface Palette {
  blue: number
  violet: number
  yellow: number
  white: number
  void: number
}

const PALETTES: Record<string, Palette> = {
  dream: { blue: 0x4a5cc8, violet: 0x6e5494, yellow: 0xd9c85e, white: 0xe9e6f5, void: 0x04041a },
  candy: { blue: 0x55c3d6, violet: 0xd97ab6, yellow: 0xfff07a, white: 0xffffff, void: 0x1a0a28 },
  noir: { blue: 0x44474f, violet: 0x2a2c32, yellow: 0xd8392c, white: 0xf0ece4, void: 0x000000 },
}

function create(): ThemeInstance {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10)

  const uniforms = {
    uAspect: { value: 1 },
    uFly: { value: 0 },
    uTime: { value: 0 },
    uSpin: { value: 0 },
    uWave: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uFlash: { value: 0 },
    uBlue: { value: new THREE.Color() },
    uViolet: { value: new THREE.Color() },
    uYellow: { value: new THREE.Color() },
    uWhite: { value: new THREE.Color() },
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
    const palette = PALETTES[paletteId] ?? PALETTES.dream
    uniforms.uBlue.value.setHex(palette.blue)
    uniforms.uViolet.value.setHex(palette.violet)
    uniforms.uYellow.value.setHex(palette.yellow)
    uniforms.uWhite.value.setHex(palette.white)
    uniforms.uVoid.value.setHex(palette.void)
  }
  setColours('dream')

  // Dream's layout, turned round the colour wheel: the spheres stay the
  // complement of the backdrop so they always stand out.
  function shiftColours(hue: number): void {
    uniforms.uBlue.value.setHSL(hue, 0.5, 0.52)
    uniforms.uViolet.value.setHSL((hue + 0.08) % 1, 0.3, 0.42)
    uniforms.uYellow.value.setHSL((hue + 0.5) % 1, 0.62, 0.62)
    uniforms.uWhite.value.setHSL(hue, 0.35, 0.92)
    uniforms.uVoid.value.setHSL(hue, 0.7, 0.04)
  }

  function update(frame: AudioFrame): number {
    const { dt, bass, mid, high, energy, flash, hue } = frame
    if (shifting) shiftColours(hue)
    uniforms.uAspect.value = camera.aspect
    // Integrated, so the music changing never jumps anything.
    uniforms.uFly.value = (uniforms.uFly.value + dt * (0.35 + mid * 0.9 + bass * 0.4)) % WRAP
    uniforms.uSpin.value += dt * (0.15 + energy * 1.2 + flash * 0.8)
    uniforms.uWave.value += dt * (1 + high * 3 + mid * 2)
    uniforms.uTime.value += dt
    uniforms.uBass.value = bass
    uniforms.uMid.value = mid
    uniforms.uHigh.value = high
    uniforms.uFlash.value = flash
    return 0.12 + high * 0.15 + flash * 0.2
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

export const originsTheme: VisualizerTheme = { id: 'origins', name: 'Origins', create, options: OPTIONS }
