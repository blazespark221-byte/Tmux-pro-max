import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AgentDef } from '@shared/types'
import { useApp } from '../store/app'
import { CheckIcon } from './Icons'

interface DropdownProps {
  trigger: (props: { open: boolean; toggle: () => void; ref: (el: HTMLElement | null) => void }) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  width?: number
}

/** A menu rendered in a portal so it is never clipped by panes. */
export function Dropdown({ trigger, children, align = 'left', width = 240 }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number }>({ top: 0, left: 0, maxHeight: 400 })

  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen((o) => !o), [])
  const setAnchor = useCallback((el: HTMLElement | null) => {
    anchorRef.current = el
  }, [])

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return
    const r = anchorRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = align === 'right' ? r.right - width : r.left
    left = Math.max(8, Math.min(left, vw - width - 8))
    const below = vh - r.bottom - 12
    const above = r.top - 12
    const menuHeight = menuRef.current?.scrollHeight ?? 300
    if (below >= Math.min(menuHeight, 260) || below >= above) {
      setPos({ top: r.bottom + 4, left, maxHeight: below })
    } else {
      const h = Math.min(menuHeight, above)
      setPos({ top: r.top - 4 - h, left, maxHeight: above })
    }
  }, [open, align, width])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  return (
    <>
      {trigger({ open, toggle, ref: setAnchor })}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="dropdown"
            style={{ top: pos.top, left: pos.left, width, maxHeight: pos.maxHeight }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {children(close)}
          </div>,
          document.body
        )}
    </>
  )
}

export function MenuItem({
  onSelect,
  children,
  hint,
  danger,
  selected,
  disabled
}: {
  onSelect: () => void
  children: ReactNode
  hint?: ReactNode
  danger?: boolean
  selected?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={`menu-item${danger ? ' danger' : ''}${selected ? ' selected' : ''}`}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="menu-item-label">{children}</span>
      {selected && <CheckIcon size={12} />}
      {hint && <span className="menu-item-hint">{hint}</span>}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="menu-separator" />
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label">{children}</div>
}

export function AgentBadge({ agent, size = 'sm' }: { agent: AgentDef; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`agent-badge agent-badge-${size}`} style={{ ['--agent-color' as string]: agent.color }}>
      {agent.glyph}
    </span>
  )
}

export function agentBinary(agent: AgentDef): string | null {
  if (!agent.command) return null
  return (
    agent.command
      .trim()
      .split(/\s+/)
      .find((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) ?? null
  )
}

/** Whether an agent's binary was found on PATH (`undefined` while unknown). */
export function useAgentInstalled(agent: AgentDef): boolean | undefined {
  const installed = useApp((s) => s.installed)
  const bin = agentBinary(agent)
  if (!bin) return true
  return installed[bin]
}

export function AgentMenuItems({
  agents,
  onSelect,
  selectedId
}: {
  agents: AgentDef[]
  onSelect: (agent: AgentDef) => void
  selectedId?: string
}) {
  const installed = useApp((s) => s.installed)
  return (
    <>
      {agents.map((agent) => {
        const bin = agentBinary(agent)
        const missing = bin !== null && installed[bin] === false
        return (
          <button
            key={agent.id}
            type="button"
            className={`menu-item agent-menu-item${selectedId === agent.id ? ' selected' : ''}`}
            onClick={() => onSelect(agent)}
            title={agent.command ?? 'Your login shell'}
          >
            <AgentBadge agent={agent} />
            <span className="menu-item-label">
              {agent.name}
              <span className="menu-item-sub">{missing ? 'not found on PATH' : (agent.command ?? 'login shell')}</span>
            </span>
            {selectedId === agent.id && <CheckIcon size={12} />}
          </button>
        )
      })}
    </>
  )
}
