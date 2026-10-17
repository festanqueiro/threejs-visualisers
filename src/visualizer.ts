import { VisualizerEngine, type AnalyserSource } from './engine'
import { FrameLimiter } from './frameLimiter'
import { AutoQuality } from './quality'
import { resolveThemeOptions } from './options'
import { VISUALIZER_THEMES, getVisualizerTheme } from './themes'
import type { ThemeInstance, VisualizerQuality, VisualizerTheme, VisualizerThemeId } from './types'

export interface VisualizerOptions {
  // Audio to react to — see AnalyserSource. Can be set later.
  analyser?: AnalyserSource
  // Starting theme (default: the first, Nebula).
  theme?: VisualizerThemeId
  // Starting option values for that theme, e.g. { colours: 'amber' }.
  themeOptions?: Record<string, string>
  // Capped at 2 by default — fill-rate heavy themes get slow on 3x displays.
  // This is the High quality resolution; Low and HD scale from it.
  pixelRatio?: number
  // Render quality for every theme. 'auto' (the default) starts at High
  // and steps down a level whenever the browser can't keep up with the
  // frame rate; a fixed quality stays put. See QUALITY_CHOICES.
  quality?: VisualizerQuality | 'auto'
  // Called whenever the quality in use changes — including Auto stepping
  // down — with the new quality and whether Auto chose it.
  onQualityChange?: (quality: VisualizerQuality, auto: boolean) => void
  // Start rendering right away (default true).
  autoStart?: boolean
  // Frame-rate cap (default 30, to go easy on the GPU); 0 for none, every
  // display refresh renders. See FPS_CHOICES for a picker.
  fps?: number
}

// The batteries-included way to use the visualisers: fills `container`
// with a canvas, keeps it sized to the container, runs the render loop
// and handles creating/disposing themes as you switch between them.
//
//   const { analyser } = analyserFromMediaElement(audioElement)
//   const visualizer = new Visualizer(document.getElementById('stage')!, { analyser, theme: 'smoke' })
//   visualizer.setTheme('paint', { colours: 'mixed' })
export class Visualizer {
  readonly engine: VisualizerEngine
  private instance: ThemeInstance | null = null
  private themeId: VisualizerThemeId
  private options: Record<string, string> = {}
  private raf = 0
  private running = false
  private limiter: FrameLimiter
  private resizeObserver: ResizeObserver
  private qualityControl: AutoQuality

  constructor(
    private readonly container: HTMLElement,
    options: VisualizerOptions = {},
  ) {
    const basePixelRatio = options.pixelRatio ?? Math.min(window.devicePixelRatio, 2)
    this.engine = new VisualizerEngine({
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      pixelRatio: basePixelRatio,
      analyser: options.analyser,
    })
    this.qualityControl = new AutoQuality(this.engine, basePixelRatio, options.onQualityChange)
    this.setQuality(options.quality ?? 'auto')
    this.engine.canvas.style.display = 'block'
    this.engine.canvas.style.width = '100%'
    this.engine.canvas.style.height = '100%'
    container.appendChild(this.engine.canvas)
    this.resizeObserver = new ResizeObserver(() =>
      this.engine.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight)),
    )
    this.resizeObserver.observe(container)

    this.limiter = new FrameLimiter(options.fps)
    this.themeId = getVisualizerTheme(options.theme ?? VISUALIZER_THEMES[0].id).id
    this.setTheme(this.themeId, options.themeOptions)
    if (options.autoStart !== false) this.start()
  }

  get theme(): VisualizerTheme {
    return getVisualizerTheme(this.themeId)
  }

  // The theme's current option values, with defaults filled in.
  get themeOptions(): Record<string, string> {
    return { ...this.options }
  }

  // Switches theme. `options` override the new theme's defaults (the
  // first value of each option).
  setTheme(id: VisualizerThemeId, options: Record<string, string> = {}): void {
    const theme = getVisualizerTheme(id)
    this.instance?.dispose()
    this.themeId = theme.id
    this.instance = theme.create()
    this.options = resolveThemeOptions(theme, options)
    for (const [optionId, valueId] of Object.entries(this.options)) this.instance.setOption?.(optionId, valueId)
    this.engine.setTheme(this.instance)
    // New shaders compile on the first frames; don't count that as stutter.
    this.qualityControl.reset()
  }

  // Changes one option of the current theme in place (no rebuild).
  setOption(optionId: string, valueId: string): void {
    const option = this.theme.options?.find((o) => o.id === optionId)
    if (!option?.values.some((v) => v.id === valueId)) return
    this.options[optionId] = valueId
    this.instance?.setOption?.(optionId, valueId)
  }

  setAnalyser(source: AnalyserSource): void {
    this.engine.setAnalyser(source)
  }

  // The quality in use (under Auto, whatever it has stepped down to).
  get quality(): VisualizerQuality {
    return this.qualityControl.quality
  }

  // Whether the quality is automatic (see VisualizerOptions.quality).
  get autoQuality(): boolean {
    return this.qualityControl.auto
  }

  // Changes the render quality for every theme, in place: a fixed level,
  // or 'auto' — back to High, stepping down if the browser stutters.
  setQuality(quality: VisualizerQuality | 'auto'): void {
    this.qualityControl.set(quality)
  }

  // The frame-rate cap (0: none).
  get fps(): number {
    return this.limiter.fps
  }

  // Changes the frame-rate cap while running; 0 removes it.
  setFps(fps: number): void {
    this.limiter.fps = fps
    this.qualityControl.reset()
  }

  start(): void {
    if (this.running) return
    this.running = true
    const tick = (now: number) => {
      if (!this.running) return
      this.raf = requestAnimationFrame(tick)
      if (!this.limiter.shouldRender(now)) return
      this.engine.render(now)
      // Auto quality: one level down each time frames keep coming late.
      this.qualityControl.frame(now, this.limiter.fps)
    }
    tick(performance.now())
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  dispose(): void {
    this.stop()
    this.resizeObserver.disconnect()
    this.instance?.dispose()
    this.instance = null
    this.engine.dispose()
  }
}
