import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { AudioFrame } from '../types'

// Bare human arms and legs for the Mais Baixo stack, and a dance to drive
// them — the same figure as the player character in the Mais Baixo museum
// and runner games (maisbaixo: shared/js/character.js, anatomy.js), here
// dancing to the music instead of walking.
//
// The figure is built in the game's units (a 1.25m-tall body on 0.98m
// legs) and scaled up as a whole to fit whatever stack it's given.

const BODY_H = 1.25
const THIGH = 0.44
const SHIN = 0.42
const HIP = THIGH + SHIN + 0.12
const SKIN = 0xc98f6b

// --- Anatomy -----------------------------------------------------------------
// Angles go round the bone: 0 = front (+Z), PI/2 = +X, PI = back.

const bump = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2))
const facing = (a: number, a0: number, sharp = 1) => Math.max(0, Math.cos(a - a0)) ** sharp
const lerp = THREE.MathUtils.lerp
const smooth = (t: number) => t * t * (3 - 2 * t)

// Sweeps a tube down -Y from its joint. radius(t, a) is the skin's distance
// from the bone at height t (0 = joint, 1 = end) and angle a, so muscles
// can bulge on one side only. Ends stay open: they're tucked inside the
// body, a joint or a hand/foot.
function sweep(len: number, radius: (t: number, a: number) => number, rings = 32, segs = 28): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= rings; i++) {
    const t = i / rings
    for (let j = 0; j <= segs; j++) {
      const a = Math.PI + (j / segs) * Math.PI * 2 // seam at the back
      const r = radius(t, a)
      pos.push(Math.sin(a) * r, -t * len, Math.cos(a) * r)
      uv.push(j / segs, 1 - t)
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j
      const b = a + segs + 1
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function skinMesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.castShadow = true
  return m
}

function ball(r: number, mat: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const m = skinMesh(new THREE.SphereGeometry(r, 18, 14), mat)
  m.position.set(x, y, z)
  m.scale.set(sx, sy, sz)
  return m
}

// A finger as a chain of phalanges, each curled a little further.
function finger(
  mat: THREE.Material,
  lengths: number[],
  r: number,
  curl: number,
  x: number,
  y: number,
  z: number,
  baseRot: [number, number, number],
): THREE.Group {
  const root = new THREE.Group()
  root.position.set(x, y, z)
  root.rotation.set(...baseRot)
  let parent: THREE.Object3D = root
  lengths.forEach((len, i) => {
    const joint = new THREE.Group()
    if (i > 0) {
      joint.position.y = -lengths[i - 1]
      joint.rotation.z = curl
    }
    const rr = r * (1 - i * 0.12)
    const seg = skinMesh(new THREE.CapsuleGeometry(rr, Math.max(0.001, len - rr), 4, 10), mat)
    seg.position.y = -len / 2
    seg.scale.z = 0.9
    joint.add(seg)
    parent.add(joint)
    parent = joint
  })
  return root
}

interface Leg {
  hip: THREE.Group
  knee: THREE.Group
  ankle: THREE.Group
  side: number
}

interface Arm {
  shoulder: THREE.Group
  elbow: THREE.Group
  hand: THREE.Group
  side: number
}

function buildLeg(side: number, skin: THREE.Material): Leg {
  const inA = side < 0 ? Math.PI / 2 : -Math.PI / 2 // towards the other leg
  const hip = new THREE.Group()

  const thigh = sweep(THIGH + 0.03, (t, a) => {
    let r = lerp(0.116, 0.06, Math.pow(t, 1.15))
    r += 0.022 * bump(t, 0.38, 0.26) * facing(a, 0, 1.6) // quadriceps
    r += 0.02 * bump(t, 0.16, 0.2) * facing(a, inA, 2) // adductors
    r += 0.014 * bump(t, 0.42, 0.3) * facing(a, Math.PI, 2) // hamstrings
    r += 0.012 * bump(t, 0.84, 0.08) * facing(a, inA * 0.6, 3) // vastus medialis
    r += 0.008 * bump(t, 0.45, 0.35) * facing(a, -inA, 2) // outer sweep
    return r
  })
  hip.add(skinMesh(thigh, skin))

  const knee = new THREE.Group()
  knee.position.y = -THIGH
  knee.add(ball(0.056, skin), ball(0.034, skin, 0, -0.012, 0.03, 1, 1.15, 0.7))
  const calf = sweep(SHIN + 0.02, (t, a) => {
    let r = lerp(0.057, 0.034, smooth(Math.min(1, t * 1.15)))
    r *= 1 - 0.1 * facing(a, 0, 4) // flat shin bone at the front
    r += 0.03 * bump(t, 0.27, 0.16) * facing(a, Math.PI, 1.3) // gastrocnemius
    r += 0.008 * bump(t, 0.26, 0.14) * facing(a, Math.PI + inA * 0.5, 3) // inner head
    r += 0.01 * bump(t, 0.5, 0.25) * facing(a, -inA, 2) // soleus / peroneals
    r += 0.011 * bump(t, 0.97, 0.035) * (facing(a, Math.PI / 2, 6) + facing(a, -Math.PI / 2, 6)) // ankle bones
    return r
  })
  knee.add(skinMesh(calf, skin))
  hip.add(knee)

  const ankle = new THREE.Group()
  ankle.position.y = -SHIN
  knee.add(ankle)

  // Foot, swept heel → toes, then laid flat pointing +Z.
  const FOOT = 0.25
  const foot = sweep(
    FOOT,
    (t, a) => {
      const w = lerp(0.034, 0.047, smooth(Math.min(1, t / 0.72))) * (t > 0.8 ? lerp(1, 0.55, (t - 0.8) / 0.2) : 1)
      let h = t < 0.35 ? lerp(0.036, 0.044, t / 0.35) : lerp(0.044, 0.014, smooth((t - 0.35) / 0.65))
      h *= Math.cos(a) < 0 ? 0.72 : 1 // flatter sole
      const c = Math.cos(a)
      const s = Math.sin(a)
      return 1 / Math.sqrt((c / h) ** 2 + (s / w) ** 2)
    },
    24,
    24,
  )
  foot.rotateX(-Math.PI / 2) // -Y axis → +Z, front (+Z) → top of foot
  const footMesh = skinMesh(foot, skin)
  footMesh.position.set(inA > 0 ? 0.004 : -0.004, -0.088, -0.055)
  footMesh.rotation.x = 0.07
  ankle.add(footMesh, ball(0.032, skin, 0, -0.035, -0.004, 1, 1.2, 1.15))
  ankle.add(ball(0.037, skin, 0, -0.088, -0.05, 1, 0.95, 1.05)) // heel
  // Toes, big toe on the inside.
  const inner = side < 0 ? 1 : -1
  ;[0.016, 0.0115, 0.0105, 0.0098, 0.0088].forEach((r, i) => {
    ankle.add(ball(r, skin, inner * (0.03 - i * 0.017), -0.11 + i * 0.001, 0.185 - i * i * 0.004, 1, 0.8, 1.3))
  })

  hip.position.set(0, HIP - 0.01, 0)
  return { hip, knee, ankle, side }
}

function buildArm(side: number, skin: THREE.Material): Arm {
  const outA = side < 0 ? -Math.PI / 2 : Math.PI / 2
  const inner = -side
  const shoulder = new THREE.Group()
  shoulder.add(ball(0.082, skin, side * 0.012, 0.0, 0, 1.05, 1, 1)) // deltoid cap

  const upper = sweep(0.43, (t, a) => {
    let r = lerp(0.07, 0.045, t)
    r += 0.026 * bump(t, 0.08, 0.14) * facing(a, outA, 0.8) // deltoid
    r += 0.02 * bump(t, 0.48, 0.2) * facing(a, 0, 1.5) // biceps
    r += 0.017 * bump(t, 0.35, 0.25) * facing(a, Math.PI, 1.4) // triceps
    return r
  })
  shoulder.add(skinMesh(upper, skin))

  const elbow = new THREE.Group()
  elbow.position.y = -0.42
  elbow.add(ball(0.045, skin, 0, 0, -0.008))
  const fore = sweep(0.385, (t, a) => {
    let r = lerp(0.047, 0.028, Math.pow(t, 0.85))
    r += 0.017 * bump(t, 0.2, 0.2) * facing(a, outA * 0.7, 1.2) // brachioradialis
    r += 0.008 * bump(t, 0.25, 0.25) * facing(a, -outA, 2) // flexors
    // Wrist: wide front-to-back (palm faces the body), thin side-to-side.
    r *= 1 - 0.3 * smooth(t) * Math.sin(a) ** 2
    return r
  })
  elbow.add(skinMesh(fore, skin))
  shoulder.add(elbow)

  // Hand: palm faces the body, fingers point down.
  const hand = new THREE.Group()
  hand.position.y = -0.38
  const palm = skinMesh(new RoundedBoxGeometry(0.03, 0.095, 0.078, 3, 0.013), skin)
  palm.position.y = -0.05
  hand.add(palm)
  const curl = inner * 0.22
  const fingers: Array<[number, number[], number]> = [
    [0.028, [0.042, 0.026, 0.02], 0.0092],
    [0.009, [0.047, 0.029, 0.021], 0.0095],
    [-0.01, [0.044, 0.027, 0.02], 0.009],
    [-0.027, [0.034, 0.021, 0.018], 0.0082],
  ]
  for (const [z, lengths, r] of fingers) hand.add(finger(skin, lengths, r, curl, 0, -0.094, z, [0, 0, curl * 0.5]))
  hand.add(finger(skin, [0.036, 0.028], 0.011, curl * 0.6, inner * 0.01, -0.028, 0.036, [-0.75, 0, inner * 0.35]))
  elbow.add(hand)
  return { shoulder, elbow, hand, side }
}

// --- The dance ---------------------------------------------------------------

// One pose's worth of dance, in the game's units: how far the hips drop,
// how high and far forward each foot comes up, the body's sway / twist /
// lean, and each arm's shoulder (x: forward/back, z: out to the side) and
// elbow bend.
interface Pose {
  dip: number
  lift: [number, number]
  reach: [number, number]
  sway: number
  tilt: number
  twist: number
  lean: number
  armX: [number, number]
  armZ: [number, number]
  elbow: [number, number]
}

function emptyPose(): Pose {
  return { dip: 0, lift: [0, 0], reach: [0, 0], sway: 0, tilt: 0, twist: 0, lean: 0, armX: [0, 0], armZ: [0, 0], elbow: [0, 0] }
}

function addPose(into: Pose, pose: Pose, w: number): void {
  into.dip += pose.dip * w
  into.sway += pose.sway * w
  into.tilt += pose.tilt * w
  into.twist += pose.twist * w
  into.lean += pose.lean * w
  for (let i = 0; i < 2; i++) {
    into.lift[i] += pose.lift[i] * w
    into.reach[i] += pose.reach[i] * w
    into.armX[i] += pose.armX[i] * w
    into.armZ[i] += pose.armZ[i] * w
    into.elbow[i] += pose.elbow[i] * w
  }
}

// `beat` counts beats (an integer on each one), `drive` is how hard to
// dance (0 = barely moving, 1 = going for it), `high` jiggles the hands.
type Move = (beat: number, drive: number, high: number) => Pose

// 0..1, peaking on the beat and easing off between — a knee bounce.
const onBeat = (beat: number) => Math.pow(0.5 + 0.5 * Math.cos(beat * Math.PI * 2), 2)
// -1..1, one way on even beats and the other on odd.
const sideToSide = (beat: number) => Math.sin(beat * Math.PI)

const MOVES: Record<string, Move> = {
  // Knees bouncing on every beat, fists pumping in turn.
  bounce: (beat, drive) => {
    const down = onBeat(beat)
    const alt = sideToSide(beat + 0.5)
    const pose = emptyPose()
    pose.dip = (0.03 + down * 0.09) * drive
    pose.lean = 0.05 + down * 0.06 * drive
    pose.tilt = alt * 0.03 * drive
    for (let i = 0; i < 2; i++) {
      const mine = i ? -alt : alt
      pose.armX[i] = -0.5 - Math.max(0, mine) * 0.9 * drive
      pose.armZ[i] = 0.2
      pose.elbow[i] = -1.5 + Math.max(0, mine) * 0.5 * drive
    }
    return pose
  },
  // The skank: knees up in turn, arms swinging against them, leaning in.
  skank: (beat, drive) => {
    const step = sideToSide(beat)
    const pose = emptyPose()
    pose.dip = (0.04 + onBeat(beat) * 0.05) * drive
    pose.lean = 0.12 * drive
    pose.twist = step * 0.15 * drive
    for (let i = 0; i < 2; i++) {
      const mine = i ? -step : step
      pose.lift[i] = Math.max(0, mine) * 0.16 * drive
      pose.reach[i] = Math.max(0, mine) * 0.1 * drive
      pose.armX[i] = mine * 0.8 * drive
      pose.armZ[i] = 0.25
      pose.elbow[i] = -1.0 - Math.max(0, -mine) * 0.3
    }
    return pose
  },
  // Stepping side to side with the arms out, flicking on the beat.
  sway: (beat, drive) => {
    const side = sideToSide(beat)
    const flick = onBeat(beat)
    const pose = emptyPose()
    pose.dip = (0.02 + flick * 0.05) * drive
    pose.sway = side * 0.09 * drive
    pose.tilt = -side * 0.08 * drive
    for (let i = 0; i < 2; i++) {
      pose.armX[i] = -0.3
      pose.armZ[i] = 0.7 + flick * 0.35 * drive + (i ? side : -side) * 0.2 * drive
      pose.elbow[i] = -0.6 - flick * 0.5 * drive
    }
    return pose
  },
  // Hands in the air, waving with the hi-hats.
  hands: (beat, drive, high) => {
    const down = onBeat(beat)
    const side = sideToSide(beat * 0.5)
    const pose = emptyPose()
    pose.dip = (0.02 + down * 0.07) * drive
    pose.sway = side * 0.05 * drive
    pose.tilt = -side * 0.05 * drive
    pose.lean = -0.04
    for (let i = 0; i < 2; i++) {
      const wave = Math.sin(beat * Math.PI + i * Math.PI) * 0.25
      pose.armX[i] = -0.25
      pose.armZ[i] = 2.6 + wave * drive
      pose.elbow[i] = -0.35 - down * 0.25 * drive - high * 0.2
    }
    return pose
  },
}

// Every 8 beats the next move in this order — hands up only once the
// music's going (see DancerFigure.update).
const ROUTINE = ['bounce', 'skank', 'sway', 'hands']

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt))

