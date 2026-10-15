import { useEffect } from 'react'
import { formatAccelerator, matchShortcut, shortcutFor } from '@shared/shortcuts'
import type { MenuAction } from '@shared/types'
import { activity } from '../lib/activity'
import { runAction } from '../lib/commands'
import { initTerminalRouting } from '../lib/terminals'
import { classNames, isMac } from '../lib/util'
import { actions, useApp } from '../store/app'
import { useRuntime } from '../store/runtime'
import { LogoMark, PlusIcon } from './Icons'
import { ConfirmModal } from './Modal'
import { NewWorkspaceDialog } from './NewWorkspaceDialog'
import { SettingsDialog, ShortcutsDialog } from './SettingsDialog'
import { Sidebar } from './Sidebar'
import { WorkspaceView } from './WorkspaceView'

initTerminalRouting()
activity.start()

/** Shortcuts that still work while a dialog is open. */
const MODAL_SAFE: MenuAction[] = ['settings', 'shortcuts', 'new-workspace', 'font-bigger', 'font-smaller', 'font-reset']
/** Shortcuts that should behave natively inside text fields. */
const TEXT_NATIVE: MenuAction[] = ['copy', 'paste', 'find', 'clear']

export function App() {
  const workspaces = useApp((s) => s.workspaces)
  const activeId = useApp((s) => s.activeWorkspaceId)
  const activated = useApp((s) => s.activated)
  const sidebarVisible = useApp((s) => s.sidebarVisible)
  const modal = useApp((s) => s.modal)

  // ---- Global keyboard shortcuts --------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const action = matchShortcut(e, isMac)
      if (!action) return
      const state = useApp.getState()
      if (state.modal && !MODAL_SAFE.includes(action)) return
      const target = e.target as HTMLElement | null
      const inTextField = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !target.closest('.xterm')
      if (inTextField && TEXT_NATIVE.includes(action)) return
      e.preventDefault()
      e.stopPropagation()
      runAction(action)
    }
    window.addEventListener('keydown', onKeyDown, true)
    const offMenu = window.tpm.onMenuAction(runAction)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      offMenu()
    }
  }, [])

  // ---- Window focus, notification clicks, dock badge ---------------------
  useEffect(() => {
    const offFocus = window.tpm.onWindowFocus((focused) => useRuntime.setState({ windowFocused: focused }))
    const onFocus = (): void => useRuntime.setState({ windowFocused: true })
    const onBlur = (): void => useRuntime.setState({ windowFocused: false })
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    const offFocusPane = window.tpm.onFocusPane(({ workspaceId, paneId }) => {
      actions.setActiveWorkspace(workspaceId)
      actions.focusPane(workspaceId, paneId)
    })
    let lastBadge = -1
    const offBadge = useRuntime.subscribe((s) => {
      const count = Object.values(s.panes).filter((p) => p.attention).length
      if (count !== lastBadge) {
        lastBadge = count
        window.tpm.setBadge(count)
      }
    })
    // Dropping files outside a pane must not navigate the window away.
    const stop = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    document.addEventListener('dragover', stop)
    document.addEventListener('drop', stop)
    void actions.detectAgents()
    return () => {
      offFocus()
      offFocusPane()
      offBadge()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('dragover', stop)
      document.removeEventListener('drop', stop)
    }
  }, [])

  // ---- Looking at a pane clears its attention flag --------------------
  const focusedPaneId = useApp((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.focusedPaneId ?? null)
  const windowFocused = useRuntime((s) => s.windowFocused)
  useEffect(() => {
    if (focusedPaneId && windowFocused) activity.clear(focusedPaneId)
  }, [focusedPaneId, windowFocused, activeId])

  // Keep the window title meaningful (shows up in the OS switcher).
  const activeName = workspaces.find((w) => w.id === activeId)?.name
  useEffect(() => {
    document.title = activeName ? `${activeName} — Tmux Pro Max` : 'Tmux Pro Max'
  }, [activeName])

  return (
    <div className={classNames('app', !sidebarVisible && 'sidebar-hidden')}>
      {sidebarVisible && <Sidebar />}
      <main className="main">
        {workspaces.length === 0 && <Welcome />}
        {workspaces
          .filter((ws) => activated[ws.id])
          .map((ws) => (
            <WorkspaceView key={ws.id} workspace={ws} active={ws.id === activeId} />
          ))}
      </main>
      {modal?.type === 'new-workspace' && <NewWorkspaceDialog />}
      {modal?.type === 'settings' && <SettingsDialog />}
      {modal?.type === 'shortcuts' && <ShortcutsDialog />}
      {modal?.type === 'confirm' && <ConfirmModal />}
    </div>
  )
}

function Welcome() {
  const sc = (a: MenuAction): string => formatAccelerator(shortcutFor(a, isMac), isMac)
  return (
    <div className="welcome">
      <div className="welcome-drag" />
      <div className="welcome-card">
        <LogoMark size={44} />
        <h1>Run your coding agents side by side</h1>
        <p>
          Open a project, pick a layout like <strong>3 on top · 3 below</strong>, and drop Claude Code, Codex, Gemini or any CLI
          into each pane. Every pane is a real terminal.
        </p>
        <button type="button" className="btn btn-primary btn-large" onClick={() => actions.setModal({ type: 'new-workspace' })}>
          <PlusIcon /> New workspace <kbd>{sc('new-workspace')}</kbd>
        </button>
        <div className="welcome-tips">
          <div>
            <kbd>{sc('split-right')}</kbd> split right
          </div>
          <div>
            <kbd>{sc('split-down')}</kbd> split down
          </div>
          <div>
            <kbd>{sc('toggle-broadcast')}</kbd> broadcast a prompt
          </div>
          <div>
            <kbd>{sc('zoom-pane')}</kbd> zoom a pane
          </div>
        </div>
      </div>
    </div>
  )
}
