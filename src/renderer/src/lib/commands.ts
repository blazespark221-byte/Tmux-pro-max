import { DEFAULT_SETTINGS } from '@shared/defaults'
import { computeGeometry, findNeighbor, paneIdsInOrder } from '@shared/layout'
import type { FocusDirection } from '@shared/layout'
import type { MenuAction } from '@shared/types'
import { actions, activeWorkspace, confirmDialog, findWorkspace, getAgent, useApp } from '../store/app'
import { dropPane, paneRuntime } from '../store/runtime'
import { activity } from './activity'
import { forgetPane, getTerminal, submitPrompt } from './terminals'

export async function closePaneWithConfirm(workspaceId: string, paneId: string): Promise<void> {
  const ws = findWorkspace(workspaceId)
  const pane = ws?.panes[paneId]
  if (!ws || !pane) return
  const rt = paneRuntime(paneId)
  const alive = rt.status !== 'exited'
  if (alive && useApp.getState().settings.confirmClosePane) {
    const agent = getAgent(pane.agentId)
    const ok = await confirmDialog({
      title: `Close ${agent.name}?`,
      message: agent.sessions
        ? 'The process will be stopped. Claude Code keeps the conversation, so you can pick it up again later with “claude --resume”.'
        : 'The process running in this pane will be stopped.',
      confirmLabel: 'Close pane',
      danger: true
    })
    if (!ok) return
  }
  actions.removePane(workspaceId, paneId)
  activity.forget(paneId)
  forgetPane(paneId)
  dropPane(paneId)
}

export async function closeWorkspaceWithConfirm(workspaceId: string): Promise<void> {
  const ws = findWorkspace(workspaceId)
  if (!ws) return
  const live = Object.keys(ws.panes).filter((id) => paneRuntime(id).status !== 'exited').length
  if (live > 0) {
    const ok = await confirmDialog({
      title: `Close “${ws.name}”?`,
      message: `${live} running ${live === 1 ? 'process' : 'processes'} will be stopped.${
        Object.values(ws.panes).some((p) => p.worktree) ? ' Git worktrees are kept on disk.' : ''
      }`,
      confirmLabel: 'Close workspace',
      danger: true
    })
    if (!ok) return
  }
  const paneIds = Object.keys(ws.panes)
  actions.closeWorkspace(workspaceId)
  for (const id of paneIds) {
    activity.forget(id)
    forgetPane(id)
    dropPane(id)
  }
}

/** Send a prompt (or raw keys) to every included pane of the active workspace. */
export function broadcast(text: string, mode: 'prompt' | 'raw' = 'prompt'): number {
  const ws = activeWorkspace()
  if (!ws) return 0
  const excluded = useApp.getState().broadcastExcluded
  const targets = paneIdsInOrder(ws.layout).filter((id) => !excluded[id] && paneRuntime(id).status !== 'exited')
  for (const id of targets) {
    if (mode === 'raw') window.tpm.pty.write(id, text)
    else submitPrompt(id, text)
  }
  return targets.length
}

function focusDirection(direction: FocusDirection): void {
  const ws = activeWorkspace()
  if (!ws?.layout || !ws.focusedPaneId) return
  const rects = computeGeometry(ws.layout).panes
  const next = findNeighbor(rects, ws.focusedPaneId, direction)
  if (next) actions.focusPane(ws.id, next)
}

function cyclePane(delta: number): void {
  const ws = activeWorkspace()
  if (!ws) return
  const order = paneIdsInOrder(ws.layout)
  if (order.length === 0) return
  const idx = ws.focusedPaneId ? order.indexOf(ws.focusedPaneId) : -1
  const next = order[(idx + delta + order.length) % order.length]
  actions.focusPane(ws.id, next)
}

function gridSize(): { w: number; h: number } | undefined {
  const el = document.querySelector('.workspace.active .workspace-grid')
  return el ? { w: el.clientWidth, h: el.clientHeight } : undefined
}

export function splitFocused(direction?: 'row' | 'column', agentId?: string): void {
  const ws = activeWorkspace()
  if (!ws) {
    actions.setModal({ type: 'new-workspace' })
    return
  }
  const focused = ws.focusedPaneId ? ws.panes[ws.focusedPaneId] : undefined
  const agent = agentId ?? focused?.agentId ?? useApp.getState().settings.defaultAgentId
  actions.addPane(ws.id, agent, { direction, containerSize: gridSize() })
}

export function runAction(action: MenuAction): void {
  const state = useApp.getState()
  const ws = activeWorkspace()
  const focusedId = ws?.focusedPaneId ?? null

  if (action.startsWith('workspace-')) {
    const n = Number(action.slice('workspace-'.length))
    const target = state.workspaces[n - 1]
    if (target) actions.setActiveWorkspace(target.id)
    return
  }

  switch (action) {
    case 'new-workspace':
      actions.setModal({ type: 'new-workspace' })
      break
    case 'close-workspace':
      if (ws) void closeWorkspaceWithConfirm(ws.id)
      break
    case 'next-workspace':
      actions.cycleWorkspace(1)
      break
    case 'prev-workspace':
      actions.cycleWorkspace(-1)
      break
    case 'split-right':
      splitFocused('row')
      break
    case 'split-down':
      splitFocused('column')
      break
    case 'close-pane':
      if (ws && focusedId) void closePaneWithConfirm(ws.id, focusedId)
      break
    case 'zoom-pane':
      if (ws) actions.toggleZoom(ws.id)
      break
    case 'restart-pane':
      if (focusedId) void actions.restartPane(focusedId)
      break
    case 'focus-left':
    case 'focus-right':
    case 'focus-up':
    case 'focus-down':
      focusDirection(action.slice('focus-'.length) as FocusDirection)
      break
    case 'next-pane':
      cyclePane(1)
      break
    case 'prev-pane':
      cyclePane(-1)
      break
    case 'toggle-broadcast':
      actions.toggleBroadcast()
      break
    case 'toggle-sidebar':
      useApp.setState((s) => ({ sidebarVisible: !s.sidebarVisible }))
      break
    case 'settings':
      actions.setModal(state.modal?.type === 'settings' ? null : { type: 'settings' })
      break
    case 'shortcuts':
      actions.setModal(state.modal?.type === 'shortcuts' ? null : { type: 'shortcuts' })
      break
    case 'font-bigger':
      actions.setFontSize(state.settings.fontSize + 1)
      break
    case 'font-smaller':
      actions.setFontSize(state.settings.fontSize - 1)
      break
    case 'font-reset':
      actions.setFontSize(DEFAULT_SETTINGS.fontSize)
      break
    case 'find':
      if (focusedId) actions.setFindPane(state.findPaneId === focusedId ? null : focusedId)
      break
    case 'clear':
      getTerminal(focusedId)?.term.clear()
      break
    case 'copy': {
      const selection = getTerminal(focusedId)?.term.getSelection()
      if (selection) window.tpm.clipboard.write(selection)
      break
    }
    case 'paste':
      if (focusedId) {
        void window.tpm.clipboard.read().then((text) => {
          if (text) getTerminal(focusedId)?.term.paste(text)
        })
      }
      break
  }
}
