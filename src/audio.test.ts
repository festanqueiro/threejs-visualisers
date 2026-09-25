import { describe, it, expect } from 'vitest'
import { computeBands, BeatDetector, logBinRanges, follow } from './audio'

// 1024 bins at 48kHz → 23.4375Hz per bin.
const SAMPLE_RATE = 48000
const BINS = 1024
const binHz = SAMPLE_RATE / 2 / BINS

function spectrumWithEnergyAt(loHz: number, hiHz: number): Uint8Array {
  const freq = new Uint8Array(BINS)
  for (let i = 0; i < BINS; i++) {
    const hz = i * binHz
    if (hz >= loHz && hz <= hiHz) freq[i] = 255
  }
  return freq
}

describe('computeBands', () => {
  it('is all zeros for silence', () => {
    expect(computeBands(new Uint8Array(BINS), SAMPLE_RATE)).toEqual({ bass: 0, mid: 0, high: 0 })
  })

  it('attributes low-frequency energy to bass only', () => {
    const bands = computeBands(spectrumWithEnergyAt(40, 200), SAMPLE_RATE)
    expect(bands.bass).toBeGreaterThan(0.5)
    expect(bands.mid).toBe(0)
    expect(bands.high).toBe(0)
  })

  it('attributes high-frequency energy to high only', () => {
    const bands = computeBands(spectrumWithEnergyAt(5000, 15000), SAMPLE_RATE)
    expect(bands.bass).toBe(0)
    expect(bands.mid).toBe(0)
    expect(bands.high).toBeGreaterThan(0.5)
  })

  it('is 1 across the board for a full-scale spectrum', () => {
    const bands = computeBands(new Uint8Array(BINS).fill(255), SAMPLE_RATE)
    expect(bands).toEqual({ bass: 1, mid: 1, high: 1 })
  })
})

describe('BeatDetector', () => {
  it('fires on a spike above the running average', () => {
    const detector = new BeatDetector()
    let t = 0
    for (let i = 0; i < 60; i++) detector.update(0.3, (t += 16))
    expect(detector.update(0.9, (t += 16))).toBe(true)
  })

  it('does not fire on a steady level', () => {
    const detector = new BeatDetector()
    let t = 0
    for (let i = 0; i < 60; i++) detector.update(0.5, (t += 16))
    expect(detector.update(0.5, (t += 16))).toBe(false)
  })

  it('ignores spikes below the minimum level (near-silence)', () => {
    const detector = new BeatDetector()
    let t = 0
    for (let i = 0; i < 60; i++) detector.update(0.01, (t += 16))
    expect(detector.update(0.2, (t += 16))).toBe(false)
  })

  it('does not double-fire within the refractory period', () => {
    const detector = new BeatDetector()
    let t = 0
    for (let i = 0; i < 60; i++) detector.update(0.3, (t += 16))
    expect(detector.update(0.9, (t += 16))).toBe(true)
    expect(detector.update(0.95, (t += 16))).toBe(false)
  })
})

describe('logBinRanges', () => {
  it('returns one ascending, in-bounds range per bar', () => {
    const ranges = logBinRanges(BINS, SAMPLE_RATE, 32, 30, 16000)
    expect(ranges).toHaveLength(32)
    for (const [start, end] of ranges) {
      expect(start).toBeGreaterThanOrEqual(0)
      expect(end).toBeGreaterThanOrEqual(start)
      expect(end).toBeLessThan(BINS)
    }
    for (let i = 1; i < ranges.length; i++) expect(ranges[i][0]).toBeGreaterThanOrEqual(ranges[i - 1][0])
  })

  it('spans roughly minHz..maxHz', () => {
    const ranges = logBinRanges(BINS, SAMPLE_RATE, 16, 30, 16000)
    expect(ranges[0][0]).toBe(Math.floor(30 / binHz))
    expect(ranges[15][1]).toBe(Math.ceil(16000 / binHz))
  })
})

describe('follow', () => {
  it('rises by the attack factor and falls by the release factor', () => {
    expect(follow(0, 1, 0.5, 0.1)).toBeCloseTo(0.5)
    expect(follow(1, 0, 0.5, 0.1)).toBeCloseTo(0.9)
  })
})
