import * as THREE from 'three'
import { follow } from '../audio'
import { FULLSCREEN_VERTEX_SHADER, NOISE_GLSL, createDotTexture, createFullscreenQuad, disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, ThemeOption, VisualizerQuality, VisualizerTheme } from '../types'

// Open sea, raymarched: a heightfield of sharp-crested waves out to the
// horizon under a sky with drifting clouds, the camera riding the swell
// towards the sun. The water reflects the sky (Fresnel), glows green-blue
// through the crests where the light comes through, glitters along the
// sun's path and breaks into whitecaps, and spray blows off the crests.
//
// Bass raises the swell and big kicks send a wave rolling in towards the
// camera; mids make the sea choppier; highs set the glitter, the glints,
// the foam; the music's energy speeds the sea up, and in loud passages
// the camera rides down into the troughs. Each kick flares the sun — at
// night it lights the foam up instead, and now and then sends a shooting
// star across.

// The shader's camera is the theme's three.js camera (position + turn
// passed in as uniforms), so the spray drawn over it lines up.
const FOCAL = 1.9 // screen half-height over focal length = 1 / FOCAL

// A kick swell's crest, across the whole sea: its height profile's width
// (units) and how fast it rolls in (units/second, towards +z).
const SWELL_WIDTH = 7
const SWELL_SPEED = 14
const MAX_SWELLS = 4

