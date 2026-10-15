import { memo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PaneConfig } from '@shared/types'
import { formatAccelerator, shortcutFor } from '@shared/shortcuts'
import { closePaneWithConfirm } from '../lib/commands'
import { basename, classNames, isMac, shortenPath } from '../lib/util'
import { actions, getAgent, useAgents, useApp } from '../store/app'
import { usePaneRuntime } from '../store/runtime'
import type { PaneRuntime } from '../store/runtime'
import { AgentBadge, AgentMenuItems, Dropdown, MenuItem, MenuLabel, MenuSeparator } from './Dropdown'
import {
  BranchIcon,
  ChevronDownIcon,
  CloseIcon,
  FolderIcon,
  MaximizeIcon,
  MinimizeIcon,
  SplitDownIcon,
  SplitRightIcon
} from './Icons'
import { TerminalPane } from './TerminalPane'

const PANE_MIME = 'application/x-tpm-pane'

interface Props {
  workspaceId: string
  workspaceCwd: string
  pane: PaneConfig
  index: number
  style: CSSProperties
  hidden: boolean
  zoomed: boolean
  focused: boolean
  visible: boolean
}

export function statusLabel(rt: PaneRuntime): { text: string; tone: 'working' | 'idle' | 'attention' | 'exited' | 'starting' } {
  if (rt.attention) return { text: 'Needs you', tone: 'attention' }
  switch (rt.status) {
    case 'running':
      return { text: 'Working', tone: 'working' }
    case 'idle':
      return { text: 'Idle', tone: 'idle' }
    case 'exited':
      return { text: rt.exitCode ? `Exited ${rt.exitCode}` : 'Exited', tone: 'exited' }
    default:
      return { text: 'Starting', tone: 'starting' }
  }
}

const hint = (action: Parameters<typeof shortcutFor>[0]): string => {
  const accel = formatAccelerator(shortcutFor(action, isMac), isMac)
  return accel ? ` (${accel})` : ''
}

export const PaneFrame = memo(function PaneFrame({
  workspaceId,
  workspaceCwd,
  pane,
  index,
  style,
  hidden,
  zoomed,
  focused,
  visible
}: Props) {
  const runtime = usePaneRuntime(pane.id)
  const generation = useApp((s) => s.generations[pane.id] ?? 0)
  const broadcastOpen = useApp((s) => s.broadcastOpen)
  const excluded = useApp((s) => !!s.broadcastExcluded[pane.id])
  const agents = useAgents()
  const agent = getAgent(pane.agentId)
  const [dragOver, setDragOver] = useState(false)
  const status = statusLabel(runtime)

  const location = pane.worktree ? (
    <span className="pane-chip" title={`${pane.worktree.path}\nbranch ${pane.worktree.branch}`}>
      <BranchIcon size={11} /> {pane.worktree.branch}
    </span>
  ) : pane.cwd !== workspaceCwd ? (
    <span className="pane-chip" title={pane.cwd}>
      <FolderIcon size={11} /> {basename(pane.cwd)}
    </span>
  ) : null

  return (
    <div
      className={classNames(
        'pane',
        focused && 'focused',
        runtime.attention && 'attention',
        hidden && 'pane-hidden',
        zoomed && 'zoomed',
        dragOver && 'drag-over',
        broadcastOpen && !excluded && 'broadcast-target'
      )}
      style={style}
      data-pane-id={pane.id}
      onMouseDown={() => actions.focusPane(workspaceId, pane.id)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(PANE_MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={(e) => {
        const from = e.dataTransfer.getData(PANE_MIME)
        setDragOver(false)
        if (!from || from === pane.id) return
        e.preventDefault()
        actions.swapPanes(workspaceId, from, pane.id)
      }}
    >
      <div
        className="pane-header"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(PANE_MIME, pane.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          actions.toggleZoom(workspaceId, pane.id)
        }}
      >
        {broadcastOpen && (
          <label className="broadcast-check" title="Include this pane in broadcasts" onMouseDown={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={!excluded} onChange={() => actions.toggleBroadcastTarget(pane.id)} />
          </label>
        )}
        <Dropdown
          width={280}
          trigger={({ toggle, ref, open }) => (
            <button
              ref={ref}
              type="button"
              className={classNames('pane-agent', open && 'open')}
              onClick={toggle}
              title="Switch agent / restart"
            >
              <AgentBadge agent={agent} />
              <span className="pane-agent-name">{agent.name}</span>
              <span className="pane-index">{index + 1}</span>
              <ChevronDownIcon size={11} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuLabel>Pane</MenuLabel>
              <MenuItem
                onSelect={() => {
                  close()
                  void actions.restartPane(pane.id)
                }}
                hint={formatAccelerator(shortcutFor('restart-pane', isMac), isMac)}
              >
                {agent.sessions ? 'Restart (resume conversation)' : 'Restart'}
              </MenuItem>
              {agent.sessions && (
                <MenuItem
                  onSelect={() => {
                    close()
                    void actions.restartPane(pane.id, { freshSession: true })
                  }}
                >
                  Start a new conversation
                </MenuItem>
              )}
              <MenuItem
                onSelect={() => {
                  close()
                  window.tpm.shell.showItemInFolder(pane.cwd)
                }}
              >
                Reveal folder
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  close()
                  window.tpm.clipboard.write(pane.cwd)
                }}
              >
                Copy path
              </MenuItem>
              <MenuSeparator />
              <MenuLabel>Switch agent</MenuLabel>
              <AgentMenuItems
                agents={agents}
                selectedId={pane.agentId}
                onSelect={(a) => {
                  close()
                  if (a.id !== pane.agentId) void actions.setPaneAgent(pane.id, a.id)
                }}
              />
            </>
          )}
        </Dropdown>

        {location}
        <span className="pane-title" title={runtime.title || shortenPath(pane.cwd)}>
          {runtime.title || shortenPath(pane.cwd)}
        </span>

        <span className={`pane-status tone-${status.tone}`} title={runtime.message ?? status.text}>
          <span className="status-dot" />
          {status.text}
        </span>

        <div className="pane-actions" onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="icon-btn"
            title={`Split right${hint('split-right')}`}
            onClick={() => actions.addPane(workspaceId, pane.agentId, { targetPaneId: pane.id, direction: 'row' })}
          >
            <SplitRightIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={`Split down${hint('split-down')}`}
            onClick={() => actions.addPane(workspaceId, pane.agentId, { targetPaneId: pane.id, direction: 'column' })}
          >
            <SplitDownIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={`${zoomed ? 'Unzoom' : 'Zoom'}${hint('zoom-pane')}`}
            onClick={() => actions.toggleZoom(workspaceId, pane.id)}
          >
            {zoomed ? <MinimizeIcon /> : <MaximizeIcon />}
          </button>
          <button
            type="button"
            className="icon-btn danger"
            title={`Close pane${hint('close-pane')}`}
            onClick={() => void closePaneWithConfirm(workspaceId, pane.id)}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
      <TerminalPane key={generation} workspaceId={workspaceId} pane={pane} visible={visible && !hidden} focused={focused} />
    </div>
  )
})
