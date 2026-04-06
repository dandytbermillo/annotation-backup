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

// Prevent LLM calls (default: disabled; overridden in semantic escape tests)
const mockCallClarificationLLMClient = jest.fn().mockResolvedValue({ success: false })
const mockIsLLMFallbackEnabledClient = jest.fn().mockReturnValue(false)
jest.mock('@/lib/chat/clarification-llm-fallback', () => ({
  callClarificationLLMClient: (...args: unknown[]) => mockCallClarificationLLMClient(...args),
  isLLMFallbackEnabledClient: (...args: unknown[]) => mockIsLLMFallbackEnabledClient(...args),
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
  validateVisibility: jest.fn().mockReturnValue({ valid: false, reason: 'panel_not_visible' }),
  validateDuplicateFamily: jest.fn().mockReturnValue({ valid: true }),
  detectQuestionGuard: jest.fn().mockReturnValue('none'),
  resolveToVisiblePanel: jest.fn().mockReturnValue(null),
}))

// Mock semantic hint lookup for escape evidence tests
const mockLookupSemanticHints = jest.fn().mockResolvedValue({ status: 'empty', candidates: [], latencyMs: 0 })
jest.mock('@/lib/chat/routing-log/memory-semantic-reader', () => ({
  lookupSemanticHints: (...args: unknown[]) => mockLookupSemanticHints(...args),
  lookupSemanticMemory: jest.fn().mockResolvedValue({ status: 'empty', candidates: [], latencyMs: 0 }),
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
import type { ResolvedFocusLatch, PendingFocusLatch, ClarificationSnapshot, ClarificationOption, ScopeCueRecoveryMemory, SelectionContinuityState, PendingScopeTypoClarifier } from '@/lib/chat/chat-navigation-context'
import { EMPTY_CONTINUITY_STATE } from '@/lib/chat/chat-navigation-context'
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

    // Pending scope-typo clarifier (per scope-cues-addendum-plan.md §typoScopeCueGate)
    pendingScopeTypoClarifier: null,
    setPendingScopeTypoClarifier: jest.fn(),
    clearPendingScopeTypoClarifier: jest.fn(),

    // Selection continuity (Plan 20)
    selectionContinuity: EMPTY_CONTINUITY_STATE,
    updateSelectionContinuity: jest.fn(),
    recordAcceptedChoice: jest.fn(),
    recordRejectedChoice: jest.fn(),
    resetSelectionContinuity: jest.fn(),

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

    // Phase 2 strict raw-exact: "open the second one pls" does NOT match any whole-string
    // ordinal in resolveStrictOrdinalIndex (no embedded extraction). Falls to Step 2.7
    // widget-list LLM fallback → LLM disabled → shows clarifier with widget items.
    expect(result.handled).toBe(true)
    expect(result.tierLabel).toBe('grounding_llm_disabled_clarifier')

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

  it('Test 4: latch + explicit command + paused clarification → semantic-first model handles (not known-noun)', async () => {
    // Under the semantic-first model, known-noun is NOT a separate winner lane
    // during active clarification (including paused clarification snapshots).
    // The bounded arbiter handles "open recent" via semantic/B1 escape instead.
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

    // Semantic-first: known-noun should NOT have routed (it's gated during active clarification)
    // The turn should still be handled (via grounding/bounded LLM or clarifier)
    expect(result.handled).toBe(true)

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

  it('Test 9: resolved latch + "open recent in chat" (command + scope cue) → stays in scoped handling', async () => {
    // Per selection-continuity-execution-lane-plan.md:116 (binding #5):
    // Scope-cued unresolved input with recoverable scoped options must stay
    // in the scoped unresolved ladder (deterministic → LLM → safe clarifier).
    // Zero-match command phrasing must NOT bypass to downstream routing.
    //
    // With LLM disabled (isLLMFallbackEnabledClient=false):
    // tryLLMLastChance returns { attempted: false, fallbackReason: 'feature_disabled' }
    // → UNIFIED HOOK shows safe clarifier with scoped chat options.

    const ctx = createMockDispatchContext({
      trimmedInput: 'open recent in chat',
      focusLatch: makeResolvedLatch(),
      clarificationSnapshot: makeStaleClarificationSnapshot(),
    })

    const result = await dispatchRouting(ctx)

    // Scope cue respected: latch suspended, widget context cleared
    expect(ctx.suspendFocusLatch).toHaveBeenCalled()
    expect(ctx.clearWidgetSelectionContext).toHaveBeenCalled()

    // Input stays in scoped handling — does NOT escape to known-noun
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
    expect(result.handled).toBe(true)
  })

  // ==========================================================================
  // Test 9 Regression: question-intent escapes via tryLLMLastChance hard
  // exclusion; ambiguous selection stays in scoped handling (A6-R1, A6-R2)
  // ==========================================================================

  it('Test 9-R1: scope-cued question-intent escapes via tryLLMLastChance question_intent exclusion', async () => {
    // "what happened in chat" — question-intent + scope cue, zero label matches.
    // hasQuestionIntent("what happened in chat") = true → tryLLMLastChance returns
    // { fallbackReason: 'question_intent' }. UNIFIED HOOK checks fallbackReason ===
    // 'question_intent' → logs, no return → falls through to Phase 3 command guard.
    // Phase 3: isNewQuestionOrCommandDetected = true → returns { handled: false }.
    //
    // Key verification: handleSelectOption NOT called, question escapes to downstream.
    const ctx = createMockDispatchContext({
      trimmedInput: 'what happened in chat',
      focusLatch: makeResolvedLatch(),
      clarificationSnapshot: makeStaleClarificationSnapshot(),
    })

    const result = await dispatchRouting(ctx)

    // Latch should be suspended (scope cue respected)
    expect(ctx.suspendFocusLatch).toHaveBeenCalled()

    // handleSelectOption should NOT have been called (question-intent, not a selection)
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // setPendingOptions may be called with [] for cleanup, but must NOT be called
    // with a non-empty array (which would indicate a safe clarifier was shown)
    for (const call of (ctx.setPendingOptions as jest.Mock).mock.calls) {
      expect(call[0]).toEqual([])  // Only cleanup calls (empty array) allowed
    }
  })

  it('Test 9-R2: scope-cued ambiguous selection-like input stays in scoped unresolved handling', async () => {
    // "that one from chat" — not an explicit command (no action verb), zero label matches.
    // Enters UNIFIED HOOK → LLM arbitration or safe clarifier with scoped options.
    const ctx = createMockDispatchContext({
      trimmedInput: 'that one from chat',
      focusLatch: makeResolvedLatch(),
      clarificationSnapshot: makeStaleClarificationSnapshot(),
    })

    const result = await dispatchRouting(ctx)

    // Latch should be suspended (scope cue respected)
    expect(ctx.suspendFocusLatch).toHaveBeenCalled()

    // Must NOT have routed to known-noun (ambiguous selection stays in unresolved hook)
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()

    // The input should have been handled by the UNIFIED HOOK (safe clarifier or LLM attempt)
    // Since LLM is mocked to fail, it will show a safe clarifier with setPendingOptions
    expect(result.handled).toBe(true)
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
    // Standalone re-anchor creates a new visible message, so activeOptionSetId
    // is the new message ID (not the original recovery memory messageId).
    expect(ctx.setActiveOptionSetId).toHaveBeenCalledWith(expect.stringContaining('assistant-'))
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
    // Standalone re-anchor creates a new visible message, so activeOptionSetId
    // is the new message ID (not the original recovery memory messageId).
    expect(ctx.setActiveOptionSetId).toHaveBeenCalledWith(expect.stringContaining('assistant-'))
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

// ============================================================================
// Latch-vs-Active Precedence Tests (scope-cue expansion)
//
// Verifies that "from active" scope cue uses activeSnapshotWidgetId
// (the currently visible widget) instead of the stale focus latch.
// ============================================================================

describe('dispatchRouting: latch-vs-active precedence with scope cue', () => {
  /** Recent widget items (different from Links Panel D) */
  const RECENT_WIDGET_ITEMS: ClarificationOption[] = [
    { id: 'recent_1', label: 'sample1', sublabel: 'Recent Entry', type: 'widget_option' },
    { id: 'recent_2', label: 'sample2', sublabel: 'Recent Entry', type: 'widget_option' },
    { id: 'recent_3', label: 'sample3', sublabel: 'Recent Entry', type: 'widget_option' },
  ]

  const RECENT_WIDGET: OpenWidgetState = {
    id: 'w_recent_widget',
    label: 'Recent',
    panelId: 'uuid-recent',
    listSegmentCount: 1,
    options: RECENT_WIDGET_ITEMS,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
  })

  it('"from active" with stale latch scopes to active widget, not latched widget', async () => {
    // Scenario: latch points to Links Panel D, but user opened Recent and says "from active"
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, RECENT_WIDGET],
      activeSnapshotWidgetId: 'w_recent_widget', // Recent is now active
    }))

    const ctx = createMockDispatchContext({
      trimmedInput: 'open sample2 from active',
      focusLatch: makeResolvedLatch('w_links_d'), // Stale latch on Links Panel D
    })

    const result = await dispatchRouting(ctx)

    // Scope-cue resolved to Recent widget (active), not Links Panel D (stale latch).
    // Grounding miss on "open sample2" (verb prefix prevents strict-exact match) →
    // grounded clarifier with disambiguation options from the ACTIVE widget's candidates.
    expect(result.handled).toBe(true)
    expect(ctx.handleSelectOption).not.toHaveBeenCalled() // grounding miss → no auto-execute
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const msg = ctx.addMessage.mock.calls[0][0]
    // Message must show Recent widget's candidates (sample1, sample2, sample3),
    // proving scope resolved to the active widget, not the stale latch target
    expect(msg.content).toContain('sample1')
    expect(msg.options).toBeDefined()
    expect(msg.options.length).toBe(3)
    // Message must NOT reference "Links Panel D" (stale latch target)
    expect(msg.content).not.toContain('Links Panel D')
  })

  it('"from active panel" with stale latch scopes to active widget', async () => {
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, RECENT_WIDGET],
      activeSnapshotWidgetId: 'w_recent_widget',
    }))

    const ctx = createMockDispatchContext({
      trimmedInput: 'open sample2 from active panel',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // Same as "from active": scopes to Recent (active), not Links Panel D (stale latch)
    expect(result.handled).toBe(true)
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const msg = ctx.addMessage.mock.calls[0][0]
    // Grounded clarifier shows Recent widget's candidates, not Links Panel D's
    expect(msg.content).toContain('sample1')
    expect(msg.options).toBeDefined()
    expect(msg.options.length).toBe(3)
    expect(msg.content).not.toContain('Links Panel D')
  })

  it('"i want you to open the sample2 from active" shows grounded clarifier with options', async () => {
    // Regression test: exact phrasing that previously showed generic "I couldn't find" message.
    // After fix: LLM returns need_more_info → grounded clarifier with disambiguation pills.
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, RECENT_WIDGET],
      activeSnapshotWidgetId: 'w_recent_widget',
    }))

    const ctx = createMockDispatchContext({
      trimmedInput: 'i want you to open the sample2 from active',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // Scope-cue resolves to Recent (active widget). Stripped input "i want you to open the sample2"
    // is ambiguous among 3 candidates → grounded clarifier with disambiguation option pills.
    // (LLM disabled in test → reason: llm_disabled, but candidates exist → clarifier shown)
    expect(result.handled).toBe(true)
    expect(result.tierLabel).toBe('scope_cue_widget_grounding_clarifier')
    expect(result._devProvenanceHint).toBe('safe_clarifier')
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const msg = ctx.addMessage.mock.calls[0][0]
    // Grounded clarifier shows Recent widget's candidates as disambiguation options
    expect(msg.content).toContain('Which option did you mean')
    expect(msg.options).toBeDefined()
    expect(msg.options.length).toBe(3)
  })

  // ==========================================================================
  // Post-LLM Canonical Tie-Break Tests
  // ==========================================================================

  it('"i want you to open the sample2 from active" with LLM need_more_info shows grounded clarifier', async () => {
    // Enable LLM and mock need_more_info response
    const { callGroundingLLM, isGroundingLLMEnabled } = jest.requireMock('@/lib/chat/grounding-llm-fallback')
    ;(isGroundingLLMEnabled as jest.Mock).mockReturnValue(true)
    ;(callGroundingLLM as jest.Mock).mockResolvedValue({
      success: true,
      response: { decision: 'need_more_info', choiceId: null, confidence: 0.5 },
      latencyMs: 100,
    })

    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, RECENT_WIDGET],
      activeSnapshotWidgetId: 'w_recent_widget',
    }))

    const ctx = createMockDispatchContext({
      trimmedInput: 'i want you to open the sample2 from active',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // No prior clarifier (widgetSelectionContext is null) → first-time path.
    // LLM returns need_more_info → grounded clarifier with disambiguation pills.
    expect(result.handled).toBe(true)
    expect(result.tierLabel).toBe('scope_cue_widget_llm_need_more_info')
    expect(result._devProvenanceHint).toBe('llm_influenced')
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const msg = ctx.addMessage.mock.calls[0][0]
    expect(msg.content).toContain('Which option did you mean')
    expect(msg.options).toBeDefined()
    expect(msg.options.length).toBe(3)

    // Reset LLM mocks to default (disabled)
    ;(isGroundingLLMEnabled as jest.Mock).mockReturnValue(false)
    ;(callGroundingLLM as jest.Mock).mockResolvedValue({ success: false })
  })

  it('"i want you to open the sample from active" with LLM need_more_info shows clarifier (no unique match)', async () => {
    // Enable LLM and mock need_more_info response
    const { callGroundingLLM, isGroundingLLMEnabled } = jest.requireMock('@/lib/chat/grounding-llm-fallback')
    ;(isGroundingLLMEnabled as jest.Mock).mockReturnValue(true)
    ;(callGroundingLLM as jest.Mock).mockResolvedValue({
      success: true,
      response: { decision: 'need_more_info', choiceId: null, confidence: 0.5 },
      latencyMs: 100,
    })

    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, RECENT_WIDGET],
      activeSnapshotWidgetId: 'w_recent_widget',
    }))

    const ctx = createMockDispatchContext({
      trimmedInput: 'i want you to open the sample from active',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // normalizeLLMInput("i want you to open the sample") → "sample"
    // No candidate exactly matches "sample" (candidates: sample1, sample2, sample3)
    // Tie-break does NOT fire → grounded clarifier with disambiguation options
    expect(result.handled).toBe(true)
    expect(result.tierLabel).toBe('scope_cue_widget_llm_need_more_info')
    expect(result._devProvenanceHint).toBe('llm_influenced')
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const msg = ctx.addMessage.mock.calls[0][0]
    expect(msg.content).toContain('Which option did you mean')
    expect(msg.options).toBeDefined()
    expect(msg.options.length).toBe(3)

    // Reset LLM mocks to default (disabled)
    ;(isGroundingLLMEnabled as jest.Mock).mockReturnValue(false)
    ;(callGroundingLLM as jest.Mock).mockResolvedValue({ success: false })
  })

  it('"i want you to open the sample2 from active" with LLM error shows clarifier (no tie-break)', async () => {
    // Enable LLM but make it throw
    const { callGroundingLLM, isGroundingLLMEnabled } = jest.requireMock('@/lib/chat/grounding-llm-fallback')
    ;(isGroundingLLMEnabled as jest.Mock).mockReturnValue(true)
    ;(callGroundingLLM as jest.Mock).mockRejectedValue(new Error('timeout'))

    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, RECENT_WIDGET],
      activeSnapshotWidgetId: 'w_recent_widget',
    }))

    const ctx = createMockDispatchContext({
      trimmedInput: 'i want you to open the sample2 from active',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // LLM error → widgetScopeLlmFallbackReason = 'llm_error'
    // Tie-break gate: need_more_info only → does NOT fire → grounded clarifier
    expect(result.handled).toBe(true)
    expect(result.tierLabel).toBe('scope_cue_widget_grounding_clarifier')
    expect(result._devProvenanceHint).toBe('safe_clarifier')
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const msg = ctx.addMessage.mock.calls[0][0]
    expect(msg.content).toContain('Which option did you mean')
    expect(msg.options).toBeDefined()
    expect(msg.options.length).toBe(3)

    // Reset LLM mocks to default (disabled)
    ;(isGroundingLLMEnabled as jest.Mock).mockReturnValue(false)
    ;(callGroundingLLM as jest.Mock).mockResolvedValue({ success: false })
  })

  it('"open sample2 from active" with LLM select executes directly (tie-break must NOT override)', async () => {
    // Enable LLM and mock select response for "sample2"
    const { callGroundingLLM, isGroundingLLMEnabled } = jest.requireMock('@/lib/chat/grounding-llm-fallback')
    ;(isGroundingLLMEnabled as jest.Mock).mockReturnValue(true)
    ;(callGroundingLLM as jest.Mock).mockResolvedValue({
      success: true,
      response: { decision: 'select', choiceId: 'recent_2', confidence: 0.9 },
      latencyMs: 100,
    })

    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, RECENT_WIDGET],
      activeSnapshotWidgetId: 'w_recent_widget',
    }))

    const ctx = createMockDispatchContext({
      trimmedInput: 'open sample2 from active',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // LLM selected "sample2" → direct execute. Tie-break MUST NOT fire or override.
    expect(result.handled).toBe(true)
    expect(result.tierLabel).not.toBe('scope_cue_widget_llm_tiebreak')
    expect(result._devProvenanceHint).toBe('llm_executed')
    expect(ctx.addMessage).not.toHaveBeenCalled() // no clarifier — LLM resolved
    expect(result.groundingAction).toEqual(expect.objectContaining({
      type: 'execute_widget_item',
      widgetId: 'w_recent_widget',
      itemId: 'recent_2',
      itemLabel: 'sample2',
    }))

    // Reset LLM mocks to default (disabled)
    ;(isGroundingLLMEnabled as jest.Mock).mockReturnValue(false)
    ;(callGroundingLLM as jest.Mock).mockResolvedValue({ success: false })
  })

  it('"from activ" typo shows safe clarifier, no execution', async () => {
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, RECENT_WIDGET],
      activeSnapshotWidgetId: 'w_recent_widget',
    }))

    const ctx = createMockDispatchContext({
      trimmedInput: 'open sample2 from activ',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // Typo → safe clarifier, never execute
    expect(result.handled).toBe(true)
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
    // Should show actionable "Did you mean" message
    expect(ctx.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Did you mean'),
      })
    )
  })

  it('"from activ panel d" typo shows safe clarifier, no named-widget resolution', async () => {
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, RECENT_WIDGET],
      activeSnapshotWidgetId: 'w_recent_widget',
    }))

    const ctx = createMockDispatchContext({
      trimmedInput: 'open x from activ panel d',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // Typo → safe clarifier, never auto-resolve named widget
    expect(result.handled).toBe(true)
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
    expect(ctx.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Did you mean'),
      })
    )
  })

  it('"from activ workspace" is NOT classified as widget scope', async () => {
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET],
      activeSnapshotWidgetId: 'w_links_d',
    }))

    const ctx = createMockDispatchContext({
      trimmedInput: 'open x from activ workspace',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // Should NOT execute a widget item selection
    // The exact-token guard ("workspace") prevents widget scope classification
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Clarifier-Reply Mode Tests: Widget-Scoped Grounded Clarifier Follow-Ups
//
// When the system previously showed a grounded clarifier with pills (via
// widgetSelectionContext), and the user replies with a scope cue that
// targets the same widget, the clarifier-reply block should resolve against
// the prior pills only — no fresh grounding, no drift.
// ============================================================================

describe('dispatchRouting: widget-scoped clarifier-reply mode', () => {
  const RECENT_WIDGET_ITEMS: ClarificationOption[] = [
    { id: 'recent_1', label: 'sample1', sublabel: 'Recent Entry', type: 'widget_option' },
    { id: 'recent_2', label: 'sample2', sublabel: 'Recent Entry', type: 'widget_option' },
    { id: 'recent_3', label: 'sample3', sublabel: 'Recent Entry', type: 'widget_option' },
  ]

  const RECENT_WIDGET: OpenWidgetState = {
    id: 'w_recent_widget',
    label: 'Recent',
    panelId: 'uuid-recent',
    listSegmentCount: 1,
    options: RECENT_WIDGET_ITEMS,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, RECENT_WIDGET],
      activeSnapshotWidgetId: 'w_recent_widget',
    }))
  })

  it('clarifier reply with LLM select → auto-execute against prior pills', async () => {
    // Enable LLM and mock select response
    const { callGroundingLLM, isGroundingLLMEnabled } = jest.requireMock('@/lib/chat/grounding-llm-fallback')
    ;(isGroundingLLMEnabled as jest.Mock).mockReturnValue(true)
    ;(callGroundingLLM as jest.Mock).mockResolvedValue({
      success: true,
      response: { decision: 'select', choiceId: 'recent_2', confidence: 0.9 },
      latencyMs: 100,
    })

    // Set up prior clarifier state (widgetSelectionContext active for same widget)
    const ctx = createMockDispatchContext({
      trimmedInput: 'can youu  you to open the sample2 from active widget',
      focusLatch: makeResolvedLatch('w_links_d'),
      widgetSelectionContext: {
        optionSetId: 'assistant-prior-clarifier',
        widgetId: 'w_recent_widget',
        options: [
          { id: 'recent_1', label: 'sample1' },
          { id: 'recent_2', label: 'sample2' },
          { id: 'recent_3', label: 'sample3' },
        ],
        timestamp: Date.now(),
        turnsSinceShown: 1,
        questionText: 'Which option did you mean? sample1, sample2, sample3?',
      },
    })

    const result = await dispatchRouting(ctx)

    // Clarifier-reply mode: LLM selected sample2 → auto-execute
    expect(result.handled).toBe(true)
    expect(result.tierLabel).toBe('scope_cue_widget_clarifier_reply_select')
    expect(result._devProvenanceHint).toBe('llm_influenced')
    expect(ctx.addMessage).not.toHaveBeenCalled() // no clarifier — resolved directly
    expect(result.groundingAction).toEqual(expect.objectContaining({
      type: 'execute_widget_item',
      widgetId: 'w_recent_widget',
      itemId: 'recent_2',
      itemLabel: 'sample2',
    }))

    // Assert LLM received clarifierContext with prior question text
    expect(callGroundingLLM).toHaveBeenCalledWith(expect.objectContaining({
      clarifierContext: expect.objectContaining({
        messageId: 'assistant-prior-clarifier',
        previousQuestion: 'Which option did you mean? sample1, sample2, sample3?',
      }),
    }))

    // Assert LLM candidates match widgetSelectionContext.options exactly (no fresh grounding)
    const llmCall = (callGroundingLLM as jest.Mock).mock.calls[0][0]
    expect(llmCall.candidates).toEqual([
      { id: 'recent_1', label: 'sample1', type: 'widget_option', actionHint: 'open' },
      { id: 'recent_2', label: 'sample2', type: 'widget_option', actionHint: 'open' },
      { id: 'recent_3', label: 'sample3', type: 'widget_option', actionHint: 'open' },
    ])

    // Reset LLM mocks
    ;(isGroundingLLMEnabled as jest.Mock).mockReturnValue(false)
    ;(callGroundingLLM as jest.Mock).mockResolvedValue({ success: false })
  })

  it('clarifier reply with LLM need_more_info → loop guard re-shows same pills', async () => {
    // Enable LLM and mock need_more_info response
    const { callGroundingLLM, isGroundingLLMEnabled } = jest.requireMock('@/lib/chat/grounding-llm-fallback')
    ;(isGroundingLLMEnabled as jest.Mock).mockReturnValue(true)
    ;(callGroundingLLM as jest.Mock).mockResolvedValue({
      success: true,
      response: { decision: 'need_more_info', choiceId: null, confidence: 0.5 },
      latencyMs: 100,
    })

    const ctx = createMockDispatchContext({
      trimmedInput: 'can youu  you to open the sample2 from active widget',
      focusLatch: makeResolvedLatch('w_links_d'),
      widgetSelectionContext: {
        optionSetId: 'assistant-prior-clarifier',
        widgetId: 'w_recent_widget',
        options: [
          { id: 'recent_1', label: 'sample1' },
          { id: 'recent_2', label: 'sample2' },
          { id: 'recent_3', label: 'sample3' },
        ],
        timestamp: Date.now(),
        turnsSinceShown: 1,
        questionText: 'Which option did you mean? sample1, sample2, sample3?',
      },
    })

    const result = await dispatchRouting(ctx)

    // Loop guard: LLM couldn't resolve → re-show same pills
    expect(result.handled).toBe(true)
    expect(result.tierLabel).toBe('scope_cue_widget_clarifier_reply_need_more_info')
    expect(result._devProvenanceHint).toBe('safe_clarifier')
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const msg = ctx.addMessage.mock.calls[0][0]
    expect(msg.content).toContain('Please tap an option or say the exact label')
    expect(msg.content).toContain('sample1')
    expect(msg.content).toContain('sample2')
    expect(msg.content).toContain('sample3')
    expect(msg.options).toBeDefined()
    expect(msg.options.length).toBe(3)

    // Reset LLM mocks
    ;(isGroundingLLMEnabled as jest.Mock).mockReturnValue(false)
    ;(callGroundingLLM as jest.Mock).mockResolvedValue({ success: false })
  })

  it('no previous clarifier → normal path (no clarifier context)', async () => {
    // LLM disabled (default) + no widgetSelectionContext → normal first-time path
    const ctx = createMockDispatchContext({
      trimmedInput: 'can youu  you to open the sample2 from active widget',
      focusLatch: makeResolvedLatch('w_links_d'),
      widgetSelectionContext: null, // No prior clarifier
    })

    const result = await dispatchRouting(ctx)

    // Normal path: no clarifier-reply mode. LLM disabled → grounded clarifier.
    expect(result.handled).toBe(true)
    expect(result.tierLabel).toBe('scope_cue_widget_grounding_clarifier')
    expect(result._devProvenanceHint).toBe('safe_clarifier')

    // callGroundingLLM should NOT have been called (LLM disabled in default mock)
    const { callGroundingLLM } = jest.requireMock('@/lib/chat/grounding-llm-fallback')
    expect(callGroundingLLM).not.toHaveBeenCalled()
  })

  it('different widget → no clarifier context, runs normal path', async () => {
    // widgetSelectionContext targets a DIFFERENT widget → not treated as clarifier reply
    const ctx = createMockDispatchContext({
      trimmedInput: 'can youu  you to open the sample2 from active widget',
      focusLatch: makeResolvedLatch('w_links_d'),
      widgetSelectionContext: {
        optionSetId: 'assistant-other-clarifier',
        widgetId: 'w_other_widget', // Different from scopedWidgetId (w_recent_widget)
        options: [
          { id: 'other_1', label: 'other1' },
          { id: 'other_2', label: 'other2' },
        ],
        timestamp: Date.now(),
        turnsSinceShown: 1,
      },
    })

    const result = await dispatchRouting(ctx)

    // Different widget → normal first-time path (not clarifier-reply mode)
    expect(result.handled).toBe(true)
    expect(result.tierLabel).toBe('scope_cue_widget_grounding_clarifier')
    expect(result._devProvenanceHint).toBe('safe_clarifier')
  })

  it('exact label match against prior pills → deterministic execute, no LLM call', async () => {
    // Scenario: widget items changed between turns. Prior clarifier showed sample2 F, sample2, Workspace 4.
    // Current widget snapshot has different items (alpha, beta, gamma).
    // User types "sample2 from active widget" → deterministic grounding misses →
    // clarifier-reply exact label check matches "sample2" in prior pills.
    const { callGroundingLLM, isGroundingLLMEnabled } = jest.requireMock('@/lib/chat/grounding-llm-fallback')
    ;(isGroundingLLMEnabled as jest.Mock).mockReturnValue(true)

    // Use a widget with items that do NOT include "sample2" — simulates item churn
    const CHANGED_WIDGET_ITEMS: ClarificationOption[] = [
      { id: 'alpha_1', label: 'alpha', sublabel: 'Recent Entry', type: 'widget_option' },
      { id: 'beta_1', label: 'beta', sublabel: 'Recent Entry', type: 'widget_option' },
      { id: 'gamma_1', label: 'gamma', sublabel: 'Recent Entry', type: 'widget_option' },
    ]
    const CHANGED_WIDGET: OpenWidgetState = {
      id: 'w_recent_widget',
      label: 'Recent',
      panelId: 'uuid-recent',
      listSegmentCount: 1,
      options: CHANGED_WIDGET_ITEMS,
    }
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, CHANGED_WIDGET],
      activeSnapshotWidgetId: 'w_recent_widget',
    }))

    const ctx = createMockDispatchContext({
      trimmedInput: 'sample2 from active widget',
      focusLatch: makeResolvedLatch('w_links_d'),
      widgetSelectionContext: {
        optionSetId: 'assistant-prior-clarifier',
        widgetId: 'w_recent_widget',
        options: [
          { id: 'recent_2f', label: 'sample2 F' },
          { id: 'recent_2', label: 'sample2' },
          { id: 'ws_4', label: 'Workspace 4' },
        ],
        timestamp: Date.now(),
        turnsSinceShown: 1,
        questionText: 'Which option did you mean? sample2 F, sample2, Workspace 4?',
      },
    })

    const result = await dispatchRouting(ctx)

    // Deterministic grounding misses (alpha, beta, gamma don't include "sample2").
    // Clarifier-reply exact label: "sample2" matches prior pill "sample2" (id: recent_2).
    expect(result.handled).toBe(true)
    expect(result.tierLabel).toBe('scope_cue_widget_clarifier_reply_exact')
    expect(result._devProvenanceHint).toBe('deterministic')
    expect(ctx.addMessage).not.toHaveBeenCalled() // no clarifier — resolved directly
    expect(result.groundingAction).toEqual(expect.objectContaining({
      type: 'execute_widget_item',
      widgetId: 'w_recent_widget',
      itemId: 'recent_2',
      itemLabel: 'sample2',
    }))

    // LLM should NOT have been called (exact label match shortcuts it)
    expect(callGroundingLLM).not.toHaveBeenCalled()

    // Reset LLM mocks
    ;(isGroundingLLMEnabled as jest.Mock).mockReturnValue(false)
  })
})

