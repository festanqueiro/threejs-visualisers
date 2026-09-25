import * as THREE from 'three'
import { disposeScene } from '../shared'
import type { AudioFrame, ThemeInstance, ThemeOption, VisualizerTheme } from '../types'

// A chonky cat riding a little spaceship through space, seen from behind
// and above. Stars stream past as warp streaks that stretch with the
// energy, planets drift by, the engines flare with the bass and kicks,
// the ship weaves and banks, and the cat bobs its head on the kick,
// twitches its ears on the highs, sways its tail — and every so often
// turns round to look at you.

const STAR_COUNT = 1400
const STAR_FIELD = { x: 60, y: 36, near: 12, far: -220 }
const PLANET_COUNT = 3

const OPTIONS: ThemeOption[] = [
  {
    id: 'cat',
    name: 'Cat',
    values: [
      { id: 'ginger', name: 'Ginger' },
      { id: 'grey', name: 'Grey tabby' },
      { id: 'black', name: 'Black' },
      { id: 'white', name: 'White' },
    ],
  },
]

// Fur base colour, stripe colour (null = plain), and inner-ear/nose pink.
const COATS: Record<string, { fur: string; stripes: string | null; eyes: number }> = {
  ginger: { fur: '#e08a3c', stripes: '#b3601f', eyes: 0x7fd65a },
  grey: { fur: '#8c8f96', stripes: '#55585f', eyes: 0xf2c14e },
  black: { fur: '#26272b', stripes: null, eyes: 0xf2c14e },
  white: { fur: '#eeeae3', stripes: null, eyes: 0x5ab4f0 },
}

