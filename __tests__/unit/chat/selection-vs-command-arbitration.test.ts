/**
 * Unit tests for selection-vs-command arbitration pre-gate.
 *
 * Per selection-vs-command-arbitration-rule-plan.md:
 * When command-like input doesn't target any active option, bypass
 * label matching and let it reach Tier 2c/Tier 4 command routing.
 *
 * Tests:
 * 1. Active options + "open links panel" (non-matching) → bypass label matching
 * 2. Active options + "the second one" → ordinal selection still works
 * 3. Active options + "panel d" (label match) → selection allowed
 * 4. Active options + "open recent" (non-matching) → bypass label matching
 * 5. Active options + "open the first one" → selection-like overrides command
 * 6. Candidate-aware: active options [summary144, summary155] + "open summary144" → selection
 * 7. Candidate-aware: active options [summary144, summary155] + "show summary 155 please" → selection
 * 8. Candidate-aware: active options [sample2, Workspace 4] + "open links panel d" → command escape
 */

jest.mock('@/lib/utils/debug-logger', () => ({
  debugLog: jest.fn(),
}))

jest.mock('@/lib/chat/ui-snapshot-builder', () => ({
  buildTurnSnapshot: jest.fn(),
  DEFAULT_SNAPSHOT_FRESHNESS_MS: 60000,
}))

jest.mock('@/lib/chat/clarification-llm-fallback', () => ({
  callClarificationLLMClient: jest.fn().mockResolvedValue({ success: false }),
  callReturnCueLLM: jest.fn().mockResolvedValue({ isReturn: false }),
  isLLMFallbackEnabledClient: jest.fn().mockReturnValue(false),
  shouldCallLLMFallback: jest.fn().mockReturnValue(false),
}))

jest.mock('@/lib/chat/grounding-llm-fallback', () => ({
  callGroundingLLM: jest.fn().mockResolvedValue({ success: false }),
  isGroundingLLMEnabled: jest.fn().mockReturnValue(false),
}))

jest.mock('@/lib/chat/doc-routing', () => ({
  handleDocRetrieval: jest.fn().mockResolvedValue({ handled: false }),
  isBareNounQuery: jest.fn().mockReturnValue(false),
  maybeFormatSnippetWithHs3: jest.fn(),
  dedupeHeaderPath: jest.fn(),
  stripMarkdownHeadersForUI: jest.fn(),
}))

jest.mock('@/lib/chat/cross-corpus-handler', () => ({
  handleCrossCorpusRetrieval: jest.fn().mockResolvedValue({ handled: false }),
}))

jest.mock('@/lib/widgets/ui-snapshot-registry', () => ({
  getWidgetSnapshot: jest.fn().mockReturnValue(null),
  getAllVisibleSnapshots: jest.fn().mockReturnValue([]),
}))

jest.mock('@/lib/chat/known-noun-routing', () => ({
  handleKnownNounRouting: jest.fn().mockReturnValue({ handled: false }),
  matchKnownNoun: jest.fn().mockReturnValue(null),
}))

jest.mock('@/lib/docs/known-terms-client', () => ({
  getKnownTermsSync: jest.fn().mockReturnValue(null),
}))

global.fetch = jest.fn().mockResolvedValue({
  ok: false,
  status: 500,
  json: async () => ({}),
}) as jest.Mock

import { handleClarificationIntercept, type ClarificationInterceptContext, type PendingOptionState } from '@/lib/chat/chat-routing'
import type { ClarificationOption, LastClarificationState } from '@/lib/chat/chat-navigation-context'
import { debugLog } from '@/lib/utils/debug-logger'

// ============================================================================
// Helpers
// ============================================================================

function makeOptions(labels: string[], type = 'panel_drawer'): ClarificationOption[] {
  return labels.map((label, i) => ({
    id: `opt-${i}`,
    label,
    type,
  }))
}

function makePendingOptions(labels: string[], type = 'panel_drawer'): PendingOptionState[] {
  return labels.map((label, i) => ({
    index: i,
    label,
    type,
    id: `opt-${i}`,
    data: { panelId: `opt-${i}`, panelTitle: label, panelType: 'default' },
  }))
}

