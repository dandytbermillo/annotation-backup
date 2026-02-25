/**
 * Chat Routing — Arbitration Module
 *
 * Contains the bounded arbitration loop, LLM last-chance handler,
 * continuity deterministic resolver, guard state, and enrichment helpers.
 * Extracted from chat-routing.ts for modularity.
 *
 * @internal — Do not import directly outside lib/chat/.
 * Use the barrel at @/lib/chat/chat-routing instead.
 */

import { debugLog } from '@/lib/utils/debug-logger'
import {
  hasQuestionIntent,
  isPoliteImperativeRequest,
} from '@/lib/chat/query-patterns'
import {
  classifyArbitrationConfidence,
  canonicalizeCommandInput,
} from '@/lib/chat/input-classifiers'
import {
  callClarificationLLMClient,
  isLLMFallbackEnabledClient,
  isLLMAutoExecuteEnabledClient,
  isContextRetryEnabledClient,
  MIN_CONFIDENCE_SELECT,
  AUTO_EXECUTE_CONFIDENCE,
  AUTO_EXECUTE_ALLOWED_REASONS,
  type NeededContextType,
} from '@/lib/chat/clarification-llm-fallback'
import type {
  PreferredCandidateHint,
  ArbitrationFallbackReason,
  ContextEnrichmentCallback,
  LLMArbitrationGuardState,
  ContinuityResolveParams,
  ContinuityResolveResult,
  BoundedArbitrationResult,
  ClarificationInterceptContext,
} from './chat-routing-types'

// =============================================================================
// LLM Arbitration Guard State (module-level singleton)
// =============================================================================

let lastLLMArbitration: LLMArbitrationGuardState | null = null

/**
 * Read module-level guard state.
 * NOTE: This is a TypeScript narrowing workaround, NOT concurrency protection.
 * TS cannot track module-scope variable mutations through async calls, so
 * `if (lastLLMArbitration)` after `await` narrows to `never`. A function call
 * defeats this stale narrowing because TS cannot narrow through function
 * return types. The underlying module-scope singleton is still single-threaded.
 */
function readLLMGuardState(): LLMArbitrationGuardState | null { return lastLLMArbitration }

/** Centralized writer — all mutations to lastLLMArbitration go through here. */
function writeLLMGuardState(state: LLMArbitrationGuardState | null): void {
  lastLLMArbitration = state
}

/** Reset the LLM arbitration loop guard. Called on cycle boundary (clarification resolved) and chat clear. */
export function resetLLMArbitrationGuard(): void {
  writeLLMGuardState(null)
}

// =============================================================================
// Selection Continuity Deterministic Resolver (Plan 20)
// Per: selection-continuity-execution-lane-plan.md
//
// Attempts to resolve a selection deterministically using continuity state
// (recent actions, rejected choices) before falling back to LLM arbitration.
// All safety gates must pass — this is strictly additive (never bypasses
// existing deterministic matching, only resolves when existing matching fails).
// =============================================================================

/**
 * Deterministic continuity resolver — pre-LLM tie-break using continuity state.
 *
 * Safety gates (ALL must pass for execution):
 * 1. Feature flag enabled (checked by caller — not re-checked here)
 * 2. isCommandOrSelection true (not pure question-intent)
 * 3. !isQuestionIntent
 * 4. currentOptionSetId !== null && continuityState.activeOptionSetId !== null
 *    && continuityState.activeOptionSetId === currentOptionSetId (same option set)
 * 5. continuityState.activeScope === currentScope (same scope)
 * 6. Exactly one candidate remains after excluding recentRejectedChoiceIds
 * 7. No loop-guard conflict (not same winnerId as last resolved action in same cycle)
 *
 * Returns { resolved: true, winnerId, reason } or { resolved: false, winnerId: null, reason }.
 */
