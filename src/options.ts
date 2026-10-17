import type { ThemeOption, VisualizerTheme } from './types'

// A theme's option values with defaults filled in: each of `wanted` that
// the theme still offers, otherwise the option's first value. Handy for
// restoring saved choices.
export function resolveThemeOptions(theme: VisualizerTheme, wanted: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    (theme.options ?? []).map((option) => {
      const value = wanted[option.id]
      return [option.id, option.values.some((v) => v.id === value) ? value : option.values[0].id]
    }),
  )
}

// The options a picker should show alongside `values` (the theme's
// current choices): those whose `when` is met, e.g. Sound System's Mode
// only for the Mais Baixo stack.
export function visibleThemeOptions(theme: VisualizerTheme, values: Record<string, string>): ThemeOption[] {
  return (theme.options ?? []).filter((option) =>
    Object.entries(option.when ?? {}).every(([otherId, allowed]) => allowed.includes(values[otherId])),
  )
}
