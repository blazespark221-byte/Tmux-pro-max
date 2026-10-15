import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { computeGeometry, dragDivider, paneIdsInOrder } from '@shared/layout'
import type { Divider, Rect } from '@shared/layout'
import type { LayoutNode, SplitNode } from '@shared/types'
import { actions, useAgents, useApp } from '../store/app'
import type { WorkspaceState } from '../store/app'
import { AgentBadge, agentBinary } from './Dropdown'
import { PaneFrame } from './PaneFrame'
import { BroadcastBar } from './BroadcastBar'
import { TopBar } from './TopBar'

/** Outer padding is OFFSET + GAP / 2 on each side, inner gaps are GAP wide. */
const OFFSET = 3
const GAP = 6
const MIN_PANE_PX = 140

function findSplit(node: LayoutNode | null, id: string): SplitNode | null {
  if (!node || node.type === 'pane') return null
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findSplit(child, id)
    if (found) return found
  }
  return null
}

export function WorkspaceView({ workspace, active }: { workspace: WorkspaceState; active: boolean }) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const broadcastOpen = useApp((s) => s.broadcastOpen)

  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    const update = (): void => {
      if (el.clientWidth > 0 && el.clientHeight > 0) setSize({ w: el.clientWidth, h: el.clientHeight })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const geometry = useMemo(() => computeGeometry(workspace.layout), [workspace.layout])
  const order = useMemo(() => paneIdsInOrder(workspace.layout), [workspace.layout])
  const iw = Math.max(0, size.w - OFFSET * 2)
  const ih = Math.max(0, size.h - OFFSET * 2)

  const rectStyle = (r: Rect): CSSProperties => ({
    left: OFFSET + r.x * iw + GAP / 2,
    top: OFFSET + r.y * ih + GAP / 2,
    width: Math.max(0, r.w * iw - GAP),
    height: Math.max(0, r.h * ih - GAP)
  })

  const zoomed = workspace.zoomedPaneId && workspace.panes[workspace.zoomedPaneId] ? workspace.zoomedPaneId : null
  const panes = Object.values(workspace.panes)

  return (
    <div className={`workspace${active ? ' active' : ''}`}>
      <TopBar workspace={workspace} />
      <div className="workspace-grid" ref={gridRef}>
        {size.w > 0 &&
          panes.map((pane) => {
            const rect = geometry.panes[pane.id]
            if (!rect) return null
            const isZoomed = zoomed === pane.id
            const hidden = zoomed !== null && !isZoomed
            const style = isZoomed ? rectStyle({ x: 0, y: 0, w: 1, h: 1 }) : rectStyle(rect)
            return (
              <PaneFrame
                key={pane.id}
                workspaceId={workspace.id}
                workspaceCwd={workspace.cwd}
                pane={pane}
                index={order.indexOf(pane.id)}
                style={style}
                hidden={hidden}
                zoomed={isZoomed}
                focused={workspace.focusedPaneId === pane.id}
                visible={active}
              />
            )
          })}
        {size.w > 0 &&
          !zoomed &&
          geometry.dividers.map((d) => (
            <DividerHandle key={`${d.splitId}:${d.index}`} divider={d} workspace={workspace} iw={iw} ih={ih} gridRef={gridRef} />
          ))}
        {!workspace.layout && <EmptyWorkspace workspaceId={workspace.id} />}
      </div>
      {active && broadcastOpen && workspace.layout && <BroadcastBar workspace={workspace} />}
    </div>
  )
}

function DividerHandle({
  divider,
  workspace,
  iw,
  ih,
  gridRef
}: {
  divider: Divider
  workspace: WorkspaceState
  iw: number
  ih: number
  gridRef: React.RefObject<HTMLDivElement | null>
}) {
  const vertical = divider.direction === 'row' // a vertical line between side-by-side panes
  const thickness = 10
  const style: CSSProperties = vertical
    ? {
        left: OFFSET + divider.x * iw - thickness / 2,
        top: OFFSET + divider.y * ih + GAP / 2,
        width: thickness,
        height: divider.length * ih - GAP
      }
    : {
        top: OFFSET + divider.y * ih - thickness / 2,
        left: OFFSET + divider.x * iw + GAP / 2,
        height: thickness,
        width: divider.length * iw - GAP
      }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    document.body.classList.add(vertical ? 'resizing-col' : 'resizing-row')
    const grid = gridRef.current
    if (!grid) return
    const parent = divider.parent

    const onMove = (ev: PointerEvent): void => {
      const split = findSplit(useApp.getState().workspaces.find((w) => w.id === workspace.id)?.layout ?? null, divider.splitId)
      if (!split) return
      const box = grid.getBoundingClientRect()
      const extent = vertical ? parent.w * iw : parent.h * ih
      if (extent <= 0) return
      const pos = vertical
        ? (ev.clientX - box.left - OFFSET - parent.x * iw) / extent
        : (ev.clientY - box.top - OFFSET - parent.y * ih) / extent
      const minFraction = Math.min(0.45, MIN_PANE_PX / extent)
      actions.setSplitSizes(workspace.id, divider.splitId, dragDivider(split.sizes, divider.index, pos, minFraction))
    }
    const onUp = (ev: PointerEvent): void => {
      target.releasePointerCapture(ev.pointerId)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('resizing-col', 'resizing-row')
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      className={`divider ${vertical ? 'divider-col' : 'divider-row'}`}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        const split = findSplit(workspace.layout, divider.splitId)
        if (split)
          actions.setSplitSizes(
            workspace.id,
            split.id,
            split.children.map(() => 1)
          )
      }}
      title="Drag to resize · double-click to even out"
    />
  )
}

function EmptyWorkspace({ workspaceId }: { workspaceId: string }) {
  const agents = useAgents()
  const installed = useApp((s) => s.installed)
  return (
    <div className="empty-workspace">
      <h2>No panes open</h2>
      <p>Start an agent in this workspace.</p>
      <div className="empty-agents">
        {agents.map((agent) => {
          const bin = agentBinary(agent)
          const missing = bin !== null && installed[bin] === false
          return (
            <button
              key={agent.id}
              type="button"
              className={`agent-tile${missing ? ' missing' : ''}`}
              onClick={() => actions.addPane(workspaceId, agent.id)}
            >
              <AgentBadge agent={agent} size="lg" />
              <span>{agent.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
