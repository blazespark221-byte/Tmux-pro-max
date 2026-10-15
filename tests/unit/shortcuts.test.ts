import { describe, expect, it } from 'vitest'
import { SHORTCUTS, formatAccelerator, matchShortcut, toElectronAccelerator } from '@shared/shortcuts'
import { commandBinary } from '@shared/agents'

const key = (code: string, mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }> = {}) => ({
  code,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt
})

describe('shortcuts', () => {
  it('matches mac shortcuts on Cmd', () => {
    expect(matchShortcut(key('KeyD', { meta: true }), true)).toBe('split-right')
    expect(matchShortcut(key('KeyD', { meta: true, shift: true }), true)).toBe('split-down')
    expect(matchShortcut(key('Digit3', { meta: true }), true)).toBe('workspace-3')
    expect(matchShortcut(key('ArrowLeft', { meta: true, alt: true }), true)).toBe('focus-left')
  })

  it('never steals plain Ctrl+<key> from the terminal on Linux/Windows', () => {
    for (const code of ['KeyC', 'KeyD', 'KeyW', 'KeyT', 'KeyR', 'KeyB', 'KeyE', 'KeyK', 'KeyL', 'KeyZ']) {
      expect(matchShortcut(key(code, { ctrl: true }), false)).toBeNull()
    }
    expect(matchShortcut(key('KeyD', { ctrl: true, shift: true }), false)).toBe('split-right')
    expect(matchShortcut(key('KeyV', { ctrl: true, shift: true }), false)).toBe('paste')
  })

  it('has no duplicate accelerators per platform', () => {
    for (const platform of ['mac', 'other'] as const) {
      const accels = SHORTCUTS.map((s) => s[platform]).filter(Boolean)
      expect(new Set(accels).size).toBe(accels.length)
    }
  })

  it('formats accelerators', () => {
    expect(formatAccelerator('Cmd+Shift+D', true)).toBe('⇧⌘D')
    expect(formatAccelerator('Ctrl+Shift+D', false)).toBe('Ctrl+Shift+D')
    expect(toElectronAccelerator('Cmd+Alt+Left')).toBe('Command+Alt+Left')
  })
})

describe('agents', () => {
  it('extracts the binary from a command line', () => {
    expect(commandBinary('claude --dangerously-skip-permissions')).toBe('claude')
    expect(commandBinary('FOO=1 BAR=2 codex')).toBe('codex')
    expect(commandBinary(null)).toBeNull()
  })
})
