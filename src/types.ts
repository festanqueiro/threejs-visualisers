import type * as THREE from 'three'

// Render quality, set for the whole Visualizer (not per theme): Low
// renders below the display's resolution, HD above it (supersampled), and
// themes with costly shaders can scale their own detail to match (see
// ThemeInstance.setQuality).
export type VisualizerQuality = 'low' | 'high' | 'hd'

export type VisualizerThemeId = 'nebula' | 'warp' | 'horizon' | 'soundsystem' | 'smoke' | 'kaleidoscope' | 'paint' | 'liquid' | 'origins'
  | 'sponge'
  | 'crystal'
  | 'tangle'
  | 'ocean'

// Everything a theme needs from the audio for one frame. Computed once
// by the Visualizer shell (so themes don't each redo band/beat analysis),
// already smoothed where that matters.
export interface AudioFrame {
  t: number // seconds, monotonic
  dt: number // seconds since last frame, clamped
  bass: number // 0..1, smoothed
  mid: number // 0..1, smoothed
  high: number // 0..1, smoothed
  energy: number // average of bass/mid/high
  beat: boolean // true on the frame a kick is detected
  flash: number // 1 on a beat, decaying to 0 over ~1/3s
  hue: number // 0..1, slowly drifting, nudged forward on each beat
  // Tempo, tracked over the last few seconds (see tempo.ts): `beats` counts
  // beats continuously — whole numbers on the beat — and keeps counting
  // through breakdowns; `bpm` starts at 120 until it's heard enough.
  bpm: number
  beats: number
  tempoConfidence: number // 0..1
  freq: Uint8Array // raw getByteFrequencyData() output; empty when nothing is loaded
  sampleRate: number
}

// One live instance of a theme — owns its own scene and camera; the
// shell owns the renderer, bloom pass and render loop.
export interface ThemeInstance {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  // Advances the scene one frame; returns the bloom strength to use.
  update(frame: AudioFrame): number
  dispose(): void
  // Renderer settings the shell applies while this theme is active —
  // lit, daylight scenes want shadows and filmic tone mapping; the
  // emissive/bloom themes want neither.
  shadows?: boolean
  toneMapping?: THREE.ToneMapping
  // Applies one of the theme's `options` (see VisualizerTheme) in place —
  // no rebuild, so the animation carries on uninterrupted.
  setOption?: (optionId: string, valueId: string) => void
  // Follows the Visualizer's quality setting — called once when the theme
  // starts and again on every change. Optional: resolution alone is
  // handled by the shell.
  setQuality?: (quality: VisualizerQuality) => void
  // Renders at this fraction of the shell's resolution (default 1): for
  // soft, costly full-screen shaders (Ocean), where every pixel saved
  // counts and the upscale barely shows.
  resolutionScale?: number
}

// A user-selectable setting a theme offers (e.g. Colours, Background),
// shown as a picker in the Visualizer's bottom-right corner while the
// theme is active. The first value is the default.
export interface ThemeOption {
  id: string
  name: string
  values: Array<{ id: string; name: string }>
  // Only applies while other options have one of these values, e.g.
  // { stack: ['mb'] } — pickers should hide it otherwise.
  when?: Record<string, string[]>
}

export interface VisualizerTheme {
  id: VisualizerThemeId
  name: string
  create(): ThemeInstance
  options?: ThemeOption[]
}