const FRAGMENT_SHADER = /* glsl */ `
uniform float uAspect;
uniform float uTime;
uniform float uClock;
uniform vec3 uCamPos;
uniform mat3 uCamTurn;
uniform float uSwell;
uniform float uChop;
uniform vec4 uSwells[${MAX_SWELLS}];
uniform float uTop;
uniform float uGlitter;
uniform float uGlints;
uniform float uFoam;
uniform float uSunBoost;
uniform float uStars;
uniform float uSparkle;
uniform vec3 uMeteorFrom;
uniform vec3 uMeteorTo;
uniform float uMeteorAge;
uniform float uBiolum;
uniform float uSunSize;
uniform float uDisc;
uniform float uCloudCover;
uniform float uFog;
uniform float uSkyFog;
uniform int uGrade;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uDeep;
uniform vec3 uScatter;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
varying vec2 vUv;

${NOISE_GLSL}

// Quality (set as defines): MARCH_STEPS, MARCH_WAVES, DETAIL_WAVES,
// REFLECT_CLOUDS, REFINE (bisection steps after the march, for crisp
// crests), NORMAL_E (finest normal sample spacing).
const float FAR = 1800.0;

// Sum of exp(sin) waves — sharp crests, wide troughs — each a little
// shorter, weaker and faster than the last, spread round the wind
// direction. Each one drags the sample point along its slope, which
// bunches later waves up on the crests of earlier ones (the "chop").
// Returns 0 (deepest trough) .. 1 (highest crest). Mirrored in JS
// (seaWaves) to keep the camera riding the same water.
float waves(vec2 p, int count) {
  float freq = 0.18;
  float amp = 1.0;
  float sum = 0.0;
  float total = 0.0;
  for (int i = 0; i < 48; i++) {
    if (i >= count) break;
    float angle = 0.35 + sin(float(i) * 2.17) * 1.25;
    vec2 dir = vec2(sin(angle), -cos(angle));
    // Deep-water dispersion: speed goes with the square root of frequency.
    float x = dot(dir, p) * freq + uTime * sqrt(9.8 * freq);
    float w = exp(sin(x) - 1.0);
    p -= dir * w * cos(x) * amp * uChop / freq * 0.18;
    sum += w * amp;
    total += amp;
    amp *= 0.8;
    freq *= 1.19;
  }
  return sum / total;
}

// Kick swells: ridges right across the sea, rolling in. x = z position,
// y = height.
float swells(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < ${MAX_SWELLS}; i++) {
    vec4 s = uSwells[i];
    if (s.y <= 0.0) continue;
    float d = (p.y - s.x) / ${SWELL_WIDTH.toFixed(1)};
    h += s.y * exp(-d * d) * (0.85 + 0.15 * sin(p.x * 0.05 + s.x * 0.01));
  }
  return h;
}

// The sea lives between y = uTop (swell crests; 0 without them) and
// y = -uSwell (troughs).
float heightAt(vec2 p, int count) {
  return (waves(p, count) - 1.0) * uSwell + swells(p);
}

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 normalAt(vec2 p, float dist) {
  // Wider differences further away, so distant water doesn't sparkle
  // with detail smaller than a pixel.
  float e = NORMAL_E + dist * NORMAL_E * 0.125;
  float h = heightAt(p, DETAIL_WAVES);
  float hx = heightAt(p + vec2(e, 0.0), DETAIL_WAVES);
  float hz = heightAt(p + vec2(0.0, e), DETAIL_WAVES);
  vec3 n = normalize(vec3(h - hx, e, h - hz));
  return normalize(mix(n, vec3(0.0, 1.0, 0.0), smoothstep(0.0, FAR, dist) * 0.8));
}

// One layer of stars over a grid of sky angles (scale cells per radian
// of longitude and latitude): at most one star per cell, jittered, round,
// a few bright and most faint, blue-white to warm, each twinkling at its
// own rate. Neighbouring cells are checked too, so no star is cut off at
// a cell's edge.
vec3 starLayer(vec3 rd, float scale, float density, float size, float twinkleRate) {
  vec2 angles = vec2(atan(rd.x, -rd.z), asin(clamp(rd.y, -1.0, 1.0))) * scale;
  vec2 cell = floor(angles);
  vec3 total = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 c = cell + vec2(float(x), float(y));
      float seed = hash21(c + scale);
      if (seed > density) continue;
      vec2 at = (c + 0.5 + (vec2(hash21(c + 3.1), hash21(c + 5.7)) - 0.5) * 0.8) / scale;
      vec3 star = vec3(sin(at.x) * cos(at.y), sin(at.y), -cos(at.x) * cos(at.y));
      float d = length(rd - star) * scale;
      float core = exp(-d * d / (size * size));
      float bright = 0.12 + pow(hash21(c + 11.0), 7.0) * 3.5;
      float temp = hash21(c + 21.0);
      vec3 tint = mix(vec3(0.68, 0.78, 1.0), vec3(1.0, 0.86, 0.66), temp * temp);
      // Twinkle, harder with the hi-hats.
      float twinkle = 1.0 - (0.25 + 0.45 * uSparkle) * (0.5 + 0.5 * sin(uClock * twinkleRate * (0.6 + temp) + seed * 60.0));
      total += tint * core * bright * twinkle;
    }
  }
  return total;
}

// Milky Way: a soft, mottled band arching across the sky.
const vec3 GALAXY_POLE = vec3(0.42, 0.55, 0.72);
float galaxy(vec3 rd) {
  vec3 pole = normalize(GALAXY_POLE);
  float across = dot(rd, pole);
  float band = exp(-across * across / 0.03);
  vec3 a = normalize(cross(pole, vec3(0.0, 1.0, 0.0)));
  vec3 b = cross(pole, a);
  vec2 m = vec2(dot(rd, a), dot(rd, b)) * 5.0;
  float dust = fbm(m + across * 3.0);
  // A dark lane down the middle, as in the real one.
  float lane = 1.0 - 0.6 * exp(-pow((across + (dust - 0.5) * 0.08) / 0.035, 2.0));
  return band * smoothstep(0.3, 0.8, dust) * lane;
}

// starGain scales the stars (and shooting stars): 1 in the sky, less in
// the water's reflection.
vec3 sky(vec3 rd, vec3 ro, bool clouds, float starGain) {
  float y = max(rd.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(y, 0.5));
  float s = max(dot(rd, uSunDir), 0.0);
  // Wide haze round the sun, a tighter glow, then the disc itself.
  col += uSunColor * (pow(s, 8.0) * 0.12 + pow(s, 120.0) * 0.25) * uSunBoost;
  col += uSunColor * smoothstep(uSunSize, uSunSize + 0.00025, s) * uDisc * uSunBoost;

  if (uStars > 0.0 && rd.y > 0.0) {
    // Thinned out low down, where there's more air to look through.
    float clear = smoothstep(0.0, 0.3, rd.y) * uStars * starGain;
    float milky = galaxy(rd);
    vec3 stars = starLayer(rd, 160.0, 0.011, 0.22, 3.0);
    stars += starLayer(rd, 360.0, 0.0125 + milky * 0.0375, 0.45, 5.0) * (0.3 + milky * 0.6);
    col += stars * clear;
    col += vec3(0.05, 0.055, 0.08) * milky * clear;

    // A shooting star: a short bright streak with a fading tail.
    if (uMeteorAge >= 0.0 && uMeteorAge < 1.0) {
      vec3 head = normalize(mix(uMeteorFrom, uMeteorTo, uMeteorAge));
      vec3 tail = normalize(mix(uMeteorFrom, uMeteorTo, max(0.0, uMeteorAge - 0.3)));
      vec3 seg = head - tail;
      float along = clamp(dot(rd - tail, seg) / max(dot(seg, seg), 1e-6), 0.0, 1.0);
      float d = length(rd - (tail + seg * along));
      float streak = exp(-d * d / 2e-6) * along * along * (1.0 - uMeteorAge);
      col += vec3(0.9, 0.95, 1.0) * streak * 4.0 * clear;
    }
  }

  if (clouds && rd.y > 0.0) {
    // A cloud layer 600 units up, so it slides past as the camera travels.
    vec2 uv = (ro.xz + rd.xz * (600.0 / (rd.y + 0.04))) * 0.0018;
    uv += vec2(uTime * 0.004, uTime * 0.002);
    float n = fbm(uv);
    // Thinner towards the sun means lit: compare with a sample nudged
    // that way, for a cheap sense of shape.
    float toward = fbm(uv + uSunDir.xz * 0.04);
    float lit = clamp((n - toward) * 5.0 + 0.5, 0.0, 1.0);
    float cover = smoothstep(uCloudCover, uCloudCover + 0.34, n) * smoothstep(0.0, 0.12, rd.y);
    vec3 cloud = mix(uCloudShade, uCloudLit, lit * (0.35 + 0.4 * pow(s, 2.0)) + 0.1);
    // Silver lining where thin cloud crosses the sun.
    cloud += uSunColor * pow(s, 24.0) * (1.0 - cover) * 0.5;
    col = mix(col, cloud, cover * 0.92);
  }
  return col;
}

// Marches down to the surface. Steps by the vertical gap to the water,
// which is always safe on the way down and closes in fast; then (REFINE)
// bisects the last step for a clean edge on the crests.
float march(vec3 ro, vec3 rd) {
  float tTop = ro.y > uTop ? (uTop - ro.y) / rd.y : 0.0;
  float tEnd = min((-uSwell - ro.y) / rd.y, FAR);
  if (tTop >= FAR) return FAR;
  float t = tTop;
  float prev = t;
  for (int i = 0; i < MARCH_STEPS; i++) {
    vec3 p = ro + rd * t;
    float gap = p.y - heightAt(p.xz, MARCH_WAVES);
    if (gap < 0.002 * t) break;
    prev = t;
    t += gap * 0.65;
    if (t >= tEnd) return tEnd;
  }
  float lo = prev;
  float hi = t;
  for (int i = 0; i < REFINE; i++) {
    float mid = (lo + hi) * 0.5;
    vec3 p = ro + rd * mid;
    if (p.y > heightAt(p.xz, MARCH_WAVES)) lo = mid;
    else hi = mid;
  }
  return REFINE > 0 ? hi : t;
}

vec3 water(vec3 p, vec3 n, vec3 rd, vec3 ro, float dist) {
  float facing = max(dot(n, -rd), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
  vec3 r = reflect(rd, n);
  r.y = abs(r.y);
  vec3 reflected = sky(r, ro, REFLECT_CLOUDS == 1 && dist < 600.0, 0.25);

  // Light through the water: brightest high on a crest, looking towards
  // the sun, where the wave is thin enough to glow. Measured from the
  // waves alone: a kick swell lifts the water but doesn't change its look.
  float crest = clamp(1.0 + (p.y - swells(p.xz)) / uSwell, 0.0, 1.0);
  float through = pow(max(dot(rd, uSunDir), 0.0), 6.0) * 0.5;
  vec3 body = uDeep * (0.5 + 0.5 * max(dot(n, uSunDir), 0.0));
  body += uScatter * pow(crest, 2.5) * (0.35 + 0.9 * through) * uSunBoost;

  // Softened: real water at a glance is less of a mirror than Fresnel
  // alone suggests (spray, foam, haze on the surface).
  vec3 col = mix(body, reflected, fresnel * 0.6);

  // Sun glitter: a hot, tight highlight plus a broader sheen.
  float sr = max(dot(r, uSunDir), 0.0);
  col += uSunColor * (pow(sr, 1400.0) * 8.0 + pow(sr, 160.0) * 0.15) * uGlitter;

  // Glints: single facets catching the light for an instant, scattered
  // along the sun's path — they come and go with the hi-hats.
  vec3 cell = floor(vec3(p.x * 5.0, uClock * 9.0, p.z * 5.0));
  float glint = step(0.993, hash31(cell)) * pow(sr, 24.0) * smoothstep(250.0, 20.0, dist);
  col += uSunColor * glint * uGlints * 1.5;

  // Whitecaps: streaky foam on the highest crests.
  float streaks = fbm(p.xz * vec2(0.35, 0.9) + vec2(0.0, uTime * 0.15));
  float foam = clamp(smoothstep(0.9 - uFoam, 1.0, crest) * smoothstep(0.35, 0.7, streaks), 0.0, 1.0);
  vec3 foamColour = uZenith * 0.6 + uHorizon * 0.5 + uSunColor * 0.35 * max(dot(n, uSunDir), 0.0);
  col = mix(col, foamColour, foam * 0.85);
  // Bioluminescence: at night the broken water glows where it's stirred.
  col += vec3(0.05, 0.75, 0.65) * uBiolum * (foam + smoothstep(0.75, 1.0, crest) * streaks * 0.25);
  return col;
}

void main() {
  vec2 screen = vUv * 2.0 - 1.0;
  vec2 uv = screen;
  uv.x *= uAspect;

  vec3 ro = uCamPos;
  vec3 rd = uCamTurn * normalize(vec3(uv, -${FOCAL.toFixed(2)}));

  // What the air looks like towards the horizon in this direction.
  vec3 haze = sky(normalize(vec3(rd.x, 0.002, rd.z)), ro, false, 1.0);

  vec3 col;
  if (rd.y >= 0.0) {
    col = sky(rd, ro, true, 1.0);
    // Low fog swallows the bottom of the sky too.
    col = mix(col, haze, uSkyFog * exp(-rd.y * 6.0));
  } else {
    float t = march(ro, rd);
    vec3 p = ro + rd * t;
    vec3 n = normalAt(p.xz, t);
    col = water(p, n, rd, ro, t);
    col = mix(col, haze, 1.0 - exp(-t * uFog));
  }

  // Film looks, graded on luminance before the shell's tone mapping.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float grain = hash21(vUv * 913.0 + fract(uClock * 7.13) * 101.0) - 0.5;
  if (uGrade == 1) {
    col = lum * vec3(1.18, 0.9, 0.6) * (1.0 + grain * 0.12);
  } else if (uGrade == 2) {
    col = vec3(pow(lum, 1.1) * 1.1) * (1.0 + grain * 0.16);
  }
  float vignette = uGrade == 0 ? 0.18 : 0.38;
  col *= 1.0 - vignette * dot(screen, screen) * 0.5;
  gl_FragColor = vec4(col, 1.0);
}
`

