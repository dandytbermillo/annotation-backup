/**
 * Dispatcher-Level Integration Tests: Selection Intent Arbitration Race Conditions
 *
 * These tests call `dispatchRouting()` with real context objects to verify end-to-end
 * wiring of the focus latch system under race conditions. Unlike the helper-level tests
 * in selection-intent-arbitration-race.test.ts, these exercise the full routing chain:
 *
 * 1. Resolved latch + stale snapshot + ordinal → widget item (NOT stale chat)
 * 2. Pending latch + stale snapshot + ordinal → blocks stale chat, Tier 4.5 resolves
 * 3. No latch + stale snapshot + ordinal → stale chat captures (baseline)
 * 4. Latch + explicit command → latch bypassed, known-noun routes
 */

// ============================================================================
// Module Mocks (must be before imports)
// ============================================================================

// Prevent debug log DB writes
jest.mock('@/lib/utils/debug-logger', () => ({
  debugLog: jest.fn(),
}))

// Control the turn snapshot returned to dispatcher
const mockBuildTurnSnapshot = jest.fn()
jest.mock('@/lib/chat/ui-snapshot-builder', () => ({
  buildTurnSnapshot: (...args: unknown[]) => mockBuildTurnSnapshot(...args),
  DEFAULT_SNAPSHOT_FRESHNESS_MS: 60000,
}))

// Prevent LLM calls
jest.mock('@/lib/chat/clarification-llm-fallback', () => ({
  callClarificationLLMClient: jest.fn().mockResolvedValue({ success: false }),
  isLLMFallbackEnabledClient: jest.fn().mockReturnValue(false),
}))

jest.mock('@/lib/chat/grounding-llm-fallback', () => ({
  callGroundingLLM: jest.fn().mockResolvedValue({ success: false }),
  isGroundingLLMEnabled: jest.fn().mockReturnValue(false),
}))

// Prevent doc retrieval and cross-corpus
jest.mock('@/lib/chat/doc-routing', () => ({
  handleDocRetrieval: jest.fn().mockResolvedValue({ handled: false }),
}))

jest.mock('@/lib/chat/cross-corpus-handler', () => ({
  handleCrossCorpusRetrieval: jest.fn().mockResolvedValue({ handled: false }),
}))

// Mock widget snapshot registry (used by grounding-set for getWidgetSnapshot)
jest.mock('@/lib/widgets/ui-snapshot-registry', () => ({
  getWidgetSnapshot: jest.fn().mockReturnValue(null),
  getAllVisibleSnapshots: jest.fn().mockReturnValue([]),
}))

// Mock known-noun routing (default: not handled)
const mockHandleKnownNounRouting = jest.fn().mockReturnValue({ handled: false })
jest.mock('@/lib/chat/known-noun-routing', () => ({
  handleKnownNounRouting: (...args: unknown[]) => mockHandleKnownNounRouting(...args),
}))

// Prevent fetch API calls
global.fetch = jest.fn().mockResolvedValue({
  ok: false,
  status: 500,
  json: async () => ({}),
}) as jest.Mock

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { dispatchRouting, type RoutingDispatcherContext, type RoutingDispatcherResult } from '@/lib/chat/routing-dispatcher'
import type { ResolvedFocusLatch, PendingFocusLatch, ClarificationSnapshot, ClarificationOption } from '@/lib/chat/chat-navigation-context'
import type { OpenWidgetState } from '@/lib/chat/grounding-set'

// ============================================================================
// Feature Flag
// ============================================================================

const originalEnv = process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1

beforeAll(() => {
  process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 = 'true'
})

afterAll(() => {
  process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 = originalEnv
})

// ============================================================================
// Test Fixtures
// ============================================================================

/** Widget items in Links Panel D */
const WIDGET_ITEMS: ClarificationOption[] = [
  { id: 'item_1', label: 'summary144 D', sublabel: 'Entry', type: 'widget_option' },
  { id: 'item_2', label: 'summary 155 D', sublabel: 'Entry', type: 'widget_option' },
  { id: 'item_3', label: 'summary 166 D', sublabel: 'Entry', type: 'widget_option' },
]

/** Stale disambiguation options (from a previous "links panel" query) */
const STALE_DISAMBIGUATION_OPTIONS: ClarificationOption[] = [
  { id: 'opt_1', label: 'Links Panels', type: 'panel_drawer' },
  { id: 'opt_2', label: 'Links Panel D', type: 'panel_drawer' },
  { id: 'opt_3', label: 'Links Panel E', type: 'panel_drawer' },
]