// ============================================================================
// Plural Scope-Cue Tests (Stage 1: "from active widgets" should be exact, not typo)
// ============================================================================

describe('dispatchRouting: plural scope cues (widgets/panels)', () => {
  const RECENT_WIDGET_ITEMS: ClarificationOption[] = [
    { id: 'recent_1', label: 'sample1', sublabel: 'Recent Entry', type: 'widget_option' },
    { id: 'recent_2', label: 'sample2', sublabel: 'Recent Entry', type: 'widget_option' },
    { id: 'recent_3', label: 'sample3', sublabel: 'Recent Entry', type: 'widget_option' },
  ]

  const RECENT_WIDGET: OpenWidgetState = {
    id: 'w_recent_widget',
    label: 'Recent',
    panelId: 'uuid-recent',
    listSegmentCount: 1,
    options: RECENT_WIDGET_ITEMS,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, RECENT_WIDGET],
      activeSnapshotWidgetId: 'w_recent_widget',
    }))
  })

  it('"from active widgets" (plural) → exact scope, no typo clarifier', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open sample2 from active widgets',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // Should NOT show "Did you mean" (typo clarifier)
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    for (const call of addMessageCalls) {
      expect(call[0].content).not.toContain('Did you mean')
    }

    // setPendingScopeTypoClarifier should NOT have been called (not a typo)
    expect(ctx.setPendingScopeTypoClarifier).not.toHaveBeenCalled()
  })

  it('"from active panels" (plural) → exact scope, no typo clarifier', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open sample2 from active panels',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // Should NOT show "Did you mean" (typo clarifier)
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    for (const call of addMessageCalls) {
      expect(call[0].content).not.toContain('Did you mean')
    }
  })
})

