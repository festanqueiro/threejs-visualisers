// Tempo and beat tracking from the spectrum, so themes can move in time
// with the music rather than just reacting to each kick as it lands.
//
// Each frame, spectralFlux() turns the spectrum into an onset strength —
// how much louder it just got, kicks counting most. TempoTracker keeps the
// last few seconds of that on an even 100 Hz grid and, several times a
// second, finds the period it repeats at (autocorrelation, favouring
// tempos near 120 BPM and periods confirmed at two beats), then where the
// beats fall within it (a comb over the recent onsets). A beat counter
// runs on at that tempo between estimates and is steered — only ever
// sped up or slowed, never stepped back — to land each beat on time.
// Through silence or breakdowns it keeps counting at the last tempo.

import { logBinRanges } from './audio'

const RATE = 100 // grid samples per second
const HISTORY = 8 // seconds of onsets kept
const MIN_SECONDS = 4 // heard before the first estimate
const ESTIMATE_EVERY = 25 // grid samples (a quarter second)
const MIN_BPM = 70
const MAX_BPM = 180
// Onsets show up a little after the sound: the frame they're sampled on
// comes up to a frame later. Beats are placed this much earlier.
const LATENCY = 0.015 // seconds
// Phase corrections are spread over this long, until the next estimate.
const STEER_SECONDS = ESTIMATE_EVERY / RATE

// Onset strength between two spectra (getByteFrequencyData output): the
// summed rise in level, the low end (kick) weighted most, the mids
// (snare, claps) next, the top (hats) least. Log-compressed so a loud
// track doesn't drown the tempo estimate in its biggest hits.
export function spectralFlux(previous: Uint8Array, current: Uint8Array, sampleRate: number): number {
  if (previous.length !== current.length || current.length === 0) return 0
  const binHz = sampleRate / 2 / current.length
  let flux = 0
  for (let i = 1; i < current.length; i++) {
    const rise = current[i] - previous[i]
    if (rise <= 0) continue
    const hz = i * binHz
    const weight = hz < 150 ? 3 : hz < 4000 ? 1 : 0.4
    flux += rise * weight
  }
  return Math.log1p(flux / 255 / 8)
}

export class TempoTracker {
  private readonly envelope = new Float32Array(HISTORY * RATE)
  private written = 0 // grid samples written, ever
  private lastTime: number | null = null
  private lastValue = 0
  private untilEstimate = ESTIMATE_EVERY
  private period = 0.5 // seconds per beat
  private beats = 0 // beat count at lastTime
  private rateTweak = 0 // fraction faster/slower, steering the phase
  private tweakUntil = -Infinity // ...until this time
  private lastGrid = 0 // grid index of the newest sample
  private candidate = 0 // a different tempo seen, waiting to be confirmed
  private candidateCount = 0
  private found = false
  private locked = false
  confidence = 0 // 0..1, how clearly the music repeats at `bpm`

  get bpm(): number {
    return 60 / this.period
  }

  // The beat count at `time` (seconds, at or after the last push):
  // whole numbers fall on the beats.
  beatsAt(time: number): number {
    if (this.lastTime === null) return this.beats
    const elapsed = Math.max(0, time - this.lastTime)
    const steered = Math.min(elapsed, Math.max(0, this.tweakUntil - this.lastTime))
    return this.beats + (elapsed + steered * this.rateTweak) / this.period
  }

  push(time: number, onset: number): void {
    if (this.lastTime === null) {
      this.lastTime = time
      this.lastValue = onset
      return
    }
    const previousTime = this.lastTime
    const previousValue = this.lastValue
    const dt = time - previousTime
    if (dt <= 0) return
    // Bring the count up to now first; estimates below then steer from here.
    this.beats = this.beatsAt(time)
    this.lastTime = time
    this.lastValue = onset
    // Resample onto the grid; a long gap (a stall, a hidden tab) is silence.
    const gridStart = Math.ceil(previousTime * RATE)
    const gridEnd = Math.floor(time * RATE)
    for (let g = gridStart; g <= gridEnd; g++) {
      const f = (g / RATE - previousTime) / dt
      this.lastGrid = g
      this.write(dt > 0.5 ? 0 : previousValue + (onset - previousValue) * f)
    }
  }

  private write(value: number): void {
    this.envelope[this.written % this.envelope.length] = value
    this.written++
    if (--this.untilEstimate <= 0) {
      this.untilEstimate = ESTIMATE_EVERY
      this.estimate()
    }
  }

