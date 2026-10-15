import { useState } from 'react'
import { paneIdsInOrder } from '@shared/layout'
import { formatAccelerator, shortcutFor } from '@shared/shortcuts'
import { closeWorkspaceWithConfirm } from '../lib/commands'
import { classNames, compactPath, isMac } from '../lib/util'
import { actions, useApp } from '../store/app'
import type { WorkspaceState } from '../store/app'
import { useRuntime } from '../store/runtime'
import type { PaneRuntime } from '../store/runtime'
import { CloseIcon, GearIcon, KeyboardIcon, LogoMark, PlusIcon, SidebarIcon } from './Icons'

const WS_MIME = 'application/x-tpm-workspace'

function dotTone(rt: PaneRuntime | undefined): string {
  if (!rt) return 'starting'
  if (rt.attention) return 'attention'
  if (rt.status === 'running') return 'working'
  if (rt.status === 'exited') return 'exited'
  return rt.status === 'idle' ? 'idle' : 'starting'
}

export function Sidebar() {
  const workspaces = useApp((s) => s.workspaces)
  const activeId = useApp((s) => s.activeWorkspaceId)
  const version = window.tpm.info.version
  const shortcut = (a: Parameters<typeof shortcutFor>[0]): string => formatAccelerator(shortcutFor(a, isMac), isMac)

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <LogoMark size={18} />
          <span>Tmux Pro Max</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          title={`Hide sidebar (${shortcut('toggle-sidebar')})`}
          onClick={() => useApp.setState({ sidebarVisible: false })}
        >
          <SidebarIcon />
        </button>
      </div>

      <div className="sidebar-section-title">
        <span>Workspaces</span>
        <button
          type="button"
          className="icon-btn"
          title={`New workspace (${shortcut('new-workspace')})`}
          onClick={() => actions.setModal({ type: 'new-workspace' })}
        >
          <PlusIcon />
        </button>
      </div>

      <nav className="workspace-list">
        {workspaces.map((ws, i) => (
          <WorkspaceItem key={ws.id} workspace={ws} index={i} active={ws.id === activeId} />
        ))}
        <button type="button" className="new-workspace-btn" onClick={() => actions.setModal({ type: 'new-workspace' })}>
          <PlusIcon size={13} />
          New workspace
          <kbd>{shortcut('new-workspace')}</kbd>
        </button>
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="sidebar-footer-btn" onClick={() => actions.setModal({ type: 'settings' })}>
          <GearIcon /> Settings
        </button>
        <button
          type="button"
          className="sidebar-footer-btn"
          onClick={() => actions.setModal({ type: 'shortcuts' })}
          title="Keyboard shortcuts"
        >
          <KeyboardIcon /> Shortcuts
        </button>
        <span className="version">v{version}</span>
      </div>
    </aside>
  )
}

function WorkspaceItem({ workspace, index, active }: { workspace: WorkspaceState; index: number; active: boolean }) {
  const runtimes = useRuntime((s) => s.panes)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(workspace.name)
  const [dropHint, setDropHint] = useState<'before' | 'after' | null>(null)
  const order = paneIdsInOrder(workspace.layout)
  const attention = order.filter((id) => runtimes[id]?.attention).length
  const working = order.filter((id) => runtimes[id]?.status === 'running').length
  const accel = index < 9 ? formatAccelerator(shortcutFor(`workspace-${index + 1}` as const, isMac), isMac) : ''

  return (
    <div
      className={classNames(
        'workspace-item',
        active && 'active',
        attention > 0 && 'has-attention',
        dropHint && `drop-${dropHint}`
      )}
      role="button"
      tabIndex={0}
      draggable={!editing}
      onClick={() => actions.setActiveWorkspace(workspace.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !editing) actions.setActiveWorkspace(workspace.id)
      }}
      onDoubleClick={() => {
        setDraft(workspace.name)
        setEditing(true)
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(WS_MIME, workspace.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(WS_MIME)) return
        e.preventDefault()
        const box = e.currentTarget.getBoundingClientRect()
        setDropHint(e.clientY < box.top + box.height / 2 ? 'before' : 'after')
      }}
      onDragLeave={() => setDropHint(null)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(WS_MIME)
        const hint = dropHint
        setDropHint(null)
        if (!id || id === workspace.id) return
        e.preventDefault()
        const list = useApp.getState().workspaces
        const from = list.findIndex((w) => w.id === id)
        let to = list.findIndex((w) => w.id === workspace.id) + (hint === 'after' ? 1 : 0)
        if (from < to) to -= 1
        actions.moveWorkspace(id, to)
      }}
    >
      <div className="workspace-item-main">
        {editing ? (
          <input
            className="rename-input"
            value={draft}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              actions.renameWorkspace(workspace.id, draft)
              setEditing(false)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <span className="workspace-name">{workspace.name}</span>
        )}
        <span className="workspace-path" title={workspace.cwd}>
          {compactPath(workspace.cwd)}
        </span>
        <div className="workspace-dots">
          {order.slice(0, 16).map((id) => (
            <span key={id} className={`mini-dot tone-${dotTone(runtimes[id])}`} />
          ))}
          <span className="workspace-meta">
            {order.length} {order.length === 1 ? 'pane' : 'panes'}
            {working > 0 && ` · ${working} working`}
          </span>
        </div>
      </div>
      <div className="workspace-item-side">
        {attention > 0 ? <span className="attention-badge">{attention}</span> : accel && <kbd className="ws-kbd">{accel}</kbd>}
        <button
          type="button"
          className="icon-btn ws-close"
          title="Close workspace"
          onClick={(e) => {
            e.stopPropagation()
            void closeWorkspaceWithConfirm(workspace.id)
          }}
        >
          <CloseIcon size={12} />
        </button>
      </div>
    </div>
  )
}