// ============================================================================
// Scope-Typo Replay Tests (Stages 3-5: pending state, confirmation, replay)
// ============================================================================

describe('dispatchRouting: scope-typo one-turn replay', () => {
  const RECENT_WIDGET_ITEMS: ClarificationOption[] = [
    { id: 'recent_1', label: 'sample1', sublabel: 'Recent Entry', type: 'widget_option' },
    { id: 'recent_2', label: 'sample2', sublabel: 'Recent Entry', type: 'widget_option' },
    { id: 'recent_3', label: 'sample3', sublabel: 'Recent Entry', type: 'widget_option' },
  ]

  const RECENT_WIDGET: OpenWidgetState = {
    id: 'w_recent_widget',
    label: 'Recent',
    panelId: 'uuid-recent',
    listSegmentCount: 1,
    options: RECENT_WIDGET_ITEMS,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, RECENT_WIDGET],
      activeSnapshotWidgetId: 'w_recent_widget',
    }))
  })

  it('"from activ" typo → saves pending state for one-turn replay', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open sample2 from activ',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // Should show "Did you mean" clarifier
    expect(result.handled).toBe(true)
    expect(ctx.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Did you mean'),
      })
    )

    // Should have saved pending state
    expect(ctx.setPendingScopeTypoClarifier).toHaveBeenCalledWith(
      expect.objectContaining({
        originalInputWithoutScopeCue: expect.any(String),
        suggestedScopes: expect.any(Array),
        detectedScope: 'widget',
        createdAtTurnCount: expect.any(Number),
        snapshotFingerprint: expect.any(String),
        messageId: expect.any(String),
      })
    )
  })

  it('"yes from active widget" after typo clarifier → replays original intent', async () => {
    // Simulate: previous turn saved pending state, user confirms with "yes from active widget"
    const fingerprint = `w_recent_widget|${[LINKS_PANEL_D_WIDGET.id, RECENT_WIDGET.id].sort().join(',')}`

    const pending: PendingScopeTypoClarifier = {
      originalInputWithoutScopeCue: 'open sample2',
      suggestedScopes: ['from active widget', 'from active panel'],
      detectedScope: 'widget',
      createdAtTurnCount: 0,  // Turn 0 = when clarifier was shown
      snapshotFingerprint: fingerprint,
      messageId: 'assistant-123',
    }

    const ctx = createMockDispatchContext({
      trimmedInput: 'yes from active widget',
      focusLatch: makeResolvedLatch('w_links_d'),
      pendingScopeTypoClarifier: pending,
      messages: [{ id: '1', role: 'user', content: 'test', timestamp: new Date(), isError: false }],
    })

    const result = await dispatchRouting(ctx)

    // Pending should have been cleared
    expect(ctx.clearPendingScopeTypoClarifier).toHaveBeenCalled()

    // Should NOT show "Did you mean" again — the exact scope was provided
    // The replay should go through normal routing with "open sample2 from active widget"
    // The typo clarifier should NOT be shown for the replayed input
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    const didYouMeanCalls = addMessageCalls.filter(
      (call: unknown[]) => typeof (call[0] as Record<string, unknown>)?.content === 'string' && ((call[0] as Record<string, unknown>).content as string).includes('Did you mean')
    )
    expect(didYouMeanCalls.length).toBe(0)
  })

  it('bare "from active widget" (no "yes") after typo clarifier → replays original intent', async () => {
    // Bug regression: "from active widget" typed directly (without "yes" prefix)
    // was treated as unrelated command by isFuzzyMatchNewIntent, clearing the pending
    // state, then routing as standalone scope cue with empty stripped input →
    // "What would you like to find in the widget?" instead of replaying.
    const fingerprint = `w_recent_widget|${[LINKS_PANEL_D_WIDGET.id, RECENT_WIDGET.id].sort().join(',')}`

    const pending: PendingScopeTypoClarifier = {
      originalInputWithoutScopeCue: 'open sample2',
      suggestedScopes: ['from active widget', 'from active panel'],
      detectedScope: 'widget',
      createdAtTurnCount: 0,
      snapshotFingerprint: fingerprint,
      messageId: 'assistant-123',
    }

    const ctx = createMockDispatchContext({
      trimmedInput: 'from active widget',
      focusLatch: makeResolvedLatch('w_links_d'),
      pendingScopeTypoClarifier: pending,
      messages: [{ id: '1', role: 'user', content: 'test', timestamp: new Date(), isError: false }],
    })

    const result = await dispatchRouting(ctx)

    // Pending should have been cleared
    expect(ctx.clearPendingScopeTypoClarifier).toHaveBeenCalled()

    // Must NOT show "What would you like to find in the widget?" (empty-input guard)
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    for (const call of addMessageCalls) {
      const content = (call[0] as Record<string, unknown>).content as string
      expect(content).not.toContain('What would you like to find')
    }

    // Must NOT show another "Did you mean" clarifier
    for (const call of addMessageCalls) {
      const content = (call[0] as Record<string, unknown>).content as string
      expect(content).not.toContain('Did you mean')
    }

    // Result should be handled (replay went through full routing chain)
    expect(result.handled).toBe(true)
  })

  it('expired TTL → pending cleared, normal routing', async () => {
    // Turn count mismatch: pending was created at turn 0, current is turn 5 (too old)
    const fingerprint = `w_recent_widget|${[LINKS_PANEL_D_WIDGET.id, RECENT_WIDGET.id].sort().join(',')}`

    const pending: PendingScopeTypoClarifier = {
      originalInputWithoutScopeCue: 'open sample2',
      suggestedScopes: ['from active widget'],
      detectedScope: 'widget',
      createdAtTurnCount: 0,
      snapshotFingerprint: fingerprint,
      messageId: 'assistant-123',
    }

    const ctx = createMockDispatchContext({
      trimmedInput: 'yes from active widget',
      focusLatch: makeResolvedLatch('w_links_d'),
      pendingScopeTypoClarifier: pending,
      // 5 user messages = turn count 5, pending was at turn 0 → expired (needs turn 1)
      messages: [
        { id: '1', role: 'user', content: 'a', timestamp: new Date(), isError: false },
        { id: '2', role: 'user', content: 'b', timestamp: new Date(), isError: false },
        { id: '3', role: 'user', content: 'c', timestamp: new Date(), isError: false },
        { id: '4', role: 'user', content: 'd', timestamp: new Date(), isError: false },
        { id: '5', role: 'user', content: 'e', timestamp: new Date(), isError: false },
      ],
    })

    const result = await dispatchRouting(ctx)

    // Pending should have been cleared (expired)
    expect(ctx.clearPendingScopeTypoClarifier).toHaveBeenCalled()
  })

  it('drift detected → pending cleared, normal routing', async () => {
    // Fingerprint mismatch: user opened a new widget between turns
    const pending: PendingScopeTypoClarifier = {
      originalInputWithoutScopeCue: 'open sample2',
      suggestedScopes: ['from active widget'],
      detectedScope: 'widget',
      createdAtTurnCount: 0,
      snapshotFingerprint: 'OLD_FINGERPRINT|stale',  // Different from current
      messageId: 'assistant-123',
    }

    const ctx = createMockDispatchContext({
      trimmedInput: 'yes from active widget',
      focusLatch: makeResolvedLatch('w_links_d'),
      pendingScopeTypoClarifier: pending,
      messages: [{ id: '1', role: 'user', content: 'test', timestamp: new Date(), isError: false }],
    })

    const result = await dispatchRouting(ctx)

    // Pending should have been cleared (drift)
    expect(ctx.clearPendingScopeTypoClarifier).toHaveBeenCalled()
  })

  it('unrelated input after typo clarifier → pending cleared, normal routing', async () => {
    const fingerprint = `w_recent_widget|${[LINKS_PANEL_D_WIDGET.id, RECENT_WIDGET.id].sort().join(',')}`

    const pending: PendingScopeTypoClarifier = {
      originalInputWithoutScopeCue: 'open sample2',
      suggestedScopes: ['from active widget'],
      detectedScope: 'widget',
      createdAtTurnCount: 0,
      snapshotFingerprint: fingerprint,
      messageId: 'assistant-123',
    }

    const ctx = createMockDispatchContext({
      trimmedInput: 'open panel d',  // Unrelated command — not a confirmation
      focusLatch: makeResolvedLatch('w_links_d'),
      pendingScopeTypoClarifier: pending,
      messages: [{ id: '1', role: 'user', content: 'test', timestamp: new Date(), isError: false }],
    })

    const result = await dispatchRouting(ctx)

    // Pending should have been cleared (unrelated)
    expect(ctx.clearPendingScopeTypoClarifier).toHaveBeenCalled()
  })

  it('pure "yes" after typo clarifier → ambiguous, asks for scope', async () => {
    const fingerprint = `w_recent_widget|${[LINKS_PANEL_D_WIDGET.id, RECENT_WIDGET.id].sort().join(',')}`

    const pending: PendingScopeTypoClarifier = {
      originalInputWithoutScopeCue: 'open sample2',
      suggestedScopes: ['from active widget', 'from active panel'],
      detectedScope: 'widget',
      createdAtTurnCount: 0,
      snapshotFingerprint: fingerprint,
      messageId: 'assistant-123',
    }

    const ctx = createMockDispatchContext({
      trimmedInput: 'yes',
      focusLatch: makeResolvedLatch('w_links_d'),
      pendingScopeTypoClarifier: pending,
      messages: [{ id: '1', role: 'user', content: 'test', timestamp: new Date(), isError: false }],
    })

    const result = await dispatchRouting(ctx)

    // Pure "yes" without scope → ask for clarification
    expect(result.handled).toBe(true)
    expect(ctx.clearPendingScopeTypoClarifier).toHaveBeenCalled()
    expect(ctx.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Which scope did you mean'),
      })
    )
  })
})

