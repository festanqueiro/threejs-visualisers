import { VisualizerEngine, type AnalyserSource } from './engine'
import { VISUALIZER_THEMES, getVisualizerTheme } from './themes'
import type { ThemeInstance, VisualizerTheme, VisualizerThemeId } from './types'

export interface VisualizerOptions {
  // Audio to react to — see AnalyserSource. Can be set later.
  analyser?: AnalyserSource
  // Starting theme (default: the first, Nebula).
  theme?: VisualizerThemeId
  // Starting option values for that theme, e.g. { colours: 'amber' }.
  themeOptions?: Record<string, string>
  // Capped at 2 by default — fill-rate heavy themes get slow on 3x displays.
  pixelRatio?: number
  // Start rendering right away (default true).
  autoStart?: boolean
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
  private resizeObserver: ResizeObserver

  constructor(
    private readonly container: HTMLElement,
    options: VisualizerOptions = {},
  ) {
    this.engine = new VisualizerEngine({
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      pixelRatio: options.pixelRatio ?? Math.min(window.devicePixelRatio, 2),
      analyser: options.analyser,
    })
    this.engine.canvas.style.display = 'block'
    this.engine.canvas.style.width = '100%'
    this.engine.canvas.style.height = '100%'
    container.appendChild(this.engine.canvas)
    this.resizeObserver = new ResizeObserver(() =>
      this.engine.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight)),
    )
    this.resizeObserver.observe(container)

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
    this.options = {}
    for (const option of theme.options ?? []) {
      const wanted = options[option.id]
      this.options[option.id] = option.values.some((v) => v.id === wanted) ? wanted : option.values[0].id
    }
    for (const [optionId, valueId] of Object.entries(this.options)) this.instance.setOption?.(optionId, valueId)
    this.engine.setTheme(this.instance)
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

  start(): void {
    if (this.running) return
    this.running = true
    const tick = () => {
      if (!this.running) return
      this.raf = requestAnimationFrame(tick)
      this.engine.render()
    }
    tick()
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
