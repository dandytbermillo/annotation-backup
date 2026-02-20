/**
 * Dispatch-Level Integration Tests for Semantic Answer Lane Routing Bypass.
 *
 * Verifies that semantic question inputs ("explain what just happened",
 * "why did I do that?") bypass cross-corpus, grounding, and docs tiers
 * and reach the LLM API path with semanticLanePending: true.
 *
 * Tests:
 * 1. Semantic inputs skip cross-corpus (Tier 2b)
 * 2. Semantic inputs skip grounding (Tier 4.5)
 * 3. Semantic inputs skip docs (Tier 5)
 * 4. Non-semantic inputs still route normally (no regression)
 * 5. Flag-off means no bypass
 * 6. Mixed-intent command inputs are NOT treated as semantic
 */

// ============================================================================
// Module Mocks (must be before imports)
// ============================================================================

jest.mock('@/lib/utils/debug-logger', () => ({
  debugLog: jest.fn(),
}))

const mockBuildTurnSnapshot = jest.fn()
jest.mock('@/lib/chat/ui-snapshot-builder', () => ({
  buildTurnSnapshot: (...args: unknown[]) => mockBuildTurnSnapshot(...args),
  DEFAULT_SNAPSHOT_FRESHNESS_MS: 60000,
}))

jest.mock('@/lib/chat/clarification-llm-fallback', () => ({
  callClarificationLLMClient: jest.fn().mockResolvedValue({ success: false }),
  callReturnCueLLM: jest.fn().mockResolvedValue({ isReturn: false }),
  isLLMFallbackEnabledClient: jest.fn().mockReturnValue(false),
  isLLMAutoExecuteEnabledClient: jest.fn().mockReturnValue(false),
  isContextRetryEnabledClient: jest.fn().mockReturnValue(false),
  shouldCallLLMFallback: jest.fn().mockReturnValue(false),
  MIN_CONFIDENCE_SELECT: 0.6,
  AUTO_EXECUTE_CONFIDENCE: 0.85,
  AUTO_EXECUTE_ALLOWED_REASONS: new Set(['no_deterministic_match']),
}))

jest.mock('@/lib/chat/grounding-llm-fallback', () => ({
  callGroundingLLM: jest.fn().mockResolvedValue({ success: false }),
  isGroundingLLMEnabled: jest.fn().mockReturnValue(false),
}))

const mockHandleDocRetrieval = jest.fn().mockResolvedValue({ handled: false })
jest.mock('@/lib/chat/doc-routing', () => ({
  handleDocRetrieval: (...args: unknown[]) => mockHandleDocRetrieval(...args),
}))

const mockHandleCrossCorpusRetrieval = jest.fn().mockResolvedValue({ handled: false })
jest.mock('@/lib/chat/cross-corpus-handler', () => ({
  handleCrossCorpusRetrieval: (...args: unknown[]) => mockHandleCrossCorpusRetrieval(...args),
}))

jest.mock('@/lib/widgets/ui-snapshot-registry', () => ({
  getWidgetSnapshot: jest.fn().mockReturnValue(null),
  getAllVisibleSnapshots: jest.fn().mockReturnValue([]),
}))

jest.mock('@/lib/chat/known-noun-routing', () => ({
  handleKnownNounRouting: jest.fn().mockReturnValue({ handled: false }),
}))

jest.mock('@/lib/chat/chat-routing', () => ({
  handleClarificationIntercept: jest.fn().mockResolvedValue({
    handled: false,
    clarificationCleared: false,
    isNewQuestionOrCommandDetected: false,
  }),
  handlePanelDisambiguation: jest.fn().mockResolvedValue({ handled: false }),
  handleMetaExplain: jest.fn().mockResolvedValue({ handled: false }),
  handleCorrection: jest.fn().mockReturnValue({ handled: false }),
  handleFollowUp: jest.fn().mockReturnValue({ handled: false }),
}))

global.fetch = jest.fn().mockResolvedValue({
  ok: false,
  status: 500,
  json: async () => ({}),
}) as jest.Mock

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { dispatchRouting, type RoutingDispatcherContext } from '@/lib/chat/routing-dispatcher'
import { EMPTY_CONTINUITY_STATE } from '@/lib/chat/chat-navigation-context'

// ============================================================================
// Mock Context Factory
// ============================================================================

