// Notices when the browser can't keep up: call `frame(now, targetMs)` for
// every frame actually rendered (targetMs = the interval the frame cap
// aims for) and it returns true when, over the last few seconds, too many
// frames came late. The Visualizer's automatic quality steps down on that.
//
// A frame counts as late at twice its target interval: with a 30 fps cap,
// anything under 15 fps. It only reports after two windows in a row with
// at least half the frames late — a real, sustained struggle, not a busy
// moment (loading a model, building a backdrop, a background tab waking).
// Gaps over half a second are pauses (a hidden tab, a debugger), not
// stutter, and are skipped. After a report or a reset() — a theme
// switch or quality change, whose shader compiles hitch the first frames —
// it waits out a grace period before judging again.
export class StutterDetector {
  private last: number | null = null
  private windowStart = 0
  private frames = 0
  private late = 0
  private graceUntil = -Infinity
  private badWindows = 0

  constructor(
    private readonly windowMs = 4000,
    private readonly lateFraction = 0.5,
    private readonly graceMs = 3000,
    private readonly windowsNeeded = 2,
  ) {}

  reset(nowMs: number): void {
    this.last = null
    this.badWindows = 0
    this.graceUntil = nowMs + this.graceMs
  }

  frame(nowMs: number, targetMs: number): boolean {
    const interval = this.last === null ? Infinity : nowMs - this.last
    this.last = nowMs
    if (interval > 500 || nowMs < this.graceUntil) {
      this.startWindow(nowMs)
      return false
    }
    this.frames++
    if (interval > targetMs * 2) this.late++
    if (nowMs - this.windowStart < this.windowMs) return false
    const bad = this.frames >= 10 && this.late / this.frames >= this.lateFraction
    this.startWindow(nowMs)
    this.badWindows = bad ? this.badWindows + 1 : 0
    if (this.badWindows < this.windowsNeeded) return false
    this.reset(nowMs)
    return true
  }

  private startWindow(nowMs: number): void {
    this.windowStart = nowMs
    this.frames = 0
    this.late = 0
  }
}
