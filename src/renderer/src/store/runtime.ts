import { create } from 'zustand'

export type PaneStatus = 'starting' | 'running' | 'idle' | 'exited'

export interface PaneRuntime {
  status: PaneStatus
  attention: boolean
  /** Window title set by the program (OSC 0/2), e.g. Claude Code's task name. */
  title: string
  exitCode?: number
  error?: string
  /** Last notification text from the program (OSC 9 / 777). */
  message?: string
}

interface RuntimeState {
  panes: Record<string, PaneRuntime>
  windowFocused: boolean
}

export const useRuntime = create<RuntimeState>(() => ({
  panes: {},
  windowFocused: typeof document !== 'undefined' ? document.hasFocus() : true
}))

const EMPTY: PaneRuntime = { status: 'starting', attention: false, title: '' }

export function paneRuntime(paneId: string): PaneRuntime {
  return useRuntime.getState().panes[paneId] ?? EMPTY
}

export function usePaneRuntime(paneId: string): PaneRuntime {
  return useRuntime((s) => s.panes[paneId] ?? EMPTY)
}

export function patchPane(paneId: string, patch: Partial<PaneRuntime>): void {
  useRuntime.setState((s) => {
    const current = s.panes[paneId] ?? EMPTY
    let changed = false
    for (const key of Object.keys(patch) as (keyof PaneRuntime)[]) {
      if (current[key] !== patch[key]) {
        changed = true
        break
      }
    }
    if (!changed) return s
    return { panes: { ...s.panes, [paneId]: { ...current, ...patch } } }
  })
}

export function dropPane(paneId: string): void {
  useRuntime.setState((s) => {
    if (!(paneId in s.panes)) return s
    const panes = { ...s.panes }
    delete panes[paneId]
    return { panes }
  })
}
