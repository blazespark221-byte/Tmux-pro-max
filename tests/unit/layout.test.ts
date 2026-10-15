import { describe, expect, it } from 'vitest'
import {
  LAYOUT_PRESETS,
  autoRowsSpec,
  buildRows,
  computeGeometry,
  dragDivider,
  equalize,
  findNeighbor,
  leaf,
  normalize,
  paneIdsInOrder,
  removePane,
  retile,
  setSplitSizes,
  splitPane,
  swapPanes
} from '@shared/layout'
import type { LayoutNode, SplitNode } from '@shared/types'

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

function assertWellFormed(node: LayoutNode): void {
  if (node.type === 'pane') return
  expect(node.children.length).toBeGreaterThanOrEqual(2)
  expect(node.sizes.length).toBe(node.children.length)
  expect(sum(node.sizes)).toBeCloseTo(1, 9)
  for (const child of node.children) {
    if (child.type === 'split') expect(child.direction).not.toBe(node.direction)
    assertWellFormed(child)
  }
}

describe('presets', () => {
  it('builds 3 top / 3 bottom as a column of two rows', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const tree = buildRows(ids, [3, 3]) as SplitNode
    expect(tree.type).toBe('split')
    expect(tree.direction).toBe('column')
    expect(tree.children).toHaveLength(2)
    expect(paneIdsInOrder(tree)).toEqual(ids)
    const geo = computeGeometry(tree)
    expect(geo.panes.a).toEqual({ x: 0, y: 0, w: 1 / 3, h: 0.5 })
    expect(geo.panes.f.x).toBeCloseTo(2 / 3)
    expect(geo.panes.f.y).toBeCloseTo(0.5)
    assertWellFormed(tree)
  })

  it('every preset places exactly `count` panes', () => {
    for (const preset of LAYOUT_PRESETS) {
      const ids = Array.from({ length: preset.count }, (_, i) => `p${i}`)
      const tree = preset.build(ids)
      expect(paneIdsInOrder(tree).sort()).toEqual([...ids].sort())
      assertWellFormed(tree)
      const geo = computeGeometry(tree)
      const area = Object.values(geo.panes).reduce((a, r) => a + r.w * r.h, 0)
      expect(area).toBeCloseTo(1, 9)
    }
  })

  it('never drops panes when the row spec is too small', () => {
    const tree = buildRows(['a', 'b', 'c'], [1])
    expect(paneIdsInOrder(tree)).toEqual(['a', 'b', 'c'])
  })

  it('auto grid spec covers n panes', () => {
    for (let n = 1; n <= 16; n++) expect(sum(autoRowsSpec(n))).toBe(n)
    expect(autoRowsSpec(4)).toEqual([2, 2])
    expect(autoRowsSpec(6)).toEqual([3, 3])
    expect(autoRowsSpec(2)).toEqual([2])
  })
})

describe('splitPane', () => {
  it('turns a single pane into a split', () => {
    const tree = splitPane(leaf('a'), 'a', 'b', 'row') as SplitNode
    expect(tree.direction).toBe('row')
    expect(paneIdsInOrder(tree)).toEqual(['a', 'b'])
    expect(tree.sizes).toEqual([0.5, 0.5])
  })

  it('adds a sibling when splitting in the same direction', () => {
    let tree: LayoutNode = leaf('a')
    tree = splitPane(tree, 'a', 'b', 'row')
    tree = splitPane(tree, 'b', 'c', 'row')
    const split = tree as SplitNode
    expect(split.children).toHaveLength(3)
    expect(split.sizes).toEqual([0.5, 0.25, 0.25])
    expect(paneIdsInOrder(tree)).toEqual(['a', 'b', 'c'])
  })

  it('nests a perpendicular split', () => {
    let tree: LayoutNode = splitPane(leaf('a'), 'a', 'b', 'row')
    tree = splitPane(tree, 'b', 'c', 'column')
    const geo = computeGeometry(tree)
    expect(geo.panes.b).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 })
    expect(geo.panes.c).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
    assertWellFormed(tree)
  })

  it('supports inserting before the target', () => {
    const tree = splitPane(leaf('a'), 'a', 'b', 'column', 'before')
    expect(paneIdsInOrder(tree)).toEqual(['b', 'a'])
  })

  it('does not mutate the input tree', () => {
    const original = buildRows(['a', 'b'], [2])
    const snapshot = JSON.stringify(original)
    splitPane(original, 'a', 'x', 'column')
    expect(JSON.stringify(original)).toBe(snapshot)
  })
})