function tryContinuityDeterministicResolve(params: ContinuityResolveParams): ContinuityResolveResult {
  const {
    candidates,
    continuityState,
    currentOptionSetId,
    currentScope,
    isCommandOrSelection,
    isQuestionIntent,
  } = params

  // Gate 2: Must be command or selection intent
  if (!isCommandOrSelection) {
    return { resolved: false, winnerId: null, reason: 'not_command_or_selection' }
  }

  // Gate 3: Must not be question intent
  if (isQuestionIntent) {
    return { resolved: false, winnerId: null, reason: 'question_intent' }
  }

  // Gate 4: Same option set — strict null check prevents empty-string matching (invariant 6)
  if (currentOptionSetId === null || continuityState.activeOptionSetId === null) {
    return { resolved: false, winnerId: null, reason: 'null_option_set_id' }
  }
  if (continuityState.activeOptionSetId !== currentOptionSetId) {
    return { resolved: false, winnerId: null, reason: 'option_set_mismatch' }
  }

  // Gate 5: Same scope
  if (continuityState.activeScope !== currentScope) {
    return { resolved: false, winnerId: null, reason: 'scope_mismatch' }
  }

  // Gate 6: Filter out rejected choices, check for unique winner
  const rejectedSet = new Set(continuityState.recentRejectedChoiceIds)
  const eligibleCandidates = candidates.filter(c => !rejectedSet.has(c.id))

  if (eligibleCandidates.length === 0) {
    return { resolved: false, winnerId: null, reason: 'all_candidates_rejected' }
  }
  if (eligibleCandidates.length !== 1) {
    return { resolved: false, winnerId: null, reason: `ambiguous_${eligibleCandidates.length}_candidates` }
  }

  const winner = eligibleCandidates[0]

  // Gate 7: Loop-guard — don't re-select the same action that was just resolved
  // in the same option set cycle (prevents infinite loops)
  if (
    continuityState.lastResolvedAction &&
    continuityState.lastResolvedAction.optionSetId === currentOptionSetId &&
    continuityState.lastResolvedAction.targetRef === winner.label
  ) {
    return { resolved: false, winnerId: null, reason: 'loop_guard_same_cycle' }
  }

  return { resolved: true, winnerId: winner.id, reason: 'continuity_deterministic' }
}

// =============================================================================
// LLM Last-Chance Arbitration
// =============================================================================

/**
 * LLM last-chance arbitration for unresolved active-option flows.
 * Per ladder-enforcement-addendum: bounded candidates, clarify-only, safe fallback.
 *
 * Rule E: Single post-deterministic hook — shared by Tier 1b.3 unresolved hook
 * and scope-cue Phase 2b to prevent drift.
 * Rule F: Loop-guard continuity — reuses prior suggestedId when guard fires.
 * Uses classifyArbitrationConfidence with hasActiveOptionContext=true (Rule A).
 * Uses hasQuestionIntent from query-patterns.ts (no local reimplementation).
 */
