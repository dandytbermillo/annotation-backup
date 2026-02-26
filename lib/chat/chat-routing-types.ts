/**
 * Chat Routing Types
 *
 * Shared types and interfaces used across chat-routing modules.
 * Extracted from chat-routing.ts to prevent circular dependencies.
 *
 * @internal — Do not import directly outside lib/chat/.
 * Use the barrel at @/lib/chat/chat-routing instead.
 */

import type { ChatMessage, SelectionOption, LastClarificationState } from '@/lib/chat'
import type { UIContext } from '@/lib/chat/intent-prompt'
import type { DocRetrievalState } from '@/lib/docs/doc-retrieval-state'
import type {
  ClarificationOption,
  RepairMemoryState,
  ClarificationSnapshot,
  ChatProvenance,
  SelectionContinuityState,
  LastOptionsShown,
  FocusLatchState,
  WidgetSelectionContext,
  ScopeCueRecoveryMemory,
} from '@/lib/chat/chat-navigation-context'
import type { VisibleWidget } from '@/lib/chat/panel-command-matcher'
import type { ExecutionMeta } from '@/lib/chat/action-trace'
import type { NeededContextType } from '@/lib/chat/clarification-llm-fallback'

// =============================================================================
// Preferred Candidate Hint (strict-exact policy)
// Non-exact signals become advisory hints for the LLM, not execution triggers.
// =============================================================================

export type PreferredCandidateHint = {
  id: string
  label: string
  source: 'badge' | 'polite_wrapper' | 'continuity' | 'ordinal_embedded'
} | null

// =============================================================================
// Handler Result Type
// =============================================================================

export interface HandlerResult {
  handled: boolean
}

// =============================================================================
// Pending Option State (for setPendingOptions callback)
// =============================================================================

export interface PendingOptionState {
  index: number
  label: string
  sublabel?: string
  type: string
  id: string
  notesScopeFollowUp?: boolean
  data: unknown
}

// =============================================================================
// Handler Context Types
// =============================================================================

/**
 * Base context passed to routing handlers.
 * Bundles the dependencies each handler needs to process input.
 */
export interface RoutingHandlerContext {
  // Input
  trimmedInput: string

  // State (read-only)
  docRetrievalState: DocRetrievalState | null

  // Telemetry context
  knownTermsFetchStatus: 'snapshot' | 'cached' | 'fetched' | 'fetch_error' | 'fetch_timeout'
  usedCoreAppTermsFallback: boolean

  // Callbacks
  addMessage: (message: ChatMessage) => void
  updateDocRetrievalState: (update: Partial<DocRetrievalState>) => void
  setIsLoading: (loading: boolean) => void
}

/**
 * Extended context for meta-explain handler.
 * Includes additional state and callbacks for disambiguation handling.
 */
export interface MetaExplainHandlerContext extends RoutingHandlerContext {
  // Additional state
  messages: ChatMessage[]
  lastClarification: LastClarificationState | null
  clarificationCleared: boolean

  // Additional callbacks
  setPendingOptions: (options: PendingOptionState[]) => void
  setPendingOptionsMessageId: (messageId: string) => void
  setLastClarification: (state: LastClarificationState | null) => void
  // Soft-active window
  saveLastOptionsShown?: (options: ClarificationOption[], messageId: string) => void
}

// =============================================================================
// Follow-Up Handler Types
// =============================================================================

/**
 * Extended result for follow-up handler that includes classifier state.
 * Classifier state is needed by subsequent routing code for telemetry.
 */
export interface FollowUpHandlerResult extends HandlerResult {
  // Classifier state (used by subsequent routing telemetry)
  classifierCalled: boolean
  classifierResult?: boolean
  classifierTimeout: boolean
  classifierLatencyMs?: number
  classifierError: boolean
}

/**
 * Context for follow-up handler (simpler than meta-explain).
 */
