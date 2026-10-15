import type { MenuAction } from './types'

// One source of truth for keyboard shortcuts. macOS uses ⌘, which terminals never
// need. Elsewhere every shortcut uses Ctrl+Shift or Alt so plain Ctrl+<key>
// (Ctrl+C, Ctrl+D, Ctrl+W, ...) keeps reaching the agent running in the pane.

export interface ShortcutDef {
  action: MenuAction
  label: string
  group: 'Workspaces' | 'Panes' | 'Navigation' | 'Terminal' | 'App'
  mac?: string
  other?: string
}

const workspaceShortcuts: ShortcutDef[] = Array.from({ length: 9 }, (_, i) => ({
  action: `workspace-${i + 1}` as MenuAction,
  label: `Go to workspace ${i + 1}`,
  group: 'Workspaces' as const,
  mac: `Cmd+${i + 1}`,
  other: `Alt+${i + 1}`
}))

export const SHORTCUTS: ShortcutDef[] = [
  { action: 'new-workspace', label: 'New workspace', group: 'Workspaces', mac: 'Cmd+T', other: 'Ctrl+Shift+T' },
  { action: 'close-workspace', label: 'Close workspace', group: 'Workspaces', mac: 'Cmd+Shift+W', other: 'Ctrl+Alt+Shift+W' },
  { action: 'next-workspace', label: 'Next workspace', group: 'Workspaces', mac: 'Cmd+Shift+]', other: 'Ctrl+Tab' },
  { action: 'prev-workspace', label: 'Previous workspace', group: 'Workspaces', mac: 'Cmd+Shift+[', other: 'Ctrl+Shift+Tab' },
  ...workspaceShortcuts,

  { action: 'split-right', label: 'Split right', group: 'Panes', mac: 'Cmd+D', other: 'Ctrl+Shift+D' },
  { action: 'split-down', label: 'Split down', group: 'Panes', mac: 'Cmd+Shift+D', other: 'Ctrl+Shift+E' },
  { action: 'close-pane', label: 'Close pane', group: 'Panes', mac: 'Cmd+W', other: 'Ctrl+Shift+W' },
  { action: 'zoom-pane', label: 'Zoom / unzoom pane', group: 'Panes', mac: 'Cmd+Enter', other: 'Ctrl+Shift+Enter' },
  { action: 'restart-pane', label: 'Restart agent in pane', group: 'Panes', mac: 'Cmd+Shift+R', other: 'Ctrl+Shift+R' },
  {
    action: 'toggle-broadcast',
    label: 'Broadcast prompt to all panes',
    group: 'Panes',
    mac: 'Cmd+Shift+B',
    other: 'Ctrl+Shift+B'
  },

  { action: 'focus-left', label: 'Focus pane left', group: 'Navigation', mac: 'Cmd+Alt+Left', other: 'Ctrl+Shift+Left' },
  { action: 'focus-right', label: 'Focus pane right', group: 'Navigation', mac: 'Cmd+Alt+Right', other: 'Ctrl+Shift+Right' },
  { action: 'focus-up', label: 'Focus pane above', group: 'Navigation', mac: 'Cmd+Alt+Up', other: 'Ctrl+Shift+Up' },
  { action: 'focus-down', label: 'Focus pane below', group: 'Navigation', mac: 'Cmd+Alt+Down', other: 'Ctrl+Shift+Down' },
  { action: 'next-pane', label: 'Next pane', group: 'Navigation', mac: 'Cmd+]', other: 'Ctrl+Shift+]' },
  { action: 'prev-pane', label: 'Previous pane', group: 'Navigation', mac: 'Cmd+[', other: 'Ctrl+Shift+[' },

  { action: 'copy', label: 'Copy selection', group: 'Terminal', other: 'Ctrl+Shift+C' },
  { action: 'paste', label: 'Paste', group: 'Terminal', other: 'Ctrl+Shift+V' },
  { action: 'find', label: 'Find in pane', group: 'Terminal', mac: 'Cmd+F', other: 'Ctrl+Shift+F' },
  { action: 'clear', label: 'Clear scrollback', group: 'Terminal', mac: 'Cmd+K', other: 'Ctrl+Shift+K' },
  { action: 'font-bigger', label: 'Increase font size', group: 'Terminal', mac: 'Cmd+=', other: 'Ctrl+=' },
  { action: 'font-smaller', label: 'Decrease font size', group: 'Terminal', mac: 'Cmd+-', other: 'Ctrl+-' },
  { action: 'font-reset', label: 'Reset font size', group: 'Terminal', mac: 'Cmd+0', other: 'Ctrl+0' },

  { action: 'toggle-sidebar', label: 'Toggle sidebar', group: 'App', mac: 'Cmd+B', other: 'Ctrl+Shift+S' },
  { action: 'settings', label: 'Settings', group: 'App', mac: 'Cmd+,', other: 'Ctrl+,' },
  { action: 'shortcuts', label: 'Keyboard shortcuts', group: 'App', mac: 'Cmd+/', other: 'Ctrl+Shift+/' }
]

