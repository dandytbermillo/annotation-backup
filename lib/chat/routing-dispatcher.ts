/**
 * Routing Dispatcher — Unified Priority Chain
 *
 * Per routing-order-priority-plan.md, this file codifies the canonical routing
 * order in a single place. All user input flows through dispatchRouting() which
 * calls handlers in strict tier order:
 *
 *   Tier 0 — Stop / Cancel (highest priority)
 *   Tier 1 — Return / Resume / Repair (paused snapshot)
 *   Tier 2 — New Topic / Interrupt Commands (verb commands)
 *     2a: Explicit Command Bypass
 *     2b: Cross-Corpus Retrieval
 *     2c: Panel Disambiguation
 *     2d: Meta-Explain
 *     2e: Correction
 *     2f: Follow-Up
 *     2g: Preview Shortcut ("show all")
 *   Tier 3 — Clarification (active list only)
 *     3a: Selection-Only Guard (ordinals, labels on active/recent list)
 *     3b: Affirmation Without Context ("yes" with no suggestion)
 *     3c: Re-show Options ("show options")
 *   Tier 4 — Known-Noun Commands (see known-noun-routing.ts)
 *   Tier 5 — Docs / Informational Routing (last resort)
 *
 * Tiers 0, 1, 3-core are handled inside handleClarificationIntercept().
 * Tier 2 is split: interrupt detection in handleClarificationIntercept(),
 *   explicit command bypass + panel disambiguation + preview shortcut here.
 * Tiers 3a/3b/3c are post-clarification guards handled here.
 * Tier 4 is handleKnownNounRouting() from known-noun-routing.ts.
 * Tier 5 is handleDocRetrieval().
 *
 * After all tiers, unhandled input falls through to the LLM API (caller's
 * responsibility in sendMessage).
 */

import { debugLog } from '@/lib/utils/debug-logger'
import type { ChatMessage, SelectionOption, ViewPanelContent } from '@/lib/chat'
import type { UIContext } from '@/lib/chat/intent-prompt'
import type { LastClarificationState } from '@/lib/chat/chat-navigation-context'
import type { DocRetrievalState } from '@/lib/docs/doc-retrieval-state'
// matchVisiblePanelCommand re-imported for widget scope-cue signal resolution (Stage 4).
import { matchVisiblePanelCommand } from '@/lib/chat/panel-command-matcher'
import type { RepairMemoryState, ClarificationSnapshot, ClarificationOption, LastSuggestionState, SuggestionCandidate, ChatSuggestions, WidgetSelectionContext, ChatProvenance } from '@/lib/chat/chat-navigation-context'
import { WIDGET_SELECTION_TTL, SOFT_ACTIVE_TURN_LIMIT } from '@/lib/chat/chat-navigation-context'
import type {
  HandlerResult,
  PendingOptionState,
  ClarificationInterceptContext,
  ClarificationInterceptResult,
  PanelDisambiguationHandlerContext,
  PanelDisambiguationHandlerResult,
  RoutingHandlerContext,
  MetaExplainHandlerContext,
  FollowUpHandlerContext,
  FollowUpHandlerResult,
} from '@/lib/chat/chat-routing'
import type { CrossCorpusHandlerContext, CrossCorpusHandlerResult } from '@/lib/chat/cross-corpus-handler'
import type { DocRetrievalHandlerContext, DocRetrievalHandlerResult } from '@/lib/chat/doc-routing'

import { handleClarificationIntercept, handlePanelDisambiguation, handleCorrection, handleMetaExplain, handleFollowUp } from '@/lib/chat/chat-routing'
import { reconstructSnapshotData } from '@/lib/chat/chat-routing-clarification-utils'
import { handleCrossCorpusRetrieval } from '@/lib/chat/cross-corpus-handler'
import { handleDocRetrieval } from '@/lib/chat/doc-routing'
import { isAffirmationPhrase, isRejectionPhrase, matchesReshowPhrases, matchesShowAllHeuristic, hasGraceSkipActionVerb, hasQuestionIntent, ACTION_VERB_PATTERN, isCommandLike, isPoliteImperativeRequest } from '@/lib/chat/query-patterns'
import { handleKnownNounRouting } from '@/lib/chat/known-noun-routing'
import { callClarificationLLMClient, isLLMFallbackEnabledClient } from '@/lib/chat/clarification-llm-fallback'
import { handleGroundingSetFallback, buildGroundingContext, checkSoftActiveWindow, isSelectionLike, validateGroundingCandidates, capAndTrimCandidates } from '@/lib/chat/grounding-set'
import type { GroundingCandidate } from '@/lib/chat/grounding-set'
import { buildTurnSnapshot } from '@/lib/chat/ui-snapshot-builder'
import { callGroundingLLM, isGroundingLLMEnabled } from '@/lib/chat/grounding-llm-fallback'
import { getWidgetSnapshot } from '@/lib/widgets/ui-snapshot-registry'

// Phase 1 observe-only durable log
import {
  recordRoutingLog,
  buildContextSnapshot,
  tierToLane,
  provenanceToDecisionSource,
  deriveResultStatus,
  deriveRiskTier,
  deriveFallbackInteractionId,
} from '@/lib/chat/routing-log'
import type { RoutingLogPayload } from '@/lib/chat/routing-log'
import { buildMemoryWritePayload } from '@/lib/chat/routing-log/memory-write-payload'
import { lookupExactMemory } from '@/lib/chat/routing-log/memory-reader'
import { lookupSemanticMemory, type SemanticCandidate, type SemanticLookupResult } from '@/lib/chat/routing-log/memory-semantic-reader'
import { validateMemoryCandidate } from '@/lib/chat/routing-log/memory-validator'
import { buildResultFromMemory } from '@/lib/chat/routing-log/memory-action-builder'
import { computeClarifierReorderTelemetry, reorderClarifierCandidates, type ReorderableCandidate } from '@/lib/chat/routing-log/clarifier-reorder'
import { evaluateStage5Replay } from '@/lib/chat/routing-log/stage5-evaluator'
import { lookupSemanticHints } from '@/lib/chat/routing-log/memory-semantic-reader'
import type { SemanticHintLookupResult } from '@/lib/chat/routing-log/memory-semantic-reader'
import { buildInfoIntentMemoryWritePayload } from '@/lib/chat/routing-log/memory-write-payload'
import { isCorrectionPhrase } from '@/lib/chat/query-patterns'
import { recordMemoryEntry } from '@/lib/chat/routing-log/memory-writer'

// Stage 6: shadow loop (fire-and-forget) + enforcement loop (awaitable)
import { runS6ShadowLoop, runS6EnforcementLoop, executeS6Loop, writeDurableEnforcementLog } from '@/lib/chat/stage6-loop-controller'
import { classifyContentIntent, isAnchoredNoteResolverHardExcluded, isArbiterHardExcluded, isLikelyNavigateCommand, type NoteAnchorContext } from '@/lib/chat/content-intent-classifier'
import { callAnchoredNoteResolver } from '@/lib/chat/anchored-note-intent-resolver'
import { callCrossSurfaceArbiter } from '@/lib/chat/cross-surface-arbiter'
import { resolveNoteStateInfo, isPanelOpenQuery, resolvePanelOpenStateInfo, resolvePanelWidgetStateInfo, resolveWorkspaceStateInfo, resolveDashboardStateInfo } from '@/lib/chat/state-info-resolvers'
import { executeS6OpenPanel, isDuplicateAction } from '@/lib/chat/stage6-execution-bridge'
import type { S6ParsedAction, S6ActionSignature } from '@/lib/chat/stage6-execution-bridge'

// =============================================================================
// Phase 1 Observe-Only — Routing Log Helpers
// =============================================================================