function makeClarification(labels: string[], type: LastClarificationState['type'] = 'panel_disambiguation'): LastClarificationState {
  return {
    type,
    originalIntent: 'test',
    messageId: 'msg-1',
    timestamp: Date.now(),
    options: makeOptions(labels),
    attemptCount: 0,
  }
}

function createMockInterceptContext(overrides?: Partial<ClarificationInterceptContext>): ClarificationInterceptContext {
  return {
    trimmedInput: '',
    lastClarification: null,
    lastSuggestion: null,
    pendingOptions: [],
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
    saveLastOptionsShown: jest.fn(),
    widgetSelectionContext: null,
    clearWidgetSelectionContext: jest.fn(),
    setActiveOptionSetId: jest.fn(),
    focusLatch: null,
    setFocusLatch: jest.fn(),
    suspendFocusLatch: jest.fn(),
    clearFocusLatch: jest.fn(),
    hasVisibleWidgetItems: false,
    totalListSegmentCount: 0,
    lastOptionsShown: null,
    isLatchEnabled: false,
    activeSnapshotWidgetId: null,
    scopeCueRecoveryMemory: null,
    clearScopeCueRecoveryMemory: jest.fn(),
    ...overrides,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Selection-vs-Command Arbitration Pre-gate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('command bypass (non-matching options)', () => {
    it('bypasses label matching for "open recent" with non-matching active options', async () => {
      const labels = ['Links Panel D', 'Links Panel E', 'Links Panel F']
      const ctx = createMockInterceptContext({
        trimmedInput: 'open recent',
        lastClarification: makeClarification(labels),
        pendingOptions: makePendingOptions(labels),
      })

      const result = await handleClarificationIntercept(ctx)

      // Should NOT be handled by label matching — bypass to command path
      expect(result.handled).toBe(false)

      // Verify bypass log was emitted
      expect(debugLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'clarification_selection_bypassed_command_intent',
          metadata: expect.objectContaining({
            input: 'open recent',
            inputTargetsActiveOption: false,
          }),
        })
      )
    })

    it('"open links panel d" with non-panel options → isSelectionLike due to badge letter, stays in selection flow', async () => {
      // "open links panel d" has a trailing badge letter "d" → isSelectionLike=true
      // Even though no option matches, isSelectionLike blocks the bypass.
      // This is correct: badge-letter inputs should try selection first.
      const labels = ['sample2 F', 'sample2', 'Workspace 4']
      const ctx = createMockInterceptContext({
        trimmedInput: 'open links panel d',
        lastClarification: makeClarification(labels),
        pendingOptions: makePendingOptions(labels),
      })

      const result = await handleClarificationIntercept(ctx)

      // isSelectionLike=true blocks command bypass → enters label matching
      // No label matches → falls through to downstream tiers
      expect(debugLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'clarification_selection_allowed_selection_like',
          metadata: expect.objectContaining({
            isSelectionLike: true,
          }),
        })
      )
    })

    it('bypasses label matching for "open workspace settings" with non-matching active options', async () => {
      // No badge, no ordinal → pure command, not selection-like
      const labels = ['Links Panel D', 'Links Panel E']
      const ctx = createMockInterceptContext({
        trimmedInput: 'open workspace settings',
        lastClarification: makeClarification(labels),
        pendingOptions: makePendingOptions(labels),
      })

      const result = await handleClarificationIntercept(ctx)

      expect(result.handled).toBe(false)

      expect(debugLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'clarification_selection_bypassed_command_intent',
          metadata: expect.objectContaining({
            input: 'open workspace settings',
            inputTargetsActiveOption: false,
          }),
        })
      )
    })
  })

  describe('selection-like stays in label matching', () => {
    it('"the second one" with active options → ordinal selection (not bypassed)', async () => {
      const labels = ['Links Panel D', 'Links Panel E', 'Links Panel F']
      const ctx = createMockInterceptContext({
        trimmedInput: 'the second one',
        lastClarification: makeClarification(labels),
        pendingOptions: makePendingOptions(labels),
      })

      const result = await handleClarificationIntercept(ctx)

      // Should be handled by ordinal selection (Tier 1b.3a)
      expect(result.handled).toBe(true)
      expect(ctx.handleSelectOption).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Links Panel E' })
      )
    })

    it('"open the first one" → selection-like overrides command intent', async () => {
      const labels = ['Links Panel D', 'Links Panel E']
      const ctx = createMockInterceptContext({
        trimmedInput: 'open the first one',
        lastClarification: makeClarification(labels),
        pendingOptions: makePendingOptions(labels),
      })

      const result = await handleClarificationIntercept(ctx)

      // "open the first one" has ordinal → isSelectionLike=true → stays in selection flow
      expect(result.handled).toBe(true)
    })

    it('"panel d" (unique label match) → selection allowed', async () => {
      const labels = ['Links Panel D', 'Links Panel E', 'Links Panel F']
      const ctx = createMockInterceptContext({
        trimmedInput: 'panel d',
        lastClarification: makeClarification(labels),
        pendingOptions: makePendingOptions(labels),
      })

      const result = await handleClarificationIntercept(ctx)

      // "panel d" is not a command (no action verb) → stays in label matching
      // Should match "Links Panel D" via badge-aware selection
      expect(result.handled).toBe(true)
    })
  })

  describe('candidate-aware blocker (command that targets active option)', () => {
    it('"open summary144" with active options [summary144, summary155] → stays in selection', async () => {
      const labels = ['summary144', 'summary155']
      const ctx = createMockInterceptContext({
        trimmedInput: 'open summary144',
        lastClarification: makeClarification(labels, 'doc_disambiguation'),
        pendingOptions: makePendingOptions(labels, 'doc'),
      })

      const result = await handleClarificationIntercept(ctx)

      // "open summary144" is command-like, but canonicalized "summary144" matches an option
      // → inputTargetsActiveOption=true → stays in selection flow
      expect(result.handled).toBe(true)

      // Should NOT have emitted bypass log
      expect(debugLog).not.toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'clarification_selection_bypassed_command_intent',
        })
      )
    })

    it('"show summary155 please" with active options [summary144, summary155] → stays in selection', async () => {
      // "show summary155 please" → canonicalized → "summary155"
      // "summary155" label matches exactly
      const labels = ['summary144', 'summary155']
      const ctx = createMockInterceptContext({
        trimmedInput: 'show summary155 please',
        lastClarification: makeClarification(labels, 'doc_disambiguation'),
        pendingOptions: makePendingOptions(labels, 'doc'),
      })

      const result = await handleClarificationIntercept(ctx)

      // Should stay in selection flow (not bypass)
      expect(result.handled).toBe(true)

      expect(debugLog).not.toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'clarification_selection_bypassed_command_intent',
        })
      )
    })

    it('"show summary 155 please" (with space) bypasses label matching — canonicalized form does not match "summary155"', async () => {
      // "show summary 155 please" → canonicalized → "summary 155" (with space)
      // "summary155" is a single token — no space match.
      // Pre-gate bypasses label matching, but downstream handlers may still handle it.
      const labels = ['summary144', 'summary155']
      const ctx = createMockInterceptContext({
        trimmedInput: 'show summary 155 please',
        lastClarification: makeClarification(labels, 'doc_disambiguation'),
        pendingOptions: makePendingOptions(labels, 'doc'),
      })

      await handleClarificationIntercept(ctx)

      // The pre-gate bypass log was emitted (label matching skipped)
      expect(debugLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'clarification_selection_bypassed_command_intent',
          metadata: expect.objectContaining({
            input: 'show summary 155 please',
            inputTargetsActiveOption: false,
          }),
        })
      )
    })

    it('"open links panel" with matching active panel options → stays in selection (multi-match reshow)', async () => {
      const labels = ['Links Panel D', 'Links Panel E', 'Links Panel F']
      const ctx = createMockInterceptContext({
        trimmedInput: 'open links panel',
        lastClarification: makeClarification(labels),
        pendingOptions: makePendingOptions(labels),
      })

      const result = await handleClarificationIntercept(ctx)

      // "open links panel" → canonicalized "links panel" matches multiple options
      // → inputTargetsActiveOption=true → stays in selection flow
      // Multi-match → re-show options (handled=true)
      expect(result.handled).toBe(true)

      // Verify selection-allowed log (not bypass log)
      expect(debugLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'clarification_selection_allowed_selection_like',
        })
      )
    })
  })
})