export function shortcutFor(action: MenuAction, isMac: boolean): string | undefined {
  const def = SHORTCUTS.find((s) => s.action === action)
  return isMac ? def?.mac : def?.other
}

interface ParsedAccelerator {
  meta: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
  code: string
}

const KEY_CODES: Record<string, string> = {
  Enter: 'Enter',
  Tab: 'Tab',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ',': 'Comma',
  '=': 'Equal',
  '-': 'Minus',
  '/': 'Slash'
}

export function parseAccelerator(accel: string): ParsedAccelerator {
  // Split on '+' but keep a trailing '+' key intact (not used today, but cheap to support).
  const parts = accel.split('+')
  const key = parts.pop() ?? ''
  const mods = new Set(parts)
  let code = KEY_CODES[key]
  if (!code) {
    if (/^[A-Z]$/i.test(key)) code = `Key${key.toUpperCase()}`
    else if (/^[0-9]$/.test(key)) code = `Digit${key}`
    else code = key
  }
  return { meta: mods.has('Cmd'), ctrl: mods.has('Ctrl'), shift: mods.has('Shift'), alt: mods.has('Alt'), code }
}

interface KeyLike {
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  code: string
}

const parsedCache = new Map<string, ParsedAccelerator>()

export function matchesAccelerator(e: KeyLike, accel: string): boolean {
  let parsed = parsedCache.get(accel)
  if (!parsed) {
    parsed = parseAccelerator(accel)
    parsedCache.set(accel, parsed)
  }
  let code = e.code
  // Numpad digits / enter behave like their main-keyboard twins.
  if (code.startsWith('Numpad') && /\d$/.test(code)) code = `Digit${code.slice(-1)}`
  if (code === 'NumpadEnter') code = 'Enter'
  if (code === 'NumpadAdd' && parsed.code === 'Equal') code = 'Equal'
  if (code === 'NumpadSubtract') code = 'Minus'
  return (
    code === parsed.code &&
    e.metaKey === parsed.meta &&
    e.ctrlKey === parsed.ctrl &&
    e.shiftKey === parsed.shift &&
    e.altKey === parsed.alt
  )
}

export function matchShortcut(e: KeyLike, isMac: boolean): MenuAction | null {
  for (const def of SHORTCUTS) {
    const accel = isMac ? def.mac : def.other
    if (accel && matchesAccelerator(e, accel)) return def.action
  }
  return null
}

/** Electron menu accelerator syntax. */
export function toElectronAccelerator(accel: string): string {
  return accel
    .split('+')
    .map((p) => (p === 'Cmd' ? 'Command' : p === 'Ctrl' ? 'Control' : p === 'Alt' ? 'Alt' : p))
    .join('+')
}

/** Human-friendly label: ⌘⇧D on macOS, Ctrl+Shift+D elsewhere. */
export function formatAccelerator(accel: string | undefined, isMac: boolean): string {
  if (!accel) return ''
  const parts = accel.split('+')
  if (!isMac) {
    return parts.map((p) => ({ Left: '←', Right: '→', Up: '↑', Down: '↓' })[p] ?? p).join('+')
  }
  const symbols: Record<string, string> = {
    Cmd: '⌘',
    Ctrl: '⌃',
    Shift: '⇧',
    Alt: '⌥',
    Enter: '↩',
    Left: '←',
    Right: '→',
    Up: '↑',
    Down: '↓',
    Tab: '⇥'
  }
  // macOS convention orders modifiers ⌃⌥⇧⌘.
  const order = ['Ctrl', 'Alt', 'Shift', 'Cmd']
  const key = parts.pop() ?? ''
  const mods = parts.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return [...mods, key].map((p) => symbols[p] ?? p).join('')
}
