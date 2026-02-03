/**
 * Unit Tests: Widget UI Snapshot Plan (post-registry)
 *
 * Tests the additions from widget-ui-snapshot-plan.md:
 * - A1: buildTurnSnapshot metadata (uiSnapshotId, revisionId, capturedAtMs, hasBadgeLetters)
 * - A2: totalCount field on SnapshotListSegment
 * - A3: description field on SnapshotListItem
 * - B1: "next one" / "previous one" patterns in isSelectionLike
 * - Mixed widget selection + context
 * - Multi-list ambiguity
 * - Non-list widget (context-only)
 * - Payload builder dedup + caps
 */

import {
  registerWidgetSnapshot,
  clearAllSnapshots,
  getAllVisibleSnapshots,
  type WidgetSnapshot,
  type SnapshotListSegment,
} from '@/lib/widgets/ui-snapshot-registry'

import {
  buildTurnSnapshot,
} from '@/lib/chat/ui-snapshot-builder'

import {
  isSelectionLike,
  checkMultiListAmbiguity,
  resolveWidgetSelection,
} from '@/lib/chat/grounding-set'

// ============================================================================
// Helpers
// ============================================================================

function makeSnapshot(overrides?: Partial<WidgetSnapshot>): WidgetSnapshot {
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
          { itemId: 'item_1', label: 'Panel D', actions: ['open'] },
          { itemId: 'item_2', label: 'Panel E', actions: ['open'] },
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

describe('widget-ui-snapshot-plan', () => {
  beforeEach(() => {
    clearAllSnapshots()
  })

  // --------------------------------------------------------------------------
  // Test 1: buildTurnSnapshot metadata (A1)
  // --------------------------------------------------------------------------

  describe('buildTurnSnapshot metadata', () => {
    it('should return uiSnapshotId as snap_<base36>_<random>', () => {
      registerWidgetSnapshot(makeSnapshot())
      const result = buildTurnSnapshot()
      expect(result.uiSnapshotId).toMatch(/^snap_[a-z0-9]+_[a-z0-9]+$/)
    })

    it('should return monotonically increasing revisionId', () => {
      registerWidgetSnapshot(makeSnapshot())
      const r1 = buildTurnSnapshot()
      const r2 = buildTurnSnapshot()
      const r3 = buildTurnSnapshot()
      expect(r2.revisionId).toBeGreaterThan(r1.revisionId)
      expect(r3.revisionId).toBeGreaterThan(r2.revisionId)
    })

    it('should return capturedAtMs matching the now parameter', () => {
      registerWidgetSnapshot(makeSnapshot())
      const now = 1700000000000
      const result = buildTurnSnapshot({ now })
      expect(result.capturedAtMs).toBe(now)
    })

    it('should return capturedAtMs close to Date.now() by default', () => {
      registerWidgetSnapshot(makeSnapshot())
      const before = Date.now()
      const result = buildTurnSnapshot()
      const after = Date.now()
      expect(result.capturedAtMs).toBeGreaterThanOrEqual(before)
      expect(result.capturedAtMs).toBeLessThanOrEqual(after)
    })
  })

  // --------------------------------------------------------------------------
  // hasBadgeLetters (B2)
  // --------------------------------------------------------------------------

  describe('hasBadgeLetters', () => {
    it('should return false when no widget has badgesEnabled', () => {
      registerWidgetSnapshot(makeSnapshot())
      const result = buildTurnSnapshot()
      expect(result.hasBadgeLetters).toBe(false)
    })

    it('should return true when a widget has badgesEnabled', () => {
      registerWidgetSnapshot(makeSnapshot({
        segments: [{
          segmentId: 'w_test:list',
          segmentType: 'list',
          listLabel: 'Test Items',
          badgesEnabled: true,
          visibleItemRange: { start: 0, end: 1 },
          items: [{ itemId: 'item_1', label: 'Panel D', badge: 'D', badgeVisible: true, actions: ['open'] }],
        }],
      }))
      const result = buildTurnSnapshot()
      expect(result.hasBadgeLetters).toBe(true)
    })

    it('should return false when badgesEnabled widget is stale', () => {
      const now = Date.now()
      registerWidgetSnapshot(makeSnapshot({
        registeredAt: now - 120_000, // very stale
        segments: [{
          segmentId: 'w_test:list',
          segmentType: 'list',
          listLabel: 'Test Items',
          badgesEnabled: true,
          visibleItemRange: { start: 0, end: 1 },
          items: [{ itemId: 'item_1', label: 'Panel D', badge: 'D', actions: ['open'] }],
        }],
      }))
      const result = buildTurnSnapshot({ now })
      expect(result.hasBadgeLetters).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // Test 2: isSelectionLike updates (B1)
  // --------------------------------------------------------------------------

  describe('isSelectionLike — sequential patterns', () => {
    it('"next one" should be selection-like', () => {
      expect(isSelectionLike('next one')).toBe(true)
    })

    it('"previous one" should be selection-like', () => {
      expect(isSelectionLike('previous one')).toBe(true)
    })

    it('"the next one" should be selection-like', () => {
      expect(isSelectionLike('the next one')).toBe(true)
    })

    it('"the previous" should be selection-like', () => {
      expect(isSelectionLike('the previous')).toBe(true)
    })

    it('"next" should be selection-like', () => {
      expect(isSelectionLike('next')).toBe(true)
    })

    it('"previous" should be selection-like', () => {
      expect(isSelectionLike('previous')).toBe(true)
    })

    it('"summarize this widget" should NOT be selection-like', () => {
      expect(isSelectionLike('summarize this widget')).toBe(false)
    })

    it('"what does this widget mean?" should NOT be selection-like', () => {
      expect(isSelectionLike('what does this widget mean?')).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // Test 3: Mixed widget selection + context
  // --------------------------------------------------------------------------

  describe('mixed widget selection + context', () => {
    it('should resolve "panel d" via widget list', () => {
      registerWidgetSnapshot(makeSnapshot({
        widgetId: 'w_mixed',
        title: 'Mixed',
        segments: [
          {
            segmentId: 'w_mixed:list',
            segmentType: 'list',
            listLabel: 'Items',
            badgesEnabled: false,
            visibleItemRange: { start: 0, end: 2 },
            items: [
              { itemId: 'item_d', label: 'Panel D', actions: ['open'] },
              { itemId: 'item_e', label: 'Panel E', actions: ['open'] },
            ],
          } satisfies SnapshotListSegment,
          {
            segmentId: 'w_mixed:context',
            segmentType: 'context',
            summary: 'Shows recent panels',
            currentView: 'list',
          },
        ],
      }))

      const result = buildTurnSnapshot()
      const widget = result.openWidgets.find(w => w.id === 'w_mixed')!
      expect(widget).toBeDefined()
      expect(widget.options).toHaveLength(2)

      // resolveWidgetSelection should match "panel d"
      const match = resolveWidgetSelection('panel d in Mixed', widget)
      expect(match.matched).toBe(true)
      expect(match.candidate?.id).toBe('item_d')
    })

    it('"what does this widget mean?" should NOT be selection-like', () => {
      expect(isSelectionLike('what does this widget mean?')).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // Test 4: Multi-list ambiguity
  // --------------------------------------------------------------------------

  describe('multi-list ambiguity', () => {
    it('should detect ambiguity with two widget lists and selection-like input', () => {
      const widgetA = {
        id: 'w_a',
        label: 'Widget A',
        options: [{ id: 'a1', label: 'Item A1', type: 'widget_option' as const }],
      }
      const widgetB = {
        id: 'w_b',
        label: 'Widget B',
        options: [{ id: 'b1', label: 'Item B1', type: 'widget_option' as const }],
      }

      const result = checkMultiListAmbiguity('first option', [widgetA, widgetB])
      expect(result.isAmbiguous).toBe(true)
      expect(result.widgets).toHaveLength(2)
    })

    it('should NOT detect ambiguity with only one widget', () => {
      const widget = {
        id: 'w_a',
        label: 'Widget A',
        options: [{ id: 'a1', label: 'Item A1', type: 'widget_option' as const }],
      }

      const result = checkMultiListAmbiguity('first option', [widget])
      expect(result.isAmbiguous).toBe(false)
    })

    it('should NOT detect ambiguity when user names a specific widget', () => {
      const widgetA = {
        id: 'w_a',
        label: 'Recent',
        options: [{ id: 'a1', label: 'Item A1', type: 'widget_option' as const }],
      }
      const widgetB = {
        id: 'w_b',
        label: 'Links',
        options: [{ id: 'b1', label: 'Item B1', type: 'widget_option' as const }],
      }

      const result = checkMultiListAmbiguity('first option in recent', [widgetA, widgetB])
      expect(result.isAmbiguous).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // Test 5: Non-list widget (context-only)
  // --------------------------------------------------------------------------

  describe('non-list widget', () => {
    it('should not appear in openWidgets when it has only context segments', () => {
      registerWidgetSnapshot(makeSnapshot({
        widgetId: 'w_context_only',
        segments: [{
          segmentId: 'w_context_only:context',
          segmentType: 'context',
          summary: 'Dashboard overview widget',
          currentView: 'summary',
        }],
      }))

      const result = buildTurnSnapshot()
      expect(result.openWidgets).toEqual([])
    })
  })

  // --------------------------------------------------------------------------
  // A2: totalCount field
  // --------------------------------------------------------------------------

  describe('totalCount field', () => {
    it('should accept totalCount on list segments', () => {
      const success = registerWidgetSnapshot(makeSnapshot({
        segments: [{
          segmentId: 'w_test:list',
          segmentType: 'list',
          listLabel: 'Items',
          badgesEnabled: false,
          visibleItemRange: { start: 0, end: 2 },
          items: [
            { itemId: 'item_1', label: 'Item 1', actions: ['open'] },
            { itemId: 'item_2', label: 'Item 2', actions: ['open'] },
          ],
          totalCount: 50,
        } satisfies SnapshotListSegment],
      }))
      expect(success).toBe(true)

      const snapshots = getAllVisibleSnapshots()
      const seg = snapshots[0].segments[0] as SnapshotListSegment
      expect(seg.totalCount).toBe(50)
    })

    it('should accept undefined totalCount', () => {
      const success = registerWidgetSnapshot(makeSnapshot())
      expect(success).toBe(true)

      const snapshots = getAllVisibleSnapshots()
      const seg = snapshots[0].segments[0] as SnapshotListSegment
      expect(seg.totalCount).toBeUndefined()
    })
  })

  // --------------------------------------------------------------------------
  // A3: description field on items
  // --------------------------------------------------------------------------

  describe('description field on items', () => {
    it('should accept description on list items', () => {
      const success = registerWidgetSnapshot(makeSnapshot({
        segments: [{
          segmentId: 'w_test:list',
          segmentType: 'list',
          listLabel: 'Items',
          badgesEnabled: false,
          visibleItemRange: { start: 0, end: 1 },
          items: [{
            itemId: 'item_1',
            label: 'Sprint 14',
            actions: ['open'],
            description: 'Latest sprint workspace',
          }],
        } satisfies SnapshotListSegment],
      }))
      expect(success).toBe(true)

      const snapshots = getAllVisibleSnapshots()
      const seg = snapshots[0].segments[0] as SnapshotListSegment
      expect(seg.items[0].description).toBe('Latest sprint workspace')
    })

    it('should truncate description to MAX_SUMMARY_LENGTH (200 chars)', () => {
      const longDescription = 'x'.repeat(300)
      registerWidgetSnapshot(makeSnapshot({
        segments: [{
          segmentId: 'w_test:list',
          segmentType: 'list',
          listLabel: 'Items',
          badgesEnabled: false,
          visibleItemRange: { start: 0, end: 1 },
          items: [{
            itemId: 'item_1',
            label: 'Item',
            actions: ['open'],
            description: longDescription,
          }],
        } satisfies SnapshotListSegment],
      }))

      const snapshots = getAllVisibleSnapshots()
      const seg = snapshots[0].segments[0] as SnapshotListSegment
      expect(seg.items[0].description?.length).toBe(200)
    })

    it('should accept items without description', () => {
      registerWidgetSnapshot(makeSnapshot())

      const snapshots = getAllVisibleSnapshots()
      const seg = snapshots[0].segments[0] as SnapshotListSegment
      expect(seg.items[0].description).toBeUndefined()
    })
  })

  // --------------------------------------------------------------------------
  // Test 6: Payload builder (dedup, caps, truncation)
  // --------------------------------------------------------------------------

  describe('payload builder logic', () => {
    it('should dedup snapshots by widgetId (newest wins)', () => {
      // Register two snapshots with same widgetId, different timestamps
      const older: WidgetSnapshot = {
        _version: 1,
        widgetId: 'w_dup',
        title: 'Older',
        isVisible: true,
        segments: [{
          segmentId: 'w_dup:context',
          segmentType: 'context',
          summary: 'Old summary',
          currentView: 'list',
        }],
        registeredAt: 1000,
      }
      const newer: WidgetSnapshot = {
        _version: 1,
        widgetId: 'w_dup',
        title: 'Newer',
        isVisible: true,
        segments: [{
          segmentId: 'w_dup:context',
          segmentType: 'context',
          summary: 'New summary',
          currentView: 'list',
        }],
        registeredAt: 2000,
      }

      // Register older first, then newer overwrites
      registerWidgetSnapshot(older)
      registerWidgetSnapshot(newer)

      const all = getAllVisibleSnapshots()
      // Registry keeps last registration per widgetId
      expect(all).toHaveLength(1)
      expect(all[0].title).toBe('Newer')
    })

    it('should build context segments from visible snapshots', () => {
      registerWidgetSnapshot(makeSnapshot({
        widgetId: 'w_ctx',
        title: 'Context Widget',
        segments: [
          {
            segmentId: 'w_ctx:context',
            segmentType: 'context',
            summary: 'Shows recent workspaces',
            currentView: 'list',
            focusText: 'Sprint 14',
          },
          {
            segmentId: 'w_ctx:list',
            segmentType: 'list',
            listLabel: 'Items',
            badgesEnabled: false,
            visibleItemRange: { start: 0, end: 1 },
            items: [{ itemId: 'ws_1', label: 'Sprint 14', actions: ['open'], description: 'Latest sprint' }],
          } satisfies SnapshotListSegment,
        ],
      }))

      const all = getAllVisibleSnapshots()
      const contextSegs = all.flatMap(snap =>
        snap.segments
          .filter(seg => seg.segmentType === 'context')
          .map(seg => ({
            widgetId: snap.widgetId,
            widgetTitle: snap.title,
            segmentId: seg.segmentId,
            summary: seg.summary,
            currentView: seg.currentView,
            focusText: seg.focusText,
          }))
      )

      expect(contextSegs).toHaveLength(1)
      expect(contextSegs[0]).toEqual({
        widgetId: 'w_ctx',
        widgetTitle: 'Context Widget',
        segmentId: 'w_ctx:context',
        summary: 'Shows recent workspaces',
        currentView: 'list',
        focusText: 'Sprint 14',
      })
    })

    it('should build item descriptions respecting visibleItemRange', () => {
      registerWidgetSnapshot(makeSnapshot({
        widgetId: 'w_items',
        segments: [{
          segmentId: 'w_items:list',
          segmentType: 'list',
          listLabel: 'Items',
          badgesEnabled: false,
          visibleItemRange: { start: 0, end: 2 },
          items: [
            { itemId: 'i1', label: 'Visible 1', actions: ['open'], description: 'Desc 1' },
            { itemId: 'i2', label: 'Visible 2', actions: ['open'], description: 'Desc 2' },
            { itemId: 'i3', label: 'Hidden 3', actions: ['open'], description: 'Desc 3' },
          ],
        } satisfies SnapshotListSegment],
      }))

      const all = getAllVisibleSnapshots()
      const itemDescs = all.flatMap(snap =>
        snap.segments
          .filter(seg => seg.segmentType === 'list')
          .flatMap(seg => {
            const listSeg = seg as SnapshotListSegment
            const items = listSeg.visibleItemRange
              ? listSeg.items.slice(listSeg.visibleItemRange.start, listSeg.visibleItemRange.end)
              : listSeg.items
            return items
              .filter(item => item.description)
              .map(item => ({
                widgetId: snap.widgetId,
                itemId: item.itemId,
                label: item.label,
                description: item.description,
              }))
          })
      )

      expect(itemDescs).toHaveLength(2)
      expect(itemDescs[0].itemId).toBe('i1')
      expect(itemDescs[1].itemId).toBe('i2')
      // i3 is outside visibleItemRange (start:0, end:2) → excluded
    })
  })
})
