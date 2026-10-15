import type { Settings } from './types'

export const DEFAULT_FONT_FAMILY =
  '"JetBrains Mono", "SF Mono", "Cascadia Code", Menlo, Monaco, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace'

export const DEFAULT_SETTINGS: Settings = {
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: 13,
  lineHeight: 1.15,
  scrollback: 10000,
  cursorStyle: 'block',
  cursorBlink: true,
  defaultAgentId: 'claude',
  shiftEnterNewline: true,
  notifications: true,
  confirmClosePane: true,
  resumeSessions: true,
  macOptionIsMeta: false,
  agentCommandOverrides: {},
  customAgents: [],
  recentFolders: []
}

export function withDefaults(partial: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(partial ?? {}) }
}
