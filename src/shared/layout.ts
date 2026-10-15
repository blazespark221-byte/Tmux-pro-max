// Pure functions for the tiling layout tree. Every function returns a new tree
// and never mutates its input, so they are safe to use inside state reducers.

import type { LayoutNode, PaneLeaf, SplitDirection, SplitNode } from './types'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Divider {
  splitId: string
  /** Divider sits between children[index] and children[index + 1]. */
  index: number
  direction: SplitDirection
  /** Position of the boundary as a fraction of the whole layout. */
  x: number
  y: number
  /** Length of the divider (height for row splits, width for column splits). */
  length: number
  /** Rect of the split node the divider belongs to. */
  parent: Rect
}

export type FocusDirection = 'left' | 'right' | 'up' | 'down'

const EPSILON = 1e-9

export function newId(): string {
  return globalThis.crypto.randomUUID()
}

export function leaf(paneId: string): PaneLeaf {
  return { type: 'pane', paneId }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function paneIdsInOrder(node: LayoutNode | null): string[] {
  if (!node) return []
  if (node.type === 'pane') return [node.paneId]
  return node.children.flatMap(paneIdsInOrder)
}

export function containsPane(node: LayoutNode | null, paneId: string): boolean {
  return paneIdsInOrder(node).includes(paneId)
}

function evenSizes(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n)
}

function normalizeSizes(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0)
  if (total <= EPSILON) return evenSizes(sizes.length)
  return sizes.map((s) => s / total)
}

/**
 * Collapse single-child splits, merge nested splits that share a direction and
 * make sure every `sizes` array sums to 1.
 */
export function normalize(node: LayoutNode): LayoutNode {
  if (node.type === 'pane') return node
  const children: LayoutNode[] = []
  const sizes: number[] = []
  const baseSizes = node.sizes.length === node.children.length ? normalizeSizes(node.sizes) : evenSizes(node.children.length)
  node.children.forEach((child, i) => {
    const normalized = normalize(child)
    if (normalized.type === 'split' && normalized.direction === node.direction) {
      normalized.children.forEach((grandChild, j) => {
        children.push(grandChild)
        sizes.push(baseSizes[i] * normalized.sizes[j])
      })
    } else {
      children.push(normalized)
      sizes.push(baseSizes[i])
    }
  })
  if (children.length === 1) return children[0]
  return { ...node, children, sizes: normalizeSizes(sizes) }
}

// ---- Construction -------------------------------------------------------

/** Rows of panes stacked top→bottom; `rowsSpec[i]` is the number of panes in row i. */
export function buildRows(paneIds: string[], rowsSpec: number[]): LayoutNode {
  const ids = [...paneIds]
  const rows: LayoutNode[] = []
  for (const count of rowsSpec) {
    const rowIds = ids.splice(0, count)
    if (rowIds.length === 0) break
    rows.push(
      rowIds.length === 1
        ? leaf(rowIds[0])
        : { type: 'split', id: newId(), direction: 'row', children: rowIds.map(leaf), sizes: evenSizes(rowIds.length) }
    )
  }
  // Any leftovers go in an extra row so no pane is ever dropped.
  if (ids.length > 0) {
    rows.push(
      ids.length === 1
        ? leaf(ids[0])
        : { type: 'split', id: newId(), direction: 'row', children: ids.map(leaf), sizes: evenSizes(ids.length) }
    )
  }
  if (rows.length === 0) throw new Error('buildRows needs at least one pane')
  if (rows.length === 1) return rows[0]
  return { type: 'split', id: newId(), direction: 'column', children: rows, sizes: evenSizes(rows.length) }
}

/** One big pane on the left, the rest stacked on the right. */
export function buildMainStack(paneIds: string[]): LayoutNode {
  if (paneIds.length <= 1) return leaf(paneIds[0])
  const [main, ...rest] = paneIds
  const stack: LayoutNode =
    rest.length === 1
      ? leaf(rest[0])
      : { type: 'split', id: newId(), direction: 'column', children: rest.map(leaf), sizes: evenSizes(rest.length) }
  return { type: 'split', id: newId(), direction: 'row', children: [leaf(main), stack], sizes: [0.5, 0.5] }
}

/** A balanced grid for `n` panes, favouring wide rows since screens are wider than tall. */
export function autoRowsSpec(n: number): number[] {
  if (n <= 0) return []
  const rows = Math.max(1, Math.round(Math.sqrt(n / 1.6)))
  const base = Math.floor(n / rows)
  const extra = n % rows
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0))
}

export interface LayoutPreset {
  id: string
  label: string
  count: number
  build: (paneIds: string[]) => LayoutNode
}