type RGB = [number, number, number]

// Everything that makes one sky, all numbers so the Day cycle can blend
// between them.
interface Sky {
  sunDir: RGB
  sunColor: RGB
  sunSize: number // cosine of the disc's radius — closer to 1 is smaller
  disc: number // brightness of the disc itself
  zenith: RGB
  horizon: RGB
  deep: RGB
  scatter: RGB
  cloudLit: RGB
  cloudShade: RGB
  cloudCover: number // fbm threshold — lower is cloudier
  fog: number // haze density over the water
  skyFog: number // how far the haze climbs the sky
  stars: number
  biolum: number // glowing foam, flared by kicks
}

// Linear-light colours (the shell tone maps), so they run past 1.
const SKIES: Record<string, Sky> = {
  sunset: {
    sunDir: [0.05, 0.05, -1],
    sunColor: [1.1, 0.52, 0.22],
    sunSize: 0.99965,
    disc: 7,
    zenith: [0.06, 0.1, 0.22],
    horizon: [0.55, 0.25, 0.13],
    deep: [0.006, 0.02, 0.035],
    scatter: [0.04, 0.16, 0.14],
    cloudLit: [0.95, 0.42, 0.22],
    cloudShade: [0.18, 0.12, 0.18],
    cloudCover: 0.48,
    fog: 0.0016,
    skyFog: 0,
    stars: 0,
    biolum: 0,
  },
  morning: {
    sunDir: [-0.55, 0.14, -1],
    sunColor: [1.05, 0.75, 0.5],
    sunSize: 0.9997,
    disc: 6,
    zenith: [0.16, 0.26, 0.48],
    horizon: [0.62, 0.48, 0.42],
    deep: [0.004, 0.03, 0.05],
    scatter: [0.03, 0.2, 0.2],
    cloudLit: [0.95, 0.72, 0.62],
    cloudShade: [0.42, 0.38, 0.48],
    cloudCover: 0.55,
    fog: 0.004,
    skyFog: 0.35,
    stars: 0,
    biolum: 0,
  },
  day: {
    sunDir: [0.3, 0.42, -1],
    sunColor: [1.1, 1.02, 0.9],
    sunSize: 0.99975,
    disc: 7,
    zenith: [0.12, 0.3, 0.7],
    horizon: [0.45, 0.56, 0.7],
    deep: [0.0, 0.04, 0.08],
    scatter: [0.0, 0.22, 0.26],
    cloudLit: [1.0, 1.0, 1.0],
    cloudShade: [0.5, 0.56, 0.66],
    cloudCover: 0.5,
    fog: 0.0012,
    skyFog: 0,
    stars: 0,
    biolum: 0,
  },
  fog: {
    // A pale sun through the murk, the sea fading out within a few waves.
    sunDir: [0.15, 0.22, -1],
    sunColor: [0.5, 0.48, 0.44],
    sunSize: 0.9992,
    disc: 1.5,
    zenith: [0.36, 0.4, 0.44],
    horizon: [0.46, 0.48, 0.5],
    deep: [0.01, 0.025, 0.03],
    scatter: [0.02, 0.08, 0.08],
    cloudLit: [0.7, 0.72, 0.74],
    cloudShade: [0.45, 0.48, 0.52],
    cloudCover: 0.3,
    fog: 0.022,
    skyFog: 0.95,
    stars: 0,
    biolum: 0,
  },
  nighttime: {
    // Night, clear: big moon, its path across the water, stars and the
    // Milky Way, shooting stars, and glowing foam.
    sunDir: [0.1, 0.2, -1],
    sunColor: [0.55, 0.62, 0.8],
    sunSize: 0.9993,
    disc: 5,
    zenith: [0.003, 0.006, 0.02],
    horizon: [0.02, 0.035, 0.07],
    deep: [0.001, 0.004, 0.009],
    scatter: [0.0, 0.03, 0.045],
    cloudLit: [0.3, 0.33, 0.42],
    cloudShade: [0.02, 0.025, 0.04],
    cloudCover: 0.62,
    fog: 0.0014,
    skyFog: 0,
    stars: 1.2,
    biolum: 0.5,
  },
}