/** Module-level session ID (same pattern as debug-logger.ts) */
let _routingLogSessionId: string | null = null
function getRoutingLogSessionId(): string {
  if (!_routingLogSessionId) {
    _routingLogSessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
  return _routingLogSessionId
}

/**
 * Build the routing log payload from dispatcher context and result.
 * Client-safe: no crypto, no DB access. Sent to server API for processing.
 */
function buildRoutingLogPayload(
  ctx: RoutingDispatcherContext,
  result: RoutingDispatcherResult,
  turnSnapshot: ReturnType<typeof buildTurnSnapshot>,
): RoutingLogPayload {
  const isLatchEnabled = process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 === 'true'

  // Prefer user message id as interaction_id (cleaner, already unique per turn)
  const lastUserMessage = [...ctx.messages].reverse().find(m => m.role === 'user')
  const turnIndex = ctx.messages.filter(m => m.role === 'user').length
  const sessionId = getRoutingLogSessionId()
  const interactionId = lastUserMessage?.id ?? deriveFallbackInteractionId(sessionId, turnIndex, ctx.trimmedInput)

  const snapshot = buildContextSnapshot({
    openWidgetCount: turnSnapshot.openWidgets.length,
    pendingOptionsCount: ctx.pendingOptions.length,
    activeOptionSetId: ctx.activeOptionSetId,
    hasLastClarification: ctx.lastClarification !== null,
    hasLastSuggestion: ctx.lastSuggestion !== null,
    latchEnabled: isLatchEnabled,
    messageCount: ctx.messages.length,
  })

  return {
    raw_query_text: ctx.trimmedInput,
    context_snapshot: snapshot,
    session_id: sessionId,
    interaction_id: interactionId,
    turn_index: turnIndex,
    routing_lane: tierToLane(result.handledByTier),
    decision_source: provenanceToDecisionSource(result._devProvenanceHint),
    risk_tier: deriveRiskTier(result.handled, result.handledByTier),
    provenance: result.tierLabel ?? 'unhandled',
    result_status: deriveResultStatus(result.handled, result._devProvenanceHint, result.tierLabel),
    tier_label: result.tierLabel,
    handled_by_tier: result.handledByTier,
  }
}

/**
 * Build a failed-path routing log payload (for exception cases).
 * All NOT NULL columns get safe documented defaults.
 */
function buildFailedRoutingLogPayload(
  ctx: RoutingDispatcherContext,
  turnSnapshot: ReturnType<typeof buildTurnSnapshot>,
): RoutingLogPayload {
  const isLatchEnabled = process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 === 'true'
  const lastUserMessage = [...ctx.messages].reverse().find(m => m.role === 'user')
  const turnIndex = ctx.messages.filter(m => m.role === 'user').length
  const sessionId = getRoutingLogSessionId()
  const interactionId = lastUserMessage?.id ?? deriveFallbackInteractionId(sessionId, turnIndex, ctx.trimmedInput)

  const snapshot = buildContextSnapshot({
    openWidgetCount: turnSnapshot.openWidgets.length,
    pendingOptionsCount: ctx.pendingOptions.length,
    activeOptionSetId: ctx.activeOptionSetId,
    hasLastClarification: ctx.lastClarification !== null,
    hasLastSuggestion: ctx.lastSuggestion !== null,
    latchEnabled: isLatchEnabled,
    messageCount: ctx.messages.length,
  })

  return {
    raw_query_text: ctx.trimmedInput,
    context_snapshot: snapshot,
    session_id: sessionId,
    interaction_id: interactionId,
    turn_index: turnIndex,
    routing_lane: 'E',
    decision_source: 'clarifier',
    risk_tier: 'low',
    provenance: 'exception',
    result_status: 'failed',
    tier_label: undefined,
    handled_by_tier: undefined,
  }
}

/**
 * Build a routing log payload for memory-served decisions (Phase 2b).
 * Used by the dispatcher to attach as _pendingMemoryLog on memory-served results.
 * Sets routing_lane='B1', decision_source='memory_exact'.
 */
function buildRoutingLogPayloadFromMemory(
  ctx: RoutingDispatcherContext,
  memoryResult: RoutingDispatcherResult,
  turnSnapshot: ReturnType<typeof buildTurnSnapshot>,
): RoutingLogPayload {
  const isLatchEnabled = process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 === 'true'
  const lastUserMessage = [...ctx.messages].reverse().find(m => m.role === 'user')
  const turnIndex = ctx.messages.filter(m => m.role === 'user').length
  const sessionId = getRoutingLogSessionId()
  const interactionId = lastUserMessage?.id ?? deriveFallbackInteractionId(sessionId, turnIndex, ctx.trimmedInput)

  const snapshot = buildContextSnapshot({
    openWidgetCount: turnSnapshot.openWidgets.length,
    pendingOptionsCount: ctx.pendingOptions.length,
    activeOptionSetId: ctx.activeOptionSetId,
    hasLastClarification: ctx.lastClarification !== null,
    hasLastSuggestion: ctx.lastSuggestion !== null,
    latchEnabled: isLatchEnabled,
    messageCount: ctx.messages.length,
  })

  return {
    raw_query_text: ctx.trimmedInput,
    context_snapshot: snapshot,
    session_id: sessionId,
    interaction_id: interactionId,
    turn_index: turnIndex,
    routing_lane: 'B1',
    decision_source: 'memory_exact',
    risk_tier: memoryResult._memoryCandidate?.risk_tier ?? 'medium',
    provenance: memoryResult.tierLabel ?? 'memory_exact',
    result_status: 'executed',
    tier_label: memoryResult.tierLabel,
    handled_by_tier: undefined,
  }
}

/**
 * Build a routing log payload for Stage 5 semantic memory replay (Slice 2).
 * Same structure as B1's builder but with routing_lane='B2', decision_source='memory_semantic'.
 * Includes s5_* telemetry fields inline (early-return path skips general finalization).
 */
function buildRoutingLogPayloadFromSemanticMemory(
  ctx: RoutingDispatcherContext,
  replayResult: RoutingDispatcherResult,
  turnSnapshot: ReturnType<typeof buildTurnSnapshot>,
  s5Telemetry: import('./routing-log/stage5-evaluator').S5EvaluationResult,
): RoutingLogPayload {
  const isLatchEnabled = process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 === 'true'
  const lastUserMessage = [...ctx.messages].reverse().find(m => m.role === 'user')
  const turnIndex = ctx.messages.filter(m => m.role === 'user').length
  const sessionId = getRoutingLogSessionId()
  const interactionId = lastUserMessage?.id ?? deriveFallbackInteractionId(sessionId, turnIndex, ctx.trimmedInput)

  const snapshot = buildContextSnapshot({
    openWidgetCount: turnSnapshot.openWidgets.length,
    pendingOptionsCount: ctx.pendingOptions.length,
    activeOptionSetId: ctx.activeOptionSetId,
    hasLastClarification: ctx.lastClarification !== null,
    hasLastSuggestion: ctx.lastSuggestion !== null,
    latchEnabled: isLatchEnabled,
    messageCount: ctx.messages.length,
  })

  return {
    raw_query_text: ctx.trimmedInput,
    context_snapshot: snapshot,
    session_id: sessionId,
    interaction_id: interactionId,
    turn_index: turnIndex,
    routing_lane: 'B2',
    decision_source: 'memory_semantic',
    risk_tier: replayResult._memoryCandidate?.risk_tier ?? 'low',
    provenance: replayResult.tierLabel ?? 'memory_semantic',
    result_status: 'executed',
    tier_label: replayResult.tierLabel,
    handled_by_tier: undefined,
    // Stage 5 telemetry (inline — early-return path skips general finalization)
    s5_lookup_attempted: s5Telemetry.attempted,
    s5_candidate_count: s5Telemetry.candidateCount,
    s5_top_similarity: s5Telemetry.topSimilarity,
    s5_validation_result: s5Telemetry.validationResult,
    s5_replayed_intent_id: s5Telemetry.replayedIntentId,
    s5_replayed_target_id: s5Telemetry.replayedTargetId,
    s5_fallback_reason: s5Telemetry.fallbackReason,
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Find which list segment an item belongs to in the registry snapshot.
 * Local helper — not exported.
 */
function findSourceSegmentId(widgetId: string | undefined, itemId: string): string | undefined {
  if (!widgetId) return undefined
  const snapshot = getWidgetSnapshot(widgetId)
  if (!snapshot) return undefined

  for (const segment of snapshot.segments) {
    if (segment.segmentType === 'list') {
      if (segment.items.some(item => item.itemId === itemId)) {
        return segment.segmentId
      }
    }
  }
  return undefined
}

/**
 * Resolve a widget item ID to its widget + segment from visible snapshots.
 * Used to execute widget_option selections outside Tier 4.5 (e.g., clarifier follow-ups).
 */
function resolveWidgetItemFromSnapshots(
  getVisibleSnapshots: () => import('@/lib/widgets/ui-snapshot-registry').WidgetSnapshot[],
  itemId: string
): { widgetId: string; widgetLabel: string; segmentId?: string } | null {
  const snapshots = getVisibleSnapshots()
  for (const snapshot of snapshots) {
    for (const segment of snapshot.segments) {
      if (segment.segmentType === 'list') {
        if (segment.items.some(item => item.itemId === itemId)) {
          return {
            widgetId: snapshot.widgetId,
            widgetLabel: snapshot.title,
            segmentId: segment.segmentId,
          }
        }
      }
    }
  }
  return null
}

/**
 * Compute a deterministic fingerprint for snapshot drift detection.
 * Used by typoScopeCueGate to detect if the UI state changed between
 * the clarifier turn and the confirmation turn.
 */
function computeSnapshotFingerprint(turnSnapshot: { activeSnapshotWidgetId?: string | null; openWidgets: Array<{ id: string }> }): string {
  const widgetIds = turnSnapshot.openWidgets.map(w => w.id).sort().join(',')
  return `${turnSnapshot.activeSnapshotWidgetId ?? 'null'}|${widgetIds}`
}

// =============================================================================
// Types
// =============================================================================

/**
 * Last preview state for "show all" shortcut (Tier 2g).
 * Tracks the most recent preview so the user can expand it.
 */
export interface LastPreviewState {
  source: string
  viewPanelContent: ViewPanelContent
  totalCount: number
  messageId: string
  createdAt: number
  drawerPanelId?: string
  drawerPanelTitle?: string
}

// =============================================================================
// Dispatcher Context
// =============================================================================

/**
 * Aggregated context for the routing dispatcher.
 * Combines all handler contexts into a single object so sendMessage()
 * builds it once and passes it through.
 */
export interface RoutingDispatcherContext {
  // --- Input ---
  trimmedInput: string

  // --- Suggestion Routing (Tier S) ---
  lastSuggestion: LastSuggestionState | null
  setLastSuggestion: (state: LastSuggestionState | null) => void
  addRejectedSuggestions: (labels: string[]) => void
  clearRejectedSuggestions: () => void

  // --- Clarification Intercept (Tiers 0, 1, 3) ---
  lastClarification: LastClarificationState | null
  pendingOptions: PendingOptionState[]
  /** Active option set ID — when non-null, Tier 3 is allowed to bind selections.
   *  Per routing-order-priority-plan.md line 81:
   *  "Runs only when activeOptionSetId != null (don't bind to old visible pills in history)" */
  activeOptionSetId: string | null
  /** Per universal-selection-resolver-plan.md: needed to clear activeOptionSetId when registering widget context */
  setActiveOptionSetId: (id: string | null) => void
  uiContext?: UIContext | null
  currentEntryId?: string
  previousRoutingMetadata?: import('./cross-surface-arbiter').PreviousRoutingMetadata | null
  // Phase 5: pending exemplar write for one-turn delayed promotion
  pendingPhase5Write?: import('@/lib/chat/routing-log/pending-phase5-write').PendingPhase5Write | null
  setPendingPhase5Write: (write: import('@/lib/chat/routing-log/pending-phase5-write').PendingPhase5Write | null) => void
  addMessage: (message: ChatMessage, routingMeta?: { tierLabel?: string; provenance?: import('./chat-navigation-context').ChatProvenance }) => void
  setLastClarification: (state: LastClarificationState | null) => void
  setIsLoading: (loading: boolean) => void
  setPendingOptions: (options: PendingOptionState[]) => void
  setPendingOptionsMessageId: (messageId: string | null) => void
  setPendingOptionsGraceCount: (count: number) => void
  setNotesScopeFollowUpActive: (active: boolean) => void
  handleSelectOption: (option: SelectionOption) => void
  repairMemory: RepairMemoryState | null
  setRepairMemory: (lastChoiceId: string | null, options: ClarificationOption[]) => void
  incrementRepairMemoryTurn: () => void
  clearRepairMemory: () => void
  clarificationSnapshot: ClarificationSnapshot | null
  saveClarificationSnapshot: (clarification: LastClarificationState, paused?: boolean, pausedReason?: 'interrupt' | 'stop') => void
  pauseSnapshotWithReason: (reason: 'interrupt' | 'stop') => void
  incrementSnapshotTurn: () => void
  clearClarificationSnapshot: () => void
  stopSuppressionCount: number
  setStopSuppressionCount: (count: number) => void
  decrementStopSuppression: () => void

  // --- Doc/Routing Handlers (Tiers 2, 5) ---
  docRetrievalState: DocRetrievalState | null
  knownTermsFetchStatus: 'snapshot' | 'cached' | 'fetched' | 'fetch_error' | 'fetch_timeout'
  usedCoreAppTermsFallback: boolean
  updateDocRetrievalState: (update: Partial<DocRetrievalState>) => void
  messages: ChatMessage[]

  // --- Explicit Command Bypass / Re-show (Tiers 2, 3) ---
  findLastOptionsMessage: (messages: ChatMessage[]) => { options: PendingOptionState[]; timestamp: Date } | null
  reshowWindowMs: number

  // --- Preview Shortcut (Tier 2g) ---
  lastPreview: LastPreviewState | null
  openPanelDrawer: (panelId: string, panelTitle?: string, executionMeta?: import('@/lib/chat/action-trace').ExecutionMeta) => void
  openPanelWithTracking: (content: ViewPanelContent, panelId?: string) => void

  // --- Grounding-Set Fallback (Tier 4.5, per grounding-set-fallback-plan.md) ---
  sessionState: import('@/lib/chat/intent-prompt').SessionState
  lastOptionsShown: import('@/lib/chat/chat-navigation-context').LastOptionsShown | null
  incrementLastOptionsShownTurn?: () => void
  /** Save last options shown for soft-active window (called wherever dispatcher creates options) */
  saveLastOptionsShown: (options: import('@/lib/chat/chat-navigation-context').ClarificationOption[], messageId: string) => void
  /** Per universal-selection-resolver-plan.md: clear soft-active window when registering widget context */
  clearLastOptionsShown?: () => void

  // --- Scope-Cue Recovery Memory (explicit-only, per scope-cue-recovery-plan) ---
  scopeCueRecoveryMemory: import('@/lib/chat/chat-navigation-context').ScopeCueRecoveryMemory | null
  clearScopeCueRecoveryMemory: () => void

  // --- Widget Registry (Tier 4.5, per widget-registry-implementation-plan.md) ---
  getVisibleSnapshots: () => import('@/lib/widgets/ui-snapshot-registry').WidgetSnapshot[]
  getActiveWidgetId: () => string | null

  // --- Widget Selection Context (per universal-selection-resolver-plan.md) ---
  widgetSelectionContext: import('@/lib/chat/chat-navigation-context').WidgetSelectionContext | null
  setWidgetSelectionContext: (context: import('@/lib/chat/chat-navigation-context').WidgetSelectionContext | null) => void
  incrementWidgetSelectionTurn: () => void
  clearWidgetSelectionContext: () => void

  // --- Focus Latch (per selection-intent-arbitration-incubation-plan.md) ---
  focusLatch: import('@/lib/chat/chat-navigation-context').FocusLatchState | null
  setFocusLatch: (latch: import('@/lib/chat/chat-navigation-context').FocusLatchState | null) => void
  suspendFocusLatch: () => void
  incrementFocusLatchTurn: () => void
  clearFocusLatch: () => void

  // --- Pending Scope-Typo Clarifier (per scope-cues-addendum-plan.md §typoScopeCueGate) ---
  pendingScopeTypoClarifier: import('@/lib/chat/chat-navigation-context').PendingScopeTypoClarifier | null
  setPendingScopeTypoClarifier: (state: import('@/lib/chat/chat-navigation-context').PendingScopeTypoClarifier | null) => void
  clearPendingScopeTypoClarifier: () => void

  /** Replay depth guard: 0 = original input, 1 = replayed. Never recurse beyond 1. */
  _replayDepth?: 0 | 1

  // --- Selection Continuity (Plan 20 — per Plan 19 canonical contract) ---
  selectionContinuity: import('@/lib/chat/chat-navigation-context').SelectionContinuityState
  updateSelectionContinuity: (updates: Partial<import('@/lib/chat/chat-navigation-context').SelectionContinuityState>) => void
  recordAcceptedChoice: (choiceId: string, action: import('@/lib/chat/chat-navigation-context').SelectionActionTrace) => void
  recordRejectedChoice: (choiceId: string) => void
  resetSelectionContinuity: () => void
}

// =============================================================================
// Dispatcher Result
// =============================================================================

export interface RoutingDispatcherResult {
  /** Whether any tier handled the input */
  handled: boolean
  /** Which tier handled it (for telemetry) */
  handledByTier?: 0 | 1 | 2 | 3 | 4 | 5 | 6
  /** Tier label for logging */
  tierLabel?: string
  /** Pass-through from clarification intercept */
  clarificationCleared: boolean
  /** Pass-through from clarification intercept */
  isNewQuestionOrCommandDetected: boolean
  /** Pass-through from follow-up handler (needed for doc retrieval context) */
  classifierCalled: boolean
  classifierResult?: boolean
  classifierTimeout: boolean
  classifierLatencyMs?: number
  classifierError: boolean
  isFollowUp: boolean
  /** Suggestion action for sendMessage() to execute (Tier S routing-only result) */
  suggestionAction?: {
    type: 'affirm_single'
    candidate: SuggestionCandidate
  } | {
    type: 'affirm_multiple'
    candidates: SuggestionCandidate[]
  } | {
    type: 'reject'
    rejectedLabels: string[]
    alternativesMessage: string
  }
  /** Grounding-set action for sendMessage() to execute (Tier 4.5 referent resolution) */
  groundingAction?: {
    type: 'execute_referent'
    /** Synthetic message to send through navigate API (e.g. "open Resume.pdf") */
    syntheticMessage: string
    candidateId: string
    candidateLabel: string
    actionHint?: string
  } | {
    type: 'execute_widget_item'
    widgetId: string
    segmentId?: string
    itemId: string
    itemLabel: string
    action: string
  }
  /** Phase 10: Semantic answer lane marker — input matched semantic question patterns */
  semanticLanePending?: boolean
  /** Dev-only: routing provenance hint for debug overlay (undefined = deterministic) */
  _devProvenanceHint?: ChatProvenance

  // Phase 2 memory-assist fields (deferred execution — sendMessage fires after commit-point)
  /** Memory lookup result for commit-point revalidation in sendMessage (Gate 1) */
  _memoryCandidate?: import('@/lib/chat/routing-log/memory-reader').MemoryLookupResult
  /** Deferred memory write payload — sendMessage fires after confirmed execution (Gate 5) */
  _pendingMemoryWrite?: import('@/lib/chat/routing-log/memory-write-payload').MemoryWritePayload
  /** Deferred durable log payload — sendMessage fires after commit-point passes (Gate 6) */
  _pendingMemoryLog?: import('@/lib/chat/routing-log/payload').RoutingLogPayload
  /** Bug #3: Full routing log payload for execution outcome logging in sendMessage */
  _routingLogPayload?: import('@/lib/chat/routing-log/payload').RoutingLogPayload

  /** Phase 3 B2: Semantic memory candidates for Lane D selection (never direct-execute) */
  _semanticCandidates?: SemanticCandidate[]

  /** Phase 3c: Clarifier reorder telemetry (set inside dispatchRoutingInner when clarifier fires) */
  _b2ClarifierTelemetry?: {
    status: string
    messageId: string
    optionIds: string[]
    matchCount: number
    topMatchOriginalRank?: number
    topMatchId?: string
    topMatchScore?: number
  }

  /** Phase 3c: Selection correlation — set on selection turns (user picks from clarifier) */
  _clarifierOriginMessageId?: string
  _selectedOptionId?: string

  /** Stage 4: Bounded LLM telemetry — set when Tier 4.5 grounding LLM is called */
  _llmTelemetry?: {
    decision: 'select' | 'need_more_info' | 'timeout' | 'error' | 'disabled'
    confidence?: number
    latencyMs?: number
    choiceId?: string | null
    candidateCount: number
    rejectionReason?: 'invalid_choice_id' | 'low_confidence' | 'timeout' | 'error' | null
    /** G4 validator gate telemetry */
    g4TotalIn?: number
    g4TotalOut?: number
    g4DuplicatesRemoved?: number
    g4Rejections?: Partial<Record<string, number>>
    /** G2+G3 cap/trim telemetry */
    g23PreCapCount?: number
    g23PostCapCount?: number
    g23WasTrimmed?: boolean
    g23TrimmedIds?: string[]
    /** G1 shadow: select survived 0.4 but would fail 0.75 */
    g1ShadowRejected?: boolean
    /** G5 TOCTOU shadow revalidation */
    g5ToctouResult?: 'pass' | 'fail' | 'not_revalidated'
    g5ToctouReason?: string
    g5ToctouWindowMs?: number
    /** G7 near-tie guard (shadow mode) */
    g7NearTieDetected?: boolean
    g7Margin?: number
    g7Top1Score?: number
    g7Top2Score?: number
    g7CandidateBasis?: string
  }

  /** Stage 5: Semantic resolution reuse shadow telemetry (set in dispatchRouting, before tier chain) */
  _s5Telemetry?: import('./routing-log/stage5-evaluator').S5EvaluationResult

  /** Phase 3c: B2 lookup status for server-side clarifier telemetry (set in dispatchRouting) */
  _b2LookupStatus?: 'ok' | 'empty' | 'timeout' | 'error' | 'disabled'

  /** Phase 5: pending info-intent exemplar write for one-turn delayed promotion */
  phase5PendingWrite?: import('@/lib/chat/routing-log/pending-phase5-write').PendingPhase5Write

  /** Phase 5: hint metadata from retrieval — consumed by navigate API to bias intent classification */
  _phase5HintIntent?: string
  _phase5HintScope?: 'history_info' | 'navigation'
  _phase5HintFromSeed?: boolean

  /** Phase 5: shared replay snapshot from live UI state — used for B1 lookup AND navigation writeback */
  _phase5ReplaySnapshot?: import('./routing-log/context-snapshot').ContextSnapshotV1

  /** Phase 5: grounding panel-execute metadata — client builds writeback from this */
  _groundingPanelOpen?: { panelId: string; panelTitle: string }

  /** Phase 5: first-class navigation replay action from memory — uses stored target IDs, no re-resolution */
  navigationReplayAction?:
    | { type: 'open_entry'; entryId: string; entryName: string; dashboardWorkspaceId: string }
    | { type: 'open_workspace'; workspaceId: string; workspaceName: string; entryId: string; entryName: string; isDefault: boolean }
    | { type: 'open_panel'; panelId: string; panelTitle: string }
    | { type: 'go_home' }
}

/** Type alias for grounding actions (extracted from RoutingDispatcherResult for reuse) */
export type GroundingAction = NonNullable<RoutingDispatcherResult['groundingAction']>

// =============================================================================
// Phase 5: Hint scope detection
// =============================================================================

/** Local semantic intent patterns — matches queries about recent actions / history */
const HISTORY_INFO_PATTERN = /\b(what\s+did\s+i|what\s+was\s+my\s+last|remind\s+me\s+what|did\s+i\s+(open|close|do|navigate|click))\b/i

/**
 * Detect which Phase 5 hint scope applies to the input, if any.
 * Returns null when no hint scope applies (input should not trigger hint retrieval).
 */
function detectHintScope(input: string): 'history_info' | 'navigation' | null {
  if (HISTORY_INFO_PATTERN.test(input)) return 'history_info'
  // Home-specific navigation (v1)
  const HOME_NAV_PATTERN = /\b(go\s+(to\s+)?home|take\s+me\s+home|return\s+home|back\s+home)\b/i
  if (HOME_NAV_PATTERN.test(input)) return 'navigation'
  // V2: Broad known navigation — requires BOTH an action cue AND known target-family evidence.
  // "open something for me" fails (no target-family). "open budget100" passes (budget\w* matches).
  const BROAD_NAV_ACTION = /\b(open|show|go\s+to|switch\s+to)\b/i
  const TARGET_FAMILY = /\b(panel|workspace|entry|budget\w*|links\s+panel|navigator|quick\s+capture)\b/i
  if (BROAD_NAV_ACTION.test(input) && TARGET_FAMILY.test(input)) return 'navigation'
  return null
}

/**
 * Decide whether the cross-surface arbiter should be SKIPPED for this input.
 * True for action/imperative navigation commands. False for everything else.
 *
 * Navigate handles: "open budget100", "hey can please open the budget", "take me home"
 * Arbiter handles: everything else (state-info, read_content, ambiguous queries)
 *
 * Uses unanchored action-verb detection — catches noisy wrappers like "hey can please open..."
 * without maintaining a wrapper-word list. The key insight: action verbs (open/show/go to/switch to)
 * appearing anywhere in the input signal an imperative command, not a state question.
 * State-info queries like "which panel is open?" also contain "open" but as an adjective,
 * not an imperative verb. The guard below distinguishes them.
 */
function isActionNavigationCommand(input: string): boolean {
  const lower = input.trim().toLowerCase()

  // Guard: state-info queries must NOT be treated as action commands even though they contain "open"
  // "which panel is open?" / "is any panel open?" / "what note is opened?" — "open" is a state adjective here
  const STATE_INFO_GUARD = /\b(which|what|what's)\s+(note|document|page|panel|panels|widget|widgets|workspace|dashboard)\s+(is|are)\s+(open|active|visible|current|opened|showing)\b/i
  const YN_STATE_GUARD = /\b(is|are)\s+(any|the|a)?\s*(note|document|page|panel|panels|widget|widgets|workspace|dashboard)\s*(drawer)?\s+(open|active|visible|current|opened|showing)\b/i
  const WORKSPACE_STATE_GUARD = /\b(which|what)\s+workspace\s+(am\s+i\s+in|is\s+this|is\s+active)\b/i
  const DASHBOARD_STATE_GUARD = /\b(what'?s\s+on\s+the\s+dashboard|how\s+many\s+(widget|panel)s?)\b/i
  if (STATE_INFO_GUARD.test(lower) || YN_STATE_GUARD.test(lower) || WORKSPACE_STATE_GUARD.test(lower) || DASHBOARD_STATE_GUARD.test(lower)) {
    return false // state-info query, not an action command
  }

  // Action verb detection: "open", "show", "go to", "switch to" as imperative
  const ACTION_VERB = /\b(open|show|go\s+to|switch\s+to)\b/i
  return ACTION_VERB.test(lower)
}

// =============================================================================
// Explicit Command Detection (extracted to shared utility for import safety)
// =============================================================================

// Import from shared utility (extracted to avoid circular dependency with chat-routing.ts)
import { isExplicitCommand, isSelectionOnly, normalizeOrdinalTypos, isSemanticQuestionInput, classifyExecutionMeta, isStrictExactMatch, isVerifyOpenQuestion, evaluateDeterministicDecision, isStrictExactMode, resolveScopeCue, type MatchConfidence } from '@/lib/chat/input-classifiers'
// Re-export to avoid breaking existing imports from this file
export { isExplicitCommand }

// =============================================================================
// Selection Helpers (moved from chat-navigation-panel.tsx)
// =============================================================================

/**
 * Check if input looks like a selection attempt even though deterministic
 * normalization couldn't resolve it.
 *
 * Per clarification-response-fit-plan.md "Selection-Like Typos (NEW)":
 * If input resembles an ordinal or option reference but fails deterministic
 * parsing, it should go to the constrained LLM — NOT fall through to docs.
 *
 * Signals:
 * - Short input (1–4 words)
 * - Contains ordinal-like substrings (first/second/third/etc. even if misspelled)
 * - Contains "option" or "one" keywords
 * - Single digit or single letter
 * - NOT a question, command, or known verb phrase
 */
function looksSelectionLike(input: string): boolean {
  const n = input.toLowerCase().trim()
  const wordCount = n.split(/\s+/).length

  // Must be short — long inputs are unlikely selection attempts
  if (wordCount > 4) return false

  // Skip if it has question intent or command verbs
  if (hasQuestionIntent(n)) return false
  if (/^(open|show|go|search|find|help|stop|cancel|back|return)\b/i.test(n)) return false

  // Contains ordinal-like fragments anywhere in token (not just at word start).
  // Catches "sesecond" (contains "sec"), "thrid" (contains "thr"), etc.
  if (/(fir|frs|fis|sec|sco|sed|thi|thr|tir|fou|fif|las)/i.test(n)) return true
  // "option" / "one" at word boundary (these are structural, not ordinal fragments)
  if (/\b(opt|one)\w*/i.test(n)) return true

  // Pure digit or single letter (a–e)
  if (/^[1-9]$/.test(n) || /^[a-e]$/i.test(n)) return true

  // Contains "option" or "number" keyword
  if (/\b(option|choice|number|pick|select)\b/i.test(n)) return true

  return false
}

/**
 * Extract ordinal index from input, supporting both strict patterns and embedded ordinals.
 * This mirrors resolveOrdinalIndex from grounding-set.ts but returns in the format expected
 * by the universal resolver.
 *
 * Strict patterns: "first", "the second one", "option 3"
 * Embedded patterns: "can you open that second one pls", "open the first option in the widget"
 *
 * When isStrictExactMode() is ON: delegates to unified isSelectionOnly('strict') parser —
 * only whole-string ordinals match. Embedded ordinals are not deterministic.
 */
function extractOrdinalIndex(input: string, optionCount: number, optionLabels: string[] = []): number | undefined {
  // Strict mode: delegate to unified parser (single canonical definition)
  if (isStrictExactMode()) {
    const result = isSelectionOnly(input, optionCount, optionLabels, 'strict')
    return result.isSelection ? result.index : undefined
  }

  // Legacy: full embedded extraction
  const normalized = normalizeOrdinalTypos(input).toLowerCase()

  const ordinalMap: Record<string, number> = {
    'first': 0, '1': 0, '1st': 0, 'option 1': 0, 'the first one': 0, 'the first option': 0, 'first option': 0,
    'second': 1, '2': 1, '2nd': 1, 'option 2': 1, 'the second one': 1, 'the second option': 1, 'second option': 1,
    'third': 2, '3': 2, '3rd': 2, 'option 3': 2, 'the third one': 2, 'the third option': 2, 'third option': 2,
    'fourth': 3, '4': 3, '4th': 3, 'option 4': 3, 'the fourth one': 3, 'the fourth option': 3, 'fourth option': 3,
    'fifth': 4, '5': 4, '5th': 4, 'option 5': 4, 'the fifth one': 4, 'the fifth option': 4, 'fifth option': 4,
  }

  // Handle "last"
  if (normalized === 'last' || normalized === 'the last one' || normalized === 'the last option') {
    const index = optionCount - 1
    return index >= 0 ? index : undefined
  }

  // 1. Exact whole-string match
  if (ordinalMap[normalized] !== undefined) {
    const index = ordinalMap[normalized]
    return index < optionCount ? index : undefined
  }

  // 2. Extract embedded ordinal from within a longer string.
  //    Handles inputs like "can you open that second one pls" where the
  //    ordinal is embedded in a command sentence.
  const embeddedOrdinals: [RegExp, number][] = [
    [/\bfirst\b|(?<!\d)1st\b/, 0],
    [/\bsecond\b|(?<!\d)2nd\b/, 1],
    [/\bthird\b|(?<!\d)3rd\b/, 2],
    [/\bfourth\b|(?<!\d)4th\b/, 3],
    [/\bfifth\b|(?<!\d)5th\b/, 4],
    [/\bsixth\b/, 5],
    [/\bseventh\b/, 6],
    [/\beighth\b/, 7],
    [/\bninth\b/, 8],
    [/\blast\b/, optionCount - 1],
  ]

  for (const [pattern, index] of embeddedOrdinals) {
    if (pattern.test(normalized) && index >= 0 && index < optionCount) {
      return index
    }
  }

  // 3. Single digit number
  const singleDigit = normalized.match(/\b([1-9])\b/)
  if (singleDigit) {
    const index = parseInt(singleDigit[1], 10) - 1
    if (index >= 0 && index < optionCount) {
      return index
    }
  }

  return undefined
}


// =============================================================================
// Structured Option Candidate Matching
// =============================================================================

/** Aligns with DecisionReason — same keys minus 'no_match' and 'soft_multi_match' (aggregated) */
type OptionMatchType = 'exact_label' | 'exact_sublabel' | 'soft_contains' | 'soft_starts_with' | 'soft_label_contains'

interface OptionCandidate {
  option: PendingOptionState
  matchType: OptionMatchType
}

/**
 * Returns ALL matches with their match type — structured array for LLM arbitration.
 * Each candidate carries its matchType so callers can distinguish high-confidence
 * (exact_label, exact_sublabel) from soft matches.
 */
function findOptionCandidates(
  input: string,
  options: PendingOptionState[]
): OptionCandidate[] {
  const normalized = input.trim().toLowerCase()
  if (!normalized) return []

  const candidates: OptionCandidate[] = []

  for (const opt of options) {
    const label = opt.label.toLowerCase().trim()

    // Exact label match
    if (label === normalized) {
      candidates.push({ option: opt, matchType: 'exact_label' })
      continue
    }

    // Exact sublabel match
    if (opt.sublabel && opt.sublabel.toLowerCase().trim() === normalized) {
      candidates.push({ option: opt, matchType: 'exact_sublabel' })
      continue
    }

    // Contains: input contains the option label
    // e.g., "pls show the Links Panel D" contains "links panel d"
    if (normalized.includes(label) && label.length >= 2) {
      candidates.push({ option: opt, matchType: 'soft_contains' })
      continue
    }

    // Starts with: label starts with input
    // e.g., "workspace 6" → "Workspace 6 (Home)"
    if (label.startsWith(normalized) && normalized.length >= 2) {
      candidates.push({ option: opt, matchType: 'soft_starts_with' })
      continue
    }

    // Label contains input: label contains input (min 3 chars)
    // e.g., "panel" found in "Links Panel D"
    if (normalized.length >= 3 && label.includes(normalized)) {
      candidates.push({ option: opt, matchType: 'soft_label_contains' })
      continue
    }
  }

  return candidates
}

/**
 * Gated wrapper: delegates to evaluateDeterministicDecision.
 * Returns non-null only for outcome === 'execute' (high-confidence).
 */
function findHighConfidenceMatch(
  input: string,
  options: PendingOptionState[]
): { match: PendingOptionState; confidence: MatchConfidence; reason: string } | null {
  const decision = evaluateDeterministicDecision(
    input,
    options.map(o => ({ id: o.id, label: o.label, sublabel: o.sublabel })),
    'active_option'
  )

  if (decision.outcome !== 'execute' || !decision.match) return null

  const matchedOption = options.find(o => o.id === decision.match!.id)
  if (!matchedOption) return null

  return {
    match: matchedOption,
    confidence: decision.confidence,
    reason: decision.reason,
  }
}

// =============================================================================
// Universal Selection Follow-Up Resolver
// Per universal-selection-resolver-plan.md Phase 4
// =============================================================================

/**
 * Resolve selection follow-ups against chat or widget selection contexts.
 * Precedence: chat context first, then widget context.
 * Gate: Must be selection-like and NOT a question.
 *
 * Returns { handled: true, groundingAction } for widget selections,
 * or { handled: true, matchedOption } for chat selections (caller handles).
 */
function resolveSelectionFollowUp(
  input: string,
  chatContext: {
    pendingOptions: PendingOptionState[]
    activeOptionSetId: string | null
  },
  widgetContext: WidgetSelectionContext | null,
  getVisibleSnapshots: () => ReturnType<typeof getWidgetSnapshot>[]
): {
  handled: boolean
  matchedChatOption?: PendingOptionState
  groundingAction?: GroundingAction
} {
  // Gate: must be selection-like
  if (!isSelectionLike(input)) {
    return { handled: false }
  }

  // Question-intent filter using shared utilities (no local regex duplication).
  // Per universal-selection-resolver-plan.md Phase 4:
  // - isPoliteImperativeRequest: "can you open..." / "could you show..." (query-patterns.ts:363)
  // - isCommandLike: action verb + no question-word prefix (handles trailing ? correctly)
  if (hasQuestionIntent(input) && !isPoliteImperativeRequest(input) && !isCommandLike(input)) {
    return { handled: false }
  }

  // Precedence 1: Chat context first
  if (chatContext.pendingOptions.length > 0 && chatContext.activeOptionSetId !== null) {
    // Use extractOrdinalIndex for ordinal support (strict-only when isStrictExactMode)
    const ordinalIndex = extractOrdinalIndex(input, chatContext.pendingOptions.length, chatContext.pendingOptions.map(o => o.label))

    if (ordinalIndex !== undefined) {
      const match = chatContext.pendingOptions[ordinalIndex]
      return { handled: true, matchedChatOption: match }
    }

    // Try label match — gated by confidence gate (high-confidence only)
    const chatLabelMatch = findHighConfidenceMatch(input, chatContext.pendingOptions)
    if (chatLabelMatch) {
      return { handled: true, matchedChatOption: chatLabelMatch.match }
    }
  }

  // Precedence 2: Widget context (only if chat context didn't match)
  if (widgetContext && widgetContext.turnsSinceShown < WIDGET_SELECTION_TTL) {
    // Use extractOrdinalIndex for ordinal support (strict-only when isStrictExactMode)
    const ordinalIndex = extractOrdinalIndex(input, widgetContext.options.length, widgetContext.options.map(o => o.label))

    if (ordinalIndex !== undefined) {
      const match = widgetContext.options[ordinalIndex]
      return {
        handled: true,
        groundingAction: {
          type: 'execute_widget_item',
          widgetId: widgetContext.widgetId,
          segmentId: widgetContext.segmentId,
          itemId: match.id,
          itemLabel: match.label,
          action: 'open',
        },
      }
    }

    // Try label match for widget options — gated by confidence gate (high-confidence only)
    const widgetOptionsAsPending: PendingOptionState[] = widgetContext.options.map((opt, idx) => ({
      index: idx + 1,
      type: 'widget_option' as const,
      id: opt.id,
      label: opt.label,
      sublabel: opt.sublabel,
      data: undefined, // Widget options don't carry data payload
    }))
    const widgetLabelMatch = findHighConfidenceMatch(input, widgetOptionsAsPending)
    if (widgetLabelMatch) {
      return {
        handled: true,
        groundingAction: {
          type: 'execute_widget_item',
          widgetId: widgetContext.widgetId,
          segmentId: widgetContext.segmentId,
          itemId: widgetLabelMatch.match.id,
          itemLabel: widgetLabelMatch.match.label,
          action: 'open',
        },
      }
    }
  }

  return { handled: false }
}

// =============================================================================
// Grounding-Set Helpers
// =============================================================================

/**
 * Build a grounded clarifier message from candidates.
 * Per plan §F: On need_more_info, ask a single grounded clarifier.
 */
function buildGroundedClarifier(candidates: GroundingCandidate[]): string {
  if (candidates.length === 0) {
    return "I'm not sure what you're referring to. Could you tell me what you'd like to do?"
  }

  // Group by type for natural phrasing
  const options = candidates.filter(c => c.type === 'option' || c.type === 'widget_option')
  const referents = candidates.filter(c => c.type === 'referent')
  const capabilities = candidates.filter(c => c.type === 'capability')

  if (options.length > 0) {
    const labels = options.slice(0, 5).map(c => c.label)
    return `Which option did you mean? ${labels.join(', ')}?`
  }

  if (referents.length > 0 && capabilities.length > 0) {
    const refLabels = referents.map(c => c.label)
    const capLabels = capabilities.map(c => c.label.toLowerCase())
    return `Do you want to ${capLabels.join(', ')} ${refLabels[0]}, or something else?`
  }

  if (referents.length > 0) {
    return `Are you referring to ${referents[0].label}?`
  }

  return "I'm not sure what you're referring to. Could you tell me what you'd like to do?"
}

/**
 * Bind a grounded clarifier to pending options so follow-up replies can resolve.
 * Only binds option/widget_option candidates (others are ignored).
 * Returns the built options so they can be added to the clarifier message.
 *
 * Per universal-selection-resolver-plan.md Phase 3:
 * - If ALL options are widget_option → register widgetSelectionContext (not pendingOptions)
 * - If mixed or chat-only → use existing pendingOptions/lastClarification behavior
 */
function bindGroundingClarifierOptions(
  ctx: RoutingDispatcherContext,
  candidates: GroundingCandidate[],
  messageId: string
): PendingOptionState[] {
  const optionCandidates = candidates.filter(c => c.type === 'option' || c.type === 'widget_option')
  if (optionCandidates.length === 0) return []

  // Check if ALL candidates are widget_option
  const allWidgetOptions = optionCandidates.every(c => c.type === 'widget_option')

  if (allWidgetOptions) {
    // Per universal-selection-resolver-plan.md Phase 3:
    // Register widgetSelectionContext instead of pendingOptions for pure widget lists
    const firstCandidate = optionCandidates[0]
    const widgetInfo = resolveWidgetItemFromSnapshots(ctx.getVisibleSnapshots, firstCandidate.id)

    if (widgetInfo) {
      // Build options in exact same order as candidates (for ordinal alignment)
      // Note: GroundingCandidate doesn't have sublabel, so we omit it
      const widgetOptions = optionCandidates.map(c => ({
        id: c.id,
        label: c.label,
      }))

      // Register widget selection context
      ctx.setWidgetSelectionContext({
        optionSetId: messageId,
        widgetId: widgetInfo.widgetId,
        segmentId: widgetInfo.segmentId,
        options: widgetOptions,
        timestamp: Date.now(),
        turnsSinceShown: 0,
      })

      // Clear chat selection context to prevent cross-context ambiguity
      // CRITICAL: Must clear activeOptionSetId to prevent Tier 3a from matching against old options
      // CRITICAL: Must clear lastOptionsShown to prevent soft-active window (Tier 4.5) from matching old options
      // CRITICAL: Must clear clarificationSnapshot to prevent POST-ACTION ORDINAL WINDOW from matching old options
      ctx.setPendingOptions([])
      ctx.setPendingOptionsMessageId(null)
      ctx.setPendingOptionsGraceCount(0)
      ctx.setActiveOptionSetId(null)
      ctx.setLastClarification(null)
      ctx.clearLastOptionsShown?.()
      ctx.clearClarificationSnapshot()

      void debugLog({
        component: 'ChatNavigation',
        action: 'grounding_clarifier_widget_context',
        metadata: {
          messageId,
          widgetId: widgetInfo.widgetId,
          optionCount: widgetOptions.length,
          optionLabels: widgetOptions.map(o => o.label),
        },
      })

      // Still return options for message UI rendering (pills display)
      // but they are NOT bound to pendingOptions
      return optionCandidates.map((candidate, index) => ({
        index,
        id: candidate.id,
        label: candidate.label,
        type: 'widget_option' as const,
        data: {
          widgetId: widgetInfo.widgetId,
          segmentId: widgetInfo.segmentId,
          itemId: candidate.id,
        },
      }))
    } else {
      // Per universal-selection-resolver-plan.md Phase 3 (lines 79-81):
      // Widget list candidates without valid widgetInfo (missing widgetId/segmentId)
      // should NOT be registered in chat context. Clear stale context and keep pills UI-only.
      ctx.setPendingOptions([])
      ctx.setPendingOptionsMessageId(null)
      ctx.setPendingOptionsGraceCount(0)
      ctx.setActiveOptionSetId(null)
      ctx.setLastClarification(null)
      ctx.clearLastOptionsShown?.()
      ctx.clearWidgetSelectionContext()
      ctx.clearClarificationSnapshot()

      void debugLog({
        component: 'ChatNavigation',
        action: 'grounding_clarifier_widget_no_registry',
        metadata: {
          messageId,
          candidateCount: optionCandidates.length,
          candidateLabels: optionCandidates.map(c => c.label),
          reason: 'widget_option_candidates_not_in_snapshot_registry',
        },
      })

      // Return pills for UI-only display (clickable but not ordinal-selectable)
      return optionCandidates.map((candidate, index) => ({
        index,
        id: candidate.id,
        label: candidate.label,
        type: 'widget_option' as const,
        data: undefined, // No execution data available
      }))
    }
  }

  // Mixed or chat-only options: use existing pendingOptions/lastClarification behavior
  const pendingOptions: PendingOptionState[] = []

  optionCandidates.forEach((candidate, index) => {
    if (candidate.type === 'widget_option') {
      const widgetInfo = resolveWidgetItemFromSnapshots(ctx.getVisibleSnapshots, candidate.id)
      pendingOptions.push({
        index,
        id: candidate.id,
        label: candidate.label,
        type: 'widget_option',
        data: {
          widgetId: widgetInfo?.widgetId,
          segmentId: widgetInfo?.segmentId,
          itemId: candidate.id,
        },
      })
      return
    }

    // For option-type candidates, attempt to find a full option with data.
    // Prefer message history (has full execution data), fall back to reconstructed data.
    const messageOption = ctx.findLastOptionsMessage(ctx.messages)?.options.find(opt => opt.id === candidate.id)
    if (messageOption) {
      pendingOptions.push({
        index,
        id: messageOption.id,
        label: messageOption.label,
        sublabel: messageOption.sublabel,
        type: messageOption.type,
        data: messageOption.data,
      })
    } else {
      // Candidate not in message history (first-time grounding LLM clarifier).
      // Reconstruct execution data from candidate type/id so the intercept can
      // handle ordinal selections on the next turn (e.g., "2" → budget200).
      // Without this, lastClarification is cleared and ordinals fall to the API,
      // bypassing wrappedHandleSelectOption and losing selection correlation.

      // visible_panels candidates carry generic 'option' type in the grounding pipeline
      // but must be converted to 'panel_drawer' for the selection/execution pipeline.
      const executionType = candidate.source === 'visible_panels' ? 'panel_drawer' : candidate.type
      pendingOptions.push({
        index,
        id: candidate.id,
        label: candidate.label,
        type: executionType,
        data: reconstructSnapshotData({ id: candidate.id, label: candidate.label, type: executionType }),
      })
    }
  })

  // Per universal-selection-resolver-plan.md Phase 3 (lines 76-78):
  // If we cannot attach execution data to option-type candidates, do NOT leave stale
  // pendingOptions active. Clear chat selection context to prevent cross-binding.
  if (pendingOptions.length === 0) {
    // Clear stale chat context — pills will be UI-only (clickable but not ordinal-selectable)
    // CRITICAL: Must also clear clarificationSnapshot to prevent POST-ACTION ORDINAL WINDOW from matching old options
    ctx.setPendingOptions([])
    ctx.setPendingOptionsMessageId(null)
    ctx.setPendingOptionsGraceCount(0)
    ctx.setActiveOptionSetId(null)
    ctx.setLastClarification(null)
    ctx.clearLastOptionsShown?.()
    ctx.clearClarificationSnapshot()

    void debugLog({
      component: 'ChatNavigation',
      action: 'grounding_clarifier_no_exec_data',
      metadata: {
        candidateCount: candidates.length,
        reason: 'option_candidates_not_in_message_history',
      },
    })

    return []
  }

  // Clear widget selection context to prevent cross-context ambiguity
  ctx.clearWidgetSelectionContext()

  ctx.setPendingOptions(pendingOptions)
  ctx.setPendingOptionsMessageId(messageId)
  ctx.setPendingOptionsGraceCount(0)
  ctx.saveLastOptionsShown(
    pendingOptions.map(opt => ({
      id: opt.id,
      label: opt.label,
      sublabel: opt.sublabel,
      type: opt.type,
    })),
    messageId
  )

  // Sync lastClarification so bare labels can be matched through handleClarificationIntercept.
  // This matches the pattern used in Tier 3c re-show options (lines 1609-1622).
  ctx.setLastClarification({
    type: 'option_selection',
    originalIntent: 'grounding_clarifier',
    messageId,
    timestamp: Date.now(),
    clarificationQuestion: 'Which one?',
    options: pendingOptions.map(opt => ({
      id: opt.id,
      label: opt.label,
      sublabel: opt.sublabel,
      type: opt.type,
    })),
    metaCount: 0,
  })

  void debugLog({
    component: 'ChatNavigation',
    action: 'grounding_clarifier_bound_options',
    metadata: {
      messageId,
      candidateCount: candidates.length,
      pendingCount: pendingOptions.length,
    },
  })

  return pendingOptions
}

// =============================================================================
// Pre-Latch Guard (Rule 12)
// =============================================================================

/**
 * Per selection-intent-arbitration-incubation-plan Rule 12:
 * If no latch is active, exactly one fresh visible list-segment candidate group
 * exists, and no active chat option set exists, ordinals default to that visible
 * widget list without clarifying.
 */
function isPreLatchDefault(
  turnSnapshot: import('@/lib/chat/ui-snapshot-builder').TurnSnapshotResult,
  ctx: RoutingDispatcherContext
): boolean {
  // Rule 12: all three conditions must hold
  // 1. No latch (caller already checked)
  // 2. Exactly one fresh visible list-segment candidate group
  const totalListSegments = turnSnapshot.openWidgets.reduce((sum, w) => sum + w.listSegmentCount, 0)
  if (totalListSegments !== 1) return false
  // 3. No active chat option set
  const chatActive = !!(ctx.lastClarification?.options?.length)
  if (chatActive) return false
  return true
}

// =============================================================================
// Unified Routing Dispatcher
// =============================================================================

/**
 * Dispatch user input through the canonical tier-ordered priority chain.
 *
 * Call order (per routing-order-priority-plan.md):
 *
 *   TIER 0 — Stop / Cancel          ─┐
 *   TIER 1 — Return / Resume / Repair ├─ handleClarificationIntercept()
 *   TIER 3 — Clarification (active)  ─┘
 *   TIER 2a — Explicit Command Bypass (clear pending options)
 *   TIER 2b — Cross-Corpus Retrieval
 *   TIER 2c — Panel Disambiguation
 *   TIER 2d — Meta-Explain
 *   TIER 2e — Correction
 *   TIER 2f — Follow-Up
 *   TIER 2g — Preview Shortcut ("show all" expansion)
 *   TIER S  — Suggestion Reject / Affirm (routing-only; sendMessage executes)
 *   TIER 3a — Selection-Only Guard (ordinals/labels on active or recent list)
 *   TIER 3b — Affirmation Without Context ("yes" with no suggestion)
 *   TIER 3c — Re-show Options ("show options", "what were those")
 *   TIER 4  — Known-Noun Commands    (allowlist + fuzzy match)
 *   TIER 5  — Doc Retrieval
 *
 * NOTE: Tiers 0, 1, 3-core are inside handleClarificationIntercept because they
 * share deep state (snapshot, repair memory, stop suppression). Extracting
 * them would require passing 25+ fields with no architectural benefit.
 * The tier order within that function is already correct.
 */
/**
 * Routing dispatch wrapper.
 *
 * Responsibilities (each independently gated):
 * - Phase 1: Durable log (NEXT_PUBLIC_CHAT_ROUTING_OBSERVE_ONLY)
 * - Phase 2b: Memory read before tier chain (NEXT_PUBLIC_CHAT_ROUTING_MEMORY_READ)
 * - Phase 2a: Memory write build after tier chain (NEXT_PUBLIC_CHAT_ROUTING_MEMORY_WRITE)
 *
 * Phase 2 flags are independent of Phase 1. Memory read/write work even when
 * durable logging is off.
 *
 * Logging contract:
 * - Best-effort, not guaranteed. Fail-open writers may drop rows on timeout or error.
 * - Log unit: one row per routing decision. A memory-read early return skips
 *   Phase 1 logging; deferred _pendingMemoryLog fires after commit-point instead.
 *   If both paths somehow attempt to log the same turn, the interaction_id
 *   dedupe constraint (ON CONFLICT DO NOTHING) prevents duplicates.
 */
export async function dispatchRouting(
  ctx: RoutingDispatcherContext
): Promise<RoutingDispatcherResult> {
  const phase1Enabled = process.env.NEXT_PUBLIC_CHAT_ROUTING_OBSERVE_ONLY === 'true'
  const memoryReadEnabled = process.env.NEXT_PUBLIC_CHAT_ROUTING_MEMORY_READ === 'true'
  const memoryWriteEnabled = process.env.NEXT_PUBLIC_CHAT_ROUTING_MEMORY_WRITE === 'true'
  const shadowEnabled = process.env.NEXT_PUBLIC_STAGE6_SHADOW_ENABLED === 'true'

  // Fast path: when ALL instrumentation is disabled, skip wrapper overhead entirely.
  // Stage 6 shadow must also keep the wrapper active — the content-intent block (6x.3)
  // lives in the wrapper region and would be bypassed without this check.
  if (!phase1Enabled && !memoryReadEnabled && !memoryWriteEnabled && !shadowEnabled) {
    return dispatchRoutingInner(ctx)
  }

  const turnSnapshotForLog = buildTurnSnapshot({})

  // ---------------------------------------------------------------------------
  // Phase 5: Pending write promotion / correction suppression
  // On each new user turn, check if a pending Phase 5 exemplar write exists.
  // Promote (write) if input is NOT a correction; drop if it IS a correction.
  // ---------------------------------------------------------------------------
  const hintReadEnabled = process.env.NEXT_PUBLIC_CHAT_ROUTING_MEMORY_HINT_READ === 'true'
  if (ctx.pendingPhase5Write) {
    if (isCorrectionPhrase(ctx.trimmedInput)) {
      // User corrected previous turn — drop the pending exemplar
      ctx.setPendingPhase5Write(null)
    } else {
      // Non-correction follow-up — promote the pending exemplar
      const pending = ctx.pendingPhase5Write
      ctx.setPendingPhase5Write(null)
      void recordMemoryEntry(pending.payload).catch(() => {})
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 2b: Exact memory lookup (Lane B1) — before tier chain
  // If a valid memory match is found, return early without calling dispatchRoutingInner.
  // This prevents double-logging (Gate 6): either memory path logs OR Phase 1 wrapper logs.
  //
  // Guard: skip B1 when a selection context is active AND the input looks like
  // a selection (ordinal, short label) rather than a new command. Ordinals
  // ("2", "first") belong to the clarification intercept (Tier 1d) or widget
  // resolver. B1 replay would bypass state cleanup and selection correlation.
  // However, full commands like "open links panel b" must still reach B1 even
  // when widgetSelectionContext persists (TTL=2 turns from a prior clarifier).
  // The looksLikeNewCommand escape (ACTION_VERB_PATTERN + !isSelectionOnly)
  // lets commands through while blocking bare ordinals.
  // ---------------------------------------------------------------------------
  const hasActiveSelectionContext = !!ctx.lastClarification || !!ctx.widgetSelectionContext
  const inputIsSelectionLike = isSelectionLike(ctx.trimmedInput)
  const b1InputLooksLikeNewCommand = ACTION_VERB_PATTERN.test(ctx.trimmedInput)
    && !isSelectionOnly(ctx.trimmedInput, 10, [], 'embedded').isSelection
  const shouldSkipB1ForSelection = hasActiveSelectionContext && inputIsSelectionLike && !b1InputLooksLikeNewCommand

  // Phase 5: compute shared replay snapshot from live UI state.
  // Used by BOTH B1 exact lookup AND Phase 5 navigation writeback.
  // Computed unconditionally — not gated by memoryReadEnabled or B1 execution.
  const isLatchEnabledForSnapshot = process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 === 'true'
  const phase5ReplaySnapshot = buildContextSnapshot({
    openWidgetCount: turnSnapshotForLog.openWidgets.length,
    pendingOptionsCount: ctx.pendingOptions.length,
    activeOptionSetId: ctx.activeOptionSetId,
    hasLastClarification: ctx.lastClarification !== null,
    hasLastSuggestion: ctx.lastSuggestion !== null,
    latchEnabled: isLatchEnabledForSnapshot,
    messageCount: ctx.messages.length,
  })

  if (memoryReadEnabled && !shouldSkipB1ForSelection) {
    try {
      // B1 uses the shared replay snapshot directly — no recomputation
      const lookupSnapshot = phase5ReplaySnapshot

      // Phase 5: use navigation-specific minimal fingerprint for action commands and home imperatives
      const HOME_NAV_FOR_B1 = /\b(go\s+(to\s+)?home|take\s+me\s+home|return\s+home|back\s+home)\b/i
      const isNavReplayMode = isActionNavigationCommand(ctx.trimmedInput) || HOME_NAV_FOR_B1.test(ctx.trimmedInput)

      const memoryResult = await lookupExactMemory({
        raw_query_text: ctx.trimmedInput,
        context_snapshot: lookupSnapshot,
        navigation_replay_mode: isNavReplayMode || undefined,
      })

      if (memoryResult) {
        // First validation: reject obviously stale candidates early (concrete ID checks)
        const validation = validateMemoryCandidate(memoryResult, turnSnapshotForLog, ctx.uiContext?.dashboard?.visibleWidgets)
        if (validation.valid) {
          const defaultResult: RoutingDispatcherResult = {
            handled: false,
            clarificationCleared: false,
            isNewQuestionOrCommandDetected: false,
            classifierCalled: false,
            classifierTimeout: false,
            classifierError: false,
            isFollowUp: false,
          }
          const memoryAction = buildResultFromMemory(memoryResult, defaultResult) as RoutingDispatcherResult | null
          if (memoryAction) {
            // Gate 6: Defer durable log — attach as pending, sendMessage fires after commit-point
            try {
              memoryAction._pendingMemoryLog = buildRoutingLogPayloadFromMemory(ctx, memoryAction, turnSnapshotForLog)
            } catch { /* fail-open */ }

            // Gate 8: Build writeback payload for success_count increment
            if (memoryWriteEnabled) {
              try {
                memoryAction._pendingMemoryWrite = buildMemoryWritePayload(ctx, memoryAction, turnSnapshotForLog) ?? undefined
              } catch { /* fail-open */ }
            }

            // Return with _memoryCandidate + _pendingMemoryLog + _pendingMemoryWrite attached
            // sendMessage() does commit-point revalidation (Gate 1) then fires log + write
            return memoryAction
          }
        }
      }
    } catch {
      // Memory lookup failed: fall through to normal tier chain (fail-open)
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Semantic memory lookup (Lane B2) — after B1 miss, before tier chain
  // IMPORTANT: B2 does NOT return handled=true. It attaches validated candidates
  // as hints for Lane D (LLM fallthrough). Semantic retrieval never direct-executes.
  // ---------------------------------------------------------------------------
  const semanticReadEnabled = process.env.NEXT_PUBLIC_CHAT_ROUTING_MEMORY_SEMANTIC_READ === 'true'
  let semanticCandidatesForLaneD: SemanticCandidate[] | undefined
  let b2CurrentContextFingerprint: string | undefined
  let b2LookupStatus: 'ok' | 'empty' | 'timeout' | 'error' | 'disabled' | undefined

  // B2 telemetry: track every B2 outcome (only when B2-eligible: memoryReadEnabled=true)
  let b2Telemetry: { status: string; rawCount?: number; validatedCount?: number; topScore?: number; latencyMs?: number } | undefined

  // When memory read is enabled but semantic read is off, B2 is eligible but skipped
  if (memoryReadEnabled && !semanticReadEnabled) {
    b2Telemetry = { status: 'skipped' }
  }

  if (memoryReadEnabled && semanticReadEnabled) {
    try {
      const isLatchEnabled = process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 === 'true'
      const lookupSnapshot = buildContextSnapshot({
        openWidgetCount: turnSnapshotForLog.openWidgets.length,
        pendingOptionsCount: ctx.pendingOptions.length,
        activeOptionSetId: ctx.activeOptionSetId,
        hasLastClarification: ctx.lastClarification !== null,
        hasLastSuggestion: ctx.lastSuggestion !== null,
        latchEnabled: isLatchEnabled,
        messageCount: ctx.messages.length,
      })

      const lookupResult: SemanticLookupResult = await lookupSemanticMemory({
        raw_query_text: ctx.trimmedInput,
        context_snapshot: lookupSnapshot,
      })
      b2LookupStatus = lookupResult.status
      b2CurrentContextFingerprint = lookupResult.currentContextFingerprint

      // Map structured result to b2Telemetry
      if (lookupResult.status === 'ok') {
        const rawCount = lookupResult.candidates.length
        // Validate each candidate against live UI snapshot (Gate 3)
        const validatedCandidates = lookupResult.candidates.filter(c => {
          const v = validateMemoryCandidate(c, turnSnapshotForLog, ctx.uiContext?.dashboard?.visibleWidgets)
          return v.valid
        })
        const validatedCount = validatedCandidates.length
        const topScore = validatedCandidates.length > 0
          ? validatedCandidates[0].similarity_score
          : (lookupResult.candidates.length > 0 ? lookupResult.candidates[0].similarity_score : undefined)

        b2Telemetry = { status: 'candidates_found', rawCount, validatedCount, topScore, latencyMs: lookupResult.latencyMs }

        if (validatedCount > 0) {
          semanticCandidatesForLaneD = validatedCandidates
        }
      } else if (lookupResult.status === 'empty') {
        b2Telemetry = { status: 'no_candidates', latencyMs: lookupResult.latencyMs }
      } else if (lookupResult.status === 'timeout' || lookupResult.status === 'error') {
        b2Telemetry = { status: 'timeout_or_error', latencyMs: lookupResult.latencyMs }
      } else if (lookupResult.status === 'disabled') {
        b2Telemetry = { status: 'skipped', latencyMs: 0 }
      }
    } catch {
      // Fail-open: no semantic candidates, tier chain runs normally
      b2Telemetry = { status: 'timeout_or_error' }
    }
  }

  // ---------------------------------------------------------------------------
  // Content-intent check (Stage 6x.3, Step 4)
  // Runs before Stage 5 replay and Stage 4 LLM. Shadow-only in Step 4;
  // enforcement deferred to 6x.5 (UI answer path).
  // The flag suppresses Stage 5 replay and later generic S6 triggers.
  // Gated on shadow flag: when shadow is off, the classifier does not run
  // and routing behaves identically to pre-Step-4 code.
  // ---------------------------------------------------------------------------
  let contentIntentMatchedThisTurn = false
  // 6x.7 Phase A: resolver telemetry hoisted to outer scope so common log path can merge it
  let resolverTelemetryForLog: Record<string, unknown> | null = null

  if (process.env.NEXT_PUBLIC_STAGE6_SHADOW_ENABLED === 'true') {
    const activeNoteId = ctx.uiContext?.workspace?.activeNoteId ?? null
    const activeNote = activeNoteId
      ? ctx.uiContext?.workspace?.openNotes?.find(n => n.id === activeNoteId)
      : null
    const noteAnchor: NoteAnchorContext = {
      activeNoteItemId: activeNoteId,
      activeNoteTitle: activeNote?.title ?? null,
    }

    const contentResult = classifyContentIntent(ctx.trimmedInput, noteAnchor)
    if (contentResult.isContentIntent && contentResult.noteAnchor) {
      const s6SessionId = getRoutingLogSessionId()
      const s6TurnIndex = ctx.messages.filter(m => m.role === 'user').length
      const s6LastMsg = [...ctx.messages].reverse().find(m => m.role === 'user')
      const s6InteractionId = s6LastMsg?.id ?? deriveFallbackInteractionId(s6SessionId, s6TurnIndex, ctx.trimmedInput)
      const s6Params = {
        userInput: ctx.trimmedInput,
        groundingCandidates: [] as import('./stage6-tool-contracts').S6GroundingCandidate[],
        escalationReason: 'content_intent' as const,
        interactionId: s6InteractionId,
        sessionId: s6SessionId,
        turnIndex: s6TurnIndex,
        contentContext: {
          noteItemId: contentResult.noteAnchor.itemId,
          noteTitle: contentResult.noteAnchor.title,
          anchorSource: contentResult.noteAnchor.source,
          intentType: contentResult.intentType!,
        },
      }
      // Single-execution rule (6x.5): the loop runs exactly once per content-intent turn.
      // The result is used for both surfacing and durable logging. No shadow rerun.
      try {
        const loopResult = await executeS6Loop(s6Params)
        if (loopResult) {
          // Always write durable log from the awaited result (6x.5 single-execution)
          void writeDurableEnforcementLog(s6Params, loopResult)

          if (loopResult.outcome === 'content_answered' && loopResult.contentAnswerResult?.answerText) {
            // Strip citation markers (e.g., "(c0_s0, c0_s1)") — meaningless to users (6x.5)
            let displayText = loopResult.contentAnswerResult.answerText
              .replace(/\s*\((?:based on\s+)?c\d+_s\d+(?:,\s*c\d+_s\d+)*\)\.?/gi, '')
              .trim()

            // Append truncation warning if snippets were partial (6x.5)
            if (loopResult.contentAnswerResult.contentTruncated) {
              displayText += '\n\n_This answer is based on partial note content._'
            }

            const assistantMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: displayText,
              timestamp: new Date(),
              isError: false,
              // "Show more" button — opens full note in View Panel (gated by contentTruncated)
              itemId: s6Params.contentContext?.noteItemId,
              itemName: s6Params.contentContext?.noteTitle ?? undefined,
              corpus: 'notes',
              contentTruncated: loopResult.contentAnswerResult.contentTruncated ?? false,
              // Cited snippet evidence for inline citation display (6x.6)
              citedSnippets: loopResult.contentAnswerResult.citedSnippets,
            }
            ctx.addMessage(assistantMessage, { tierLabel: 'content_intent_answered', provenance: 'content_answered' })
            ctx.setIsLoading(false)

            void debugLog({
              component: 'ChatNavigation',
              action: 'content_intent_answered',
              metadata: {
                noteItemId: contentResult.noteAnchor!.itemId,
                intentType: contentResult.intentType,
                citedCount: loopResult.contentAnswerResult.citedSnippetIds?.length ?? 0,
                citationsAutofilled: loopResult.telemetry.s6_citations_autofilled ?? false,
                contentTruncated: loopResult.contentAnswerResult.contentTruncated ?? false,
              },
            })

            return {
              handled: true,
              handledByTier: 6,
              tierLabel: 'content_intent_answered',
              clarificationCleared: false,
              isNewQuestionOrCommandDetected: false,
              classifierCalled: false,
              classifierTimeout: false,
              classifierError: false,
              isFollowUp: false,
              _devProvenanceHint: 'content_answered',
            }
          }
        }
      } catch (err) {
        console.warn('[routing-dispatcher] Content-intent loop failed:', (err as Error).message)
      }

      // Loop didn't produce an answer (abort/timeout/error) — durable row already written above.
      // Fall through to normal routing. Do NOT rerun via runS6ShadowLoop.
      contentIntentMatchedThisTurn = true
    } else if ((() => {
      // 6x.8 Phase 4: cross-surface arbiter eligibility — note + panel + workspace + dashboard
      const NOTE_REFERENCE_PATTERN = /\b(this|that|the|my|which|what|any|a)\s+(note|document|page)\b/i
      const noteRefDetected = NOTE_REFERENCE_PATTERN.test(ctx.trimmedInput.toLowerCase())
      const isNoteRelated = !!activeNoteId || noteRefDetected
      const hasVisiblePanels = (ctx.uiContext?.dashboard?.visibleWidgets?.length ?? 0) > 0
      const hasActiveWorkspace = !!ctx.uiContext?.workspace?.workspaceName
      const isDashboardActive = ctx.uiContext?.mode === 'dashboard'
      const hasSurfaceContext = isNoteRelated || hasVisiblePanels || hasActiveWorkspace || isDashboardActive
      // Arbiter runs for everything except:
      // 1. Action/imperative navigation commands (open/show/go to/switch to)
      // 2. History_info queries (from committed session state, not cross-surface UI)
      // 3. Home-navigation imperatives (take me home, return home, back home)
      //    These are safe to exclude because HOME_NAV_PATTERN is narrow and unambiguous.
      //    We do NOT use the broad detectHintScope('navigation') here because it also matches
      //    state-info queries like "which panel is open?" via BROAD_NAV_ACTION + TARGET_FAMILY.
      const isActionNav = isActionNavigationCommand(ctx.trimmedInput)
      const isHistoryInfo = detectHintScope(ctx.trimmedInput) === 'history_info'
      const HOME_NAV_BYPASS = /\b(go\s+(to\s+)?home|take\s+me\s+home|return\s+home|back\s+home)\b/i
      const isHomeNav = HOME_NAV_BYPASS.test(ctx.trimmedInput)
      return hasSurfaceContext && !contentResult.isContentIntent && !isArbiterHardExcluded(ctx.trimmedInput) && !isActionNav && !isHistoryInfo && !isHomeNav
    })()) {
      // ── 6x.8 Phase 4: Cross-surface arbiter for uncertain turns across surfaces ──
      const NOTE_REFERENCE_PATTERN = /\b(this|that|the|my|which|what|any|a)\s+(note|document|page)\b/i
      const noteRefDetected = NOTE_REFERENCE_PATTERN.test(ctx.trimmedInput.toLowerCase())

      // Build bounded recent-turn context (6x.8 Phase 3b)
      let recentRoutingContext: import('./cross-surface-arbiter').RecentRoutingContext | undefined
      const prevMeta = ctx.previousRoutingMetadata
      if (prevMeta) {
        const userMsgs = ctx.messages.filter(m => m.role === 'user')
        const prevUserMsg = userMsgs.length >= 2 ? userMsgs[userMsgs.length - 2] : undefined
        const assistantMsgs = ctx.messages.filter(m => m.role === 'assistant')
        const latestAssistant = assistantMsgs[assistantMsgs.length - 1]
        const isAligned = prevMeta.assistantMessageId && latestAssistant?.id === prevMeta.assistantMessageId
        if (isAligned) {
          recentRoutingContext = {
            lastUserMessage: prevUserMsg?.content.slice(0, 160),
            lastAssistantMessage: latestAssistant.content
              .replace(/\s*_This answer is based on partial note content\._\s*/g, '')
              .slice(0, 200),
            lastResolvedSurface: prevMeta.surface,
            lastResolvedIntentFamily: prevMeta.intentFamily,
            lastTurnOutcome: prevMeta.turnOutcome,
          }
        }
      }

      // Phase 4: pass cross-surface context
      const visiblePanelTitles = (ctx.uiContext?.dashboard?.visibleWidgets ?? []).map((w: any) => w.title)

      const arbiterResult = await callCrossSurfaceArbiter({
        userInput: ctx.trimmedInput,
        activeNote: activeNoteId
          ? { itemId: activeNoteId, title: activeNote?.title ?? null }
          : undefined,
        noteReferenceDetected: noteRefDetected,
        recentRoutingContext,
        visiblePanels: visiblePanelTitles.length > 0 ? visiblePanelTitles : undefined,
        workspaceName: ctx.uiContext?.workspace?.workspaceName ?? undefined,
        entryName: (ctx.uiContext?.dashboard as any)?.entryName ?? undefined,
      })

      // Telemetry: compute effective result
      const rawDecision = arbiterResult.response
      const confidence = rawDecision?.confidence ?? 0
      let effectiveResult: string
      if (!arbiterResult.success) {
        effectiveResult = arbiterResult.error?.includes('timeout') ? 'timeout' : 'error'
      } else if (confidence < 0.75) {
        effectiveResult = 'ambiguous'
      } else {
        effectiveResult = `${rawDecision!.surface}:${rawDecision!.intentFamily}`
      }

      const arbiterTelemetry = {
        cross_surface_arbiter_called: true as const,
        cross_surface_arbiter_surface: rawDecision?.surface,
        cross_surface_arbiter_intent: rawDecision?.intentFamily,
        cross_surface_arbiter_confidence: confidence,
        cross_surface_arbiter_result: effectiveResult,
      }
      resolverTelemetryForLog = arbiterTelemetry

      // Post-arbiter signal correction: when the user explicitly named "note/document/page"
      // (noteRefDetected=true) but the arbiter classified a different surface for state_info,
      // override to note — the user's explicit surface reference takes precedence.
      if (noteRefDetected && rawDecision && rawDecision.intentFamily === 'state_info' && rawDecision.surface !== 'note') {
        rawDecision.surface = 'note'
      }

      // Post-arbiter correction: when input references "panel/drawer" + "open/opened"
      // but arbiter returned non-panel_widget state_info (typically dashboard), override
      // to panel_widget so the open/visible discriminator fires.
      if (isPanelOpenQuery(ctx.trimmedInput) && rawDecision && rawDecision.intentFamily === 'state_info' && rawDecision.surface !== 'panel_widget') {
        rawDecision.surface = 'panel_widget'
      }

      // Migrated-family gate
      const MIGRATED_PAIRS = new Set([
        'note:read_content', 'note:state_info',
        'panel_widget:state_info', 'workspace:state_info', 'dashboard:state_info',
      ])
      const pairKey = `${rawDecision?.surface}:${rawDecision?.intentFamily}`
      const isMigrated = arbiterResult.success && confidence >= 0.75 && MIGRATED_PAIRS.has(pairKey)
      const isMigratedLowConfidence = arbiterResult.success && confidence < 0.75 && MIGRATED_PAIRS.has(pairKey)

      // ── Path 1: note.read_content (migrated, above threshold) ──
      if (isMigrated && rawDecision!.intentFamily === 'read_content') {
        if (!activeNoteId) {
          // Note-reference detected but no active note — cannot enter Stage 6
          contentIntentMatchedThisTurn = true
          const noNoteMsg: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: 'No note is currently open. Open a note first to read its content.',
            timestamp: new Date(),
            isError: false,
          }
          ctx.addMessage(noNoteMsg, { tierLabel: 'arbiter_note_read_no_anchor', provenance: 'safe_clarifier' })
          ctx.setIsLoading(false)
          const noNoteResult: RoutingDispatcherResult = {
            handled: true, handledByTier: 6, tierLabel: 'arbiter_note_read_no_anchor',
            clarificationCleared: false, isNewQuestionOrCommandDetected: false,
            classifierCalled: false, classifierTimeout: false, classifierError: false, isFollowUp: false,
            _devProvenanceHint: 'safe_clarifier',
          }
          const noNotePayload = buildRoutingLogPayload(ctx, noNoteResult, turnSnapshotForLog)
          Object.assign(noNotePayload, arbiterTelemetry)
          void recordRoutingLog(noNotePayload)
          return noNoteResult
        }

        contentIntentMatchedThisTurn = true
        const s6SessionId = getRoutingLogSessionId()
        const s6TurnIndex = ctx.messages.filter(m => m.role === 'user').length
        const s6LastMsg = [...ctx.messages].reverse().find(m => m.role === 'user')
        const s6InteractionId = s6LastMsg?.id ?? deriveFallbackInteractionId(s6SessionId, s6TurnIndex, ctx.trimmedInput)
        const s6Params = {
          userInput: ctx.trimmedInput,
          groundingCandidates: [] as import('./stage6-tool-contracts').S6GroundingCandidate[],
          escalationReason: 'content_intent' as const,
          interactionId: s6InteractionId,
          sessionId: s6SessionId,
          turnIndex: s6TurnIndex,
          contentContext: {
            noteItemId: activeNoteId,
            noteTitle: activeNote?.title ?? 'Untitled',
            anchorSource: 'active_widget' as const,
            intentType: rawDecision!.intentSubtype ?? 'question',
          },
        }

        try {
          const loopResult = await executeS6Loop(s6Params)
          if (loopResult) {
            void writeDurableEnforcementLog(s6Params, loopResult, arbiterTelemetry)
            if (loopResult.outcome === 'content_answered' && loopResult.contentAnswerResult?.answerText) {
              let displayText = loopResult.contentAnswerResult.answerText
                .replace(/\s*\((?:based on\s+)?c\d+_s\d+(?:,\s*c\d+_s\d+)*\)\.?/gi, '')
                .trim()
              if (loopResult.contentAnswerResult.contentTruncated) {
                displayText += '\n\n_This answer is based on partial note content._'
              }
              const assistantMessage: ChatMessage = {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                content: displayText,
                timestamp: new Date(),
                isError: false,
                itemId: s6Params.contentContext?.noteItemId,
                itemName: s6Params.contentContext?.noteTitle ?? undefined,
                corpus: 'notes',
                contentTruncated: loopResult.contentAnswerResult.contentTruncated ?? false,
                citedSnippets: loopResult.contentAnswerResult.citedSnippets,
              }
              ctx.addMessage(assistantMessage, { tierLabel: 'arbiter_content_answered', provenance: 'content_answered' })
              ctx.setIsLoading(false)
              return {
                handled: true, handledByTier: 6, tierLabel: 'arbiter_content_answered',
                clarificationCleared: false, isNewQuestionOrCommandDetected: false,
                classifierCalled: false, classifierTimeout: false, classifierError: false, isFollowUp: false,
                _devProvenanceHint: 'content_answered',
              }
            }
          }
        } catch (err) {
          console.warn('[routing-dispatcher] Arbiter content loop failed:', (err as Error).message)
        }

        // Bounded fallback: arbiter classified note.read_content but Stage 6 did not produce content_answered.
        // Do NOT fall through to legacy routing — the arbiter already knew the intent.
        const readFallbackMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: "I couldn't read enough of the current note to answer that. Try asking a more specific question about the note.",
          timestamp: new Date(),
          isError: false,
        }
        ctx.addMessage(readFallbackMsg, { tierLabel: 'arbiter_read_content_fallback', provenance: 'safe_clarifier' })
        ctx.setIsLoading(false)
        const readFallbackResult: RoutingDispatcherResult = {
          handled: true, handledByTier: 6, tierLabel: 'arbiter_read_content_fallback',
          clarificationCleared: false, isNewQuestionOrCommandDetected: false,
          classifierCalled: false, classifierTimeout: false, classifierError: false, isFollowUp: false,
          _devProvenanceHint: 'safe_clarifier',
        }
        const readFallbackPayload = buildRoutingLogPayload(ctx, readFallbackResult, turnSnapshotForLog)
        Object.assign(readFallbackPayload, arbiterTelemetry)
        void recordRoutingLog(readFallbackPayload)
        return readFallbackResult

      // ── Path 2: note.state_info (migrated, above threshold) ──
      } else if (isMigrated && rawDecision!.intentFamily === 'state_info' && rawDecision!.surface === 'note') {
        contentIntentMatchedThisTurn = true
        const stateAnswer = resolveNoteStateInfo(ctx.uiContext ?? {})
        const stateMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: stateAnswer,
          timestamp: new Date(),
          isError: false,
        }
        ctx.addMessage(stateMsg, { tierLabel: 'arbiter_note_state_info', provenance: 'deterministic' })
        ctx.setIsLoading(false)
        const stateResult: RoutingDispatcherResult = {
          handled: true, handledByTier: 6, tierLabel: 'arbiter_note_state_info',
          clarificationCleared: false, isNewQuestionOrCommandDetected: false,
          classifierCalled: false, classifierTimeout: false, classifierError: false, isFollowUp: false,
          _devProvenanceHint: 'deterministic',
        }
        const statePayload = buildRoutingLogPayload(ctx, stateResult, turnSnapshotForLog)
        Object.assign(statePayload, arbiterTelemetry)
        void recordRoutingLog(statePayload)
        return stateResult

      // ── Phase 4: panel_widget.state_info (migrated) ──
      } else if (isMigrated && rawDecision!.intentFamily === 'state_info' && rawDecision!.surface === 'panel_widget') {
        contentIntentMatchedThisTurn = true
        const answer = isPanelOpenQuery(ctx.trimmedInput)
          ? resolvePanelOpenStateInfo(ctx.uiContext ?? {})
          : resolvePanelWidgetStateInfo(ctx.uiContext ?? {})
        const panelStateMsg: ChatMessage = {
          id: `assistant-${Date.now()}`, role: 'assistant', content: answer, timestamp: new Date(), isError: false,
        }
        ctx.addMessage(panelStateMsg, { tierLabel: 'arbiter_panel_widget_state_info', provenance: 'deterministic' })
        ctx.setIsLoading(false)
        const panelStateResult: RoutingDispatcherResult = {
          handled: true, handledByTier: 6, tierLabel: 'arbiter_panel_widget_state_info',
          clarificationCleared: false, isNewQuestionOrCommandDetected: false,
          classifierCalled: false, classifierTimeout: false, classifierError: false, isFollowUp: false,
          _devProvenanceHint: 'deterministic',
        }
        const panelStatePayload = buildRoutingLogPayload(ctx, panelStateResult, turnSnapshotForLog)
        Object.assign(panelStatePayload, arbiterTelemetry)
        void recordRoutingLog(panelStatePayload)
        return panelStateResult

      // ── Phase 4: workspace.state_info (migrated) ──
      } else if (isMigrated && rawDecision!.intentFamily === 'state_info' && rawDecision!.surface === 'workspace') {
        contentIntentMatchedThisTurn = true
        const answer = resolveWorkspaceStateInfo(ctx.uiContext ?? {})
        const wsStateMsg: ChatMessage = {
          id: `assistant-${Date.now()}`, role: 'assistant', content: answer, timestamp: new Date(), isError: false,
        }
        ctx.addMessage(wsStateMsg, { tierLabel: 'arbiter_workspace_state_info', provenance: 'deterministic' })
        ctx.setIsLoading(false)
        const wsStateResult: RoutingDispatcherResult = {
          handled: true, handledByTier: 6, tierLabel: 'arbiter_workspace_state_info',
          clarificationCleared: false, isNewQuestionOrCommandDetected: false,
          classifierCalled: false, classifierTimeout: false, classifierError: false, isFollowUp: false,
          _devProvenanceHint: 'deterministic',
        }
        const wsStatePayload = buildRoutingLogPayload(ctx, wsStateResult, turnSnapshotForLog)
        Object.assign(wsStatePayload, arbiterTelemetry)
        void recordRoutingLog(wsStatePayload)
        return wsStateResult

      // ── Phase 4: dashboard.state_info (migrated) ──
      } else if (isMigrated && rawDecision!.intentFamily === 'state_info' && rawDecision!.surface === 'dashboard') {
        contentIntentMatchedThisTurn = true
        const answer = resolveDashboardStateInfo(ctx.uiContext ?? {})
        const dashStateMsg: ChatMessage = {
          id: `assistant-${Date.now()}`, role: 'assistant', content: answer, timestamp: new Date(), isError: false,
        }
        ctx.addMessage(dashStateMsg, { tierLabel: 'arbiter_dashboard_state_info', provenance: 'deterministic' })
        ctx.setIsLoading(false)
        const dashStateResult: RoutingDispatcherResult = {
          handled: true, handledByTier: 6, tierLabel: 'arbiter_dashboard_state_info',
          clarificationCleared: false, isNewQuestionOrCommandDetected: false,
          classifierCalled: false, classifierTimeout: false, classifierError: false, isFollowUp: false,
          _devProvenanceHint: 'deterministic',
        }
        const dashStatePayload = buildRoutingLogPayload(ctx, dashStateResult, turnSnapshotForLog)
        Object.assign(dashStatePayload, arbiterTelemetry)
        void recordRoutingLog(dashStatePayload)
        return dashStateResult

      // ── Phase 4: non-note read_content → bounded not-supported ──
      } else if (arbiterResult.success && rawDecision?.intentFamily === 'read_content' && rawDecision?.surface !== 'note') {
        contentIntentMatchedThisTurn = true
        const nonNoteReadMsg: ChatMessage = {
          id: `assistant-${Date.now()}`, role: 'assistant',
          content: 'Reading content is currently available for notes only.',
          timestamp: new Date(), isError: false,
        }
        ctx.addMessage(nonNoteReadMsg, { tierLabel: 'arbiter_non_note_read_not_supported', provenance: 'safe_clarifier' })
        ctx.setIsLoading(false)
        const nonNoteReadResult: RoutingDispatcherResult = {
          handled: true, handledByTier: 6, tierLabel: 'arbiter_non_note_read_not_supported',
          clarificationCleared: false, isNewQuestionOrCommandDetected: false,
          classifierCalled: false, classifierTimeout: false, classifierError: false, isFollowUp: false,
          _devProvenanceHint: 'safe_clarifier',
        }
        const nonNoteReadPayload = buildRoutingLogPayload(ctx, nonNoteReadResult, turnSnapshotForLog)
        Object.assign(nonNoteReadPayload, arbiterTelemetry)
        void recordRoutingLog(nonNoteReadPayload)
        return nonNoteReadResult

      // ── Mutate: immediate not-supported (per Phase 2 contract) ──
      } else if (arbiterResult.success && rawDecision?.intentFamily === 'mutate') {
        contentIntentMatchedThisTurn = true
        const mutateMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'I can help with reading and navigating, but I can\'t modify content yet.',
          timestamp: new Date(),
          isError: false,
        }
        ctx.addMessage(mutateMsg, { tierLabel: 'arbiter_mutate_not_supported', provenance: 'safe_clarifier' })
        ctx.setIsLoading(false)
        const mutateResult: RoutingDispatcherResult = {
          handled: true, handledByTier: 6, tierLabel: 'arbiter_mutate_not_supported',
          clarificationCleared: false, isNewQuestionOrCommandDetected: false,
          classifierCalled: false, classifierTimeout: false, classifierError: false, isFollowUp: false,
          _devProvenanceHint: 'safe_clarifier',
        }
        const mutatePayload = buildRoutingLogPayload(ctx, mutateResult, turnSnapshotForLog)
        Object.assign(mutatePayload, arbiterTelemetry)
        void recordRoutingLog(mutatePayload)
        return mutateResult

      // ── Path 3: Non-migrated pair above threshold → fall through ──
      } else if (arbiterResult.success && confidence >= 0.75 && !isMigrated) {
        // Arbiter telemetry reaches common log via resolverTelemetryForLog

      // ── Path 4a: Migrated pair below threshold / ambiguous intent / unknown surface / error → clarifier ──
      } else if (isMigratedLowConfidence || (!arbiterResult.success) || rawDecision?.surface === 'unknown' || rawDecision?.intentFamily === 'ambiguous') {
        contentIntentMatchedThisTurn = true
        const clarifierMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: "I'm not sure what you're referring to. Could you be more specific?",
          timestamp: new Date(),
          isError: false,
        }
        ctx.addMessage(clarifierMsg, { tierLabel: 'arbiter_ambiguous', provenance: 'safe_clarifier' })
        ctx.setIsLoading(false)
        const clarifierResult: RoutingDispatcherResult = {
          handled: true, handledByTier: 6, tierLabel: 'arbiter_ambiguous',
          clarificationCleared: false, isNewQuestionOrCommandDetected: false,
          classifierCalled: false, classifierTimeout: false, classifierError: false, isFollowUp: false,
          _devProvenanceHint: 'safe_clarifier',
        }
        const clarifierPayload = buildRoutingLogPayload(ctx, clarifierResult, turnSnapshotForLog)
        Object.assign(clarifierPayload, arbiterTelemetry)
        void recordRoutingLog(clarifierPayload)
        return clarifierResult

      // ── Path 4b: Non-migrated pair below threshold → fall through ──
      } else {
        // Fall through to existing routing. Arbiter telemetry via resolverTelemetryForLog.
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Stage 5: Semantic resolution reuse
  // Runs after B2 lookup, before tier chain. Evaluates whether B2 candidates
  // qualify for auto-replay.
  // - Shadow mode (default): log what would happen, always fall through
  // - Enforcement mode (NEXT_PUBLIC_STAGE5_RESOLUTION_REUSE_ENABLED): actually replay
  //
  // Guard: skip Stage 5 when active selection context + selection-like input.
  // Same protection as B1 (line 1302). Ordinals like "2" are context-sensitive
  // and must not replay cross-context semantic matches.
  // Also skip when content-intent matched (6x.3) — navigation replay must not
  // hijack content queries.
  // ---------------------------------------------------------------------------
  let s5Telemetry: import('./routing-log/stage5-evaluator').S5EvaluationResult | undefined

  if (semanticCandidatesForLaneD && semanticCandidatesForLaneD.length > 0 && !shouldSkipB1ForSelection && !contentIntentMatchedThisTurn) {
    try {
      s5Telemetry = evaluateStage5Replay(semanticCandidatesForLaneD, turnSnapshotForLog, b2CurrentContextFingerprint)

      // Slice 2: enforcement — actually replay when eligible and flag is on
      const s5EnforcementEnabled = process.env.NEXT_PUBLIC_STAGE5_RESOLUTION_REUSE_ENABLED === 'true'
      if (s5EnforcementEnabled && s5Telemetry.validationResult === 'shadow_replay_eligible' && s5Telemetry.winnerCandidate) {
        const s5DefaultResult: RoutingDispatcherResult = {
          handled: false,
          clarificationCleared: false,
          isNewQuestionOrCommandDetected: false,
          classifierCalled: false,
          classifierTimeout: false,
          classifierError: false,
          isFollowUp: false,
        }
        const replayResult = buildResultFromMemory(s5Telemetry.winnerCandidate, s5DefaultResult) as RoutingDispatcherResult | null
        if (replayResult) {
          // Override provenance for semantic memory (distinct from B1 memory_exact)
          replayResult.tierLabel = `memory_semantic:${s5Telemetry.winnerCandidate.intent_id}`
          replayResult._devProvenanceHint = 'memory_semantic'

          // Update telemetry to reflect actual execution
          s5Telemetry = { ...s5Telemetry, validationResult: 'replay_executed' }
          replayResult._s5Telemetry = s5Telemetry

          // Build log payload (includes s5_* + B2 telemetry inline)
          try {
            const logPayload = buildRoutingLogPayloadFromSemanticMemory(ctx, replayResult, turnSnapshotForLog, s5Telemetry)
            // Attach B2 telemetry (same finalization as general path)
            if (b2Telemetry) {
              b2Telemetry.status = 'discarded_handled'
              logPayload.b2_status = b2Telemetry.status as RoutingLogPayload['b2_status']
              logPayload.b2_raw_count = b2Telemetry.rawCount
              logPayload.b2_validated_count = b2Telemetry.validatedCount
              logPayload.semantic_top_score = b2Telemetry.topScore ?? logPayload.semantic_top_score
              logPayload.b2_latency_ms = b2Telemetry.latencyMs
            }
            replayResult._pendingMemoryLog = logPayload
            replayResult._routingLogPayload = logPayload
          } catch { /* fail-open: log builder failed */ }

          // Build memory write payload via standard UPSERT (keyed on query_fingerprint).
          // Slice 3a: attach replay_source_row_id so the server can do transactional
          // winner-row increment when the UPSERT writes to a different row.
          if (memoryWriteEnabled) {
            try {
              const writePayload = buildMemoryWritePayload(ctx, replayResult, turnSnapshotForLog)
              if (writePayload && s5Telemetry.winnerCandidate?.matchedRowId) {
                writePayload.replay_source_row_id = s5Telemetry.winnerCandidate.matchedRowId
              }
              replayResult._pendingMemoryWrite = writePayload ?? undefined
            } catch { /* fail-open */ }
          }

          // Early return — sendMessage() handles commit-point revalidation + log + write
          return replayResult
        } else {
          // buildResultFromMemory returned null — downgrade telemetry (safety net)
          s5Telemetry = { ...s5Telemetry, validationResult: 'replay_build_failed', fallbackReason: 'buildResultFromMemory_returned_null' }
        }
      }
    } catch {
      // Stage 5 eval failed — fail-open, no telemetry
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 5: Retrieval-backed semantic hinting
  // Runs AFTER Stage 5 replay did not resolve (if it did, we returned early above).
  // Passes hint candidates to bounded LLM via the normal tier chain.
  // ---------------------------------------------------------------------------
  let phase5HintResult: SemanticHintLookupResult | null = null
  if (hintReadEnabled) {
    const hintScope = detectHintScope(ctx.trimmedInput)
    if (hintScope) {
      try {
        const lookupSnapshot = buildContextSnapshot({
          openWidgetCount: turnSnapshotForLog.openWidgets?.length ?? 0,
          pendingOptionsCount: ctx.pendingOptions?.length ?? 0,
          activeOptionSetId: ctx.activeOptionSetId,
          hasLastClarification: ctx.lastClarification !== null,
          hasLastSuggestion: ctx.lastSuggestion !== null,
          latchEnabled: process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 === 'true',
          messageCount: ctx.messages.length,
        })
        phase5HintResult = await lookupSemanticHints({
          raw_query_text: ctx.trimmedInput,
          context_snapshot: lookupSnapshot,
          intent_scope: hintScope,
        })
      } catch {
        // Fail-open: hint retrieval failed, continue without hints
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 5: pre-tier-chain override for confident v1 hints
  // When Phase 5 has a high-confidence hint for an allowlisted v1 intent,
  // skip the tier chain entirely. B1/B2/Stage 5 already ran and didn't match.
  // The remaining tiers would only produce clarifiers for these unrecognized inputs,
  // and those clarifiers call addMessage() as a side effect that can't be undone.
  // ---------------------------------------------------------------------------
  // V2: expanded to cover all known validated navigation families
  const PHASE5_OVERRIDE_INTENTS = new Set([
    'go_home', 'open_entry', 'open_panel', 'open_workspace',
    'last_action', 'explain_last_action', 'verify_action',
  ])
  let phase5SkippedTierChain = false
  let result: RoutingDispatcherResult | undefined
  let routingError: unknown

  const hintScope = detectHintScope(ctx.trimmedInput)
  const hasConfidentHint = phase5HintResult && phase5HintResult.candidates.length > 0 && (() => {
    const topHint = phase5HintResult.candidates[0]
    const similarityFloor = hintScope === 'navigation' ? 0.85 : 0.80
    return PHASE5_OVERRIDE_INTENTS.has(topHint.intent_id) && topHint.similarity_score >= similarityFloor
  })()

  if (hintScope) {
    // Phase 5 scope detected — skip tier chain, let the navigate API's LLM handle it.
    // Near-tie metadata is preserved in telemetry but does NOT block the LLM fallback.
    // Genuine execution ambiguity (e.g., "budget100" vs "budget100 B") is handled by
    // the resolver/clarifier downstream, not by retrieval-level similarity score proximity.
    phase5SkippedTierChain = true
  }

  // ---------------------------------------------------------------------------
  // Normal tier chain (skipped when Phase 5 override or near-tie clarifier is active)
  // ---------------------------------------------------------------------------
  if (result) {
    // Near-tie clarifier already set result — skip tier chain
  } else if (phase5SkippedTierChain) {
    // Phase 5 override: return handled=false so raw query reaches navigate API.
    // No tier chain runs → no addMessage side effects → no clarifier leakage.
    // Attach hints when available; scope always attached for LLM fallback telemetry.
    const topHint = phase5HintResult?.candidates?.[0]
    result = {
      handled: false,
      clarificationCleared: false,
      isNewQuestionOrCommandDetected: false,
      classifierCalled: false,
      classifierTimeout: false,
      classifierError: false,
      isFollowUp: false,
      _phase5HintIntent: topHint?.intent_id,
      _phase5HintScope: hintScope ?? undefined,
      _phase5HintFromSeed: topHint?.from_curated_seed,
    }
  } else {
    try {
      result = await dispatchRoutingInner(ctx, semanticCandidatesForLaneD, b2LookupStatus, contentIntentMatchedThisTurn)
    } catch (err) {
      routingError = err
    }

    // Phase 5: attach hint metadata to result for downstream consumption (non-override path)
    if (!routingError && result && phase5HintResult && phase5HintResult.candidates.length > 0) {
      const topHint = phase5HintResult.candidates[0]
      result._phase5HintIntent = topHint.intent_id
      result._phase5HintScope = detectHintScope(ctx.trimmedInput) ?? undefined
      result._phase5HintFromSeed = topHint.from_curated_seed
    }
  }

  // Attach semantic candidates to result (only if tier chain didn't handle it)
  if (!routingError && result && !result.handled && semanticCandidatesForLaneD) {
    result._semanticCandidates = semanticCandidatesForLaneD
  }

  // Stage 5: attach shadow telemetry to result
  if (!routingError && result && s5Telemetry) {
    result._s5Telemetry = s5Telemetry
  }

  // Phase 3c: expose B2 lookup status for server-side clarifier telemetry in sendMessage
  if (!routingError && result && b2LookupStatus) {
    result._b2LookupStatus = b2LookupStatus
  }

  // Phase 1 observe-only logging (fail-open, non-blocking) — only when Phase 1 is enabled
  if (phase1Enabled) {
    try {
      const logPayload = routingError
        ? buildFailedRoutingLogPayload(ctx, turnSnapshotForLog)
        : buildRoutingLogPayload(ctx, result!, turnSnapshotForLog)

      // B2 telemetry finalization (single point): enrich log payload with B2 outcome
      if (b2Telemetry) {
        // Final override: candidates_found → discarded_handled when validated candidates
        // existed but tier chain handled the query
        if (b2Telemetry.status === 'candidates_found' && b2Telemetry.validatedCount && b2Telemetry.validatedCount > 0 && result?.handled) {
          b2Telemetry.status = 'discarded_handled'
        }
        logPayload.b2_status = b2Telemetry.status as RoutingLogPayload['b2_status']
        logPayload.b2_raw_count = b2Telemetry.rawCount
        logPayload.b2_validated_count = b2Telemetry.validatedCount
        logPayload.semantic_top_score = b2Telemetry.topScore ?? logPayload.semantic_top_score
        logPayload.b2_latency_ms = b2Telemetry.latencyMs
      }

      // Phase 3c: clarifier reorder telemetry (from dispatchRoutingInner)
      if (result?._b2ClarifierTelemetry) {
        const ct = result._b2ClarifierTelemetry
        logPayload.b2_clarifier_status = ct.status as RoutingLogPayload['b2_clarifier_status']
        logPayload.b2_clarifier_match_count = ct.matchCount
        logPayload.b2_clarifier_top_match_rank = ct.topMatchOriginalRank
        logPayload.b2_clarifier_top_match_id = ct.topMatchId
        logPayload.b2_clarifier_top_score = ct.topMatchScore
        logPayload.b2_clarifier_message_id = ct.messageId
        logPayload.b2_clarifier_option_ids = ct.optionIds
      }

      // Phase 3c: selection correlation (from dispatchRoutingInner handleSelectOption sites)
      if (result?._clarifierOriginMessageId) {
        logPayload.clarifier_origin_message_id = result._clarifierOriginMessageId
        logPayload.selected_option_id = result._selectedOptionId
      }

      // Stage 4: Bounded LLM telemetry
      if (result?._llmTelemetry) {
        const lt = result._llmTelemetry
        logPayload.llm_decision = lt.decision
        logPayload.llm_confidence = lt.confidence
        logPayload.llm_latency_ms = lt.latencyMs
        logPayload.llm_choice_id = lt.choiceId ?? undefined
        logPayload.llm_candidate_count = lt.candidateCount
        logPayload.llm_rejection_reason = lt.rejectionReason
        // G4 validator gate telemetry
        logPayload.llm_g4_total_in = lt.g4TotalIn
        logPayload.llm_g4_total_out = lt.g4TotalOut
        logPayload.llm_g4_duplicates_removed = lt.g4DuplicatesRemoved
        if (lt.g4Rejections && Object.keys(lt.g4Rejections).length > 0) {
          logPayload.llm_g4_rejections = lt.g4Rejections as Record<string, number>
        }
        // G2+G3 cap/trim telemetry
        logPayload.llm_g23_pre_cap_count = lt.g23PreCapCount
        logPayload.llm_g23_post_cap_count = lt.g23PostCapCount
        logPayload.llm_g23_was_trimmed = lt.g23WasTrimmed
        if (lt.g23TrimmedIds && lt.g23TrimmedIds.length > 0) {
          logPayload.llm_g23_trimmed_ids = lt.g23TrimmedIds
        }
        // G1 shadow threshold telemetry — only emit when true (would-be rejection)
        if (lt.g1ShadowRejected === true) {
          logPayload.llm_g1_shadow_rejected = true
        }
        // G5 TOCTOU shadow revalidation telemetry — only emitted on select path
        if (lt.g5ToctouResult) {
          logPayload.llm_g5_toctou_result = lt.g5ToctouResult
          logPayload.llm_g5_toctou_reason = lt.g5ToctouReason
          logPayload.llm_g5_toctou_window_ms = lt.g5ToctouWindowMs
        }
        // G7 near-tie guard telemetry — only emitted when >= 2 B2-scored candidates
        if (lt.g7CandidateBasis) {
          logPayload.llm_g7_near_tie_detected = lt.g7NearTieDetected
          logPayload.llm_g7_margin = lt.g7Margin
          logPayload.llm_g7_top1_score = lt.g7Top1Score
          logPayload.llm_g7_top2_score = lt.g7Top2Score
          logPayload.llm_g7_candidate_basis = lt.g7CandidateBasis
        }
      }

      // Stage 5: Shadow telemetry — emitted when B2 returned validated candidates
      if (s5Telemetry) {
        logPayload.s5_lookup_attempted = s5Telemetry.attempted
        logPayload.s5_candidate_count = s5Telemetry.candidateCount
        logPayload.s5_top_similarity = s5Telemetry.topSimilarity
        logPayload.s5_validation_result = s5Telemetry.validationResult
        logPayload.s5_replayed_intent_id = s5Telemetry.replayedIntentId
        logPayload.s5_replayed_target_id = s5Telemetry.replayedTargetId
        logPayload.s5_fallback_reason = s5Telemetry.fallbackReason
      }

      // Phase 5: hint retrieval telemetry
      if (phase5HintResult) {
        const hintScope = detectHintScope(ctx.trimmedInput)
        logPayload.h1_lookup_attempted = true
        logPayload.h1_lookup_status = phase5HintResult.status
        logPayload.h1_candidate_count = phase5HintResult.candidates.length
        logPayload.h1_latency_ms = phase5HintResult.latencyMs
        logPayload.h1_scope = hintScope ?? undefined
        if (phase5HintResult.candidates.length > 0) {
          logPayload.h1_top_similarity = phase5HintResult.candidates[0].similarity_score
          logPayload.h1_retrieved_intent_id = phase5HintResult.candidates[0].intent_id
          logPayload.h1_from_curated_seed = phase5HintResult.candidates[0].from_curated_seed
          // h1_hint_accepted_by_llm: set post-hoc in chat-navigation-panel.tsx after the
          // navigate API response returns. Cannot be determined here because the navigate
          // response hasn't arrived yet at dispatcher log time.
        }
        // Phase 5 addendum: retrieval normalization + exact-hit telemetry
        logPayload.h1_exact_hit_used = phase5HintResult.phase5ExactHitUsed
        logPayload.h1_exact_hit_source = phase5HintResult.phase5ExactHitSource
        logPayload.h1_retrieval_normalization_applied = phase5HintResult.retrievalNormalizationApplied
        logPayload.h1_raw_query_text = phase5HintResult.rawQueryText
        logPayload.h1_retrieval_query_text = phase5HintResult.retrievalQueryText
        // Multi-pass retrieval telemetry
        logPayload.h1_raw_pass_used = phase5HintResult.rawPassUsed
        logPayload.h1_normalized_pass_used = phase5HintResult.normalizedPassUsed
        logPayload.h1_near_tie = phase5HintResult.phase5NearTie
        // Retrieval-as-hinting + LLM fallback telemetry
        logPayload.h1_hints_available_to_llm = phase5HintResult.candidates.length > 0
        logPayload.h1_llm_used_raw_query_fallback = phase5SkippedTierChain && !hasConfidentHint
      } else if (phase5SkippedTierChain && hintScope) {
        // Scope detected but no retrieval ran or retrieval returned nothing — pure LLM fallback
        logPayload.h1_lookup_attempted = !!phase5HintResult
        logPayload.h1_scope = hintScope
        logPayload.h1_hints_available_to_llm = false
        logPayload.h1_llm_used_raw_query_fallback = true
      }

      // 6x.7 Phase A: merge resolver telemetry if the resolver ran (Path 2 navigation fallthrough)
      if (resolverTelemetryForLog) {
        Object.assign(logPayload, resolverTelemetryForLog)
      }

      await recordRoutingLog(logPayload)
      // Bug #3: Attach log payload to result for execution outcome logging in sendMessage.
      // Only for non-error paths (error paths throw at line 1243, result not returned).
      if (!routingError && result) {
        result._routingLogPayload = logPayload
        result._phase5ReplaySnapshot = phase5ReplaySnapshot
      }
    } catch {
      // Double-fault: even log builder failed. Silently ignore.
    }
  }

  if (routingError) throw routingError

  // Phase 2a: build memory write payload (deferred — sendMessage fires after confirmed execution)
  // Gate 5: NOT sent here. Attached to result for sendMessage to fire after confirmed execution.
  if (memoryWriteEnabled && result!.handled) {
    try {
      const memoryPayload = buildMemoryWritePayload(ctx, result!, turnSnapshotForLog)
      if (memoryPayload) {
        result!._pendingMemoryWrite = memoryPayload
      }
    } catch {
      // Payload build failure: silently ignore (fail-open)
    }
  }

  return result!
}

async function dispatchRoutingInner(
  ctx: RoutingDispatcherContext,
  semanticCandidatesForReorder?: SemanticCandidate[],
  b2LookupStatus?: 'ok' | 'empty' | 'timeout' | 'error' | 'disabled',
  contentIntentMatchedThisTurn = false,
): Promise<RoutingDispatcherResult> {
  const defaultResult: RoutingDispatcherResult = {
    handled: false,
    clarificationCleared: false,
    isNewQuestionOrCommandDetected: false,
    classifierCalled: false,
    classifierTimeout: false,
    classifierError: false,
    isFollowUp: false,
  }

  // Stage 6 duplicate-action guard: tracks executed S6 actions within this dispatch call
  const s6ExecutedActions: S6ActionSignature[] = []

  // Phase 3c: Clarifier assist flag (shadow mode — compute reorder, log, but don't apply)
  const clarifierAssistEnabled = process.env.NEXT_PUBLIC_CHAT_ROUTING_SEMANTIC_CLARIFIER_ASSIST_ENABLED === 'true'
  // Phase 3c active: actually apply reorder to clarifier candidate order (dev-only trial)
  const clarifierReorderActive = clarifierAssistEnabled
    && process.env.NEXT_PUBLIC_CHAT_ROUTING_SEMANTIC_CLARIFIER_REORDER_ACTIVE === 'true'

  /** Phase 3c: Thin wrapper — delegates to extracted pure function, attaches to result */
  function attachClarifierReorderTelemetry(
    result: RoutingDispatcherResult,
    groundingCandidates: ReorderableCandidate[],
    clarifierMsgId: string,
    lookupStatus?: 'ok' | 'empty' | 'timeout' | 'error' | 'disabled',
  ): void {
    if (!clarifierAssistEnabled) return
    result._b2ClarifierTelemetry = computeClarifierReorderTelemetry(
      groundingCandidates, semanticCandidatesForReorder, clarifierMsgId, lookupStatus,
    )
    // Upgrade shadow_reordered → reordered when active mode actually applied the reorder
    if (clarifierReorderActive && result._b2ClarifierTelemetry.status === 'shadow_reordered') {
      result._b2ClarifierTelemetry.status = 'reordered'
    }
  }

  /**
   * Phase 3c active: optionally reorder grounding candidates by B2 semantic match.
   * When active flag is off, returns candidates unchanged (shadow-only telemetry).
   * When active flag is on, promotes B2-matched items to the front of the list.
   * Only applies to grounding candidates, not panel disambiguation candidates.
   */
  function maybeActiveReorder<T extends ReorderableCandidate>(candidates: T[]): T[] {
    if (!clarifierReorderActive || !semanticCandidatesForReorder?.length) return candidates
    const result = reorderClarifierCandidates(candidates, semanticCandidatesForReorder)
    if (!result.reordered) return candidates
    return result.candidates as T[]
  }

  /** Phase 3c: Centralized selection correlation wrapper.
   * Captures clarifier_origin_message_id + selected_option_id on defaultResult
   * before delegating to the actual handleSelectOption. Covers all paths:
   * dispatcher Tier 3, clarification intercept ordinals, LLM selections, etc.
   * Falls back to widgetSelectionContext.optionSetId when lastClarification is
   * null (widget-context clarifiers clear lastClarification at line 918). */
  const wrappedHandleSelectOption = (option: SelectionOption) => {
    defaultResult._clarifierOriginMessageId =
      ctx.lastClarification?.messageId ?? ctx.widgetSelectionContext?.optionSetId
    defaultResult._selectedOptionId = option.id
    ctx.handleSelectOption(option)
  }

  // Feature flag: selection intent arbitration (focus latch model)
  const isLatchEnabled = process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 === 'true'

  // NOTE: lastOptionsShown turn increment is deferred to AFTER Tier 4.5
  // so the soft-active check can read the state before it expires on the same turn.
  // See increment call after the Tier 4.5 block below.

  // =========================================================================
  // BUILD TURN SNAPSHOT — used by ALL tiers (moved early for latch/intercept)
  // Per selection-intent-arbitration-incubation-plan.md: snapshot must be
  // available before intercept for focus-latch validity check.
  // =========================================================================
  const turnSnapshot = buildTurnSnapshot({})
  const hasVisibleWidgetItems = turnSnapshot.openWidgets.length > 0

  // DIAGNOSTIC: Log openWidgets state
  void debugLog({
    component: 'ChatNavigation',
    action: 'turn_snapshot_built',
    metadata: {
      openWidgetsCount: turnSnapshot.openWidgets.length,
      widgetLabels: turnSnapshot.openWidgets.map(w => w.label),
      widgetIds: turnSnapshot.openWidgets.map(w => w.id),
      widgetOptionCounts: turnSnapshot.openWidgets.map(w => w.options.length),
      hasBadgeLetters: turnSnapshot.hasBadgeLetters,
      activeSnapshotWidgetId: turnSnapshot.activeSnapshotWidgetId,
      input: ctx.trimmedInput,
    },
  })

  // Helper: set focus latch when a widget item is successfully resolved.
  // Called at ALL widget resolution return paths (Phase 5a completeness).
  const trySetWidgetLatch = (opts: { widgetId?: string; itemId?: string; trigger: string }) => {
    if (!isLatchEnabled) return
    let sourceWidget: typeof turnSnapshot.openWidgets[0] | undefined
    if (opts.widgetId) {
      sourceWidget = turnSnapshot.openWidgets.find(w => w.id === opts.widgetId)
    } else if (opts.itemId) {
      sourceWidget = turnSnapshot.openWidgets.find(w =>
        w.options.some(opt => opt.id === opts.itemId)
      )
    }
    if (sourceWidget) {
      ctx.setFocusLatch({
        kind: 'resolved',
        widgetId: sourceWidget.id,
        widgetLabel: sourceWidget.label,
        latchedAt: Date.now(),
        turnsSinceLatched: 0,
      })
      void debugLog({ component: 'ChatNavigation', action: 'focus_latch_set', metadata: { widgetId: sourceWidget.id, widgetLabel: sourceWidget.label, trigger: opts.trigger } })
    }
  }

  // Latch validity: check discriminated union kind for resolution/expiry
  if (isLatchEnabled && ctx.focusLatch) {
    if (ctx.focusLatch.kind === 'resolved') {
      // Capture narrowed type — TS narrows to ResolvedFocusLatch here
      const resolvedLatch = ctx.focusLatch
      // Resolved latch: verify widget is still open
      const stillOpen = turnSnapshot.openWidgets.some(w => w.id === resolvedLatch.widgetId)
      if (!stillOpen) {
        void debugLog({ component: 'ChatNavigation', action: 'focus_latch_cleared', metadata: { reason: 'widget_gone', widgetId: resolvedLatch.widgetId } })
        ctx.clearFocusLatch()
      }
    } else if (ctx.focusLatch.kind === 'pending') {
      // Capture narrowed type — TS narrows to PendingFocusLatch here
      const pendingLatch = ctx.focusLatch
      // Pending latch: try to resolve via panelId → widget slug
      const resolved = turnSnapshot.openWidgets.find(w => w.panelId === pendingLatch.pendingPanelId)
      if (resolved) {
        // Upgrade pending → resolved
        ctx.setFocusLatch({
          kind: 'resolved',
          widgetId: resolved.id,
          widgetLabel: pendingLatch.widgetLabel,
          latchedAt: pendingLatch.latchedAt,
          turnsSinceLatched: pendingLatch.turnsSinceLatched,
          suspended: pendingLatch.suspended,
        })
        void debugLog({ component: 'ChatNavigation', action: 'focus_latch_upgraded', metadata: { from: 'pending', widgetId: resolved.id, panelId: pendingLatch.pendingPanelId } })
      } else if (pendingLatch.turnsSinceLatched >= 2) {
        // Graceful degradation: pending latch expired without resolution
        void debugLog({ component: 'ChatNavigation', action: 'focus_latch_cleared', metadata: { reason: 'pending_expired', pendingPanelId: pendingLatch.pendingPanelId } })
        ctx.clearFocusLatch()
      }
      // else: keep pending alive (async registration window, turnsSinceLatched < 2)
    }
  }

  // Wrap all tier routing in try/finally to guarantee focus latch TTL increment
  // on ALL return paths (per selection-intent-arbitration-incubation-plan Phase 2c)
  try {

  // =========================================================================
  // Semantic Answer Lane — Early detection
  //
  // Must run before handleClarificationIntercept so the flag can be passed in.
  // Detects semantic question inputs ("explain what just happened", "why did I do that?")
  // and marks them for bypass of clarification, cross-corpus, grounding, and docs tiers.
  // Input still falls through to LLM API — this only prevents interception.
  // =========================================================================
  const isSemanticAnswerLaneEnabled = process.env.NEXT_PUBLIC_SEMANTIC_CONTINUITY_ANSWER_LANE_ENABLED === 'true'
  const isSemanticQuestion = isSemanticAnswerLaneEnabled && isSemanticQuestionInput(ctx.trimmedInput)

  // =========================================================================
  // Active-clarification guard: when disambiguation options are visible and
  // the user asks a semantic question ("why did you do that?"), explain the
  // active clarification instead of answering from stale action history.
  // Keeps pendingOptions visible — no state mutation on this path.
  // =========================================================================
  if (isSemanticQuestion && ctx.pendingOptions.length > 0) {
    const optionLabels = ctx.pendingOptions.map(o => o.label).join(', ')
    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: `I asked for clarification because multiple items matched your request. Please select one: ${optionLabels}.`,
      timestamp: new Date(),
      isError: false,
    }
    ctx.addMessage(assistantMessage)
    ctx.setIsLoading(false)
    void debugLog({
      component: 'ChatNavigation',
      action: 'semantic_lane_blocked_by_active_clarification',
      metadata: { input: ctx.trimmedInput, optionCount: ctx.pendingOptions.length },
    })
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 0,
      tierLabel: 'semantic_question_during_clarification',
    }
  }

  // Override: if scope cue is present ('chat' or 'widget'), suppress semantic lane —
  // the user is issuing a scoped command ("can you open X from active widget"), not a question.
  // "can you open" triggers hasQuestionIntent but the scope cue is a stronger signal.
  const scopeCueForSemanticGuard = isLatchEnabled ? resolveScopeCue(ctx.trimmedInput) : null
  const semanticLaneDetected = isSemanticQuestion
    && (!scopeCueForSemanticGuard || scopeCueForSemanticGuard.scope === 'none')
  if (semanticLaneDetected) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'semantic_answer_lane_entry',
      metadata: {
        input: ctx.trimmedInput,
        hasLastAction: !!ctx.sessionState?.lastAction,
        actionHistoryLength: ctx.sessionState?.actionHistory?.length ?? 0,
      },
    })
    defaultResult.semanticLanePending = true
  }

  // =========================================================================
  // TIERS 0, 1, 3 — Clarification Intercept
  // (Stop/Cancel, Return/Resume/Repair, Active Clarification)
  //
  // This single handler covers three tiers because they share deep state
  // (snapshot lifecycle, repair memory, stop suppression). The internal
  // order is: Tier 0 → Tier 1 → Tier 3, matching the plan.
  // =========================================================================
  const clarificationResult = await handleClarificationIntercept({
    trimmedInput: ctx.trimmedInput,
    lastClarification: ctx.lastClarification,
    lastSuggestion: ctx.lastSuggestion,
    pendingOptions: ctx.pendingOptions,
    uiContext: ctx.uiContext,
    currentEntryId: ctx.currentEntryId,
    addMessage: ctx.addMessage,
    setLastClarification: ctx.setLastClarification,
    setIsLoading: ctx.setIsLoading,
    setPendingOptions: ctx.setPendingOptions,
    setPendingOptionsMessageId: ctx.setPendingOptionsMessageId,
    setPendingOptionsGraceCount: ctx.setPendingOptionsGraceCount,
    setNotesScopeFollowUpActive: ctx.setNotesScopeFollowUpActive,
    handleSelectOption: wrappedHandleSelectOption,
    repairMemory: ctx.repairMemory,
    setRepairMemory: ctx.setRepairMemory,
    incrementRepairMemoryTurn: ctx.incrementRepairMemoryTurn,
    clearRepairMemory: ctx.clearRepairMemory,
    clarificationSnapshot: ctx.clarificationSnapshot,
    saveClarificationSnapshot: ctx.saveClarificationSnapshot,
    pauseSnapshotWithReason: ctx.pauseSnapshotWithReason,
    incrementSnapshotTurn: ctx.incrementSnapshotTurn,
    clearClarificationSnapshot: ctx.clearClarificationSnapshot,
    stopSuppressionCount: ctx.stopSuppressionCount,
    setStopSuppressionCount: ctx.setStopSuppressionCount,
    decrementStopSuppression: ctx.decrementStopSuppression,
    saveLastOptionsShown: ctx.saveLastOptionsShown,
    // Widget selection context (per universal-selection-resolver-plan.md)
    widgetSelectionContext: ctx.widgetSelectionContext,
    clearWidgetSelectionContext: ctx.clearWidgetSelectionContext,
    setActiveOptionSetId: ctx.setActiveOptionSetId,
    // Focus latch (per selection-intent-arbitration-incubation-plan.md)
    // When feature flag is off, pass null/no-ops so latch checks are inactive
    focusLatch: isLatchEnabled ? ctx.focusLatch : null,
    setFocusLatch: isLatchEnabled ? ctx.setFocusLatch : () => {},
    suspendFocusLatch: isLatchEnabled ? ctx.suspendFocusLatch : () => {},
    clearFocusLatch: isLatchEnabled ? ctx.clearFocusLatch : () => {},
    hasVisibleWidgetItems,
    totalListSegmentCount: turnSnapshot.openWidgets.reduce((sum, w) => sum + w.listSegmentCount, 0),
    lastOptionsShown: ctx.lastOptionsShown,
    isLatchEnabled,
    activeSnapshotWidgetId: isLatchEnabled ? (turnSnapshot.activeSnapshotWidgetId ?? null) : null,
    // Scope-cue recovery memory (explicit-only, per scope-cue-recovery-plan)
    scopeCueRecoveryMemory: ctx.scopeCueRecoveryMemory,
    clearScopeCueRecoveryMemory: ctx.clearScopeCueRecoveryMemory,
    // Pending scope-typo clarifier for one-turn replay (per scope-cues-addendum-plan.md §typoScopeCueGate)
    pendingScopeTypoClarifier: isLatchEnabled ? ctx.pendingScopeTypoClarifier : null,
    setPendingScopeTypoClarifier: isLatchEnabled ? ctx.setPendingScopeTypoClarifier : () => {},
    clearPendingScopeTypoClarifier: isLatchEnabled ? ctx.clearPendingScopeTypoClarifier : () => {},
    // Snapshot fingerprint + turn count for typo gate drift/TTL detection
    snapshotFingerprint: computeSnapshotFingerprint(turnSnapshot),
    currentTurnCount: ctx.messages.filter(m => m.role === 'user').length,
    // Selection continuity (Plan 20 — per Plan 19 canonical contract)
    selectionContinuity: ctx.selectionContinuity,
    updateSelectionContinuity: ctx.updateSelectionContinuity,
    resetSelectionContinuity: ctx.resetSelectionContinuity,
    // Phase 10: Semantic answer lane (escape hatch for semantic question inputs)
    semanticLaneDetected,
  })

  const { clarificationCleared, isNewQuestionOrCommandDetected } = clarificationResult

  if (clarificationResult.handled) {
    // Per plan §10: clear stale suggestion state when stop/interrupt fires
    if (ctx.lastSuggestion) {
      ctx.setLastSuggestion(null)
    }
    return {
      handled: true,
      handledByTier: 0, // Could be 0, 1, or 3 — logged internally
      tierLabel: 'clarification_intercept',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
      classifierCalled: false,
      classifierTimeout: false,
      classifierError: false,
      isFollowUp: false,
      _devProvenanceHint: clarificationResult._devProvenanceHint,
      // Phase 3c: propagate selection correlation set by wrappedHandleSelectOption
      _clarifierOriginMessageId: defaultResult._clarifierOriginMessageId,
      _selectedOptionId: defaultResult._selectedOptionId,
    }
  }

  // =========================================================================
  // SCOPE-TYPO REPLAY SIGNAL — One-shot replay (per scope-cues-addendum-plan.md §typoScopeCueGate)
  // When the confirmation resolver returns a replaySignal, re-run the intercept
  // with the rewritten input (scope cue now exact). Full safety ladder applies.
  // =========================================================================
  if (clarificationResult.replaySignal && !clarificationResult.handled) {
    const { replayInput, confirmedScope } = clarificationResult.replaySignal

    // Type-safe replay depth guard: 0 = original, 1 = replayed. Never recurse beyond 1.
    const currentReplayDepth = ctx._replayDepth ?? 0
    if (currentReplayDepth >= 1) {
      // Already inside a replay — do not recurse. Show safe clarifier.
      ctx.clearPendingScopeTypoClarifier()
      ctx.addMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: 'I couldn\'t resolve that. Please try again with the exact scope.',
        timestamp: new Date(),
        isError: false,
      })
      ctx.setIsLoading(false)
      return { ...defaultResult, handled: true }
    }

    void debugLog({
      component: 'ChatNavigation',
      action: 'scope_cue_typo_gate_replay_dispatch',
      metadata: { replayInput, confirmedScope: confirmedScope.scope, depth: currentReplayDepth },
    })

    // Re-run intercept with rewritten input. The confirmed scope cue is now 'high' confidence.
    const replayInterceptResult = await handleClarificationIntercept({
      ...ctx as unknown as import('./chat-routing-types').ClarificationInterceptContext,
      trimmedInput: replayInput,
      // Wire all the same fields as the original call
      lastClarification: ctx.lastClarification,
      lastSuggestion: ctx.lastSuggestion,
      pendingOptions: ctx.pendingOptions,
      uiContext: ctx.uiContext,
      currentEntryId: ctx.currentEntryId,
      addMessage: ctx.addMessage,
      setLastClarification: ctx.setLastClarification,
      setIsLoading: ctx.setIsLoading,
      setPendingOptions: ctx.setPendingOptions,
      setPendingOptionsMessageId: ctx.setPendingOptionsMessageId,
      setPendingOptionsGraceCount: ctx.setPendingOptionsGraceCount,
      setNotesScopeFollowUpActive: ctx.setNotesScopeFollowUpActive,
      handleSelectOption: wrappedHandleSelectOption,
      repairMemory: ctx.repairMemory,
      setRepairMemory: ctx.setRepairMemory,
      incrementRepairMemoryTurn: ctx.incrementRepairMemoryTurn,
      clearRepairMemory: ctx.clearRepairMemory,
      clarificationSnapshot: ctx.clarificationSnapshot,
      saveClarificationSnapshot: ctx.saveClarificationSnapshot,
      pauseSnapshotWithReason: ctx.pauseSnapshotWithReason,
      incrementSnapshotTurn: ctx.incrementSnapshotTurn,
      clearClarificationSnapshot: ctx.clearClarificationSnapshot,
      stopSuppressionCount: ctx.stopSuppressionCount,
      setStopSuppressionCount: ctx.setStopSuppressionCount,
      decrementStopSuppression: ctx.decrementStopSuppression,
      saveLastOptionsShown: ctx.saveLastOptionsShown,
      widgetSelectionContext: ctx.widgetSelectionContext,
      clearWidgetSelectionContext: ctx.clearWidgetSelectionContext,
      setActiveOptionSetId: ctx.setActiveOptionSetId,
      focusLatch: isLatchEnabled ? ctx.focusLatch : null,
      setFocusLatch: isLatchEnabled ? ctx.setFocusLatch : () => {},
      suspendFocusLatch: isLatchEnabled ? ctx.suspendFocusLatch : () => {},
      clearFocusLatch: isLatchEnabled ? ctx.clearFocusLatch : () => {},
      hasVisibleWidgetItems,
      totalListSegmentCount: turnSnapshot.openWidgets.reduce((sum, w) => sum + w.listSegmentCount, 0),
      lastOptionsShown: ctx.lastOptionsShown,
      isLatchEnabled,
      activeSnapshotWidgetId: isLatchEnabled ? (turnSnapshot.activeSnapshotWidgetId ?? null) : null,
      scopeCueRecoveryMemory: ctx.scopeCueRecoveryMemory,
      clearScopeCueRecoveryMemory: ctx.clearScopeCueRecoveryMemory,
      pendingScopeTypoClarifier: null,  // Already cleared — prevent re-trigger
      setPendingScopeTypoClarifier: ctx.setPendingScopeTypoClarifier,
      clearPendingScopeTypoClarifier: ctx.clearPendingScopeTypoClarifier,
      snapshotFingerprint: computeSnapshotFingerprint(turnSnapshot),
      currentTurnCount: ctx.messages.filter(m => m.role === 'user').length,
      selectionContinuity: ctx.selectionContinuity,
      updateSelectionContinuity: ctx.updateSelectionContinuity,
      resetSelectionContinuity: ctx.resetSelectionContinuity,
      semanticLaneDetected,
      _replayDepth: 1,  // Replay depth = 1 — prevents further recursion
    })

    // If replay intercept handled (e.g., showed clarifier), return
    if (replayInterceptResult.handled) {
      return {
        handled: true,
        handledByTier: 0,
        tierLabel: 'scope_typo_replay',
        clarificationCleared: replayInterceptResult.clarificationCleared,
        isNewQuestionOrCommandDetected: replayInterceptResult.isNewQuestionOrCommandDetected,
        classifierCalled: false,
        classifierTimeout: false,
        classifierError: false,
        isFollowUp: false,
        _devProvenanceHint: replayInterceptResult._devProvenanceHint,
        // Phase 3c: propagate selection correlation set by wrappedHandleSelectOption
        _clarifierOriginMessageId: defaultResult._clarifierOriginMessageId,
        _selectedOptionId: defaultResult._selectedOptionId,
      }
    }

    // If replay produced a scopeCueSignal, handle it via the normal scope signal path
    if (replayInterceptResult.scopeCueSignal) {
      // Override the original clarificationResult with the replay result
      // so the scope signal handler below picks it up
      const replayScopeSignal = replayInterceptResult.scopeCueSignal
      // Fall through to the scope-cue signal handler below
      // by updating the local reference
      Object.assign(clarificationResult, {
        scopeCueSignal: replayScopeSignal,
        handled: false,
        clarificationCleared: replayInterceptResult.clarificationCleared,
        isNewQuestionOrCommandDetected: replayInterceptResult.isNewQuestionOrCommandDetected,
      })
    }
  }

  // When commandBypassesLabelMatching cleared state but intercept didn't handle,
  // nullify stale ctx references so downstream tiers (esp. Tier 4.5 grounding) don't
  // inherit phantom options. React state setters are async — ctx still holds old values.
  // Direct field mutation only — setters are async and don't protect same-turn reads.
  if (clarificationCleared) {
    ctx.lastClarification = null
    ctx.pendingOptions = []
    ctx.activeOptionSetId = null
    ctx.setPendingOptionsGraceCount(0)
  }

  // =========================================================================
  // SCOPE-CUE SIGNAL — Scoped Resolution (Rules 14-15, Tests 13-14)
  //
  // When the intercept detects an explicit scope cue ("from active widget",
  // "from links panel d", "from dashboard"), it returns a scopeCueSignal with
  // handled:false. The dispatcher resolves against the declared scope only —
  // explicit cue → scoped candidates only, no mixed pools.
  // =========================================================================
  const scopeSignal = clarificationResult.scopeCueSignal
  if (isLatchEnabled && scopeSignal && !clarificationResult.handled) {

    // -----------------------------------------------------------------------
    // WIDGET SCOPE — scoped grounding against widget items only
    // -----------------------------------------------------------------------
    if (scopeSignal.scope === 'widget') {
    // A. Resolve named widget using matchVisiblePanelCommand
    let scopedWidgetId = scopeSignal.resolvedWidgetId
    if (!scopedWidgetId && scopeSignal.namedWidgetHint) {
      const panelMatch = matchVisiblePanelCommand(
        scopeSignal.namedWidgetHint,
        turnSnapshot.openWidgets.map(w => ({ id: w.id, title: w.label, type: 'panel' }))
      )
      if (panelMatch.type !== 'none' && panelMatch.matches.length === 1) {
        // Accept both exact and unique partial matches (e.g., "panel d" → "Links Panel D")
        scopedWidgetId = panelMatch.matches[0].id
      } else if (panelMatch.matches.length > 1) {
        // Named cue collision — safe clarifier limited to matched panels only
        const collisionLabels = panelMatch.matches.map(m => m.title).join(', ')
        void debugLog({
          component: 'ChatNavigation',
          action: 'scope_cue_widget_named_collision',
          metadata: { namedWidgetHint: scopeSignal.namedWidgetHint, matchCount: panelMatch.matches.length, collisionLabels },
        })
        ctx.addMessage({
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: `Multiple panels match "${scopeSignal.namedWidgetHint}": ${collisionLabels}. Which one did you mean?`,
          timestamp: new Date(),
          isError: false,
        })
        ctx.setIsLoading(false)
        return {
          ...defaultResult,
          handled: true,
          handledByTier: 1,
          tierLabel: 'scope_cue_widget_named_collision',
          clarificationCleared,
          isNewQuestionOrCommandDetected,
          _devProvenanceHint: 'safe_clarifier',
        }
      }
    }

    // B. Fallback to activeSnapshotWidgetId
    if (!scopedWidgetId) {
      scopedWidgetId = turnSnapshot.activeSnapshotWidgetId ?? null
    }

    // C. No widget found → scoped "not available" message
    if (!scopedWidgetId) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'scope_cue_widget_no_target',
        metadata: { namedWidgetHint: scopeSignal.namedWidgetHint, scopeSource: scopeSignal.scopeSource },
      })
      ctx.addMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: scopeSignal.namedWidgetHint
          ? `I can't find a widget matching "${scopeSignal.namedWidgetHint}".`
          : 'No active widget is available. Please select from the visible options.',
        timestamp: new Date(),
        isError: false,
      })
      ctx.setIsLoading(false)
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 1,
        tierLabel: 'scope_cue_widget_not_available',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        _devProvenanceHint: 'safe_clarifier',
      }
    }

    // D. Route to Tier 4.5 grounding with HARD-FILTERED candidates (Rule 15)
    //    Build grounding context with ONLY the scoped widget's candidates.
    //    No mixed-source candidate list ever reaches the LLM.
    const scopedWidgets = turnSnapshot.openWidgets.filter(w => w.id === scopedWidgetId)

    const scopedGroundingCtx = buildGroundingContext({
      activeOptionSetId: null, // No chat options — widget-scoped only
      lastClarification: null,
      clarificationSnapshot: null,
      sessionState: ctx.sessionState,
      repairMemory: null,
      openWidgets: scopedWidgets,
      visiblePanels: undefined, // Rule 15: no mixed-source candidates — widget-scoped only
    })

    // Pass RAW stripped input to deterministic grounding (strict-exact policy:
    // non-exact input must NOT deterministic-execute). LLM handles verb stripping.
    const groundingInput = scopeSignal.strippedInput

    const scopedGroundingResult = handleGroundingSetFallback(
      groundingInput,
      scopedGroundingCtx,
      { hasBadgeLetters: turnSnapshot.hasBadgeLetters, activeWidgetId: scopedWidgetId }
    )

    void debugLog({
      component: 'ChatNavigation',
      action: 'scope_cue_widget_grounding_result',
      metadata: {
        input: groundingInput,
        scopedWidgetId,
        handled: scopedGroundingResult.handled,
        resolvedBy: scopedGroundingResult.resolvedBy,
        selectedCandidateId: scopedGroundingResult.selectedCandidate?.id,
        needsLLM: scopedGroundingResult.needsLLM,
        llmCandidateCount: scopedGroundingResult.llmCandidates?.length ?? 0,
      },
    })

    // Helper: execute a resolved candidate (deterministic or LLM-selected)
    const executeScopedCandidate = (candidate: typeof scopedGroundingResult.selectedCandidate, provenance: 'deterministic' | 'llm_executed') => {
      if (!candidate) return null
      const sourceWidget = scopedWidgets[0]

      // Latch-on: successful widget item resolution
      trySetWidgetLatch({ widgetId: sourceWidget?.id, trigger: 'scope_cue_widget_grounding' })

      // Source continuity (Rule 16): lock scope to widget after successful resolution
      ctx.updateSelectionContinuity({ activeScope: 'widget' })

      if (candidate.type === 'widget_option') {
        return {
          ...defaultResult,
          handled: true,
          handledByTier: 4 as const,
          tierLabel: `scope_cue_widget_grounding_${provenance === 'deterministic' ? 'execute' : 'llm_execute'}`,
          clarificationCleared,
          isNewQuestionOrCommandDetected,
          _devProvenanceHint: provenance,
          groundingAction: {
            type: 'execute_widget_item' as const,
            widgetId: sourceWidget?.id || '',
            segmentId: findSourceSegmentId(sourceWidget?.id, candidate.id),
            itemId: candidate.id,
            itemLabel: candidate.label,
            action: 'open',
          },
        }
      }
      return null
    }

    // Deterministic match → execute widget item
    if (scopedGroundingResult.handled && scopedGroundingResult.selectedCandidate) {
      const result = executeScopedCandidate(scopedGroundingResult.selectedCandidate, 'deterministic')
      if (result) return result
    }

    // =====================================================================
    // CLARIFIER-REPLY MODE: If widgetSelectionContext is active for the same
    // widget, this is a follow-up to a previous grounded clarifier.
    // Resolve against prior pills only — no fresh grounding, no drift.
    // Complete early-return block: always returns, never falls through.
    // =====================================================================
    const isReplyToPreviousClarifier = ctx.widgetSelectionContext !== null
      && ctx.widgetSelectionContext.turnsSinceShown < 3
      && ctx.widgetSelectionContext.widgetId === scopedWidgetId

    if (isReplyToPreviousClarifier && ctx.widgetSelectionContext) {
      const priorOptions = ctx.widgetSelectionContext.options
      const priorOptionSetId = ctx.widgetSelectionContext.optionSetId
      const priorQuestionText = ctx.widgetSelectionContext.questionText
        || `Which option did you mean? ${priorOptions.map(o => o.label).join(', ')}?`

      void debugLog({
        component: 'ChatNavigation',
        action: 'scope_cue_widget_clarifier_reply_mode',
        metadata: {
          input: groundingInput,
          scopedWidgetId,
          priorOptionSetId,
          candidateCount: priorOptions.length,
        },
      })

      // --- Deterministic: exact label match against prior pills ---
      const normalizedReplyInput = groundingInput.toLowerCase().trim()
      const exactLabelMatch = priorOptions.filter(
        o => o.label.toLowerCase().trim() === normalizedReplyInput
      )
      if (exactLabelMatch.length === 1) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'scope_cue_widget_clarifier_reply_exact_label',
          metadata: { matchedId: exactLabelMatch[0].id, matchedLabel: exactLabelMatch[0].label },
        })
        const result = executeScopedCandidate(
          { id: exactLabelMatch[0].id, label: exactLabelMatch[0].label, type: 'widget_option', source: 'widget_list' },
          'deterministic'
        )
        if (result) {
          return {
            ...result,
            tierLabel: 'scope_cue_widget_clarifier_reply_exact',
            _devProvenanceHint: 'deterministic' as const,
          }
        }
      }

      // --- Deterministic: ordinal match against prior pills ---
      // MUST use 'strict' mode — embedded mode's per-token fuzzy normalizer causes
      // false positives (e.g., "want"→"last" at distance 2, then extractOrdinalFromPhrase
      // matches /\blast\b/ → selects wrong option). LLM handles non-ordinal inputs.
      const optionLabels = priorOptions.map(o => o.label)
      const ordinalResult = isSelectionOnly(groundingInput, priorOptions.length, optionLabels, 'strict')
      if (ordinalResult.isSelection && ordinalResult.index !== undefined) {
        const selected = priorOptions[ordinalResult.index]
        if (selected) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'scope_cue_widget_clarifier_reply_ordinal',
            metadata: { index: ordinalResult.index, matchedId: selected.id, matchedLabel: selected.label },
          })
          const result = executeScopedCandidate(
            { id: selected.id, label: selected.label, type: 'widget_option', source: 'widget_list' },
            'deterministic'
          )
          if (result) {
            return {
              ...result,
              tierLabel: 'scope_cue_widget_clarifier_reply_ordinal',
              _devProvenanceHint: 'deterministic' as const,
            }
          }
        }
      }

      // --- Non-exact: bounded LLM with clarifier context ---
      // Policy lock: only bounded LLM select can execute. Never deterministic for non-exact.
      if (isGroundingLLMEnabled()) {
        const replyLlmCandidates = priorOptions.map(o => ({
          id: o.id, label: o.label, type: 'widget_option', actionHint: 'open' as const,
        }))
        const clarifierContext = {
          messageId: priorOptionSetId,
          previousQuestion: priorQuestionText,
        }

        try {
          const llmResult = await callGroundingLLM({
            userInput: groundingInput,
            candidates: replyLlmCandidates,
            clarifierContext,
          })

          void debugLog({
            component: 'ChatNavigation',
            action: 'scope_cue_widget_clarifier_reply_llm_result',
            metadata: {
              success: llmResult.success,
              decision: llmResult.response?.decision,
              choiceId: llmResult.response?.choiceId,
              confidence: llmResult.response?.confidence,
              latencyMs: llmResult.latencyMs,
            },
          })

          if (llmResult.success && llmResult.response?.decision === 'select' && llmResult.response.choiceId) {
            const selected = priorOptions.find(o => o.id === llmResult.response!.choiceId)
            if (selected) {
              void debugLog({
                component: 'ChatNavigation',
                action: 'scope_cue_widget_clarifier_reply_llm_select',
                metadata: { choiceId: selected.id, label: selected.label },
              })
              const result = executeScopedCandidate(
                { id: selected.id, label: selected.label, type: 'widget_option', source: 'widget_list' },
                'llm_executed'
              )
              if (result) {
                return {
                  ...result,
                  tierLabel: 'scope_cue_widget_clarifier_reply_select',
                  _devProvenanceHint: 'llm_influenced' as const,
                }
              }
            }
          }
        } catch {
          void debugLog({
            component: 'ChatNavigation',
            action: 'scope_cue_widget_clarifier_reply_llm_error',
            metadata: { scopedWidgetId, input: groundingInput },
          })
        }
      }

      // --- Loop guard: LLM didn't select → re-show same pills ---
      void debugLog({
        component: 'ChatNavigation',
        action: 'scope_cue_widget_clarifier_reply_need_more_info',
        metadata: {
          input: groundingInput,
          optionSetId: priorOptionSetId,
          candidateCount: priorOptions.length,
        },
      })

      const loopGuardMsgId = `assistant-${Date.now()}`
      const loopGuardCandidates: GroundingCandidate[] = priorOptions.map(o => ({
        id: o.id, label: o.label, type: 'widget_option' as const, source: 'widget_list' as const,
      }))
      const loopGuardBoundOptions = bindGroundingClarifierOptions(ctx, loopGuardCandidates, loopGuardMsgId)

      // Store questionText on the re-shown clarifier for next turn
      const loopGuardQuestionText = `Please tap an option or say the exact label: ${priorOptions.map(o => o.label).join(', ')}`
      if (ctx.widgetSelectionContext && ctx.widgetSelectionContext.optionSetId === loopGuardMsgId) {
        ctx.setWidgetSelectionContext({
          ...ctx.widgetSelectionContext,
          questionText: loopGuardQuestionText,
        })
      }

      ctx.addMessage({
        id: loopGuardMsgId,
        role: 'assistant',
        content: loopGuardQuestionText,
        timestamp: new Date(),
        isError: false,
        options: loopGuardBoundOptions.map(opt => ({
          type: opt.type as SelectionOption['type'],
          id: opt.id,
          label: opt.label,
          sublabel: opt.sublabel,
          data: opt.data as SelectionOption['data'],
        })),
      })
      ctx.setIsLoading(false)
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 4,
        tierLabel: 'scope_cue_widget_clarifier_reply_need_more_info',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        _devProvenanceHint: 'safe_clarifier',
      }
    }
    // =====================================================================
    // END CLARIFIER-REPLY MODE
    // =====================================================================

    // Track why we fell through to clarifier (provenance + observability)
    let widgetScopeLlmFallbackReason: 'llm_disabled' | 'need_more_info' | 'llm_abstain' | 'llm_error' = 'llm_disabled'

    // Bounded LLM fallback (Fix 5): try scoped LLM before safe clarifier
    if (scopedGroundingResult.needsLLM
        && scopedGroundingResult.llmCandidates
        && scopedGroundingResult.llmCandidates.length > 0
        && isGroundingLLMEnabled()) {
      try {
        void debugLog({
          component: 'ChatNavigation',
          action: 'scope_cue_widget_llm_attempt',
          metadata: {
            input: groundingInput,
            scopedWidgetId,
            candidateCount: scopedGroundingResult.llmCandidates.length,
          },
        })

        const llmResult = await callGroundingLLM({
          userInput: groundingInput,
          candidates: scopedGroundingResult.llmCandidates.map(c => ({
            id: c.id,
            label: c.label,
            type: c.type,
            actionHint: c.actionHint,
          })),
        })

        void debugLog({
          component: 'ChatNavigation',
          action: 'scope_cue_widget_llm_result',
          metadata: {
            success: llmResult.success,
            decision: llmResult.response?.decision,
            choiceId: llmResult.response?.choiceId,
            confidence: llmResult.response?.confidence,
            latencyMs: llmResult.latencyMs,
          },
        })

        if (llmResult.success && llmResult.response?.decision === 'select' && llmResult.response.choiceId) {
          const selected = scopedGroundingResult.llmCandidates.find(
            c => c.id === llmResult.response!.choiceId
          )
          if (selected) {
            const result = executeScopedCandidate(selected, 'llm_executed')
            if (result) return result
          }
        }
        // LLM returned but didn't select → track reason for clarifier
        if (llmResult.success && llmResult.response?.decision === 'need_more_info') {
          widgetScopeLlmFallbackReason = 'need_more_info'
        } else {
          widgetScopeLlmFallbackReason = 'llm_abstain'
        }
      } catch {
        // LLM error → fall through to safe clarifier (safe fallback compliance)
        widgetScopeLlmFallbackReason = 'llm_error'
        void debugLog({
          component: 'ChatNavigation',
          action: 'scope_cue_widget_llm_error',
          metadata: { scopedWidgetId, input: groundingInput },
        })
      }
    }

    // No match (deterministic + LLM both missed) → scoped safe clarifier
    // Rule 15: do not silently widen scope
    // Source continuity (Rule 16): lock scope to widget even on miss
    ctx.updateSelectionContinuity({ activeScope: 'widget' })

    // If candidates exist, show grounded clarifier with disambiguation options
    // Covers: LLM need_more_info, LLM disabled, LLM error, LLM abstain
    if (scopedGroundingResult.llmCandidates && scopedGroundingResult.llmCandidates.length > 0) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'scope_cue_widget_grounding_clarifier',
        metadata: {
          input: groundingInput,
          scopedWidgetId,
          candidateCount: scopedGroundingResult.llmCandidates.length,
          reason: widgetScopeLlmFallbackReason,
        },
      })

      const clarifierMsgId = `assistant-${Date.now()}`
      const effectiveScopedCandidates = maybeActiveReorder(scopedGroundingResult.llmCandidates)
      const clarifierContent = buildGroundedClarifier(effectiveScopedCandidates)
      const boundOptions = bindGroundingClarifierOptions(ctx, effectiveScopedCandidates, clarifierMsgId)

      // Store the actual clarifier question text for reply-context (clarifier-reply mode)
      if (ctx.widgetSelectionContext && ctx.widgetSelectionContext.optionSetId === clarifierMsgId) {
        ctx.setWidgetSelectionContext({
          ...ctx.widgetSelectionContext,
          questionText: clarifierContent,
        })
      }

      ctx.addMessage({
        id: clarifierMsgId,
        role: 'assistant',
        content: clarifierContent,
        timestamp: new Date(),
        isError: false,
        options: boundOptions.map(opt => ({
          type: opt.type as SelectionOption['type'],
          id: opt.id,
          label: opt.label,
          sublabel: opt.sublabel,
          data: opt.data as SelectionOption['data'],
        })),
      })
      ctx.setIsLoading(false)
      attachClarifierReorderTelemetry(defaultResult, scopedGroundingResult.llmCandidates, clarifierMsgId, b2LookupStatus)
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 4,
        tierLabel: widgetScopeLlmFallbackReason === 'need_more_info'
          ? 'scope_cue_widget_llm_need_more_info'
          : 'scope_cue_widget_grounding_clarifier',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        _devProvenanceHint: widgetScopeLlmFallbackReason === 'need_more_info'
          ? 'llm_influenced' as const
          : 'safe_clarifier',
      }
    }

    // True miss — no candidates at all → generic clarifier
    const scopedWidgetLabel = scopedWidgets[0]?.label || 'the widget'
    ctx.addMessage({
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: `I couldn't find "${groundingInput}" in ${scopedWidgetLabel}. Could you try a different selection?`,
      timestamp: new Date(),
      isError: false,
    })
    ctx.setIsLoading(false)
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 4,
      tierLabel: 'scope_cue_widget_grounding_miss',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
      _devProvenanceHint: 'safe_clarifier',
    }
    } // end widget scope

    // -----------------------------------------------------------------------
    // DASHBOARD SCOPE — scoped resolution against dashboard panels only
    // Explicit cue → scoped candidates only, no mixed pools.
    // All stages return handled: true — never falls through to non-dashboard tiers.
    // -----------------------------------------------------------------------
    else if (scopeSignal.scope === 'dashboard') {
      // Normalize dashboard widgets to canonical shape once before matching
      const rawDashboardWidgets = ctx.uiContext?.dashboard?.visibleWidgets
      const dashboardWidgets = (rawDashboardWidgets ?? []).map(w => ({
        id: w.id,
        title: w.title ?? (w as Record<string, unknown>).label as string ?? w.id,
        type: w.type ?? 'panel',
      }))

      if (!dashboardWidgets.length) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'scope_cue_dashboard_no_panels',
          metadata: { input: scopeSignal.strippedInput },
        })
        ctx.addMessage({
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'No panels are visible on the dashboard.',
          timestamp: new Date(),
          isError: false,
        })
        ctx.setIsLoading(false)
        return {
          ...defaultResult,
          handled: true,
          handledByTier: 1,
          tierLabel: 'scope_cue_dashboard_no_panels',
          clarificationCleared,
          isNewQuestionOrCommandDetected,
          _devProvenanceHint: 'safe_clarifier',
        }
      }

      // Stage A: strict-exact + disambiguation via existing panel disambiguation flow
      const panelResult = handlePanelDisambiguation({
        trimmedInput: scopeSignal.strippedInput,
        visibleWidgets: dashboardWidgets,
        addMessage: ctx.addMessage,
        setIsLoading: ctx.setIsLoading,
        setPendingOptions: ctx.setPendingOptions,
        setPendingOptionsMessageId: ctx.setPendingOptionsMessageId,
        setLastClarification: ctx.setLastClarification,
        saveLastOptionsShown: ctx.saveLastOptionsShown,
        clearWidgetSelectionContext: ctx.clearWidgetSelectionContext,
        clearFocusLatch: isLatchEnabled ? ctx.clearFocusLatch : undefined,
        openPanelDrawer: ctx.openPanelDrawer,
      })

      void debugLog({
        component: 'ChatNavigation',
        action: 'scope_cue_dashboard_panel_result',
        metadata: {
          input: scopeSignal.strippedInput,
          handled: panelResult.handled,
          matchType: panelResult.matchType,
          matchCount: panelResult.matchCount,
        },
      })

      if (panelResult.handled) {
        // Phase 3c: attach clarifier telemetry for panel disambiguation clarifiers
        if (panelResult.clarifierMessageId && panelResult.clarifierCandidates) {
          attachClarifierReorderTelemetry(defaultResult, panelResult.clarifierCandidates, panelResult.clarifierMessageId, b2LookupStatus)
        }
        return {
          ...defaultResult,
          handled: true,
          handledByTier: 2,
          tierLabel: 'scope_cue_dashboard_panel',
          clarificationCleared,
          isNewQuestionOrCommandDetected,
        }
      }

      // Stage B: scoped grounding — bounded LLM with dashboard panels only
      // buildGroundingContext with openWidgets: [] — only dashboard panels in candidate set
      const scopedGroundingCtx = buildGroundingContext({
        activeOptionSetId: null,
        lastClarification: null,
        clarificationSnapshot: null,
        sessionState: ctx.sessionState,
        repairMemory: null,
        openWidgets: [],                   // No widget items in dashboard scope
        visiblePanels: dashboardWidgets,   // ONLY dashboard panels
      })

      const groundingInput = scopeSignal.strippedInput
      const scopedGroundingResult = handleGroundingSetFallback(
        groundingInput,
        scopedGroundingCtx,
        { hasBadgeLetters: turnSnapshot.hasBadgeLetters }
      )

      void debugLog({
        component: 'ChatNavigation',
        action: 'scope_cue_dashboard_grounding_result',
        metadata: {
          input: groundingInput,
          handled: scopedGroundingResult.handled,
          resolvedBy: scopedGroundingResult.resolvedBy,
          selectedCandidateId: scopedGroundingResult.selectedCandidate?.id,
          needsLLM: scopedGroundingResult.needsLLM,
          llmCandidateCount: scopedGroundingResult.llmCandidates?.length ?? 0,
        },
      })

      // Deterministic grounding match → enforce strict-exact before execution
      if (scopedGroundingResult.handled && scopedGroundingResult.selectedCandidate) {
        // SAFETY GUARD: only deterministic-execute if input is strict-exact match
        const candidate = scopedGroundingResult.selectedCandidate
        if (isStrictExactMatch(groundingInput, candidate.label)) {
          // Strict-exact → deterministic open via openPanelDrawer
          if (ctx.openPanelDrawer) {
            ctx.openPanelDrawer(candidate.id, candidate.label)
          }
          return {
            ...defaultResult,
            handled: true,
            handledByTier: 2,
            tierLabel: 'scope_cue_dashboard_grounding_execute',
            clarificationCleared,
            isNewQuestionOrCommandDetected,
            _devProvenanceHint: 'deterministic',
          }
        }
        // Non-strict-exact → fall through to LLM path (do NOT deterministic execute)
      }

      // Bounded LLM fallback: try scoped LLM with dashboard panels only
      if (scopedGroundingResult.needsLLM
          && scopedGroundingResult.llmCandidates
          && scopedGroundingResult.llmCandidates.length > 0
          && isGroundingLLMEnabled()) {
        try {
          void debugLog({
            component: 'ChatNavigation',
            action: 'scope_cue_dashboard_llm_attempt',
            metadata: {
              input: groundingInput,
              candidateCount: scopedGroundingResult.llmCandidates.length,
            },
          })

          const llmResult = await callGroundingLLM({
            userInput: groundingInput,
            candidates: scopedGroundingResult.llmCandidates.map(c => ({
              id: c.id,
              label: c.label,
              type: c.type,
              actionHint: c.actionHint,
            })),
          })

          void debugLog({
            component: 'ChatNavigation',
            action: 'scope_cue_dashboard_llm_result',
            metadata: {
              success: llmResult.success,
              decision: llmResult.response?.decision,
              choiceId: llmResult.response?.choiceId,
              confidence: llmResult.response?.confidence,
              latencyMs: llmResult.latencyMs,
            },
          })

          if (llmResult.success && llmResult.response?.decision === 'select' && llmResult.response.choiceId) {
            const selected = scopedGroundingResult.llmCandidates.find(
              c => c.id === llmResult.response!.choiceId
            )
            if (selected && ctx.openPanelDrawer) {
              ctx.openPanelDrawer(selected.id, selected.label)
              return {
                ...defaultResult,
                handled: true,
                handledByTier: 2,
                tierLabel: 'scope_cue_dashboard_llm_execute',
                clarificationCleared,
                isNewQuestionOrCommandDetected,
                _devProvenanceHint: 'llm_executed',
              }
            }
          }
          // LLM abstained/no-match → fall through to Stage C (scoped not-found)
        } catch {
          void debugLog({
            component: 'ChatNavigation',
            action: 'scope_cue_dashboard_llm_error',
            metadata: { input: groundingInput },
          })
          // LLM error → fall through to Stage C (safe fallback)
        }
      }

      // Stage C: scoped "not found" — always returns handled: true
      // CRITICAL: never falls through to non-dashboard tiers
      const available = dashboardWidgets.map(w => w.title).join(', ')
      ctx.addMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: `I couldn't find that on the dashboard. Available panels: ${available}`,
        timestamp: new Date(),
        isError: false,
      })
      ctx.setIsLoading(false)
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 2,
        tierLabel: 'scope_cue_dashboard_not_found',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        _devProvenanceHint: 'safe_clarifier',
      }
    } // end dashboard scope

  } // end scope signal block

  // =========================================================================
  // TIER 2 — New Topic / Interrupt Commands
  //
  // Explicit commands bypass pending options and execute immediately.
  // Panel disambiguation catches multi-panel matches deterministically.
  // Cross-corpus handles notes-corpus-intent detection.
  // Meta-explain, correction, follow-up handle specific response patterns.
  // Preview shortcut expands a recent preview list.
  // =========================================================================

  // Tier 2a: Explicit Command Bypass — clear pending options for verb commands
  if (isExplicitCommand(ctx.trimmedInput)) {
    const lastOptionsMessage = ctx.findLastOptionsMessage(ctx.messages)
    const hasRecentOptions = lastOptionsMessage &&
      (Date.now() - lastOptionsMessage.timestamp.getTime()) <= ctx.reshowWindowMs

    if (ctx.pendingOptions.length > 0 || hasRecentOptions) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'explicit_command_bypass',
        metadata: {
          input: ctx.trimmedInput,
          hadPendingOptions: ctx.pendingOptions.length > 0,
          hadRecentOptions: !!hasRecentOptions,
          tier: 2,
        },
      })

      ctx.setPendingOptions([])
      ctx.setPendingOptionsMessageId(null)
      ctx.setPendingOptionsGraceCount(0)
    }
    // Don't return — let the command proceed through remaining tiers
  }

  // ==========================================================================
  // Widget Selection Context Guard — Skip Tier 2b for selection follow-ups
  //
  // Per universal-selection-resolver-plan.md: If widgetSelectionContext is active
  // and input is selection-like and not a question, skip cross-corpus retrieval
  // so the universal resolver (Tier 3.5) can handle it.
  // ==========================================================================
  // Focus latch / pre-latch skip: when a widget has focus (latch active or
  // pre-latch focused via activeSnapshotWidgetId) and input is selection-like,
  // skip cross-corpus so Tier 4.5 resolves against widget items.
  // Note: ctx.focusLatch may be stale (React state from previous render) when
  // the intercept just set it via setFocusLatch. Use turnSnapshot.activeSnapshotWidgetId
  // as the reliable synchronous signal.
  const skipCrossCorpusForFocusLatch = isLatchEnabled
    && isSelectionLike(ctx.trimmedInput)
    && !hasQuestionIntent(ctx.trimmedInput)
    && !isExplicitCommand(ctx.trimmedInput)
    && (
      (ctx.focusLatch && !ctx.focusLatch.suspended)  // Active latch
      || ((!ctx.focusLatch || ctx.focusLatch.suspended)  // Pre-latch
        && !!turnSnapshot.activeSnapshotWidgetId
        && !ctx.lastClarification?.options?.length)
    )

  const skipCrossCorpusForWidgetSelection = (ctx.widgetSelectionContext !== null
    && isSelectionLike(ctx.trimmedInput)
    && !hasQuestionIntent(ctx.trimmedInput))
    || skipCrossCorpusForFocusLatch

  if (semanticLaneDetected) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'semantic_lane_skip_cross_corpus',
      metadata: { input: ctx.trimmedInput },
    })
  }

  if (skipCrossCorpusForWidgetSelection || semanticLaneDetected) {
    if (skipCrossCorpusForWidgetSelection) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'skip_cross_corpus_widget_context',
        metadata: {
          input: ctx.trimmedInput,
          widgetId: ctx.widgetSelectionContext?.widgetId,
          reason: skipCrossCorpusForFocusLatch
            ? 'focus_latch_or_prelatch_active_and_selection_like'
            : 'widget_selection_context_active_and_selection_like',
        },
      })
    }
    // Fall through to Tier 2c, 3.5, etc.
  } else {
    // Tier 2b: Cross-Corpus Retrieval
    const crossCorpusResult = await handleCrossCorpusRetrieval({
      trimmedInput: ctx.trimmedInput,
      docRetrievalState: ctx.docRetrievalState,
      visibleWidgets: ctx.uiContext?.dashboard?.visibleWidgets,
      addMessage: ctx.addMessage,
      updateDocRetrievalState: ctx.updateDocRetrievalState,
      setIsLoading: ctx.setIsLoading,
      setPendingOptions: ctx.setPendingOptions,
      setPendingOptionsMessageId: ctx.setPendingOptionsMessageId as (messageId: string) => void,
      setLastClarification: ctx.setLastClarification,
    })
    if (crossCorpusResult.handled) {
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 2,
        tierLabel: 'cross_corpus',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
      }
    }
  }

  // Tier 2c: Panel Disambiguation (deterministic, pre-LLM)
  // Question intent override: "what is links panel?" should route to docs (Tier 5),
  // not get caught by token-subset matching in panel disambiguation.
  // Addendum Rule B: only strict exact panel name match overrides question intent.
  // Polite commands ("can you open links panel") now fall through to LLM tier.
  const questionIntentBlocks = (() => {
    if (!hasQuestionIntent(ctx.trimmedInput)) return false

    // Per raw-strict-exact plan Phase 3: imperative-command precedence.
    // "open the links panel plsss??" starts with imperative verb → NOT a question.
    // isExplicitCommand now uses verb-initial matching only, so "what did you open?" → false,
    // but "open the links panel plsss??" → true. Bypass question-intent gate for commands.
    if (isExplicitCommand(ctx.trimmedInput)) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'question_intent_bypassed_imperative_command',
        metadata: { input: ctx.trimmedInput, tier: '2c' },
      })
      return false // Imperative command form — don't block as question
    }

    // Addendum Rule B: only strict exact panel name match overrides question intent.
    // Token-containment evidence is NOT sufficient to convert a question into a command.
    const dw = ctx.uiContext?.mode === 'dashboard' ? ctx.uiContext?.dashboard?.visibleWidgets : undefined
    if (dw?.length) {
      const hasStrictMatch = dw.some(w => isStrictExactMatch(ctx.trimmedInput, w.title))
      if (hasStrictMatch) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'question_intent_overridden_by_strict_exact_match',
          metadata: { input: ctx.trimmedInput, tier: '2c' },
        })
        return false // Raw input IS a panel name — let Tier 2c handle
      }
    }
    return true // Question — block Tier 2c
  })()
  if (questionIntentBlocks) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'skip_panel_disambiguation_question_intent',
      metadata: { input: ctx.trimmedInput, reason: 'question_intent_detected', tier: '2c' },
    })
    // Skip Tier 2c — fall through to later tiers (Tier 4 isFullQuestionAboutNoun or Tier 5 docs)
  } else {
    const panelDisambiguationResult = handlePanelDisambiguation({
      trimmedInput: ctx.trimmedInput,
      visibleWidgets: ctx.uiContext?.dashboard?.visibleWidgets,
      addMessage: ctx.addMessage,
      setIsLoading: ctx.setIsLoading,
      setPendingOptions: ctx.setPendingOptions,
      setPendingOptionsMessageId: ctx.setPendingOptionsMessageId,
      setLastClarification: ctx.setLastClarification,
      saveLastOptionsShown: ctx.saveLastOptionsShown,
      clearWidgetSelectionContext: ctx.clearWidgetSelectionContext,
      clearFocusLatch: isLatchEnabled ? ctx.clearFocusLatch : undefined,
      openPanelDrawer: ctx.openPanelDrawer,
    })
    if (panelDisambiguationResult.handled) {
      // Phase 3c: attach clarifier telemetry for panel disambiguation clarifiers
      if (panelDisambiguationResult.clarifierMessageId && panelDisambiguationResult.clarifierCandidates) {
        attachClarifierReorderTelemetry(defaultResult, panelDisambiguationResult.clarifierCandidates, panelDisambiguationResult.clarifierMessageId, b2LookupStatus)
      }
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 2,
        tierLabel: 'panel_disambiguation',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
      }
    }
  }

  // Tier 2d: Meta-Explain
  // Semantic answer lane: skip meta-explain for semantic question inputs.
  // "explain what just happened" matches isMetaExplainOutsideClarification (startsWith('explain ')),
  // which would return handled: true and block the input from reaching the LLM API.
  if (semanticLaneDetected) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'semantic_lane_skip_meta_explain',
      metadata: { input: ctx.trimmedInput },
    })
  }
  const metaExplainResult = !semanticLaneDetected ? await handleMetaExplain({
    trimmedInput: ctx.trimmedInput,
    docRetrievalState: ctx.docRetrievalState,
    messages: ctx.messages,
    lastClarification: ctx.lastClarification,
    clarificationCleared,
    knownTermsFetchStatus: ctx.knownTermsFetchStatus,
    usedCoreAppTermsFallback: ctx.usedCoreAppTermsFallback,
    addMessage: ctx.addMessage,
    updateDocRetrievalState: ctx.updateDocRetrievalState,
    setIsLoading: ctx.setIsLoading,
    setPendingOptions: ctx.setPendingOptions,
    setPendingOptionsMessageId: ctx.setPendingOptionsMessageId as (messageId: string) => void,
    setLastClarification: ctx.setLastClarification,
    saveLastOptionsShown: ctx.saveLastOptionsShown,
  }) : { handled: false }
  if (metaExplainResult.handled) {
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 2,
      tierLabel: 'meta_explain',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
    }
  }

  // Tier 2e: Correction ("no / not that" after doc retrieval)
  const correctionResult = handleCorrection({
    trimmedInput: ctx.trimmedInput,
    docRetrievalState: ctx.docRetrievalState,
    knownTermsFetchStatus: ctx.knownTermsFetchStatus,
    usedCoreAppTermsFallback: ctx.usedCoreAppTermsFallback,
    addMessage: ctx.addMessage,
    updateDocRetrievalState: ctx.updateDocRetrievalState,
    setIsLoading: ctx.setIsLoading,
  })
  if (correctionResult.handled) {
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 2,
      tierLabel: 'correction',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
    }
  }

  // Tier 2f: Follow-Up ("tell me more", pronoun follow-up)
  const followUpResult = await handleFollowUp({
    trimmedInput: ctx.trimmedInput,
    docRetrievalState: ctx.docRetrievalState,
    isNewQuestionOrCommandDetected,
    knownTermsFetchStatus: ctx.knownTermsFetchStatus,
    usedCoreAppTermsFallback: ctx.usedCoreAppTermsFallback,
    addMessage: ctx.addMessage,
    updateDocRetrievalState: ctx.updateDocRetrievalState,
    setIsLoading: ctx.setIsLoading,
  })

  const {
    classifierCalled,
    classifierResult,
    classifierTimeout,
    classifierLatencyMs,
    classifierError,
  } = followUpResult
  const isFollowUp = followUpResult.handled

  if (followUpResult.handled) {
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 2,
      tierLabel: 'follow_up',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
      classifierCalled,
      classifierResult,
      classifierTimeout,
      classifierLatencyMs,
      classifierError,
      isFollowUp: true,
    }
  }

  // Tier 2g: Preview Shortcut — "show all" expansion when a preview exists
  const PREVIEW_TIMEOUT_MS = 2 * 60 * 1000 // 2 minutes
  const previewIsRecent = ctx.lastPreview && (Date.now() - ctx.lastPreview.createdAt) < PREVIEW_TIMEOUT_MS

  if (previewIsRecent && ctx.lastPreview && matchesShowAllHeuristic(ctx.trimmedInput)) {
    // Keyword heuristic matched - open view panel directly
    void debugLog({
      component: 'ChatNavigation',
      action: 'show_all_shortcut',
      metadata: { source: ctx.lastPreview.source, totalCount: ctx.lastPreview.totalCount, method: 'heuristic', tier: '2g' },
    })

    if (ctx.lastPreview.drawerPanelId) {
      // Tier 2g: context_expand is exempt from strict-exact gate (addendum Rule B exemption).
      // Intent-pattern matching against temporal target, not name matching.
      const previewMeta = classifyExecutionMeta({
        matchKind: 'context_expand',
        candidateCount: 1,
        resolverPath: 'previewShortcut',
      })
      ctx.openPanelDrawer(ctx.lastPreview.drawerPanelId, ctx.lastPreview.drawerPanelTitle, previewMeta)
    } else {
      ctx.openPanelWithTracking(ctx.lastPreview.viewPanelContent, ctx.lastPreview.drawerPanelId)
    }

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: `Opening full list for ${ctx.lastPreview.source}.`,
      timestamp: new Date(),
      isError: false,
    }
    ctx.addMessage(assistantMessage)
    ctx.setIsLoading(false)
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 2,
      tierLabel: 'preview_shortcut_heuristic',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
      classifierCalled,
      classifierResult,
      classifierTimeout,
      classifierLatencyMs,
      classifierError,
      isFollowUp,
    }
  }

  // Tier 2g (cont.): LLM classifier fallback — if preview exists but heuristic didn't match,
  // ask the LLM if user wants to expand the preview
  if (previewIsRecent && ctx.lastPreview && !hasGraceSkipActionVerb(ctx.trimmedInput)) {
    try {
      const classifyResponse = await fetch('/api/chat/classify-expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: ctx.trimmedInput,
          previewSource: ctx.lastPreview.source,
          previewCount: ctx.lastPreview.totalCount,
        }),
      })

      if (classifyResponse.ok) {
        const { expand } = await classifyResponse.json()
        if (expand) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'show_all_shortcut',
            metadata: { source: ctx.lastPreview.source, totalCount: ctx.lastPreview.totalCount, method: 'classifier', tier: '2g' },
          })

          if (ctx.lastPreview.drawerPanelId) {
            // Tier 2g: context_expand is exempt from strict-exact gate (addendum Rule B exemption).
            // Intent-pattern matching against temporal target, not name matching.
            const classifierMeta = classifyExecutionMeta({
              matchKind: 'context_expand',
              candidateCount: 1,
              resolverPath: 'previewShortcut',
            })
            ctx.openPanelDrawer(ctx.lastPreview.drawerPanelId, ctx.lastPreview.drawerPanelTitle, classifierMeta)
          } else {
            ctx.openPanelWithTracking(ctx.lastPreview.viewPanelContent, ctx.lastPreview.drawerPanelId)
          }

          const assistantMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: `Opening full list for ${ctx.lastPreview.source}.`,
            timestamp: new Date(),
            isError: false,
          }
          ctx.addMessage(assistantMessage)
          ctx.setIsLoading(false)
          return {
            ...defaultResult,
            handled: true,
            handledByTier: 2,
            tierLabel: 'preview_shortcut_classifier',
            clarificationCleared,
            isNewQuestionOrCommandDetected,
            classifierCalled,
            classifierResult,
            classifierTimeout,
            classifierLatencyMs,
            classifierError,
            isFollowUp,
          }
        }
      }
    } catch (classifyError) {
      // Classifier failed - continue with normal intent parsing
      void debugLog({
        component: 'ChatNavigation',
        action: 'classify_expand_error',
        metadata: { error: String(classifyError), tier: '2g' },
      })
    }
  }

  // =========================================================================
  // TIER S — Suggestion Reject / Affirm
  //
  // Per suggestion-routing-unification-plan.md:
  // Runs AFTER stop/return/interrupt (Tiers 0–2) so "stop" is never
  // misinterpreted as a rejection. Returns a routing-only action for
  // sendMessage() to execute (no API calls in the dispatcher).
  //
  // Per plan §10: if stop/interrupt fired earlier while a suggestion was
  // active, clear lastSuggestion to avoid stale confirm/reject on next turn.
  // This is handled by the clarificationCleared flag — if clarification
  // intercept handled the input, we never reach this point.
  // =========================================================================
  if (ctx.lastSuggestion) {
    // Rejection: "no", "nope", "cancel" etc.
    if (isRejectionPhrase(ctx.trimmedInput)) {
      const rejectedLabels = ctx.lastSuggestion.candidates.map(c => c.label)

      void debugLog({
        component: 'ChatNavigation',
        action: 'suggestion_rejected',
        metadata: { rejectedLabels, userInput: ctx.trimmedInput, tier: 'S' },
      })

      // Clear suggestion state
      ctx.addRejectedSuggestions(rejectedLabels)
      ctx.setLastSuggestion(null)

      // Build response message
      let alternativesMessage = 'Okay — what would you like instead?'
      if (ctx.lastSuggestion.candidates.length > 1) {
        const alternativesList = ctx.lastSuggestion.candidates.map(c => c.label.toLowerCase()).join(', ')
        alternativesMessage = `Okay — what would you like instead?\nYou can try: ${alternativesList}.`
      }

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: alternativesMessage,
        timestamp: new Date(),
        isError: false,
      }
      ctx.addMessage(assistantMessage)
      ctx.setIsLoading(false)

      return {
        ...defaultResult,
        handled: true,
        handledByTier: 2,
        tierLabel: 'suggestion_reject',
        suggestionAction: {
          type: 'reject',
          rejectedLabels,
          alternativesMessage,
        },
        clarificationCleared,
        isNewQuestionOrCommandDetected,
      }
    }

    // Affirmation: "yes", "yeah", "sure" etc.
    if (isAffirmationPhrase(ctx.trimmedInput)) {
      const candidates = ctx.lastSuggestion.candidates

      if (candidates.length === 1) {
        // Single candidate: return action for sendMessage() to execute
        const candidate = candidates[0]

        void debugLog({
          component: 'ChatNavigation',
          action: 'affirmation_confirm_single',
          metadata: { candidate: candidate.label, primaryAction: candidate.primaryAction, tier: 'S' },
        })

        // Clear suggestion state (before API call in sendMessage)
        ctx.setLastSuggestion(null)
        ctx.clearRejectedSuggestions()

        return {
          ...defaultResult,
          handled: true,
          handledByTier: 2,
          tierLabel: 'suggestion_affirm_single',
          suggestionAction: {
            type: 'affirm_single',
            candidate,
          },
          clarificationCleared,
          isNewQuestionOrCommandDetected,
        }
      } else {
        // Multiple candidates: ask which one
        void debugLog({
          component: 'ChatNavigation',
          action: 'affirmation_multiple_candidates',
          metadata: { candidateCount: candidates.length, tier: 'S' },
        })

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'Which one?',
          timestamp: new Date(),
          isError: false,
          suggestions: {
            type: 'choose_multiple' as const,
            candidates: candidates,
          },
        }
        ctx.addMessage(assistantMessage)
        ctx.setIsLoading(false)

        return {
          ...defaultResult,
          handled: true,
          handledByTier: 2,
          tierLabel: 'suggestion_affirm_multiple',
          suggestionAction: {
            type: 'affirm_multiple',
            candidates,
          },
          clarificationCleared,
          isNewQuestionOrCommandDetected,
        }
      }
    }
  }

  // =========================================================================
  // TIER 3 — Clarification Sub-Tiers (post-intercept)
  //
  // These run after Tier 2 handlers. They handle selection patterns,
  // affirmation without context, and re-show options — all clarification-
  // adjacent behaviors that don't need deep snapshot state.
  // =========================================================================

  // Tier 3a: Selection-Only Guard — ordinals/labels on active option set
  // Guard #1 (per routing-order-priority-plan.md line 81):
  // "Runs only when activeOptionSetId != null (don't bind to old visible pills in history)"
  // Question intent override: questions like "what is X?" should never bind to active list
  // Widget context bypass (per universal-selection-resolver-plan.md Phase 5.2):
  // If widgetSelectionContext is active, skip this guard and defer to universal resolver
  // Focus latch bypass (per selection-intent-arbitration-incubation-plan.md Rule 2, 6):
  // When latch is active, selection-like input must resolve against the latched widget
  // in Tier 4.5, NOT against stale/recoverable chat options here.
  const hasActiveFocusLatch = isLatchEnabled && ctx.focusLatch && !ctx.focusLatch.suspended
  // Pre-latch bypass (per incubation plan Rule 12, relaxed with Phase 0 focus signal):
  // When a focused widget exists (activeSnapshotWidgetId) or exactly one list-segment visible,
  // no active chat, and input is selection-like → skip Tier 3a so Tier 4.5 resolves against widget.
  const isPreLatchWidgetScope = isLatchEnabled
    && (!ctx.focusLatch || ctx.focusLatch.suspended)
    && (isPreLatchDefault(turnSnapshot, ctx) || (!!turnSnapshot.activeSnapshotWidgetId && !ctx.lastClarification?.options?.length))
    && isSelectionLike(ctx.trimmedInput)
  if (ctx.pendingOptions.length > 0 && ctx.activeOptionSetId !== null && !hasQuestionIntent(ctx.trimmedInput) && !ctx.widgetSelectionContext && !hasActiveFocusLatch && !isPreLatchWidgetScope) {
    const optionLabels = ctx.pendingOptions.map(opt => opt.label)
    const selectionResult = isSelectionOnly(ctx.trimmedInput, ctx.pendingOptions.length, optionLabels, 'strict')

    if (selectionResult.isSelection && selectionResult.index !== undefined) {
      // Pure selection pattern - handle locally for speed
      const selectedOption = ctx.pendingOptions[selectionResult.index]

      void debugLog({
        component: 'ChatNavigation',
        action: 'selection_only_guard',
        metadata: {
          input: ctx.trimmedInput,
          index: selectionResult.index,
          selectedLabel: selectedOption.label,
          tier: '3a',
        },
        // V5 Metrics: Track clarification resolved
        metrics: {
          event: 'clarification_resolved',
          selectedLabel: selectedOption.label,
          timestamp: Date.now(),
        },
      })

      // Use grace window: keep options for one more turn
      ctx.setPendingOptionsGraceCount(1)

      if (selectedOption.type === 'widget_option') {
        const widgetInfo = resolveWidgetItemFromSnapshots(ctx.getVisibleSnapshots, selectedOption.id)
        if (widgetInfo) {
          trySetWidgetLatch({ widgetId: widgetInfo.widgetId, trigger: 'selection_only_widget_option' })
          ctx.setIsLoading(false)
          return {
            ...defaultResult,
            handled: true,
            handledByTier: 3,
            tierLabel: 'selection_only_widget_option',
            _devProvenanceHint: 'deterministic',
            clarificationCleared,
            isNewQuestionOrCommandDetected,
            classifierCalled,
            classifierResult,
            classifierTimeout,
            classifierLatencyMs,
            classifierError,
            isFollowUp,
            groundingAction: {
              type: 'execute_widget_item',
              widgetId: widgetInfo.widgetId,
              segmentId: widgetInfo.segmentId,
              itemId: selectedOption.id,
              itemLabel: selectedOption.label,
              action: 'open',
            },
          }
        }
      }

      // Execute the selection directly
      const optionToSelect: SelectionOption = {
        type: selectedOption.type as SelectionOption['type'],
        id: selectedOption.id,
        label: selectedOption.label,
        sublabel: selectedOption.sublabel,
        data: selectedOption.data as SelectionOption['data'],
      }

      ctx.setIsLoading(false)
      wrappedHandleSelectOption(optionToSelect)
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 3,
        tierLabel: 'selection_only_guard',
        _devProvenanceHint: 'deterministic',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }

    // Phase 2a.1: Try label matching for visible options — gated by confidence gate
    // High-confidence only executes deterministically; soft matches fall to LLM.
    const highConfidence = findHighConfidenceMatch(ctx.trimmedInput, ctx.pendingOptions)
    if (highConfidence) {
      const labelMatch = highConfidence.match
      void debugLog({
        component: 'ChatNavigation',
        action: 'label_match_selection',
        metadata: {
          input: ctx.trimmedInput,
          matchedLabel: labelMatch.label,
          confidence: highConfidence.confidence,
          reason: highConfidence.reason,
          tier: '3a',
        },
        // V5 Metrics: Track clarification resolved via label match
        metrics: {
          event: 'clarification_resolved',
          selectedLabel: labelMatch.label,
          timestamp: Date.now(),
        },
      })

      // Use grace window: keep options for one more turn
      ctx.setPendingOptionsGraceCount(1)

      if (labelMatch.type === 'widget_option') {
        const widgetInfo = resolveWidgetItemFromSnapshots(ctx.getVisibleSnapshots, labelMatch.id)
        if (widgetInfo) {
          trySetWidgetLatch({ widgetId: widgetInfo.widgetId, trigger: 'label_match_widget_option' })
          ctx.setIsLoading(false)
          return {
            ...defaultResult,
            handled: true,
            handledByTier: 3,
            tierLabel: 'label_match_widget_option',
            _devProvenanceHint: 'deterministic',
            clarificationCleared,
            isNewQuestionOrCommandDetected,
            classifierCalled,
            classifierResult,
            classifierTimeout,
            classifierLatencyMs,
            classifierError,
            isFollowUp,
            groundingAction: {
              type: 'execute_widget_item',
              widgetId: widgetInfo.widgetId,
              segmentId: widgetInfo.segmentId,
              itemId: labelMatch.id,
              itemLabel: labelMatch.label,
              action: 'open',
            },
          }
        }
      }

      // Execute the selection directly
      const optionToSelect: SelectionOption = {
        type: labelMatch.type as SelectionOption['type'],
        id: labelMatch.id,
        label: labelMatch.label,
        sublabel: labelMatch.sublabel,
        data: labelMatch.data as SelectionOption['data'],
      }

      ctx.setIsLoading(false)
      wrappedHandleSelectOption(optionToSelect)
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 3,
        tierLabel: 'label_match_selection',
        _devProvenanceHint: 'deterministic',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }

    // Soft-match candidate detection: bypass looksSelectionLike word-count gate
    // to ensure noisy inputs with a plausible match always reach the bounded LLM.
    const softCandidates = findOptionCandidates(ctx.trimmedInput, ctx.pendingOptions)
    const hasSoftMatchCandidate = softCandidates.length > 0

    if (hasSoftMatchCandidate) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'deterministic_gate_soft_match_to_llm',
        metadata: {
          input: ctx.trimmedInput,
          softCandidateCount: softCandidates.length,
          softCandidates: softCandidates.map(c => ({ label: c.option.label, matchType: c.matchType })),
          tier: '3a',
        },
      })
    }

    // Not a pure selection or label match.
    // Per clarification-response-fit-plan.md "Selection-Like Typos (NEW)":
    // Step 2: If input looks selection-like, call constrained LLM before falling through.
    // Step 3: If LLM abstains/low confidence → ask_clarify (NOT route to docs).
    // hasSoftMatchCandidate bypass: ensures noisy inputs with soft matches always reach LLM.
    if ((hasSoftMatchCandidate || looksSelectionLike(ctx.trimmedInput)) && isLLMFallbackEnabledClient()) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'selection_typo_llm_fallback_attempt',
        metadata: { input: ctx.trimmedInput, pendingCount: ctx.pendingOptions.length, tier: '3a' },
      })

      try {
        const llmResult = await callClarificationLLMClient({
          userInput: ctx.trimmedInput,
          options: ctx.pendingOptions.map(opt => ({
            id: opt.id,
            label: opt.label,
            sublabel: opt.sublabel,
          })),
          context: 'selection_typo_fallback',
        })

        if (llmResult.success && llmResult.response) {
          const { decision, choiceId, confidence } = llmResult.response

          void debugLog({
            component: 'ChatNavigation',
            action: 'selection_typo_llm_result',
            metadata: {
              input: ctx.trimmedInput,
              decision,
              choiceId,
              confidence,
              latencyMs: llmResult.latencyMs,
              tier: '3a',
            },
          })

          // LLM selected an option with sufficient confidence
          if (decision === 'select' && choiceId) {
            const matchedOption = ctx.pendingOptions.find(opt => opt.id === choiceId)
            if (matchedOption) {
              ctx.setPendingOptionsGraceCount(1)
              const optionToSelect: SelectionOption = {
                type: matchedOption.type as SelectionOption['type'],
                id: matchedOption.id,
                label: matchedOption.label,
                sublabel: matchedOption.sublabel,
                data: matchedOption.data as SelectionOption['data'],
              }
              ctx.setIsLoading(false)
              wrappedHandleSelectOption(optionToSelect)
              return {
                ...defaultResult,
                handled: true,
                handledByTier: 3,
                tierLabel: 'selection_typo_llm_select',
                clarificationCleared,
                isNewQuestionOrCommandDetected,
                classifierCalled: true,
                classifierResult: true,
                classifierTimeout,
                classifierLatencyMs: llmResult.latencyMs,
                classifierError,
                isFollowUp,
              }
            }
          }

          // LLM abstained or low confidence → ask_clarify (do NOT route to docs)
          if (decision === 'ask_clarify' || decision === 'none' || !choiceId) {
            const askMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: "I couldn't tell which option you meant. Could you try again or say 'back to options' to see the list?",
              timestamp: new Date(),
              isError: false,
            }
            ctx.addMessage(askMessage)
            ctx.setIsLoading(false)
            return {
              ...defaultResult,
              handled: true,
              handledByTier: 3,
              tierLabel: 'selection_typo_llm_ask_clarify',
              clarificationCleared,
              isNewQuestionOrCommandDetected,
              classifierCalled: true,
              classifierResult: false,
              classifierTimeout,
              classifierLatencyMs: llmResult.latencyMs,
              classifierError,
              isFollowUp,
            }
          }

          // decision === 'reroute' or 'reject_list' → let it fall through to later tiers
        }
        // LLM call failed — fall through gracefully
      } catch (llmError) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'selection_typo_llm_error',
          metadata: { input: ctx.trimmedInput, error: String(llmError), tier: '3a' },
        })
        // On LLM error, fall through to later tiers (graceful degradation)
      }
    } else {
      // Not selection-like or LLM disabled — log passthrough
      void debugLog({
        component: 'ChatNavigation',
        action: 'selection_guard_passthrough',
        metadata: { input: ctx.trimmedInput, pendingCount: ctx.pendingOptions.length, tier: '3a' },
      })
    }
  }

  // Tier 3a (cont.): Fallback Selection — use message-derived options when pendingOptions is empty
  // but activeOptionSetId is still set (options were presented recently and not yet cleared)
  // Focus latch + pre-latch bypass: same guards as primary Tier 3a — when latch is active or
  // pre-latch conditions met (Rule 12), skip message-derived selection to let Tier 4.5 resolve.
  if (ctx.pendingOptions.length === 0 && ctx.activeOptionSetId !== null && !hasQuestionIntent(ctx.trimmedInput) && !hasActiveFocusLatch && !isPreLatchWidgetScope) {
    const now = Date.now()
    const lastOptionsMessage = ctx.findLastOptionsMessage(ctx.messages)
    const messageAge = lastOptionsMessage ? now - lastOptionsMessage.timestamp.getTime() : null
    const isWithinGraceWindow = lastOptionsMessage && messageAge !== null && messageAge <= ctx.reshowWindowMs

    if (isWithinGraceWindow && lastOptionsMessage) {
      // Use selection-only guard for message-derived options too
      const optionLabels = lastOptionsMessage.options.map(opt => opt.label)
      const selectionResult = isSelectionOnly(ctx.trimmedInput, lastOptionsMessage.options.length, optionLabels, 'strict')

      if (selectionResult.isSelection && selectionResult.index !== undefined) {
        const selectedOption = lastOptionsMessage.options[selectionResult.index]
        void debugLog({
          component: 'ChatNavigation',
          action: 'selection_from_message',
          metadata: {
            input: ctx.trimmedInput,
            index: selectionResult.index,
            selectedLabel: selectedOption.label,
            tier: '3a',
          },
        })

        // Per universal-selection-resolver-plan.md: clear widget context when restoring chat options
        ctx.clearWidgetSelectionContext()
        // Restore pendingOptions and execute selection
        ctx.setPendingOptions(lastOptionsMessage.options)
        const optionToSelect: SelectionOption = {
          type: selectedOption.type as SelectionOption['type'],
          id: selectedOption.id,
          label: selectedOption.label,
          sublabel: selectedOption.sublabel,
          data: selectedOption.data as SelectionOption['data'],
        }
        ctx.setIsLoading(false)
        wrappedHandleSelectOption(optionToSelect)
        return {
          ...defaultResult,
          handled: true,
          handledByTier: 3,
          tierLabel: 'selection_from_message',
          _devProvenanceHint: 'deterministic',
          clarificationCleared,
          isNewQuestionOrCommandDetected,
          classifierCalled,
          classifierResult,
          classifierTimeout,
          classifierLatencyMs,
          classifierError,
          isFollowUp,
        }
      }

      // Tier 3a (cont.): Label/shorthand matching for message-derived options — gated by confidence gate.
      // High-confidence only executes deterministically; soft matches fall through to LLM.
      const messageLabelMatch = findHighConfidenceMatch(ctx.trimmedInput, lastOptionsMessage.options)
      if (messageLabelMatch) {
        const labelMatch = messageLabelMatch.match
        void debugLog({
          component: 'ChatNavigation',
          action: 'label_match_from_message',
          metadata: {
            input: ctx.trimmedInput,
            matchedLabel: labelMatch.label,
            confidence: messageLabelMatch.confidence,
            reason: messageLabelMatch.reason,
            tier: '3a',
          },
        })

        // Per universal-selection-resolver-plan.md: clear widget context when restoring chat options
        ctx.clearWidgetSelectionContext()
        // Restore pendingOptions and execute selection
        ctx.setPendingOptions(lastOptionsMessage.options)
        const optionToSelect: SelectionOption = {
          type: labelMatch.type as SelectionOption['type'],
          id: labelMatch.id,
          label: labelMatch.label,
          sublabel: labelMatch.sublabel,
          data: labelMatch.data as SelectionOption['data'],
        }
        ctx.setIsLoading(false)
        wrappedHandleSelectOption(optionToSelect)
        return {
          ...defaultResult,
          handled: true,
          handledByTier: 3,
          tierLabel: 'label_match_from_message',
          _devProvenanceHint: 'deterministic',
          clarificationCleared,
          isNewQuestionOrCommandDetected,
          classifierCalled,
          classifierResult,
          classifierTimeout,
          classifierLatencyMs,
          classifierError,
          isFollowUp,
        }
      }

      // Not a pure selection or label match - let it go to LLM with context
      void debugLog({
        component: 'ChatNavigation',
        action: 'message_options_passthrough_to_llm',
        metadata: { input: ctx.trimmedInput, optionsCount: lastOptionsMessage.options.length, tier: '3a' },
      })
    }
  }

  // Tier 3b: Affirmation Without Context — "yes" when no active suggestion
  if (!ctx.lastSuggestion && isAffirmationPhrase(ctx.trimmedInput)) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'affirmation_without_context',
      metadata: { userInput: ctx.trimmedInput, tier: '3b' },
    })

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: 'Yes to which option?',
      timestamp: new Date(),
      isError: false,
    }
    ctx.addMessage(assistantMessage)
    ctx.setIsLoading(false)
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 3,
      tierLabel: 'affirmation_without_context',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
      classifierCalled,
      classifierResult,
      classifierTimeout,
      classifierLatencyMs,
      classifierError,
      isFollowUp,
    }
  }

  // Tier 3c: Re-show Options — "show options", "what were those"
  if (matchesReshowPhrases(ctx.trimmedInput)) {
    const now = Date.now()
    const lastOptionsMessage = ctx.findLastOptionsMessage(ctx.messages)
    const messageAge = lastOptionsMessage ? now - lastOptionsMessage.timestamp.getTime() : null
    const isWithinGraceWindow = lastOptionsMessage && messageAge !== null && messageAge <= ctx.reshowWindowMs

    if (isWithinGraceWindow && lastOptionsMessage) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'reshow_options_deterministic',
        metadata: { optionsCount: lastOptionsMessage.options.length, messageAgeMs: messageAge, tier: '3c' },
      })

      // Re-render options without calling LLM
      const messageId = `assistant-${Date.now()}`
      const assistantMessage: ChatMessage = {
        id: messageId,
        role: 'assistant',
        content: 'Here are your options:',
        timestamp: new Date(),
        isError: false,
        options: lastOptionsMessage.options.map((opt) => ({
          type: opt.type as SelectionOption['type'],
          id: opt.id,
          label: opt.label,
          sublabel: opt.sublabel,
          data: opt.data as SelectionOption['data'],
        })),
      }
      ctx.addMessage(assistantMessage)

      // Per universal-selection-resolver-plan.md: clear widget context when restoring chat options
      ctx.clearWidgetSelectionContext()
      // Restore pendingOptions for selection handling
      ctx.setPendingOptions(lastOptionsMessage.options)
      ctx.setPendingOptionsMessageId(messageId)
      ctx.setPendingOptionsGraceCount(0)

      // Populate soft-active window so shorthand works after re-show
      ctx.saveLastOptionsShown(
        lastOptionsMessage.options.map(opt => ({ id: opt.id, label: opt.label, sublabel: opt.sublabel, type: opt.type })),
        messageId,
      )

      // Per options-visible-clarification-sync-plan.md: sync lastClarification on re-show
      ctx.setLastClarification({
        type: 'option_selection',
        originalIntent: 'reshow_options',
        messageId,
        timestamp: Date.now(),
        clarificationQuestion: 'Here are your options:',
        options: lastOptionsMessage.options.map(opt => ({
          id: opt.id,
          label: opt.label,
          sublabel: opt.sublabel,
          type: opt.type,
        })),
        metaCount: 0,
      })

      ctx.setIsLoading(false)
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 3,
        tierLabel: 'reshow_options',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    } else {
      // Grace window expired or no prior options
      void debugLog({
        component: 'ChatNavigation',
        action: 'reshow_options_expired',
        metadata: { hasLastOptionsMessage: !!lastOptionsMessage, messageAgeMs: messageAge, tier: '3c' },
      })

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: "No options are open. Say 'show quick links' to see them again.",
        timestamp: new Date(),
        isError: false,
      }
      ctx.addMessage(assistantMessage)
      ctx.setIsLoading(false)
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 3,
        tierLabel: 'reshow_options_expired',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }
  }

  // =========================================================================
  // TIER 3.5 — Universal Selection Follow-Up Resolver
  //
  // Per universal-selection-resolver-plan.md Phase 4:
  // Handle selection follow-ups that weren't caught by Tier 3a (which was
  // bypassed when widgetSelectionContext is active). This ensures widget
  // selection follow-ups route through execute_widget_item, not handleSelectOption.
  // =========================================================================
  const selectionResult = resolveSelectionFollowUp(
    ctx.trimmedInput,
    {
      pendingOptions: ctx.pendingOptions,
      activeOptionSetId: ctx.activeOptionSetId,
    },
    ctx.widgetSelectionContext,
    ctx.getVisibleSnapshots
  )

  if (selectionResult.handled) {
    if (selectionResult.groundingAction && selectionResult.groundingAction.type === 'execute_widget_item') {
      // Widget selection — return groundingAction for caller to execute
      void debugLog({
        component: 'ChatNavigation',
        action: 'universal_resolver_widget_selection',
        metadata: {
          input: ctx.trimmedInput,
          widgetId: selectionResult.groundingAction.widgetId,
          itemId: selectionResult.groundingAction.itemId,
          tier: '3.5',
        },
      })

      ctx.setIsLoading(false)

      // Phase 3c: selection correlation for widget-context selections.
      // Widget path doesn't call wrappedHandleSelectOption, so set directly.
      defaultResult._clarifierOriginMessageId = ctx.widgetSelectionContext?.optionSetId
      defaultResult._selectedOptionId = selectionResult.groundingAction.itemId

      // Clear widget selection context after successful resolution
      ctx.clearWidgetSelectionContext()
      if (selectionResult.groundingAction?.type === 'execute_widget_item') {
        trySetWidgetLatch({ widgetId: selectionResult.groundingAction.widgetId, trigger: 'universal_resolver_widget' })
      }
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 3,
        tierLabel: 'universal_resolver_widget',
        _devProvenanceHint: 'deterministic',
        groundingAction: selectionResult.groundingAction,
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }

    if (selectionResult.matchedChatOption) {
      // Chat selection — execute via handleSelectOption
      void debugLog({
        component: 'ChatNavigation',
        action: 'universal_resolver_chat_selection',
        metadata: {
          input: ctx.trimmedInput,
          selectedLabel: selectionResult.matchedChatOption.label,
          tier: '3.5',
        },
      })

      ctx.setPendingOptionsGraceCount(1)
      ctx.setIsLoading(false)

      // If it's a widget_option, resolve through execute_widget_item
      if (selectionResult.matchedChatOption.type === 'widget_option') {
        const widgetInfo = resolveWidgetItemFromSnapshots(ctx.getVisibleSnapshots, selectionResult.matchedChatOption.id)
        if (widgetInfo) {
          // Phase 3c: selection correlation for chat widget_option selections
          defaultResult._clarifierOriginMessageId =
            ctx.lastClarification?.messageId ?? ctx.widgetSelectionContext?.optionSetId
          defaultResult._selectedOptionId = selectionResult.matchedChatOption.id
          trySetWidgetLatch({ widgetId: widgetInfo.widgetId, trigger: 'universal_resolver_chat_widget_option' })
          return {
            ...defaultResult,
            handled: true,
            handledByTier: 3,
            tierLabel: 'universal_resolver_chat_widget_option',
            _devProvenanceHint: 'deterministic',
            groundingAction: {
              type: 'execute_widget_item',
              widgetId: widgetInfo.widgetId,
              segmentId: widgetInfo.segmentId,
              itemId: selectionResult.matchedChatOption.id,
              itemLabel: selectionResult.matchedChatOption.label,
              action: 'open',
            },
            clarificationCleared,
            isNewQuestionOrCommandDetected,
            classifierCalled,
            classifierResult,
            classifierTimeout,
            classifierLatencyMs,
            classifierError,
            isFollowUp,
          }
        }
      }

      // Regular chat option — execute via handleSelectOption
      const optionToSelect: SelectionOption = {
        type: selectionResult.matchedChatOption.type as SelectionOption['type'],
        id: selectionResult.matchedChatOption.id,
        label: selectionResult.matchedChatOption.label,
        sublabel: selectionResult.matchedChatOption.sublabel,
        data: selectionResult.matchedChatOption.data as SelectionOption['data'],
      }

      wrappedHandleSelectOption(optionToSelect)
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 3,
        tierLabel: 'universal_resolver_chat',
        _devProvenanceHint: 'deterministic',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }
  }

  // =========================================================================
  // TIER 3.6 — Hybrid Selection Resolver (Deterministic Miss → Constrained LLM)
  //
  // Per universal-selection-resolver-plan.md Phase 4 & Reliability Addendum item 8:
  // If an active executable selection context exists and deterministic
  // ordinal/label matching failed, call constrained LLM with active context
  // candidates. Retry prompt only as final fallback after LLM need_more_info/error.
  //
  // IMPORTANT: Do NOT trigger for new commands (e.g., "open links panel d").
  // These should escape the selection context and execute normally via Tier 4.
  // =========================================================================
  // Recoverable chat context: lastOptionsShown has recently-shown options even when
  // pendingOptions was cleared by Tier 2a explicit command bypass.
  // Guard: if widget lists are currently visible, do not recover stale chat options.
  const hasVisibleWidgetListInRegistry = ctx.getVisibleSnapshots().some(snapshot =>
    snapshot.segments.some(segment =>
      segment.segmentType === 'list' &&
      Array.isArray((segment as { items?: unknown[] }).items) &&
      ((segment as { items?: unknown[] }).items?.length ?? 0) > 0
    )
  )
  const hasRecoverableChatContext = ctx.pendingOptions.length === 0
    && ctx.lastOptionsShown !== null
    && ctx.lastOptionsShown.options.length > 0
    && ctx.lastOptionsShown.turnsSinceShown <= SOFT_ACTIVE_TURN_LIMIT
    && !hasVisibleWidgetListInRegistry

  const hasActiveExecutableContext =
    (ctx.widgetSelectionContext !== null && ctx.widgetSelectionContext.turnsSinceShown < WIDGET_SELECTION_TTL) ||
    (ctx.pendingOptions.length > 0 && ctx.activeOptionSetId !== null) ||
    hasRecoverableChatContext

  // Explicit command escape (Phase 4 step 3):
  // If input has an action verb + non-selection target, it's a new command, not a selection miss.
  // Let it fall through to Tier 4 known-noun routing.
  const hasSelectionKeyword = /\b(option|choice|item)\b/i.test(ctx.trimmedInput)
  const looksLikeNewCommand = ACTION_VERB_PATTERN.test(ctx.trimmedInput)
    && !isSelectionOnly(ctx.trimmedInput, 10, [], 'embedded').isSelection
    && !hasSelectionKeyword

  if (hasActiveExecutableContext && isSelectionLike(ctx.trimmedInput) && !looksLikeNewCommand && !isNewQuestionOrCommandDetected) {
    // Deterministic matching failed but input is selection-like with active context.
    // Try constrained LLM before showing retry prompt.
    void debugLog({
      component: 'ChatNavigation',
      action: 'deterministic_miss_trying_constrained_llm',
      metadata: {
        input: ctx.trimmedInput,
        hasWidgetContext: ctx.widgetSelectionContext !== null,
        hasChatContext: ctx.pendingOptions.length > 0,
        hasRecoverableChatContext,
        hasVisibleWidgetListInRegistry,
        tier: '3.6',
      },
    })

    // Build candidates from active context.
    // Priority: pendingOptions > lastOptionsShown (recoverable) > widgetSelectionContext
    // This ensures recently-shown clarification options are preferred over ambient widget items.
    const llmCandidates: { id: string; label: string; type: string; actionHint?: string }[] = []
    let sourceContext: 'chat' | 'recoverable_chat' | 'widget' = 'chat'

    if (ctx.pendingOptions.length > 0 && ctx.activeOptionSetId !== null) {
      // Priority 1: Active chat context (pendingOptions)
      for (const opt of ctx.pendingOptions) {
        llmCandidates.push({ id: opt.id, label: opt.label, type: opt.type || 'option' })
      }
      sourceContext = 'chat'
    } else if (hasRecoverableChatContext && ctx.lastOptionsShown) {
      // Priority 2: Recoverable chat context (lastOptionsShown — cleared by Tier 2a but still recent)
      for (const opt of ctx.lastOptionsShown.options) {
        llmCandidates.push({ id: opt.id, label: opt.label, type: opt.type || 'option' })
      }
      sourceContext = 'recoverable_chat'
    } else if (ctx.widgetSelectionContext !== null && ctx.widgetSelectionContext.turnsSinceShown < WIDGET_SELECTION_TTL) {
      // Priority 3: Widget context
      for (const opt of ctx.widgetSelectionContext.options) {
        llmCandidates.push({ id: opt.id, label: opt.label, type: 'widget_option', actionHint: 'open' })
      }
      sourceContext = 'widget'
    }

    if (llmCandidates.length > 0 && isGroundingLLMEnabled()) {
      try {
        const llmResult = await callGroundingLLM({
          userInput: ctx.trimmedInput,
          candidates: llmCandidates,
        })

        void debugLog({
          component: 'ChatNavigation',
          action: llmResult.success ? 'tier3_6_constrained_llm_called' : 'tier3_6_constrained_llm_error',
          metadata: {
            input: ctx.trimmedInput,
            success: llmResult.success,
            decision: llmResult.response?.decision,
            choiceId: llmResult.response?.choiceId,
            confidence: llmResult.response?.confidence,
            latencyMs: llmResult.latencyMs,
            sourceContext,
            error: llmResult.error,
          },
        })

        if (llmResult.success && llmResult.response?.decision === 'select' && llmResult.response.choiceId) {
          const choiceId = llmResult.response.choiceId

          // Safety: validate choiceId is in candidates
          const validChoice = llmCandidates.find(c => c.id === choiceId)
          if (validChoice) {
            if (sourceContext === 'widget' && ctx.widgetSelectionContext) {
              // Widget execution path
              void debugLog({
                component: 'ChatNavigation',
                action: 'tier3_6_llm_widget_select',
                metadata: { choiceId, label: validChoice.label, confidence: llmResult.response.confidence },
              })
              ctx.clearWidgetSelectionContext()
              ctx.setIsLoading(false)
              return {
                ...defaultResult,
                handled: true,
                handledByTier: 3,
                tierLabel: 'tier3_6_constrained_llm_widget_select',
                clarificationCleared,
                isNewQuestionOrCommandDetected,
                classifierCalled,
                classifierResult,
                classifierTimeout,
                classifierLatencyMs,
                classifierError,
                isFollowUp,
                groundingAction: {
                  type: 'execute_widget_item',
                  widgetId: ctx.widgetSelectionContext.widgetId,
                  segmentId: ctx.widgetSelectionContext.segmentId,
                  itemId: choiceId,
                  itemLabel: validChoice.label,
                  action: 'open',
                },
              }
            } else {
              // Chat / recoverable-chat execution path
              // For recoverable context, pendingOptions is empty — look up from findLastOptionsMessage
              const matchingOption = ctx.pendingOptions.find(opt => opt.id === choiceId)
                || (sourceContext === 'recoverable_chat'
                  ? ctx.findLastOptionsMessage(ctx.messages)?.options.find(opt => opt.id === choiceId)
                  : undefined)

              // widget_option with type+data must fall through to the widget handler at line ~2430,
              // not handleSelectOption (which doesn't handle 'widget_option' type).
              const matchingOptionIsWidget = matchingOption && 'type' in matchingOption
                && (matchingOption as { type: string }).type === 'widget_option'
              if (matchingOption && 'type' in matchingOption && 'data' in matchingOption && !matchingOptionIsWidget) {
                void debugLog({
                  component: 'ChatNavigation',
                  action: 'tier3_6_llm_chat_select',
                  metadata: {
                    choiceId,
                    label: validChoice.label,
                    confidence: llmResult.response.confidence,
                    sourceContext,
                  },
                })
                wrappedHandleSelectOption(matchingOption as unknown as SelectionOption)
                ctx.setIsLoading(false)
                return {
                  ...defaultResult,
                  handled: true,
                  handledByTier: 3,
                  tierLabel: sourceContext === 'recoverable_chat'
                    ? 'tier3_6_constrained_llm_recoverable_chat_select'
                    : 'tier3_6_constrained_llm_chat_select',
                  clarificationCleared,
                  isNewQuestionOrCommandDetected,
                  classifierCalled,
                  classifierResult,
                  classifierTimeout,
                  classifierLatencyMs,
                  classifierError,
                  isFollowUp,
                }
              }
              // Chat option found but missing type/data — resolve via widget snapshots
              const matchingOptionType = (matchingOption as { type?: string } | undefined)?.type
              if (matchingOptionType === 'widget_option') {
                const widgetInfo = resolveWidgetItemFromSnapshots(ctx.getVisibleSnapshots, choiceId)
                if (widgetInfo) {
                  void debugLog({
                    component: 'ChatNavigation',
                    action: 'tier3_6_llm_chat_widget_option_select',
                    metadata: { choiceId, label: validChoice.label, widgetId: widgetInfo.widgetId },
                  })
                  trySetWidgetLatch({ widgetId: widgetInfo.widgetId, trigger: 'tier3_6_llm_chat_widget_option' })
                  ctx.setIsLoading(false)
                  return {
                    ...defaultResult,
                    handled: true,
                    handledByTier: 3,
                    tierLabel: 'tier3_6_constrained_llm_chat_widget_select',
                    clarificationCleared,
                    isNewQuestionOrCommandDetected,
                    classifierCalled,
                    classifierResult,
                    classifierTimeout,
                    classifierLatencyMs,
                    classifierError,
                    isFollowUp,
                    groundingAction: {
                      type: 'execute_widget_item',
                      widgetId: widgetInfo.widgetId,
                      segmentId: widgetInfo.segmentId,
                      itemId: choiceId,
                      itemLabel: validChoice.label,
                      action: 'open',
                    },
                  }
                }
              }
            }
          }
        }
        // LLM returned need_more_info, invalid choiceId, or error — fall through to retry prompt
      } catch (err) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'tier3_6_constrained_llm_exception',
          metadata: { input: ctx.trimmedInput, error: String(err) },
        })
        // Fall through to retry prompt
      }
    }

    // Final fallback: targeted retry prompt (LLM disabled, failed, or returned need_more_info)
    const retryMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: "I didn't catch that. Say 'first', 'second', etc. or tap an option pill.",
      timestamp: new Date(),
      isError: false,
    }
    ctx.addMessage(retryMessage)
    ctx.setIsLoading(false)

    return {
      ...defaultResult,
      handled: true,
      handledByTier: 3,
      tierLabel: 'deterministic_miss_retry',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
      classifierCalled,
      classifierResult,
      classifierTimeout,
      classifierLatencyMs,
      classifierError,
      isFollowUp,
    }
  }

  // =========================================================================
  // TIER 4 — Known-Noun Commands
  //
  // Per routing-order-priority-plan.md Core Principle #4:
  // "Known-noun commands should execute before docs."
  //
  // Priority within Tier 4:
  //   1. Question signal → skip (let Tier 5 handle)
  //   2. Exact known-noun match → execute (open panel)
  //   3. Near match (fuzzy) → "Did you mean ___?"
  //   4. No match → fall through to Tier 5
  //
  // Rule: If a known-noun executes while a paused snapshot exists,
  // the snapshot remains paused (no implicit resume).
  // =========================================================================

  // turnSnapshot already built before intercept (see above)

  const hasSoftActiveSelectionLike = ctx.activeOptionSetId === null
    && !!ctx.lastOptionsShown
    && ctx.lastOptionsShown.options.length > 0
    && isSelectionLike(ctx.trimmedInput, { hasBadgeLetters: turnSnapshot.hasBadgeLetters })

  // hasVisibleWidgetItems already computed with turnSnapshot above

  const knownNounResult = handleKnownNounRouting({
    trimmedInput: ctx.trimmedInput,
    visibleWidgets: ctx.uiContext?.dashboard?.visibleWidgets,
    addMessage: ctx.addMessage,
    setIsLoading: ctx.setIsLoading,
    openPanelDrawer: ctx.openPanelDrawer,
    setPendingOptions: ctx.setPendingOptions,
    setPendingOptionsMessageId: ctx.setPendingOptionsMessageId,
    setPendingOptionsGraceCount: ctx.setPendingOptionsGraceCount,
    setActiveOptionSetId: ctx.setActiveOptionSetId,
    setLastClarification: ctx.setLastClarification,
    handleSelectOption: wrappedHandleSelectOption,
    hasActiveOptionSet: ctx.pendingOptions.length > 0 && ctx.activeOptionSetId !== null,
    hasSoftActiveSelectionLike,
    hasVisibleWidgetList: hasVisibleWidgetItems,
    saveLastOptionsShown: ctx.saveLastOptionsShown,
    clearWidgetSelectionContext: ctx.clearWidgetSelectionContext,
    clearLastOptionsShown: ctx.clearLastOptionsShown,
    clearClarificationSnapshot: ctx.clearClarificationSnapshot,
    clearFocusLatch: isLatchEnabled ? ctx.clearFocusLatch : undefined,
  })
  if (knownNounResult.handled) {
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 4,
      tierLabel: 'known_noun',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
      classifierCalled,
      classifierResult,
      classifierTimeout,
      classifierLatencyMs,
      classifierError,
      isFollowUp,
    }
  }

  // =========================================================================
  // TIER 4.5 — Grounding-Set Fallback
  //
  // Per grounding-set-fallback-plan.md: After deterministic routing fails,
  // use a small explicit "grounding set" to prevent dead-end replies.
  // Insertion point: after Tier 4 (known-noun) and before Tier 5 (doc retrieval).
  //
  // Decision flow:
  //   1) Check paused re-anchor (stop-paused ordinal guidance)
  //   2) Check soft-active window (post-action selection persistence)
  //   3) Build grounding sets → multi-list guard → deterministic match
  //   4) If deterministic fails + candidates exist → constrained LLM
  //   5) If no candidates → ask missing slot
  // =========================================================================
  if (semanticLaneDetected) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'semantic_lane_skip_grounding',
      metadata: { input: ctx.trimmedInput },
    })
  }
  if (!semanticLaneDetected) {
    // NOTE: Paused re-anchor (H) is NOT handled here — it's already handled by
    // the stop-paused ordinal guard in handleClarificationIntercept() (Tier 0,
    // chat-routing.ts lines 1987-2009). That runs before Tier 4.5, so stop-paused
    // ordinals never reach here. Duplicating it would risk double-messages.
    // checkPausedReAnchor() is exported for future use if Tier 0 logic changes.

    // turnSnapshot is already built before Tier 4 (see above) and reused here.

    // G) Soft-active window check — uses lastOptionsShown (dedicated state),
    // NOT clarificationSnapshot (which has a different lifecycle).
    const softActiveOptions = (ctx.activeOptionSetId === null && ctx.lastOptionsShown)
      ? ctx.lastOptionsShown.options
      : null
    const isSoftActive = softActiveOptions !== null && softActiveOptions.length > 0
      && isSelectionLike(ctx.trimmedInput, { hasBadgeLetters: turnSnapshot.hasBadgeLetters })

    // ActiveWidget preference: reorder openWidgets so the active widget's list
    // comes first. Only affects ordinal binding when no widget is named explicitly
    // and checkMultiListAmbiguity has already passed.
    if (turnSnapshot.activeSnapshotWidgetId && turnSnapshot.openWidgets.length > 1) {
      const activeIdx = turnSnapshot.openWidgets.findIndex(
        w => w.id === turnSnapshot.activeSnapshotWidgetId
      )
      if (activeIdx > 0) {
        const [active] = turnSnapshot.openWidgets.splice(activeIdx, 1)
        turnSnapshot.openWidgets.unshift(active)
      }
    }

    // Build grounding context from existing state
    // Per raw-strict-exact plan Phase 3: pass visibleWidgets as visible_panels
    // so bounded LLM can resolve non-exact panel commands.
    // No mode guard — match Tier 2c (line 1359) which accesses
    // dashboard?.visibleWidgets without mode check. Presence of
    // visibleWidgets is the real signal, not the mode field.
    const dashboardVisibleWidgets = ctx.uiContext?.dashboard?.visibleWidgets
    const groundingCtx = buildGroundingContext({
      // If soft-active, treat as having an active option set
      activeOptionSetId: isSoftActive ? 'soft-active' : ctx.activeOptionSetId,
      lastClarification: isSoftActive
        ? { type: 'option_selection' as const, originalIntent: '', messageId: '', timestamp: Date.now(), options: softActiveOptions! }
        : ctx.lastClarification,
      clarificationSnapshot: ctx.clarificationSnapshot,
      sessionState: ctx.sessionState,
      repairMemory: ctx.repairMemory,
      openWidgets: turnSnapshot.openWidgets,
      visiblePanels: dashboardVisibleWidgets,
    })

    // Determine activeWidgetId with correct pre-latch guard
    // Per selection-intent-arbitration-incubation-plan Rules 2, 6, 12:
    let activeWidgetId: string | undefined
    if (isLatchEnabled && ctx.focusLatch && !ctx.focusLatch.suspended) {
      // Latch active → scope to latched widget (Rule 2, 6, Test 9)
      if (ctx.focusLatch.kind === 'resolved') {
        activeWidgetId = ctx.focusLatch.widgetId
      } else {
        // Pending latch: widget not yet registered, use activeSnapshotWidgetId as fallback
        activeWidgetId = turnSnapshot.activeSnapshotWidgetId ?? undefined
      }
    } else if (isLatchEnabled && (!ctx.focusLatch || ctx.focusLatch.suspended) && isPreLatchDefault(turnSnapshot, ctx)) {
      // Pre-latch Rule 12 (strict): exactly one fresh visible list-segment, no active chat
      // activeSnapshotWidgetId may be null (no panel focused), so fall back to sole visible widget
      activeWidgetId = turnSnapshot.activeSnapshotWidgetId
        ?? turnSnapshot.openWidgets.find(w => w.listSegmentCount > 0)?.id
    } else if (isLatchEnabled && (!ctx.focusLatch || ctx.focusLatch.suspended)
        && turnSnapshot.activeSnapshotWidgetId
        && !ctx.lastClarification?.options?.length
        && isSelectionLike(ctx.trimmedInput)) {
      // Pre-latch focused (relaxed): widget has UI focus + no active chat + selection-like input.
      // Handles dashboards with multiple list segments (totalListSegmentCount > 1) where
      // the focus signal from Phase 0 disambiguates which widget the ordinal targets.
      activeWidgetId = turnSnapshot.activeSnapshotWidgetId
    }
    // else: no activeWidgetId → multi-list ambiguity handling fires normally

    // Pending latch + no activeWidgetId: widget hasn't registered yet.
    // Per plan: only swallow selection-like inputs; let commands/questions fall through normally.
    // The latchBlocksStaleChat invariant (in handleClarificationIntercept) still prevents stale-chat capture.
    if (isLatchEnabled && ctx.focusLatch && ctx.focusLatch.kind === 'pending' && !activeWidgetId
        && isSelectionLike(ctx.trimmedInput, { hasBadgeLetters: turnSnapshot.hasBadgeLetters })) {
      if (ctx.focusLatch.turnsSinceLatched === 0) {
        // First turn with pending latch + selection-like input — show loading message
        const loadingMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'Still loading that panel — try again in a moment.',
          timestamp: new Date(),
          isError: false,
        }
        ctx.addMessage(loadingMsg)
        ctx.setIsLoading(false)
        void debugLog({ component: 'ChatNavigation', action: 'pending_latch_still_loading', metadata: { pendingPanelId: ctx.focusLatch.pendingPanelId, turnsSinceLatched: 0 } })
        return { ...defaultResult, handled: true }
      }
      // Cooldown: turnsSinceLatched > 0 — return handled silently (no message, no fall-through
      // to Tier 4.5 grounding) to prevent multi-list ambiguity from firing against unresolved pending latch.
      // The latch will either resolve on the next validity check or expire at turnsSinceLatched >= 2.
      void debugLog({ component: 'ChatNavigation', action: 'pending_latch_cooldown_silent', metadata: { pendingPanelId: ctx.focusLatch.pendingPanelId, turnsSinceLatched: ctx.focusLatch.turnsSinceLatched } })
      ctx.setIsLoading(false)
      return { ...defaultResult, handled: true }
    }

    // Run grounding-set fallback
    const groundingResult = handleGroundingSetFallback(ctx.trimmedInput, groundingCtx, {
      hasBadgeLetters: turnSnapshot.hasBadgeLetters,
      activeWidgetId,
    })

    // Handle multi-list ambiguity
    if (groundingResult.multiListAmbiguity && groundingResult.askClarifier) {
      const ambiguityMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: groundingResult.clarifierMessage || 'I see multiple option lists open. Which one do you mean?',
        timestamp: new Date(),
        isError: false,
      }
      ctx.addMessage(ambiguityMsg)
      ctx.setIsLoading(false)

      return {
        ...defaultResult,
        handled: true,
        handledByTier: 4,
        tierLabel: 'grounding_multi_list_ambiguity',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }

    // Deterministic match succeeded
    if (groundingResult.handled && groundingResult.selectedCandidate) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'grounding_deterministic_select',
        metadata: {
          input: ctx.trimmedInput,
          candidateId: groundingResult.selectedCandidate.id,
          candidateLabel: groundingResult.selectedCandidate.label,
          resolvedBy: groundingResult.resolvedBy,
        },
      })

      // Execute the selected candidate
      // For option-type candidates, use handleSelectOption
      if (groundingResult.selectedCandidate.type === 'option' ||
          groundingResult.selectedCandidate.type === 'widget_option') {
        // Find matching option in pendingOptions or snapshot
        const matchingOption = ctx.pendingOptions.find(
          opt => opt.id === groundingResult.selectedCandidate!.id
        ) || (ctx.clarificationSnapshot?.options.find(
          opt => opt.id === groundingResult.selectedCandidate!.id
        ))

        // widget_option must fall through to the dedicated execute_widget_item handler,
        // not handleSelectOption (which doesn't handle 'widget_option' type).
        if (matchingOption && 'type' in matchingOption && 'data' in matchingOption
            && groundingResult.selectedCandidate!.type !== 'widget_option') {
          wrappedHandleSelectOption(matchingOption as unknown as SelectionOption)
          ctx.setIsLoading(false)
          return {
            ...defaultResult,
            handled: true,
            handledByTier: 4,
            tierLabel: 'grounding_deterministic_select',
            clarificationCleared,
            isNewQuestionOrCommandDetected,
            classifierCalled,
            classifierResult,
            classifierTimeout,
            classifierLatencyMs,
            classifierError,
            isFollowUp,
          }
        }

        // Fallback: recover full option data from the most recent options message
        const lastOptionsMessage = ctx.findLastOptionsMessage(ctx.messages)
        const messageAge = lastOptionsMessage ? Date.now() - lastOptionsMessage.timestamp.getTime() : null
        const isWithinWindow = lastOptionsMessage
          && messageAge !== null
          && messageAge <= ctx.reshowWindowMs
        const messageOption = isWithinWindow
          ? lastOptionsMessage.options.find(opt => opt.id === groundingResult.selectedCandidate!.id)
          : null

        // widget_option must route to the dedicated execute_widget_item handler below,
        // not through handleSelectOption (which doesn't handle 'widget_option' type).
        if (messageOption && groundingResult.selectedCandidate!.type !== 'widget_option') {
          const optionToSelect: SelectionOption = {
            type: messageOption.type as SelectionOption['type'],
            id: messageOption.id,
            label: messageOption.label,
            sublabel: messageOption.sublabel,
            data: messageOption.data as SelectionOption['data'],
          }
          wrappedHandleSelectOption(optionToSelect)
          ctx.setIsLoading(false)
          return {
            ...defaultResult,
            handled: true,
            handledByTier: 4,
            tierLabel: 'grounding_deterministic_select_message_fallback',
            clarificationCleared,
            isNewQuestionOrCommandDetected,
            classifierCalled,
            classifierResult,
            classifierTimeout,
            classifierLatencyMs,
            classifierError,
            isFollowUp,
          }
        }
      }

      // Widget registry item — not in chat options (expected for registry items).
      // Return execute_widget_item for sendMessage() to handle.
      if (groundingResult.selectedCandidate.type === 'widget_option') {
        const sourceWidget = turnSnapshot.openWidgets.find(w =>
          w.options.some(opt => opt.id === groundingResult.selectedCandidate!.id)
        )

        void debugLog({
          component: 'ChatNavigation',
          action: 'grounding_widget_item_execute',
          metadata: {
            candidateId: groundingResult.selectedCandidate.id,
            candidateLabel: groundingResult.selectedCandidate.label,
            widgetId: sourceWidget?.id,
          },
        })

        // Latch-on: successful widget item resolution (Phase 5a)
        trySetWidgetLatch({ widgetId: sourceWidget?.id, trigger: 'grounding_widget_item_execute' })

        return {
          ...defaultResult,
          handled: true,
          handledByTier: 4,
          tierLabel: 'grounding_widget_item_execute',
          clarificationCleared,
          isNewQuestionOrCommandDetected,
          classifierCalled,
          classifierResult,
          classifierTimeout,
          classifierLatencyMs,
          classifierError,
          isFollowUp,
          groundingAction: {
            type: 'execute_widget_item',
            widgetId: sourceWidget?.id || '',
            segmentId: findSourceSegmentId(sourceWidget?.id, groundingResult.selectedCandidate.id),
            itemId: groundingResult.selectedCandidate.id,
            itemLabel: groundingResult.selectedCandidate.label,
            action: 'open',
          },
        }
      }

      // Option found but missing 'type'/'data' fields — can't execute.
      // Log and fall through to Tier 5.
      void debugLog({
        component: 'ChatNavigation',
        action: 'grounding_deterministic_select_no_executable',
        metadata: {
          candidateId: groundingResult.selectedCandidate!.id,
          reason: 'matching_option_missing_fields',
        },
      })
    }

    // LLM fallback needed
    if (groundingResult.needsLLM && groundingResult.llmCandidates && groundingResult.llmCandidates.length > 0) {
      // Verify-question bypass: "did/have I/we/you open(ed)..." should NOT enter grounding LLM.
      // These are historical queries, not selection attempts. Send to main API for intent classification.
      const isVerifyBypass = isVerifyOpenQuestion(ctx.trimmedInput)

      // Previous `isCommandPanelIntent` skip removed: Tier 2c already runs before Tier 4.5 and
      // handles strict-exact panel matches. If Tier 2c returned handled:false, the input is
      // non-exact — it should enter bounded grounding LLM, not bypass it.
      // The loose `matchVisiblePanelCommand().type !== 'none'` check let normalized/partial
      // matches (e.g., "plsss" token pollution) skip grounding LLM entirely, falling to
      // unbounded API LLM with variable results.

      if (isVerifyBypass) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'grounding_llm_skipped_verify_question',
          metadata: {
            input: ctx.trimmedInput,
            candidateCount: groundingResult.llmCandidates.length,
            reason: 'verify_question_bypass_to_api',
          },
        })
        // Fall through — verify question should reach intent API, not grounding LLM.
      } else if (isGroundingLLMEnabled()) {
        try {
          // Stage 4 G4: Validate candidates before they enter the LLM prompt
          const g4Validation = validateGroundingCandidates(groundingResult.llmCandidates)

          if (g4Validation.rejected.length > 0) {
            void debugLog({
              component: 'ChatNavigation',
              action: 'g4_validator_rejected',
              metadata: {
                input: ctx.trimmedInput,
                totalIn: g4Validation.stats.totalIn,
                totalOut: g4Validation.stats.totalOut,
                rejections: g4Validation.stats.rejectionsByReason,
              },
            })
          }

          // If all candidates rejected, skip LLM — fall through to clarifier/Tier 5
          if (g4Validation.validated.length === 0) {
            void debugLog({
              component: 'ChatNavigation',
              action: 'g4_validator_all_rejected',
              metadata: {
                input: ctx.trimmedInput,
                totalIn: g4Validation.stats.totalIn,
                rejections: g4Validation.stats.rejectionsByReason,
              },
            })
            // Attach G4 telemetry even when skipping LLM
            defaultResult._llmTelemetry = {
              decision: 'error',
              candidateCount: 0,
              rejectionReason: null,
              g4TotalIn: g4Validation.stats.totalIn,
              g4TotalOut: 0,
              g4DuplicatesRemoved: g4Validation.stats.duplicatesRemoved,
              g4Rejections: g4Validation.stats.rejectionsByReason,
            }
            // Fall through to Tier 5 / clarifier
          } else {
          // Stage 4 G2+G3: Cap and trim validated candidates
          const g23CapTrim = capAndTrimCandidates(g4Validation.validated)

          if (g23CapTrim.stats.wasTrimmed) {
            void debugLog({
              component: 'ChatNavigation',
              action: 'g23_cap_trimmed',
              metadata: {
                input: ctx.trimmedInput,
                preCapCount: g23CapTrim.stats.preCapCount,
                postCapCount: g23CapTrim.stats.postCapCount,
                trimmedIds: g23CapTrim.stats.trimmedIds,
              },
            })
          }

          const llmCandidates = g23CapTrim.capped

          // Per incubation plan §Observability: log LLM attempt
          void debugLog({ component: 'ChatNavigation', action: 'selection_dual_source_llm_attempt', metadata: { input: ctx.trimmedInput, candidateCount: llmCandidates.length, activeWidgetId } })

          const llmResult = await callGroundingLLM({
            userInput: ctx.trimmedInput,
            candidates: llmCandidates.map(c => ({
              id: c.id,
              label: c.label,
              type: c.type,
              actionHint: c.actionHint,
            })),
          })

          void debugLog({
            component: 'ChatNavigation',
            action: llmResult.success ? 'grounding_llm_called' : 'grounding_llm_error',
            metadata: {
              input: ctx.trimmedInput,
              success: llmResult.success,
              decision: llmResult.response?.decision,
              choiceId: llmResult.response?.choiceId,
              confidence: llmResult.response?.confidence,
              latencyMs: llmResult.latencyMs,
              error: llmResult.error,
            },
          })

          // Per incubation plan §Observability: log LLM result
          void debugLog({ component: 'ChatNavigation', action: 'selection_dual_source_llm_result', metadata: { success: llmResult.success, decision: llmResult.response?.decision, choiceId: llmResult.response?.choiceId, latencyMs: llmResult.latencyMs } })

          // Stage 4: Capture bounded LLM telemetry for durable log
          defaultResult._llmTelemetry = {
            decision: llmResult.success
              ? (llmResult.response?.decision ?? 'error')
              : (llmResult.error === 'Timeout' ? 'timeout' : 'error'),
            confidence: llmResult.response?.confidence,
            latencyMs: llmResult.latencyMs,
            choiceId: llmResult.rawChoiceId,
            candidateCount: llmCandidates.length,
            rejectionReason: llmResult.rejectionReason ?? null,
            g4TotalIn: g4Validation.stats.totalIn,
            g4TotalOut: g4Validation.stats.totalOut,
            g4DuplicatesRemoved: g4Validation.stats.duplicatesRemoved,
            g4Rejections: g4Validation.stats.rejectionsByReason,
            g23PreCapCount: g23CapTrim.stats.preCapCount,
            g23PostCapCount: g23CapTrim.stats.postCapCount,
            g23WasTrimmed: g23CapTrim.stats.wasTrimmed,
            g23TrimmedIds: g23CapTrim.stats.wasTrimmed ? g23CapTrim.stats.trimmedIds : undefined,
            g1ShadowRejected: llmResult.g1ShadowRejected,
          }

          if (llmResult.success && llmResult.response) {
            if (llmResult.response.decision === 'select' && llmResult.response.choiceId) {
              // ---------------------------------------------------------------
              // Stage 4 G7: Near-tie guard (shadow mode — log only, no behavior change)
              // When >= 2 validated candidates have B2 scores, check if the margin
              // between top-1 and top-2 is below the configured threshold.
              // Only computed on the post-G4/post-G2 candidate set (llmCandidates).
              // ---------------------------------------------------------------
              const G7_NEAR_TIE_MARGIN = 0.02
              if (semanticCandidatesForReorder && semanticCandidatesForReorder.length > 0) {
                // Build B2 score map: grounding candidate ID → best similarity score
                // Same matching logic as clarifier-reorder.ts:144-156
                const b2ScoreMap = new Map<string, number>()
                for (const sc of semanticCandidatesForReorder) {
                  const itemId = sc.slots_json?.itemId as string | undefined
                  const candidateId = sc.slots_json?.candidateId as string | undefined
                  for (const id of [itemId, candidateId]) {
                    if (id) {
                      const existing = b2ScoreMap.get(id)
                      if (existing === undefined || sc.similarity_score > existing) {
                        b2ScoreMap.set(id, sc.similarity_score)
                      }
                    }
                  }
                }

                // Score the post-G4/post-G2 candidate set
                const b2ScoredCandidates = llmCandidates
                  .map(c => ({ id: c.id, score: b2ScoreMap.get(c.id) }))
                  .filter((c): c is { id: string; score: number } => c.score !== undefined)
                  .sort((a, b) => b.score - a.score)

                if (b2ScoredCandidates.length >= 2) {
                  const top1Score = b2ScoredCandidates[0].score
                  const top2Score = b2ScoredCandidates[1].score
                  const margin = top1Score - top2Score
                  const nearTieDetected = margin < G7_NEAR_TIE_MARGIN

                  if (defaultResult._llmTelemetry) {
                    defaultResult._llmTelemetry.g7NearTieDetected = nearTieDetected
                    defaultResult._llmTelemetry.g7Margin = margin
                    defaultResult._llmTelemetry.g7Top1Score = top1Score
                    defaultResult._llmTelemetry.g7Top2Score = top2Score
                    defaultResult._llmTelemetry.g7CandidateBasis = 'b2_scored_validated'
                  }

                  if (nearTieDetected) {
                    void debugLog({
                      component: 'ChatNavigation',
                      action: 'g7_near_tie_detected',
                      metadata: {
                        input: ctx.trimmedInput,
                        margin,
                        top1Score,
                        top2Score,
                        top1Id: b2ScoredCandidates[0].id,
                        top2Id: b2ScoredCandidates[1].id,
                      },
                    })
                  }
                }
                // else: fewer than 2 B2-scored candidates → G7 fields absent (by design)
              }
              // ---------------------------------------------------------------
              // End G7 near-tie guard shadow
              // ---------------------------------------------------------------

              // LLM selected a candidate — find and execute
              const selected = groundingResult.llmCandidates.find(
                c => c.id === llmResult.response!.choiceId
              )

              if (selected) {
                // ---------------------------------------------------------------
                // Stage 4 G5: TOCTOU shadow revalidation (log-only, no behavior change)
                // Check if the selected candidate's backing target still exists.
                // Three outcomes: pass (verified fresh), fail (target gone),
                // not_revalidated (no reliable freshness source for this candidate type).
                // ---------------------------------------------------------------
                const toctouWindowMs = Date.now() - turnSnapshot.capturedAtMs
                let toctouResult: 'pass' | 'fail' | 'not_revalidated' = 'not_revalidated'
                let toctouReason: string | null = null

                if (selected.source === 'active_options') {
                  // Check if option still exists in current pending options
                  const stillInPending = ctx.pendingOptions.some(opt => opt.id === selected.id)
                  if (stillInPending) {
                    toctouResult = 'pass'
                  } else {
                    toctouResult = 'fail'
                    toctouReason = 'option_not_in_pending'
                  }
                } else if (selected.source === 'paused_snapshot') {
                  // Check if option still exists in clarification snapshot
                  const stillInSnapshot = ctx.clarificationSnapshot?.options.some(opt => opt.id === selected.id)
                  if (stillInSnapshot) {
                    toctouResult = 'pass'
                  } else {
                    toctouResult = 'fail'
                    toctouReason = 'snapshot_option_gone'
                  }
                } else if (selected.source === 'widget_list') {
                  // Rebuild fresh snapshot to check if widget option still exists
                  const freshSnapshot = buildTurnSnapshot({})
                  const stillExists = freshSnapshot.openWidgets.some(w =>
                    w.options.some(opt => opt.id === selected.id)
                  )
                  if (stillExists) {
                    toctouResult = 'pass'
                  } else {
                    toctouResult = 'fail'
                    toctouReason = 'widget_option_gone'
                  }
                } else if (selected.source === 'visible_panels') {
                  // Fresh panel state via widget snapshot registry (not the stale ctx.uiContext closure).
                  // selected.id is the panel UUID; match against panelId on fresh visible snapshots.
                  const freshSnapshots = ctx.getVisibleSnapshots()
                  const stillVisible = freshSnapshots.some(s => s.panelId === selected.id)
                  if (stillVisible) {
                    toctouResult = 'pass'
                  } else {
                    toctouResult = 'fail'
                    toctouReason = 'panel_not_visible'
                  }
                } else if (selected.source === 'recent_referent') {
                  // Referent registry is static but referenced target may be stale.
                  // No reliable freshness check available in shadow mode.
                  toctouResult = 'not_revalidated'
                  toctouReason = 'referent_no_freshness_source'
                } else if (selected.source === 'capability') {
                  // Capabilities are static definitions but may have stateful preconditions.
                  // No reliable freshness check available.
                  toctouResult = 'not_revalidated'
                  toctouReason = 'capability_no_freshness_source'
                }

                // Attach G5 telemetry to LLM telemetry block
                if (defaultResult._llmTelemetry) {
                  defaultResult._llmTelemetry.g5ToctouResult = toctouResult
                  defaultResult._llmTelemetry.g5ToctouReason = toctouReason ?? undefined
                  defaultResult._llmTelemetry.g5ToctouWindowMs = toctouWindowMs
                }

                void debugLog({
                  component: 'ChatNavigation',
                  action: 'g5_toctou_shadow',
                  metadata: {
                    candidateId: selected.id,
                    candidateSource: selected.source,
                    result: toctouResult,
                    reason: toctouReason,
                    windowMs: toctouWindowMs,
                  },
                })
                // ---------------------------------------------------------------
                // End G5 TOCTOU shadow
                // ---------------------------------------------------------------

                void debugLog({
                  component: 'ChatNavigation',
                  action: 'grounding_llm_select',
                  metadata: {
                    candidateId: selected.id,
                    candidateLabel: selected.label,
                    confidence: llmResult.response.confidence,
                  },
                })

                // Try to execute via handleSelectOption
                const matchingOption = ctx.pendingOptions.find(opt => opt.id === selected.id)
                  || (ctx.clarificationSnapshot?.options.find(opt => opt.id === selected.id))

                // widget_option must fall through to the dedicated execute_widget_item handler,
                // not handleSelectOption (which doesn't handle 'widget_option' type).
                if (matchingOption && 'type' in matchingOption && 'data' in matchingOption
                    && selected.type !== 'widget_option') {
                  wrappedHandleSelectOption(matchingOption as unknown as SelectionOption)
                  ctx.setIsLoading(false)
                  return {
                    ...defaultResult,
                    handled: true,
                    handledByTier: 4,
                    tierLabel: 'grounding_llm_select',
                    clarificationCleared,
                    isNewQuestionOrCommandDetected,
                    classifierCalled,
                    classifierResult,
                    classifierTimeout,
                    classifierLatencyMs,
                    classifierError,
                    isFollowUp,
                    _devProvenanceHint: 'llm_executed' as const,
                  }
                }

                // Fallback: recover full option data from the most recent options message
                const lastOptionsMessage = ctx.findLastOptionsMessage(ctx.messages)
                const messageAge = lastOptionsMessage ? Date.now() - lastOptionsMessage.timestamp.getTime() : null
                const isWithinWindow = lastOptionsMessage
                  && messageAge !== null
                  && messageAge <= ctx.reshowWindowMs
                const messageOption = isWithinWindow
                  ? lastOptionsMessage.options.find(opt => opt.id === selected.id)
                  : null

                // widget_option must route to the dedicated execute_widget_item handler below,
                // not through handleSelectOption (which doesn't handle 'widget_option' type).
                // Per universal-selection-resolver-plan.md:10.
                if (messageOption && selected.type !== 'widget_option') {
                  const optionToSelect: SelectionOption = {
                    type: messageOption.type as SelectionOption['type'],
                    id: messageOption.id,
                    label: messageOption.label,
                    sublabel: messageOption.sublabel,
                    data: messageOption.data as SelectionOption['data'],
                  }
                  wrappedHandleSelectOption(optionToSelect)
                  ctx.setIsLoading(false)
                  return {
                    ...defaultResult,
                    handled: true,
                    handledByTier: 4,
                    tierLabel: 'grounding_llm_select_message_fallback',
                    clarificationCleared,
                    isNewQuestionOrCommandDetected,
                    classifierCalled,
                    classifierResult,
                    classifierTimeout,
                    classifierLatencyMs,
                    classifierError,
                    isFollowUp,
                    _devProvenanceHint: 'llm_executed' as const,
                  }
                }

                // Referent-type candidate selected by LLM but not in pending options.
                // Per plan §5: "LLM select → execute deterministically."
                // Return a structured action for sendMessage() to execute via navigate API,
                // following the same pattern as suggestionAction.
                if (selected.type === 'referent') {
                  const action = selected.actionHint || 'open'
                  const syntheticMessage = `${action} ${selected.label}`

                  void debugLog({
                    component: 'ChatNavigation',
                    action: 'grounding_referent_execute',
                    metadata: {
                      candidateId: selected.id,
                      candidateLabel: selected.label,
                      actionHint: selected.actionHint,
                      syntheticMessage,
                    },
                  })

                  return {
                    ...defaultResult,
                    handled: true,
                    handledByTier: 4,
                    tierLabel: 'grounding_llm_referent_execute',
                    clarificationCleared,
                    isNewQuestionOrCommandDetected,
                    classifierCalled,
                    classifierResult,
                    classifierTimeout,
                    classifierLatencyMs,
                    classifierError,
                    isFollowUp,
                    _devProvenanceHint: 'llm_executed' as const,
                    groundingAction: {
                      type: 'execute_referent',
                      syntheticMessage,
                      candidateId: selected.id,
                      candidateLabel: selected.label,
                      actionHint: selected.actionHint,
                    },
                  }
                }

                // Widget registry item selected by LLM
                if (selected.type === 'widget_option') {
                  const sourceWidget = turnSnapshot.openWidgets.find(w =>
                    w.options.some(opt => opt.id === selected.id)
                  )

                  void debugLog({
                    component: 'ChatNavigation',
                    action: 'grounding_llm_widget_item_execute',
                    metadata: {
                      candidateId: selected.id,
                      candidateLabel: selected.label,
                      widgetId: sourceWidget?.id,
                      confidence: llmResult.response!.confidence,
                    },
                  })

                  trySetWidgetLatch({ widgetId: sourceWidget?.id, trigger: 'grounding_llm_widget_item_execute' })

                  return {
                    ...defaultResult,
                    handled: true,
                    handledByTier: 4,
                    tierLabel: 'grounding_llm_widget_item_execute',
                    clarificationCleared,
                    isNewQuestionOrCommandDetected,
                    classifierCalled,
                    classifierResult,
                    classifierTimeout,
                    classifierLatencyMs,
                    classifierError,
                    isFollowUp,
                    _devProvenanceHint: 'llm_executed' as const,
                    groundingAction: {
                      type: 'execute_widget_item',
                      widgetId: sourceWidget?.id || '',
                      segmentId: findSourceSegmentId(sourceWidget?.id, selected.id),
                      itemId: selected.id,
                      itemLabel: selected.label,
                      action: 'open',
                    },
                  }
                }

                // Visible-panel candidate selected by LLM — open panel drawer.
                // Panel candidates carry type: 'option' + source: 'visible_panels' in the
                // grounding pipeline. Without this handler, LLM-selected panel candidates
                // silently fall through to Tier 5 (no handler for option-type without
                // message history, referent, or widget_option match).
                if (selected.source === 'visible_panels') {
                  void debugLog({
                    component: 'ChatNavigation',
                    action: 'grounding_llm_panel_execute',
                    metadata: {
                      candidateId: selected.id,
                      candidateLabel: selected.label,
                      confidence: llmResult.response!.confidence,
                    },
                  })

                  const panelMeta = classifyExecutionMeta({
                    matchKind: 'partial' as const,
                    candidateCount: groundingResult.llmCandidates.length,
                    resolverPath: 'handleGroundingSet',
                  })
                  ctx.openPanelDrawer(selected.id, selected.label, panelMeta)

                  const panelMsg: ChatMessage = {
                    id: `assistant-${Date.now()}`,
                    role: 'assistant',
                    content: `Opening ${selected.label}...`,
                    timestamp: new Date(),
                    isError: false,
                  }
                  ctx.addMessage(panelMsg)
                  ctx.setIsLoading(false)

                  return {
                    ...defaultResult,
                    handled: true,
                    handledByTier: 4,
                    tierLabel: 'grounding_llm_panel_execute',
                    clarificationCleared,
                    isNewQuestionOrCommandDetected,
                    classifierCalled,
                    classifierResult,
                    classifierTimeout,
                    classifierLatencyMs,
                    classifierError,
                    isFollowUp,
                    _devProvenanceHint: 'llm_executed' as const,
                    // Phase 5: pass panel identity for client-side navigation writeback
                    _groundingPanelOpen: { panelId: selected.id, panelTitle: selected.label },
                  }
                }
              }
            }

            // need_more_info or failed select → ask grounded clarifier
            if (llmResult.response.decision === 'need_more_info' || !llmResult.response.choiceId) {
              void debugLog({
                component: 'ChatNavigation',
                action: 'grounding_llm_need_more_info',
                metadata: { input: ctx.trimmedInput },
              })

              // Stage 6: enforcement or shadow on Stage 4 abstain
              // Skip if content-intent already triggered S6 for this turn (6x.3)
              if (!contentIntentMatchedThisTurn) {
                const s6SessionId = getRoutingLogSessionId()
                const s6TurnIndex = ctx.messages.filter(m => m.role === 'user').length
                const s6LastMsg = [...ctx.messages].reverse().find(m => m.role === 'user')
                const s6InteractionId = s6LastMsg?.id ?? deriveFallbackInteractionId(s6SessionId, s6TurnIndex, ctx.trimmedInput)
                const s6Params = {
                  userInput: ctx.trimmedInput,
                  groundingCandidates: groundingResult.llmCandidates.map(c => ({
                    id: c.id,
                    label: c.label,
                    source: c.source ?? c.type ?? 'unknown',
                  })),
                  escalationReason: 'stage4_abstain' as const,
                  interactionId: s6InteractionId,
                  sessionId: s6SessionId,
                  turnIndex: s6TurnIndex,
                }

                // Enforcement mode: await S6 loop, execute if action_executed, else fall through
                if (process.env.NEXT_PUBLIC_STAGE6_ENFORCE_ENABLED === 'true') {
                  const s6Result = await runS6EnforcementLoop(s6Params)
                  if (s6Result?.outcome === 'action_executed' && s6Result.actionResult?.action === 'open_panel') {
                    const targetId = s6Result.telemetry.s6_action_target_id ?? ''
                    const s6Sig: S6ActionSignature = { interactionId: s6InteractionId, actionType: 'open_panel', targetId }
                    if (!isDuplicateAction(s6Sig, s6ExecutedActions)) {
                      const parsedAction: S6ParsedAction = {
                        action: 'open_panel',
                        panelSlug: targetId,
                      }
                      const bridgeResult = await executeS6OpenPanel(
                        s6Result.actionResult,
                        parsedAction,
                        (panelId, panelTitle) => ctx.openPanelDrawer(panelId, panelTitle),
                      )
                      if (bridgeResult.executed) {
                        s6ExecutedActions.push(s6Sig)
                        const s6Msg: ChatMessage = {
                          id: `assistant-${Date.now()}`,
                          role: 'assistant',
                          content: `Opening ${bridgeResult.panelLabel ?? bridgeResult.panelSlug}...`,
                          timestamp: new Date(),
                          isError: false,
                        }
                        ctx.addMessage(s6Msg)
                        ctx.setIsLoading(false)

                        return {
                          ...defaultResult,
                          handled: true,
                          handledByTier: 6,
                          tierLabel: `s6_enforced:open_panel`,
                          clarificationCleared,
                          isNewQuestionOrCommandDetected,
                          classifierCalled,
                          classifierResult,
                          classifierTimeout,
                          classifierLatencyMs,
                          classifierError,
                          isFollowUp,
                          _devProvenanceHint: 's6_enforced' as const,
                        }
                      }
                    }
                    // Bridge failed, TOCTOU stale, or duplicate → fall through to normal clarifier
                  }
                  // S6 loop returned non-action or null → fall through to normal clarifier
                } else {
                  // Shadow mode: fire-and-forget
                  void runS6ShadowLoop(s6Params)
                }
              }

              // Single visible-panel candidate + command form → auto-execute.
              // A single-option clarifier for command-form panel requests adds friction
              // without disambiguation value. The bounded LLM already evaluated the
              // candidate set (scoped by panel evidence matching).
              // Provenance: 'llm_executed' — LLM was consulted in the pipeline.
              // This does NOT violate strict-exact rules: no verb stripping for
              // deterministic authorization. The candidate was found through advisory
              // panel evidence matching, the LLM was consulted, and execution is a
              // post-LLM single-candidate heuristic.
              const singlePanelCandidate = groundingResult.llmCandidates.length === 1
                && isExplicitCommand(ctx.trimmedInput)
                && groundingResult.llmCandidates[0].source === 'visible_panels'
                ? groundingResult.llmCandidates[0]
                : null

              if (singlePanelCandidate && ctx.openPanelDrawer) {
                void debugLog({
                  component: 'ChatNavigation',
                  action: 'grounding_llm_single_panel_auto_execute',
                  metadata: {
                    candidateId: singlePanelCandidate.id,
                    candidateLabel: singlePanelCandidate.label,
                    llmDecision: llmResult.response.decision,
                    reason: 'single_visible_panel_command_form',
                  },
                })

                const panelMeta = classifyExecutionMeta({
                  matchKind: 'partial' as const,
                  candidateCount: 1,
                  resolverPath: 'handleGroundingSet',
                })
                ctx.openPanelDrawer(singlePanelCandidate.id, singlePanelCandidate.label, panelMeta)

                const panelMsg: ChatMessage = {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: `Opening ${singlePanelCandidate.label}...`,
                  timestamp: new Date(),
                  isError: false,
                }
                ctx.addMessage(panelMsg)
                ctx.setIsLoading(false)

                return {
                  ...defaultResult,
                  handled: true,
                  handledByTier: 4,
                  tierLabel: 'grounding_llm_single_panel_auto_execute',
                  clarificationCleared,
                  isNewQuestionOrCommandDetected,
                  classifierCalled,
                  classifierResult,
                  classifierTimeout,
                  classifierLatencyMs,
                  classifierError,
                  isFollowUp,
                  _devProvenanceHint: 'llm_executed' as const,
                }
              }

              const clarifierMsgId = `assistant-${Date.now()}`
              const effectiveCandidates = maybeActiveReorder(groundingResult.llmCandidates)
              const boundOptions = bindGroundingClarifierOptions(ctx, effectiveCandidates, clarifierMsgId)
              const clarifierMsg: ChatMessage = {
                id: clarifierMsgId,
                role: 'assistant',
                content: buildGroundedClarifier(effectiveCandidates),
                timestamp: new Date(),
                isError: false,
                options: boundOptions.map(opt => ({
                  type: opt.type as SelectionOption['type'],
                  id: opt.id,
                  label: opt.label,
                  sublabel: opt.sublabel,
                  data: opt.data as SelectionOption['data'],
                })),
              }
              ctx.addMessage(clarifierMsg)
              ctx.setIsLoading(false)

              // Per incubation plan §Observability: LLM generated clarifier wording
              void debugLog({ component: 'ChatNavigation', action: 'selection_clarifier_llm_generated', metadata: { candidateCount: effectiveCandidates.length, input: ctx.trimmedInput } })

              attachClarifierReorderTelemetry(defaultResult, groundingResult.llmCandidates, clarifierMsgId, b2LookupStatus)
              return {
                ...defaultResult,
                handled: true,
                handledByTier: 4,
                tierLabel: 'grounding_llm_need_more_info',
                clarificationCleared,
                isNewQuestionOrCommandDetected,
                classifierCalled,
                classifierResult,
                classifierTimeout,
                classifierLatencyMs,
                classifierError,
                isFollowUp,
                _devProvenanceHint: 'llm_influenced' as const,
              }
            }
          }

          // LLM failed/timeout — ask same grounded clarifier (no silent fallthrough)
          if (!llmResult.success) {
            void debugLog({
              component: 'ChatNavigation',
              action: 'grounding_llm_timeout',
              metadata: { error: llmResult.error, latencyMs: llmResult.latencyMs },
            })

            // Stage 6: enforcement or shadow on Stage 4 timeout
            // Skip if content-intent already triggered S6 for this turn (6x.3)
            if (!contentIntentMatchedThisTurn) {
              const s6SessionId = getRoutingLogSessionId()
              const s6TurnIndex = ctx.messages.filter(m => m.role === 'user').length
              const s6LastMsg = [...ctx.messages].reverse().find(m => m.role === 'user')
              const s6InteractionId = s6LastMsg?.id ?? deriveFallbackInteractionId(s6SessionId, s6TurnIndex, ctx.trimmedInput)
              const s6Params = {
                userInput: ctx.trimmedInput,
                groundingCandidates: groundingResult.llmCandidates.map(c => ({
                  id: c.id,
                  label: c.label,
                  source: c.source ?? c.type ?? 'unknown',
                })),
                escalationReason: 'stage4_timeout' as const,
                interactionId: s6InteractionId,
                sessionId: s6SessionId,
                turnIndex: s6TurnIndex,
              }

              // Enforcement mode: await S6 loop, execute if action_executed, else fall through
              if (process.env.NEXT_PUBLIC_STAGE6_ENFORCE_ENABLED === 'true') {
                const s6Result = await runS6EnforcementLoop(s6Params)
                if (s6Result?.outcome === 'action_executed' && s6Result.actionResult?.action === 'open_panel') {
                  const targetId = s6Result.telemetry.s6_action_target_id ?? ''
                  const s6Sig: S6ActionSignature = { interactionId: s6InteractionId, actionType: 'open_panel', targetId }
                  if (!isDuplicateAction(s6Sig, s6ExecutedActions)) {
                    const parsedAction: S6ParsedAction = {
                      action: 'open_panel',
                      panelSlug: targetId,
                    }
                    const bridgeResult = await executeS6OpenPanel(
                      s6Result.actionResult,
                      parsedAction,
                      (panelId, panelTitle) => ctx.openPanelDrawer(panelId, panelTitle),
                    )
                    if (bridgeResult.executed) {
                      s6ExecutedActions.push(s6Sig)
                      const s6Msg: ChatMessage = {
                        id: `assistant-${Date.now()}`,
                        role: 'assistant',
                        content: `Opening ${bridgeResult.panelLabel ?? bridgeResult.panelSlug}...`,
                        timestamp: new Date(),
                        isError: false,
                      }
                      ctx.addMessage(s6Msg)
                      ctx.setIsLoading(false)

                      return {
                        ...defaultResult,
                        handled: true,
                        handledByTier: 6,
                        tierLabel: `s6_enforced:open_panel`,
                        clarificationCleared,
                        isNewQuestionOrCommandDetected,
                        classifierCalled,
                        classifierResult,
                        classifierTimeout,
                        classifierLatencyMs,
                        classifierError,
                        isFollowUp,
                        _devProvenanceHint: 's6_enforced' as const,
                      }
                    }
                  }
                  // Bridge failed, TOCTOU stale, or duplicate → fall through to timeout clarifier
                }
                // S6 loop returned non-action or null → fall through to timeout clarifier
              } else {
                // Shadow mode: fire-and-forget
                void runS6ShadowLoop(s6Params)
              }
            }

            const clarifierMsgId = `assistant-${Date.now()}`
            const effectiveCandidatesTimeout = maybeActiveReorder(groundingResult.llmCandidates)
            const boundOptions = bindGroundingClarifierOptions(ctx, effectiveCandidatesTimeout, clarifierMsgId)
            const clarifierMsg: ChatMessage = {
              id: clarifierMsgId,
              role: 'assistant',
              content: buildGroundedClarifier(effectiveCandidatesTimeout),
              timestamp: new Date(),
              isError: false,
              options: boundOptions.map(opt => ({
                type: opt.type as SelectionOption['type'],
                id: opt.id,
                label: opt.label,
                sublabel: opt.sublabel,
                data: opt.data as SelectionOption['data'],
              })),
            }
            ctx.addMessage(clarifierMsg)
            ctx.setIsLoading(false)

            // Per incubation plan §Observability: template fallback used on LLM failure
            void debugLog({ component: 'ChatNavigation', action: 'selection_clarifier_llm_fallback_template', metadata: { reason: 'llm_timeout', candidateCount: groundingResult.llmCandidates.length, input: ctx.trimmedInput } })

            attachClarifierReorderTelemetry(defaultResult, groundingResult.llmCandidates, clarifierMsgId, b2LookupStatus)
            return {
              ...defaultResult,
              handled: true,
              handledByTier: 4,
              tierLabel: 'grounding_llm_fallback_clarifier',
              clarificationCleared,
              isNewQuestionOrCommandDetected,
              classifierCalled,
              classifierResult,
              classifierTimeout,
              classifierLatencyMs,
              classifierError,
              isFollowUp,
              _devProvenanceHint: 'llm_influenced' as const,
            }
          }
        } // end G4 validated.length > 0 else block
        } catch (error) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'grounding_llm_error',
            metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
          })
          // Fall through to Tier 5
        }
      } else {
        // Grounding LLM disabled — show clarifier with candidates instead of falling through
        // This prevents the main API from misinterpreting widget-scoped selection as panel commands
        defaultResult._llmTelemetry = {
          decision: 'disabled',
          candidateCount: groundingResult.llmCandidates.length,
          rejectionReason: null,
        }
        void debugLog({
          component: 'ChatNavigation',
          action: 'grounding_llm_disabled_clarifier',
          metadata: {
            input: ctx.trimmedInput,
            candidateCount: groundingResult.llmCandidates.length,
            candidates: groundingResult.llmCandidates.slice(0, 5).map(c => c.label),
          },
        })

        const clarifierMsgId = `assistant-${Date.now()}`
        const effectiveCandidatesFallback = maybeActiveReorder(groundingResult.llmCandidates)
        const boundOptions = bindGroundingClarifierOptions(ctx, effectiveCandidatesFallback, clarifierMsgId)
        const clarifierMsg: ChatMessage = {
          id: clarifierMsgId,
          role: 'assistant',
          content: buildGroundedClarifier(effectiveCandidatesFallback),
          timestamp: new Date(),
          isError: false,
          options: boundOptions.map(opt => ({
            type: opt.type as SelectionOption['type'],
            id: opt.id,
            label: opt.label,
            sublabel: opt.sublabel,
            data: opt.data as SelectionOption['data'],
          })),
        }
        ctx.addMessage(clarifierMsg)
        ctx.setIsLoading(false)

        // Per incubation plan §Observability: template fallback (LLM disabled)
        void debugLog({ component: 'ChatNavigation', action: 'selection_clarifier_llm_fallback_template', metadata: { reason: 'llm_disabled', candidateCount: groundingResult.llmCandidates.length, input: ctx.trimmedInput } })

        attachClarifierReorderTelemetry(defaultResult, groundingResult.llmCandidates, clarifierMsgId, b2LookupStatus)
        return {
          ...defaultResult,
          handled: true,
          handledByTier: 4,
          tierLabel: 'grounding_llm_disabled_clarifier',
          clarificationCleared,
          isNewQuestionOrCommandDetected,
          classifierCalled,
          classifierResult,
          classifierTimeout,
          classifierLatencyMs,
          classifierError,
          isFollowUp,
        }
      }
    }

    // No list grounding set — ask for missing slot.
    // handleGroundingSetFallback already verified input is selection-like
    // before setting askClarifier=true, so no redundant check needed.
    if (groundingResult.askClarifier && !groundingResult.needsLLM) {
      const clarifierMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: groundingResult.clarifierMessage || "I'm not sure what you're referring to. Could you tell me what you'd like to do?",
        timestamp: new Date(),
        isError: false,
      }
      ctx.addMessage(clarifierMsg)
      ctx.setIsLoading(false)

      return {
        ...defaultResult,
        handled: true,
        handledByTier: 4,
        tierLabel: 'grounding_missing_slot',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }
  }

  // Per grounding-set-fallback-plan.md §G: increment soft-active turn counter
  // AFTER Tier 4.5 so the soft-active check can read the state before it expires.
  // If Tier 4.5 handled the input, it returned early and this line is never reached,
  // which is correct — a used soft-active turn should still count.
  if (ctx.incrementLastOptionsShownTurn) {
    ctx.incrementLastOptionsShownTurn()
  }

  // Per universal-selection-resolver-plan.md: increment widget selection turn counter
  // in parallel with lastOptionsShown turn counter.
  if (ctx.incrementWidgetSelectionTurn) {
    ctx.incrementWidgetSelectionTurn()
  }

  // =========================================================================
  // TIER 4.6 — Widget Context Questions
  //
  // Per widget-ui-snapshot-plan.md: When user asks about "this widget" and
  // widget context segments exist, skip doc retrieval and let the API handle
  // it with widgetContextSegments in the payload.
  //
  // Patterns: "what does this widget mean?", "what is this widget?",
  //           "explain this widget", "tell me about this widget"
  // =========================================================================
  const widgetContextQuestionPattern = /\b(this|the)\s+(widget|panel)\b/i
  const isWidgetContextQuestion = widgetContextQuestionPattern.test(ctx.trimmedInput)

  if (isWidgetContextQuestion) {
    // Check if we have visible widget snapshots with context segments
    const visibleSnapshots = ctx.getVisibleSnapshots?.() ?? []
    const hasWidgetContext = visibleSnapshots.some(snap =>
      snap.segments.some(seg => seg.segmentType === 'context')
    )

    if (hasWidgetContext) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'tier_4_6_widget_context_question',
        metadata: {
          input: ctx.trimmedInput,
          snapshotCount: visibleSnapshots.length,
          reason: 'skip_docs_use_widget_context',
        },
      })

      // Return handled: false so it falls through to the API call,
      // where widgetContextSegments will be included in the payload
      return {
        ...defaultResult,
        handled: false,
        handledByTier: undefined,
        tierLabel: 'widget_context_passthrough',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }
  }

  // =========================================================================
  // TIER 5 — Docs / Informational Routing
  //
  // Only reached when all higher tiers declined. Routes doc-style queries
  // ("what is X", "how do I") to doc retrieval.
  // =========================================================================
  if (semanticLaneDetected) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'semantic_lane_skip_docs',
      metadata: { input: ctx.trimmedInput },
    })
  }
  const docRetrievalResult = !semanticLaneDetected ? await handleDocRetrieval({
    trimmedInput: ctx.trimmedInput,
    uiContext: ctx.uiContext,
    docRetrievalState: ctx.docRetrievalState,
    lastClarification: ctx.lastClarification,
    clarificationCleared,
    knownTermsFetchStatus: ctx.knownTermsFetchStatus,
    usedCoreAppTermsFallback: ctx.usedCoreAppTermsFallback,
    classifierCalled,
    classifierResult,
    classifierTimeout,
    classifierLatencyMs,
    classifierError,
    isNewQuestionOrCommandDetected,
    isFollowUp,
    addMessage: ctx.addMessage,
    updateDocRetrievalState: ctx.updateDocRetrievalState,
    setIsLoading: ctx.setIsLoading,
    setPendingOptions: ctx.setPendingOptions,
    setPendingOptionsMessageId: ctx.setPendingOptionsMessageId as (messageId: string) => void,
    setLastClarification: ctx.setLastClarification,
  }) : { handled: false, route: undefined }
  if (docRetrievalResult.handled) {
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 5,
      tierLabel: 'doc_retrieval',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
      classifierCalled,
      classifierResult,
      classifierTimeout,
      classifierLatencyMs,
      classifierError,
      isFollowUp,
    }
  }

  // =========================================================================
  // No tier handled — return to caller for LLM API fallback
  // =========================================================================
  return {
    ...defaultResult,
    clarificationCleared,
    isNewQuestionOrCommandDetected,
    classifierCalled,
    classifierResult,
    classifierTimeout,
    classifierLatencyMs,
    classifierError,
    isFollowUp,
  }

  } finally {
    // Per selection-intent-arbitration-incubation-plan Phase 2c:
    // Increment focus latch turn counter at end of EVERY turn, regardless of which
    // tier handled the input. This prevents TTL drift across different return paths.
    if (isLatchEnabled) {
      ctx.incrementFocusLatchTurn()
    }
  }
}