function rowsPreset(id: string, label: string, rowsSpec: number[]): LayoutPreset {
  return {
    id,
    label,
    count: rowsSpec.reduce((a, b) => a + b, 0),
    build: (ids) => buildRows(ids, rowsSpec)
  }
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  rowsPreset('single', 'Single', [1]),
  rowsPreset('cols-2', 'Side by side', [2]),
  rowsPreset('rows-2', 'Stacked', [1, 1]),
  rowsPreset('cols-3', '3 columns', [3]),
  { id: 'main-2', label: 'Main + 2', count: 3, build: buildMainStack },
  rowsPreset('grid-2x2', '2 × 2', [2, 2]),
  { id: 'main-3', label: 'Main + 3', count: 4, build: buildMainStack },
  rowsPreset('cols-4', '4 columns', [4]),
  rowsPreset('grid-3x2', '3 top · 3 bottom', [3, 3]),
  rowsPreset('grid-4x2', '4 top · 4 bottom', [4, 4]),
  rowsPreset('grid-3x3', '3 × 3', [3, 3, 3]),
  rowsPreset('grid-4x3', '4 × 3', [4, 4, 4])
]

export function findPreset(id: string): LayoutPreset | undefined {
  return LAYOUT_PRESETS.find((p) => p.id === id)
}

/** Re-tile existing panes (in their current order) using a preset or an automatic grid. */
export function retile(paneIds: string[], presetId: 'auto' | 'columns' | 'rows' | string): LayoutNode {
  if (paneIds.length === 0) throw new Error('retile needs at least one pane')
  if (presetId === 'columns') return buildRows(paneIds, [paneIds.length])
  if (presetId === 'rows')
    return buildRows(
      paneIds,
      paneIds.map(() => 1)
    )
  if (presetId === 'main') return buildMainStack(paneIds)
  if (presetId.startsWith('preset:')) {
    const preset = findPreset(presetId.slice('preset:'.length))
    if (preset && preset.count === paneIds.length) return preset.build(paneIds)
  }
  return buildRows(paneIds, autoRowsSpec(paneIds.length))
}

// ---- Mutation -----------------------------------------------------------

/**
 * Split `targetPaneId`, placing `newPaneId` after it (right of / below) along `direction`.
 * When the target already lives in a split of the same direction the new pane becomes a
 * sibling that takes half of the target's space, so repeated splits stay flat.
 */
export function splitPane(
  root: LayoutNode,
  targetPaneId: string,
  newPaneId: string,
  direction: SplitDirection,
  placement: 'after' | 'before' = 'after'
): LayoutNode {
  const tree = clone(root)
  const newLeaf = leaf(newPaneId)

  if (tree.type === 'pane') {
    if (tree.paneId !== targetPaneId) return tree
    const children = placement === 'after' ? [tree, newLeaf] : [newLeaf, tree]
    return { type: 'split', id: newId(), direction, children, sizes: [0.5, 0.5] }
  }

  const visit = (node: SplitNode): boolean => {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]
      if (child.type === 'pane' && child.paneId === targetPaneId) {
        if (node.direction === direction) {
          const half = node.sizes[i] / 2
          const insertAt = placement === 'after' ? i + 1 : i
          node.sizes[i] = half
          node.children.splice(insertAt, 0, newLeaf)
          node.sizes.splice(insertAt, 0, half)
        } else {
          node.children[i] = {
            type: 'split',
            id: newId(),
            direction,
            children: placement === 'after' ? [child, newLeaf] : [newLeaf, child],
            sizes: [0.5, 0.5]
          }
        }
        return true
      }
      if (child.type === 'split' && visit(child)) return true
    }
    return false
  }
  visit(tree)
  return tree
}

/** Remove a pane; neighbours absorb its space. Returns `null` when the last pane is removed. */
export function removePane(root: LayoutNode, paneId: string): LayoutNode | null {
  if (root.type === 'pane') return root.paneId === paneId ? null : root
  const tree = clone(root)

  const visit = (node: SplitNode): boolean => {
    const idx = node.children.findIndex((c) => c.type === 'pane' && c.paneId === paneId)
    if (idx >= 0) {
      node.children.splice(idx, 1)
      node.sizes.splice(idx, 1)
      node.sizes = normalizeSizes(node.sizes)
      return true
    }
    for (const child of node.children) {
      if (child.type === 'split' && visit(child)) return true
    }
    return false
  }
  visit(tree)
  if (tree.children.length === 0) return null
  return normalize(tree)
}

export function setSplitSizes(root: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  const tree = clone(root)
  const visit = (node: LayoutNode): boolean => {
    if (node.type === 'pane') return false
    if (node.id === splitId) {
      if (sizes.length === node.children.length) node.sizes = normalizeSizes(sizes)
      return true
    }
    return node.children.some(visit)
  }
  visit(tree)
  return tree
}

