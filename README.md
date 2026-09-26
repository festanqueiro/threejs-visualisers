# three.js visualisers

Eight audio-reactive visualisers for the web, built on [three.js](https://threejs.org). Give them a Web Audio `AnalyserNode` (from an `<audio>` element, a microphone or any audio graph) and they react to the bass, mids, highs and kicks.

| Theme | What it looks like | Options |
| --- | --- | --- |
| **Nebula** | A noise-warped glowing core that swells with the bass, a spectrum ring around it, and a particle field streaming towards you | — |
| **Warp** | A tunnel of spectrum-shaped rings flying at you, a scrolling history of the track | — |
| **Horizon** | A synthwave wireframe landscape built from the spectrum, scrolling towards you under a striped sun that pulses with the kick | — |
| **Sound System** | A Jamaican-style sound system stack; cones pump, boxes shake, pressure rings pulse | Stack, Colours, Background |
| **Smoke** | A smoky club: smoke rolling up from a lamp that pumps with the kick, stage beams cutting through it | Colours |
| **Kaleidoscope** | Mirrored wedges of neon rings lit by the spectrum; kicks punch the zoom and flick the mirrors | Mirrors, Colours |
| **Paint** | Paint flicked at a black wall in thin wiggling strokes, driven by the kicks, mids and highs, fading to dark stains | Colours |
| **Liquid 3D** | Liquid blobs flowing into each other in 3D; bass and kicks pour them together and ripple the surface. The Lo-Res style draws it in big, dithered pixels and a handful of colours | Style, Palette |

**Live demo: https://festanqueiro.github.io/threejs-visualisers/** (play an audio file or use your microphone).

These started life in [MCO](https://github.com/festanqueiro/music-collection-organizer), a DJ's music collection organiser.

## Try it

```sh
git clone https://github.com/festanqueiro/threejs-visualisers.git
cd threejs-visualisers
npm install
npm run dev
```

Open the printed URL, then play an audio file or use your microphone. Keys 1–8 switch themes.

## Use it in your project

Install it from GitHub (it builds itself on install). three.js is a peer dependency:

```sh
npm install three github:festanqueiro/threejs-visualisers
```

```ts
import { Visualizer, analyserFromMediaElement } from 'threejs-visualisers'

const audio = document.querySelector('audio')!
const stage = document.getElementById('stage')! // give it a size, e.g. position: fixed; inset: 0

// Browsers only start audio from a user gesture.
playButton.addEventListener('click', () => {
  const { analyser } = analyserFromMediaElement(audio)
  const visualizer = new Visualizer(stage, { analyser, theme: 'smoke' })
  audio.play()

  // Later:
  visualizer.setTheme('paint', { colours: 'mixed' })
  visualizer.setOption('colours', 'yellow')
})
```

`Visualizer` fills its container with a canvas, follows the container's size, runs the render loop and creates or disposes themes as you switch.

### API

- **`new Visualizer(container, options?)`**
  - `analyser`: an `AnalyserNode`, `null`, or a function returning one. Use a function when the node changes over time.
  - `theme`: the starting theme id, e.g. `'kaleidoscope'`.
  - `themeOptions`: starting option values, e.g. `{ mirrors: '12' }`.
  - `pixelRatio`: defaults to `min(devicePixelRatio, 2)`.
  - `autoStart`: defaults to `true`.
- **Methods:** `setTheme(id, options?)`, `setOption(optionId, valueId)`, `setAnalyser(source)`, `start()`, `stop()` and `dispose()`.
- **Getters:** `theme` and `themeOptions`.
- **`VISUALIZER_THEMES`**: every theme, with its `id`, `name` and `options`. Use it to build a picker.
- **`analyserFromMediaElement(element, context?)`** and **`analyserFromMediaStream(stream, context?)`**: tap an `<audio>`/`<video>` element or a `MediaStream` (such as a microphone) with an analyser set up the way the themes expect. A media element can only be tapped once, so keep the result.
- **`VisualizerEngine`**: the renderer without the loop, for driving frames yourself, rendering off-screen or recording a canvas. Call `render()` whenever you want a frame.

### Writing your own theme

A theme is `{ id, name, create, options? }`. `create()` returns a scene, a camera and an `update(frame)` function. `update` receives smoothed `bass`, `mid`, `high` and `energy` values (0–1), a `beat` flag, a decaying `flash`, a drifting `hue` and the raw spectrum. It returns the bloom strength for that frame. See `src/types.ts` and any file in `src/themes/`. `shared.ts` has helpers for spectrum bars, full-screen shader quads and fBm noise.

## Notes

- The library is one ES module of about 1 MB. Most of that is the Sound System's 3D model, inlined so you don't need any asset configuration.
- Everything runs on the GPU. Smoke and Kaleidoscope are full-screen shaders, so on 4K or 5K displays keep `pixelRatio` at 1–2.

## License

ISC © Francisco Estanqueiro

Nebula uses Ashima Arts / Stefan Gustavson's 3D simplex noise (MIT), credited in `src/themes/nebula.ts`.
