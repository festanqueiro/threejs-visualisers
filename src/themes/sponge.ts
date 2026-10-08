import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, createFullscreenQuad, disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, ThemeOption, VisualizerTheme } from '../types'

// A flight down one corridor of an endless Menger sponge, raymarched:
// square holes inside square holes in every wall, cross corridors opening
// to the sides, and three wiggly tubes running alongside like rails.
//
// Mids speed the flight and roll the camera, bass breathes the holes wider,
// highs shake the tubes, and each kick sends a band of light off down the
// corridor.

const STEPS = 72

// The sponge repeats every 3 units along the corridor (and the tubes'
// wiggles are tuned to that), so the flight distance wraps on a multiple
// of it to keep the shader's floats precise.
const WRAP = 600

const FRAGMENT_SHADER = /* glsl */ `
uniform float uAspect;
uniform float uFly;
uniform float uTime;
uniform float uRoll;
uniform float uWave;
uniform float uPulse;
uniform float uPulseAmp;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uFlash;
uniform vec3 uWall;
uniform vec3 uShade;
uniform vec3 uTube;
uniform vec3 uGlow;
uniform vec3 uVoid;
varying vec2 vUv;

const float TAU = 6.2831853;
const float SIZE = 1.5; // world units per sponge unit: corridors are 1 wide, 3 apart

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}
float hash2(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Inigo Quilez's Menger sponge without its bounding cube, so it fills
// space: crosses carved out at four scales, the widest being the
// corridors. Bass widens every hole.
float sponge(vec3 p) {
  float d = -1.0;
  float s = 1.0;
  float k = 1.0 - uBass * 0.18;
  for (int i = 0; i < 4; i++) {
    vec3 a = mod(p * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float da = max(r.x, r.y);
    float db = max(r.y, r.z);
    float dc = max(r.z, r.x);
    d = max(d, (min(da, min(db, dc)) - k) / s);
  }
  return d;
}

// A tube along the corridor, off-centre, snaking as it goes.
float tube(vec3 p, float seed) {
  float angle = seed * 2.4 + 0.6;
  float amp = 0.03 + uHigh * 0.05 + uMid * 0.02;
  float freq = TAU * (4.0 + seed) / 3.0;
  vec2 centre = vec2(cos(angle), sin(angle)) * 0.33
    + amp * vec2(sin(p.z * freq + uWave * 4.0 + seed * 3.0), cos(p.z * freq + uWave * 3.0));
  return (length(p.xy - centre) - 0.025) / sqrt(1.0 + amp * amp * freq * freq);
}

// Distance and material: 1 sponge, 2 tube.
vec2 map(vec3 p) {
  vec2 res = vec2(sponge(p / SIZE) * SIZE * 0.8, 1.0);
  float d = min(tube(p, 0.0), min(tube(p, 1.0), tube(p, 2.0)));
  if (d < res.x) res = vec2(d, 2.0);
  return res;
}

vec3 normalAt(vec3 p, float t) {
  vec2 e = vec2(0.0008, -0.0008) * (1.0 + t * 0.5);
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

void main() {
  vec2 q = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0);
  float grain = hash2(floor(gl_FragCoord.xy) + floor(uTime * 12.0) * vec2(17.3, 41.7));

  // Down the middle of the corridor, swaying and rolling; kicks jolt it.
  float jolt = uFlash * uBass * 0.015;
  vec3 ro = vec3(0.05 * sin(uTime * 0.23) + jolt * sin(uTime * 90.0), 0.04 * sin(uTime * 0.17) + jolt * cos(uTime * 70.0), -uFly);
  vec3 rd = normalize(vec3(q, -1.3));
  rd.xy *= rot(uRoll);
  rd.xz *= rot(0.1 * sin(uTime * 0.11));
  rd.yz *= rot(0.07 * sin(uTime * 0.13));

  float t = 0.0;
  float steps = 0.0;
  vec2 hit = vec2(-1.0);
  for (int i = 0; i < ${STEPS}; i++) {
    vec2 h = map(ro + rd * t);
    if (h.x < 0.001 * (1.0 + t)) { hit = h; break; }
    t += h.x;
    steps += 1.0;
    if (t > 18.0) break;
  }

  vec3 colour = uVoid;
  if (hit.y > 0.0) {
    vec3 p = ro + rd * t;
    vec3 n = normalAt(p, t);
    float occlusion = clamp(map(p + n * 0.1).x / 0.1, 0.0, 1.0);
    // Lit from the camera, like a headlamp.
    float light = 1.0 / (1.0 + t * t * 0.03) * (1.0 + uFlash * 0.4);

    if (hit.y == 1.0) {
      vec3 face = abs(n);
      colour = mix(uWall, uShade, face.y * 0.6 + face.x * 0.25) * (0.2 + 0.8 * occlusion) * light;
      // The kick's band of light, racing away down the corridor.
      colour += uGlow * exp(-abs(p.z - (ro.z - uPulse)) * 1.5) * uPulseAmp * 0.8;
    } else {
      colour = uTube * (0.7 + uHigh * 0.6) * light;
      colour += vec3(1.0) * pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * 0.3 * light;
    }
    colour = mix(colour, uVoid, 1.0 - exp(-t * 0.14));
  }
  // Rays that graze a lot of edges pick up a glow.
  float grazed = steps / ${STEPS}.0;
  colour += uGlow * grazed * grazed * 0.5 * (0.6 + uBass);

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
      { id: 'reactor', name: 'Reactor' },
      { id: 'bone', name: 'Bone' },
      { id: 'acid', name: 'Acid' },
      { id: 'shifting', name: 'Shifting' },
    ],
  },
]

interface Palette {
  wall: number
  shade: number
  tube: number
  glow: number
  void: number
}

const PALETTES: Record<string, Palette> = {
  reactor: { wall: 0x3d5a80, shade: 0x1b2a49, tube: 0xffb347, glow: 0x2ec4ff, void: 0x01030a },
  bone: { wall: 0xe8e0d0, shade: 0x8a8172, tube: 0xd8392c, glow: 0xfff1d0, void: 0x0a0806 },
  acid: { wall: 0x5b2a86, shade: 0x1d0b3a, tube: 0xc6ff3d, glow: 0xff3fa4, void: 0x05010d },
}

function create(): ThemeInstance {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10)

  const uniforms = {
    uAspect: { value: 1 },
    uFly: { value: 0 },
    uTime: { value: 0 },
    uRoll: { value: 0 },
    uWave: { value: 0 },
    uPulse: { value: 0 },
    uPulseAmp: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uFlash: { value: 0 },
    uWall: { value: new THREE.Color() },
    uShade: { value: new THREE.Color() },
    uTube: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
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
    const palette = PALETTES[paletteId] ?? PALETTES.reactor
    uniforms.uWall.value.setHex(palette.wall)
    uniforms.uShade.value.setHex(palette.shade)
    uniforms.uTube.value.setHex(palette.tube)
    uniforms.uGlow.value.setHex(palette.glow)
    uniforms.uVoid.value.setHex(palette.void)
  }
  setColours('reactor')

  // Reactor's layout, turned round the colour wheel: the tubes stay the
  // complement of the walls so they always stand out.
  function shiftColours(hue: number): void {
    uniforms.uWall.value.setHSL(hue, 0.4, 0.4)
    uniforms.uShade.value.setHSL((hue + 0.05) % 1, 0.5, 0.18)
    uniforms.uTube.value.setHSL((hue + 0.5) % 1, 1, 0.62)
    uniforms.uGlow.value.setHSL((hue + 0.9) % 1, 1, 0.6)
    uniforms.uVoid.value.setHSL(hue, 0.7, 0.02)
  }

  function update(frame: AudioFrame): number {
    const { dt, bass, mid, high, beat, flash, hue } = frame
    if (shifting) shiftColours(hue)
    uniforms.uAspect.value = camera.aspect
    // Integrated, so the music changing never jumps anything.
    uniforms.uFly.value = (uniforms.uFly.value + dt * (0.4 + mid * 1.4 + bass * 0.5)) % WRAP
    uniforms.uRoll.value += dt * (0.04 + mid * 0.25)
    uniforms.uWave.value += dt * (1 + high * 3 + mid * 2)
    uniforms.uTime.value += dt
    // Each kick starts a new band of light at the camera.
    if (beat) {
      uniforms.uPulse.value = 0
      uniforms.uPulseAmp.value = 1
    }
    uniforms.uPulse.value += dt * 14
    uniforms.uPulseAmp.value *= Math.exp(-dt * 1.8)
    uniforms.uBass.value = bass
    uniforms.uMid.value = mid
    uniforms.uHigh.value = high
    uniforms.uFlash.value = flash
    return 0.25 + high * 0.15 + flash * 0.25
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

export const spongeTheme: VisualizerTheme = { id: 'sponge', name: 'Sponge', create, options: OPTIONS }
