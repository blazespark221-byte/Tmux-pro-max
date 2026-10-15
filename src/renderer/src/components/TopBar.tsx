import { useEffect, useState } from 'react'
import { LAYOUT_PRESETS } from '@shared/layout'
import { formatAccelerator, shortcutFor } from '@shared/shortcuts'
import { splitFocused } from '../lib/commands'
import { classNames, isMac, shortenPath } from '../lib/util'
import { actions, useAgents, useApp } from '../store/app'
import type { WorkspaceState } from '../store/app'
import { useRuntime } from '../store/runtime'
import { AgentMenuItems, Dropdown, MenuItem, MenuLabel, MenuSeparator } from './Dropdown'
import { BranchIcon, BroadcastIcon, ChevronDownIcon, FolderIcon, GridIcon, PlusIcon, SidebarIcon } from './Icons'
import { LayoutThumb } from './LayoutThumb'

function useGitBranch(cwd: string): string | undefined {
  const [branch, setBranch] = useState<string | undefined>()
  const windowFocused = useRuntime((s) => s.windowFocused)
  useEffect(() => {
    let cancelled = false
    void window.tpm.git.info(cwd).then((info) => {
      if (!cancelled) setBranch(info.isRepo ? info.branch : undefined)
    })
    return () => {
      cancelled = true
    }
  }, [cwd, windowFocused])
  return branch
}

export function TopBar({ workspace }: { workspace: WorkspaceState }) {
  const agents = useAgents()
  const sidebarVisible = useApp((s) => s.sidebarVisible)
  const broadcastOpen = useApp((s) => s.broadcastOpen)
  const branch = useGitBranch(workspace.cwd)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(workspace.name)
  const paneCount = Object.keys(workspace.panes).length
  const shortcut = (a: Parameters<typeof shortcutFor>[0]): string => formatAccelerator(shortcutFor(a, isMac), isMac)

  return (
    <div className={classNames('topbar', !sidebarVisible && 'no-sidebar')}>
      {!sidebarVisible && (
        <button
          type="button"
          className="icon-btn topbar-sidebar-toggle"
          title={`Show sidebar (${shortcut('toggle-sidebar')})`}
          onClick={() => useApp.setState({ sidebarVisible: true })}
        >
          <SidebarIcon />
        </button>
      )}
      <div className="topbar-title">
        {editing ? (
          <input
            className="rename-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              actions.renameWorkspace(workspace.id, draft)
              setEditing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setDraft(workspace.name)
                setEditing(false)
              }
            }}
          />
        ) : (
          <h1
            onDoubleClick={() => {
              setDraft(workspace.name)
              setEditing(true)
            }}
            title="Double-click to rename"
          >
            {workspace.name}
          </h1>
        )}
        <button
          type="button"
          className="topbar-chip"
          title={`${workspace.cwd}\nClick to reveal`}
          onClick={() => window.tpm.shell.openPath(workspace.cwd)}
        >
          <FolderIcon size={12} />
          {shortenPath(workspace.cwd)}
        </button>
        {branch && (
          <span className="topbar-chip static" title="Current branch">
            <BranchIcon size={12} />
            {branch}
          </span>
        )}
      </div>

      <div className="topbar-actions">
        <Dropdown
          align="right"
          width={290}
          trigger={({ toggle, ref, open }) => (
            <button ref={ref} type="button" className={classNames('btn', open && 'active')} onClick={toggle}>
              <PlusIcon size={13} /> Add agent <ChevronDownIcon size={11} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuLabel>Split the focused pane with…</MenuLabel>
              <AgentMenuItems
                agents={agents}
                onSelect={(a) => {
                  close()
                  splitFocused(undefined, a.id)
                }}
              />
            </>
          )}
        </Dropdown>

        <Dropdown
          align="right"
          width={260}
          trigger={({ toggle, ref, open }) => (
            <button
              ref={ref}
              type="button"
              className={classNames('btn', open && 'active')}
              onClick={toggle}
              disabled={paneCount === 0}
            >
              <GridIcon size={13} /> Layout <ChevronDownIcon size={11} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuLabel>Re-arrange {paneCount} panes</MenuLabel>
              {[
                { id: 'auto', label: 'Auto grid' },
                { id: 'columns', label: 'Columns' },
                { id: 'rows', label: 'Rows' },
                { id: 'main', label: 'Main + stack' }
              ].map((mode) => (
                <MenuItem
                  key={mode.id}
                  onSelect={() => {
                    close()
                    actions.retile(workspace.id, mode.id)
                  }}
                >
                  {mode.label}
                </MenuItem>
              ))}
              {LAYOUT_PRESETS.filter((p) => p.count === paneCount && p.count > 1).map((preset) => (
                <MenuItem
                  key={preset.id}
                  onSelect={() => {
                    close()
                    actions.retile(workspace.id, `preset:${preset.id}`)
                  }}
                  hint={<LayoutThumb preset={preset} size={22} />}
                >
                  {preset.label}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem
                onSelect={() => {
                  close()
                  actions.equalize(workspace.id)
                }}
              >
                Even out sizes
              </MenuItem>
            </>
          )}
        </Dropdown>

        <button
          type="button"
          className={classNames('btn', broadcastOpen && 'active')}
          onClick={() => actions.toggleBroadcast()}
          title={`Send one prompt to many agents (${shortcut('toggle-broadcast')})`}
          disabled={paneCount === 0}
        >
          <BroadcastIcon size={13} /> Broadcast
        </button>
      </div>
    </div>
  )
}