  // The last `n` grid samples, oldest first, less their mean.
  private recent(n: number): Float32Array {
    const out = new Float32Array(n)
    let mean = 0
    for (let i = 0; i < n; i++) {
      out[i] = this.envelope[(this.written - n + i) % this.envelope.length]
      mean += out[i]
    }
    mean /= n
    for (let i = 0; i < n; i++) out[i] -= mean
    return out
  }

  private estimate(): void {
    const n = Math.min(this.written, this.envelope.length)
    if (n < MIN_SECONDS * RATE) return
    const x = this.recent(n)
    const autocorrelation = (lag: number) => {
      let sum = 0
      for (let i = lag; i < n; i++) sum += x[i] * x[i - lag]
      return sum / (n - lag)
    }
    const energy = autocorrelation(0)
    if (energy <= 1e-9) {
      this.confidence = 0
      return
    }

    // Tempo: the lag that repeats best, backed up by its double (a
    // two-beat repeat), leaning towards tempos near 120 BPM so a beat
    // isn't read at half or double speed without good reason.
    const minLag = Math.floor((60 / MAX_BPM) * RATE)
    const maxLag = Math.ceil((60 / MIN_BPM) * RATE)
    const scores = new Float32Array(maxLag + 2)
    let best = minLag
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
      const bpm = (60 * RATE) / lag
      const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.7) ** 2)
      scores[lag] = prior * (autocorrelation(lag) + 0.5 * autocorrelation(lag * 2))
      if (lag >= minLag && lag <= maxLag && scores[lag] > scores[best]) best = lag
    }
    // Between grid samples: fit a parabola through the peak.
    const [a, b, c] = [scores[best - 1], scores[best], scores[best + 1]]
    const curve = a - 2 * b + c
    const lag = best + (curve < 0 ? (0.5 * (a - c)) / curve : 0)
    const measured = lag / RATE
    this.confidence = Math.max(0, Math.min(1, autocorrelation(best) / energy))
    if (this.confidence < 0.05) return

    if (!this.found) {
      this.found = true
      this.period = measured
    } else if (Math.abs(measured / this.period - 1) < 0.04) {
      this.period += (measured - this.period) * 0.3
      this.candidateCount = 0
    } else {
      // A different tempo has to show up a few times running before we
      // switch — longer for a half/double reading, the classic mistake.
      const ratio = measured / this.period
      const octave = Math.abs(ratio - 2) < 0.08 || Math.abs(ratio - 0.5) < 0.04
      if (this.candidateCount > 0 && Math.abs(measured / this.candidate - 1) < 0.04) this.candidateCount++
      else {
        this.candidate = measured
        this.candidateCount = 1
      }
      if (this.candidateCount >= (octave ? 12 : 3)) {
        this.period = this.candidate
        this.candidateCount = 0
      }
    }

    // Phase: of the offsets back from now, the one whose every-period
    // comb lands on the strongest onsets (recent ones counting most) is
    // where the last beat fell.
    const steps = this.period * RATE
    let bestOffset = 0
    let bestSum = -Infinity
    for (let offset = 0; offset < steps; offset++) {
      let sum = 0
      let weight = 1
      for (let k = 0; ; k++) {
        const i = Math.round(n - 1 - offset - k * steps)
        if (i < 0) break
        sum += x[i] * weight
        weight *= 0.85
      }
      if (sum > bestSum) {
        bestSum = sum
        bestOffset = offset
      }
    }
    // Where the count should be now: a whole beat, plus however far we
    // are past it (from the newest sample to now, and the onset delay).
    const since = bestOffset + (this.lastTime! * RATE - this.lastGrid) + LATENCY * RATE
    const wanted = (since / steps) % 1
    const have = this.beats - Math.floor(this.beats)
    if (!this.locked) {
      // First lock: jump the count into phase — forwards, never back.
      this.locked = true
      let beats = Math.floor(this.beats) + wanted
      if (beats < this.beats) beats += 1
      this.beats = beats
      return
    }
    let error = wanted - have
    if (error > 0.5) error -= 1
    if (error < -0.5) error += 1
    // Steer: run that much fast or slow (in beats) over the next quarter
    // second, so the count never goes backwards.
    this.rateTweak = Math.max(-0.3, Math.min(0.3, (error * this.period) / STEER_SECONDS))
    this.tweakUntil = this.lastTime! + STEER_SECONDS
  }
}
