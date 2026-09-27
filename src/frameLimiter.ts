// The default cap: smooth enough for these visuals at about half the GPU
// work of 60 fps.
export const DEFAULT_FPS = 30

// The rates worth offering in a picker; 0 is no cap ("Max": the display's
// refresh rate). 15 suits weak GPUs (TV sticks), 24 is film-like.
export const FPS_CHOICES: { fps: number; label: string }[] = [
  { fps: 15, label: '15 fps' },
  { fps: 24, label: '24 fps' },
  { fps: 30, label: '30 fps' },
  { fps: 60, label: '60 fps' },
  { fps: 0, label: 'Max' },
]

// Caps a requestAnimationFrame loop at a frame rate: call `shouldRender(now)`
// on every animation frame and render only when it says so. Lower rates
// cut GPU load (and heat) at the cost of smoothness.
//
//   const limiter = new FrameLimiter(30)
//   const tick = (now: number) => {
//     requestAnimationFrame(tick)
//     if (limiter.shouldRender(now)) engine.render(now)
//   }
//
// `fps` 0 (or anything not above zero) means no cap: every animation frame
// renders, at the display's refresh rate.
export class FrameLimiter {
  private frameMs = 0
  private last = -Infinity

  constructor(fps = DEFAULT_FPS) {
    this.fps = fps
  }

  get fps(): number {
    return this.frameMs > 0 ? 1000 / this.frameMs : 0
  }

  set fps(fps: number) {
    this.frameMs = Number.isFinite(fps) && fps > 0 ? 1000 / fps : 0
    this.last = -Infinity
  }

  shouldRender(now: number): boolean {
    if (this.frameMs === 0) return true
    const since = now - this.last
    // A little slack for requestAnimationFrame's jitter, so 30 fps on a
    // 60 Hz display is an even every other refresh rather than a mix of
    // one and two.
    if (since < this.frameMs - 2) return false
    // Step along the frame grid rather than jumping to `now`, so the rate
    // doesn't drift below the target; after a stall (hidden tab, slow
    // frame), start again from now instead of rendering a burst.
    this.last = since > this.frameMs * 2 ? now : this.last + this.frameMs
    return true
  }
}