// Day cycle: each sky holds for a while, then blends into the next.
const CYCLE = ['morning', 'day', 'sunset', 'nighttime']
const CYCLE_HOLD = 60 // seconds
const CYCLE_BLEND = 30

function mixSky(a: Sky, b: Sky, f: number, into: Sky): Sky {
  for (const key of Object.keys(a) as Array<keyof Sky>) {
    const va = a[key]
    const vb = b[key]
    if (Array.isArray(va) && Array.isArray(vb)) {
      const out = into[key] as RGB
      for (let i = 0; i < 3; i++) out[i] = va[i] + (vb[i] - va[i]) * f
    } else {
      ;(into[key] as number) = (va as number) + ((vb as number) - (va as number)) * f
    }
  }
  return into
}

const GRADES: Record<string, number> = { colour: 0, sepia: 1, mono: 2 }

// Shader defines per quality level (the Visualizer's global setting).
const QUALITY: Record<VisualizerQuality, Record<string, number | string>> = {
  high: { MARCH_STEPS: 64, MARCH_WAVES: 10, DETAIL_WAVES: 28, REFLECT_CLOUDS: 1, REFINE: 0, NORMAL_E: '0.02' },
  hd: { MARCH_STEPS: 120, MARCH_WAVES: 14, DETAIL_WAVES: 44, REFLECT_CLOUDS: 1, REFINE: 6, NORMAL_E: '0.008' },
  low: { MARCH_STEPS: 36, MARCH_WAVES: 7, DETAIL_WAVES: 16, REFLECT_CLOUDS: 0, REFINE: 0, NORMAL_E: '0.03' },
}