async function tryLLMLastChance(params: {
  trimmedInput: string
  candidates: { id: string; label: string; sublabel?: string }[]
  context: 'tier1b3_unresolved' | 'scope_cue_unresolved'
  clarificationMessageId: string
  inputIsExplicitCommand: boolean
  isNewQuestionOrCommandDetected: boolean
  matchCount?: number       // deterministic match count (default 0)
  exactMatchCount?: number  // exact match count (default 0)
  enrichedContext?: string  // Retry-only: enriched evidence from context-enrichment loop
  preferredCandidateHint?: PreferredCandidateHint  // Advisory hint from badge/polite/continuity/ordinal
}): Promise<{
  attempted: boolean
  suggestedId: string | null
  fallbackReason: string | null
  autoExecute: boolean  // Phase C: true when all gates pass (kill switch + confidence + allowlisted reason)
  rawDecision?: 'request_context'  // Only set for request_context decision — typed narrowly
  rawNeededContext?: NeededContextType[]  // Context types requested by LLM
}> {
  const { trimmedInput, candidates, context, clarificationMessageId,
    inputIsExplicitCommand, isNewQuestionOrCommandDetected,
    matchCount = 0, exactMatchCount = 0, enrichedContext,
    preferredCandidateHint } = params

  // --- Question-intent exclusion (hard exclusion per Rule G) ---
  // Strip trailing punctuation before check: "ope panel d pls?" is a polite command,
  // not a question. Genuine questions are caught by QUESTION_INTENT_PATTERN (starts with
  // what/how/where/is/etc.), not by trailing '?' alone.
  const inputForQuestionCheck = trimmedInput.replace(/[?!.]+$/, '').trim()
  const isQuestion = hasQuestionIntent(inputForQuestionCheck) && !isPoliteImperativeRequest(trimmedInput)
  if (isQuestion) {
    return { attempted: false, suggestedId: null, fallbackReason: 'question_intent', autoExecute: false }
  }

  // --- Shared classifier (Rule A: single confidence/arbitration signal) ---
  const confidence = classifyArbitrationConfidence({
    matchCount,
    exactMatchCount,
    inputIsExplicitCommand,
    isNewQuestionOrCommandDetected,
    candidates,
    hasActiveOptionContext: true,
  })
  if (confidence.bucket !== 'low_confidence_llm_eligible') {
    return { attempted: false, suggestedId: null, fallbackReason: 'classifier_not_eligible', autoExecute: false }
  }

  // --- Feature flag ---
  if (!isLLMFallbackEnabledClient()) {
    return { attempted: false, suggestedId: null, fallbackReason: 'feature_disabled', autoExecute: false }
  }

  // --- Loop guard (Rule F: continuity) ---
  const normalizedInput = canonicalizeCommandInput(trimmedInput) ?? trimmedInput
  const candidateIds = candidates.map(c => c.id).sort().join(',')
  const currentGuard = readLLMGuardState()
  const isRepeat =
    currentGuard?.normalizedInput === normalizedInput
    && currentGuard?.candidateIds === candidateIds
    && currentGuard?.clarificationMessageId === clarificationMessageId
  if (isRepeat) {
    // Rule F: reuse prior suggestion ordering for continuity — never auto-execute on repeat
    if (currentGuard?.suggestedId) {
      return { attempted: false, suggestedId: currentGuard.suggestedId, fallbackReason: 'loop_guard_continuity', autoExecute: false }
    }
    return { attempted: false, suggestedId: null, fallbackReason: 'loop_guard', autoExecute: false }
  }

  // --- LLM call (bounded to active options only — Rule C clarify-only) ---
  const llmStartTime = Date.now()
  const llmContext = enrichedContext ? `${context}; enriched_evidence: ${enrichedContext}` : context
  const llmResult = await callClarificationLLMClient({
    userInput: trimmedInput,
    options: candidates,
    context: llmContext,
    preferredCandidateId: preferredCandidateHint?.id,
  })
  const llmElapsedMs = Date.now() - llmStartTime

  // Confidence floor: MIN_CONFIDENCE_SELECT (0.6) from clarification-llm-fallback.ts:43
  const llmConfidence = llmResult.response?.confidence ?? 0
  const llmAbstainsOnConfidence = llmConfidence < MIN_CONFIDENCE_SELECT

  if (llmResult.success
    && llmResult.response?.decision === 'select'
    && llmResult.response.choiceId
    && !llmAbstainsOnConfidence) {
    // LLM picked a winner — store suggestedId for Rule F continuity
    const suggestedId = llmResult.response.choiceId
    writeLLMGuardState({ normalizedInput, candidateIds, clarificationMessageId, suggestedId })

    // Phase C: 3-gate auto-execute check
    // Gate 1: Kill switch enabled (NEXT_PUBLIC_LLM_AUTO_EXECUTE_ENABLED=true)
    // Gate 2: Confidence >= AUTO_EXECUTE_CONFIDENCE (0.85)
    // Gate 3: Ambiguity reason in typed allowlist (only 'no_deterministic_match')
    const autoExecute =
      isLLMAutoExecuteEnabledClient()
      && llmConfidence >= AUTO_EXECUTE_CONFIDENCE
      && AUTO_EXECUTE_ALLOWED_REASONS.has(confidence.ambiguityReason ?? '' as never)

    void debugLog({
      component: 'ChatNavigation',
      action: 'llm_arbitration_called',
      metadata: {
        input: trimmedInput, context,
        suggestedId,
        suggestedLabel: candidates.find(c => c.id === suggestedId)?.label,
        candidateCount: candidates.length,
        ambiguityReason: confidence.ambiguityReason,
        finalResolution: autoExecute ? 'auto_execute' : 'clarifier',
        llm_timeout_ms: llmElapsedMs,
        fallback_reason: null,
        llmConfidence,
        autoExecute,
      },
    })
    return { attempted: true, suggestedId, fallbackReason: null, autoExecute }
  }

  // --- request_context: first-class branch (per context-enrichment-retry-loop-plan) ---
  // Must be handled BEFORE generic fallback mapping to prevent collapse into 'abstain'.
  // Server validates contractVersion + neededContext at boundary; client trusts the result.
  if (llmResult.success && llmResult.response?.decision === 'request_context') {
    writeLLMGuardState({ normalizedInput, candidateIds, clarificationMessageId, suggestedId: null })
    void debugLog({
      component: 'ChatNavigation',
      action: 'llm_arbitration_request_context',
      metadata: {
        input: trimmedInput, context,
        neededContext: llmResult.response.neededContext,
        llm_timeout_ms: llmElapsedMs,
      },
    })
    return {
      attempted: true,
      suggestedId: null,
      fallbackReason: null,  // Not a failure — structured request for more context
      autoExecute: false,
      rawDecision: 'request_context',
      rawNeededContext: llmResult.response.neededContext ?? [],
    }
  }

  // LLM failed/abstained/low-confidence → safe fallback (Rule D)
  // Store suggestedId: null for Rule F (no suggestion to reuse)
  writeLLMGuardState({ normalizedInput, candidateIds, clarificationMessageId, suggestedId: null })

  // Extract server downgrade reason if present (e.g., 'Downgraded: contract_version_mismatch').
  // Server downgrade reasons take precedence over generic confidence/decision mapping because
  // they carry typed provenance from the validation boundary (single-source-of-truth).
  const serverReason = llmResult.response?.reason ?? ''
  const serverDowngradeReason: ArbitrationFallbackReason | null =
    serverReason === 'Downgraded: contract_version_mismatch' ? 'contract_version_mismatch'
    : serverReason === 'Downgraded: invalid_needed_context' ? 'invalid_needed_context'
    : null

  const fallbackReason: ArbitrationFallbackReason =
    !llmResult.success
      ? (llmResult.error === 'Timeout' ? 'timeout'
        : llmResult.error?.includes('429') ? 'rate_limited' : 'transport_error')
      : serverDowngradeReason  // Server downgrade reason takes precedence (typed provenance)
        ? serverDowngradeReason
      : llmAbstainsOnConfidence ? 'abstain'
      : llmResult.response?.decision === 'ask_clarify' ? 'abstain'
      : llmResult.response?.decision === 'reroute' ? 'reroute'
      : llmResult.response?.decision === 'none' ? 'none_match'
      : 'low_confidence'

  void debugLog({
    component: 'ChatNavigation',
    action: 'llm_arbitration_failed_fallback_clarifier',
    metadata: {
      input: trimmedInput, context,
      candidateCount: candidates.length,
      ambiguityReason: confidence.ambiguityReason,
      finalResolution: 'clarifier',
      llm_timeout_ms: llmElapsedMs,
      fallback_reason: fallbackReason,
    },
  })
  return { attempted: true, suggestedId: null, fallbackReason, autoExecute: false }
}