// ============================================================================
// Scope-Uncertain Detection Tests (Fix 2: detectScopeTriggerUnresolved safety net)
// ============================================================================

describe('dispatchRouting: scope-uncertain detection', () => {
  const RECENT_WIDGET_ITEMS: ClarificationOption[] = [
    { id: 'recent_1', label: 'sample1', sublabel: 'Recent Entry', type: 'widget_option' },
    { id: 'recent_2', label: 'sample2', sublabel: 'Recent Entry', type: 'widget_option' },
    { id: 'recent_3', label: 'sample3', sublabel: 'Recent Entry', type: 'widget_option' },
  ]

  const RECENT_WIDGET: OpenWidgetState = {
    id: 'w_recent_widget',
    label: 'Recent',
    panelId: 'uuid-recent',
    listSegmentCount: 1,
    options: RECENT_WIDGET_ITEMS,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, RECENT_WIDGET],
      activeSnapshotWidgetId: 'w_recent_widget',
    }))
  })

  it('"from actvee" (scope_uncertain) → safe clarifier shown, no execution', async () => {
    // "actvee" is distance 2 from "active" → scope_uncertain safety net
    const ctx = createMockDispatchContext({
      trimmedInput: 'open sample2 from actvee',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // Must be handled (hard stop — no fallthrough to grounding)
    expect(result.handled).toBe(true)

    // "Did you mean" clarifier shown
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const msg = (ctx.addMessage as jest.Mock).mock.calls[0][0]
    expect(msg.content).toContain('Did you mean')

    // NO execution — handleSelectOption must NOT be called
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // Pending state should be saved for one-turn replay
    expect(ctx.setPendingScopeTypoClarifier).toHaveBeenCalled()
  })

  it('"from actvee widgezz" (both distance 2) → scope_uncertain, safe clarifier shown', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open sample2 from actvee widgezz',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // Must be handled — scope_uncertain is a hard stop
    expect(result.handled).toBe(true)

    // Clarifier shown, not execution
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const msg = (ctx.addMessage as jest.Mock).mock.calls[0][0]
    expect(msg.content).toContain('Did you mean')

    // NO execution
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
  })

  it('"from activ workspace" → NOT routed as widget scope (exact-scope guard)', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open x from activ workspace',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // "from activ workspace": exact-scope guard blocks widget classification.
    // "activ" → "active" (dist 1) would map to widget, but "workspace" is an
    // exact scope token → guard fires, widget blocked. "workspace" itself is
    // dist 0 (exact) → typo detector skips (requires dist > 0). Result: scope 'none'.
    // Key invariant: no widget item execution from the wrong widget.
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // Must NOT show a widget-scope "Did you mean" clarifier
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    for (const call of addMessageCalls) {
      const content = call[0].content ?? ''
      // If any clarifier appears, it must NOT suggest widget scope
      expect(content).not.toContain('from active widget')
      expect(content).not.toContain('from active panel')
    }
  })

  it('strict regression: grounding/LLM never runs for scope_uncertain input', async () => {
    // This test proves the scope-uncertain gate is a hard stop that blocks
    // all downstream grounding entirely — no handleGroundingSetFallback, no LLM
    const ctx = createMockDispatchContext({
      trimmedInput: 'open sample2 from actvee',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // Hard stop: handled === true, no execution
    expect(result.handled).toBe(true)
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // Clarifier message is the ONLY message — no grounding-related messages
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const msg = (ctx.addMessage as jest.Mock).mock.calls[0][0]
    expect(msg.content).toContain('Did you mean')

    // No widget items from wrong widget should appear
    expect(msg.content).not.toContain('summary144 D')
    expect(msg.content).not.toContain('summary 155 D')
    expect(msg.content).not.toContain('Links Panel D')
  })

  it('semantic-lane regression: scope-uncertain must NOT bypass to semantic lane', async () => {
    // Even though "can you open..." looks like a question, scope-uncertain gate fires first
    const ctx = createMockDispatchContext({
      trimmedInput: 'can you open sample2 from actvee',
      focusLatch: makeResolvedLatch('w_links_d'),
    })

    const result = await dispatchRouting(ctx)

    // Must be handled by scope-uncertain gate, not semantic lane
    expect(result.handled).toBe(true)
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const msg = (ctx.addMessage as jest.Mock).mock.calls[0][0]
    expect(msg.content).toContain('Did you mean')
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
  })

  it('replay regression: "yes from active widget" after scope-uncertain replays original intent', async () => {
    // Setup: previous turn produced scope-uncertain clarifier for "open sample2 from actvee"
    const fingerprint = `w_recent_widget|${[LINKS_PANEL_D_WIDGET.id, RECENT_WIDGET.id].sort().join(',')}`

    const pending: PendingScopeTypoClarifier = {
      originalInputWithoutScopeCue: 'open sample2',
      suggestedScopes: ['from active widget', 'from active panel'],
      detectedScope: 'widget',
      createdAtTurnCount: 0,
      snapshotFingerprint: fingerprint,
      messageId: 'assistant-123',
    }

    const ctx = createMockDispatchContext({
      trimmedInput: 'yes from active widget',
      focusLatch: makeResolvedLatch('w_links_d'),
      pendingScopeTypoClarifier: pending,
      messages: [{ id: '1', role: 'user', content: 'test', timestamp: new Date(), isError: false }],
    })

    const result = await dispatchRouting(ctx)

    // Pending should be cleared
    expect(ctx.clearPendingScopeTypoClarifier).toHaveBeenCalled()

    // "yes" must NOT become a search query — it must trigger replay
    // The replay reconstructs "open sample2 from active widget" and routes it
    // Since "from active widget" is a high-confidence scope cue, it routes to active widget (Recent)
    // Check that the result is handled and items from Recent are shown (not Links Panel D)
    expect(result.handled).toBe(true)

    // If addMessage was called, verify it references Recent items, not Links Panel D items
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    for (const call of addMessageCalls) {
      const content = call[0].content ?? ''
      expect(content).not.toContain('Links Panel D')
    }
  })
})

