import {
  Visualizer,
  VISUALIZER_THEMES,
  DEFAULT_FPS,
  FPS_CHOICES,
  analyserFromMediaElement,
  createAnalyser,
  type VisualizerThemeId,
} from '../src'

const stage = document.getElementById('stage')!
const themesEl = document.getElementById('themes')!
const optionsEl = document.getElementById('options')!
const audio = document.getElementById('audio') as HTMLAudioElement
const micButton = document.getElementById('mic')!
const tabButton = document.getElementById('tab')!
const hint = document.getElementById('hint')!

const params = new URLSearchParams(location.search)
const visualizer = new Visualizer(stage, {
  theme: (params.get('theme') as VisualizerThemeId) ?? undefined,
  fps: params.has('fps') ? Number(params.get('fps')) : DEFAULT_FPS,
})

// Frame-rate picker (also ?fps=, 0 for no cap).
const fpsSelect = document.getElementById('fps') as HTMLSelectElement
for (const choice of FPS_CHOICES) fpsSelect.append(new Option(choice.label, String(choice.fps)))
fpsSelect.value = String(Math.round(visualizer.fps))
fpsSelect.addEventListener('change', () => {
  visualizer.setFps(Number(fpsSelect.value))
  fpsSelect.blur()
})

// One AudioContext for the page; each source gets tapped once.
let context: AudioContext | null = null
let fileAnalyser: AnalyserNode | null = null

// A live stream being visualised: the microphone, or audio shared from a tab
// or the whole screen. Only one runs at a time.
type LiveKind = 'mic' | 'tab'
const liveButtons: Record<LiveKind, { button: HTMLElement; start: string; stop: string; label: string }> = {
  mic: { button: micButton, start: 'Use microphone', stop: 'Stop microphone', label: 'microphone' },
  tab: { button: tabButton, start: 'Share tab audio', stop: 'Stop sharing', label: 'shared audio' },
}
let live: { kind: LiveKind; stream: MediaStream; source: MediaStreamAudioSourceNode } | null = null

// Whether the chosen theme's sub options are showing to the right of it.
let optionsOpen = false

function renderControls(): void {
  let activeButton: HTMLButtonElement | null = null
  themesEl.replaceChildren(
    ...VISUALIZER_THEMES.map((theme, i) => {
      const button = document.createElement('button')
      button.textContent = theme.name
      button.title = `${theme.name} (${i + 1})`
      const active = theme.id === visualizer.theme.id
      button.classList.toggle('active', active)
      if (active) activeButton = button
      button.onclick = () => {
        // Choosing a theme opens its options; clicking it again closes them.
        optionsOpen = active ? !optionsOpen : true
        visualizer.setTheme(theme.id)
        renderControls()
      }
      return button
    }),
  )

  const options = visualizer.theme.options ?? []
  optionsEl.hidden = !optionsOpen || options.length === 0
  if (optionsEl.hidden) return
  const current = visualizer.themeOptions
  optionsEl.replaceChildren(
    ...options.map((option) => {
      const section = document.createElement('div')
      const label = document.createElement('div')
      label.className = 'label'
      label.textContent = option.name
      const group = document.createElement('div')
      group.className = 'group'
      group.append(
        ...option.values.map((value) => {
          const button = document.createElement('button')
          button.textContent = value.name
          button.classList.toggle('active', current[option.id] === value.id)
          button.onclick = () => {
            visualizer.setOption(option.id, value.id)
            renderControls()
          }
          return button
        }),
      )
      section.append(label, group)
      return section
    }),
  )
  placeOptions(activeButton!)
}

// Lines the options panel up with the chosen theme, just right of the column,
// keeping it on screen.
function placeOptions(anchor: HTMLElement): void {
  const column = themesEl.getBoundingClientRect()
  const top = anchor.getBoundingClientRect().top - 10
  const maxTop = window.innerHeight - optionsEl.offsetHeight - 16
  optionsEl.style.left = `${column.right + 8}px`
  optionsEl.style.top = `${Math.max(16, Math.min(top, maxTop))}px`
}

