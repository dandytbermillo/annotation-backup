/**
 * Unit Tests: UI Snapshot Builder (Layer 2)
 *
 * Tests the per-turn assembler that reads the registry and produces
 * OpenWidgetState[] for Tier 4.5 grounding-set consumption.
 */

import {
  registerWidgetSnapshot,
  clearAllSnapshots,
  setActiveWidgetId,
  type WidgetSnapshot,
  type SnapshotListSegment,
} from '@/lib/widgets/ui-snapshot-registry'

import {
  buildTurnSnapshot,
  getWidgetListItems,
  DEFAULT_SNAPSHOT_FRESHNESS_MS,
} from '@/lib/chat/ui-snapshot-builder'

// ============================================================================
// Helpers
// ============================================================================

function makeSnapshot(overrides?: Partial<WidgetSnapshot>): WidgetSnapshot {
  return {
    _version: 1,
    widgetId: 'w_recent',
    title: 'Recent',
    isVisible: true,
    segments: [
      {
        segmentId: 'w_recent:list',
        segmentType: 'list',
        listLabel: 'Recent Workspaces',
        badgesEnabled: false,
        visibleItemRange: { start: 0, end: 3 },
        items: [
          { itemId: 'ws_1', label: 'Project Alpha', actions: ['open'] },
          { itemId: 'ws_2', label: 'Project Beta', actions: ['open'] },
          { itemId: 'ws_3', label: 'Project Gamma', actions: ['open'] },
        ],
      } satisfies SnapshotListSegment,
    ],
    registeredAt: Date.now(),
    ...overrides,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('ui-snapshot-builder', () => {
  beforeEach(() => {
    clearAllSnapshots()
  })

  // --------------------------------------------------------------------------
  // buildTurnSnapshot — basic
  // --------------------------------------------------------------------------

  describe('buildTurnSnapshot', () => {
    it('should return empty openWidgets when no snapshots registered', () => {
      const result = buildTurnSnapshot()
      expect(result.openWidgets).toEqual([])
      expect(result.activeSnapshotWidgetId).toBeNull()
    })

    it('should return OpenWidgetState for a registered widget with list items', () => {
      registerWidgetSnapshot(makeSnapshot())

      const result = buildTurnSnapshot()
      expect(result.openWidgets).toHaveLength(1)

      const widget = result.openWidgets[0]
      expect(widget.id).toBe('w_recent')
      expect(widget.label).toBe('Recent')
      expect(widget.options).toHaveLength(3)
    })

    it('should map list items to ClarificationOption format', () => {
      registerWidgetSnapshot(makeSnapshot())

      const result = buildTurnSnapshot()
      const options = result.openWidgets[0].options

      expect(options[0]).toEqual({ id: 'ws_1', label: 'Project Alpha', type: 'widget_option' })
      expect(options[1]).toEqual({ id: 'ws_2', label: 'Project Beta', type: 'widget_option' })
      expect(options[2]).toEqual({ id: 'ws_3', label: 'Project Gamma', type: 'widget_option' })
    })

    it('should include multiple widgets', () => {
      registerWidgetSnapshot(makeSnapshot({ widgetId: 'w_recent', title: 'Recent' }))
      registerWidgetSnapshot(makeSnapshot({ widgetId: 'w_links', title: 'Links' }))

      const result = buildTurnSnapshot()
      expect(result.openWidgets).toHaveLength(2)

      const ids = result.openWidgets.map(w => w.id)
      expect(ids).toContain('w_recent')
      expect(ids).toContain('w_links')
    })

    it('should exclude widgets with no list segments', () => {
      registerWidgetSnapshot(makeSnapshot({
        widgetId: 'w_context_only',
        segments: [{
          segmentId: 'w_context_only:context',
          segmentType: 'context',
          summary: 'Just context',
          currentView: 'list',
        }],
      }))

      const result = buildTurnSnapshot()
      expect(result.openWidgets).toEqual([])
    })

    it('should exclude hidden widgets', () => {
      registerWidgetSnapshot(makeSnapshot({ isVisible: false }))

      const result = buildTurnSnapshot()
      expect(result.openWidgets).toEqual([])
    })
  })

  // --------------------------------------------------------------------------
  // buildTurnSnapshot — freshness guard
  // --------------------------------------------------------------------------

  describe('freshness guard', () => {
    it('should include fresh snapshots', () => {
      const now = Date.now()
      registerWidgetSnapshot(makeSnapshot({ registeredAt: now - 1000 }))

      const result = buildTurnSnapshot({ now })
      expect(result.openWidgets).toHaveLength(1)
    })

    it('should exclude stale snapshots (older than default threshold)', () => {
      const now = Date.now()
      registerWidgetSnapshot(makeSnapshot({ registeredAt: now - DEFAULT_SNAPSHOT_FRESHNESS_MS - 1 }))

      const result = buildTurnSnapshot({ now })
      expect(result.openWidgets).toEqual([])
    })

    it('should respect custom freshness threshold', () => {
      const now = Date.now()
      // Registered 5 seconds ago
      registerWidgetSnapshot(makeSnapshot({ registeredAt: now - 5000 }))

      // With 3-second threshold → stale
      const staleResult = buildTurnSnapshot({ now, freshnessThresholdMs: 3000 })
      expect(staleResult.openWidgets).toEqual([])

      // With 10-second threshold → fresh
      const freshResult = buildTurnSnapshot({ now, freshnessThresholdMs: 10000 })
      expect(freshResult.openWidgets).toHaveLength(1)
    })

    it('should exclude snapshot at exactly the threshold boundary', () => {
      const now = Date.now()
      registerWidgetSnapshot(makeSnapshot({ registeredAt: now - DEFAULT_SNAPSHOT_FRESHNESS_MS }))

      const result = buildTurnSnapshot({ now })
      expect(result.openWidgets).toEqual([])
    })
  })

  // --------------------------------------------------------------------------
  // buildTurnSnapshot — activeSnapshotWidgetId
  // --------------------------------------------------------------------------

  describe('activeSnapshotWidgetId', () => {
    it('should return null when no active widget set', () => {
      const result = buildTurnSnapshot()
      expect(result.activeSnapshotWidgetId).toBeNull()
    })

    it('should return the active widget ID', () => {
      setActiveWidgetId('w_recent')
      registerWidgetSnapshot(makeSnapshot())

      const result = buildTurnSnapshot()
      expect(result.activeSnapshotWidgetId).toBe('w_recent')
    })
  })

  // --------------------------------------------------------------------------
  // buildTurnSnapshot — multi-segment widgets
  // --------------------------------------------------------------------------

  describe('multi-segment widgets', () => {
    it('should combine items from multiple list segments in same widget', () => {
      registerWidgetSnapshot(makeSnapshot({
        widgetId: 'w_multi',
        segments: [
          {
            segmentId: 'w_multi:list_a',
            segmentType: 'list',
            listLabel: 'List A',
            badgesEnabled: false,
            visibleItemRange: { start: 0, end: 1 },
            items: [{ itemId: 'a1', label: 'A1', actions: ['open'] }],
          },
          {
            segmentId: 'w_multi:list_b',
            segmentType: 'list',
            listLabel: 'List B',
            badgesEnabled: false,
            visibleItemRange: { start: 0, end: 1 },
            items: [{ itemId: 'b1', label: 'B1', actions: ['open'] }],
          },
          {
            segmentId: 'w_multi:context',
            segmentType: 'context',
            summary: 'Multi-list widget',
            currentView: 'list',
          },
        ],
      }))

      const result = buildTurnSnapshot()
      expect(result.openWidgets).toHaveLength(1)
      expect(result.openWidgets[0].options).toHaveLength(2)
      expect(result.openWidgets[0].options[0].id).toBe('a1')
      expect(result.openWidgets[0].options[1].id).toBe('b1')
    })
  })

  // --------------------------------------------------------------------------
  // getWidgetListItems
  // --------------------------------------------------------------------------

  describe('getWidgetListItems', () => {
    it('should return empty array for unregistered widget', () => {
      expect(getWidgetListItems('nonexistent')).toEqual([])
    })

    it('should return all list items for a widget', () => {
      registerWidgetSnapshot(makeSnapshot())

      const items = getWidgetListItems('w_recent')
      expect(items).toHaveLength(3)
      expect(items[0]).toEqual({ id: 'ws_1', label: 'Project Alpha', type: 'widget_option' })
    })

    it('should filter by segmentId when provided', () => {
      registerWidgetSnapshot(makeSnapshot({
        widgetId: 'w_multi',
        segments: [
          {
            segmentId: 'w_multi:list_a',
            segmentType: 'list',
            listLabel: 'A',
            badgesEnabled: false,
            visibleItemRange: { start: 0, end: 1 },
            items: [{ itemId: 'a1', label: 'A1', actions: ['open'] }],
          },
          {
            segmentId: 'w_multi:list_b',
            segmentType: 'list',
            listLabel: 'B',
            badgesEnabled: false,
            visibleItemRange: { start: 0, end: 1 },
            items: [{ itemId: 'b1', label: 'B1', actions: ['open'] }],
          },
        ],
      }))

      const aItems = getWidgetListItems('w_multi', 'w_multi:list_a')
      expect(aItems).toHaveLength(1)
      expect(aItems[0].id).toBe('a1')

      const bItems = getWidgetListItems('w_multi', 'w_multi:list_b')
      expect(bItems).toHaveLength(1)
      expect(bItems[0].id).toBe('b1')
    })

    it('should return empty for context-only widget', () => {
      registerWidgetSnapshot(makeSnapshot({
        segments: [{
          segmentId: 'w_recent:context',
          segmentType: 'context',
          summary: 'No lists here',
          currentView: 'list',
        }],
      }))

      expect(getWidgetListItems('w_recent')).toEqual([])
    })
  })
})