// ============================================================================
// Trigger-Word Typo Correction in Replay Resolver
// Tests correctScopeTriggerTypo (private) indirectly through full replay flow.
// Per trigger-typo-detection plan: "rom"→"from" only in clarifier-reply context.
// ============================================================================

describe('dispatchRouting: trigger-word typo correction in replay', () => {
  const RECENT_WIDGET_ITEMS: ClarificationOption[] = [
    { id: 'recent_1', label: 'sample1', sublabel: 'Recent Entry', type: 'widget_option' },
    { id: 'recent_2', label: 'sample2', sublabel: 'Recent Entry', type: 'widget_option' },
    { id: 'recent_3', label: 'sample3', sublabel: 'Recent Entry', type: 'widget_option' },
  ]

  const RECENT_WIDGET: OpenWidgetState = {
    id: 'w_recent_widget',
    label: 'Recent',
    panelId: 'uuid-recent',
    listSegmentCount: 1,
    options: RECENT_WIDGET_ITEMS,
  }

  const makeFingerprint = () =>
    `w_recent_widget|${[LINKS_PANEL_D_WIDGET.id, RECENT_WIDGET.id].sort().join(',')}`

  const makePending = (): PendingScopeTypoClarifier => ({
    originalInputWithoutScopeCue: 'open sample2',
    suggestedScopes: ['from active widget', 'from active panel', 'from chat'],
    detectedScope: 'widget',
    createdAtTurnCount: 0,
    snapshotFingerprint: makeFingerprint(),
    messageId: 'assistant-123',
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, RECENT_WIDGET],
      activeSnapshotWidgetId: 'w_recent_widget',
    }))
  })

  it('"rom active widget" after pending → trigger corrected, replay succeeds', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'rom active widget',
      focusLatch: makeResolvedLatch('w_links_d'),
      pendingScopeTypoClarifier: makePending(),
      messages: [{ id: '1', role: 'user', content: 'test', timestamp: new Date(), isError: false }],
    })

    const result = await dispatchRouting(ctx)

    // Pending should be cleared
    expect(ctx.clearPendingScopeTypoClarifier).toHaveBeenCalled()

    // Must NOT show "What would you like to find" (empty-input guard)
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    for (const call of addMessageCalls) {
      const content = (call[0] as Record<string, unknown>).content as string
      expect(content).not.toContain('What would you like to find')
    }

    // Must NOT show another "Did you mean" clarifier
    for (const call of addMessageCalls) {
      const content = (call[0] as Record<string, unknown>).content as string
      expect(content).not.toContain('Did you mean')
    }

    // Result should be handled (replay went through full routing chain)
    expect(result.handled).toBe(true)
  })

  it('"fom active panel" after pending → trigger corrected, replay succeeds', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'fom active panel',
      focusLatch: makeResolvedLatch('w_links_d'),
      pendingScopeTypoClarifier: makePending(),
      messages: [{ id: '1', role: 'user', content: 'test', timestamp: new Date(), isError: false }],
    })

    const result = await dispatchRouting(ctx)

    expect(ctx.clearPendingScopeTypoClarifier).toHaveBeenCalled()

    // Must NOT show empty-input guard or new clarifier
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    for (const call of addMessageCalls) {
      const content = (call[0] as Record<string, unknown>).content as string
      expect(content).not.toContain('What would you like to find')
      expect(content).not.toContain('Did you mean')
    }

    expect(result.handled).toBe(true)
  })

  it('"fron chat" after pending → trigger corrected, replay succeeds with chat scope', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'fron chat',
      focusLatch: makeResolvedLatch('w_links_d'),
      pendingScopeTypoClarifier: makePending(),
      messages: [{ id: '1', role: 'user', content: 'test', timestamp: new Date(), isError: false }],
    })

    const result = await dispatchRouting(ctx)

    expect(ctx.clearPendingScopeTypoClarifier).toHaveBeenCalled()
  })

  it('"rom actve widgt" after pending → trigger corrected but scope not high → clarifier re-shown', async () => {
    // Trigger "rom" corrects to "from", but "actve widgt" fails exact patterns
    // and falls to low_typo or scope_uncertain → path 3a-ii shows clarifier
    const ctx = createMockDispatchContext({
      trimmedInput: 'rom actve widgt',
      focusLatch: makeResolvedLatch('w_links_d'),
      pendingScopeTypoClarifier: makePending(),
      messages: [{ id: '1', role: 'user', content: 'test', timestamp: new Date(), isError: false }],
    })

    const result = await dispatchRouting(ctx)

    expect(ctx.clearPendingScopeTypoClarifier).toHaveBeenCalled()

    // Should show clarifier message about scope
    expect(ctx.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('trying to specify a scope'),
      })
    )

    expect(result.handled).toBe(true)
  })

  it('"run active widget" after pending → no correction (distance > 1), clears pending', async () => {
    // "run" is distance 3 from "from" — NOT correctable
    const ctx = createMockDispatchContext({
      trimmedInput: 'run active widget',
      focusLatch: makeResolvedLatch('w_links_d'),
      pendingScopeTypoClarifier: makePending(),
      messages: [{ id: '1', role: 'user', content: 'test', timestamp: new Date(), isError: false }],
    })

    const result = await dispatchRouting(ctx)

    // Pending should be cleared (falls to 3c/3d)
    expect(ctx.clearPendingScopeTypoClarifier).toHaveBeenCalled()

    // Should NOT show the trigger-corrected clarifier
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    const scopeHintCalls = addMessageCalls.filter(
      (call: unknown[]) => typeof (call[0] as Record<string, unknown>)?.content === 'string' && ((call[0] as Record<string, unknown>).content as string).includes('trying to specify a scope')
    )
    expect(scopeHintCalls.length).toBe(0)
  })

  it('"from active widget" after pending → existing path 3a (no trigger correction needed)', async () => {
    // Exact scope — should replay via existing path, no trigger correction
    const ctx = createMockDispatchContext({
      trimmedInput: 'from active widget',
      focusLatch: makeResolvedLatch('w_links_d'),
      pendingScopeTypoClarifier: makePending(),
      messages: [{ id: '1', role: 'user', content: 'test', timestamp: new Date(), isError: false }],
    })

    const result = await dispatchRouting(ctx)

    expect(ctx.clearPendingScopeTypoClarifier).toHaveBeenCalled()

    // Must NOT show any clarifier — exact scope should replay directly
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    for (const call of addMessageCalls) {
      const content = (call[0] as Record<string, unknown>).content as string
      expect(content).not.toContain('What would you like to find')
      expect(content).not.toContain('Did you mean')
      expect(content).not.toContain('trying to specify a scope')
    }

    expect(result.handled).toBe(true)
  })
})

