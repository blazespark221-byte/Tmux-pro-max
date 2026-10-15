import { useEffect, useRef, useState } from 'react'
import { paneIdsInOrder } from '@shared/layout'
import { broadcast } from '../lib/commands'
import { actions, getAgent, useApp } from '../store/app'
import type { WorkspaceState } from '../store/app'
import { useRuntime } from '../store/runtime'
import { AgentBadge } from './Dropdown'
import { BroadcastIcon, CloseIcon, SendIcon } from './Icons'

export function BroadcastBar({ workspace }: { workspace: WorkspaceState }) {
  const [text, setText] = useState('')
  const [flash, setFlash] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const excluded = useApp((s) => s.broadcastExcluded)
  const statuses = useRuntime((s) => s.panes)
  const order = paneIdsInOrder(workspace.layout)
  const targets = order.filter((id) => !excluded[id] && statuses[id]?.status !== 'exited')

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  const send = (): void => {
    if (!text.trim()) return
    const n = broadcast(text)
    setFlash(`Sent to ${n} ${n === 1 ? 'pane' : 'panes'}`)
    setTimeout(() => setFlash(null), 1800)
    setText('')
  }

  const sendKey = (seq: string, label: string): void => {
    const n = broadcast(seq, 'raw')
    setFlash(`${label} → ${n} ${n === 1 ? 'pane' : 'panes'}`)
    setTimeout(() => setFlash(null), 1500)
  }

  return (
    <div className="broadcast-bar">
      <div className="broadcast-targets">
        <BroadcastIcon size={13} />
        <span className="broadcast-label">Broadcast to</span>
        {order.map((id, i) => {
          const pane = workspace.panes[id]
          if (!pane) return null
          const agent = getAgent(pane.agentId)
          const on = !excluded[id]
          return (
            <button
              key={id}
              type="button"
              className={`target-chip${on ? ' on' : ''}`}
              onClick={() => actions.toggleBroadcastTarget(id)}
              title={`${agent.name} · pane ${i + 1}`}
            >
              <AgentBadge agent={agent} />
              {i + 1}
            </button>
          )
        })}
        <span className="broadcast-spacer" />
        {flash && <span className="broadcast-flash">{flash}</span>}
        <button
          type="button"
          className="btn btn-small"
          title="Send Escape (interrupt agents)"
          onClick={() => sendKey('\x1b', 'Esc')}
        >
          Esc
        </button>
        <button type="button" className="btn btn-small" title="Send Ctrl+C" onClick={() => sendKey('\x03', 'Ctrl+C')}>
          ^C
        </button>
        <button type="button" className="btn btn-small" title="Send Enter" onClick={() => sendKey('\r', 'Enter')}>
          ↩
        </button>
        <button type="button" className="icon-btn" title="Close broadcast" onClick={() => actions.toggleBroadcast(false)}>
          <CloseIcon />
        </button>
      </div>
      <div className="broadcast-input">
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          spellCheck={false}
          placeholder={`Prompt ${targets.length} ${targets.length === 1 ? 'agent' : 'agents'} at once…  (Enter to send · Shift+Enter for a new line)`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              actions.toggleBroadcast(false)
            }
          }}
        />
        <button type="button" className="btn btn-primary" onClick={send} disabled={!text.trim() || targets.length === 0}>
          <SendIcon size={13} /> Send
        </button>
      </div>
    </div>
  )
}