export interface DancerFigure {
  // Everything in game units; scale it, and put it where its feet should be.
  root: THREE.Group
  update(frame: AudioFrame): void
}

// Gives `stack` (a stack already standing on y = 0, centred on x/z, front
// to +Z, `height` × `width` in its own units) arms and legs, and returns
// the figure; the stack bobs, sways and twists over the legs as it dances.
export function createDancer(stack: THREE.Object3D, height: number, width: number): DancerFigure {
  const skin = new THREE.MeshPhysicalMaterial({
    color: SKIN,
    roughness: 0.62,
    sheen: 0.35,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0xff9a7a),
  })

  const root = new THREE.Group()
  const body = new THREE.Group()
  body.position.y = HIP
  root.add(body)
  // The stack, shrunk to the body's height; the body pivots at its base.
  const scale = BODY_H / height
  const holder = new THREE.Group()
  holder.scale.setScalar(scale)
  holder.add(stack)
  body.add(holder)
  const bodyW = width * scale

  const legs = [-1, 1].map((side) => {
    const leg = buildLeg(side, skin)
    leg.hip.position.x = side * bodyW * 0.22
    root.add(leg.hip)
    return leg
  })
  const arms = [-1, 1].map((side) => {
    const arm = buildArm(side, skin)
    arm.shoulder.position.set(side * (bodyW / 2 + 0.07), BODY_H * 0.56, 0)
    body.add(arm.shoulder)
    return arm
  })

  // Beat clock: the engine's tempo tracking (frame.beats) — the tempo
  // found in how the music repeats, locked onto where the beats fall — so
  // the dance keeps time through fills and breakdowns where kicks drop out.
  let beat = 0
  let lastBeat = 0
  let lastKick = -Infinity
  let drive = 0
  // Kick and bass punch (see update), and how busy the highs are.
  let pump = 0
  let bassAverage = 0
  let hands = 0
  let tilt = 1
  const weights: Record<string, number> = { bounce: 1, skank: 0, sway: 0, hands: 0 }
  const pose = emptyPose()

  // Planted-foot leg: bends hip, knee and ankle so the ankle lands
  // `drop` below and `forward` in front of the hip, sole kept flat.
  function reach(leg: Leg, drop: number, forward: number, spread: number) {
    const d = THREE.MathUtils.clamp(Math.hypot(drop, forward), 0.2, THIGH + SHIN - 0.0005)
    const knee = Math.PI - Math.acos(THREE.MathUtils.clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1))
    const opening = Math.acos(THREE.MathUtils.clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1))
    const thigh = Math.atan2(forward, drop) + opening
    leg.hip.rotation.x = -thigh
    leg.knee.rotation.x = knee
    leg.ankle.rotation.x = thigh - knee
    leg.hip.rotation.z = spread
  }

  function update(frame: AudioFrame): void {
    const { t, dt, beat: kicked, energy, bass, high } = frame

    if (kicked) lastKick = t
    beat = frame.beats

    // How hard to dance: mostly the bass, with the kicks keeping it up.
    const recent = t - lastKick < 2 ? 1 : 0
    drive = damp(drive, Math.min(1, energy * 0.9 + bass * 1.1) * (0.45 + 0.55 * recent), 2, dt)
    const effort = 0.3 + drive * 0.85 + bass * 0.35

    // Punch: each kick slams it down, louder kicks harder, and bass hits
    // (bass rising above its recent average) push on top — like the cones.
    bassAverage += (bass - bassAverage) * (1 - Math.exp(-dt / 0.6))
    const bassHit = Math.max(0, bass - bassAverage) * 3
    // On each tracked beat (once the tempo is clear) and on every
    // detected kick: the beat lands the punch even where a kick is missed.
    const onTrackedBeat = Math.floor(beat) !== Math.floor(lastBeat) && frame.tempoConfidence > 0.25
    lastBeat = beat
    if (kicked || onTrackedBeat) {
      pump = Math.max(pump, (kicked ? 0.6 : 0.35) + bass * 0.6)
      if (onTrackedBeat) tilt = -tilt
    }
    pump = Math.max(pump * Math.exp(-dt * 7), Math.min(1, bassHit))
    // Hands: busier the more the highs carry.
    hands = damp(hands, Math.min(1, high * 1.8), 6, dt)

    let move = ROUTINE[Math.floor(beat / 8) % ROUTINE.length]
    if (move === 'hands' && drive < 0.4) move = 'bounce'
    for (const id of ROUTINE) weights[id] = damp(weights[id], id === move ? 1 : 0, 4, dt)

    pose.dip = pose.sway = pose.tilt = pose.twist = pose.lean = 0
    for (let i = 0; i < 2; i++) pose.lift[i] = pose.reach[i] = pose.armX[i] = pose.armZ[i] = pose.elbow[i] = 0
    for (const id of ROUTINE) if (weights[id] > 0.001) addPose(pose, MOVES[id](beat, effort, high), weights[id])

    // Kicks and bass on top of the move: down into the knees, a lean in,
    // a tilt that swaps side on each kick, shoulders dropping.
    pose.dip += pump * 0.11
    pose.lean += pump * 0.12
    pose.tilt += tilt * pump * 0.05
    for (let i = 0; i < 2; i++) pose.elbow[i] -= pump * 0.35

    // Busy highs pull the arms up towards hands-in-the-air.
    const up = THREE.MathUtils.smoothstep(hands, 0.35, 0.8) * 0.6
    if (up > 0) {
      const raised = MOVES.hands(beat, effort, high)
      for (let i = 0; i < 2; i++) {
        pose.armX[i] += (raised.armX[i] - pose.armX[i]) * up
        pose.armZ[i] += (raised.armZ[i] - pose.armZ[i]) * up
        pose.elbow[i] += (raised.elbow[i] - pose.elbow[i]) * up
      }
    }

    // Body: drops into the knees and shifts its weight over the legs, and
    // squashes a touch on the punch.
    body.position.set(pose.sway, HIP - pose.dip, 0)
    body.rotation.set(pose.lean, pose.twist, pose.tilt)
    body.scale.set(1 + pump * 0.02, 1 - pump * 0.035, 1 + pump * 0.02)

    legs.forEach((leg, i) => {
      leg.hip.position.set(leg.side * bodyW * 0.22 + pose.sway, HIP - 0.01 - pose.dip, 0)
      // Feet stay put while the hips move over them.
      const drop = THIGH + SHIN - pose.dip - pose.lift[i]
      reach(leg, drop, pose.reach[i], Math.asin(THREE.MathUtils.clamp(-pose.sway / (THIGH + SHIN), -1, 1)))
    })
    arms.forEach((arm, i) => {
      const k = 22
      // Hands work with the highs, in time: arms pumping on the 8ths
      // (opposite arms in turn), forearms on the 16ths, wrists flicking.
      const eighth = Math.sin((beat * 2 + i) * Math.PI)
      const sixteenth = Math.sin((beat * 4 + i * 0.5) * Math.PI)
      const busy = hands * (0.5 + drive * 0.5)
      const armX = pose.armX[i] + eighth * 0.45 * busy
      const armZ = pose.armZ[i] + Math.sin((beat + i * 0.5) * Math.PI) * 0.3 * busy
      arm.shoulder.rotation.x = damp(arm.shoulder.rotation.x, armX, k, dt)
      arm.shoulder.rotation.z = damp(arm.shoulder.rotation.z, arm.side * armZ, k, dt)
      arm.elbow.rotation.x = damp(arm.elbow.rotation.x, pose.elbow[i] - Math.max(0, sixteenth) * 0.6 * busy, k, dt)
      arm.hand.rotation.x = damp(arm.hand.rotation.x, sixteenth * 0.7 * busy, k, dt)
      arm.hand.rotation.z = damp(arm.hand.rotation.z, arm.side * (0.2 + eighth * 0.4) * busy, k, dt)
    })
  }

  return { root, update }
}

// The figure's full height (feet to top of the body), in game units.
export const DANCER_HEIGHT = HIP + BODY_H