function createMockDispatchContext(overrides?: Partial<RoutingDispatcherContext>): RoutingDispatcherContext {
  return {
    trimmedInput: '',
    lastSuggestion: null,
    setLastSuggestion: jest.fn(),
    addRejectedSuggestions: jest.fn(),
    clearRejectedSuggestions: jest.fn(),
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
    repairMemory: null,
    setRepairMemory: jest.fn(),
    incrementRepairMemoryTurn: jest.fn(),
    clearRepairMemory: jest.fn(),
    clarificationSnapshot: null,
    saveClarificationSnapshot: jest.fn(),
    pauseSnapshotWithReason: jest.fn(),
    incrementSnapshotTurn: jest.fn(),
    clearClarificationSnapshot: jest.fn(),
    stopSuppressionCount: 0,
    setStopSuppressionCount: jest.fn(),
    decrementStopSuppression: jest.fn(),
    docRetrievalState: null,
    knownTermsFetchStatus: 'snapshot' as const,
    usedCoreAppTermsFallback: false,
    updateDocRetrievalState: jest.fn(),
    messages: [],
    findLastOptionsMessage: jest.fn().mockReturnValue(null),
    reshowWindowMs: 2000,
    lastPreview: null,
    openPanelDrawer: jest.fn(),
    openPanelWithTracking: jest.fn(),
    sessionState: {
      lastAction: { type: 'open_panel', panelTitle: 'Links Panel D', timestamp: Date.now() - 10000 },
      actionHistory: [
        { type: 'open_panel', targetType: 'panel', targetName: 'Links Panel D', timestamp: Date.now() - 10000 },
      ],
    },
    lastOptionsShown: null,
    saveLastOptionsShown: jest.fn(),
    incrementLastOptionsShownTurn: jest.fn(),
    clearLastOptionsShown: jest.fn(),
    getVisibleSnapshots: jest.fn().mockReturnValue([]),
    getActiveWidgetId: jest.fn().mockReturnValue(null),
    widgetSelectionContext: null,
    setWidgetSelectionContext: jest.fn(),
    incrementWidgetSelectionTurn: jest.fn(),
    clearWidgetSelectionContext: jest.fn(),
    focusLatch: null,
    setFocusLatch: jest.fn(),
    suspendFocusLatch: jest.fn(),
    incrementFocusLatchTurn: jest.fn(),
    clearFocusLatch: jest.fn(),
    scopeCueRecoveryMemory: null,
    clearScopeCueRecoveryMemory: jest.fn(),
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

describe('semantic answer lane routing bypass', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, NEXT_PUBLIC_SEMANTIC_CONTINUITY_ANSWER_LANE_ENABLED: 'true' }
    mockBuildTurnSnapshot.mockReturnValue({
      openWidgets: [],
      activeSnapshotWidgetId: null,
      uiSnapshotId: 'test-snap-1',
      revisionId: 1,
      capturedAtMs: Date.now(),
      hasBadgeLetters: false,
    })
  })

  afterAll(() => {
    process.env = originalEnv
  })

  test('22. "explain what just happened" skips cross-corpus, returns semanticLanePending', async () => {
    const ctx = createMockDispatchContext({ trimmedInput: 'explain what just happened' })
    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(false)
    expect(result.semanticLanePending).toBe(true)
    expect(mockHandleCrossCorpusRetrieval).not.toHaveBeenCalled()
    expect(mockHandleDocRetrieval).not.toHaveBeenCalled()
  })

  test('23. "why did I do that?" skips grounding and docs, returns semanticLanePending', async () => {
    const ctx = createMockDispatchContext({ trimmedInput: 'why did I do that?' })
    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(false)
    expect(result.semanticLanePending).toBe(true)
    expect(mockHandleCrossCorpusRetrieval).not.toHaveBeenCalled()
    expect(mockHandleDocRetrieval).not.toHaveBeenCalled()
  })

  test('24. non-semantic "open recent" still calls cross-corpus (no regression)', async () => {
    const ctx = createMockDispatchContext({ trimmedInput: 'open recent' })
    const result = await dispatchRouting(ctx)

    expect(result.semanticLanePending).toBeFalsy()
    expect(mockHandleCrossCorpusRetrieval).toHaveBeenCalled()
  })

  test('25. flag OFF → "explain what just happened" calls cross-corpus (no bypass)', async () => {
    process.env.NEXT_PUBLIC_SEMANTIC_CONTINUITY_ANSWER_LANE_ENABLED = 'false'
    const ctx = createMockDispatchContext({ trimmedInput: 'explain what just happened' })
    const result = await dispatchRouting(ctx)

    expect(result.semanticLanePending).toBeFalsy()
    expect(mockHandleCrossCorpusRetrieval).toHaveBeenCalled()
  })

  test('26. mixed-intent "open links panel and explain why" does NOT set semantic bypass', async () => {
    const ctx = createMockDispatchContext({ trimmedInput: 'open links panel and explain why' })
    const result = await dispatchRouting(ctx)

    expect(result.semanticLanePending).toBeFalsy()
    // Cross-corpus should be called (command input routes normally)
    expect(mockHandleCrossCorpusRetrieval).toHaveBeenCalled()
  })
})
