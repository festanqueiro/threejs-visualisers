import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, SpectrumBars, createFullscreenQuad, disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, ThemeOption, VisualizerTheme } from '../types'

const SPECTRUM_BARS = 32

// A kaleidoscope: the screen is folded into mirrored wedges around the
// centre, and inside each wedge an iterated fold-and-rotate pattern of
// glowing rings drifts and zooms. The kick punches the zoom and spins the
// mirrors; each fold layer glows with its own slice of the spectrum, and
// the spectrum also draws a ring of light around the centre.
const FRAGMENT_SHADER = /* glsl */ `
uniform float uAspect;
uniform float uTime;
uniform float uSegments;
uniform float uSpin;
uniform float uZoom;
uniform float uDrift;
uniform float uBass;
uniform float uFlash;
uniform float uHue;
uniform float uSaturation;
uniform sampler2D uSpectrum;
varying vec2 vUv;

vec3 palette(float t) {
  vec3 c = 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
  return mix(vec3(dot(c, vec3(0.333))), c, uSaturation);
}

mat2 rotate(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

float spectrum(float x) {
  return texture2D(uSpectrum, vec2(clamp(x, 0.0, 1.0), 0.5)).r;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float radius = length(p);
  float angle = atan(p.y, p.x) + uSpin;
  float wedge = 6.28318 / uSegments;
  angle = mod(angle, wedge);
  angle = abs(angle - wedge * 0.5); // mirror each wedge
  vec2 z = vec2(cos(angle), sin(angle)) * radius * uZoom;

  vec3 colour = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    z = abs(z) - vec2(0.42 + 0.12 * sin(uDrift * 0.7 + fi), 0.3 + 0.1 * cos(uDrift * 0.5 + fi * 1.3));
    z *= rotate(uDrift * 0.35 + fi * 0.9);
    z *= 1.18;
    float d = length(z);
    float level = spectrum((fi + 0.5) / 5.0);
    float ring = exp(-abs(sin(d * 7.0 - uTime * 1.2 - fi)) * (16.0 - uBass * 5.0 - level * 4.0));
    colour += palette(uHue + fi * 0.11 + d * 0.15) * ring * (0.06 + level * 0.3);
  }

  // Spectrum halo around the centre: brighter where that band is loud.
  float band = spectrum(fract(angle / wedge * 0.999));
  float halo = exp(-abs(radius - 0.12 - band * 0.12 - uBass * 0.05) * 90.0);
  colour += palette(uHue + 0.5) * halo * (0.15 + band * 0.5);

  colour += palette(uHue) * exp(-radius * 10.0) * uFlash * 0.35;
  colour *= smoothstep(1.1, 0.25, radius);
  colour = colour / (1.0 + colour);
  gl_FragColor = vec4(colour, 1.0);
}
`

const OPTIONS: ThemeOption[] = [
  {
    id: 'mirrors',
    name: 'Mirrors',
    values: [
      { id: '8', name: '8' },
      { id: '6', name: '6' },
      { id: '12', name: '12' },
    ],
  },
  {
    id: 'colours',
    name: 'Colours',
    values: [
      { id: 'vivid', name: 'Vivid' },
      { id: 'soft', name: 'Soft' },
    ],
  },
]

function create(): ThemeInstance {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10)
  const spectrumData = new Uint8Array(SPECTRUM_BARS)
  const spectrumTexture = new THREE.DataTexture(spectrumData, SPECTRUM_BARS, 1, THREE.RedFormat, THREE.UnsignedByteType)
  spectrumTexture.magFilter = THREE.LinearFilter
  spectrumTexture.minFilter = THREE.LinearFilter
  spectrumTexture.needsUpdate = true
  const uniforms = {
    uAspect: { value: 16 / 9 },
    uTime: { value: 0 },
    uSegments: { value: 8 },
    uSpin: { value: 0 },
    uZoom: { value: 1.6 },
    uDrift: { value: 0 },
    uBass: { value: 0 },
    uFlash: { value: 0 },
    uHue: { value: 0 },
    uSaturation: { value: 1 },
    uSpectrum: { value: spectrumTexture },
  }
  scene.add(
    createFullscreenQuad(
      new THREE.ShaderMaterial({ uniforms, vertexShader: FULLSCREEN_VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER }),
    ),
  )
  const spectrum = new SpectrumBars(SPECTRUM_BARS)
  let spinVelocity = 0

  function update(frame: AudioFrame): number {
    const { t, dt, bass, mid, energy, beat, flash, hue } = frame
    const levels = spectrum.update(frame, 0.6, 0.15)
    for (let i = 0; i < SPECTRUM_BARS; i++) spectrumData[i] = Math.round(levels[i] * 255)
    spectrumTexture.needsUpdate = true

    // Each kick flicks the mirrors round; the flick eases off on its own.
    if (beat) spinVelocity += (Math.random() < 0.5 ? -1 : 1) * (0.6 + bass)
    spinVelocity *= Math.exp(-dt * 2.5)
    uniforms.uSpin.value += dt * (0.05 + spinVelocity)
    uniforms.uDrift.value += dt * (0.08 + mid * 0.4 + energy * 0.2)
    uniforms.uZoom.value = 1.6 + Math.sin(t * 0.07) * 0.4 - bass * 0.35 - flash * 0.2
    uniforms.uAspect.value = camera.aspect
    uniforms.uTime.value = t % 1000
    uniforms.uBass.value = bass
    uniforms.uFlash.value = flash
    uniforms.uHue.value = hue
    return 0.3 + bass * 0.25 + flash * 0.3
  }

  return {
    scene,
    camera,
    update,
    dispose: () => {
      spectrumTexture.dispose()
      disposeScene(scene)
    },
    setOption: (optionId, valueId) => {
      if (optionId === 'mirrors') uniforms.uSegments.value = Number(valueId) || 8
      if (optionId === 'colours') uniforms.uSaturation.value = valueId === 'soft' ? 0.45 : 1
    },
  }
}

export const kaleidoscopeTheme: VisualizerTheme = { id: 'kaleidoscope', name: 'Kaleidoscope', create, options: OPTIONS }