function closeOptions(): void {
  optionsOpen = false
  renderControls()
}
renderControls()

function showHint(text: string): void {
  hint.textContent = text
  hint.hidden = false
}

function stopLive(): void {
  if (!live) return
  const { kind, stream, source } = live
  live = null
  source.disconnect()
  stream.getTracks().forEach((t) => t.stop())
  liveButtons[kind].button.textContent = liveButtons[kind].start
  liveButtons[kind].button.classList.remove('active')
}

function startLive(kind: LiveKind, stream: MediaStream): void {
  stopLive()
  context ??= new AudioContext()
  audio.pause()
  context.resume()
  // Keep the source node so stopping can disconnect it.
  const source = context.createMediaStreamSource(stream)
  const analyser = createAnalyser(context)
  source.connect(analyser)
  live = { kind, stream, source }
  visualizer.setAnalyser(analyser)
  const { button, stop, label } = liveButtons[kind]
  button.textContent = stop
  button.classList.add('active')
  showHint(`Listening to the ${label}.`)
  // Ending the share from the browser's own bar (or unplugging the mic)
  // ends the tracks; follow along.
  stream.getAudioTracks()[0].addEventListener('ended', () => {
    if (live?.stream === stream) toggleOff(kind)
  })
}

function toggleOff(kind: LiveKind): void {
  stopLive()
  visualizer.setAnalyser(audio.paused ? null : fileAnalyser)
  showHint(`${liveButtons[kind].label[0].toUpperCase()}${liveButtons[kind].label.slice(1)} off.`)
}

document.getElementById('file')!.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  context ??= new AudioContext()
  if (!fileAnalyser) fileAnalyser = analyserFromMediaElement(audio, context).analyser
  audio.src = URL.createObjectURL(file)
  audio.hidden = false
  hint.hidden = true
  context.resume()
  audio.play()
})

// Playing the file (from the picker or its own controls) takes over from any
// live source.
audio.addEventListener('play', () => {
  stopLive()
  visualizer.setAnalyser(fileAnalyser)
})

micButton.addEventListener('click', async () => {
  if (live?.kind === 'mic') return toggleOff('mic')
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    startLive('mic', stream)
  } catch {
    showHint("Couldn't open the microphone.")
  }
})

// Captures a tab's (or, where the browser allows, the whole system's) audio via
// the screen-share picker. Chrome only offers audio alongside video, so video
// is requested and its track dropped straight away.
tabButton.addEventListener('click', async () => {
  if (live?.kind === 'tab') return toggleOff('tab')
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return showHint("This browser can't share audio. Try Chrome or Edge.")
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      // Open the picker on tabs: windows and screens usually carry no audio.
      video: { displaySurface: 'browser' },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Chrome hints: hide the demo's own tab, include system audio where supported.
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      systemAudio: 'include',
    } as DisplayMediaStreamOptions)
  } catch {
    return showHint('Sharing was cancelled.')
  }
  stream.getVideoTracks().forEach((t) => {
    t.stop()
    stream.removeTrack(t)
  })
  if (stream.getAudioTracks().length === 0) {
    return showHint(`No audio was shared. Windows and screens don't carry audio — in Chrome or Edge, pick a tab with "Share tab audio" on.`)
  }
  startLive('tab', stream)
})

document.getElementById('fullscreen')!.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen()
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return closeOptions()
  const index = Number(e.key) - 1
  if (Number.isInteger(index) && index >= 0 && index < VISUALIZER_THEMES.length) {
    visualizer.setTheme(VISUALIZER_THEMES[index].id)
    renderControls()
  }
})

// Clicking the visual closes the options panel.
stage.addEventListener('click', closeOptions)
window.addEventListener('resize', () => renderControls())

// The controls fade out after a few seconds without mouse movement.
let idleTimer = 0
function wake(): void {
  document.body.classList.remove('idle')
  clearTimeout(idleTimer)
  idleTimer = window.setTimeout(() => document.body.classList.add('idle'), 3000)
}
window.addEventListener('mousemove', wake)
wake()
