/**
 * Unit Tests: Widget UI Snapshot Registry (Layer 1)
 *
 * Tests the ephemeral in-memory store where widgets self-register
 * structured snapshots for routing consumption at Tier 4.5.
 */

import {
  registerWidgetSnapshot,
  unregisterWidgetSnapshot,
  getWidgetSnapshot,
  getAllVisibleSnapshots,
  setActiveWidgetId,
  getActiveWidgetId,
  clearAllSnapshots,
  getSnapshotCount,
  type WidgetSnapshot,
  type SnapshotListSegment,
  type SnapshotContextSegment,
} from '@/lib/widgets/ui-snapshot-registry'

// ============================================================================
// Helpers
// ============================================================================

function makeValidSnapshot(overrides?: Partial<WidgetSnapshot>): WidgetSnapshot {
  return {
    _version: 1,
    widgetId: 'w_test',
    title: 'Test Widget',
    isVisible: true,
    segments: [
      {
        segmentId: 'w_test:list',
        segmentType: 'list',
        listLabel: 'Test Items',
        badgesEnabled: false,
        visibleItemRange: { start: 0, end: 2 },
        items: [
          { itemId: 'item_1', label: 'Item One', actions: ['open'] },
          { itemId: 'item_2', label: 'Item Two', actions: ['open'] },
        ],
      } satisfies SnapshotListSegment,
      {
        segmentId: 'w_test:context',
        segmentType: 'context',
        summary: 'Shows test items',
        currentView: 'list',
      } satisfies SnapshotContextSegment,
    ],
    registeredAt: Date.now(),
    ...overrides,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('ui-snapshot-registry', () => {
  beforeEach(() => {
    clearAllSnapshots()
  })

  // --------------------------------------------------------------------------
  // Registration
  // --------------------------------------------------------------------------

  describe('registerWidgetSnapshot', () => {
    it('should register a valid snapshot and return true', () => {
      const snapshot = makeValidSnapshot()
      expect(registerWidgetSnapshot(snapshot)).toBe(true)
      expect(getSnapshotCount()).toBe(1)
    })

    it('should overwrite previous registration for same widgetId', () => {
      registerWidgetSnapshot(makeValidSnapshot({ title: 'First' }))
      registerWidgetSnapshot(makeValidSnapshot({ title: 'Second' }))

      expect(getSnapshotCount()).toBe(1)
      expect(getWidgetSnapshot('w_test')?.title).toBe('Second')
    })

    it('should store multiple widgets with different IDs', () => {
      registerWidgetSnapshot(makeValidSnapshot({ widgetId: 'w_a' }))
      registerWidgetSnapshot(makeValidSnapshot({ widgetId: 'w_b' }))

      expect(getSnapshotCount()).toBe(2)
      expect(getWidgetSnapshot('w_a')).not.toBeNull()
      expect(getWidgetSnapshot('w_b')).not.toBeNull()
    })
  })

  // --------------------------------------------------------------------------
  // Validation — rejected snapshots
  // --------------------------------------------------------------------------

  describe('validation rejects invalid snapshots', () => {
    it('should reject _version !== 1', () => {
      const snapshot = makeValidSnapshot()
      ;(snapshot as any)._version = 2
      expect(registerWidgetSnapshot(snapshot)).toBe(false)
      expect(getSnapshotCount()).toBe(0)
    })

    it('should reject empty widgetId', () => {
      expect(registerWidgetSnapshot(makeValidSnapshot({ widgetId: '' }))).toBe(false)
    })

    it('should reject empty title', () => {
      expect(registerWidgetSnapshot(makeValidSnapshot({ title: '' }))).toBe(false)
    })

    it('should reject non-boolean isVisible', () => {
      const snapshot = makeValidSnapshot()
      ;(snapshot as any).isVisible = 'yes'
      expect(registerWidgetSnapshot(snapshot)).toBe(false)
    })

    it('should reject non-array segments', () => {
      const snapshot = makeValidSnapshot()
      ;(snapshot as any).segments = 'not_an_array'
      expect(registerWidgetSnapshot(snapshot)).toBe(false)
    })

    it('should reject missing registeredAt', () => {
      const snapshot = makeValidSnapshot()
      ;(snapshot as any).registeredAt = undefined
      expect(registerWidgetSnapshot(snapshot)).toBe(false)
    })

    it('should reject null input', () => {
      expect(registerWidgetSnapshot(null as any)).toBe(false)
    })

    it('should reject undefined input', () => {
      expect(registerWidgetSnapshot(undefined as any)).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // Validation — segment-level
  // --------------------------------------------------------------------------

  describe('segment validation', () => {
    it('should drop list items with empty itemId', () => {
      const snapshot = makeValidSnapshot({
        segments: [{
          segmentId: 'w_test:list',
          segmentType: 'list',
          listLabel: 'Items',
          badgesEnabled: false,
          visibleItemRange: { start: 0, end: 2 },
          items: [
            { itemId: '', label: 'Bad', actions: ['open'] },
            { itemId: 'good', label: 'Good', actions: ['open'] },
          ],
        }],
      })

      registerWidgetSnapshot(snapshot)
      const stored = getWidgetSnapshot('w_test')
      const listSeg = stored?.segments[0] as SnapshotListSegment
      expect(listSeg.items).toHaveLength(1)
      expect(listSeg.items[0].itemId).toBe('good')
    })

    it('should drop list items with empty actions', () => {
      const snapshot = makeValidSnapshot({
        segments: [{
          segmentId: 'w_test:list',
          segmentType: 'list',
          listLabel: 'Items',
          badgesEnabled: false,
          visibleItemRange: { start: 0, end: 2 },
          items: [
            { itemId: 'no_actions', label: 'No Actions', actions: [] },
            { itemId: 'ok', label: 'OK', actions: ['open'] },
          ],
        }],
      })

      registerWidgetSnapshot(snapshot)
      const stored = getWidgetSnapshot('w_test')
      const listSeg = stored?.segments[0] as SnapshotListSegment
      expect(listSeg.items).toHaveLength(1)
      expect(listSeg.items[0].itemId).toBe('ok')
    })

    it('should deduplicate items by itemId', () => {
      const snapshot = makeValidSnapshot({
        segments: [{
          segmentId: 'w_test:list',
          segmentType: 'list',
          listLabel: 'Items',
          badgesEnabled: false,
          visibleItemRange: { start: 0, end: 3 },
          items: [
            { itemId: 'dup', label: 'First', actions: ['open'] },
            { itemId: 'dup', label: 'Second', actions: ['open'] },
            { itemId: 'unique', label: 'Unique', actions: ['open'] },
          ],
        }],
      })

      registerWidgetSnapshot(snapshot)
      const stored = getWidgetSnapshot('w_test')
      const listSeg = stored?.segments[0] as SnapshotListSegment
      expect(listSeg.items).toHaveLength(2)
      expect(listSeg.items[0].label).toBe('First') // first wins
    })

    it('should cap items at 20', () => {
      const items = Array.from({ length: 30 }, (_, i) => ({
        itemId: `item_${i}`,
        label: `Item ${i}`,
        actions: ['open'],
      }))

      const snapshot = makeValidSnapshot({
        segments: [{
          segmentId: 'w_test:list',
          segmentType: 'list',
          listLabel: 'Items',
          badgesEnabled: false,
          visibleItemRange: { start: 0, end: 30 },
          items,
        }],
      })

      registerWidgetSnapshot(snapshot)
      const stored = getWidgetSnapshot('w_test')
      const listSeg = stored?.segments[0] as SnapshotListSegment
      expect(listSeg.items).toHaveLength(20)
    })

    it('should truncate long labels to 120 chars', () => {
      const longLabel = 'A'.repeat(200)
      const snapshot = makeValidSnapshot({
        segments: [{
          segmentId: 'w_test:list',
          segmentType: 'list',
          listLabel: longLabel,
          badgesEnabled: false,
          visibleItemRange: { start: 0, end: 1 },
          items: [{ itemId: 'x', label: longLabel, actions: ['open'] }],
        }],
      })

      registerWidgetSnapshot(snapshot)
      const stored = getWidgetSnapshot('w_test')
      const listSeg = stored?.segments[0] as SnapshotListSegment
      expect(listSeg.listLabel.length).toBe(120)
      expect(listSeg.items[0].label.length).toBe(120)
    })

    it('should truncate summary to 200 chars', () => {
      const longSummary = 'B'.repeat(300)
      const snapshot = makeValidSnapshot({
        segments: [{
          segmentId: 'w_test:context',
          segmentType: 'context',
          summary: longSummary,
          currentView: 'list',
        }],
      })

      registerWidgetSnapshot(snapshot)
      const stored = getWidgetSnapshot('w_test')
      const ctxSeg = stored?.segments[0] as SnapshotContextSegment
      expect(ctxSeg.summary.length).toBe(200)
    })

    it('should truncate badge to single character', () => {
      const snapshot = makeValidSnapshot({
        segments: [{
          segmentId: 'w_test:list',
          segmentType: 'list',
          listLabel: 'Items',
          badgesEnabled: true,
          visibleItemRange: { start: 0, end: 1 },
          items: [{ itemId: 'x', label: 'X', badge: 'ABC', badgeVisible: true, actions: ['open'] }],
        }],
      })

      registerWidgetSnapshot(snapshot)
      const stored = getWidgetSnapshot('w_test')
      const listSeg = stored?.segments[0] as SnapshotListSegment
      expect(listSeg.items[0].badge).toBe('A')
    })

    it('should drop segments with unknown segmentType', () => {
      const snapshot = makeValidSnapshot({
        segments: [
          {
            segmentId: 'w_test:unknown',
            segmentType: 'unknown' as any,
            data: 'whatever',
          } as any,
          {
            segmentId: 'w_test:context',
            segmentType: 'context',
            summary: 'Valid',
            currentView: 'list',
          },
        ],
      })

      registerWidgetSnapshot(snapshot)
      const stored = getWidgetSnapshot('w_test')
      expect(stored?.segments).toHaveLength(1)
      expect(stored?.segments[0].segmentType).toBe('context')
    })
  })

  // --------------------------------------------------------------------------
  // Retrieval
  // --------------------------------------------------------------------------

  describe('getWidgetSnapshot', () => {
    it('should return null for unregistered widget', () => {
      expect(getWidgetSnapshot('nonexistent')).toBeNull()
    })

    it('should return the registered snapshot', () => {
      registerWidgetSnapshot(makeValidSnapshot({ widgetId: 'w_find' }))
      const result = getWidgetSnapshot('w_find')
      expect(result).not.toBeNull()
      expect(result?.widgetId).toBe('w_find')
    })
  })

  describe('getAllVisibleSnapshots', () => {
    it('should return empty array when no snapshots', () => {
      expect(getAllVisibleSnapshots()).toEqual([])
    })

    it('should return only visible snapshots', () => {
      registerWidgetSnapshot(makeValidSnapshot({ widgetId: 'visible', isVisible: true }))
      registerWidgetSnapshot(makeValidSnapshot({ widgetId: 'hidden', isVisible: false }))

      const visible = getAllVisibleSnapshots()
      expect(visible).toHaveLength(1)
      expect(visible[0].widgetId).toBe('visible')
    })
  })

  // --------------------------------------------------------------------------
  // Unregister
  // --------------------------------------------------------------------------

  describe('unregisterWidgetSnapshot', () => {
    it('should remove a registered snapshot', () => {
      registerWidgetSnapshot(makeValidSnapshot())
      expect(getSnapshotCount()).toBe(1)

      expect(unregisterWidgetSnapshot('w_test')).toBe(true)
      expect(getSnapshotCount()).toBe(0)
      expect(getWidgetSnapshot('w_test')).toBeNull()
    })

    it('should return false for unregistered widget', () => {
      expect(unregisterWidgetSnapshot('nonexistent')).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // Active Widget
  // --------------------------------------------------------------------------

  describe('activeWidgetId', () => {
    it('should default to null', () => {
      expect(getActiveWidgetId()).toBeNull()
    })

    it('should set and get active widget ID', () => {
      setActiveWidgetId('w_recent')
      expect(getActiveWidgetId()).toBe('w_recent')
    })

    it('should clear active widget ID', () => {
      setActiveWidgetId('w_recent')
      setActiveWidgetId(null)
      expect(getActiveWidgetId()).toBeNull()
    })
  })

  // --------------------------------------------------------------------------
  // Clear / Debug
  // --------------------------------------------------------------------------

  describe('clearAllSnapshots', () => {
    it('should remove all snapshots and reset active widget', () => {
      registerWidgetSnapshot(makeValidSnapshot({ widgetId: 'a' }))
      registerWidgetSnapshot(makeValidSnapshot({ widgetId: 'b' }))
      setActiveWidgetId('a')

      clearAllSnapshots()

      expect(getSnapshotCount()).toBe(0)
      expect(getActiveWidgetId()).toBeNull()
    })
  })
})
