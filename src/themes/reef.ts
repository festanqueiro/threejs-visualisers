import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, createFullscreenQuad, disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, ThemeOption, VisualizerTheme } from '../types'

// A slow dive through a fractal reef. Three layers of lacework — an
// inversion fold iterated on itself, so it branches into rings, holes and
// filaments at every scale — stream past the camera, each fading in out of
// the murk and out again as it reaches us, so the dive never ends. Dark
// structure, flecked with gold, hazed by teal water; light caustics ripple
// over everything and marine snow drifts through.
//
// Bass swells the folds (the lacework thickens and breathes), mids speed
// the dive, highs glitter the gold, kicks flash the light from above.

const LAYERS = 3
const FOLDS = 7

const FRAGMENT_SHADER = /* glsl */ `
uniform float uAspect;
uniform float uDive;
uniform float uTime;
uniform float uBass;
uniform float uHigh;
uniform float uFlash;
uniform vec3 uWater;
uniform vec3 uDeep;
uniform vec3 uStructure;
uniform vec3 uGold;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

// Lacework: fold, invert, shift — repeatedly. The distance to the fold
// axes along the way traces thin curves (the structure); the distance to
// the origin picks out small beads along them (the gold).
void lace(vec2 p, vec2 c, float width, out float structure, out float beads) {
  float trap = 1e3;
  float bead = 1e3;
  for (int i = 0; i < ${FOLDS}; i++) {
    p = abs(p) / max(dot(p, p), 1e-3) - c;
    trap = min(trap, min(abs(p.x), abs(p.y)));
    bead = min(bead, length(p - vec2(0.3, 0.1)));
  }
  structure = 1.0 - smoothstep(0.0, width, trap);
  beads = (1.0 - smoothstep(0.0, width * 3.0, trap)) * smoothstep(0.35, 0.05, bead) * 0.6
    + structure * step(0.62, noise(p * 9.0)) ;
}

// Light rippling on the water, seen through itself twice.
float caustics(vec2 p, float t) {
  float a = sin(p.x * 3.0 + t + sin(p.y * 2.3 - t * 0.7) * 1.3);
  float b = sin(p.y * 3.4 - t * 0.8 + sin(p.x * 2.7 + t * 0.6) * 1.5);
  return pow(1.0 - abs(a * b), 6.0);
}

void main() {
  vec2 q = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0);

  // Water: lighter towards the surface, deeper below.
  vec3 colour = mix(uDeep, uWater, smoothstep(-1.2, 1.1, q.y + 0.15) * 0.8 + 0.2);
  colour += uWater * exp(-dot(q - vec2(0.0, 1.3), q - vec2(0.0, 1.3)) * 0.5) * (0.15 + uFlash * 0.35);

  float base = fract(uDive * ${LAYERS}.0) / ${LAYERS}.0;
  float layerId = floor(uDive * ${LAYERS}.0);

  for (int j = 0; j < ${LAYERS}; j++) {
    float z = base + float(j) / ${LAYERS}.0;
    float id = layerId - float(j);
    float seed = hash(vec2(id, 3.7));
    // Nearer layers are bigger, sharper and more opaque; far ones fade into haze.
    float zoom = exp(z * 2.1);
    vec2 drift = vec2(sin(uTime * 0.05 + seed * 6.0), cos(uTime * 0.04 + seed * 9.0)) * 0.25;
    vec2 p = (q + drift) / zoom * 1.25 + vec2(seed, hash(vec2(id, 9.1))) * 20.0;
    vec2 c = vec2(0.72 + 0.07 * seed, 0.55 + 0.06 * sin(uTime * 0.1 + id)) + vec2(0.02) * uBass;

    float structure, beads;
    lace(p, c, 0.05 + uBass * 0.035 + z * 0.02, structure, beads);

    float presence = smoothstep(0.0, 0.3, z) * (1.0 - smoothstep(0.78, 1.0, z));
    float haze = 1.0 - z * 0.75;
    vec3 layerColour = mix(uStructure, uStructure * 0.35, z);
    // Gold catches the light in flecks that glitter with the highs.
    float glitter = 0.55 + 0.45 * sin(uTime * 3.0 + hash(floor(p * 9.0)) * 40.0) * (0.3 + uHigh);
    layerColour += uGold * clamp(beads, 0.0, 1.0) * glitter * (1.0 + uHigh * 1.5);

    float alpha = clamp(structure, 0.0, 1.0) * presence * (1.0 - haze * 0.55);
    colour = mix(colour, mix(layerColour, uWater, haze * 0.5), alpha);
    // Water between layers thickens with distance.
    colour = mix(colour, uWater * 0.9, (1.0 - z) * 0.09 * presence);
  }

  // Caustics, brighter near the surface and on kicks.
  float rays = caustics(q * 1.4 + vec2(0.0, uTime * 0.03), uTime * 0.5) * 0.5 + caustics(q * 2.3, uTime * 0.7 + 3.0) * 0.3;
  colour += uWater * rays * (0.10 + uFlash * 0.12) * smoothstep(-1.0, 1.0, q.y);

  // Marine snow: drifting motes, twinkling with the highs.
  vec2 cell = q * 14.0 + vec2(uTime * 0.15, uTime * 0.25);
  vec2 id2 = floor(cell);
  vec2 f = fract(cell) - 0.5 - (vec2(hash(id2), hash(id2 + 7.0)) - 0.5) * 0.6;
  float mote = smoothstep(0.06, 0.0, length(f)) * step(0.75, hash(id2 + 3.0));
  colour += vec3(0.9, 1.0, 0.95) * mote * (0.25 + uHigh * 0.5);

  // Vignette: the water closes in at the edges.
  colour = mix(colour, uDeep * 0.6, smoothstep(0.7, 2.0, length(q)) * 0.55);
  gl_FragColor = vec4(colour, 1.0);
}
`

