import { dedupeCanvasItems, type CanvasDedupeWarning } from '@/lib/canvas/dedupe-canvas-items'
import type { CanvasItem } from '@/types/canvas-items'

describe('dedupeCanvasItems', () => {
  const makePanel = (overrides: Partial<CanvasItem> = {}): CanvasItem => ({
    id: `panel-${Math.random()}`,
    itemType: 'panel',
    panelId: 'branch-123',
    panelType: 'note',
    position: { x: 0, y: 0 },
    noteId: 'note-1',
    storeKey: 'note-1::branch-123',
    dimensions: { width: 500, height: 400 },
    ...overrides,
  })

  it('keeps the last occurrence of duplicate panels and preserves order', () => {
    const first = makePanel({ position: { x: 10, y: 10 }, storeKey: 'note-1::branch-dup' })
    const middle = makePanel({ panelId: 'branch-mid', storeKey: 'note-1::branch-mid' })
    const latest = { ...first, position: { x: 20, y: 20 } }

    const { items, removedCount } = dedupeCanvasItems([
      first,
      middle,
      latest,
    ])

    expect(removedCount).toBe(1)
    expect(items).toHaveLength(2)
    expect(items[0]).toBe(middle)
    expect(items[1]).toBe(latest)
  })

  it('preserves original object references', () => {
    const panelA = makePanel({ panelId: 'branch-a', storeKey: 'note-1::branch-a' })
    const panelB = makePanel({ panelId: 'branch-b', storeKey: 'note-1::branch-b' })

    const { items } = dedupeCanvasItems([panelA, panelB])

    expect(items[0]).toBe(panelA)
    expect(items[1]).toBe(panelB)
  })

  it('generates warnings for missing metadata but retains panels', () => {
    const missingNote = makePanel({ noteId: undefined, storeKey: undefined })
    const missingPanel = makePanel({ panelId: undefined, storeKey: undefined })

    const { items, warnings } = dedupeCanvasItems([missingNote, missingPanel])

    const codes = warnings.map((warning: CanvasDedupeWarning) => warning.code)
    expect(items).toHaveLength(2)
    expect(codes).toContain('missing_note_id')
    expect(codes).toContain('missing_panel_id')
  })
})
