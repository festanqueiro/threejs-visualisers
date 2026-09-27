// Frequency-band and beat analysis feeding the visualisers. The pure
// helpers (computeBands, BeatDetector) take raw AnalyserNode output so
// they're testable without a real AudioContext.

export interface Bands {
  bass: number // 0..1
  mid: number // 0..1
  high: number // 0..1
}

const BASS_HZ: [number, number] = [20, 250]
const MID_HZ: [number, number] = [250, 4000]
const HIGH_HZ: [number, number] = [4000, 16000]

function averageRange(freq: Uint8Array, binHz: number, [lo, hi]: [number, number]): number {
  const start = Math.max(0, Math.floor(lo / binHz))
  const end = Math.min(freq.length - 1, Math.ceil(hi / binHz))
  if (end < start) return 0
  let sum = 0
  for (let i = start; i <= end; i++) sum += freq[i]
  return sum / (end - start + 1) / 255
}

// `freq` is getByteFrequencyData() output: freq.length === fftSize / 2
// bins spanning 0..sampleRate/2.
export function computeBands(freq: Uint8Array, sampleRate: number): Bands {
  const binHz = sampleRate / 2 / freq.length
  return {
    bass: averageRange(freq, binHz, BASS_HZ),
    mid: averageRange(freq, binHz, MID_HZ),
    high: averageRange(freq, binHz, HIGH_HZ),
  }
}

// Flags a kick when bass energy jumps well above its own recent average —
// a fixed threshold would either fire constantly on bass-heavy tracks or
// never on quiet ones. The refractory period stops one kick's decay from
// registering as several beats.
export class BeatDetector {
  private average = 0
  private lastBeatMs = -Infinity
  private lastMs: number | null = null

  constructor(
    private readonly sensitivity = 1.35,
    private readonly minLevel = 0.25,
    private readonly refractoryMs = 250,
    private readonly smoothing = 0.93,
  ) {}

  update(bass: number, nowMs: number): boolean {
    const isBeat =
      bass > this.minLevel && bass > this.average * this.sensitivity && nowMs - this.lastBeatMs >= this.refractoryMs
    // `smoothing` is per 60 fps frame; scaled to the time since the last
    // call so the average spans the same time at any frame rate.
    const frames = this.lastMs === null ? 1 : Math.min(6, Math.max(0, (nowMs - this.lastMs) / (1000 / 60)))
    this.lastMs = nowMs
    const keep = Math.pow(this.smoothing, frames)
    this.average = this.average * keep + bass * (1 - keep)
    if (isBeat) this.lastBeatMs = nowMs
    return isBeat
  }
}

// Splits the spectrum into `bars` log-spaced [startBin, endBin] ranges
// (inclusive) between minHz and maxHz, so each bar covers a similar
// musical range — linear bins would spend nearly every bar on treble.
export function logBinRanges(
  binCount: number,
  sampleRate: number,
  bars: number,
  minHz: number,
  maxHz: number,
): Array<[number, number]> {
  const binHz = sampleRate / 2 / binCount
  const ranges: Array<[number, number]> = []
  for (let i = 0; i < bars; i++) {
    const lo = minHz * (maxHz / minHz) ** (i / bars)
    const hi = minHz * (maxHz / minHz) ** ((i + 1) / bars)
    const start = Math.min(binCount - 1, Math.floor(lo / binHz))
    const end = Math.min(binCount - 1, Math.max(start, Math.ceil(hi / binHz)))
    ranges.push([start, end])
  }
  return ranges
}

// Attack fast, release slow — raw analyser values flicker too much to
// drive visuals directly. `attack` and `release` are per 60 fps frame; pass
// the frame's `dt` (seconds) and they're scaled to it, so the motion looks
// the same at 30 fps or 120.
export function follow(current: number, target: number, attack = 0.5, release = 0.08, dt = 1 / 60): number {
  const rate = target > current ? attack : release
  return current + (target - current) * (1 - Math.pow(1 - rate, dt * 60))
}

// Convenience for the common case: taps an <audio>/<video> element with
// an AnalyserNode while it keeps playing through the speakers. Call it
// from a user gesture (a click), or resume() the returned context from
// one — browsers start AudioContexts suspended otherwise. An element can
// only be tapped once (createMediaElementSource's rule), so keep the
// result around rather than calling this again for the same element.
export function analyserFromMediaElement(
  element: HTMLMediaElement,
  context: AudioContext = new AudioContext(),
): { context: AudioContext; analyser: AnalyserNode } {
  const source = context.createMediaElementSource(element)
  const analyser = createAnalyser(context)
  source.connect(analyser)
  analyser.connect(context.destination)
  return { context, analyser }
}

// Same for a live MediaStream (microphone, line-in, screen capture). The
// stream isn't routed to the speakers, so a microphone doesn't feed back.
export function analyserFromMediaStream(
  stream: MediaStream,
  context: AudioContext = new AudioContext(),
): { context: AudioContext; analyser: AnalyserNode } {
  const analyser = createAnalyser(context)
  context.createMediaStreamSource(stream).connect(analyser)
  return { context, analyser }
}

// The analyser settings the themes are tuned for.
export function createAnalyser(context: BaseAudioContext): AnalyserNode {
  const analyser = context.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.8
  return analyser
}