// Soft horizontal tabby bands (or plain fur) as a texture, so the cat
// reads as furry rather than plastic.
function furTexture(fur: string, stripes: string | null): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = fur
  ctx.fillRect(0, 0, 256, 256)
  if (stripes) {
    // Sphere UVs run u around, v top to bottom — so stripes are vertical
    // in the texture: they start at the spine and taper down the sides,
    // like a tabby's, rather than ringing the body.
    ctx.fillStyle = stripes
    for (let i = 0; i < 14; i++) {
      const x = i * (256 / 14) + 4
      const length = 110 + (i % 3) * 25
      ctx.beginPath()
      ctx.moveTo(x, 0)
      for (let y = 0; y <= length; y += 12) ctx.lineTo(x + Math.sin(y * 0.05 + i) * 4 + (5 * (1 - y / length)), y)
      for (let y = length; y >= 0; y -= 12) ctx.lineTo(x + Math.sin(y * 0.05 + i) * 4 - (5 * (1 - y / length)), y)
      ctx.closePath()
      ctx.fill()
    }
  }
  // Speckle so plain coats still have some texture.
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.05)`
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function create(): ThemeInstance {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x04050c)
  scene.fog = new THREE.Fog(0x04050c, 60, 210)
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400)

  // --- Lights ---------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0x8fa8ff, 0x201830, 0.9))
  const key = new THREE.DirectionalLight(0xfff1e0, 1.6)
  key.position.set(4, 6, 3)
  scene.add(key)
  const rim = new THREE.PointLight(0x2dd4bf, 6, 12, 1.5)
  rim.position.set(-2, 1.5, -2)
  scene.add(rim)

  // --- Stars: streaks along the direction of travel -------------------
  const starPositions = new Float32Array(STAR_COUNT * 6)
  const starZ = new Float32Array(STAR_COUNT)
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = (Math.random() - 0.5) * STAR_FIELD.x
    const y = (Math.random() - 0.5) * STAR_FIELD.y
    starPositions[i * 6] = starPositions[i * 6 + 3] = x
    starPositions[i * 6 + 1] = starPositions[i * 6 + 4] = y
    starZ[i] = STAR_FIELD.far + Math.random() * (STAR_FIELD.near - STAR_FIELD.far)
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  const starMaterial = new THREE.LineBasicMaterial({
    color: 0xcfe0ff,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const stars = new THREE.LineSegments(starGeometry, starMaterial)
  stars.frustumCulled = false
  scene.add(stars)

  // --- Planets drifting past ------------------------------------------
  const planets: Array<{ group: THREE.Group; speed: number }> = []
  const planetColours = [0xc2703d, 0x6b8fd6, 0xb58bd8, 0x7cc4a0, 0xd6c07a]
  function placePlanet(group: THREE.Group, initial: boolean): void {
    const side = Math.random() < 0.5 ? -1 : 1
    group.position.set(side * (14 + Math.random() * 22), -6 + Math.random() * 16, initial ? -40 - Math.random() * 160 : -200)
    group.rotation.set(Math.random() * 0.6, Math.random() * Math.PI, Math.random() * 0.5)
    const material = (group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
    material.color.setHex(planetColours[Math.floor(Math.random() * planetColours.length)])
    group.scale.setScalar(2 + Math.random() * 5)
    group.children[1].visible = Math.random() < 0.5
  }
  for (let i = 0; i < PLANET_COUNT; i++) {
    const group = new THREE.Group()
    group.add(new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), new THREE.MeshStandardMaterial({ roughness: 0.9 })))
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 2.1, 64),
      new THREE.MeshBasicMaterial({ color: 0x9c8f76, side: THREE.DoubleSide, transparent: true, opacity: 0.3 }),
    )
    ring.rotation.x = Math.PI / 2.3
    group.add(ring)
    placePlanet(group, true)
    scene.add(group)
    planets.push({ group, speed: 0.12 + Math.random() * 0.08 })
  }

  // --- The ship ---------------------------------------------------------
  // Travels along -z; the camera sits behind it (+z), above and to one side.
  const ship = new THREE.Group()
  scene.add(ship)
  const hullMaterial = new THREE.MeshStandardMaterial({ color: 0xdfe4ec, metalness: 0.55, roughness: 0.3 })
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x2dd4bf, metalness: 0.3, roughness: 0.4 })
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.6, roughness: 0.5 })

  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), hullMaterial)
  hull.scale.set(0.95, 0.38, 1.7)
  ship.add(hull)
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), trimMaterial)
  nose.position.set(0, 0.02, -1.62)
  nose.scale.set(1, 0.8, 0.7)
  ship.add(nose)
  const cockpitRim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 12, 40), trimMaterial)
  cockpitRim.rotation.x = Math.PI / 2
  cockpitRim.position.set(0, 0.33, 0.05)
  cockpitRim.scale.set(1, 1.25, 1)
  ship.add(cockpitRim)
  const windshield = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.22, metalness: 0.1, roughness: 0.05 }),
  )
  windshield.position.set(0, 0.33, -0.55)
  windshield.scale.set(0.85, 0.7, 0.45)
  ship.add(windshield)
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.8), hullMaterial)
    wing.position.set(side * 1.2, -0.05, 0.45)
    wing.rotation.z = side * -0.18
    wing.rotation.y = side * 0.35
    ship.add(wing)
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 0.5), trimMaterial)
    tip.position.set(side * 1.82, 0.08, 0.62)
    ship.add(tip)
  }
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xff4d6d, toneMapped: false }),
  )
  beacon.position.set(0, 0.28, -1.72)
  ship.add(beacon)

  // Engines face the camera, so their exhaust is the brightest thing on screen.
  const flames: THREE.Mesh[] = []
  const flameMaterial = new THREE.MeshBasicMaterial({
    color: 0x7fe9ff,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
  for (const side of [-1, 1]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.45, 20, 1, true), darkMaterial)
    nozzle.rotation.x = Math.PI / 2
    nozzle.position.set(side * 0.5, -0.02, 1.62)
    ship.add(nozzle)
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.19, 20), flameMaterial)
    glow.position.set(side * 0.5, -0.02, 1.84)
    ship.add(glow)
    // Cone pointing back (+z); scaled along its length with the bass.
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1, 20, 1, true), flameMaterial)
    flame.geometry.translate(0, -0.5, 0)
    flame.rotation.x = -Math.PI / 2
    flame.position.set(side * 0.5, -0.02, 1.85)
    ship.add(flame)
    flames.push(flame)
  }

  // --- The cat ------------------------------------------------------------
  const cat = new THREE.Group()
  cat.position.set(0, 0.28, 0.12)
  ship.add(cat)
  let coat = COATS.ginger
  const furMaterial = new THREE.MeshStandardMaterial({ roughness: 0.95, map: furTexture(coat.fur, coat.stripes) })
  const pinkMaterial = new THREE.MeshStandardMaterial({ color: 0xf2a0b0, roughness: 0.8 })
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: coat.eyes, roughness: 0.2, emissive: coat.eyes, emissiveIntensity: 0.25 })
  const pupilMaterial = new THREE.MeshBasicMaterial({ color: 0x0b0b0e })

  // Chonk: a wide, heavy body sitting low in the cockpit.
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 40, 28), furMaterial)
  body.scale.set(1.15, 0.95, 1.05)
  body.position.y = 0.26
  cat.add(body)
  // Haunches: the folded back legs a sitting cat spreads out on — what
  // makes it read as a cat rather than two stacked balls from behind.
  for (const side of [-1, 1]) {
    const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), furMaterial)
    haunch.scale.set(0.9, 0.75, 1.2)
    haunch.position.set(side * 0.4, 0.08, 0.12)
    cat.add(haunch)
  }
  for (const side of [-1, 1]) {
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), furMaterial)
    paw.scale.set(1, 0.7, 1.3)
    paw.position.set(side * 0.24, 0.12, -0.52)
    cat.add(paw)
  }

  const head = new THREE.Group()
  head.position.set(0, 0.78, -0.12)
  cat.add(head)
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.34, 36, 24), furMaterial)
  skull.scale.set(1.28, 0.9, 1)
  head.add(skull)
  const ears: THREE.Group[] = []
  for (const side of [-1, 1]) {
    // Fluffy cheeks — the chonk continues into the face.
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), furMaterial)
    cheek.position.set(side * 0.24, -0.1, -0.1)
    head.add(cheek)
    const ear = new THREE.Group()
    ear.position.set(side * 0.27, 0.25, 0.02)
    ear.rotation.z = side * -0.4
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.28, 4), furMaterial)
    outer.rotation.y = Math.PI / 4
    ear.add(outer)
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.19, 4), pinkMaterial)
    inner.rotation.y = Math.PI / 4
    inner.position.set(0, -0.02, -0.035)
    ear.add(inner)
    head.add(ear)
    ears.push(ear)
    // Eyes face forward (-z): seen when the cat turns round.
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), eyeMaterial)
    eye.position.set(side * 0.13, 0.04, -0.29)
    eye.scale.set(1, 1, 0.6)
    head.add(eye)
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), pupilMaterial)
    pupil.scale.set(0.45, 1, 0.5)
    pupil.position.set(side * 0.13, 0.04, -0.335)
    head.add(pupil)
  }
  const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), pinkMaterial)
  noseTip.position.set(0, -0.06, -0.33)
  noseTip.scale.set(1.3, 0.8, 0.8)
  head.add(noseTip)
  const eyes = head.children.filter((c) => (c as THREE.Mesh).material === eyeMaterial || (c as THREE.Mesh).material === pupilMaterial)

  // Tail: a tube along a curve that sways from its base.
  const tail = new THREE.Group()
  tail.position.set(0, 0.08, 0.45)
  cat.add(tail)
  // Wraps round the cat's right side along the cockpit rim, tip curling up.
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.35, -0.02, 0.12),
    new THREE.Vector3(0.62, 0, -0.2),
    new THREE.Vector3(0.66, 0.05, -0.6),
    new THREE.Vector3(0.5, 0.22, -0.82),
  ])
  const tailMesh = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 32, 0.07, 12, false), furMaterial)
  tail.add(tailMesh)
  const tailTip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), furMaterial)
  tailTip.position.copy(tailCurve.getPoint(1))
  tail.add(tailTip)

  // --- Animation state ------------------------------------------------------
  let speed = 30
  let bob = 0
  let bobVelocity = 0
  let earTwitch = 0
  let headTurn = 0
  let headTurnTarget = 0
  let nextLook = 6 + Math.random() * 6
  let blink = 0
  let nextBlink = 2 + Math.random() * 3
  let beacon0 = 0
  let lastHigh = 0
  const lookAt = new THREE.Vector3()

  function setCoat(id: string): void {
    coat = COATS[id] ?? COATS.ginger
    furMaterial.map?.dispose()
    furMaterial.map = furTexture(coat.fur, coat.stripes)
    furMaterial.needsUpdate = true
    eyeMaterial.color.setHex(coat.eyes)
    eyeMaterial.emissive.setHex(coat.eyes)
  }

  function update(frame: AudioFrame): number {
    const { t, dt, bass, mid, high, energy, beat, flash, hue } = frame

    // Travel: faster with energy, a surge on each kick.
    const targetSpeed = 28 + energy * 90 + flash * 50
    speed += (targetSpeed - speed) * Math.min(1, dt * 3)
    const streak = 0.4 + speed * 0.045
    for (let i = 0; i < STAR_COUNT; i++) {
      starZ[i] += speed * dt
      if (starZ[i] > STAR_FIELD.near) {
        starZ[i] = STAR_FIELD.far
        starPositions[i * 6] = starPositions[i * 6 + 3] = (Math.random() - 0.5) * STAR_FIELD.x
        starPositions[i * 6 + 1] = starPositions[i * 6 + 4] = (Math.random() - 0.5) * STAR_FIELD.y
      }
      starPositions[i * 6 + 2] = starZ[i]
      starPositions[i * 6 + 5] = starZ[i] - streak
    }
    starGeometry.attributes.position.needsUpdate = true
    starMaterial.color.setHSL((hue + 0.6) % 1, 0.35, 0.8)

    for (const planet of planets) {
      planet.group.position.z += speed * dt * planet.speed
      planet.group.rotation.y += dt * 0.05
      if (planet.group.position.z > 25) placePlanet(planet.group, false)
    }

    // The ship weaves and banks, with a bass shudder.
    const weaveX = Math.sin(t * 0.37) * 0.9 + Math.sin(t * 0.13) * 0.5
    const weaveY = Math.sin(t * 0.61) * 0.35
    ship.position.set(weaveX, weaveY + (Math.random() - 0.5) * bass * 0.03, 0)
    ship.rotation.z = -Math.cos(t * 0.37) * 0.3 + Math.sin(t * 1.3) * 0.02
    ship.rotation.x = Math.cos(t * 0.61) * 0.06
    ship.rotation.y = Math.cos(t * 0.37) * 0.08

    for (const flame of flames) {
      const length = 0.5 + bass * 1.2 + flash * 0.9 + Math.random() * 0.12
      flame.scale.set(1 + flash * 0.3, length, 1 + flash * 0.3)
    }
    flameMaterial.color.setHSL((hue + 0.5) % 1, 0.85, 0.5 + flash * 0.15)
    rim.color.setHSL(hue, 0.7, 0.55)
    rim.intensity = 4 + bass * 8

    beacon0 = beat ? 1 : Math.max(0, beacon0 - dt * 4)
    ;(beacon.material as THREE.MeshBasicMaterial).color.setRGB(0.3 + beacon0 * 1.2, 0.08, 0.15 + beacon0 * 0.3)

    // Head bob: a spring kicked on each beat.
    if (beat) bobVelocity -= 0.9 + bass
    bobVelocity += (-bob * 60 - bobVelocity * 9) * dt
    bob += bobVelocity * dt
    head.position.y = 0.78 + bob * 0.05
    body.scale.y = 0.95 - bob * 0.015

    // Ears twitch on sudden treble.
    if (high - lastHigh > 0.08) earTwitch = 1
    lastHigh = high
    earTwitch = Math.max(0, earTwitch - dt * 5)
    ears[0].rotation.x = -earTwitch * 0.5
    ears[1].rotation.x = -earTwitch * 0.35

    // Every so often, turn round to look at the camera.
    nextLook -= dt
    if (nextLook <= 0) {
      headTurnTarget = headTurnTarget === 0 ? (Math.random() < 0.5 ? -1 : 1) * 2.4 : 0
      nextLook = headTurnTarget === 0 ? 7 + Math.random() * 8 : 2.5 + Math.random() * 2
    }
    headTurn += (headTurnTarget - headTurn) * Math.min(1, dt * 2.5)
    head.rotation.y = headTurn + Math.sin(t * 0.8) * 0.12
    head.rotation.z = Math.sin(t * 1.1) * 0.05 + mid * 0.08 * Math.sin(t * 4)

    nextBlink -= dt
    if (nextBlink <= 0) {
      blink = 1
      nextBlink = 2.5 + Math.random() * 4
    }
    blink = Math.max(0, blink - dt * 7)
    for (const eye of eyes) eye.scale.y = Math.max(0.08, 1 - Math.sin(blink * Math.PI))

    tail.rotation.y = Math.sin(t * (1.6 + mid * 2)) * 0.18
    tail.rotation.x = Math.sin(t * 0.9) * 0.06

    // Third person: behind, above and a little to the side, lagging the
    // ship's weave slightly; the field of view widens on each kick.
    camera.position.set(ship.position.x * 0.6 + 2.6, ship.position.y * 0.5 + 2.0, 3.9)
    lookAt.set(ship.position.x * 0.85, ship.position.y + 0.75, -1.2)
    camera.lookAt(lookAt)
    camera.rotation.z += ship.rotation.z * 0.15
    camera.fov = 55 + flash * 6 + energy * 4
    camera.updateProjectionMatrix()

    return 0.45 + bass * 0.3 + flash * 0.35
  }

  return {
    scene,
    camera,
    update,
    toneMapping: THREE.ACESFilmicToneMapping,
    dispose: () => {
      furMaterial.map?.dispose()
      disposeScene(scene)
    },
    setOption: (optionId, valueId) => {
      if (optionId === 'cat') setCoat(valueId)
    },
  }
}

export const spaceCatTheme: VisualizerTheme = { id: 'spacecat', name: 'Space Cat', create, options: OPTIONS }