export interface FollowUpHandlerContext extends RoutingHandlerContext {
  // Additional state
  isNewQuestionOrCommandDetected: boolean
}

// =============================================================================
// Clarification Intercept Types
// =============================================================================

/**
 * Result from clarification intercept handler
 */
export interface ClarificationInterceptResult extends HandlerResult {
  /** Whether clarification was cleared (for downstream handlers) */
  clarificationCleared: boolean
  /** Whether new question/command was detected */
  isNewQuestionOrCommandDetected: boolean
  /** Dev-only: routing provenance hint for debug overlay (undefined = deterministic) */
  _devProvenanceHint?: ChatProvenance
}

export interface ClarificationInterceptContext {
  // Input
  trimmedInput: string

  // State (read-only)
  lastClarification: LastClarificationState | null
  lastSuggestion: unknown | null  // Any truthy value indicates active suggestion
  pendingOptions: PendingOptionState[]
  uiContext?: UIContext | null
  currentEntryId?: string

  // Callbacks
  addMessage: (message: ChatMessage) => void
  setLastClarification: (state: LastClarificationState | null) => void
  setIsLoading: (loading: boolean) => void
  setPendingOptions: (options: PendingOptionState[]) => void
  setPendingOptionsMessageId: (messageId: string | null) => void
  setPendingOptionsGraceCount: (count: number) => void
  setNotesScopeFollowUpActive: (active: boolean) => void
  handleSelectOption: (option: SelectionOption) => void

  // Repair memory (per clarification-response-fit-plan.md §5)
  repairMemory: RepairMemoryState | null
  setRepairMemory: (lastChoiceId: string | null, options: ClarificationOption[]) => void
  incrementRepairMemoryTurn: () => void
  clearRepairMemory: () => void

  // Clarification snapshot for post-action repair window (per plan §153-161)
  clarificationSnapshot: ClarificationSnapshot | null
  saveClarificationSnapshot: (clarification: LastClarificationState, paused?: boolean, pausedReason?: 'interrupt' | 'stop') => void
  pauseSnapshotWithReason: (reason: 'interrupt' | 'stop') => void
  incrementSnapshotTurn: () => void
  clearClarificationSnapshot: () => void

  // Stop suppression (per stop-scope-plan §40-48)
  stopSuppressionCount: number
  setStopSuppressionCount: (count: number) => void
  decrementStopSuppression: () => void

  // Soft-active window (per grounding-set-fallback-plan.md §Soft-Active)
  saveLastOptionsShown?: (options: ClarificationOption[], messageId: string) => void

  // Widget selection context (per universal-selection-resolver-plan.md)
  widgetSelectionContext: WidgetSelectionContext | null
  clearWidgetSelectionContext: () => void
  setActiveOptionSetId: (id: string | null) => void

  // Focus latch (per selection-intent-arbitration-incubation-plan.md)
  focusLatch: FocusLatchState | null
  setFocusLatch: (latch: FocusLatchState) => void
  suspendFocusLatch: () => void
  clearFocusLatch: () => void
  hasVisibleWidgetItems: boolean
  totalListSegmentCount: number
  lastOptionsShown: LastOptionsShown | null
  isLatchEnabled: boolean
  activeSnapshotWidgetId: string | null
  scopeCueRecoveryMemory: ScopeCueRecoveryMemory | null
  clearScopeCueRecoveryMemory: () => void

  // Selection continuity (Plan 20 — per Plan 19 canonical contract)
  selectionContinuity: SelectionContinuityState
  updateSelectionContinuity: (updates: Partial<SelectionContinuityState>) => void
  resetSelectionContinuity: () => void

  /** Phase 10: Semantic answer lane detected — escape clarification for semantic questions */
  semanticLaneDetected?: boolean
}

// =============================================================================
// Panel Disambiguation Types
// =============================================================================