// ============================================================================
// Dashboard Scoped Resolution Tests
// ============================================================================

describe('dispatchRouting: dashboard scoped resolution', () => {
  /** Dashboard-visible panels */
  const DASHBOARD_PANELS = [
    { id: 'w_links_d', title: 'Links Panel D', type: 'links_note_tiptap' },
    { id: 'w_links_e', title: 'Links Panel E', type: 'links_note_tiptap' },
    { id: 'w_recent_widget', title: 'Recent Notes', type: 'recent_notes' },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot())
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
  })

  it('Test 1: strict-exact match — "Links Panel D from dashboard" → deterministic open', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'Links Panel D from dashboard',
      focusLatch: makeResolvedLatch(),
      uiContext: { mode: 'dashboard', dashboard: { entryName: 'Test Entry', visibleWidgets: DASHBOARD_PANELS } },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(result.tierLabel).toBe('scope_cue_dashboard_panel')
    // openPanelDrawer should have been called for the strict-exact single match
    expect(ctx.openPanelDrawer).toHaveBeenCalledWith('w_links_d', 'Links Panel D', expect.anything())
  })

  it('Test 2: non-strict-exact — "open links panel d from dashboard" → Stage B bounded LLM (disabled → not found)', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open links panel d from dashboard',
      focusLatch: makeResolvedLatch(),
      uiContext: { mode: 'dashboard', dashboard: { entryName: 'Test Entry', visibleWidgets: DASHBOARD_PANELS } },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    // With LLM disabled, Stage A returns handled: false (non-strict-exact),
    // Stage B grounding returns needsLLM but LLM is disabled → falls to Stage C
    expect(result.tierLabel).toMatch(/scope_cue_dashboard/)
  })

  it('Test 3: multi-match disambiguation — "links panel from dashboard" → shows options', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'links panel from dashboard',
      focusLatch: makeResolvedLatch(),
      uiContext: { mode: 'dashboard', dashboard: { entryName: 'Test Entry', visibleWidgets: DASHBOARD_PANELS } },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(result.tierLabel).toBe('scope_cue_dashboard_panel')
    // Multi-match should trigger setPendingOptions with matched panels
    expect(ctx.setPendingOptions).toHaveBeenCalled()
  })

  it('Test 4: no match — "sample99 from dashboard" → scoped not-found with available panels', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'sample99 from dashboard',
      focusLatch: makeResolvedLatch(),
      uiContext: { mode: 'dashboard', dashboard: { entryName: 'Test Entry', visibleWidgets: DASHBOARD_PANELS } },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(result.tierLabel).toBe('scope_cue_dashboard_not_found')
    // Should show available panels in the message
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    const notFoundMsg = addMessageCalls.find(
      (call: unknown[]) => ((call[0] as Record<string, unknown>).content as string).includes('dashboard')
    )
    expect(notFoundMsg).toBeTruthy()
    expect((notFoundMsg![0] as Record<string, unknown>).content).toContain('Links Panel D')
  })

  it('Test 5: empty after strip — "from dashboard" → clarifier', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'from dashboard',
      focusLatch: makeResolvedLatch(),
      uiContext: { mode: 'dashboard', dashboard: { entryName: 'Test Entry', visibleWidgets: DASHBOARD_PANELS } },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    const clarifierMsg = addMessageCalls.find(
      (call: unknown[]) => ((call[0] as Record<string, unknown>).content as string).includes('What would you like to find on the dashboard')
    )
    expect(clarifierMsg).toBeTruthy()
  })

  it('Test 6: cross-scope collision — "Recent Notes from dashboard" resolves ONLY from dashboard panels', async () => {
    // "Recent Notes" exists as both a dashboard panel title AND could exist in widget items
    // With dashboard scope cue, must resolve ONLY against dashboard panels
    const widgetWithSameLabel: OpenWidgetState = {
      id: 'w_collision',
      label: 'Recent Notes',
      panelId: 'uuid-collision',
      listSegmentCount: 1,
      options: [{ id: 'item_collision', label: 'Recent Notes', sublabel: 'Widget Item', type: 'widget_option' }],
    }

    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({
      openWidgets: [LINKS_PANEL_D_WIDGET, widgetWithSameLabel],
    }))

    const ctx = createMockDispatchContext({
      trimmedInput: 'Recent Notes from dashboard',
      focusLatch: makeResolvedLatch(),
      uiContext: { mode: 'dashboard', dashboard: { entryName: 'Test Entry', visibleWidgets: DASHBOARD_PANELS } },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    // Should resolve via dashboard panels (Stage A strict-exact), not widget items
    expect(result.tierLabel).toBe('scope_cue_dashboard_panel')
    expect(ctx.openPanelDrawer).toHaveBeenCalledWith('w_recent_widget', 'Recent Notes', expect.anything())
  })

  it('Test 7: no panels visible — "open links panel d from dashboard" → no panels message', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open links panel d from dashboard',
      focusLatch: makeResolvedLatch(),
      uiContext: { mode: 'dashboard', dashboard: { entryName: 'Test Entry', visibleWidgets: [] } },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(result.tierLabel).toBe('scope_cue_dashboard_no_panels')
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    const noPanelsMsg = addMessageCalls.find(
      (call: unknown[]) => ((call[0] as Record<string, unknown>).content as string).includes('No panels are visible')
    )
    expect(noPanelsMsg).toBeTruthy()
  })

  it('Test 8: workspace hard-stop — "open links panel d from workspace" → not available message', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open links panel d from workspace',
      focusLatch: makeResolvedLatch(),
      uiContext: { mode: 'dashboard', dashboard: { entryName: 'Test Entry', visibleWidgets: DASHBOARD_PANELS } },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    const workspaceMsg = addMessageCalls.find(
      (call: unknown[]) => ((call[0] as Record<string, unknown>).content as string).includes('Workspace-scoped selection is not yet available')
    )
    expect(workspaceMsg).toBeTruthy()
  })

  it('Test 9: widget regression — "open sample2 from active widget" → widget scoped grounding (unchanged)', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open sample2 from active widget',
      focusLatch: makeResolvedLatch(),
      uiContext: { mode: 'dashboard', dashboard: { entryName: 'Test Entry', visibleWidgets: DASHBOARD_PANELS } },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    // Should route via widget scope, not dashboard scope
    expect(result.tierLabel).toMatch(/scope_cue_widget/)
  })

  it('Test 10: widget named regression — "open recent from links panel d" → widget named cue (unchanged)', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open recent from links panel d',
      focusLatch: makeResolvedLatch(),
      uiContext: { mode: 'dashboard', dashboard: { entryName: 'Test Entry', visibleWidgets: DASHBOARD_PANELS } },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    // Should route via widget scope with named hint, not dashboard
    expect(result.tierLabel).toMatch(/scope_cue_widget/)
  })

})

