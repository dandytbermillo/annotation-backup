/**
 * Unit tests for context-enrichment retry loop.
 * Per context-enrichment-retry-loop-plan.md.
 *
 * Tests bounded retry behavior: request_context → enrichment → retry → resolve/clarifier.
 * Feature-flagged behind NEXT_PUBLIC_LLM_CONTEXT_RETRY_ENABLED.
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
  isLLMFallbackEnabledClient: jest.fn().mockReturnValue(true),
  isLLMAutoExecuteEnabledClient: jest.fn().mockReturnValue(false),
  isContextRetryEnabledClient: jest.fn().mockReturnValue(true),
  shouldCallLLMFallback: jest.fn().mockReturnValue(false),
  validateNeededContext: jest.fn((ctx: unknown[]) => Array.isArray(ctx) ? ctx.slice(0, 2) : []),
  MIN_CONFIDENCE_SELECT: 0.6,
  AUTO_EXECUTE_CONFIDENCE: 0.85,
  AUTO_EXECUTE_ALLOWED_REASONS: new Set(['no_deterministic_match']),
  NEEDED_CONTEXT_ALLOWLIST: new Set([
    'chat_active_options', 'chat_recoverable_options',
    'active_widget_items', 'active_dashboard_items',
    'active_workspace_items', 'scope_disambiguation_hint',
  ]),
  MAX_NEEDED_CONTEXT_ITEMS: 2,
  CLARIFICATION_LLM_CONTRACT_VERSION: '2.0',
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

import {
  runBoundedArbitrationLoop,
  resetLLMArbitrationGuard,
  type ArbitrationFallbackReason,
} from '@/lib/chat/chat-routing'
import {
  callClarificationLLMClient,
  isLLMFallbackEnabledClient,
  isContextRetryEnabledClient,
} from '@/lib/chat/clarification-llm-fallback'
import { resolveScopeCue } from '@/lib/chat/input-classifiers'
import type { NeededContextType } from '@/lib/chat/clarification-llm-fallback'

// ============================================================================
// Helpers
// ============================================================================

const mockLLMClient = callClarificationLLMClient as jest.MockedFunction<typeof callClarificationLLMClient>
const mockLLMEnabled = isLLMFallbackEnabledClient as jest.MockedFunction<typeof isLLMFallbackEnabledClient>
const mockRetryEnabled = isContextRetryEnabledClient as jest.MockedFunction<typeof isContextRetryEnabledClient>

function makeCandidates(labels: string[]) {
  return labels.map((label, i) => ({ id: `opt-${i}`, label, sublabel: undefined }))
}

function mockLLMSelect(choiceId: string, confidence = 0.8) {
  mockLLMClient.mockResolvedValueOnce({
    success: true,
    response: {
      choiceId,
      choiceIndex: 0,
      confidence,
      reason: 'test',
      decision: 'select',
    },
    latencyMs: 100,
  })
}

function mockLLMRequestContext(neededContext: NeededContextType[]) {
  mockLLMClient.mockResolvedValueOnce({
    success: true,
    response: {
      choiceId: null,
      choiceIndex: -1,
      confidence: 0,
      reason: 'need more context',
      decision: 'request_context',
      contractVersion: '2.0',
      neededContext,
    },
    latencyMs: 100,
  })
}

function mockLLMAskClarify() {
  mockLLMClient.mockResolvedValueOnce({
    success: true,
    response: {
      choiceId: null,
      choiceIndex: -1,
      confidence: 0.3,
      reason: 'unclear',
      decision: 'ask_clarify',
    },
    latencyMs: 100,
  })
}

function mockLLMTimeout() {
  mockLLMClient.mockResolvedValueOnce({
    success: false,
    error: 'Timeout',
    latencyMs: 800,
  })
}

function mockLLM429() {
  mockLLMClient.mockResolvedValueOnce({
    success: false,
    error: 'HTTP 429 Too Many Requests',
    latencyMs: 100,
  })
}

function noopEnrichment(_neededContext: NeededContextType[]) {
  return { enrichedMetadata: { source: 'chat', labels: 'Panel A, Panel B' } }
}

function nullEnrichment(_neededContext: NeededContextType[]) {
  return null
}

function unchangedEnrichment(_neededContext: NeededContextType[]) {
  return { enrichedMetadata: {} }
}

const baseParams = {
  context: 'tier1b3_unresolved' as const,
  clarificationMessageId: 'msg-1',
  inputIsExplicitCommand: false,
  isNewQuestionOrCommandDetected: false,
  matchCount: 0,
  exactMatchCount: 0,
  scope: 'none' as const,
}

// ============================================================================
// Tests
// ============================================================================

describe('Context-Enrichment Retry Loop', () => {
  beforeEach(() => {
    jest.resetAllMocks()  // resetAllMocks clears both recorded state AND implementations (including mockResolvedValueOnce queue)
    resetLLMArbitrationGuard()
    mockLLMEnabled.mockReturnValue(true)
    mockRetryEnabled.mockReturnValue(true)
    // Re-establish default mock after reset
    mockLLMClient.mockResolvedValue({ success: false, error: 'No mock configured', latencyMs: 0 })
  })

  // Test 1: request_context → enrichment → retry → select → resolved
  it('resolves after retry when enrichment provides new evidence', async () => {
    const candidates = makeCandidates(['Links Panel A', 'Links Panel B', 'Links Panel D'])

    // Attempt 1: LLM requests more context
    mockLLMRequestContext(['chat_active_options'])
    // Attempt 2: LLM selects after enrichment
    mockLLMSelect('opt-2')

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'ope panel d',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })

    expect(result.suggestedId).toBe('opt-2')
    expect(result.retryAttempted).toBe(true)
    expect(result.fallbackReason).toBeNull()
    expect(mockLLMClient).toHaveBeenCalledTimes(2)

    // Verify retry call includes enriched context (Fix 1: enrichment passthrough)
    const call1Context = mockLLMClient.mock.calls[0][0].context
    const call2Context = mockLLMClient.mock.calls[1][0].context
    expect(call1Context).not.toContain('enriched_evidence')
    expect(call2Context).toContain('enriched_evidence')
    expect(call2Context).toContain('source')  // From noopEnrichment metadata
  })

  // Test 2: request_context but unavailable context → safe clarifier
  it('returns enrichment_unavailable when callback returns null', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B'])
    mockLLMRequestContext(['chat_active_options'])

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel something',
      initialCandidates: candidates,
      enrichmentCallback: nullEnrichment,
    })

    expect(result.suggestedId).toBeNull()
    expect(result.fallbackReason).toBe('enrichment_unavailable')
    expect(mockLLMClient).toHaveBeenCalledTimes(1)
  })

  // Test 3: retry budget exhausted → safe clarifier
  it('does not retry more than once per cycle', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B'])

    // First call: request_context → retry → still unresolved
    mockLLMRequestContext(['chat_active_options'])
    mockLLMAskClarify()  // retry still doesn't resolve

    const result1 = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel x',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })
    expect(result1.retryAttempted).toBe(true)
    expect(result1.suggestedId).toBeNull()

    // Second call with same input — loop guard should fire
    mockLLMRequestContext(['chat_active_options'])

    const result2 = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel x',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })

    // Loop guard should fire (same normalized input + candidates)
    expect(result2.attempted).toBe(false)
  })

  // Test 4: explicit chat scope never mixes widget candidates
  it('uses chat enrichment for explicit chat scope', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B'])
    const enrichmentSpy = jest.fn().mockReturnValue({ enrichedMetadata: { source: 'chat' } })

    mockLLMRequestContext(['chat_active_options'])
    mockLLMSelect('opt-0')

    await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel a from chat',
      initialCandidates: candidates,
      scope: 'chat',
      enrichmentCallback: enrichmentSpy,
    })

    expect(enrichmentSpy).toHaveBeenCalledWith(['chat_active_options'])
  })

  // Test 5: timeout → safe clarifier
  it('returns safe clarifier on timeout', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B'])
    mockLLMTimeout()

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel something',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })

    expect(result.suggestedId).toBeNull()
    expect(result.fallbackReason).toBe('timeout')
    expect(result.attempted).toBe(true)
    expect(mockLLMClient).toHaveBeenCalledTimes(1)
  })

  // Test 6: 429 → safe clarifier
  it('returns rate_limited on 429', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B'])
    mockLLM429()

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel something',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })

    expect(result.suggestedId).toBeNull()
    expect(result.fallbackReason).toBe('rate_limited')
  })

  // Test 7: loop guard suppresses duplicate retries in same cycle
  it('loop guard preserves prior suggestion (Rule F continuity)', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B'])

    // First call resolves
    mockLLMSelect('opt-1')
    const result1 = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel b',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })
    expect(result1.suggestedId).toBe('opt-1')

    // Second call with same input → loop guard fires, returns stored suggestion
    const result2 = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel b',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })
    expect(result2.attempted).toBe(false)
    expect(result2.suggestedId).toBe('opt-1')
    expect(result2.fallbackReason).toBe('loop_guard_continuity')
  })

  // Test 8: unchanged evidence fingerprint → no_new_evidence, no retry
  it('skips retry when enrichment produces unchanged fingerprint', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B'])
    mockLLMRequestContext(['chat_active_options'])

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel something',
      initialCandidates: candidates,
      enrichmentCallback: unchangedEnrichment,  // Returns empty metadata
    })

    expect(result.fallbackReason).toBe('no_new_evidence')
    expect(result.retryAttempted).toBe(true)
    expect(mockLLMClient).toHaveBeenCalledTimes(1)  // No retry call
  })

  // Test 9: retry_feature_disabled when flag OFF and LLM returns request_context
  it('normalizes request_context to retry_feature_disabled when flag OFF', async () => {
    mockRetryEnabled.mockReturnValue(false)
    const candidates = makeCandidates(['Panel A', 'Panel B'])
    mockLLMRequestContext(['chat_active_options'])

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel something',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })

    expect(result.fallbackReason).toBe('retry_feature_disabled')
    expect(result.retryAttempted).toBe(false)
    expect(mockLLMClient).toHaveBeenCalledTimes(1)
  })

  // Test 10: flag OFF with non-request_context LLM result → passthrough
  it('passes through existing fallback when flag OFF and no request_context', async () => {
    mockRetryEnabled.mockReturnValue(false)
    const candidates = makeCandidates(['Panel A', 'Panel B'])
    mockLLMAskClarify()

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel something',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })

    expect(result.fallbackReason).toBe('abstain')
    expect(result.retryAttempted).toBe(false)
  })

  // Test 11: scope_not_available for dashboard scope callback null
  it('returns scope_not_available when dashboard enrichment returns null', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B'])
    mockLLMRequestContext(['active_dashboard_items'])

    // Dashboard enrichment returns null
    const dashboardCallback = (_ctx: NeededContextType[]) => null

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel from dashboard',
      initialCandidates: candidates,
      scope: 'dashboard',
      enrichmentCallback: dashboardCallback,
    })

    // Dashboard scope → scope_not_available (not generic enrichment_unavailable)
    expect(result.fallbackReason).toBe('scope_not_available')
    expect(result.suggestedId).toBeNull()
  })

  // Test 12: question_intent hard exclusion
  it('excludes question-intent inputs immediately', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B'])

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'what is panel a',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })

    expect(result.attempted).toBe(false)
    expect(result.fallbackReason).toBe('question_intent')
    expect(mockLLMClient).not.toHaveBeenCalled()
  })

  // Test 13: feature_disabled when LLM fallback flag is OFF
  it('returns feature_disabled when LLM fallback is disabled', async () => {
    mockLLMEnabled.mockReturnValue(false)
    const candidates = makeCandidates(['Panel A', 'Panel B'])

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel something',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })

    expect(result.attempted).toBe(false)
    expect(result.fallbackReason).toBe('feature_disabled')
    expect(mockLLMClient).not.toHaveBeenCalled()
  })

  // Test 14: successful first attempt → no retry needed
  it('returns immediately when first attempt resolves', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B'])
    mockLLMSelect('opt-0')

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel a',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })

    expect(result.suggestedId).toBe('opt-0')
    expect(result.retryAttempted).toBe(false)
    expect(result.fallbackReason).toBeNull()
    expect(mockLLMClient).toHaveBeenCalledTimes(1)
  })

  // Test 15: LLM ask_clarify (not request_context) → no retry
  it('does not retry when LLM returns ask_clarify', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B'])
    mockLLMAskClarify()

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel something',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })

    expect(result.suggestedId).toBeNull()
    expect(result.retryAttempted).toBe(false)
    expect(result.fallbackReason).toBe('abstain')
    expect(mockLLMClient).toHaveBeenCalledTimes(1)
  })

  // Test 16: Multi-cue precedence — chat wins over widget
  describe('Scope cue multi-cue precedence', () => {
    it('resolves to chat when both chat and widget cues present', () => {
      const result = resolveScopeCue('open panel d from chat from links panel d')
      expect(result.scope).toBe('chat')
    })

    it('resolves to chat even when widget cue appears first in string', () => {
      const result = resolveScopeCue('from links panel d from chat')
      expect(result.scope).toBe('chat')
    })

    it('resolves widget cue when no chat cue present', () => {
      const result = resolveScopeCue('open panel d from links panel d')
      expect(result.scope).toBe('widget')
    })

    it('resolves dashboard cue', () => {
      const result = resolveScopeCue('open panel from dashboard')
      expect(result.scope).toBe('dashboard')
    })

    it('resolves workspace cue', () => {
      const result = resolveScopeCue('show item from workspace')
      expect(result.scope).toBe('workspace')
    })

    it('returns none when no scope cue', () => {
      const result = resolveScopeCue('open panel d')
      expect(result.scope).toBe('none')
    })
  })

  // Test 17: Candidate freeze — retry uses same candidates but different context
  it('passes frozen candidates to retry call with enriched context', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B', 'Panel C'])

    mockLLMRequestContext(['chat_active_options'])
    mockLLMSelect('opt-1')

    await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel b please',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })

    // Both calls should receive the same candidates (freeze invariant)
    expect(mockLLMClient).toHaveBeenCalledTimes(2)
    const call1Options = mockLLMClient.mock.calls[0][0].options
    const call2Options = mockLLMClient.mock.calls[1][0].options
    expect(call1Options).toEqual(call2Options)
    expect(call1Options).toEqual(candidates)

    // But context should differ — retry includes enrichment evidence
    const call1Context = mockLLMClient.mock.calls[0][0].context
    const call2Context = mockLLMClient.mock.calls[1][0].context
    expect(call1Context).not.toEqual(call2Context)
    expect(call2Context).toContain('enriched_evidence')
  })

  // Test 18: abstain after retry → safe clarifier with fallback reason
  it('returns safe clarifier after retry abstains', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B'])

    mockLLMRequestContext(['chat_active_options'])
    mockLLMAskClarify()  // retry also doesn't resolve

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel something',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })

    expect(result.suggestedId).toBeNull()
    expect(result.retryAttempted).toBe(true)
    expect(result.fallbackReason).toBe('abstain')
    expect(mockLLMClient).toHaveBeenCalledTimes(2)
  })

  // Test 19: Allowlist cap rejection — empty neededContext → enrichment_unavailable
  // When server validates neededContext and all items are invalid (empty after filtering),
  // the orchestrator receives request_context with rawNeededContext: [].
  // Enrichment callback that depends on specific context types returns null.
  it('returns enrichment_unavailable when neededContext is empty (allowlist cap)', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B', 'Panel C'])

    // LLM returns request_context but server filtered neededContext to empty
    mockLLMClient.mockResolvedValueOnce({
      success: true,
      response: {
        choiceId: null,
        choiceIndex: -1,
        confidence: 0,
        reason: 'need context',
        decision: 'request_context',
        contractVersion: '2.0',
        neededContext: [],  // Empty after server validation (all items were invalid)
      },
      latencyMs: 100,
    })

    // Enrichment callback that returns null when given empty context request
    const capAwareEnrichment = (ctx: NeededContextType[]) => {
      if (ctx.length === 0) return null
      return { enrichedMetadata: { source: 'chat' } }
    }

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel something',
      initialCandidates: candidates,
      enrichmentCallback: capAwareEnrichment,
    })

    expect(result.suggestedId).toBeNull()
    expect(result.fallbackReason).toBe('enrichment_unavailable')
    expect(result.retryAttempted).toBe(false)
    expect(mockLLMClient).toHaveBeenCalledTimes(1)
  })

  // Test 20: contractVersion mismatch — server downgrades to ask_clarify with typed reason
  // Server sets reason='Downgraded: contract_version_mismatch', client propagates as typed fallbackReason
  it('propagates contract_version_mismatch from server downgrade', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B'])

    // Simulate server downgrade: decision is 'ask_clarify' with typed downgrade reason
    mockLLMClient.mockResolvedValueOnce({
      success: true,
      response: {
        choiceId: null,
        choiceIndex: -1,
        confidence: 0.3,
        reason: 'Downgraded: contract_version_mismatch',
        decision: 'ask_clarify',
      },
      latencyMs: 100,
    })

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel something',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })

    // Typed downgrade reason propagated (not generic 'abstain')
    expect(result.suggestedId).toBeNull()
    expect(result.fallbackReason).toBe('contract_version_mismatch')
    expect(result.retryAttempted).toBe(false)
    expect(mockLLMClient).toHaveBeenCalledTimes(1)
  })

  // Test 20b: invalid_needed_context downgrade from server
  it('propagates invalid_needed_context from server downgrade', async () => {
    const candidates = makeCandidates(['Panel A', 'Panel B'])

    mockLLMClient.mockResolvedValueOnce({
      success: true,
      response: {
        choiceId: null,
        choiceIndex: -1,
        confidence: 0.3,
        reason: 'Downgraded: invalid_needed_context',
        decision: 'ask_clarify',
      },
      latencyMs: 100,
    })

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'panel something',
      initialCandidates: candidates,
      enrichmentCallback: noopEnrichment,
    })

    expect(result.fallbackReason).toBe('invalid_needed_context')
    expect(result.retryAttempted).toBe(false)
  })

  // Test 21: Active options + command-like unresolved → LLM attempted before escape
  // When inputIsExplicitCommand is true and there are active options but no exact match,
  // the classifier returns 'low_confidence_llm_eligible' with 'command_selection_collision'.
  // LLM is invoked (attempted=true) — key behavior: LLM is not bypassed for command inputs.
  it('LLM is attempted for command-like input with active options (before escape)', async () => {
    const candidates = makeCandidates(['Links Panel A', 'Links Panel B', 'Links Panel D'])
    mockLLMSelect('opt-2', 0.9)

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'open panel d',
      initialCandidates: candidates,
      inputIsExplicitCommand: true,
      enrichmentCallback: noopEnrichment,
    })

    // LLM was called (not skipped due to command — command_selection_collision is LLM-eligible)
    expect(result.attempted).toBe(true)
    expect(mockLLMClient).toHaveBeenCalledTimes(1)
    // LLM resolved the input
    expect(result.suggestedId).toBe('opt-2')
    // No retry needed since first attempt resolved
    expect(result.retryAttempted).toBe(false)
    expect(result.fallbackReason).toBeNull()
  })

  // Test 22: Widget scope enrichment binding — scope:'widget' with retry
  // Verifies that widget scope correctly routes to enrichment callback and retry works.
  it('uses widget enrichment for explicit widget scope and retries', async () => {
    const candidates = makeCandidates(['Summary 144', 'Links Panel D'])
    const widgetEnrichment = jest.fn().mockReturnValue({
      enrichedMetadata: { widget_context: 'active', widget_panelId: 'links-panel-d' },
    })

    // Attempt 1: LLM requests widget context
    mockLLMRequestContext(['active_widget_items'])
    // Attempt 2: LLM selects after widget enrichment
    mockLLMSelect('opt-1')

    const result = await runBoundedArbitrationLoop({
      ...baseParams,
      trimmedInput: 'open panel d from links panel d',
      initialCandidates: candidates,
      scope: 'widget',
      enrichmentCallback: widgetEnrichment,
    })

    // Widget enrichment was called with the neededContext
    expect(widgetEnrichment).toHaveBeenCalledWith(['active_widget_items'])
    // Retry happened and resolved
    expect(result.suggestedId).toBe('opt-1')
    expect(result.retryAttempted).toBe(true)
    expect(result.fallbackReason).toBeNull()
    expect(mockLLMClient).toHaveBeenCalledTimes(2)
  })
})
