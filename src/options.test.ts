import { describe, expect, it } from 'vitest'
import { resolveThemeOptions, visibleThemeOptions } from './options'
import type { VisualizerTheme } from './types'

const theme = {
  id: 'soundsystem',
  name: 'Test',
  create: () => {
    throw new Error('not rendered')
  },
  options: [
    { id: 'stack', name: 'Stack', values: [{ id: 'classic', name: 'Classic' }, { id: 'mb', name: 'MB' }] },
    { id: 'mode', name: 'Mode', when: { stack: ['mb'] }, values: [{ id: 'standing', name: 'Standing' }, { id: 'dancing', name: 'Dancing' }] },
  ],
} as VisualizerTheme

describe('theme options', () => {
  it('keeps valid choices and fills the rest with first values', () => {
    expect(resolveThemeOptions(theme, { stack: 'mb', mode: 'moonwalk' })).toEqual({ stack: 'mb', mode: 'standing' })
    expect(resolveThemeOptions(theme)).toEqual({ stack: 'classic', mode: 'standing' })
  })

  it("hides options whose `when` isn't met", () => {
    expect(visibleThemeOptions(theme, { stack: 'classic' }).map((o) => o.id)).toEqual(['stack'])
    expect(visibleThemeOptions(theme, { stack: 'mb' }).map((o) => o.id)).toEqual(['stack', 'mode'])
  })
})