export function equalize(root: LayoutNode): LayoutNode {
  const visit = (node: LayoutNode): LayoutNode =>
    node.type === 'pane' ? node : { ...node, children: node.children.map(visit), sizes: evenSizes(node.children.length) }
  return visit(root)
}

export function swapPanes(root: LayoutNode, a: string, b: string): LayoutNode {
  const visit = (node: LayoutNode): LayoutNode => {
    if (node.type === 'pane') {
      if (node.paneId === a) return leaf(b)
      if (node.paneId === b) return leaf(a)
      return node
    }
    return { ...node, children: node.children.map(visit) }
  }
  return visit(root)
}

// ---- Geometry -----------------------------------------------------------

export interface LayoutGeometry {
  panes: Record<string, Rect>
  dividers: Divider[]
}

export function computeGeometry(root: LayoutNode | null, bounds: Rect = { x: 0, y: 0, w: 1, h: 1 }): LayoutGeometry {
  const geometry: LayoutGeometry = { panes: {}, dividers: [] }
  if (!root) return geometry

  const visit = (node: LayoutNode, rect: Rect): void => {
    if (node.type === 'pane') {
      geometry.panes[node.paneId] = rect
      return
    }
    const horizontal = node.direction === 'row'
    let offset = horizontal ? rect.x : rect.y
    const extent = horizontal ? rect.w : rect.h
    node.children.forEach((child, i) => {
      const size = node.sizes[i] * extent
      const childRect: Rect = horizontal
        ? { x: offset, y: rect.y, w: size, h: rect.h }
        : { x: rect.x, y: offset, w: rect.w, h: size }
      visit(child, childRect)
      offset += size
      if (i < node.children.length - 1) {
        geometry.dividers.push({
          splitId: node.id,
          index: i,
          direction: node.direction,
          x: horizontal ? offset : rect.x,
          y: horizontal ? rect.y : offset,
          length: horizontal ? rect.h : rect.w,
          parent: rect
        })
      }
    })
  }
  visit(root, bounds)
  return geometry
}

/**
 * New sizes for a split when the divider between children[index] and children[index + 1]
 * is dragged to `position` (a fraction of the parent split along its axis).
 */
export function dragDivider(sizes: number[], index: number, position: number, minFraction: number): number[] {
  const next = [...sizes]
  const before = sizes.slice(0, index).reduce((a, b) => a + b, 0)
  const pair = sizes[index] + sizes[index + 1]
  const min = Math.min(minFraction, pair / 2)
  const first = Math.min(Math.max(position - before, min), pair - min)
  next[index] = first
  next[index + 1] = pair - first
  return next
}

/** The pane adjacent to `fromPaneId` in a direction, preferring the one with the most overlap. */
export function findNeighbor(rects: Record<string, Rect>, fromPaneId: string, direction: FocusDirection): string | null {
  const from = rects[fromPaneId]
  if (!from) return null
  const cx = from.x + from.w / 2
  const cy = from.y + from.h / 2
  let best: { id: string; score: number } | null = null

  for (const [id, r] of Object.entries(rects)) {
    if (id === fromPaneId) continue
    let gap: number
    let overlap: number
    switch (direction) {
      case 'left':
        gap = from.x - (r.x + r.w)
        overlap = Math.min(from.y + from.h, r.y + r.h) - Math.max(from.y, r.y)
        break
      case 'right':
        gap = r.x - (from.x + from.w)
        overlap = Math.min(from.y + from.h, r.y + r.h) - Math.max(from.y, r.y)
        break
      case 'up':
        gap = from.y - (r.y + r.h)
        overlap = Math.min(from.x + from.w, r.x + r.w) - Math.max(from.x, r.x)
        break
      case 'down':
        gap = r.y - (from.y + from.h)
        overlap = Math.min(from.x + from.w, r.x + r.w) - Math.max(from.x, r.x)
        break
    }
    if (gap < -EPSILON - 1e-6) continue
    if (overlap <= 1e-6) continue
    // Closest first, then largest overlap, then nearest centre.
    const centreDistance = Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy)
    const score = gap * 1000 - overlap * 10 + centreDistance * 0.001
    if (!best || score < best.score) best = { id, score }
  }
  return best?.id ?? null
}

/** Decide whether a pane is wider or taller (in pixels) to pick a sensible split direction. */
export function preferredSplitDirection(rect: Rect, containerWidth: number, containerHeight: number): SplitDirection {
  const w = rect.w * containerWidth
  const h = rect.h * containerHeight
  // Terminal cells are roughly twice as tall as wide, so bias toward side-by-side splits.
  return w >= h * 1.1 ? 'row' : 'column'
}