/** OpenWidgetState for Links Panel D */
const LINKS_PANEL_D_WIDGET: OpenWidgetState = {
  id: 'w_links_d',
  label: 'Links Panel D',
  panelId: 'uuid-links-panel-d',
  listSegmentCount: 1,
  options: WIDGET_ITEMS,
}

/** Controlled turn snapshot with Links Panel D widget */
function makeTurnSnapshot(overrides?: Partial<{ openWidgets: OpenWidgetState[]; activeSnapshotWidgetId: string | null; hasBadgeLetters: boolean }>) {
  return {
    openWidgets: overrides?.openWidgets ?? [LINKS_PANEL_D_WIDGET],
    activeSnapshotWidgetId: overrides?.activeSnapshotWidgetId ?? 'w_links_d',
    uiSnapshotId: 'test-snap-1',
    revisionId: 1,
    capturedAtMs: Date.now(),
    hasBadgeLetters: overrides?.hasBadgeLetters ?? false,
  }
}

/** Stale clarification snapshot (interrupt-paused, not stop-paused) */
function makeStaleClarificationSnapshot(): ClarificationSnapshot {
  return {
    options: STALE_DISAMBIGUATION_OPTIONS,
    originalIntent: 'links panel',
    type: 'panel_disambiguation',
    turnsSinceSet: 3,
    timestamp: Date.now() - 30000,
    paused: true,
    pausedReason: 'interrupt',
  }
}

function makeResolvedLatch(widgetId = 'w_links_d'): ResolvedFocusLatch {
  return {
    kind: 'resolved',
    widgetId,
    widgetLabel: 'Links Panel D',
    latchedAt: Date.now(),
    turnsSinceLatched: 0,
  }
}

function makePendingLatch(panelId = 'uuid-links-panel-d'): PendingFocusLatch {
  return {
    kind: 'pending',
    pendingPanelId: panelId,
    widgetLabel: 'Links Panel D',
    latchedAt: Date.now(),
    turnsSinceLatched: 0,
  }
}

// ============================================================================
// Mock Context Factory
// ============================================================================

