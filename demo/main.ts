import {
  Visualizer,
  VISUALIZER_THEMES,
  analyserFromMediaElement,
  analyserFromMediaStream,
  type VisualizerThemeId,
} from '../src'

const stage = document.getElementById('stage')!
const themesEl = document.getElementById('themes')!
const optionsEl = document.getElementById('options')!
const audio = document.getElementById('audio') as HTMLAudioElement
const hint = document.getElementById('hint')!

const params = new URLSearchParams(location.search)
const visualizer = new Visualizer(stage, { theme: (params.get('theme') as VisualizerThemeId) ?? undefined })

// One AudioContext for the page; each source gets tapped once.
let context: AudioContext | null = null
let fileAnalyser: AnalyserNode | null = null
let micStream: MediaStream | null = null

function renderControls(): void {
  themesEl.replaceChildren(
    ...VISUALIZER_THEMES.map((theme, i) => {
      const button = document.createElement('button')
      button.textContent = theme.name
      button.title = `${theme.name} (${i + 1})`
      button.classList.toggle('active', theme.id === visualizer.theme.id)
      button.onclick = () => {
        visualizer.setTheme(theme.id)
        renderControls()
      }
      return button
    }),
  )
  const current = visualizer.themeOptions
  optionsEl.replaceChildren(
    ...(visualizer.theme.options ?? []).map((option) => {
      const group = document.createElement('div')
      group.className = 'group'
      const label = document.createElement('span')
      label.className = 'dim'
      label.style.alignSelf = 'center'
      label.style.marginRight = '4px'
      label.textContent = option.name
      group.append(
        label,
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
      return group
    }),
  )
}
renderControls()

document.getElementById('file')!.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  context ??= new AudioContext()
  if (!fileAnalyser) fileAnalyser = analyserFromMediaElement(audio, context).analyser
  micStream?.getTracks().forEach((t) => t.stop())
  micStream = null
  audio.src = URL.createObjectURL(file)
  audio.hidden = false
  hint.hidden = true
  context.resume()
  audio.play()
  visualizer.setAnalyser(fileAnalyser)
})

document.getElementById('mic')!.addEventListener('click', async () => {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
  } catch {
    hint.textContent = "Couldn't open the microphone."
    return
  }
  context ??= new AudioContext()
  audio.pause()
  context.resume()
  visualizer.setAnalyser(analyserFromMediaStream(micStream, context).analyser)
  hint.textContent = 'Listening to the microphone.'
})

document.getElementById('fullscreen')!.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen()
})

window.addEventListener('keydown', (e) => {
  const index = Number(e.key) - 1
  if (Number.isInteger(index) && index >= 0 && index < VISUALIZER_THEMES.length) {
    visualizer.setTheme(VISUALIZER_THEMES[index].id)
    renderControls()
  }
})

// The controls fade out after a few seconds without mouse movement.
let idleTimer = 0
function wake(): void {
  document.body.classList.remove('idle')
  clearTimeout(idleTimer)
  idleTimer = window.setTimeout(() => document.body.classList.add('idle'), 3000)
}
window.addEventListener('mousemove', wake)
wake()
