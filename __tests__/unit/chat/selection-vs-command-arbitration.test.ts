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
  isLLMAutoExecuteEnabledClient: jest.fn().mockReturnValue(false),
  shouldCallLLMFallback: jest.fn().mockReturnValue(false),
  MIN_CONFIDENCE_SELECT: 0.6,
  AUTO_EXECUTE_CONFIDENCE: 0.85,
  AUTO_EXECUTE_ALLOWED_REASONS: new Set(['no_deterministic_match']),
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

import { handleClarificationIntercept, resetLLMArbitrationGuard, type ClarificationInterceptContext, type PendingOptionState } from '@/lib/chat/chat-routing'
import type { ClarificationOption, LastClarificationState } from '@/lib/chat/chat-navigation-context'
import { debugLog } from '@/lib/utils/debug-logger'
import { callClarificationLLMClient, isLLMFallbackEnabledClient, isLLMAutoExecuteEnabledClient } from '@/lib/chat/clarification-llm-fallback'
import { classifyArbitrationConfidence, canonicalizeCommandInput } from '@/lib/chat/input-classifiers'

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
    resetLLMArbitrationGuard()
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
      // Without "Links Panels" (no exact match) → re-show
      const labels = ['Links Panel D', 'Links Panel E', 'Links Panel F']
      const ctx = createMockInterceptContext({
        trimmedInput: 'open links panel',
        lastClarification: makeClarification(labels),
        pendingOptions: makePendingOptions(labels),
      })

      const result = await handleClarificationIntercept(ctx)

      // "links panel" broadly matches all 3 but none exactly → re-show
      expect(result.handled).toBe(true)

      // Verify selection-allowed log (not bypass log)
      expect(debugLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'clarification_selection_allowed_selection_like',
        })
      )
    })
  })

  describe('exact-first precedence (intra-selection)', () => {
    it('"open links panel" with [Links Panels, Links Panel D, Links Panel E] → selects Links Panels (exact match)', async () => {
      const labels = ['Links Panels', 'Links Panel D', 'Links Panel E']
      const ctx = createMockInterceptContext({
        trimmedInput: 'open links panel',
        lastClarification: makeClarification(labels),
        pendingOptions: makePendingOptions(labels),
      })

      const result = await handleClarificationIntercept(ctx)

      expect(result.handled).toBe(true)
      // Exact match: "links panel" tokens = {links, panel}, "Links Panels" tokens = {links, panel}
      expect(ctx.handleSelectOption).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Links Panels' })
      )

      // Verify exact-first log was emitted
      expect(debugLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'clarification_exact_normalized_match_selected',
          metadata: expect.objectContaining({
            matchedLabel: 'Links Panels',
            broadMatchCount: 3,
            exactMatchCount: 1,
          }),
        })
      )
    })

    it('"open links panel d" with [Links Panels, Links Panel D, Links Panel E] → selects Links Panel D (exact match)', async () => {
      const labels = ['Links Panels', 'Links Panel D', 'Links Panel E']
      const ctx = createMockInterceptContext({
        trimmedInput: 'open links panel d',
        lastClarification: makeClarification(labels),
        pendingOptions: makePendingOptions(labels),
      })

      const result = await handleClarificationIntercept(ctx)

      expect(result.handled).toBe(true)
      // Badge-aware selection should pick "Links Panel D" before reaching exact-first
      // (badge "d" → unique badge match)
      expect(ctx.handleSelectOption).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Links Panel D' })
      )
    })

    it('"open links" with [Links Panels, Links Panel D, Links Panel E] → clarifier (no exact match)', async () => {
      const labels = ['Links Panels', 'Links Panel D', 'Links Panel E']
      const ctx = createMockInterceptContext({
        trimmedInput: 'open links',
        lastClarification: makeClarification(labels),
        pendingOptions: makePendingOptions(labels),
      })

      const result = await handleClarificationIntercept(ctx)

      // "links" → {links} doesn't exactly match any option, but broadly matches all
      // → multi-match → re-show clarifier
      expect(result.handled).toBe(true)
      // Should NOT have selected any option
      expect(ctx.handleSelectOption).not.toHaveBeenCalled()

      // Verify unresolved hook safe clarifier log (not exact-first log)
      expect(debugLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'clarification_unresolved_hook_safe_clarifier',
        })
      )
    })

    it('no re-show loop: repeated "open links panel" with Links Panels present → selects, does not loop', async () => {
      const labels = ['Links Panels', 'Links Panel D', 'Links Panel E']
      const ctx = createMockInterceptContext({
        trimmedInput: 'open links panel',
        lastClarification: makeClarification(labels),
        pendingOptions: makePendingOptions(labels),
      })

      const result = await handleClarificationIntercept(ctx)

      // Must select Links Panels on exact match — no re-show loop
      expect(result.handled).toBe(true)
      expect(result.clarificationCleared).toBe(true)
      expect(ctx.handleSelectOption).toHaveBeenCalledTimes(1)

      // Must NOT have re-shown options
      expect(debugLog).not.toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'clarification_tier1b3_multi_match_reshow',
        })
      )
    })
  })

  // ==========================================================================
  // LLM Arbitration (clarify-only policy)
  // Per deterministic-llm-arbitration-fallback-plan.md
  // ==========================================================================
  // ==========================================================================
  // LLM Arbitration (clarify-only policy)
  // Per deterministic-llm-arbitration-fallback-plan.md
  // Uses "open links" as input: matches all 3 options via substring on
  // verb-stripped "links", but no exact winner → triggers multi-match path.
  // ==========================================================================
  describe('LLM arbitration (clarify-only)', () => {
    const panelLabels = ['Links Panels', 'Links Panel D', 'Links Panel E']
    // "open links" → verb-stripped "links" → substring matches all 3 → multi-match, no exact winner

    it('LLM narrows multi-match: reorders options with LLM pick first, does NOT auto-execute', async () => {
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
      ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
        success: true,
        response: { decision: 'select', choiceId: 'opt-0', confidence: 0.9, reason: 'exact match' },
        latencyMs: 200,
      })

      const ctx = createMockInterceptContext({
        trimmedInput: 'open links',
        lastClarification: makeClarification(panelLabels),
        pendingOptions: makePendingOptions(panelLabels),
      })

      const result = await handleClarificationIntercept(ctx)

      // Clarify-only: must NOT auto-execute
      expect(ctx.handleSelectOption).not.toHaveBeenCalled()
      // Must re-show options
      expect(result.handled).toBe(true)
      expect(result.clarificationCleared).toBe(false)
      // LLM was called
      expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)
      // LLM call log emitted
      expect(debugLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'llm_arbitration_called',
          metadata: expect.objectContaining({
            suggestedLabel: 'Links Panels',
            finalResolution: 'clarifier',
          }),
        })
      )
      // Re-show with LLM's pick first: first option in addMessage should be Links Panels (opt-0)
      expect(ctx.addMessage).toHaveBeenCalledTimes(1)
      const addedMessage = (ctx.addMessage as jest.Mock).mock.calls[0][0]
      expect(addedMessage.options[0].id).toBe('opt-0') // LLM's pick first
    })

    it('LLM abstains → clarifier with original order', async () => {
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
      ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
        success: true,
        response: { decision: 'ask_clarify', choiceId: null, confidence: 0.3, reason: 'ambiguous' },
        latencyMs: 150,
      })

      const ctx = createMockInterceptContext({
        trimmedInput: 'open links',
        lastClarification: makeClarification(panelLabels),
        pendingOptions: makePendingOptions(panelLabels),
      })

      const result = await handleClarificationIntercept(ctx)

      expect(ctx.handleSelectOption).not.toHaveBeenCalled()
      expect(result.handled).toBe(true)
      expect(result.clarificationCleared).toBe(false)
      expect(debugLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'llm_arbitration_failed_fallback_clarifier',
          metadata: expect.objectContaining({
            fallback_reason: 'abstain',
          }),
        })
      )
    })

    it('LLM timeout → clarifier, log includes fallback_reason: timeout', async () => {
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
      ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Timeout',
        latencyMs: 800,
      })

      const ctx = createMockInterceptContext({
        trimmedInput: 'open links',
        lastClarification: makeClarification(panelLabels),
        pendingOptions: makePendingOptions(panelLabels),
      })

      const result = await handleClarificationIntercept(ctx)

      expect(ctx.handleSelectOption).not.toHaveBeenCalled()
      expect(result.handled).toBe(true)
      expect(result.clarificationCleared).toBe(false)
      expect(debugLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'llm_arbitration_failed_fallback_clarifier',
          metadata: expect.objectContaining({
            fallback_reason: 'timeout',
          }),
        })
      )
    })

    it('LLM disabled → no LLM call, direct re-show', async () => {
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(false)

      const ctx = createMockInterceptContext({
        trimmedInput: 'open links',
        lastClarification: makeClarification(panelLabels),
        pendingOptions: makePendingOptions(panelLabels),
      })

      const result = await handleClarificationIntercept(ctx)

      expect(callClarificationLLMClient).not.toHaveBeenCalled()
      expect(ctx.handleSelectOption).not.toHaveBeenCalled()
      expect(result.handled).toBe(true)
      expect(result.clarificationCleared).toBe(false)
    })

    it('deterministic exact winner never calls LLM', async () => {
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)

      const ctx = createMockInterceptContext({
        trimmedInput: 'open links panel',
        lastClarification: makeClarification(panelLabels),
        pendingOptions: makePendingOptions(panelLabels),
      })

      const result = await handleClarificationIntercept(ctx)

      // Exact-first selects Links Panels deterministically
      expect(result.handled).toBe(true)
      expect(result.clarificationCleared).toBe(true)
      expect(ctx.handleSelectOption).toHaveBeenCalledTimes(1)
      // LLM never called
      expect(callClarificationLLMClient).not.toHaveBeenCalled()
    })

    it('LLM low-confidence → treated as abstain, re-show', async () => {
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
      ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
        success: true,
        response: { decision: 'select', choiceId: 'opt-0', confidence: 0.4, reason: 'weak' },
        latencyMs: 200,
      })

      const ctx = createMockInterceptContext({
        trimmedInput: 'open links',
        lastClarification: makeClarification(panelLabels),
        pendingOptions: makePendingOptions(panelLabels),
      })

      const result = await handleClarificationIntercept(ctx)

      // Below MIN_CONFIDENCE_SELECT (0.6) → abstain
      expect(ctx.handleSelectOption).not.toHaveBeenCalled()
      expect(result.handled).toBe(true)
      expect(result.clarificationCleared).toBe(false)
      expect(debugLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'llm_arbitration_failed_fallback_clarifier',
          metadata: expect.objectContaining({
            fallback_reason: 'abstain',
          }),
        })
      )
    })

    it('candidate pool is all active options (unresolved hook passes full set)', async () => {
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
      ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Timeout',
        latencyMs: 800,
      })

      const ctx = createMockInterceptContext({
        trimmedInput: 'open links',
        lastClarification: makeClarification(panelLabels),
        pendingOptions: makePendingOptions(panelLabels),
      })

      await handleClarificationIntercept(ctx)

      // Verify LLM was called with all active options (unresolved hook uses full set)
      expect(callClarificationLLMClient).toHaveBeenCalledWith(
        expect.objectContaining({
          context: 'tier1b3_unresolved',
          options: expect.arrayContaining([
            expect.objectContaining({ label: 'Links Panels' }),
            expect.objectContaining({ label: 'Links Panel D' }),
            expect.objectContaining({ label: 'Links Panel E' }),
          ]),
        })
      )
      // All candidates should have ids from active options
      const calledOptions = (callClarificationLLMClient as jest.Mock).mock.calls[0][0].options
      expect(calledOptions).toHaveLength(3)
      for (const opt of calledOptions) {
        expect(opt.id).toMatch(/^opt-/)
      }
    })

    it('collision rule: selection-like + unique match → deterministic, no LLM', async () => {
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)

      // "panel d" is selection-like (badge), matches uniquely to Links Panel D
      const ctx = createMockInterceptContext({
        trimmedInput: 'panel d',
        lastClarification: makeClarification(panelLabels),
        pendingOptions: makePendingOptions(panelLabels),
      })

      const result = await handleClarificationIntercept(ctx)

      // Deterministic selection — no LLM needed
      expect(result.handled).toBe(true)
      expect(callClarificationLLMClient).not.toHaveBeenCalled()
    })

    it('loop guard: same input+options in back-to-back turn → LLM not called again', async () => {
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
      ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Timeout',
        latencyMs: 800,
      })

      const makeCtx = () => createMockInterceptContext({
        trimmedInput: 'open links',
        lastClarification: makeClarification(panelLabels),
        pendingOptions: makePendingOptions(panelLabels),
      })

      // First call — LLM called
      await handleClarificationIntercept(makeCtx())
      expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)

      // Second call with same input+options — LLM NOT called again (loop guard)
      jest.clearAllMocks()
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
      ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Timeout',
        latencyMs: 800,
      })
      await handleClarificationIntercept(makeCtx())
      expect(callClarificationLLMClient).not.toHaveBeenCalled()
    })

    it('loop guard resets after clarification cycle ends (lastClarification null)', async () => {
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
      ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Timeout',
        latencyMs: 800,
      })

      const makeCtx = (overrides?: Partial<Parameters<typeof createMockInterceptContext>[0]>) =>
        createMockInterceptContext({
          trimmedInput: 'open links',
          lastClarification: makeClarification(panelLabels),
          pendingOptions: makePendingOptions(panelLabels),
          ...overrides,
        })

      // Cycle 1: LLM called, guard set
      await handleClarificationIntercept(makeCtx())
      expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)

      // Simulate cycle end: call intercept with no active clarification (option was selected)
      jest.clearAllMocks()
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
      await handleClarificationIntercept(makeCtx({ lastClarification: null }))

      // Cycle 2: Same input + same options → LLM should be called again (guard was reset)
      jest.clearAllMocks()
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
      ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Timeout',
        latencyMs: 800,
      })
      await handleClarificationIntercept(makeCtx())
      expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)
    })

    it('full cycle: ambiguous → LLM called → user resolves → same ambiguous → LLM called again', async () => {
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
      ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
        success: true,
        response: { decision: 'select', choiceId: 'opt-0', confidence: 0.9, reason: 'best' },
        latencyMs: 200,
      })

      const makeCtx = (overrides?: Partial<Parameters<typeof createMockInterceptContext>[0]>) =>
        createMockInterceptContext({
          trimmedInput: 'open links',
          lastClarification: makeClarification(panelLabels),
          pendingOptions: makePendingOptions(panelLabels),
          ...overrides,
        })

      // Cycle 1: ambiguous input → LLM called → clarifier shown with reordered options
      const result1 = await handleClarificationIntercept(makeCtx())
      expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)
      expect(result1.handled).toBe(true)
      expect(result1.clarificationCleared).toBe(false) // clarifier shown, not auto-executed

      // User resolves: selects an option → clarification cleared (null)
      jest.clearAllMocks()
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
      await handleClarificationIntercept(makeCtx({ lastClarification: null }))
      // Guard is now reset

      // Cycle 2: Same disambiguation recurs → same input → LLM called again
      jest.clearAllMocks()
      ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
      ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
        success: true,
        response: { decision: 'select', choiceId: 'opt-1', confidence: 0.85, reason: 'best' },
        latencyMs: 150,
      })
      const result2 = await handleClarificationIntercept(makeCtx())
      expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)
      expect(result2.handled).toBe(true)
      expect(result2.clarificationCleared).toBe(false)
    })
  })

  // ============================================================================
  // Scope-cue Phase 2b: Label/shorthand matching against recovered chat options
  // ============================================================================
  describe('Scope-cue Phase 2b: label/shorthand matching against recovered chat options', () => {
    const chatOptions = makeOptions(['Links Panels', 'Links Panel D', 'Links Panel E'], 'panel_drawer')

    function makeScopeCueCtx(input: string, overrides?: Partial<Parameters<typeof createMockInterceptContext>[0]>): ClarificationInterceptContext {
      return createMockInterceptContext({
        trimmedInput: input,
        isLatchEnabled: true,
        clarificationSnapshot: {
          options: chatOptions,
          originalIntent: 'open links panel',
          type: 'panel_disambiguation',
          turnsSinceSet: 0,
          timestamp: Date.now(),
        },
        ...overrides,
      })
    }

    it('shorthand label via scope cue → unique match → execute', async () => {
      const ctx = makeScopeCueCtx('open the panel d from chat')
      const result = await handleClarificationIntercept(ctx)

      expect(result.handled).toBe(true)
      expect(result.clarificationCleared).toBe(true)
      expect(ctx.handleSelectOption).toHaveBeenCalledTimes(1)
      expect(ctx.handleSelectOption).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Links Panel D' })
      )
    })

    it('full label via scope cue → unique match → execute', async () => {
      const ctx = makeScopeCueCtx('open the links panel d in chat')
      const result = await handleClarificationIntercept(ctx)

      expect(result.handled).toBe(true)
      expect(result.clarificationCleared).toBe(true)
      expect(ctx.handleSelectOption).toHaveBeenCalledTimes(1)
      expect(ctx.handleSelectOption).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Links Panel D' })
      )
    })

    it('multi-match shorthand via scope cue → show clarifier (not fall through)', async () => {
      const ctx = makeScopeCueCtx('open links from chat')
      const result = await handleClarificationIntercept(ctx)

      expect(result.handled).toBe(true)
      expect(result.clarificationCleared).toBe(false)
      expect(ctx.handleSelectOption).not.toHaveBeenCalled()
      // Clarifier shown as visible message with options
      expect(ctx.addMessage).toHaveBeenCalledTimes(1)
      const msg = (ctx.addMessage as jest.Mock).mock.calls[0][0]
      expect(msg.content).toContain('Which one do you mean')
      expect(msg.options).toHaveLength(3)
      // Pending options set with the new message's ID (not synthetic snapshot ID)
      expect(ctx.setPendingOptions).toHaveBeenCalled()
      expect(ctx.setPendingOptionsMessageId).toHaveBeenCalledWith(msg.id)
    })

    it('no match via scope cue → unresolved hook fires (recoverable options exist)', async () => {
      const ctx = makeScopeCueCtx('open recent from chat')
      const result = await handleClarificationIntercept(ctx)

      // In v2, scope-cue unified hook fires when recoverableOptions.length > 0.
      // "open recent from chat" → strip "from chat" → "open recent" → 0 label matches
      // → unified hook → tryLLMLastChance → LLM disabled (mock default) → safe clarifier
      expect(result.handled).toBe(true)
      expect(result.clarificationCleared).toBe(false)
      expect(ctx.handleSelectOption).not.toHaveBeenCalled()
      // Clarifier message re-shown
      expect(ctx.addMessage).toHaveBeenCalled()
    })

    it('exact-first winner in multi-match via scope cue → execute', async () => {
      // "links panels from chat" → strip "from chat" → "links panels"
      // → canonicalize → "links panels"
      // → findMatchingOptions: all 3 match (substring "links panel" in each label)
      // → findExactNormalizedMatches: {links, panel} matches "Links Panels" → {links, panel} exactly
      const ctx = makeScopeCueCtx('links panels from chat')
      const result = await handleClarificationIntercept(ctx)

      expect(result.handled).toBe(true)
      expect(result.clarificationCleared).toBe(true)
      expect(ctx.handleSelectOption).toHaveBeenCalledTimes(1)
      expect(ctx.handleSelectOption).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Links Panels' })
      )
    })
  })

  // ==========================================================================
  // Decision ladder enforcement — Phase B: LLM ladder enforcement
  // Per deterministic-llm-ladder-enforcement-addendum-plan.md
  // ==========================================================================
  describe('Decision ladder enforcement — Phase B', () => {
    describe('canonicalization: typo prefixes reverted', () => {
      it('canonicalizeCommandInput does NOT strip "ope" typo prefix (Phase A reverted)', () => {
        expect(canonicalizeCommandInput('ope panel d')).toBe('ope panel d')
      })

      it('canonicalizeCommandInput does NOT strip "opn" typo prefix (Phase A reverted)', () => {
        expect(canonicalizeCommandInput('opn links panel')).toBe('opn links panel')
      })

      it('canonicalizeCommandInput does NOT strip "shw" typo prefix (Phase A reverted)', () => {
        expect(canonicalizeCommandInput('shw recent')).toBe('shw recent')
      })

      it('canonicalizeCommandInput still strips exact "open" prefix (unchanged)', () => {
        expect(canonicalizeCommandInput('open recent')).toBe('recent')
      })
    })

    describe('classifyArbitrationConfidence: hasActiveOptionContext scoping', () => {
      const candidates = [
        { id: 'opt-0', label: 'Links Panels' },
        { id: 'opt-1', label: 'Links Panel D' },
      ]

      it('0 matches + hasActiveOptionContext=true + candidates → llm_eligible, no_deterministic_match', () => {
        const result = classifyArbitrationConfidence({
          matchCount: 0,
          exactMatchCount: 0,
          inputIsExplicitCommand: false,
          isNewQuestionOrCommandDetected: false,
          candidates,
          hasActiveOptionContext: true,
        })
        expect(result.bucket).toBe('low_confidence_llm_eligible')
        expect(result.ambiguityReason).toBe('no_deterministic_match')
      })

      it('0 matches + hasActiveOptionContext=false (default) → clarifier_only, no_candidate', () => {
        const result = classifyArbitrationConfidence({
          matchCount: 0,
          exactMatchCount: 0,
          inputIsExplicitCommand: false,
          isNewQuestionOrCommandDetected: false,
          candidates,
        })
        expect(result.bucket).toBe('low_confidence_clarifier_only')
        expect(result.ambiguityReason).toBe('no_candidate')
      })

      it('0 matches + hasActiveOptionContext=true + empty candidates → clarifier_only', () => {
        const result = classifyArbitrationConfidence({
          matchCount: 0,
          exactMatchCount: 0,
          inputIsExplicitCommand: false,
          isNewQuestionOrCommandDetected: false,
          candidates: [],
          hasActiveOptionContext: true,
        })
        expect(result.bucket).toBe('low_confidence_clarifier_only')
        expect(result.ambiguityReason).toBe('no_candidate')
      })
    })

    describe('unresolved hook safe clarifier (typo command + active options)', () => {
      // "can you ope panel d pls" triggers PANEL_SELECTION → isSelectionLike=true
      // → commandBypassesLabelMatching=false → enters label matching
      // → extractBadge: last token "pls" (not single letter) → no badge
      // → findMatchingOptions: 0 matches (full input too messy)
      // → ordinal guard: not ordinal → UNRESOLVED HOOK fires
      const linksPanelLabels = ['Links Panels', 'Links Panel D', 'Links Panel E']

      it('"can you ope panel d pls" + LLM enabled + auto-execute ON + confidence 0.85 → auto-executes Links Panel D', async () => {
        ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
        ;(isLLMAutoExecuteEnabledClient as jest.Mock).mockReturnValue(true)
        ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
          success: true,
          response: { decision: 'select', choiceId: 'opt-1', confidence: 0.85, reason: 'best match' },
          latencyMs: 200,
        })

        const ctx = createMockInterceptContext({
          trimmedInput: 'can you ope panel d pls',
          lastClarification: makeClarification(linksPanelLabels, 'option_selection'),
          pendingOptions: makePendingOptions(linksPanelLabels),
        })

        const result = await handleClarificationIntercept(ctx)

        // Phase C: auto-executed — clarification cleared
        expect(result.handled).toBe(true)
        expect(result.clarificationCleared).toBe(true)
        expect(ctx.handleSelectOption).toHaveBeenCalledTimes(1)
        expect(ctx.handleSelectOption).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'opt-1', label: 'Links Panel D' })
        )

        // No safe clarifier shown
        expect(ctx.addMessage).not.toHaveBeenCalled()

        // State cleanup: snapshot saved, repair memory set, clarification cleared
        expect(ctx.saveClarificationSnapshot).toHaveBeenCalled()
        expect(ctx.setRepairMemory).toHaveBeenCalled()
        expect(ctx.setLastClarification).toHaveBeenCalledWith(null)
      })

      it('"can you ope panel d pls" + LLM enabled + auto-execute OFF → safe clarifier with LLM reorder', async () => {
        ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
        ;(isLLMAutoExecuteEnabledClient as jest.Mock).mockReturnValue(false)
        ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
          success: true,
          response: { decision: 'select', choiceId: 'opt-1', confidence: 0.85, reason: 'best match' },
          latencyMs: 200,
        })

        const ctx = createMockInterceptContext({
          trimmedInput: 'can you ope panel d pls',
          lastClarification: makeClarification(linksPanelLabels, 'option_selection'),
          pendingOptions: makePendingOptions(linksPanelLabels),
        })

        const result = await handleClarificationIntercept(ctx)

        // Kill switch OFF → safe clarifier, NOT auto-executed
        expect(result.handled).toBe(true)
        expect(result.clarificationCleared).toBe(false)
        expect(ctx.handleSelectOption).not.toHaveBeenCalled()

        // Re-show with LLM's pick first
        expect(ctx.addMessage).toHaveBeenCalledTimes(1)
        const addedMessage = (ctx.addMessage as jest.Mock).mock.calls[0][0]
        expect(addedMessage.options[0].id).toBe('opt-1') // LLM's pick first
      })

      it('"can you ope panel d pls" + LLM confidence 0.7 + auto-execute ON → safe clarifier (below threshold)', async () => {
        ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
        ;(isLLMAutoExecuteEnabledClient as jest.Mock).mockReturnValue(true)
        ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
          success: true,
          response: { decision: 'select', choiceId: 'opt-1', confidence: 0.7, reason: 'decent match' },
          latencyMs: 200,
        })

        const ctx = createMockInterceptContext({
          trimmedInput: 'can you ope panel d pls',
          lastClarification: makeClarification(linksPanelLabels, 'option_selection'),
          pendingOptions: makePendingOptions(linksPanelLabels),
        })

        const result = await handleClarificationIntercept(ctx)

        // Medium confidence → safe clarifier, NOT auto-executed
        expect(result.handled).toBe(true)
        expect(result.clarificationCleared).toBe(false)
        expect(ctx.handleSelectOption).not.toHaveBeenCalled()

        // Still shows clarifier with LLM's pick first
        expect(ctx.addMessage).toHaveBeenCalledTimes(1)
        const addedMessage = (ctx.addMessage as jest.Mock).mock.calls[0][0]
        expect(addedMessage.options[0].id).toBe('opt-1')
      })

      it('"can you ope panel d pls" + active options + LLM disabled → safe clarifier (original order, no escape)', async () => {
        ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(false)

        const ctx = createMockInterceptContext({
          trimmedInput: 'can you ope panel d pls',
          lastClarification: makeClarification(linksPanelLabels, 'option_selection'),
          pendingOptions: makePendingOptions(linksPanelLabels),
        })

        const result = await handleClarificationIntercept(ctx)

        // Safe clarifier — NO escape even with LLM disabled
        expect(result.handled).toBe(true)
        expect(result.clarificationCleared).toBe(false)
        expect(ctx.handleSelectOption).not.toHaveBeenCalled()

        // LLM NOT called
        expect(callClarificationLLMClient).not.toHaveBeenCalled()

        // Options re-shown in original order
        expect(ctx.addMessage).toHaveBeenCalledTimes(1)
        const addedMessage = (ctx.addMessage as jest.Mock).mock.calls[0][0]
        expect(addedMessage.options[0].id).toBe('opt-0') // Original order preserved
      })

      it('"can you ope panel d pls" + active options + LLM timeout → safe clarifier', async () => {
        ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
        ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
          success: false,
          error: 'Timeout',
          latencyMs: 800,
        })

        const ctx = createMockInterceptContext({
          trimmedInput: 'can you ope panel d pls',
          lastClarification: makeClarification(linksPanelLabels, 'option_selection'),
          pendingOptions: makePendingOptions(linksPanelLabels),
        })

        const result = await handleClarificationIntercept(ctx)

        // Safe clarifier — no escape
        expect(result.handled).toBe(true)
        expect(result.clarificationCleared).toBe(false)
        expect(ctx.handleSelectOption).not.toHaveBeenCalled()

        // Options re-shown
        expect(ctx.addMessage).toHaveBeenCalledTimes(1)
      })

      it('"is it the right choice" + active options → escape (question intent via unresolved hook)', async () => {
        // "choice" triggers SHORTHAND_KEYWORDS → isSelectionLike=true → enters label matching
        // "is" → hasQuestionIntent=true, not politeImperative → question escape
        // No token fuzzy-matches ordinals (unlike "this" → "third")
        // No core word overlap with "links"/"panel" labels → Tier 1b.4 doesn't catch it
        const ctx = createMockInterceptContext({
          trimmedInput: 'is it the right choice',
          lastClarification: makeClarification(linksPanelLabels, 'option_selection'),
          pendingOptions: makePendingOptions(linksPanelLabels),
        })

        const result = await handleClarificationIntercept(ctx)

        // Question intent → escape to downstream tiers
        expect(result.handled).toBe(false)

        // Unresolved hook question escape log emitted
        expect(debugLog).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'clarification_unresolved_hook_question_escape',
          })
        )
      })

      it('"open recent" with active options → explicit command → escape', async () => {
        // "open" is a recognized verb → isExplicitCommand = true
        // "recent" doesn't match Links Panel options → inputTargetsActiveOption=false
        // → commandBypassesLabelMatching=true → pre-gate escape
        const ctx = createMockInterceptContext({
          trimmedInput: 'open recent',
          lastClarification: makeClarification(linksPanelLabels, 'option_selection'),
          pendingOptions: makePendingOptions(linksPanelLabels),
        })

        const result = await handleClarificationIntercept(ctx)

        // Explicit command → escape to downstream
        expect(result.handled).toBe(false)

        expect(debugLog).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'clarification_selection_bypassed_command_intent',
            metadata: expect.objectContaining({
              escapeReason: 'explicit_command_priority',
            }),
          })
        )
      })
    })

    describe('unresolved hook loop guard reset on option-set change (BLOCKER)', () => {
      // "can you ope panel d pls" triggers PANEL_SELECTION → isSelectionLike=true → enters label matching
      // → 0 matches → unresolved hook → LLM called
      const linksPanelLabels1 = ['Links Panels', 'Links Panel D', 'Links Panel E']
      const linksPanelLabels2 = ['Widget Alpha', 'Widget Beta', 'Widget Gamma']

      it('same input+options → LLM called once; different messageId → LLM called again', async () => {
        ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
        ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
          success: false,
          error: 'Timeout',
          latencyMs: 800,
        })

        // --- Turn 1: options set A (messageId: msg-1) → LLM called ---
        const ctx1 = createMockInterceptContext({
          trimmedInput: 'can you ope panel d pls',
          lastClarification: {
            ...makeClarification(linksPanelLabels1, 'option_selection'),
            messageId: 'msg-1',
          },
          pendingOptions: makePendingOptions(linksPanelLabels1),
        })
        await handleClarificationIntercept(ctx1)
        expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)

        // --- Turn 2: same input + same options (messageId: msg-1) → loop guard → LLM NOT called ---
        jest.clearAllMocks()
        ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
        ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
          success: false,
          error: 'Timeout',
          latencyMs: 800,
        })
        const ctx2 = createMockInterceptContext({
          trimmedInput: 'can you ope panel d pls',
          lastClarification: {
            ...makeClarification(linksPanelLabels1, 'option_selection'),
            messageId: 'msg-1',
          },
          pendingOptions: makePendingOptions(linksPanelLabels1),
        })
        await handleClarificationIntercept(ctx2)
        expect(callClarificationLLMClient).not.toHaveBeenCalled()

        // --- Turn 3: same input + DIFFERENT options (messageId: msg-2) → loop guard resets → LLM called ---
        jest.clearAllMocks()
        ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
        ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
          success: false,
          error: 'Timeout',
          latencyMs: 800,
        })
        const ctx3 = createMockInterceptContext({
          trimmedInput: 'can you ope panel d pls',
          lastClarification: {
            ...makeClarification(linksPanelLabels2, 'option_selection'),
            messageId: 'msg-2',
          },
          pendingOptions: makePendingOptions(linksPanelLabels2),
        })
        await handleClarificationIntercept(ctx3)
        expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)
      })

      it('loop guard blocks auto-execute on repeat: Turn 1 auto-executes → Turn 2 same input → safe clarifier (NOT auto-execute)', async () => {
        // Turn 1: LLM returns high confidence → auto-executes
        ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
        ;(isLLMAutoExecuteEnabledClient as jest.Mock).mockReturnValue(true)
        ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
          success: true,
          response: { decision: 'select', choiceId: 'opt-1', confidence: 0.90, reason: 'confident match' },
          latencyMs: 150,
        })

        const ctx1 = createMockInterceptContext({
          trimmedInput: 'can you ope panel d pls',
          lastClarification: {
            ...makeClarification(linksPanelLabels1, 'option_selection'),
            messageId: 'msg-loop-1',
          },
          pendingOptions: makePendingOptions(linksPanelLabels1),
        })

        const result1 = await handleClarificationIntercept(ctx1)

        // Turn 1: auto-executed
        expect(result1.handled).toBe(true)
        expect(result1.clarificationCleared).toBe(true)
        expect(ctx1.handleSelectOption).toHaveBeenCalledTimes(1)
        expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)

        // Turn 2: same input + same clarification cycle (same messageId) → loop guard fires
        jest.clearAllMocks()
        ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
        ;(isLLMAutoExecuteEnabledClient as jest.Mock).mockReturnValue(true)
        ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
          success: true,
          response: { decision: 'select', choiceId: 'opt-1', confidence: 0.90, reason: 'confident match' },
          latencyMs: 150,
        })

        const ctx2 = createMockInterceptContext({
          trimmedInput: 'can you ope panel d pls',
          lastClarification: {
            ...makeClarification(linksPanelLabels1, 'option_selection'),
            messageId: 'msg-loop-1',
          },
          pendingOptions: makePendingOptions(linksPanelLabels1),
        })

        const result2 = await handleClarificationIntercept(ctx2)

        // Turn 2: loop guard fires → safe clarifier (NOT auto-execute)
        expect(result2.handled).toBe(true)
        expect(result2.clarificationCleared).toBe(false)
        expect(ctx2.handleSelectOption).not.toHaveBeenCalled()
        // LLM NOT called (loop guard skips LLM call entirely)
        expect(callClarificationLLMClient).not.toHaveBeenCalled()
        // Safe clarifier shown with LLM's prior suggestion first (continuity)
        expect(ctx2.addMessage).toHaveBeenCalledTimes(1)
        const addedMessage = (ctx2.addMessage as jest.Mock).mock.calls[0][0]
        expect(addedMessage.options[0].id).toBe('opt-1') // Prior LLM pick reused for ordering
      })
    })
  })
})
