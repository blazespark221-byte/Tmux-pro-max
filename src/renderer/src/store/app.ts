import { useMemo } from 'react'
import { create } from 'zustand'
import { BUILTIN_AGENTS, SHELL_AGENT_ID, findAgent, resolveAgents } from '@shared/agents'
import { DEFAULT_SETTINGS, withDefaults } from '@shared/defaults'
import {
  computeGeometry,
  equalize,
  newId,
  paneIdsInOrder,
  removePane,
  retile,
  setSplitSizes,
  splitPane,
  swapPanes
} from '@shared/layout'
import type { AgentDef, LayoutNode, PaneConfig, PersistedState, Settings, SplitDirection, Workspace } from '@shared/types'

export type Modal =
  | { type: 'new-workspace' }
  | { type: 'settings' }
  | { type: 'shortcuts' }
  | {
      type: 'confirm'
      title: string
      message: string
      confirmLabel: string
      danger?: boolean
      resolve: (ok: boolean) => void
    }

/** A workspace whose layout may be empty after its last pane was closed. */
export interface WorkspaceState extends Omit<Workspace, 'layout'> {
  layout: LayoutNode | null
}

interface AppState {
  workspaces: WorkspaceState[]
  activeWorkspaceId: string | null
  settings: Settings
  sidebarVisible: boolean
  modal: Modal | null
  broadcastOpen: boolean
  /** Panes excluded from broadcast (everything else in the workspace receives it). */
  broadcastExcluded: Record<string, true>
  /** Binary name → found on PATH. */
  installed: Record<string, boolean>
  /** Workspaces whose terminals have been started this session (lazy start). */
  activated: Record<string, true>
  /** Bumped to remount (and so restart) a pane's terminal. */
  generations: Record<string, number>
  findPaneId: string | null
}

export const useApp = create<AppState>(() => ({
  workspaces: [],
  activeWorkspaceId: null,
  settings: DEFAULT_SETTINGS,
  sidebarVisible: true,
  modal: null,
  broadcastOpen: false,
  broadcastExcluded: {},
  installed: {},
  activated: {},
  generations: {},
  findPaneId: null
}))

const get = useApp.getState
const set = useApp.setState

// ---- Selectors ----------------------------------------------------------

export function agentsOf(settings: Settings): AgentDef[] {
  return resolveAgents(settings)
}

export function useAgents(): AgentDef[] {
  const overrides = useApp((s) => s.settings.agentCommandOverrides)
  const custom = useApp((s) => s.settings.customAgents)
  return useMemo(() => resolveAgents({ agentCommandOverrides: overrides, customAgents: custom }), [overrides, custom])
}

export function getAgent(agentId: string): AgentDef {
  return findAgent(agentsOf(get().settings), agentId)
}

export function activeWorkspace(): WorkspaceState | undefined {
  const { workspaces, activeWorkspaceId } = get()
  return workspaces.find((w) => w.id === activeWorkspaceId)
}

export function findWorkspace(id: string): WorkspaceState | undefined {
  return get().workspaces.find((w) => w.id === id)
}

export function workspaceOfPane(paneId: string): WorkspaceState | undefined {
  return get().workspaces.find((w) => paneId in w.panes)
}

// ---- Persistence --------------------------------------------------------

function snapshot(): PersistedState {
  const { workspaces, activeWorkspaceId, settings } = get()
  return {
    version: 1,
    // Persisted workspaces always have a layout; an empty one is stored as a null-layout workspace.
    workspaces: workspaces as unknown as Workspace[],
    activeWorkspaceId,
    settings
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    window.tpm.state.save(snapshot())
  }, 400)
}

