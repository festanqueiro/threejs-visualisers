import { StutterDetector } from './stutterDetector'
import type { VisualizerQuality } from './types'

// For a quality picker, in order. `scale` multiplies the pixel ratio:
// Low renders under the display's resolution, HD 1.5× over it (up to 3×)
// and has the themes that can turn their own detail up.
export const QUALITY_CHOICES: Array<{ quality: VisualizerQuality; label: string; scale: number }> = [
  { quality: 'low', label: 'Low', scale: 0.6 },
  { quality: 'high', label: 'High', scale: 1 },
  { quality: 'hd', label: 'HD', scale: 1.5 },
]
const MAX_PIXEL_RATIO = 3

// What AutoQuality drives — a VisualizerEngine.
export interface QualityTarget {
  setPixelRatio(pixelRatio: number): void
  setQuality(quality: VisualizerQuality): void
}

// The Visualizer's quality setting, for apps that run their own render
// loop around a VisualizerEngine: a fixed level stays put; 'auto' starts
// at High and steps down a level whenever frames keep coming late (see
// StutterDetector). Call frame() after every frame rendered, and reset()
// after a theme switch or frame-rate change.
//
//   const quality = new AutoQuality(engine, Math.min(devicePixelRatio, 2))
//   quality.set('auto')
//   // in the loop: if (limiter.shouldRender(now)) { engine.render(now); quality.frame(now, limiter.fps) }
export class AutoQuality {
  private stutter = new StutterDetector()
  private isAuto = true
  private current: VisualizerQuality = 'high'

  constructor(
    private readonly target: QualityTarget,
    // The High resolution, which Low and HD scale from.
    private readonly basePixelRatio: number,
    // Called whenever the quality in use changes — including Auto stepping
    // down — with the new quality and whether Auto chose it.
    private readonly onChange?: (quality: VisualizerQuality, auto: boolean) => void,
  ) {}

  // The quality in use (under Auto, whatever it has stepped down to).
  get quality(): VisualizerQuality {
    return this.current
  }

  get auto(): boolean {
    return this.isAuto
  }

  // A fixed level, or 'auto' — back to High, stepping down on stutter.
  // Unknown values are ignored.
  set(quality: VisualizerQuality | 'auto'): void {
    if (quality !== 'auto' && !QUALITY_CHOICES.some((c) => c.quality === quality)) return
    this.isAuto = quality === 'auto'
    this.apply(quality === 'auto' ? 'high' : quality)
  }

  // New shaders compile on the first frames after a theme switch or
  // quality change; this keeps that from counting as stutter.
  reset(nowMs = performance.now()): void {
    this.stutter.reset(nowMs)
  }

  // After every frame rendered, with the frame-rate cap (0, no cap, is
  // judged against 60 fps).
  frame(nowMs: number, fps: number): void {
    if (!this.stutter.frame(nowMs, 1000 / (fps || 60)) || !this.isAuto) return
    const index = QUALITY_CHOICES.findIndex((c) => c.quality === this.current)
    if (index > 0) this.apply(QUALITY_CHOICES[index - 1].quality, nowMs)
  }

  private apply(quality: VisualizerQuality, nowMs?: number): void {
    const choice = QUALITY_CHOICES.find((c) => c.quality === quality)!
    this.current = quality
    this.target.setPixelRatio(Math.min(MAX_PIXEL_RATIO, this.basePixelRatio * choice.scale))
    this.target.setQuality(quality)
    this.reset(nowMs)
    this.onChange?.(quality, this.isAuto)
  }
}
