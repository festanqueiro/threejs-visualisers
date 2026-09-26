import type * as THREE from 'three'

export type VisualizerThemeId = 'nebula' | 'warp' | 'horizon' | 'soundsystem' | 'smoke' | 'kaleidoscope' | 'paint' | 'liquid'

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
}

// A user-selectable setting a theme offers (e.g. Colours, Background),
// shown as a picker in the Visualizer's bottom-right corner while the
// theme is active. The first value is the default.
export interface ThemeOption {
  id: string
  name: string
  values: Array<{ id: string; name: string }>
}

export interface VisualizerTheme {
  id: VisualizerThemeId
  name: string
  create(): ThemeInstance
  options?: ThemeOption[]
}