export async function hydrateStore(): Promise<void> {
  const saved = await window.tpm.state.load()
  if (saved) {
    const workspaces = (saved.workspaces as unknown as WorkspaceState[]).filter((w) => w && w.id && w.panes)
    const activeWorkspaceId = workspaces.some((w) => w.id === saved.activeWorkspaceId)
      ? saved.activeWorkspaceId
      : (workspaces[0]?.id ?? null)
    set({
      workspaces,
      activeWorkspaceId,
      settings: withDefaults(saved.settings),
      activated: activeWorkspaceId ? { [activeWorkspaceId]: true } : {}
    })
  }

  useApp.subscribe((state, prev) => {
    if (
      state.workspaces !== prev.workspaces ||
      state.activeWorkspaceId !== prev.activeWorkspaceId ||
      state.settings !== prev.settings
    ) {
      scheduleSave()
    }
  })
  window.addEventListener('beforeunload', () => {
    if (saveTimer) clearTimeout(saveTimer)
    window.tpm.state.saveSync(snapshot())
  })
}

// ---- Helpers ------------------------------------------------------------

function updateWorkspace(id: string, fn: (w: WorkspaceState) => WorkspaceState): void {
  set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? fn(w) : w)) }))
}

export function newPaneConfig(agentId: string, cwd: string, extra: Partial<PaneConfig> = {}): PaneConfig {
  const agent = getAgent(agentId)
  return {
    id: newId(),
    agentId,
    cwd,
    sessionId: agent.sessions ? newId() : undefined,
    ...extra
  }
}

export function confirmDialog(opts: {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = get().modal
    if (previous?.type === 'confirm') previous.resolve(false)
    set({
      modal: {
        type: 'confirm',
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'OK',
        danger: opts.danger,
        resolve: (ok) => {
          set({ modal: null })
          resolve(ok)
        }
      }
    })
  })
}

// ---- Actions ------------------------------------------------------------

