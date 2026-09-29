import { nebulaTheme } from './nebula'
import { warpTheme } from './warp'
import { horizonTheme } from './horizon'
import { soundSystemTheme } from './soundsystem'
import { smokeTheme } from './smoke'
import { kaleidoscopeTheme } from './kaleidoscope'
import { paintTheme } from './paint'
import { liquidTheme } from './liquid'
import { reefTheme } from './reef'
import type { VisualizerTheme, VisualizerThemeId } from '../types'

// Every built-in theme, in picker order.
export const VISUALIZER_THEMES: VisualizerTheme[] = [
  nebulaTheme,
  warpTheme,
  horizonTheme,
  soundSystemTheme,
  smokeTheme,
  kaleidoscopeTheme,
  paintTheme,
  liquidTheme,
  reefTheme,
]

export function getVisualizerTheme(id: VisualizerThemeId): VisualizerTheme {
  return VISUALIZER_THEMES.find((theme) => theme.id === id) ?? VISUALIZER_THEMES[0]
}
