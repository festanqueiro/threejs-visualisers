import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, createFullscreenQuad, disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, ThemeOption, VisualizerTheme } from '../types'

// A cluster of liquid blobs drifting round each other and flowing together,
// raymarched in 3D and slowly turning in front of a fixed camera. Mids and
// highs speed the flow up, bass and kicks make the blobs pour into each
// other and ripple their surface, highs sharpen the highlights. Nothing
// scales with the music, so it never zooms.
//
// Shading comes out as one brightness value, looked up in a palette ramp:
// smoothly in 3D, or, in the Lo-Res style, in big pixels (LORES_HEIGHT
// rows) ordered-dithered between the palette's few colours like old
// hardware.

const BLOBS = 7
const LORES_HEIGHT = 90
const RAMP_SIZE = 8

const FRAGMENT_SHADER = /* glsl */ `
uniform float uAspect;
uniform float uFlow;
uniform float uRipple;
uniform float uSpin;
uniform float uBass;
uniform float uHigh;
uniform float uFlash;
uniform float uLoRes;
uniform vec2 uRes;
uniform sampler2D uRamp;
uniform float uCount;
varying vec2 vUv;

vec3 blobs[${BLOBS}];
float merge;
float rippleAmount;

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// The blobs orbit on slow Lissajous paths, integrated by uFlow so the
// speed changing never makes them jump.
void placeBlobs() {
  float spread = clamp(uAspect * 0.7, 0.45, 1.1);
  for (int i = 0; i < ${BLOBS}; i++) {
    float fi = float(i);
    blobs[i] = vec3(
      sin(uFlow * (0.61 + fi * 0.13) + fi * 1.7) * spread,
      sin(uFlow * (0.83 + fi * 0.11) + fi * 2.9) * 0.75,
      sin(uFlow * (0.53 + fi * 0.17) + fi * 4.1) * spread
    );
  }
}

float scene(vec3 p) {
  // Turn the whole cluster (not the camera) about y, tilted a little.
  float c = cos(uSpin), s = sin(uSpin);
  p.xz = mat2(c, -s, s, c) * p.xz;
  p.yz = mat2(0.96, -0.28, 0.28, 0.96) * p.yz;
  float d = 1e3;
  for (int i = 0; i < ${BLOBS}; i++) {
    float radius = 0.36 + 0.08 * sin(float(i) * 2.3);
    d = smin(d, length(p - blobs[i]) - radius, merge);
  }
  return d + sin(p.x * 7.0 + uRipple) * sin(p.y * 6.0 - uRipple * 0.8) * sin(p.z * 7.0 + uRipple * 1.1) * rippleAmount;
}

vec3 normalAt(vec3 p) {
  vec2 e = vec2(0.0015, -0.0015);
  return normalize(e.xyy * scene(p + e.xyy) + e.yyx * scene(p + e.yyx) + e.yxy * scene(p + e.yxy) + e.xxx * scene(p + e.xxx));
}

// A dark studio: a soft glow overhead and two tall softboxes either side.
float studio(vec3 r) {
  return smoothstep(-0.3, 1.0, r.y) * 0.5 + smoothstep(0.9, 0.98, abs(r.x)) * smoothstep(-0.6, 0.2, r.y) * 0.9;
}

// 4x4 ordered-dither threshold (0..1) for a pixel.
float bayer2(vec2 a) { return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(floor(a * 0.5)) * 0.25 + bayer2(a); }

void main() {
  vec2 pixel = floor(vUv * uRes);
  vec2 uv = uLoRes > 0.5 ? (pixel + 0.5) / uRes : vUv;
  vec2 q = (uv * 2.0 - 1.0) * vec2(uAspect, 1.0);

  placeBlobs();
  merge = 0.5 + uBass * 0.25 + uFlash * 0.2;
  rippleAmount = 0.008 + uHigh * 0.02 + uFlash * 0.03;

  vec3 ro = vec3(0.0, 0.0, 4.2);
  vec3 rd = normalize(vec3(q, -2.4));

  // Soft glow behind the liquid, breathing with the bass.
  float shade = 0.03 + exp(-dot(q, q) * 0.5) * (0.06 + uBass * 0.08);

  // Skip rays that miss the cluster's bounding sphere.
  float b = dot(ro, rd);
  float disc = b * b - dot(ro, ro) + 2.6 * 2.6;
  if (disc > 0.0) {
    float t = max(0.0, -b - sqrt(disc));
    float tEnd = -b + sqrt(disc);
    for (int i = 0; i < 80; i++) {
      vec3 p = ro + rd * t;
      float d = scene(p);
      if (d < 0.001 * t) {
        vec3 n = normalAt(p);
        vec3 l = normalize(vec3(0.6, 0.8, 0.5));
        float diffuse = max(dot(n, l), 0.0);
        float spec = pow(max(dot(n, normalize(l - rd)), 0.0), 60.0);
        float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        float occlusion = clamp(scene(p + n * 0.15) / 0.15, 0.0, 1.0);
        shade = 0.1 + diffuse * 0.35 + studio(reflect(rd, n)) * (0.3 + fresnel * 0.5);
        shade = shade * (0.55 + 0.45 * occlusion) + spec * (0.7 + uHigh * 0.5) + uFlash * 0.12;
        break;
      }
      t += d * 0.8;
      if (t > tEnd) break;
    }
  }

  // Brightness to palette: blended smoothly, or dithered between entries.
  float level = clamp(shade, 0.0, 1.0) * (uCount - 1.0);
  if (uLoRes > 0.5) level = min(uCount - 1.0, floor(level + bayer4(pixel)));
  gl_FragColor = vec4(texture2D(uRamp, vec2((level + 0.5) / ${RAMP_SIZE}.0, 0.5)).rgb, 1.0);
}
`