describe('removePane', () => {
  it('returns null when the last pane goes away', () => {
    expect(removePane(leaf('a'), 'a')).toBeNull()
  })

  it('collapses a split down to its remaining child', () => {
    const tree = splitPane(leaf('a'), 'a', 'b', 'row')
    expect(removePane(tree, 'b')).toEqual(leaf('a'))
  })

  it('redistributes space and flattens nested splits', () => {
    // a | (b / c)  → remove c → a | b as a flat row
    let tree: LayoutNode = splitPane(leaf('a'), 'a', 'b', 'row')
    tree = splitPane(tree, 'b', 'c', 'column')
    const after = removePane(tree, 'c') as SplitNode
    expect(after.type).toBe('split')
    expect(after.direction).toBe('row')
    expect(paneIdsInOrder(after)).toEqual(['a', 'b'])
    assertWellFormed(after)
  })

  it('keeps grid rows intact when removing from a 3x2 grid', () => {
    const tree = buildRows(['a', 'b', 'c', 'd', 'e', 'f'], [3, 3])
    const after = removePane(tree, 'e')!
    expect(paneIdsInOrder(after)).toEqual(['a', 'b', 'c', 'd', 'f'])
    assertWellFormed(after)
    const geo = computeGeometry(after)
    expect(geo.panes.d.w).toBeCloseTo(0.5)
    expect(geo.panes.a.w).toBeCloseTo(1 / 3)
  })
})

describe('sizes and geometry', () => {
  it('produces dividers between children', () => {
    const tree = buildRows(['a', 'b', 'c', 'd'], [2, 2])
    const geo = computeGeometry(tree)
    // 1 horizontal divider between rows + 1 vertical divider per row
    expect(geo.dividers).toHaveLength(3)
  })

  it('drags a divider within bounds', () => {
    expect(dragDivider([0.5, 0.5], 0, 0.7, 0.1)).toEqual([0.7, 0.30000000000000004])
    const clamped = dragDivider([0.5, 0.5], 0, 0.99, 0.1)
    expect(clamped[0]).toBeCloseTo(0.9)
    const clampedLow = dragDivider([0.25, 0.25, 0.5], 1, 0.26, 0.1)
    expect(clampedLow[1]).toBeCloseTo(0.1)
    expect(sum(clampedLow)).toBeCloseTo(1)
  })

  it('sets and equalizes split sizes', () => {
    const tree = buildRows(['a', 'b'], [2]) as SplitNode
    const resized = setSplitSizes(tree, tree.id, [3, 1]) as SplitNode
    expect(resized.sizes).toEqual([0.75, 0.25])
    expect((equalize(resized) as SplitNode).sizes).toEqual([0.5, 0.5])
  })

  it('normalizes nested same-direction splits', () => {
    const nested: LayoutNode = {
      type: 'split',
      id: 'outer',
      direction: 'row',
      sizes: [0.5, 0.5],
      children: [leaf('a'), { type: 'split', id: 'inner', direction: 'row', sizes: [0.5, 0.5], children: [leaf('b'), leaf('c')] }]
    }
    const flat = normalize(nested) as SplitNode
    expect(flat.children).toHaveLength(3)
    expect(flat.sizes).toEqual([0.5, 0.25, 0.25])
  })
})

describe('navigation', () => {
  const tree = buildRows(['a', 'b', 'c', 'd', 'e', 'f'], [3, 3])
  const rects = computeGeometry(tree).panes

  it('moves focus in each direction', () => {
    expect(findNeighbor(rects, 'a', 'right')).toBe('b')
    expect(findNeighbor(rects, 'b', 'right')).toBe('c')
    expect(findNeighbor(rects, 'c', 'right')).toBeNull()
    expect(findNeighbor(rects, 'b', 'down')).toBe('e')
    expect(findNeighbor(rects, 'e', 'up')).toBe('b')
    expect(findNeighbor(rects, 'd', 'left')).toBeNull()
  })

  it('swaps panes', () => {
    expect(paneIdsInOrder(swapPanes(tree, 'a', 'f'))).toEqual(['f', 'b', 'c', 'd', 'e', 'a'])
  })

  it('retiles panes into an automatic grid', () => {
    const tiled = retile(['a', 'b', 'c', 'd'], 'auto')
    const geo = computeGeometry(tiled).panes
    expect(geo.a).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 })
    expect(paneIdsInOrder(retile(['a', 'b', 'c'], 'columns'))).toEqual(['a', 'b', 'c'])
  })
})