// =============================================================================
// Context-Enrichment Retry Loop Orchestrator
// Per context-enrichment-retry-loop-plan.md
// Single bounded loop: deterministic → LLM (attempt 1) → optional enrichment retry → safe clarifier
// =============================================================================

/** Fingerprint includes frozen candidate IDs + scope + metadata keys+values.
 *  Since candidates are frozen, fingerprint change means metadata actually changed. */
function computeEvidenceFingerprint(
  frozenCandidateIds: string[],
  scope: string,
  metadata: Record<string, unknown>
): string {
  const ids = [...frozenCandidateIds].sort().join(',')
  const metaEntries = Object.entries(metadata)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(';')
  return `${ids}|${scope}|${metaEntries}`
}

/**
 * Bounded arbitration loop with optional enrichment retry.
 * Entry points: Tier 1b.3 unresolved hook + scope-cue Phase 2b.
 * When retry flag is OFF, delegates directly to tryLLMLastChance (near-zero behavior change).
 */
export async function runBoundedArbitrationLoop(params: {
  trimmedInput: string
  initialCandidates: { id: string; label: string; sublabel?: string }[]
  context: 'tier1b3_unresolved' | 'scope_cue_unresolved'
  clarificationMessageId: string
  inputIsExplicitCommand: boolean
  isNewQuestionOrCommandDetected: boolean
  matchCount?: number
  exactMatchCount?: number
  scope: import('@/lib/chat/input-classifiers').ScopeCueResult['scope']
  enrichmentCallback: ContextEnrichmentCallback
  preferredCandidateHint?: PreferredCandidateHint  // Advisory hint from badge/polite/continuity/ordinal
}): Promise<BoundedArbitrationResult> {
  const { trimmedInput, initialCandidates, context, clarificationMessageId,
    inputIsExplicitCommand, isNewQuestionOrCommandDetected,
    matchCount, exactMatchCount, scope, enrichmentCallback,
    preferredCandidateHint } = params

  const loopStartTime = Date.now()
  const frozenCandidateIds = initialCandidates.map(c => c.id)

  void debugLog({
    component: 'ChatNavigation',
    action: 'arbitration_loop_started',
    metadata: { input: trimmedInput, scope, candidateCount: initialCandidates.length, context },
  })

  // --- Step 1: Delegate to tryLLMLastChance (attempt 1) ---
  const attempt1 = await tryLLMLastChance({
    trimmedInput,
    candidates: initialCandidates,
    context,
    clarificationMessageId,
    inputIsExplicitCommand,
    isNewQuestionOrCommandDetected,
    matchCount,
    exactMatchCount,
    preferredCandidateHint,
  })

  // --- Step 2: Handle attempt-1 result with explicit reason branching ---

  // Resolved — return as-is
  if (attempt1.suggestedId !== null) {
    return {
      attempted: attempt1.attempted,
      suggestedId: attempt1.suggestedId,
      fallbackReason: (attempt1.fallbackReason as ArbitrationFallbackReason) ?? null,
      autoExecute: attempt1.autoExecute,
      retryAttempted: false,
    }
  }

  // attempted=false — explicit reason branching (no silent pass-through)
  if (!attempt1.attempted) {
    return {
      attempted: false,
      suggestedId: attempt1.suggestedId,
      fallbackReason: (attempt1.fallbackReason as ArbitrationFallbackReason) ?? null,
      autoExecute: false,
      retryAttempted: false,
    }
  }

  // --- Step 3: Check for request_context ---
  // attempted=true, suggestedId=null — LLM was called but didn't resolve

  // If retry flag is OFF, normalize request_context to safe clarifier
  if (!isContextRetryEnabledClient()) {
    if (attempt1.rawDecision === 'request_context') {
      void debugLog({
        component: 'ChatNavigation',
        action: 'arbitration_retry_fallback',
        metadata: { input: trimmedInput, scope, fallbackReason: 'retry_feature_disabled', totalLatencyMs: Date.now() - loopStartTime },
      })
      return {
        attempted: true,
        suggestedId: null,
        fallbackReason: 'retry_feature_disabled',
        autoExecute: false,
        retryAttempted: false,
      }
    }
    // Not request_context — pass through existing fallback reason
    return {
      attempted: true,
      suggestedId: null,
      fallbackReason: (attempt1.fallbackReason as ArbitrationFallbackReason) ?? 'abstain',
      autoExecute: false,
      retryAttempted: false,
    }
  }

  // Retry flag is ON — check if LLM requested context
  if (attempt1.rawDecision !== 'request_context') {
    // LLM didn't request context — return existing fallback
    return {
      attempted: true,
      suggestedId: null,
      fallbackReason: (attempt1.fallbackReason as ArbitrationFallbackReason) ?? 'abstain',
      autoExecute: false,
      retryAttempted: false,
    }
  }

  // --- Step 4: request_context path — bounded enrichment retry ---
  void debugLog({
    component: 'ChatNavigation',
    action: 'arbitration_request_context',
    metadata: {
      input: trimmedInput, scope,
      neededContext: attempt1.rawNeededContext,
      candidateCount: initialCandidates.length,
    },
  })

  // Check retry budget (single retry per cycle)
  if (readLLMGuardState()?.retryAttempted) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'arbitration_retry_fallback',
      metadata: { input: trimmedInput, scope, fallbackReason: 'loop_guard', totalLatencyMs: Date.now() - loopStartTime },
    })
    return {
      attempted: true,
      suggestedId: null,
      fallbackReason: 'loop_guard',
      autoExecute: false,
      retryAttempted: false,
    }
  }

  // Fetch enrichment
  const enrichmentResult = enrichmentCallback(attempt1.rawNeededContext ?? [])
  if (!enrichmentResult) {
    // Distinguish unsupported scope (dashboard/workspace) from generic unavailability.
    // Callers check scope_not_available to show scope-specific messages.
    const reason: ArbitrationFallbackReason =
      (scope === 'dashboard' || scope === 'workspace') ? 'scope_not_available' : 'enrichment_unavailable'
    void debugLog({
      component: 'ChatNavigation',
      action: 'arbitration_retry_fallback',
      metadata: { input: trimmedInput, scope, fallbackReason: reason, totalLatencyMs: Date.now() - loopStartTime },
    })
    return {
      attempted: true,
      suggestedId: null,
      fallbackReason: reason,
      autoExecute: false,
      retryAttempted: false,
    }
  }

  // Compute evidence fingerprints
  const fingerprintBefore = computeEvidenceFingerprint(frozenCandidateIds, scope, {})
  const fingerprintAfter = computeEvidenceFingerprint(frozenCandidateIds, scope, enrichmentResult.enrichedMetadata)

  if (fingerprintBefore === fingerprintAfter) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'arbitration_retry_fallback',
      metadata: { input: trimmedInput, scope, fallbackReason: 'no_new_evidence', evidenceFingerprint: fingerprintAfter, totalLatencyMs: Date.now() - loopStartTime },
    })
    return {
      attempted: true,
      suggestedId: null,
      fallbackReason: 'no_new_evidence',
      autoExecute: false,
      retryAttempted: true,
    }
  }

  // --- Step 5: Evidence changed — retry with enriched metadata ---
  void debugLog({
    component: 'ChatNavigation',
    action: 'arbitration_retry_called',
    metadata: {
      input: trimmedInput, scope,
      candidateCount: initialCandidates.length,
      evidenceFingerprintBefore: fingerprintBefore,
      evidenceFingerprintAfter: fingerprintAfter,
    },
  })

  // Build enriched context string from metadata
  const enrichedContextStr = Object.entries(enrichmentResult.enrichedMetadata)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('; ')

  // Temporarily clear loop guard so the retry call doesn't hit it.
  // tryLLMLastChance stores guard state after attempt 1 — the retry is an
  // intentional second call within the same orchestration loop, not a user repeat.
  // We'll restore/update guard state after attempt 2.
  const guardStateBeforeRetry = readLLMGuardState()
  writeLLMGuardState(null)

  const attempt2 = await tryLLMLastChance({
    trimmedInput,
    candidates: initialCandidates,  // Candidate freeze invariant: same frozen candidates
    context,
    clarificationMessageId,
    inputIsExplicitCommand,
    isNewQuestionOrCommandDetected,
    matchCount,
    exactMatchCount,
    enrichedContext: enrichedContextStr,  // Pass enriched evidence to retry LLM call
    preferredCandidateHint,
  })

  // Update loop guard with retry state.
  // tryLLMLastChance stores a new guard entry from attempt 2.
  // We mark it as retryAttempted so future same-input calls know the budget is spent.
  const guardAfterRetry = readLLMGuardState()
  if (guardAfterRetry) {
    guardAfterRetry.retryAttempted = true
    guardAfterRetry.enrichmentFingerprint = fingerprintAfter
  } else if (guardStateBeforeRetry) {
    // If attempt 2 didn't store guard state (e.g., classifier not eligible),
    // restore the original guard state with retry flag set.
    writeLLMGuardState({ ...guardStateBeforeRetry, retryAttempted: true, enrichmentFingerprint: fingerprintAfter })
  }

  const totalLatencyMs = Date.now() - loopStartTime

  if (attempt2.suggestedId !== null) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'arbitration_retry_resolved',
      metadata: {
        input: trimmedInput, scope,
        suggestedId: attempt2.suggestedId,
        attempts: 2,
        evidenceFingerprint: fingerprintAfter,
        resolution_source: 'llm',
        totalLatencyMs,
      },
    })
    return {
      attempted: true,
      suggestedId: attempt2.suggestedId,
      fallbackReason: null,
      autoExecute: attempt2.autoExecute,
      retryAttempted: true,
    }
  }

  // Retry didn't resolve — safe clarifier
  void debugLog({
    component: 'ChatNavigation',
    action: 'arbitration_retry_fallback',
    metadata: {
      input: trimmedInput, scope,
      attempts: 2,
      evidenceFingerprint: fingerprintAfter,
      fallbackReason: attempt2.fallbackReason ?? 'abstain',
      totalLatencyMs,
    },
  })
  return {
    attempted: true,
    suggestedId: null,
    fallbackReason: (attempt2.fallbackReason as ArbitrationFallbackReason) ?? 'abstain',
    autoExecute: false,
    retryAttempted: true,
  }
}

