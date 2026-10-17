import { describe, expect, it } from 'vitest'
import { AutoQuality } from './quality'
import type { VisualizerQuality } from './types'

function setup() {
  const calls: Array<{ pixelRatio: number; quality: VisualizerQuality }> = []
  let pixelRatio = 0
  const changes: Array<[VisualizerQuality, boolean]> = []
  const quality = new AutoQuality(
    {
      setPixelRatio: (ratio) => (pixelRatio = ratio),
      setQuality: (q) => calls.push({ pixelRatio, quality: q }),
    },
    2,
    (q, auto) => changes.push([q, auto]),
  )
  return { quality, calls, changes }
}

// Frames at 10 fps against a 30 fps cap: every one late.
function stutter(quality: AutoQuality, fromMs: number, seconds: number): number {
  let now = fromMs
  while (now < fromMs + seconds * 1000) {
    now += 100
    quality.frame(now, 30)
  }
  return now
}

describe('AutoQuality', () => {
  it('scales the pixel ratio for each level, up to 3', () => {
    const { quality, calls } = setup()
    quality.set('low')
    quality.set('hd')
    expect(calls.map((c) => [c.quality, c.pixelRatio])).toEqual([
      ['low', 1.2],
      ['hd', 3],
    ])
  })

  it('steps down from High under Auto on sustained stutter, reporting it', () => {
    const { quality, changes } = setup()
    quality.set('auto')
    quality.reset(0)
    stutter(quality, 0, 20)
    expect(quality.quality).toBe('low')
    expect(quality.auto).toBe(true)
    expect(changes).toEqual([
      ['high', true],
      ['low', true],
    ])
  })

  it('keeps a fixed level and ignores unknown ones', () => {
    const { quality } = setup()
    quality.set('hd')
    quality.reset(0)
    stutter(quality, 0, 20)
    quality.set('ultra' as VisualizerQuality)
    expect(quality.quality).toBe('hd')
    expect(quality.auto).toBe(false)
  })
})