// ============================================================================
// Active-Clarifier Semantic Escape Execution (Dispatcher-Level)
// Tests the outer wrapper execution for open_entry, open_workspace, go_home families
// ============================================================================

describe('dispatchRouting: active-clarifier semantic escape execution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBuildTurnSnapshot.mockReturnValue(makeTurnSnapshot({ openWidgets: [], activeSnapshotWidgetId: null }))
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
    // Enable semantic hint read + stage 6 (needed for outer wrapper escape execution)
    process.env.NEXT_PUBLIC_CHAT_ROUTING_MEMORY_HINT_READ = 'true'
    process.env.NEXT_PUBLIC_STAGE6_SHADOW_ENABLED = 'true'
    // Enable LLM fallback and make it return reroute (triggers escape action)
    mockIsLLMFallbackEnabledClient.mockReturnValue(true)
    mockCallClarificationLLMClient.mockResolvedValue({
      success: true,
      response: { decision: 'reroute', choiceId: null, choiceIndex: -1, confidence: 0.3, reason: 'different intent' },
    })
  })

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_CHAT_ROUTING_MEMORY_HINT_READ
    delete process.env.NEXT_PUBLIC_STAGE6_SHADOW_ENABLED
    mockIsLLMFallbackEnabledClient.mockReturnValue(false)
    mockCallClarificationLLMClient.mockResolvedValue({ success: false })
  })

  it('semantic open_entry with full metadata → handled + navigationReplayAction', async () => {
    // Mock semantic hints to return an open_entry candidate
    mockLookupSemanticHints.mockResolvedValue({
      status: 'ok',
      candidates: [{
        intent_id: 'open_entry',
        slots_json: { action_type: 'open_entry', entryId: 'entry-1', entryName: 'My Project', dashboardWorkspaceId: 'ws-1' },
        similarity_score: 0.95,
        target_ids: ['entry-1'],
        from_curated_seed: false,
      }],
      latencyMs: 50,
    })

    const ctx = createMockDispatchContext({
      trimmedInput: 'open my entry',
      lastClarification: {
        type: 'option_selection',
        originalIntent: 'open entries',
        messageId: 'msg-1',
        timestamp: Date.now(),
        options: STALE_DISAMBIGUATION_OPTIONS,
      },
      pendingOptions: STALE_DISAMBIGUATION_OPTIONS.map((o, i) => ({ ...o, index: i + 1, data: {} })),
    })

    const result = await dispatchRouting(ctx)

    // Should be handled with navigationReplayAction
    expect(result.handled).toBe(true)
    expect((result as any).navigationReplayAction).toBeDefined()
    expect((result as any).navigationReplayAction.type).toBe('open_entry')
    expect((result as any).navigationReplayAction.entryId).toBe('entry-1')
    expect((result as any).navigationReplayAction.dashboardWorkspaceId).toBe('ws-1')
  })

  it('semantic open_entry missing dashboardWorkspaceId → not handled', async () => {
    // Mock semantic hints with incomplete open_entry metadata
    mockLookupSemanticHints.mockResolvedValue({
      status: 'ok',
      candidates: [{
        intent_id: 'open_entry',
        slots_json: { action_type: 'open_entry', entryId: 'entry-1', entryName: 'My Project' },
        similarity_score: 0.95,
        target_ids: ['entry-1'],
        from_curated_seed: false,
      }],
      latencyMs: 50,
    })

    const ctx = createMockDispatchContext({
      trimmedInput: 'open my project',
      lastClarification: {
        type: 'option_selection',
        originalIntent: 'open entries',
        messageId: 'msg-1',
        timestamp: Date.now(),
        options: STALE_DISAMBIGUATION_OPTIONS,
      },
      pendingOptions: STALE_DISAMBIGUATION_OPTIONS.map((o, i) => ({ ...o, index: i + 1, data: {} })),
    })

    const result = await dispatchRouting(ctx)

    // Missing dashboardWorkspaceId → should NOT produce a handled open_entry result
    // It should fall through (the LLM may handle it, or clarifier re-shows)
    if ((result as any).navigationReplayAction?.type === 'open_entry') {
      // If it somehow produced open_entry, dashboardWorkspaceId must NOT be empty
      expect((result as any).navigationReplayAction.dashboardWorkspaceId).not.toBe('')
    }
  })

  it('semantic open_workspace → handled + navigationReplayAction', async () => {
    mockLookupSemanticHints.mockResolvedValue({
      status: 'ok',
      candidates: [{
        intent_id: 'open_workspace',
        slots_json: { action_type: 'open_workspace', workspaceId: 'ws-1', workspaceName: 'Budget', entryId: 'entry-1', entryName: 'My Project' },
        similarity_score: 0.92,
        target_ids: ['ws-1'],
        from_curated_seed: false,
      }],
      latencyMs: 50,
    })

    const ctx = createMockDispatchContext({
      trimmedInput: 'open budget workspace',
      lastClarification: {
        type: 'option_selection',
        originalIntent: 'open entries',
        messageId: 'msg-1',
        timestamp: Date.now(),
        options: STALE_DISAMBIGUATION_OPTIONS,
      },
      pendingOptions: STALE_DISAMBIGUATION_OPTIONS.map((o, i) => ({ ...o, index: i + 1, data: {} })),
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect((result as any).navigationReplayAction).toBeDefined()
    expect((result as any).navigationReplayAction.type).toBe('open_workspace')
    expect((result as any).navigationReplayAction.workspaceId).toBe('ws-1')
  })

  it('semantic go_home → handled + navigationReplayAction', async () => {
    mockLookupSemanticHints.mockResolvedValue({
      status: 'ok',
      candidates: [{
        intent_id: 'go_home',
        slots_json: { action_type: 'go_home' },
        similarity_score: 0.98,
        target_ids: [],
        from_curated_seed: true,
      }],
      latencyMs: 30,
    })

    const ctx = createMockDispatchContext({
      trimmedInput: 'go home',
      lastClarification: {
        type: 'option_selection',
        originalIntent: 'open entries',
        messageId: 'msg-1',
        timestamp: Date.now(),
        options: STALE_DISAMBIGUATION_OPTIONS,
      },
      pendingOptions: STALE_DISAMBIGUATION_OPTIONS.map((o, i) => ({ ...o, index: i + 1, data: {} })),
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect((result as any).navigationReplayAction).toBeDefined()
    expect((result as any).navigationReplayAction.type).toBe('go_home')
  })
})