// =============================================================================
// Scope-Bound Enrichment Fetchers
// Per context-enrichment-retry-loop-plan.md §Step 5
// =============================================================================

/** Returns enriched metadata for chat-scoped evidence (not new candidates). */
function enrichChatEvidence(ctx: ClarificationInterceptContext): { enrichedMetadata: Record<string, unknown> } | null {
  const metadata: Record<string, unknown> = {}

  // Aggregate metadata from recoverable sources
  if (ctx.lastClarification?.options?.length) {
    metadata['lastClarification_labels'] = ctx.lastClarification.options.map(o => `${o.label}${o.sublabel ? ` (${o.sublabel})` : ''}`).join(', ')
    metadata['lastClarification_source'] = 'lastClarification'
  }
  if (ctx.clarificationSnapshot?.options?.length) {
    metadata['snapshot_labels'] = ctx.clarificationSnapshot.options.map(o => `${o.label}${o.sublabel ? ` (${o.sublabel})` : ''}`).join(', ')
    metadata['snapshot_source'] = 'clarificationSnapshot'
  }
  if (ctx.lastOptionsShown?.options?.length) {
    metadata['lastOptionsShown_labels'] = ctx.lastOptionsShown.options.map(o => `${o.label}${o.sublabel ? ` (${o.sublabel})` : ''}`).join(', ')
  }
  if (ctx.scopeCueRecoveryMemory?.options?.length) {
    metadata['recoveryMemory_labels'] = ctx.scopeCueRecoveryMemory.options.map(o => `${o.label}${o.sublabel ? ` (${o.sublabel})` : ''}`).join(', ')
  }

  // Return null if no evidence found
  if (Object.keys(metadata).length === 0) return null
  return { enrichedMetadata: metadata }
}