function createMockDispatchContext(overrides?: Partial<RoutingDispatcherContext>): RoutingDispatcherContext {
  return {
    // Input
    trimmedInput: 'open the second one pls',

    // Suggestion routing
    lastSuggestion: null,
    setLastSuggestion: jest.fn(),
    addRejectedSuggestions: jest.fn(),
    clearRejectedSuggestions: jest.fn(),

    // Clarification state
    lastClarification: null,
    pendingOptions: [],
    activeOptionSetId: null,
    setActiveOptionSetId: jest.fn(),
    uiContext: { mode: 'dashboard', dashboard: { entryName: 'Test Entry', visibleWidgets: [] } },
    currentEntryId: 'entry-1',
    addMessage: jest.fn(),
    setLastClarification: jest.fn(),
    setIsLoading: jest.fn(),
    setPendingOptions: jest.fn(),
    setPendingOptionsMessageId: jest.fn(),
    setPendingOptionsGraceCount: jest.fn(),
    setNotesScopeFollowUpActive: jest.fn(),
    handleSelectOption: jest.fn(),

    // Repair memory
    repairMemory: null,
    setRepairMemory: jest.fn(),
    incrementRepairMemoryTurn: jest.fn(),
    clearRepairMemory: jest.fn(),

    // Clarification snapshot
    clarificationSnapshot: null,
    saveClarificationSnapshot: jest.fn(),
    pauseSnapshotWithReason: jest.fn(),
    incrementSnapshotTurn: jest.fn(),
    clearClarificationSnapshot: jest.fn(),

    // Stop suppression
    stopSuppressionCount: 0,
    setStopSuppressionCount: jest.fn(),
    decrementStopSuppression: jest.fn(),

    // Doc/Routing
    docRetrievalState: null,
    knownTermsFetchStatus: 'snapshot' as const,
    usedCoreAppTermsFallback: false,
    updateDocRetrievalState: jest.fn(),
    messages: [],

    // Command reshow
    findLastOptionsMessage: jest.fn().mockReturnValue(null),
    reshowWindowMs: 2000,

    // Preview
    lastPreview: null,
    openPanelDrawer: jest.fn(),
    openPanelWithTracking: jest.fn(),

    // Session/Grounding
    sessionState: {},
    lastOptionsShown: null,
    saveLastOptionsShown: jest.fn(),
    incrementLastOptionsShownTurn: jest.fn(),
    clearLastOptionsShown: jest.fn(),

    // Widget registry
    getVisibleSnapshots: jest.fn().mockReturnValue([]),
    getActiveWidgetId: jest.fn().mockReturnValue('w_links_d'),

    // Widget selection
    widgetSelectionContext: null,
    setWidgetSelectionContext: jest.fn(),
    incrementWidgetSelectionTurn: jest.fn(),
    clearWidgetSelectionContext: jest.fn(),

    // Focus latch
    focusLatch: null,
    setFocusLatch: jest.fn(),
    suspendFocusLatch: jest.fn(),
    incrementFocusLatchTurn: jest.fn(),
    clearFocusLatch: jest.fn(),

    ...overrides,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('dispatchRouting: selection-intent-arbitration race conditions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default: return Links Panel D widget snapshot
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot())
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
  })

  it('Test 1: resolved latch + stale snapshot + ordinal → widget item (NOT stale chat)', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open the second one pls',
      focusLatch: makeResolvedLatch(),
      clarificationSnapshot: makeStaleClarificationSnapshot(),
    })

    const result = await dispatchRouting(ctx)

    // Widget item should be resolved via Tier 4.5 grounding
    expect(result.handled).toBe(true)
    expect(result.groundingAction).toBeDefined()
    expect(result.groundingAction!.type).toBe('execute_widget_item')
    expect(result.groundingAction!).toHaveProperty('itemId', 'item_2')
    expect(result.groundingAction!).toHaveProperty('itemLabel', 'summary 155 D')
    expect(result.groundingAction!).toHaveProperty('widgetId', 'w_links_d')

    // Stale chat snapshot should NOT have been used
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
  })

  it('Test 2: pending latch + stale snapshot + ordinal → pending upgrades, widget resolves', async () => {
    // Mock snapshot includes widget with matching panelId for pending → resolved upgrade
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET],
      activeSnapshotWidgetId: 'w_links_d',
    }))

    const ctx = createMockDispatchContext({
      trimmedInput: 'the second one',
      focusLatch: makePendingLatch(),
      clarificationSnapshot: makeStaleClarificationSnapshot(),
    })

    const result = await dispatchRouting(ctx)

    // Pending latch should have been upgraded to resolved via setFocusLatch
    expect(ctx.setFocusLatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'resolved',
        widgetId: 'w_links_d',
      })
    )

    // Widget item should be resolved via Tier 4.5
    expect(result.handled).toBe(true)
    expect(result.groundingAction).toBeDefined()
    expect(result.groundingAction!.type).toBe('execute_widget_item')
    expect(result.groundingAction!).toHaveProperty('itemId', 'item_2')

    // Stale chat snapshot should NOT have been used
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
  })

  it('Test 3: no latch + stale snapshot + ordinal → stale chat captures (baseline)', async () => {
    // No latch — stale interrupt-paused snapshot should capture the ordinal
    const ctx = createMockDispatchContext({
      trimmedInput: 'second one',
      focusLatch: null,
      clarificationSnapshot: makeStaleClarificationSnapshot(),
      // No widget in snapshot for this test — isolate stale-chat behavior
    })
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [],
      activeSnapshotWidgetId: null,
    }))

    const result = await dispatchRouting(ctx)

    // With interrupt-paused snapshot and no latch, the ordinal should resolve
    // against the stale snapshot (post-action ordinal window in chat-routing.ts)
    // This calls handleSelectOption with the selected option
    expect(result.handled).toBe(true)
    expect(ctx.handleSelectOption).toHaveBeenCalled()
    // The selected option should be index 1 (second one)
    const selectCall = (ctx.handleSelectOption as jest.Mock).mock.calls[0][0]
    expect(selectCall.label).toBe('Links Panel D')

    // Widget grounding action should NOT be set
    expect(result.groundingAction).toBeUndefined()
  })

  it('Test 4: latch + explicit command → latch bypassed, known-noun routes', async () => {
    // Mock known-noun to handle "open recent"
    mockHandleKnownNounRouting.mockReturnValue({
      handled: true,
      handledByTier: 4,
      tierLabel: 'known_noun_panel_command',
    })

    const ctx = createMockDispatchContext({
      trimmedInput: 'open recent',
      focusLatch: makeResolvedLatch(),
      clarificationSnapshot: makeStaleClarificationSnapshot(),
    })

    const result = await dispatchRouting(ctx)

    // Known-noun routing should have handled it
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(4)
    expect(result.tierLabel).toContain('known_noun')

    // Stale chat snapshot should NOT have been used
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // Widget grounding action should NOT be set (command bypassed latch)
    expect(result.groundingAction).toBeUndefined()
  })
})
