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
  isContextRetryEnabledClient: jest.fn().mockReturnValue(false),
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
import type { ResolvedFocusLatch, PendingFocusLatch, ClarificationSnapshot, ClarificationOption, ScopeCueRecoveryMemory } from '@/lib/chat/chat-navigation-context'
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

    // Scope-cue recovery memory (explicit-only, per scope-cue-recovery-plan)
    scopeCueRecoveryMemory: null,
    clearScopeCueRecoveryMemory: jest.fn(),

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

  // ==========================================================================
  // Scope-cue tests (per scope-cues-addendum-plan.md)
  // ==========================================================================

  it('Test 5: resolved latch + "in chat" scope cue + ordinal → chat option (NOT widget)', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open the first one in chat',
      focusLatch: makeResolvedLatch(),
      clarificationSnapshot: makeStaleClarificationSnapshot(),
    })

    const result = await dispatchRouting(ctx)

    // Scope cue should have routed to chat option #1
    expect(result.handled).toBe(true)
    expect(ctx.handleSelectOption).toHaveBeenCalled()
    const selectCall = (ctx.handleSelectOption as jest.Mock).mock.calls[0][0]
    expect(selectCall.label).toBe('Links Panels')

    // Latch should have been suspended
    expect(ctx.suspendFocusLatch).toHaveBeenCalled()
    // Widget selection context should have been cleared
    expect(ctx.clearWidgetSelectionContext).toHaveBeenCalled()

    // Widget grounding action should NOT be set
    expect(result.groundingAction).toBeUndefined()

    // Pending options must be CLEARED after single-turn execution (not left stale).
    // Bug fix: restoreFullChatState was setting pendingOptions which persisted after
    // handleSelectOption, causing subsequent inputs to resolve against stale chat options
    // instead of widget items.
    expect(ctx.setPendingOptions).toHaveBeenCalledWith([])
    expect(ctx.setPendingOptionsMessageId).toHaveBeenCalledWith(null)
    expect(ctx.setActiveOptionSetId).toHaveBeenCalledWith(null)
  })

  it('Test 6: resolved latch + "from chat" scope cue + no ordinal → restore only', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'from chat',
      focusLatch: makeResolvedLatch(),
      clarificationSnapshot: makeStaleClarificationSnapshot(),
    })

    const result = await dispatchRouting(ctx)

    // Should restore chat options without selection
    expect(result.handled).toBe(true)
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // Latch should have been suspended
    expect(ctx.suspendFocusLatch).toHaveBeenCalled()

    // Full chat state should be restored
    expect(ctx.setLastClarification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'option_selection',
        options: STALE_DISAMBIGUATION_OPTIONS,
      })
    )
    expect(ctx.setPendingOptions).toHaveBeenCalled()
    expect(ctx.setActiveOptionSetId).toHaveBeenCalled()
  })

  it('Test 7: resolved latch + "from chat" + no recoverable options → "No earlier options"', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'from chat',
      focusLatch: makeResolvedLatch(),
      clarificationSnapshot: null,
      lastOptionsShown: null,
      lastClarification: null,
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(ctx.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'No earlier options available.',
      })
    )
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
  })

  it('Test 8: no latch + "in chat" scope cue + ordinal + recoverable → chat option', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open the first one in chat',
      focusLatch: null,
      clarificationSnapshot: makeStaleClarificationSnapshot(),
    })
    // No widget in snapshot for this test
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [],
      activeSnapshotWidgetId: null,
    }))

    const result = await dispatchRouting(ctx)

    // Should resolve against chat options even without latch
    expect(result.handled).toBe(true)
    expect(ctx.handleSelectOption).toHaveBeenCalled()
    const selectCall = (ctx.handleSelectOption as jest.Mock).mock.calls[0][0]
    expect(selectCall.label).toBe('Links Panels')

    // No latch to suspend
    expect(ctx.suspendFocusLatch).not.toHaveBeenCalled()

    // Note: With no latch, latchBlocksStaleChat is false, so the interrupt-paused
    // ordinal window (line 1957-2005) handles the input before the scope-cue block.
    // The post-action ordinal window calls handleSelectOption directly without
    // setting/clearing pendingOptions. The scope-cue block is not reached.
  })

  it('Test 9: resolved latch + "open recent in chat" (command + scope cue) → falls through without restore', async () => {
    // Mock known-noun to handle "open recent"
    mockHandleKnownNounRouting.mockReturnValue({
      handled: true,
      handledByTier: 4,
      tierLabel: 'known_noun_panel_command',
    })

    const ctx = createMockDispatchContext({
      trimmedInput: 'open recent in chat',
      focusLatch: makeResolvedLatch(),
      clarificationSnapshot: makeStaleClarificationSnapshot(),
    })

    const result = await dispatchRouting(ctx)

    // Latch should have been suspended (scope cue respected)
    expect(ctx.suspendFocusLatch).toHaveBeenCalled()
    expect(ctx.clearWidgetSelectionContext).toHaveBeenCalled()

    // Chat state should NOT have been restored (command fallthrough)
    expect(ctx.setPendingOptions).not.toHaveBeenCalled()
    expect(ctx.setActiveOptionSetId).not.toHaveBeenCalled()

    // handleSelectOption should NOT have been called
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // Known-noun should have handled the command
    expect(result.handled).toBe(true)
    expect(result.tierLabel).toContain('known_noun')
  })

  // ==========================================================================
  // Tests 10-14: Scope-Cue Recovery Memory (per scope-cue-recovery-plan)
  // ==========================================================================

  it('Test 10: resolved latch + "in chat" + ordinal + ONLY recoveryMemory → chat option', async () => {
    // All TTL-based sources are gone — only recovery memory survives
    const recoveryMemory: ScopeCueRecoveryMemory = {
      options: STALE_DISAMBIGUATION_OPTIONS,
      messageId: 'recovery-123',
      timestamp: Date.now() - 60000,
    }

    const ctx = createMockDispatchContext({
      trimmedInput: 'open the first one in chat',
      focusLatch: makeResolvedLatch(),
      clarificationSnapshot: null,
      lastOptionsShown: null,
      lastClarification: null,
      scopeCueRecoveryMemory: recoveryMemory,
    })

    const result = await dispatchRouting(ctx)

    // Should resolve chat option #1 from recovery memory
    expect(result.handled).toBe(true)
    expect(ctx.handleSelectOption).toHaveBeenCalledTimes(1)
    expect(ctx.handleSelectOption).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Links Panels' })
    )

    // Latch should have been suspended
    expect(ctx.suspendFocusLatch).toHaveBeenCalled()
    expect(ctx.clearWidgetSelectionContext).toHaveBeenCalled()

    // Pending options should be cleared after single-turn execution (not left stale)
    expect(ctx.setPendingOptions).toHaveBeenCalledWith([])
    expect(ctx.setPendingOptionsMessageId).toHaveBeenCalledWith(null)
    expect(ctx.setActiveOptionSetId).toHaveBeenCalledWith(null)
  })

  it('Test 11: resolved latch + "from chat" + ONLY recoveryMemory → standalone restore', async () => {
    const recoveryMemory: ScopeCueRecoveryMemory = {
      options: STALE_DISAMBIGUATION_OPTIONS,
      messageId: 'recovery-456',
      timestamp: Date.now() - 60000,
    }

    const ctx = createMockDispatchContext({
      trimmedInput: 'from chat',
      focusLatch: makeResolvedLatch(),
      clarificationSnapshot: null,
      lastOptionsShown: null,
      lastClarification: null,
      scopeCueRecoveryMemory: recoveryMemory,
    })

    const result = await dispatchRouting(ctx)

    // Should restore chat state without selection
    expect(result.handled).toBe(true)
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // Full state should have been restored
    expect(ctx.setPendingOptions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Links Panels', index: 1 }),
        expect.objectContaining({ label: 'Links Panel D', index: 2 }),
        expect.objectContaining({ label: 'Links Panel E', index: 3 }),
      ])
    )
    expect(ctx.setActiveOptionSetId).toHaveBeenCalledWith('recovery-456')
    expect(ctx.setLastClarification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'option_selection' })
    )

    // Latch should have been suspended
    expect(ctx.suspendFocusLatch).toHaveBeenCalled()
  })

  it('Test 12 (Blocker): plain "open the second one" must NEVER read recovery memory', async () => {
    // Recovery memory is present but input has NO scope cue
    const recoveryMemory: ScopeCueRecoveryMemory = {
      options: STALE_DISAMBIGUATION_OPTIONS,
      messageId: 'recovery-789',
      timestamp: Date.now() - 60000,
    }

    const ctx = createMockDispatchContext({
      trimmedInput: 'open the second one',
      focusLatch: makeResolvedLatch(),
      clarificationSnapshot: null,
      lastOptionsShown: null,
      lastClarification: null,
      scopeCueRecoveryMemory: recoveryMemory,
    })

    const result = await dispatchRouting(ctx)

    // Should NOT have resolved chat option — no scope cue means recovery memory is never accessed
    // Widget latch should handle this instead via Tier 4.5 grounding
    expect(result.handled).toBe(true)

    // If handleSelectOption was called, it should NOT be with a chat option
    if ((ctx.handleSelectOption as jest.Mock).mock.calls.length > 0) {
      const calledWith = (ctx.handleSelectOption as jest.Mock).mock.calls[0][0]
      // Must NOT be a chat disambiguation option (panel_drawer from STALE_DISAMBIGUATION_OPTIONS)
      expect(calledWith.label).not.toBe('Links Panels')
      expect(calledWith.label).not.toBe('Links Panel D')
      expect(calledWith.label).not.toBe('Links Panel E')
    }

    // setPendingOptions should NOT have been called with chat options
    const setPendingCalls = (ctx.setPendingOptions as jest.Mock).mock.calls
    for (const call of setPendingCalls) {
      const options = call[0]
      if (Array.isArray(options) && options.length > 0) {
        // Any non-empty pending options should NOT be from recovery memory
        expect(options[0]).not.toEqual(
          expect.objectContaining({ label: 'Links Panels' })
        )
      }
    }
  })

  it('Test 13 (Blocker): "from chat" after known-noun clear + TTL expiry → restores from recovery memory', async () => {
    // Simulates: known-noun cleared lastOptionsShown, TTL expired it too — only recovery memory survives
    const recoveryMemory: ScopeCueRecoveryMemory = {
      options: STALE_DISAMBIGUATION_OPTIONS,
      messageId: 'recovery-durable',
      timestamp: Date.now() - 120000, // 2 minutes old — well past any TTL
    }

    const ctx = createMockDispatchContext({
      trimmedInput: 'from chat',
      focusLatch: makeResolvedLatch(),
      clarificationSnapshot: null,
      lastOptionsShown: null, // cleared by known-noun + TTL expired
      lastClarification: null,
      scopeCueRecoveryMemory: recoveryMemory,
    })

    const result = await dispatchRouting(ctx)

    // Should restore from recovery memory
    expect(result.handled).toBe(true)
    expect(ctx.setPendingOptions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Links Panels' }),
      ])
    )
    expect(ctx.setActiveOptionSetId).toHaveBeenCalledWith('recovery-durable')
  })

  it('Test 14 (Blocker): "from chat" after session reset → "No earlier options available."', async () => {
    // Simulates: session clear wiped everything including recovery memory
    const ctx = createMockDispatchContext({
      trimmedInput: 'from chat',
      focusLatch: makeResolvedLatch(),
      clarificationSnapshot: null,
      lastOptionsShown: null,
      lastClarification: null,
      scopeCueRecoveryMemory: null, // cleared by session reset
    })

    const result = await dispatchRouting(ctx)

    // Should return "No earlier options" message
    expect(result.handled).toBe(true)
    expect(ctx.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('No earlier options'),
      })
    )
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
  })
})