export const actions = {
  setModal(modal: Modal | null): void {
    const current = get().modal
    if (current?.type === 'confirm' && current !== modal) current.resolve(false)
    set({ modal })
  },

  createWorkspace(input: { name: string; cwd: string; layout: LayoutNode; panes: PaneConfig[] }): string {
    const id = newId()
    const panes: Record<string, PaneConfig> = {}
    for (const p of input.panes) panes[p.id] = p
    const workspace: WorkspaceState = {
      id,
      name: input.name,
      cwd: input.cwd,
      layout: input.layout,
      panes,
      focusedPaneId: paneIdsInOrder(input.layout)[0] ?? null,
      zoomedPaneId: null
    }
    set((s) => ({
      workspaces: [...s.workspaces, workspace],
      activeWorkspaceId: id,
      activated: { ...s.activated, [id]: true }
    }))
    return id
  },

  closeWorkspace(id: string): void {
    const ws = findWorkspace(id)
    if (!ws) return
    for (const paneId of Object.keys(ws.panes)) void window.tpm.pty.kill(paneId)
    set((s) => {
      const idx = s.workspaces.findIndex((w) => w.id === id)
      const workspaces = s.workspaces.filter((w) => w.id !== id)
      let activeWorkspaceId = s.activeWorkspaceId
      if (activeWorkspaceId === id) activeWorkspaceId = workspaces[Math.min(idx, workspaces.length - 1)]?.id ?? null
      const activated = { ...s.activated }
      delete activated[id]
      if (activeWorkspaceId) activated[activeWorkspaceId] = true
      return { workspaces, activeWorkspaceId, activated }
    })
  },

  renameWorkspace(id: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    updateWorkspace(id, (w) => ({ ...w, name: trimmed }))
  },

  moveWorkspace(id: string, toIndex: number): void {
    set((s) => {
      const list = [...s.workspaces]
      const from = list.findIndex((w) => w.id === id)
      if (from < 0) return {}
      const [item] = list.splice(from, 1)
      list.splice(Math.max(0, Math.min(toIndex, list.length)), 0, item)
      return { workspaces: list }
    })
  },

  setActiveWorkspace(id: string): void {
    if (!findWorkspace(id)) return
    set((s) => ({ activeWorkspaceId: id, activated: { ...s.activated, [id]: true } }))
  },

  cycleWorkspace(delta: number): void {
    const { workspaces, activeWorkspaceId } = get()
    if (workspaces.length === 0) return
    const idx = workspaces.findIndex((w) => w.id === activeWorkspaceId)
    const next = workspaces[(idx + delta + workspaces.length) % workspaces.length]
    actions.setActiveWorkspace(next.id)
  },

  /** Split `targetPaneId` (or the focused pane) and start `agentId` in the new pane. */
  addPane(
    workspaceId: string,
    agentId: string,
    opts: { direction?: SplitDirection; targetPaneId?: string | null; containerSize?: { w: number; h: number } } = {}
  ): string | null {
    const ws = findWorkspace(workspaceId)
    if (!ws) return null
    const targetId = opts.targetPaneId ?? ws.focusedPaneId ?? paneIdsInOrder(ws.layout).at(-1) ?? null
    const target = targetId ? ws.panes[targetId] : undefined
    const pane = newPaneConfig(agentId, target?.cwd ?? ws.cwd, target?.worktree ? { worktree: target.worktree } : {})

    let layout: LayoutNode
    if (!ws.layout || !targetId) {
      layout = { type: 'pane', paneId: pane.id }
    } else {
      let direction = opts.direction
      if (!direction) {
        const rect = computeGeometry(ws.layout).panes[targetId]
        const size = opts.containerSize ?? { w: 1600, h: 900 }
        direction = rect && rect.w * size.w < rect.h * size.h * 1.1 ? 'column' : 'row'
      }
      layout = splitPane(ws.layout, targetId, pane.id, direction)
    }
    updateWorkspace(workspaceId, (w) => ({
      ...w,
      layout,
      panes: { ...w.panes, [pane.id]: pane },
      focusedPaneId: pane.id,
      zoomedPaneId: null
    }))
    return pane.id
  },

  removePane(workspaceId: string, paneId: string): void {
    const ws = findWorkspace(workspaceId)
    if (!ws || !(paneId in ws.panes)) return
    void window.tpm.pty.kill(paneId)
    const order = paneIdsInOrder(ws.layout)
    const idx = order.indexOf(paneId)
    const layout = ws.layout ? removePane(ws.layout, paneId) : null
    const remaining = paneIdsInOrder(layout)
    const focus =
      ws.focusedPaneId && ws.focusedPaneId !== paneId && remaining.includes(ws.focusedPaneId)
        ? ws.focusedPaneId
        : (remaining[Math.min(Math.max(idx - 1, 0), remaining.length - 1)] ?? null)
    updateWorkspace(workspaceId, (w) => {
      const panes = { ...w.panes }
      delete panes[paneId]
      return { ...w, layout, panes, focusedPaneId: focus, zoomedPaneId: w.zoomedPaneId === paneId ? null : w.zoomedPaneId }
    })
    set((s) => {
      const generations = { ...s.generations }
      delete generations[paneId]
      return { generations, findPaneId: s.findPaneId === paneId ? null : s.findPaneId }
    })
  },

  focusPane(workspaceId: string, paneId: string): void {
    const ws = findWorkspace(workspaceId)
    if (!ws || !(paneId in ws.panes)) return
    if (ws.focusedPaneId === paneId && (ws.zoomedPaneId === null || ws.zoomedPaneId === paneId)) return
    // Moving focus away from a zoomed pane unzooms, like tmux.
    updateWorkspace(workspaceId, (w) => ({
      ...w,
      focusedPaneId: paneId,
      zoomedPaneId: w.zoomedPaneId && w.zoomedPaneId !== paneId ? null : w.zoomedPaneId
    }))
  },

  toggleZoom(workspaceId: string, paneId?: string): void {
    updateWorkspace(workspaceId, (w) => {
      const target = paneId ?? w.focusedPaneId
      if (!target) return w
      return { ...w, zoomedPaneId: w.zoomedPaneId ? null : target, focusedPaneId: target }
    })
  },

  setSplitSizes(workspaceId: string, splitId: string, sizes: number[]): void {
    updateWorkspace(workspaceId, (w) => (w.layout ? { ...w, layout: setSplitSizes(w.layout, splitId, sizes) } : w))
  },

  equalize(workspaceId: string): void {
    updateWorkspace(workspaceId, (w) => (w.layout ? { ...w, layout: equalize(w.layout) } : w))
  },

  retile(workspaceId: string, mode: string): void {
    updateWorkspace(workspaceId, (w) => {
      const ids = paneIdsInOrder(w.layout)
      if (ids.length === 0) return w
      return { ...w, layout: retile(ids, mode), zoomedPaneId: null }
    })
  },

  swapPanes(workspaceId: string, a: string, b: string): void {
    updateWorkspace(workspaceId, (w) => (w.layout ? { ...w, layout: swapPanes(w.layout, a, b) } : w))
  },

  async restartPane(paneId: string, opts: { freshSession?: boolean } = {}): Promise<void> {
    const ws = workspaceOfPane(paneId)
    if (!ws) return
    await window.tpm.pty.kill(paneId)
    const pane = ws.panes[paneId]
    if (opts.freshSession && pane.sessionId) {
      updateWorkspace(ws.id, (w) => ({ ...w, panes: { ...w.panes, [paneId]: { ...pane, sessionId: newId() } } }))
    }
    set((s) => ({ generations: { ...s.generations, [paneId]: (s.generations[paneId] ?? 0) + 1 } }))
  },

  async setPaneAgent(paneId: string, agentId: string): Promise<void> {
    const ws = workspaceOfPane(paneId)
    if (!ws) return
    const agent = getAgent(agentId)
    await window.tpm.pty.kill(paneId)
    updateWorkspace(ws.id, (w) => ({
      ...w,
      panes: {
        ...w.panes,
        [paneId]: { ...w.panes[paneId], agentId, sessionId: agent.sessions ? newId() : undefined }
      }
    }))
    set((s) => ({ generations: { ...s.generations, [paneId]: (s.generations[paneId] ?? 0) + 1 } }))
  },

  updateSettings(patch: Partial<Settings>): void {
    set((s) => ({ settings: { ...s.settings, ...patch } }))
  },

  rememberFolder(folder: string): void {
    set((s) => {
      const recent = [folder, ...s.settings.recentFolders.filter((f) => f !== folder)].slice(0, 8)
      return { settings: { ...s.settings, recentFolders: recent } }
    })
  },

  setFontSize(size: number): void {
    actions.updateSettings({ fontSize: Math.min(28, Math.max(8, Math.round(size))) })
  },

  async detectAgents(): Promise<void> {
    const agents = agentsOf(get().settings)
    const bins = new Set<string>()
    for (const a of agents) {
      const bin = a.command
        ?.trim()
        .split(/\s+/)
        .find((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t))
      if (bin) bins.add(bin)
    }
    const installed = await window.tpm.agents.detect([...bins])
    set({ installed })
  },

  toggleBroadcast(open?: boolean): void {
    set((s) => ({ broadcastOpen: open ?? !s.broadcastOpen }))
  },

  toggleBroadcastTarget(paneId: string): void {
    set((s) => {
      const next = { ...s.broadcastExcluded }
      if (next[paneId]) delete next[paneId]
      else next[paneId] = true
      return { broadcastExcluded: next }
    })
  },

  setFindPane(paneId: string | null): void {
    set({ findPaneId: paneId })
  }
}

/** Default agent if the configured one no longer exists. */
export function defaultAgentId(settings: Settings): string {
  const agents = agentsOf(settings)
  return agents.some((a) => a.id === settings.defaultAgentId)
    ? settings.defaultAgentId
    : (BUILTIN_AGENTS[0]?.id ?? SHELL_AGENT_ID)
}