const OPTIONS: ThemeOption[] = [
  {
    id: 'sky',
    name: 'Sky',
    values: [
      { id: 'sunset', name: 'Sunset' },
      { id: 'morning', name: 'Morning' },
      { id: 'day', name: 'Day' },
      { id: 'fog', name: 'Fog' },
      { id: 'nighttime', name: 'Night' },
      { id: 'cycle', name: 'Day cycle' },
    ],
  },
  {
    id: 'film',
    name: 'Film',
    values: [
      { id: 'colour', name: 'Colour' },
      { id: 'sepia', name: 'Sepia' },
      { id: 'mono', name: 'Black & white' },
    ],
  },
]

// The shader's waves() in JS, for the camera and the spray.
function seaWaves(px: number, pz: number, count: number, time: number, chop: number): number {
  let freq = 0.18
  let amp = 1
  let sum = 0
  let total = 0
  for (let i = 0; i < count; i++) {
    const angle = 0.35 + Math.sin(i * 2.17) * 1.25
    const dx = Math.sin(angle)
    const dz = -Math.cos(angle)
    const x = (dx * px + dz * pz) * freq + time * Math.sqrt(9.8 * freq)
    const w = Math.exp(Math.sin(x) - 1)
    const drag = ((w * Math.cos(x) * amp * chop) / freq) * 0.18
    px -= dx * drag
    pz -= dz * drag
    sum += w * amp
    total += amp
    amp *= 0.8
    freq *= 1.19
  }
  return sum / total
}

interface Swell {
  z: number
  peak: number
  age: number
  height: number
}

const SPRAY_COUNT = 700
const SPRAY_LIFE = 1.3 // seconds