const OPTIONS: ThemeOption[] = [
  {
    id: 'colours',
    name: 'Colours',
    values: [
      { id: 'reef', name: 'Reef' },
      { id: 'deep', name: 'Deep' },
      { id: 'bloom', name: 'Bloom' },
    ],
  },
]

interface Palette {
  water: number
  deep: number
  structure: number
  gold: number
}

const PALETTES: Record<string, Palette> = {
  reef: { water: 0x5fc4b4, deep: 0x1f5f66, structure: 0x14282e, gold: 0xe6c078 },
  deep: { water: 0x2f7fb8, deep: 0x07203d, structure: 0x050d1c, gold: 0x63e8ff },
  bloom: { water: 0x6fb8c8, deep: 0x2a4a6a, structure: 0x2a1233, gold: 0xff8fb0 },
}

function create(): ThemeInstance {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10)

  const uniforms = {
    uAspect: { value: 1 },
    uDive: { value: 0 },
    uTime: { value: 0 },
    uBass: { value: 0 },
    uHigh: { value: 0 },
    uFlash: { value: 0 },
    uWater: { value: new THREE.Color(PALETTES.reef.water) },
    uDeep: { value: new THREE.Color(PALETTES.reef.deep) },
    uStructure: { value: new THREE.Color(PALETTES.reef.structure) },
    uGold: { value: new THREE.Color(PALETTES.reef.gold) },
  }
  scene.add(
    createFullscreenQuad(
      new THREE.ShaderMaterial({ uniforms, vertexShader: FULLSCREEN_VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER }),
    ),
  )

  function update(frame: AudioFrame): number {
    const { dt, bass, mid, high, flash } = frame
    uniforms.uAspect.value = camera.aspect
    // Integrated, so the dive changing speed never jumps the layers.
    uniforms.uDive.value += dt * (0.02 + mid * 0.05 + bass * 0.02)
    uniforms.uTime.value += dt
    uniforms.uBass.value = bass
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
      if (optionId !== 'colours') return
      const palette = PALETTES[valueId] ?? PALETTES.reef
      uniforms.uWater.value.setHex(palette.water)
      uniforms.uDeep.value.setHex(palette.deep)
      uniforms.uStructure.value.setHex(palette.structure)
      uniforms.uGold.value.setHex(palette.gold)
    },
  }
}

export const reefTheme: VisualizerTheme = { id: 'reef', name: 'Reef', create, options: OPTIONS }