export interface PanelDisambiguationHandlerContext {
  trimmedInput: string
  visibleWidgets?: VisibleWidget[]
  addMessage: (message: ChatMessage) => void
  setIsLoading: (loading: boolean) => void
  setPendingOptions: (options: PendingOptionState[]) => void
  setPendingOptionsMessageId: (messageId: string | null) => void
  setLastClarification: (state: LastClarificationState | null) => void
  saveLastOptionsShown?: (options: ClarificationOption[], messageId: string) => void
  clearWidgetSelectionContext?: () => void
  clearFocusLatch?: () => void
  openPanelDrawer?: (panelId: string, panelTitle?: string, executionMeta?: ExecutionMeta) => void
}

export interface PanelDisambiguationHandlerResult extends HandlerResult {
  matchType?: 'exact' | 'partial' | 'none'
  matchCount?: number
}

// =============================================================================
// Arbitration Types
// =============================================================================

/** Single shared union for all arbitration fallback reasons.
 *  Used in result types, telemetry, and logs. No ad-hoc reason strings. */
export type ArbitrationFallbackReason =
  // Existing reasons (must match tryLLMLastChance exactly)
  | 'question_intent'
  | 'classifier_not_eligible'
  | 'feature_disabled'
  | 'loop_guard'
  | 'loop_guard_continuity'
  // Retry-loop additions
  | 'enrichment_unavailable'
  | 'scope_not_available'
  | 'no_new_evidence'
  | 'retry_feature_disabled'
  | 'timeout'
  | 'rate_limited'
  | 'transport_error'
  | 'abstain'
  | 'low_confidence'
  | 'contract_version_mismatch'
  | 'invalid_needed_context'
  // Passthrough from tryLLMLastChance generic fallback
  | 'reroute'
  | 'none_match'

/** Enrichment returns metadata/evidence only — NOT new candidates.
 *  In active-option flows, the candidate set is frozen at loop entry. */
export type ContextEnrichmentCallback = (
  neededContext: NeededContextType[]
) => { enrichedMetadata: Record<string, unknown> } | null

// =============================================================================
// LLM Arbitration Guard Types (internal to arbitration module)
// =============================================================================

/** Loop guard for LLM arbitration: prevent repeated LLM calls for same input+options.
 *  Module-level singleton — reset when input or option set changes. */
export interface LLMArbitrationGuardState {
  normalizedInput: string
  candidateIds: string
  clarificationMessageId: string
  suggestedId: string | null  // Rule F — loop-guard continuity
  enrichmentFingerprint?: string  // Context-enrichment retry loop
  retryAttempted?: boolean        // Context-enrichment retry loop — budget tracking
}

// =============================================================================
// Selection Continuity Deterministic Resolver Types (Plan 20)
// =============================================================================

export interface ContinuityResolveParams {
  trimmedInput: string
  candidates: { id: string; label: string; sublabel?: string }[]
  continuityState: SelectionContinuityState
  currentOptionSetId: string | null
  currentScope: 'chat' | 'widget' | 'dashboard' | 'workspace' | 'none'
  isCommandOrSelection: boolean
  isQuestionIntent: boolean
  labelMatchCount: number
}

export interface ContinuityResolveResult {
  resolved: boolean
  winnerId: string | null
  reason: string
}

// =============================================================================
// Bounded Arbitration Result (context-enrichment retry loop)
// =============================================================================

export interface BoundedArbitrationResult {
  attempted: boolean
  suggestedId: string | null
  fallbackReason: ArbitrationFallbackReason | null
  autoExecute: boolean
  retryAttempted: boolean
}

// =============================================================================
// Pre-Clarification Computed State (PR3c)
// Computed once at the top of handleClarificationIntercept, passed into each phase.
// =============================================================================

export interface PreClarificationComputedState {
  latchBlocksStaleChat: boolean
  isNewQuestionOrCommandDetected: boolean
  isBareNounNewIntent: boolean
  clarificationTokens: string[]
}
