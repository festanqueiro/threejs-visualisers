import { describe, expect, it } from 'vitest'
import { TempoTracker, spectralFlux } from './tempo'

// Drives a tracker with an onset envelope sampled at `fps` (with a little
// frame-time jitter, as requestAnimationFrame has): a sharp spike on each
// beat of `bpm` starting at `offset` seconds, plus faint off-beat hats.
function play(tracker: TempoTracker, bpm: number, seconds: number, options: { fps?: number; offset?: number; start?: number } = {}) {
  const { fps = 30, offset = 0.13, start = 0 } = options
  const period = 60 / bpm
  let t = start
  let i = 0
  while (t < start + seconds) {
    t += 1 / fps + (i++ % 3 === 0 ? 0.004 : -0.002)
    const sinceBeat = (((t - offset) % period) + period) % period
    const sinceHat = (((t - offset - period / 2) % period) + period) % period
    const onset = Math.exp(-sinceBeat / 0.03) + 0.25 * Math.exp(-sinceHat / 0.02)
    tracker.push(t, onset)
  }
  return t
}

// How far (in beats) the tracker's beat count is from a whole beat at a
// real beat time — 0 is perfectly in phase.
function phaseError(tracker: TempoTracker, beatTime: number): number {
  const beats = tracker.beatsAt(beatTime)
  return Math.abs(beats - Math.round(beats))
}

describe('TempoTracker', () => {
  for (const bpm of [90, 100, 120, 128, 140, 160]) {
    it(`finds ${bpm} BPM and locks onto the beat`, () => {
      const tracker = new TempoTracker()
      const end = play(tracker, bpm, 12)
      expect(tracker.bpm).toBeGreaterThan(bpm * 0.98)
      expect(tracker.bpm).toBeLessThan(bpm * 1.02)
      // The next real beat after `end`.
      const period = 60 / bpm
      const nextBeat = 0.13 + Math.ceil((end - 0.13) / period) * period
      expect(phaseError(tracker, nextBeat)).toBeLessThan(0.12)
    })
  }

  it('follows a change of tempo', () => {
    const tracker = new TempoTracker()
    const end = play(tracker, 120, 10)
    play(tracker, 135, 12, { start: end, offset: end + 0.05 })
    expect(tracker.bpm).toBeGreaterThan(135 * 0.98)
    expect(tracker.bpm).toBeLessThan(135 * 1.02)
  })

  it('keeps counting through silence at the last tempo', () => {
    const tracker = new TempoTracker()
    const end = play(tracker, 120, 10)
    const before = tracker.beatsAt(end)
    let t = end
    while (t < end + 4) {
      t += 1 / 30
      tracker.push(t, 0)
    }
    expect(tracker.bpm).toBeGreaterThan(118)
    expect(tracker.beatsAt(t) - before).toBeGreaterThan(7.5)
    expect(tracker.beatsAt(t) - before).toBeLessThan(8.5)
  })

  it('only ever counts forwards', () => {
    const tracker = new TempoTracker()
    let last = -Infinity
    let t = 0
    for (let i = 0; i < 30 * 15; i++) {
      t += 1 / 30
      const beat = (t % 0.47) < 0.034 ? 1 : 0
      tracker.push(t, beat)
      const beats = tracker.beatsAt(t)
      expect(beats).toBeGreaterThanOrEqual(last)
      last = beats
    }
  })

  it('reports no confidence before it has heard enough', () => {
    const tracker = new TempoTracker()
    play(tracker, 120, 1)
    expect(tracker.confidence).toBe(0)
  })
})

describe('spectralFlux', () => {
  it('is zero for an unchanged or falling spectrum and positive on a rise', () => {
    const quiet = new Uint8Array(1024)
    const loud = new Uint8Array(1024).fill(200)
    expect(spectralFlux(quiet, quiet, 48000)).toBe(0)
    expect(spectralFlux(loud, quiet, 48000)).toBe(0)
    expect(spectralFlux(quiet, loud, 48000)).toBeGreaterThan(0)
  })

  it('weighs a kick (low end) above the same rise up top', () => {
    const before = new Uint8Array(1024)
    const kick = new Uint8Array(1024)
    const hat = new Uint8Array(1024)
    for (let i = 1; i < 6; i++) kick[i] = 200 // ~23–117 Hz at 48 kHz
    for (let i = 500; i < 505; i++) hat[i] = 200 // ~11.7 kHz
    expect(spectralFlux(before, kick, 48000)).toBeGreaterThan(spectralFlux(before, hat, 48000))
  })
})
