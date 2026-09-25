import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, NOISE_GLSL, createFullscreenQuad, disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, ThemeOption, VisualizerTheme } from '../types'

// A smoke-filled room lit from below by a lamp that pumps with the kick,
// with stage beams sweeping through it — the beams only show where
// there's smoke to catch them. The smoke is domain-warped fBm noise
// drifting upward; drift and swirl speeds are integrated on the CPU so
// the energy changing never makes the smoke jump.
const FRAGMENT_SHADER = /* glsl */ `
uniform float uAspect;
uniform float uTime;
uniform float uRise;
uniform float uSwirl;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uFlash;
uniform vec3 uSmokeA;
uniform vec3 uSmokeB;
uniform vec3 uBeam;
varying vec2 vUv;
${NOISE_GLSL}

// Soft light shaft from origin \`o\` along direction \`dir\`.
float beam(vec2 p, vec2 o, vec2 dir, float width) {
  vec2 d = p - o;
  float along = dot(d, dir);
  float across = length(d - dir * along);
  float w = width * (0.25 + along * 0.35); // widens with distance
  return smoothstep(0.0, 0.25, along) * exp(-(across * across) / (w * w)) / (1.0 + along * 0.6);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.2;
  vec2 rise = vec2(0.0, -uRise);
  vec2 q = vec2(fbm(p * 1.1 + rise + vec2(0.0, uTime * 0.03)),
                fbm(p * 1.1 + rise + vec2(5.2, 1.3) - uTime * 0.02));
  vec2 r = vec2(fbm(p * 1.3 + 3.0 * q + vec2(1.7, 9.2) + rise * 1.3 + uSwirl),
                fbm(p * 1.3 + 3.0 * q + vec2(8.3, 2.8) + rise * 1.3 - uSwirl));
  float d = fbm(p * 1.6 + 3.5 * r + rise * 1.6);

  // Thicker low down where it's pouring out, thinning towards the top;
  // a kick puffs it out.
  float thickness = d + 0.3 - vUv.y * 0.35 + uBass * 0.12 + uFlash * 0.1;
  float density = smoothstep(0.45, 1.05, thickness);

  // Lamp below the frame, pumping with the bass.
  vec2 lampPos = (vec2(0.5, -0.2) - 0.5) * vec2(uAspect, 1.0) * 2.2;
  float lamp = exp(-length((p - lampPos) * vec2(0.6, 1.0)) * (1.9 - uBass * 0.5));

  vec3 smokeColour = mix(uSmokeA, uSmokeB, clamp(length(q) * 0.9, 0.0, 1.0));
  vec3 colour = smokeColour * density * (0.06 + lamp * (0.5 + uBass * 0.6 + uFlash * 0.5));
  // Brighter crests where the smoke rolls over itself.
  colour += smokeColour * pow(density, 3.0) * lamp * (0.15 + uMid * 0.35);

  // Three beams from above, swaying with the music.
  float shafts = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 origin = vec2((fi - 1.0) * 0.9 * uAspect, 1.35);
    float angle = -1.5708 + sin(uTime * (0.21 + fi * 0.07) + fi * 2.1) * 0.55;
    shafts += beam(p, origin, vec2(cos(angle), sin(angle)), 0.18);
  }
  colour += uBeam * shafts * (0.06 + density * 1.1) * (0.4 + uHigh * 0.9 + uFlash * 0.6);

  vec2 v = vUv - 0.5;
  colour *= 1.0 - dot(v, v) * 1.3;
  // Soft shoulder instead of clipping: a hot lamp still reads as smoke.
  colour = colour / (1.0 + colour);
  gl_FragColor = vec4(colour, 1.0);
}
`

const OPTIONS: ThemeOption[] = [
  {
    id: 'colours',
    name: 'Colours',
    values: [
      { id: 'shifting', name: 'Shifting' },
      { id: 'amber', name: 'Amber' },
      { id: 'violet', name: 'Violet' },
      { id: 'ghost', name: 'Ghost' },
    ],
  },
]

// Fixed palettes: smoke (two tones) and beam colour.
const PALETTES: Record<string, [number, number, number]> = {
  amber: [0x8a4b12, 0xd9a441, 0xffe2a8],
  violet: [0x3b1a6e, 0x9a4fd6, 0x7fe3ff],
  ghost: [0x6f7680, 0xc9d1dc, 0xffffff],
}

function create(): ThemeInstance {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10)
  const uniforms = {
    uAspect: { value: 16 / 9 },
    uTime: { value: 0 },
    uRise: { value: 0 },
    uSwirl: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uFlash: { value: 0 },
    uSmokeA: { value: new THREE.Color() },
    uSmokeB: { value: new THREE.Color() },
    uBeam: { value: new THREE.Color() },
  }
  scene.add(
    createFullscreenQuad(
      new THREE.ShaderMaterial({ uniforms, vertexShader: FULLSCREEN_VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER }),
    ),
  )

  let colours = 'shifting'

  function update(frame: AudioFrame): number {
    const { t, dt, bass, mid, high, energy, flash, hue } = frame
    uniforms.uAspect.value = camera.aspect
    uniforms.uTime.value = t % 1000
    uniforms.uRise.value += dt * (0.05 + energy * 0.25 + flash * 0.2)
    uniforms.uSwirl.value += dt * (0.03 + mid * 0.2)
    uniforms.uBass.value = bass
    uniforms.uMid.value = mid
    uniforms.uHigh.value = high
    uniforms.uFlash.value = flash
    const palette = PALETTES[colours]
    if (palette) {
      uniforms.uSmokeA.value.setHex(palette[0])
      uniforms.uSmokeB.value.setHex(palette[1])
      uniforms.uBeam.value.setHex(palette[2])
    } else {
      uniforms.uSmokeA.value.setHSL(hue, 0.55, 0.3)
      uniforms.uSmokeB.value.setHSL((hue + 0.1) % 1, 0.6, 0.6)
      uniforms.uBeam.value.setHSL((hue + 0.5) % 1, 0.7, 0.75)
    }
    return 0.2 + bass * 0.2 + flash * 0.25
  }

  return {
    scene,
    camera,
    update,
    dispose: () => disposeScene(scene),
    setOption: (optionId, valueId) => {
      if (optionId === 'colours') colours = valueId
    },
  }
}

export const smokeTheme: VisualizerTheme = { id: 'smoke', name: 'Smoke', create, options: OPTIONS }