/** Returns enriched metadata for widget-scoped evidence (not new candidates). */
function enrichWidgetEvidence(ctx: ClarificationInterceptContext): { enrichedMetadata: Record<string, unknown> } | null {
  const metadata: Record<string, unknown> = {}

  if (ctx.widgetSelectionContext) {
    metadata['widget_context'] = 'active'
    metadata['widget_panelId'] = ctx.widgetSelectionContext.widgetId ?? 'unknown'
  }

  if (Object.keys(metadata).length === 0) return null
  return { enrichedMetadata: metadata }
}

/** Factory: returns the appropriate enrichment fetcher based on resolved scope.
 *  Returns null for unsupported scopes (dashboard/workspace) → orchestrator emits scope_not_available. */
export function createEnrichmentCallback(
  scope: import('@/lib/chat/input-classifiers').ScopeCueResult['scope'],
  orchContext: 'tier1b3_unresolved' | 'scope_cue_unresolved',
  ctx: ClarificationInterceptContext
): ContextEnrichmentCallback {
  return (_neededContext: NeededContextType[]) => {
    switch (scope) {
      case 'chat':
        return enrichChatEvidence(ctx)
      case 'widget':
        return enrichWidgetEvidence(ctx)
      case 'dashboard':
      case 'workspace':
        // Unsupported scope — return null (orchestrator emits scope_not_available)
        return null
      case 'none':
        // Follow current resolved source: Tier 1b.3 = chat; scope-cue depends on widget state
        if (orchContext === 'tier1b3_unresolved') {
          return enrichChatEvidence(ctx)
        }
        // Scope-cue Phase 2b with no explicit scope — use widget if active, else chat
        if (ctx.widgetSelectionContext) {
          return enrichWidgetEvidence(ctx)
        }
        return enrichChatEvidence(ctx)
      default: {
        // Exhaustiveness check — TypeScript will error if a scope value is unhandled
        const _exhaustive: never = scope
        return null
      }
    }
  }
}

// Re-export tryContinuityDeterministicResolve for internal use by clarification intercept
export { tryContinuityDeterministicResolve }
