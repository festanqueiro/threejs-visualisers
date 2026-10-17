import { describe, expect, it } from 'vitest'
import { StutterDetector } from './stutterDetector'

// Feeds `seconds` of rendered frames `intervalMs` apart (every `slowEvery`th
// one taking `slowMs` instead) and counts how often stutter was reported.
function run(
  detector: StutterDetector,
  options: { start?: number; seconds: number; intervalMs: number; targetMs?: number; slowEvery?: number; slowMs?: number },
): { reports: number; end: number } {
  const { seconds, intervalMs, targetMs = 1000 / 30, slowEvery = 0, slowMs = intervalMs } = options
  let now = options.start ?? 0
  let reports = 0
  let i = 0
  while (now < (options.start ?? 0) + seconds * 1000) {
    now += slowEvery > 0 && i % slowEvery === 0 ? slowMs : intervalMs
    if (detector.frame(now, targetMs)) reports++
    i++
  }
  return { reports, end: now }
}

describe('StutterDetector', () => {
  it('stays quiet while frames arrive on time', () => {
    expect(run(new StutterDetector(), { seconds: 30, intervalMs: 1000 / 30 }).reports).toBe(0)
  })

  it('shrugs off the odd slow frame', () => {
    expect(run(new StutterDetector(), { seconds: 30, intervalMs: 1000 / 30, slowEvery: 20, slowMs: 90 }).reports).toBe(0)
  })

  it('reports when most frames miss the target rate for a while', () => {
    // 12 fps against a 30 fps cap.
    expect(run(new StutterDetector(), { seconds: 12, intervalMs: 85 }).reports).toBeGreaterThan(0)
  })

  it('lets a merely slower-than-target browser be (20 fps on a 30 cap)', () => {
    expect(run(new StutterDetector(), { seconds: 30, intervalMs: 50 }).reports).toBe(0)
  })

  it('ignores one bad stretch on its own', () => {
    const detector = new StutterDetector()
    const { end } = run(detector, { seconds: 4.5, intervalMs: 85 })
    expect(run(detector, { start: end, seconds: 20, intervalMs: 1000 / 30 }).reports).toBe(0)
  })

  it('waits out the grace period after a reset', () => {
    const detector = new StutterDetector()
    detector.reset(0)
    // Slow from the start, but only for the grace period.
    expect(run(detector, { seconds: 3, intervalMs: 85 }).reports).toBe(0)
  })

  it('ignores pauses (a hidden tab)', () => {
    const detector = new StutterDetector()
    const { end } = run(detector, { seconds: 5, intervalMs: 1000 / 30 })
    // One long gap, then on-time frames again.
    expect(detector.frame(end + 5000, 1000 / 30)).toBe(false)
    expect(run(detector, { start: end + 5000, seconds: 10, intervalMs: 1000 / 30 }).reports).toBe(0)
  })

  it('reports at most once per window', () => {
    // 30 s of steady slowness: a report every few windows, not every frame.
    expect(run(new StutterDetector(), { seconds: 30, intervalMs: 85 }).reports).toBeLessThanOrEqual(3)
  })
})