function create(): ThemeInstance {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2 * Math.atan(1 / FOCAL)), 1, 0.1, 3000)
  camera.rotation.order = 'YXZ'

  const swellUniforms = Array.from({ length: MAX_SWELLS }, () => new THREE.Vector4())
  const uniforms = {
    uAspect: { value: 1 },
    uTime: { value: 0 },
    uClock: { value: 0 },
    uCamPos: { value: camera.position },
    uCamTurn: { value: new THREE.Matrix3() },
    uSwell: { value: 1.4 },
    uChop: { value: 0.3 },
    uSwells: { value: swellUniforms },
    uTop: { value: 0 },
    uGlitter: { value: 1 },
    uGlints: { value: 0 },
    uFoam: { value: 0.1 },
    uSunBoost: { value: 1 },
    uStars: { value: 0 },
    uSparkle: { value: 0 },
    uMeteorFrom: { value: new THREE.Vector3() },
    uMeteorTo: { value: new THREE.Vector3() },
    uMeteorAge: { value: -1 },
    uBiolum: { value: 0 },
    uSunSize: { value: 0.9997 },
    uDisc: { value: 18 },
    uCloudCover: { value: 0.48 },
    uFog: { value: 0.0016 },
    uSkyFog: { value: 0 },
    uGrade: { value: 0 },
    uSunDir: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color() },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uDeep: { value: new THREE.Color() },
    uScatter: { value: new THREE.Color() },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
  }
  const seaMaterial = new THREE.ShaderMaterial({
    uniforms,
    defines: { ...QUALITY.high },
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  })
  const sea = createFullscreenQuad(seaMaterial)
  sea.renderOrder = -1 // the backdrop; the spray draws over it
  scene.add(sea)

  // --- Spray -------------------------------------------------------------------
  const sprayPositions = new Float32Array(SPRAY_COUNT * 3).fill(-1e4)
  const sprayColours = new Float32Array(SPRAY_COUNT * 3)
  const sprayVelocity = new Float32Array(SPRAY_COUNT * 3)
  const sprayLife = new Float32Array(SPRAY_COUNT)
  let sprayNext = 0
  const sprayGeometry = new THREE.BufferGeometry()
  sprayGeometry.setAttribute('position', new THREE.BufferAttribute(sprayPositions, 3))
  sprayGeometry.setAttribute('color', new THREE.BufferAttribute(sprayColours, 3))
  const spray = new THREE.Points(
    sprayGeometry,
    new THREE.PointsMaterial({
      size: 0.32,
      map: createDotTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  spray.frustumCulled = false
  scene.add(spray)

  function emitSpray(x: number, y: number, z: number, count: number, power: number): void {
    for (let n = 0; n < count; n++) {
      const i = sprayNext
      sprayNext = (sprayNext + 1) % SPRAY_COUNT
      sprayPositions[i * 3] = x + (Math.random() - 0.5) * 1.6
      sprayPositions[i * 3 + 1] = y
      sprayPositions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.8
      // Thrown up, and blown back towards the camera and to the side.
      sprayVelocity[i * 3] = 1.2 + (Math.random() - 0.5) * 2
      sprayVelocity[i * 3 + 1] = (1.5 + Math.random() * 3) * power
      sprayVelocity[i * 3 + 2] = 1 + Math.random() * 2
      sprayLife[i] = 1
    }
  }

  // --- Sky ---------------------------------------------------------------------
  let skyId = 'sunset'
  const blended: Sky = structuredClone(SKIES.sunset)
  let sky: Sky = SKIES.sunset
  let cycleClock = 0

  function applySky(s: Sky): void {
    sky = s
    uniforms.uSunDir.value.set(...s.sunDir).normalize()
    uniforms.uSunColor.value.setRGB(...s.sunColor)
    uniforms.uSunSize.value = s.sunSize
    uniforms.uDisc.value = s.disc
    uniforms.uZenith.value.setRGB(...s.zenith)
    uniforms.uHorizon.value.setRGB(...s.horizon)
    uniforms.uDeep.value.setRGB(...s.deep)
    uniforms.uScatter.value.setRGB(...s.scatter)
    uniforms.uCloudLit.value.setRGB(...s.cloudLit)
    uniforms.uCloudShade.value.setRGB(...s.cloudShade)
    uniforms.uCloudCover.value = s.cloudCover
    uniforms.uSkyFog.value = s.skyFog
    uniforms.uStars.value = s.stars
  }

  function setSky(id: string): void {
    skyId = id === 'cycle' || SKIES[id] ? id : 'sunset'
    if (skyId !== 'cycle') applySky(SKIES[skyId])
  }

  function advanceCycle(dt: number): void {
    cycleClock += dt
    const span = CYCLE_HOLD + CYCLE_BLEND
    const index = Math.floor(cycleClock / span) % CYCLE.length
    const into = (cycleClock % span) - CYCLE_HOLD
    const f = into > 0 ? THREE.MathUtils.smoothstep(into / CYCLE_BLEND, 0, 1) : 0
    applySky(mixSky(SKIES[CYCLE[index]], SKIES[CYCLE[(index + 1) % CYCLE.length]], f, blended))
  }

  // The spray isn't drawn by the shader, so it's graded here.
  let grade = 0
  const scratch = new THREE.Color()
  function graded(colour: THREE.Color): THREE.Color {
    if (grade === 0) return colour
    const lum = colour.r * 0.2126 + colour.g * 0.7152 + colour.b * 0.0722
    return grade === 1 ? colour.setRGB(lum * 1.18, lum * 0.9, lum * 0.6) : colour.setRGB(lum, lum, lum)
  }

  // The sea's state eases after the music rather than following it beat
  // by beat — real swells take seconds to build and settle.
  let swell = 0
  let chop = 0
  let foam = 0
  let meteor = 1 // 0..1 through a shooting star's flight; 1 = none
  let glow = 0
  let loud = 0
  let travel = 0
  let camY = 3
  let lastSwell = -Infinity
  const swellList: Swell[] = []

  setSky('sunset')

  function swellHeight(x: number, z: number): number {
    let h = 0
    for (const s of swellList) {
      const d = (z - s.z) / SWELL_WIDTH
      h += s.height * Math.exp(-d * d) * (0.85 + 0.15 * Math.sin(x * 0.05 + s.z * 0.01))
    }
    return h
  }

  function seaHeight(x: number, z: number): number {
    const u = uniforms
    return (seaWaves(x, z, 6, u.uTime.value, u.uChop.value) - 1) * u.uSwell.value + swellHeight(x, z)
  }

  function update(frame: AudioFrame): number {
    const { t, dt, bass, mid, high, energy, beat, flash } = frame
    uniforms.uAspect.value = camera.aspect
    uniforms.uClock.value = t % 1000
    if (skyId === 'cycle') advanceCycle(dt)

    swell = follow(swell, bass, 0.03, 0.01, dt)
    chop = follow(chop, mid, 0.05, 0.015, dt)
    foam = follow(foam, high * 0.6 + bass * 0.4, 0.1, 0.03, dt)
    loud = follow(loud, THREE.MathUtils.smoothstep(energy, 0.3, 0.65), 0.02, 0.008, dt)

    // Integrated, so the music changing never jumps the waves.
    uniforms.uTime.value += dt * (0.75 + energy * 0.9)
    travel += dt * (3 + energy * 7)
    uniforms.uSwell.value = 1.1 + swell * 2.6
    uniforms.uChop.value = 0.22 + chop * 0.5
    uniforms.uFoam.value = 0.05 + foam * 0.45 + flash * 0.08
    uniforms.uGlitter.value = 0.6 + high * 0.6 + flash * 0.25
    uniforms.uGlints.value = high * 1.5 + flash * 0.5
    uniforms.uSunBoost.value = 1 + bass * 0.1 + flash * 0.2
    // Fog breathes: it thins a little when the music swells.
    uniforms.uFog.value = sky.fog * (1.15 - energy * 0.4)

    glow = follow(glow, high * 0.7 + flash, 0.4, 0.04, dt)
    uniforms.uBiolum.value = sky.biolum * (0.3 + glow * 1.6)

    // Clear nights: stars twinkle with the hi-hats, and now and then a big
    // kick sends a shooting star across.
    uniforms.uSparkle.value = Math.min(1, high * 1.6)
    if (meteor >= 1 && sky.stars > 0.5 && beat && bass > 0.5 && Math.random() < 0.3) {
      meteor = 0
      const side = Math.random() < 0.5 ? -1 : 1
      const from = uniforms.uMeteorFrom.value.set(-side * (0.1 + Math.random() * 0.5), 0.35 + Math.random() * 0.3, -1).normalize()
      uniforms.uMeteorTo.value.set(from.x + side * (0.2 + Math.random() * 0.2), from.y - 0.12 - Math.random() * 0.1, from.z).normalize()
    }
    meteor = Math.min(1, meteor + dt / 0.8)
    uniforms.uMeteorAge.value = meteor < 1 ? meteor : -1

    // Kick swells: a big kick sends a ridge of water rolling in from
    // ahead; it builds, passes under the camera and dies away behind.
    const camZ = -travel
    if (beat && bass > 0.45 && swellList.length < MAX_SWELLS && t - lastSwell > 1.5) {
      lastSwell = t
      swellList.push({ z: camZ - 160, peak: 0.5 + bass * 1.6 + swell * 0.6, age: 0, height: 0 })
    }
    for (let i = swellList.length - 1; i >= 0; i--) {
      const s = swellList[i]
      s.age += dt
      s.z += SWELL_SPEED * dt
      const behind = Math.max(0, s.z - camZ) / 40
      s.height = s.peak * THREE.MathUtils.smoothstep(s.age, 0, 2.5) * Math.max(0, 1 - behind)
      if (behind >= 1) swellList.splice(i, 1)
    }
    let top = 0
    for (let i = 0; i < MAX_SWELLS; i++) {
      const s = swellList[i]
      swellUniforms[i].set(s ? s.z : 0, s ? s.height : 0, 0, 0)
      if (s) top += s.height
    }
    uniforms.uTop.value = top

    // The camera rides the swell; in loud passages it sits lower and
    // follows the water more closely, down into the troughs.
    const under = seaHeight(0, camZ)
    const followAmount = 0.5 + loud * 0.4
    const clearance = 2.4 + uniforms.uSwell.value * 0.35 - loud * 0.9
    const wantY = under * followAmount + clearance
    const lastY = camY
    camY += (wantY - camY) * (1 - Math.exp(-dt * 5))
    camY = Math.max(camY, under + 0.8)
    const climb = dt > 0 ? (camY - lastY) / dt : 0
    camera.position.set(0, camY, camZ)
    // A slow look around, leaning with the swell, nose up as it climbs.
    camera.rotation.set(
      -0.04 + Math.sin(t * 0.21) * 0.02 + THREE.MathUtils.clamp(climb * 0.03, -0.06, 0.06) - flash * 0.01,
      Math.sin(t * 0.05) * 0.18,
      Math.sin(t * 0.37) * (0.02 + swell * 0.04 + loud * 0.03),
    )
    camera.updateMatrixWorld()
    uniforms.uCamTurn.value.setFromMatrix4(camera.matrixWorld)

    // Spray: off the crests just ahead, more of it the louder and
    // windier it gets.
    const sprayColour = graded(
      scratch.setRGB(
        sky.zenith[0] * 0.6 + sky.horizon[0] * 0.6 + sky.sunColor[0] * 0.25,
        sky.zenith[1] * 0.6 + sky.horizon[1] * 0.6 + sky.sunColor[1] * 0.25,
        sky.zenith[2] * 0.6 + sky.horizon[2] * 0.6 + sky.sunColor[2] * 0.25,
      ),
    )
    // Spots tried per second; only the ones on a high crest throw spray.
    const rate = (4 + foam * 20 + loud * 40) * dt
    const tries = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0)
    for (let n = 0; n < tries; n++) {
      const x = (Math.random() - 0.5) * 40
      const z = camZ - 6 - Math.random() * 40
      const h = seaHeight(x, z)
      const crest = 1 + (h - swellHeight(x, z)) / uniforms.uSwell.value
      if (crest > 0.86) emitSpray(x, h, z, 6 + Math.round(loud * 14), 0.6 + loud)
    }
    for (let i = 0; i < SPRAY_COUNT; i++) {
      if (sprayLife[i] <= 0) continue
      sprayLife[i] -= dt / SPRAY_LIFE
      if (sprayLife[i] <= 0) {
        sprayPositions[i * 3 + 1] = -1e4
        continue
      }
      sprayVelocity[i * 3 + 1] -= 9.8 * dt
      sprayPositions[i * 3] += sprayVelocity[i * 3] * dt
      sprayPositions[i * 3 + 1] += sprayVelocity[i * 3 + 1] * dt
      sprayPositions[i * 3 + 2] += sprayVelocity[i * 3 + 2] * dt
      const fade = sprayLife[i] * 0.55
      sprayColours[i * 3] = sprayColour.r * fade
      sprayColours[i * 3 + 1] = sprayColour.g * fade
      sprayColours[i * 3 + 2] = sprayColour.b * fade
    }
    sprayGeometry.attributes.position.needsUpdate = true
    sprayGeometry.attributes.color.needsUpdate = true

    // Kept low: the sky is bright enough to clear the bloom threshold everywhere.
    return 0.06 + bass * 0.05 + flash * 0.1 + uniforms.uBiolum.value * 0.3
  }

  return {
    scene,
    camera,
    update,
    toneMapping: THREE.ACESFilmicToneMapping,
    dispose: () => disposeScene(scene),
    setOption: (optionId, valueId) => {
      if (optionId === 'sky') setSky(valueId)
      if (optionId === 'film') grade = uniforms.uGrade.value = GRADES[valueId] ?? 0
    },
    setQuality: (quality) => {
      const defines = QUALITY[quality]
      // Only recompile on a real change.
      if (seaMaterial.defines.MARCH_STEPS !== defines.MARCH_STEPS) {
        seaMaterial.defines = { ...defines }
        seaMaterial.needsUpdate = true
      }
    },
  }
}

export const oceanTheme: VisualizerTheme = { id: 'ocean', name: 'Ocean', create, options: OPTIONS }
