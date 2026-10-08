export { Visualizer, type VisualizerOptions } from './visualizer'
export { VisualizerEngine, type AnalyserSource } from './engine'
export { FrameLimiter, DEFAULT_FPS, FPS_CHOICES } from './frameLimiter'
export { VISUALIZER_THEMES, getVisualizerTheme } from './themes'
export { nebulaTheme } from './themes/nebula'
export { warpTheme } from './themes/warp'
export { horizonTheme } from './themes/horizon'
export { soundSystemTheme } from './themes/soundsystem'
export { smokeTheme } from './themes/smoke'
export { kaleidoscopeTheme } from './themes/kaleidoscope'
export { paintTheme } from './themes/paint'
export { liquidTheme } from './themes/liquid'
export { originsTheme } from './themes/origins'
export { vaporTheme } from './themes/vapor'
export { spongeTheme } from './themes/sponge'
export { crystalTheme } from './themes/crystal'
export { tangleTheme } from './themes/tangle'
export {
  analyserFromMediaElement,
  analyserFromMediaStream,
  createAnalyser,
  computeBands,
  BeatDetector,
  logBinRanges,
  follow,
  type Bands,
} from './audio'
export { SpectrumBars, createDotTexture, disposeScene, createFullscreenQuad, FULLSCREEN_VERTEX_SHADER, NOISE_GLSL } from './shared'
export type { AudioFrame, ThemeInstance, ThemeOption, VisualizerTheme, VisualizerThemeId } from './types'
