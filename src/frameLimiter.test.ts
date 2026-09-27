import { describe, expect, it } from 'vitest'
import { FrameLimiter } from './frameLimiter'

// How many of `seconds` worth of display refreshes at `hz` a limiter renders.
function rendered(limiter: FrameLimiter, hz: number, seconds = 10, jitterMs = 0): number {
  let count = 0
  const frames = hz * seconds
  for (let i = 0; i < frames; i++) {
    const jitter = jitterMs * (i % 2 === 0 ? 1 : -1)
    if (limiter.shouldRender(1000 + (i * 1000) / hz + jitter)) count++
  }
  return count
}

describe('FrameLimiter', () => {
  it('renders every frame with no cap', () => {
    expect(rendered(new FrameLimiter(0), 60)).toBe(600)
    expect(rendered(new FrameLimiter(0), 120)).toBe(1200)
  })

  it('caps at 30 fps by default', () => {
    expect(rendered(new FrameLimiter(), 120)).toBe(300)
  })

  it('holds the target rate on 60 and 120 Hz displays', () => {
    expect(rendered(new FrameLimiter(30), 60)).toBe(300)
    expect(rendered(new FrameLimiter(30), 120)).toBe(300)
    expect(rendered(new FrameLimiter(60), 120)).toBe(600)
    expect(rendered(new FrameLimiter(24), 120)).toBe(240)
  })

  it("stays on target despite requestAnimationFrame's jitter", () => {
    expect(rendered(new FrameLimiter(30), 60, 10, 1)).toBe(300)
  })

  it("can't go above the display's rate", () => {
    expect(rendered(new FrameLimiter(120), 60)).toBe(600)
  })

  it('starts again from now after a stall rather than catching up', () => {
    const limiter = new FrameLimiter(30)
    expect(limiter.shouldRender(0)).toBe(true)
    expect(limiter.shouldRender(5000)).toBe(true)
    expect(limiter.shouldRender(5016)).toBe(false)
    expect(limiter.shouldRender(5033)).toBe(true)
  })

  it('reports and changes its rate', () => {
    const limiter = new FrameLimiter(30)
    expect(limiter.fps).toBeCloseTo(30)
    limiter.fps = 0
    expect(limiter.fps).toBe(0)
    expect(rendered(limiter, 60)).toBe(600)
  })
})