const OPTIONS: ThemeOption[] = [
  {
    id: 'style',
    name: 'Style',
    values: [
      { id: '3d', name: '3D' },
      { id: 'lores', name: 'Lo-Res' },
    ],
  },
  {
    id: 'palette',
    name: 'Palette',
    values: [
      { id: 'shifting', name: 'Shifting' },
      { id: 'mercury', name: 'Mercury' },
      { id: 'gameboy', name: 'Game Boy' },
      { id: 'amber', name: 'Amber' },
      { id: 'cga', name: 'CGA' },
    ],
  },
]

// Fixed palettes, darkest first. Shifting is rebuilt each frame from the hue.
const FIXED_PALETTES: Record<string, string[]> = {
  mercury: ['#050608', '#1a1d24', '#3a3f4a', '#646b78', '#9aa1ad', '#c9ced6', '#eef1f5', '#ffffff'],
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  amber: ['#0a0400', '#3a1c00', '#6b3500', '#9a4d00', '#c86600', '#ec8a10', '#ffb030', '#ffe0a0'],
  cga: ['#000000', '#aa00aa', '#ff55ff', '#00aaaa', '#55ffff', '#ffffff'],
}

function create(): ThemeInstance {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10)

  // The palette as a row of texels; the shader blends or picks between them.
  const rampData = new Uint8Array(RAMP_SIZE * 4)
  const ramp = new THREE.DataTexture(rampData, RAMP_SIZE, 1, THREE.RGBAFormat)
  ramp.magFilter = THREE.LinearFilter
  ramp.minFilter = THREE.LinearFilter
  ramp.colorSpace = THREE.SRGBColorSpace

  const uniforms = {
    uAspect: { value: 1 },
    uFlow: { value: 0 },
    uRipple: { value: 0 },
    uSpin: { value: 0 },
    uBass: { value: 0 },
    uHigh: { value: 0 },
    uFlash: { value: 0 },
    uLoRes: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uRamp: { value: ramp },
    uCount: { value: RAMP_SIZE },
  }
  scene.add(
    createFullscreenQuad(
      new THREE.ShaderMaterial({ uniforms, vertexShader: FULLSCREEN_VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER }),
    ),
  )

  let paletteId = 'shifting'
  const colour = new THREE.Color()

  function writeRamp(hue: number): void {
    const fixed = FIXED_PALETTES[paletteId]
    const count = fixed ? fixed.length : RAMP_SIZE
    for (let i = 0; i < count; i++) {
      if (fixed) colour.set(fixed[i])
      else {
        const k = i / (RAMP_SIZE - 1)
        colour.setHSL((hue + k * 0.3) % 1, 0.85 - k * 0.25, 0.03 + k * 0.82)
      }
      rampData.set([Math.round(colour.r * 255), Math.round(colour.g * 255), Math.round(colour.b * 255), 255], i * 4)
    }
    uniforms.uCount.value = count
    ramp.needsUpdate = true
  }

  function update(frame: AudioFrame): number {
    const { dt, bass, mid, high, energy, flash, hue } = frame
    const aspect = camera.aspect
    uniforms.uAspect.value = aspect
    uniforms.uRes.value.set(Math.max(16, Math.round(LORES_HEIGHT * aspect)), LORES_HEIGHT)
    uniforms.uFlow.value += dt * (0.3 + mid * 0.8 + high * 0.4)
    uniforms.uRipple.value += dt * (1.5 + high * 5 + flash * 4)
    uniforms.uSpin.value += dt * (0.1 + energy * 0.2)
    uniforms.uBass.value = bass
    uniforms.uHigh.value = high
    uniforms.uFlash.value = flash
    writeRamp(hue)
    return uniforms.uLoRes.value ? 0 : 0.35 + flash * 0.35
  }

  return {
    scene,
    camera,
    update,
    dispose: () => {
      ramp.dispose()
      disposeScene(scene)
    },
    setOption: (optionId, valueId) => {
      if (optionId === 'style') uniforms.uLoRes.value = valueId === 'lores' ? 1 : 0
      if (optionId === 'palette') paletteId = valueId
    },
  }
}

export const liquidTheme: VisualizerTheme = { id: 'liquid', name: 'Liquid 3D', create, options: OPTIONS }
