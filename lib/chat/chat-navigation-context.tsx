/**
 * Chat Navigation Context
 *
 * Provides shared state for chat navigation messages across different
 * component instances (DashboardDock, canvas-control-center).
 *
 * This ensures messages persist when switching between dashboard and workspace modes.
 * Also tracks session state for informational intents (location_info, last_action, session_stats).
 *
 * Phase 2: Persistence - Messages are stored in the database and restored on reload.
 */

'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import type { WorkspaceMatch, NoteMatch, EntryMatch } from './resolution-types'
import type { SessionState, UIContext } from './intent-prompt'
import type { ViewPanelContent, ViewListItem } from './view-panel-types'

// =============================================================================
// Types
// =============================================================================

export interface QuickLinksPanelData {
  panelId: string
  badge: string
  panelType: 'quick_links'
}

export interface PanelIntentData {
  panelId: string
  intentName: string
  params: Record<string, unknown>
}

export interface PanelDrawerData {
  panelId: string
  panelTitle: string
  panelType: string
}

/** Data for doc disambiguation pills (definitional-query-fix-proposal.md) */
export interface DocData {
  docSlug: string
  originalQuery?: string // Preserve user's original query for HS3 steps_request trigger
}

/** TD-7: Data for high-ambiguity clarification pills */
export interface TD7ClarificationData {
  term: string
  action: 'doc' | 'llm'
}

/** Prereq 4: Data for cross-corpus disambiguation pills */
export interface CrossCorpusSelectData {
  corpus: 'docs' | 'notes'
  resourceId: string
  title: string
}

/** Exit pill data for clarification escalation (per clarification-exit-pills-plan.md) */
export interface ExitPillData {
  exitType: 'none' | 'start_over'
}

export interface SelectionOption {
  type: 'workspace' | 'note' | 'entry' | 'confirm_delete' | 'quick_links_panel' | 'confirm_panel_write' | 'panel_drawer' | 'doc' | 'td7_clarification' | 'cross_corpus_select' | 'exit'
  id: string
  label: string
  sublabel?: string
  data: WorkspaceMatch | NoteMatch | EntryMatch | QuickLinksPanelData | PanelIntentData | PanelDrawerData | DocData | TD7ClarificationData | CrossCorpusSelectData | ExitPillData
}

/** Suggestion candidate for typo fallback */
export interface SuggestionCandidate {
  label: string
  intentName: string
  panelId?: string
  primaryAction: 'open' | 'list' | 'navigate' | 'create' | 'info'
}

/** Suggestions for typo recovery */
export interface ChatSuggestions {
  type: 'confirm_single' | 'choose_multiple' | 'low_confidence'
  candidates: SuggestionCandidate[]
}

/** Last suggestion state for rejection handling */
export interface LastSuggestionState {
  candidates: SuggestionCandidate[]
  messageId: string
}

/** Clarification option for multi-choice clarifications (per options-visible-clarification-sync-plan.md) */
export interface ClarificationOption {
  id: string
  label: string
  sublabel?: string
  type: string
}

/** Last clarification state for follow-up handling (Phase 2a) */
export interface LastClarificationState {
  type: 'notes_scope' | 'option_selection' | 'doc_disambiguation' | 'td7_high_ambiguity' | 'cross_corpus' | 'panel_disambiguation' | 'workspace_list'
  originalIntent: string
  /** Generic action to execute when user affirms (Phase 2a deterministic handler) - optional for option_selection */
  nextAction?: string
  messageId: string
  timestamp: number
  /** META response count for loop limit (max 2 before escape hatch) */
  metaCount?: number
  /** Original clarification question for re-asking */
  clarificationQuestion?: string
  /** Options for multi-choice clarifications (per options-visible-clarification-sync-plan.md) */
  options?: ClarificationOption[]
  /** Off-menu attempt count for escalation (per clarification-offmenu-handling-plan.md) */
  attemptCount?: number
  /** "No" count for repeated-no escalation (per clarification-response-fit-plan.md §122-130) */
  noCount?: number
  /** Exit intent count for exit confirmation (per clarification-response-fit-plan.md §120-130) */
  exitCount?: number
}

/**
 * Repair memory state for response-fit classifier (per clarification-response-fit-plan.md).
 * Supports "the other one" style repairs by tracking previous selections.
 */
export interface RepairMemoryState {
  /** ID of the last choice selected/rejected */
  lastChoiceId: string | null
  /** Options shown in the last clarification (for repair context) */
  lastOptionsShown: ClarificationOption[]
  /** Turn counter for expiry (expires after 2 turns) */
  turnsSinceSet: number
  /** Timestamp when set */
  timestamp: number
}

/** Default repair memory window in turns (configurable) */
export const REPAIR_MEMORY_TURN_LIMIT = 2

/**
 * Clarification snapshot for post-action repair window (per clarification-response-fit-plan.md §153-161).
 * Stores the last clarification options so "not that" after an action can restore them.
 */
export interface ClarificationSnapshot {
  /** Options from the last clarification */
  options: ClarificationOption[]
  /** Original intent/query that created the clarification */
  originalIntent: string
  /** Type of clarification */
  type: LastClarificationState['type']
  /** Turn counter for expiry (expires after 2 turns) */
  turnsSinceSet: number
  /** Timestamp when set */
  timestamp: number
  /** Whether the snapshot is paused (interrupt/stop) vs active (post-selection).
   *  Paused snapshots with pausedReason 'stop' don't resolve ordinals; require explicit return signal.
   *  Paused snapshots with pausedReason 'interrupt' allow ordinal selection.
   *  Per clarification-interrupt-resume-plan.md §8-18, stop-scope-plan §39-44. */
  paused?: boolean
  /** Why the snapshot was paused. 'interrupt' allows ordinals; 'stop' blocks them. */
  pausedReason?: 'interrupt' | 'stop'
}

/** Default snapshot window in turns (configurable) */
export const SNAPSHOT_TURN_LIMIT = 2

/** Paused snapshot expiry in turns (per interrupt-resume plan §42-46) */
export const PAUSED_SNAPSHOT_TURN_LIMIT = 3

/** Repeated stop suppression window in turns (per stop-scope-plan §40-48) */
export const STOP_SUPPRESSION_TURN_LIMIT = 2

/**
 * Last options shown snapshot for grounding-set soft-active window.
 * Per grounding-set-fallback-plan.md §G:
 *   Populated when options are shown (not only when selected).
 *   TTL = 2 turns. Used as grounding set when activeOptionSetId is null
 *   but options were recently displayed.
 */
export interface LastOptionsShown {
  options: ClarificationOption[]
  /** Message ID that displayed these options */
  messageId: string
  /** Timestamp when shown */
  timestamp: number
  /** Turn counter for TTL expiry */
  turnsSinceShown: number
}

/** Soft-active TTL in turns (per grounding-set-fallback-plan.md §G) */
export const SOFT_ACTIVE_TURN_LIMIT = 2

/**
 * Durable recovery memory for explicit scope-cue resolution ("from chat", "in chat").
 * Unlike clarificationSnapshot (panel_drawer-excluded) and lastOptionsShown (2-turn TTL),
 * this has no TTL and is ONLY consumed by explicit scope cues in the scope-cue block.
 * Never read by automatic ordinal routing (post-action window, Tier 3.5, stale-chat guards).
 * Per scope-cue-recovery-plan.
 */
export interface ScopeCueRecoveryMemory {
  options: ClarificationOption[]
  messageId: string
  timestamp: number
}

/**
 * Widget selection context for universal selection resolver.
 * Per universal-selection-resolver-plan.md:
 *   Stores widget options separately from chat options (pendingOptions).
 *   Used for widget clarifier follow-ups without mixing into chat selection state.
 */
export interface WidgetSelectionContext {
  /** Unique ID for this option set (typically the message ID) */
  optionSetId: string
  /** Widget ID from registry */
  widgetId: string
  /** Segment ID from registry (optional) */
  segmentId?: string
  /** Options in exact order as shown in clarifier message (for ordinal alignment) */
  options: Array<{ id: string; label: string; sublabel?: string }>
  /** Timestamp when registered */
  timestamp: number
  /** Turn counter for TTL expiry */
  turnsSinceShown: number
}

/** Widget selection TTL in turns (matches SOFT_ACTIVE_TURN_LIMIT) */
export const WIDGET_SELECTION_TTL = 2

/**
 * Focus latch state for selection intent arbitration.
 * Per selection-intent-arbitration-incubation-plan.md:
 *   Tracks which widget the user is actively engaged with.
 *   While latched, unspecific selection-like follow-ups resolve against this widget.
 */
interface FocusLatchBase {
  /** Human-readable widget label (e.g., "Quick Links D") */
  widgetLabel: string
  /** Timestamp when latch was set */
  latchedAt: number
  /** Turns since latch was set (for TTL expiry) */
  turnsSinceLatched: number
  /** True when scope switched to chat via re-anchor (latch not cleared, just suspended) */
  suspended?: boolean
}

export interface ResolvedFocusLatch extends FocusLatchBase {
  kind: 'resolved'
  /** Widget slug from registry — guaranteed valid (e.g., "w_links_d") */
  widgetId: string
}

export interface PendingFocusLatch extends FocusLatchBase {
  kind: 'pending'
  /** Panel UUID awaiting slug resolution */
  pendingPanelId: string
}

export type FocusLatchState = ResolvedFocusLatch | PendingFocusLatch

/** Get the identifying string for a latch state (widget slug or pending:panelId). */
export function getLatchId(latch: FocusLatchState): string {
  return latch.kind === 'resolved' ? latch.widgetId : `pending:${latch.pendingPanelId}`
}

/** Focus latch TTL in turns */
export const FOCUS_LATCH_TTL = 5

// =============================================================================
// Selection Continuity State (Plan 20 — per Plan 19 canonical contract)
// =============================================================================

import { MAX_ACTION_TRACE, MAX_ACCEPTED_WINDOW, MAX_REJECTED_WINDOW } from './continuity-constants'
import {
  type ActionTraceEntry as SessionActionTraceEntry,
  computeDedupeKey,
  generateTraceId,
  ACTION_TRACE_MAX_SIZE,
  ACTION_TRACE_DEDUPE_WINDOW_MS,
} from './action-trace'

/**
 * Selection-lane action trace entry — per Plan 19 recentActionTrace[] schema.
 * See: orchestrator/grounding-continuity-anti-reclarify-plan.md §Step 1
 *
 * Renamed from ActionTraceEntry to SelectionActionTrace to avoid collision
 * with the enriched session-level ActionTraceEntry in action-trace.ts.
 */
export interface SelectionActionTrace {
  type: string                                           // canonical: type
  targetRef: string                                      // canonical: targetRef
  sourceScope: 'chat' | 'widget' | 'dashboard' | 'workspace'  // canonical: sourceScope
  optionSetId: string | null                             // NULLABLE — never use '' fallback
  timestamp: number                                      // canonical: timestamp
  outcome: 'success' | 'failed' | 'clarified'           // canonical: outcome
}

/** @deprecated Use SelectionActionTrace — kept for short-term import compatibility */
export type ActionTraceEntry = SelectionActionTrace

/**
 * Canonical pending clarifier type — per Plan 19 pendingClarifierType enum.
 * See: orchestrator/grounding-continuity-anti-reclarify-plan.md §Step 1
 */
export type PendingClarifierType =
  | 'none'
  | 'selection_disambiguation'
  | 'scope_disambiguation'
  | 'missing_slot'
  | 'confirmation'
  | 'repair'

export interface SelectionContinuityState {
  lastResolvedAction: SelectionActionTrace | null
  recentActionTrace: SelectionActionTrace[]              // max per Plan 19 RECENT_ACTION_TRACE_MAX_ENTRIES
  lastAcceptedChoiceId: string | null
  recentAcceptedChoiceIds: string[]                      // max 5
  recentRejectedChoiceIds: string[]                      // max 5
  activeOptionSetId: string | null                       // NULLABLE — strict null checks in gates
  activeScope: 'chat' | 'widget' | 'dashboard' | 'workspace' | 'none'
  pendingClarifierType: PendingClarifierType
}

export const EMPTY_CONTINUITY_STATE: SelectionContinuityState = {
  lastResolvedAction: null,
  recentActionTrace: [],
  lastAcceptedChoiceId: null,
  recentAcceptedChoiceIds: [],
  recentRejectedChoiceIds: [],
  activeOptionSetId: null,
  activeScope: 'none',
  pendingClarifierType: 'none',
}

/**
 * Doc retrieval conversation state for follow-ups and corrections.
 * Per general-doc-retrieval-routing-plan.md (v4)
 * Updated for v5 Hybrid Response Selection (lastChunkIdsShown for HS2)
 * Updated for Prereq 4: Cross-corpus tracking
 */
export interface DocRetrievalState {
  /** Last doc slug from retrieval (for "tell me more" follow-ups) */
  lastDocSlug?: string
  /** Last topic tokens from query (for correction re-retrieval) */
  lastTopicTokens?: string[]
  /** Last retrieval mode: 'doc' | 'bare_noun' */
  lastMode?: 'doc' | 'bare_noun'
  /** Timestamp of last doc retrieval */
  timestamp?: number
  /** V5: Chunk IDs that have been shown (for HS2 follow-up expansion) */
  lastChunkIdsShown?: string[]
  /** Prereq 4: Last corpus used (for keeping follow-ups in same corpus) */
  lastRetrievalCorpus?: 'docs' | 'notes'
  /** Prereq 4: Last item ID for notes (parallel to lastDocSlug) */
  lastItemId?: string
  /** Prereq 4: Last resource ID (unified: docSlug or itemId) */
  lastResourceId?: string
}

// Dev-only provenance for routing debug overlay (per provenance-debug-overlay plan)
export type ChatProvenance = 'deterministic' | 'llm_executed' | 'llm_influenced'

/** Dev-only: requires flag ON + non-production environment. Zero cost when disabled. */
export function isProvenanceDebugEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CHAT_PROVENANCE_DEBUG === 'true'
    && process.env.NODE_ENV !== 'production'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  options?: SelectionOption[]
  isError?: boolean
  // Typo recovery suggestions (from typo-suggestions.ts)
  suggestions?: ChatSuggestions
  // View panel content (for "Show all" preview)
  viewPanelContent?: ViewPanelContent
  previewItems?: ViewListItem[]
  totalCount?: number
  // Drawer target for "Show all" when panel preview maps to a panel
  drawerPanelId?: string
  drawerPanelTitle?: string
  // Doc retrieval metadata for "Show more" button (per show-more-button-spec.md)
  docSlug?: string
  chunkId?: string
  headerPath?: string
  // Notes retrieval metadata for "Show more" button (notes corpus)
  itemId?: string
  itemName?: string
  corpus?: 'docs' | 'notes'
}

// Re-export SessionState for convenience
export type { SessionState }

// Last action type for tracking
export interface LastAction {
  type: 'open_workspace' | 'open_entry' | 'open_panel' | 'rename_workspace' | 'delete_workspace' | 'create_workspace' | 'go_to_dashboard' | 'go_home'
  workspaceId?: string
  workspaceName?: string
  entryId?: string
  entryName?: string
  panelId?: string
  panelTitle?: string
  fromName?: string
  toName?: string
  timestamp: number
}

// Re-export ActionHistoryEntry and RequestHistoryEntry for convenience
export type { ActionHistoryEntry, RequestHistoryEntry } from './intent-prompt'

// Constants for action history
const ACTION_HISTORY_MAX_SIZE = 50

interface ChatNavigationContextValue {
  messages: ChatMessage[]
  addMessage: (message: ChatMessage) => void
  clearMessages: () => void
  input: string
  setInput: (input: string) => void
  isOpen: boolean
  setOpen: (open: boolean) => void
  openChat: () => void
  closeChat: () => void
  // Session state for informational intents
  sessionState: SessionState
  setCurrentLocation: (viewMode: 'dashboard' | 'workspace', entryId?: string, entryName?: string, workspaceId?: string, workspaceName?: string) => void
  setLastAction: (action: LastAction) => void
  incrementOpenCount: (id: string, name: string, type: 'workspace' | 'entry') => void
  setLastQuickLinksBadge: (badge: string) => void
  // Action history for "did I [action] X?" queries
  appendActionHistory: (entry: Omit<import('./intent-prompt').ActionHistoryEntry, 'timestamp'>) => void
  // Request history for "did I ask you to [action] X?" queries
  appendRequestHistory: (entry: Omit<import('./intent-prompt').RequestHistoryEntry, 'timestamp'>) => void
  // Centralized execution recorder (Phase A — commit-point producers write here)
  recordExecutedAction: (entry: Omit<SessionActionTraceEntry, 'traceId' | 'seq' | 'dedupeKey' | 'tsMs'> & { tsMs?: number }) => void
  // Persistence
  conversationId: string | null
  isLoadingHistory: boolean
  hasMoreMessages: boolean
  loadOlderMessages: () => Promise<void>
  conversationSummary: string | null
  // Session divider: count of messages loaded from history (for rendering divider)
  initialMessageCount: number
  // Panel visibility for intent prioritization (Gap 2)
  visiblePanels: string[]
  focusedPanelId: string | null
  setVisiblePanels: (panelIds: string[]) => void
  setFocusedPanelId: (panelId: string | null) => void
  registerVisiblePanel: (panelId: string) => void
  unregisterVisiblePanel: (panelId: string) => void
  // UI context for current screen visibility
  uiContext: UIContext | null
  setUiContext: (context: UIContext | null) => void
  // Suggestion rejection handling (ephemeral, not persisted)
  lastSuggestion: LastSuggestionState | null
  rejectedSuggestions: Set<string>
  setLastSuggestion: (suggestion: LastSuggestionState | null) => void
  addRejectedSuggestions: (labels: string[]) => void
  clearRejectedSuggestions: () => void
  isRejectedSuggestion: (label: string) => boolean
  // Clarification follow-up handling (Phase 2a: notes-scope clarification)
  lastClarification: LastClarificationState | null
  setLastClarification: (clarification: LastClarificationState | null) => void
  // Doc retrieval conversation state (v4 plan)
  docRetrievalState: DocRetrievalState | null
  setDocRetrievalState: (state: DocRetrievalState | null) => void
  updateDocRetrievalState: (update: Partial<DocRetrievalState>) => void
  // Repair memory for response-fit (per clarification-response-fit-plan.md)
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
  // Stop suppression counter (per stop-scope-plan §40-48)
  stopSuppressionCount: number
  setStopSuppressionCount: (count: number) => void
  decrementStopSuppression: () => void
  // Last options shown for grounding-set soft-active window (per grounding-set-fallback-plan.md §G)
  lastOptionsShown: LastOptionsShown | null
  saveLastOptionsShown: (options: ClarificationOption[], messageId: string) => void
  incrementLastOptionsShownTurn: () => void
  clearLastOptionsShown: () => void
  // Scope-cue recovery memory (explicit-only, no TTL, per scope-cue-recovery-plan)
  scopeCueRecoveryMemory: ScopeCueRecoveryMemory | null
  saveScopeCueRecoveryMemory: (options: ClarificationOption[], messageId: string) => void
  clearScopeCueRecoveryMemory: () => void
  // Widget selection context for universal selection resolver (per universal-selection-resolver-plan.md)
  widgetSelectionContext: WidgetSelectionContext | null
  setWidgetSelectionContext: (context: WidgetSelectionContext | null) => void
  incrementWidgetSelectionTurn: () => void
  clearWidgetSelectionContext: () => void
  // Focus latch for selection intent arbitration (per selection-intent-arbitration-incubation-plan.md)
  focusLatch: FocusLatchState | null
  setFocusLatch: (latch: FocusLatchState | null) => void
  suspendFocusLatch: () => void
  incrementFocusLatchTurn: () => void
  clearFocusLatch: () => void
  // Selection continuity state (Plan 20 — per Plan 19 canonical contract)
  selectionContinuity: SelectionContinuityState
  updateSelectionContinuity: (updates: Partial<SelectionContinuityState>) => void
  recordAcceptedChoice: (choiceId: string, action: SelectionActionTrace) => void
  recordRejectedChoice: (choiceId: string) => void
  resetSelectionContinuity: () => void
  // Dev-only provenance debug overlay (per provenance-debug-overlay plan)
  provenanceMap: Map<string, ChatProvenance>
  setProvenance: (messageId: string, provenance: ChatProvenance) => void
  clearProvenanceMap: () => void
  lastAddedAssistantIdRef: React.MutableRefObject<string | null>
}

// =============================================================================
// API Helpers
// =============================================================================

interface DbMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata: {
    options?: SelectionOption[]
    isError?: boolean
    intent?: string
    entryContext?: { id: string; name: string }
    workspaceContext?: { id: string; name: string }
  } | null
  createdAt: string
}

async function getOrCreateConversation(): Promise<{
  id: string
  summary: string | null
  lastAction: LastAction | null
} | null> {
  try {
    const response = await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'global' }),
    })
    if (!response.ok) return null
    const data = await response.json()
    return {
      id: data.conversation.id,
      summary: data.conversation.summary,
      lastAction: data.conversation.lastAction || null,
    }
  } catch {
    return null
  }
}

async function fetchMessages(
  conversationId: string,
  cursor?: string
): Promise<{ messages: DbMessage[]; nextCursor: string | null } | null> {
  try {
    const url = new URL(`/api/chat/conversations/${conversationId}/messages`, window.location.origin)
    if (cursor) url.searchParams.set('cursor', cursor)
    url.searchParams.set('limit', '30')

    const response = await fetch(url.toString())
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function persistMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata?: Record<string, unknown>
): Promise<DbMessage | null> {
  try {
    const response = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, content, metadata }),
    })
    if (!response.ok) return null
    const data = await response.json()
    return data.message
  } catch {
    return null
  }
}

async function triggerSummarization(conversationId: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/chat/conversations/${conversationId}/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!response.ok) return null
    const data = await response.json()
    if (data.updated && data.summary) {
      return data.summary
    }
    return null
  } catch {
    return null
  }
}

async function clearConversation(conversationId: string): Promise<boolean> {
  try {
    // Delete all messages and reset summary
    const response = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
      method: 'DELETE',
    })
    return response.ok
  } catch {
    return false
  }
}

// =============================================================================
// Session State API Helpers (dedicated table)
// =============================================================================

async function fetchSessionState(
  conversationId: string
): Promise<{
  openCounts?: SessionState['openCounts']
  lastAction?: LastAction
  lastQuickLinksBadge?: SessionState['lastQuickLinksBadge']
  actionHistory?: SessionState['actionHistory']
  actionTrace?: SessionState['actionTrace']
  requestHistory?: SessionState['requestHistory']
} | null> {
  try {
    const response = await fetch(`/api/chat/session-state?conversationId=${conversationId}`)
    if (!response.ok) return null
    const data = await response.json()
    return data.sessionState || null
  } catch {
    return null
  }
}

async function persistSessionState(
  conversationId: string,
  sessionState: {
    openCounts?: SessionState['openCounts']
    lastAction?: LastAction
    lastQuickLinksBadge?: SessionState['lastQuickLinksBadge']
    actionHistory?: SessionState['actionHistory']
    actionTrace?: SessionState['actionTrace']
    requestHistory?: SessionState['requestHistory']
  }
): Promise<boolean> {
  try {
    const response = await fetch(`/api/chat/session-state/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionState }),
    })
    return response.ok
  } catch {
    return false
  }
}

function dbMessageToChatMessage(dbMsg: DbMessage): ChatMessage {
  return {
    id: dbMsg.id,
    role: dbMsg.role as 'user' | 'assistant',
    content: dbMsg.content,
    timestamp: new Date(dbMsg.createdAt),
    options: dbMsg.metadata?.options,
    isError: dbMsg.metadata?.isError,
  }
}

// =============================================================================
// Context
// =============================================================================

const ChatNavigationContext = createContext<ChatNavigationContextValue | null>(null)

// =============================================================================
// Provider
// =============================================================================

export function ChatNavigationProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isOpen, setOpen] = useState(false)

  // Persistence state
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversationSummary, setConversationSummary] = useState<string | null>(null)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const initRef = useRef(false)

  // Session divider: track how many messages were loaded from history
  const [initialMessageCount, setInitialMessageCount] = useState(0)

  // Session state for informational intents
  // Note: lastAction and openCounts are persisted to dedicated table and hydrated on init
  const [sessionState, setSessionState] = useState<SessionState>({})

  // Panel visibility state for intent prioritization (Gap 2)
  const [visiblePanels, setVisiblePanelsState] = useState<string[]>([])
  const [focusedPanelId, setFocusedPanelIdState] = useState<string | null>(null)
  const [uiContext, setUiContextState] = useState<UIContext | null>(null)

  // Suggestion rejection handling (ephemeral, not persisted)
  const [lastSuggestion, setLastSuggestionState] = useState<LastSuggestionState | null>(null)
  const [rejectedSuggestions, setRejectedSuggestions] = useState<Set<string>>(new Set())

  // Clarification follow-up handling (Phase 2a: notes-scope clarification)
  const [lastClarification, setLastClarificationState] = useState<LastClarificationState | null>(null)

  // Doc retrieval conversation state (v4 plan)
  const [docRetrievalState, setDocRetrievalStateInternal] = useState<DocRetrievalState | null>(null)

  // Repair memory for response-fit (per clarification-response-fit-plan.md)
  const [repairMemory, setRepairMemoryInternal] = useState<RepairMemoryState | null>(null)

  // Clarification snapshot for post-action repair window (per plan §153-161)
  const [clarificationSnapshot, setClarificationSnapshotInternal] = useState<ClarificationSnapshot | null>(null)

  // Stop suppression counter (per stop-scope-plan §40-48)
  const [stopSuppressionCount, setStopSuppressionCountInternal] = useState<number>(0)

  // Debounce refs for session state persistence
  const DEBOUNCE_MS = 1000
  const persistDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const pendingSessionStateRef = useRef<{
    openCounts?: SessionState['openCounts']
    lastAction?: LastAction
    lastQuickLinksBadge?: SessionState['lastQuickLinksBadge']
    actionHistory?: SessionState['actionHistory']
    actionTrace?: SessionState['actionTrace']
    requestHistory?: SessionState['requestHistory']
  } | null>(null)

  // Flush pending session state (called on debounce timeout or unload)
  const flushSessionState = useCallback(async (convId: string) => {
    if (pendingSessionStateRef.current) {
      const pending = pendingSessionStateRef.current
      pendingSessionStateRef.current = null
      await persistSessionState(convId, pending)
    }
  }, [])

  // Debounced persist: batches rapid updates into single write
  const debouncedPersistSessionState = useCallback((
    convId: string,
    newState: {
      openCounts?: SessionState['openCounts']
      lastAction?: LastAction
      lastQuickLinksBadge?: SessionState['lastQuickLinksBadge']
      actionHistory?: SessionState['actionHistory']
      actionTrace?: SessionState['actionTrace']
      requestHistory?: SessionState['requestHistory']
    }
  ) => {
    // Merge with any pending state
    pendingSessionStateRef.current = {
      ...pendingSessionStateRef.current,
      ...newState,
    }

    // Clear existing timeout
    if (persistDebounceRef.current) {
      clearTimeout(persistDebounceRef.current)
    }

    // Set new timeout
    persistDebounceRef.current = setTimeout(() => {
      flushSessionState(convId)
    }, DEBOUNCE_MS)
  }, [flushSessionState])

  // Initialize: get or create conversation and load recent messages + session state
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    async function init() {
      setIsLoadingHistory(true)
      try {
        const conv = await getOrCreateConversation()
        if (!conv) {
          console.warn('[ChatNavigation] Failed to get/create conversation')
          return
        }

        setConversationId(conv.id)
        setConversationSummary(conv.summary)

        // Fetch session state from dedicated table
        const ssData = await fetchSessionState(conv.id)
        if (ssData) {
          setSessionState((prev) => ({
            ...prev,
            lastAction: ssData.lastAction ?? undefined,
            openCounts: ssData.openCounts ?? undefined,
            lastQuickLinksBadge: ssData.lastQuickLinksBadge ?? undefined,
            actionHistory: ssData.actionHistory ?? undefined,
            actionTrace: ssData.actionTrace ?? undefined,
            requestHistory: ssData.requestHistory ?? undefined,
          }))
        }

        const result = await fetchMessages(conv.id)
        if (result) {
          const chatMessages = result.messages
            .filter((m) => m.role !== 'system')
            .map(dbMessageToChatMessage)
          setMessages(chatMessages)
          setNextCursor(result.nextCursor)
          setHasMoreMessages(!!result.nextCursor)
          // Track initial message count for session divider
          setInitialMessageCount(chatMessages.length)
        }
      } catch (err) {
        console.error('[ChatNavigation] Init error:', err)
      } finally {
        setIsLoadingHistory(false)
      }
    }

    init()
  }, [])

  // Flush pending writes on unload (beforeunload + visibilitychange)
  useEffect(() => {
    const handleUnload = () => {
      if (conversationId && pendingSessionStateRef.current) {
        // Use sendBeacon for reliable delivery on page unload
        const payload = JSON.stringify({ sessionState: pendingSessionStateRef.current })
        navigator.sendBeacon(`/api/chat/session-state/${conversationId}`, payload)
        pendingSessionStateRef.current = null
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && conversationId) {
        flushSessionState(conversationId)
      }
    }

    window.addEventListener('beforeunload', handleUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      // Flush on unmount
      if (conversationId && pendingSessionStateRef.current) {
        flushSessionState(conversationId)
      }
    }
  }, [conversationId, flushSessionState])

  // Add message with persistence
  const addMessage = useCallback(
    async (message: ChatMessage) => {
      // Dev provenance: track last assistant message ID for post-hoc tagging
      if (isProvenanceDebugEnabled() && message.role === 'assistant') {
        lastAddedAssistantIdRef.current = message.id
      }
      // Add to local state immediately for responsiveness
      setMessages((prev) => [...prev, message])

      // Persist to database
      if (conversationId) {
        const metadata: Record<string, unknown> = {}
        if (message.options) metadata.options = message.options
        if (message.isError) metadata.isError = message.isError

        const persisted = await persistMessage(
          conversationId,
          message.role,
          message.content,
          Object.keys(metadata).length > 0 ? metadata : undefined
        )

        // If persisted, update the message ID to match database
        if (persisted) {
          setMessages((prev) =>
            prev.map((m) => (m.id === message.id ? { ...m, id: persisted.id } : m))
          )

          // Dev provenance: migrate map entry from original ID to persisted ID
          if (isProvenanceDebugEnabled()) {
            setProvenanceMap(prev => {
              const provenance = prev.get(message.id)
              if (provenance && message.id !== persisted.id) {
                const next = new Map(prev)
                next.delete(message.id)
                next.set(persisted.id, provenance)
                return next
              }
              return prev
            })
            // Also update the ref in case tagging hasn't happened yet
            if (lastAddedAssistantIdRef.current === message.id) {
              lastAddedAssistantIdRef.current = persisted.id
            }
          }

          // Trigger async summarization after assistant responses (non-blocking)
          if (message.role === 'assistant') {
            triggerSummarization(conversationId).then((newSummary) => {
              if (newSummary) {
                setConversationSummary(newSummary)
              }
            })
          }
        }
      }
    },
    [conversationId]
  )

  // Clear messages with persistence
  const clearMessages = useCallback(async () => {
    setMessages([])
    setInput('')
    setNextCursor(null)
    setHasMoreMessages(false)
    setConversationSummary(null)
    setInitialMessageCount(0) // Reset session divider

    // Clear from database (create fresh conversation)
    if (conversationId) {
      await clearConversation(conversationId)
    }
  }, [conversationId])

  // Load older messages (pagination)
  const loadOlderMessages = useCallback(async () => {
    if (!conversationId || !nextCursor || isLoadingHistory) return

    setIsLoadingHistory(true)
    try {
      const result = await fetchMessages(conversationId, nextCursor)
      if (result) {
        const olderMessages = result.messages
          .filter((m) => m.role !== 'system')
          .map(dbMessageToChatMessage)

        // Prepend older messages
        setMessages((prev) => [...olderMessages, ...prev])
        setNextCursor(result.nextCursor)
        setHasMoreMessages(!!result.nextCursor)
      }
    } catch (err) {
      console.error('[ChatNavigation] Load older messages error:', err)
    } finally {
      setIsLoadingHistory(false)
    }
  }, [conversationId, nextCursor, isLoadingHistory])

  const openChat = useCallback(() => {
    setOpen(true)
    // Reset focused panel when chat opens (Gap 2: prevents stale focus priority)
    setFocusedPanelIdState(null)
  }, [])

  const closeChat = useCallback(() => {
    setOpen(false)
  }, [])

  // Update current location (called when user navigates)
  const setCurrentLocation = useCallback((
    viewMode: 'dashboard' | 'workspace',
    entryId?: string,
    entryName?: string,
    workspaceId?: string,
    workspaceName?: string
  ) => {
    setSessionState((prev) => ({
      ...prev,
      currentViewMode: viewMode,
      currentEntryId: entryId,
      currentEntryName: entryName,
      currentWorkspaceId: workspaceId,
      currentWorkspaceName: workspaceName,
    }))
  }, [])

  /** Extract target ID from LastAction for freshness guard identity comparison. */
  function extractLastActionTargetId(action: LastAction): string | undefined {
    switch (action.type) {
      case 'open_workspace':
      case 'rename_workspace':
      case 'delete_workspace':
      case 'create_workspace':
        return action.workspaceId
      case 'open_entry':
      case 'go_to_dashboard':
      case 'go_home':
        return action.entryId
      case 'open_panel':
        return action.panelId
    }
  }

  // Record last action (called after navigation/operation completes)
  // Uses debounced persistence for efficiency
  // Also appends to action history for "did I [action] X?" queries
  const setLastAction = useCallback((action: LastAction) => {
    // Freshness guard: skip if trace has already recorded the same or newer action.
    // recordExecutedAction fires first (sets ref with its own Date.now()), then the
    // legacy setLastAction caller fires with a SEPARATE Date.now() that is 1–50 ms
    // later. A strict === comparison misses this; use a 200 ms identity window instead.
    const lastWrite = lastTraceWriteRef.current
    if (lastWrite) {
      if (action.timestamp < lastWrite.tsMs) {
        return  // strictly older — trace has a newer action
      }
      if (action.timestamp - lastWrite.tsMs < 200) {
        // Within identity window — skip if same action type + target
        const actionTargetId = extractLastActionTargetId(action)
        if (action.type === lastWrite.actionType && actionTargetId === lastWrite.targetId) {
          return  // same action within window, trace already mirrored it
        }
      }
    }

    setSessionState((prev) => ({
      ...prev,
      lastAction: action,
    }))

    // Debounced persist to dedicated session-state table
    if (conversationId) {
      debouncedPersistSessionState(conversationId, { lastAction: action })
    }

    // Also append to action history (convert LastAction to ActionHistoryEntry)
    // Map action type to targetType and targetName
    let targetType: 'workspace' | 'entry' | 'panel' | 'link' = 'workspace'
    let targetName = ''
    let targetId: string | undefined

    switch (action.type) {
      case 'open_workspace':
        targetType = 'workspace'
        targetName = action.workspaceName || 'Unknown workspace'
        targetId = action.workspaceId
        break
      case 'open_entry':
        targetType = 'entry'
        targetName = action.entryName || 'Unknown entry'
        targetId = action.entryId
        break
      case 'open_panel':
        targetType = 'panel'
        targetName = action.panelTitle || 'Unknown panel'
        targetId = action.panelId
        break
      case 'rename_workspace':
        targetType = 'workspace'
        targetName = action.toName || action.workspaceName || 'Unknown workspace'
        targetId = action.workspaceId
        break
      case 'delete_workspace':
        targetType = 'workspace'
        targetName = action.workspaceName || 'Unknown workspace'
        targetId = action.workspaceId
        break
      case 'create_workspace':
        targetType = 'workspace'
        targetName = action.workspaceName || 'New workspace'
        targetId = action.workspaceId
        break
      case 'go_to_dashboard':
        targetType = 'entry'
        targetName = action.entryName || 'Dashboard'
        targetId = action.entryId
        break
      case 'go_home':
        targetType = 'entry'
        targetName = 'Home'
        targetId = action.entryId
        break
    }

    // Append to action history (bounded list)
    setSessionState((prev) => {
      const prevHistory = prev.actionHistory || []
      const newEntry: import('./intent-prompt').ActionHistoryEntry = {
        type: action.type,
        targetType,
        targetName,
        targetId,
        timestamp: action.timestamp,
      }
      const newHistory = [newEntry, ...prevHistory].slice(0, ACTION_HISTORY_MAX_SIZE)

      // Debounced persist action history
      if (conversationId) {
        debouncedPersistSessionState(conversationId, { actionHistory: newHistory })
      }

      return {
        ...prev,
        actionHistory: newHistory,
      }
    })
  }, [conversationId, debouncedPersistSessionState])

  // Increment open count for a workspace or entry
  // Uses debounced persistence for efficiency
  const incrementOpenCount = useCallback((id: string, name: string, type: 'workspace' | 'entry') => {
    setSessionState((prev) => {
      const prevCounts = prev.openCounts || {}
      const prevData = prevCounts[id] || { type, count: 0, name }
      const newCounts = {
        ...prevCounts,
        [id]: {
          type,
          count: prevData.count + 1,
          name,
        },
      }

      // Debounced persist to dedicated session-state table
      if (conversationId) {
        debouncedPersistSessionState(conversationId, { openCounts: newCounts })
      }

      return {
        ...prev,
        openCounts: newCounts,
      }
    })
  }, [conversationId, debouncedPersistSessionState])

  const setLastQuickLinksBadge = useCallback((badge: string) => {
    if (!badge) return
    const normalizedBadge = badge.toLowerCase()
    setSessionState((prev) => ({
      ...prev,
      lastQuickLinksBadge: normalizedBadge,
    }))
    if (conversationId) {
      debouncedPersistSessionState(conversationId, { lastQuickLinksBadge: normalizedBadge })
    }
  }, [conversationId, debouncedPersistSessionState])

  // Append to action history (bounded, for "did I [action] X?" queries)
  const appendActionHistory = useCallback((
    entry: Omit<import('./intent-prompt').ActionHistoryEntry, 'timestamp'>
  ) => {
    const newEntry: import('./intent-prompt').ActionHistoryEntry = {
      ...entry,
      timestamp: Date.now(),
    }

    setSessionState((prev) => {
      const prevHistory = prev.actionHistory || []
      // Keep bounded to ACTION_HISTORY_MAX_SIZE (newest first)
      const newHistory = [newEntry, ...prevHistory].slice(0, ACTION_HISTORY_MAX_SIZE)

      // Debounced persist
      if (conversationId) {
        debouncedPersistSessionState(conversationId, { actionHistory: newHistory })
      }

      return {
        ...prev,
        actionHistory: newHistory,
      }
    })
  }, [conversationId, debouncedPersistSessionState])

  // Append to request history (bounded, for "did I ask you to [action] X?" queries)
  const appendRequestHistory = useCallback((
    entry: Omit<import('./intent-prompt').RequestHistoryEntry, 'timestamp'>
  ) => {
    const newEntry: import('./intent-prompt').RequestHistoryEntry = {
      ...entry,
      timestamp: Date.now(),
    }

    setSessionState((prev) => {
      const prevHistory = prev.requestHistory || []
      // Keep bounded to ACTION_HISTORY_MAX_SIZE (newest first)
      const newHistory = [newEntry, ...prevHistory].slice(0, ACTION_HISTORY_MAX_SIZE)

      // Debounced persist
      if (conversationId) {
        debouncedPersistSessionState(conversationId, { requestHistory: newHistory })
      }

      return {
        ...prev,
        requestHistory: newHistory,
      }
    })
  }, [conversationId, debouncedPersistSessionState])

  // ===========================================================================
  // Centralized Action Trace — Phase A recorder
  // ===========================================================================

  // Provider-owned monotonic sequence (no module-global counter)
  const actionTraceSeqRef = useRef(0)

  // Freshness guard: tracks the latest accepted trace write identity.
  // Legacy setLastAction skips if it matches (same or older timestamp + same action identity).
  const lastTraceWriteRef = useRef<{ tsMs: number; actionType: string; targetId?: string } | null>(null)

  /**
   * Convert enriched session trace entry to legacy LastAction.
   * Returns null for unmappable ActionType values (select_option, execute_widget_item, add_link, remove_link).
   */
  const traceToLegacyLastAction = useCallback((entry: SessionActionTraceEntry): LastAction | null => {
    // LastAction.type only accepts these values
    const LEGACY_ACTION_TYPES: ReadonlySet<string> = new Set([
      'open_workspace', 'open_entry', 'open_panel',
      'rename_workspace', 'delete_workspace', 'create_workspace',
      'go_to_dashboard', 'go_home',
    ])
    if (!LEGACY_ACTION_TYPES.has(entry.actionType)) return null

    const base: LastAction = {
      type: entry.actionType as LastAction['type'],
      timestamp: entry.tsMs,
    }
    switch (entry.target.kind) {
      case 'workspace':
        base.workspaceId = entry.target.id
        base.workspaceName = entry.target.name
        break
      case 'entry':
        base.entryId = entry.target.id
        base.entryName = entry.target.name
        break
      case 'panel':
        base.panelId = entry.target.id
        base.panelTitle = entry.target.name
        break
    }
    return base
  }, [])

  /**
   * Convert enriched session trace entry to legacy ActionHistoryEntry.
   * Returns null for unmappable ActionType values (select_option, execute_widget_item).
   */
  const traceToLegacyHistoryEntry = useCallback((entry: SessionActionTraceEntry): import('./intent-prompt').ActionHistoryEntry | null => {
    // ActionHistoryEntry.type accepts a broader union than LastAction.type
    const LEGACY_HISTORY_TYPES: ReadonlySet<string> = new Set([
      'open_workspace', 'open_entry', 'open_panel',
      'rename_workspace', 'delete_workspace', 'create_workspace',
      'go_to_dashboard', 'go_home', 'add_link', 'remove_link',
    ])
    if (!LEGACY_HISTORY_TYPES.has(entry.actionType)) return null

    // Map TargetRefKind to legacy targetType
    const targetTypeMap: Record<string, 'workspace' | 'entry' | 'panel' | 'link'> = {
      workspace: 'workspace',
      entry: 'entry',
      panel: 'panel',
      widget_item: 'panel',  // closest legacy equivalent
      none: 'entry',         // safe fallback
    }
    return {
      type: entry.actionType as import('./intent-prompt').ActionHistoryEntry['type'],
      targetType: targetTypeMap[entry.target.kind] || 'entry',
      targetName: entry.target.name || '',
      targetId: entry.target.id,
      timestamp: entry.tsMs,
    }
  }, [])

  /**
   * Centralized execution recorder — Phase A.
   * Called at commit points (Phase B) to record user-meaningful state changes.
   * Mirrors to legacy lastAction/actionHistory for backward compatibility.
   */
  const recordExecutedAction = useCallback((
    input: Omit<SessionActionTraceEntry, 'traceId' | 'seq' | 'dedupeKey' | 'tsMs'> & { tsMs?: number }
  ) => {
    const tsMs = input.tsMs ?? Date.now()
    const seq = ++actionTraceSeqRef.current
    const traceId = generateTraceId()
    const dedupeKey = computeDedupeKey(input)
    const entry: SessionActionTraceEntry = { ...input, traceId, tsMs, seq, dedupeKey }

    // Compute legacy mirrors — may be null for unmappable types
    const legacyLastAction = traceToLegacyLastAction(entry)
    const legacyHistoryEntry = traceToLegacyHistoryEntry(entry)

    // Set freshness guard ref BEFORE the batched state update.
    // React 18 batches setSessionState updaters — they don't execute immediately.
    // If we set the ref inside the updater, any setLastAction calls in the same
    // synchronous call stack would see stale ref data and the guard would fail.
    // By setting eagerly here, the guard blocks redundant setLastAction calls
    // even before React processes the queued updater.
    // Safe for deduped writes: deduped entries share the same identity as the
    // accepted write, so advancing the ref to the same identity is a no-op.
    lastTraceWriteRef.current = { tsMs, actionType: entry.actionType, targetId: entry.target.id }

    // Single setSessionState call with side-effect-in-updater persistence
    // (same pattern as existing setLastAction lines 1046-1059)
    setSessionState((prev) => {
      const prevTrace = prev.actionTrace || []

      // Dedupe: skip if same dedupeKey within window
      if (prevTrace.length > 0) {
        const head = prevTrace[0]
        if (head.dedupeKey === dedupeKey && tsMs - head.tsMs < ACTION_TRACE_DEDUPE_WINDOW_MS) {
          return prev  // duplicate, skip
        }
      }

      const newTrace = [entry, ...prevTrace].slice(0, ACTION_TRACE_MAX_SIZE)

      // Conditionally mirror to legacy fields (only when mappable)
      const newActionHistory = legacyHistoryEntry
        ? [legacyHistoryEntry, ...(prev.actionHistory || [])].slice(0, ACTION_HISTORY_MAX_SIZE)
        : prev.actionHistory

      // Persist inside updater (same pattern as setLastAction line 1059)
      if (conversationId) {
        debouncedPersistSessionState(conversationId, {
          actionTrace: newTrace,
          ...(legacyLastAction ? { lastAction: legacyLastAction } : {}),
          ...(newActionHistory !== prev.actionHistory ? { actionHistory: newActionHistory } : {}),
        })
      }

      return {
        ...prev,
        actionTrace: newTrace,
        ...(legacyLastAction ? { lastAction: legacyLastAction } : {}),
        ...(newActionHistory !== prev.actionHistory ? { actionHistory: newActionHistory } : {}),
      }
    })
  }, [conversationId, debouncedPersistSessionState, traceToLegacyLastAction, traceToLegacyHistoryEntry])

  // Panel visibility setters (Gap 2)
  const setVisiblePanels = useCallback((panelIds: string[]) => {
    setVisiblePanelsState(panelIds)
  }, [])

  const setFocusedPanelId = useCallback((panelId: string | null) => {
    setFocusedPanelIdState(panelId)
  }, [])

  const setUiContext = useCallback((context: UIContext | null) => {
    setUiContextState(context)
  }, [])

  // Register/unregister individual panels (for use in panel mount/unmount effects)
  const registerVisiblePanel = useCallback((panelId: string) => {
    setVisiblePanelsState((prev) => {
      if (prev.includes(panelId)) return prev
      return [...prev, panelId]
    })
  }, [])

  const unregisterVisiblePanel = useCallback((panelId: string) => {
    setVisiblePanelsState((prev) => prev.filter((id) => id !== panelId))
    // Also clear focus if this panel was focused
    setFocusedPanelIdState((prev) => (prev === panelId ? null : prev))
  }, [])

  // Suggestion rejection handlers
  const setLastSuggestion = useCallback((suggestion: LastSuggestionState | null) => {
    setLastSuggestionState(suggestion)
  }, [])

  const addRejectedSuggestions = useCallback((labels: string[]) => {
    setRejectedSuggestions((prev) => {
      const next = new Set(prev)
      for (const label of labels) {
        next.add(label.toLowerCase())
      }
      return next
    })
  }, [])

  const clearRejectedSuggestions = useCallback(() => {
    setRejectedSuggestions(new Set())
  }, [])

  const isRejectedSuggestion = useCallback((label: string) => {
    return rejectedSuggestions.has(label.toLowerCase())
  }, [rejectedSuggestions])

  // Clarification follow-up handler (Phase 2a)
  const setLastClarification = useCallback((clarification: LastClarificationState | null) => {
    setLastClarificationState(clarification)
  }, [])

  // Doc retrieval state handlers (v4 plan)
  const setDocRetrievalState = useCallback((state: DocRetrievalState | null) => {
    setDocRetrievalStateInternal(state)
  }, [])

  const updateDocRetrievalState = useCallback((update: Partial<DocRetrievalState>) => {
    setDocRetrievalStateInternal((prev) => ({
      ...prev,
      ...update,
      timestamp: Date.now(),
    }))
  }, [])

  // Repair memory handlers (per clarification-response-fit-plan.md)
  const setRepairMemory = useCallback((lastChoiceId: string | null, options: ClarificationOption[]) => {
    setRepairMemoryInternal({
      lastChoiceId,
      lastOptionsShown: options,
      turnsSinceSet: 0,
      timestamp: Date.now(),
    })
  }, [])

  const incrementRepairMemoryTurn = useCallback(() => {
    setRepairMemoryInternal((prev) => {
      if (!prev) return null
      const newTurns = prev.turnsSinceSet + 1
      // Expire after REPAIR_MEMORY_TURN_LIMIT turns
      if (newTurns >= REPAIR_MEMORY_TURN_LIMIT) {
        return null
      }
      return {
        ...prev,
        turnsSinceSet: newTurns,
      }
    })
  }, [])

  const clearRepairMemory = useCallback(() => {
    setRepairMemoryInternal(null)
  }, [])

  // Clarification snapshot functions (per plan §153-161, interrupt-resume-plan)
  const saveClarificationSnapshot = useCallback((clarification: LastClarificationState, paused?: boolean, pausedReason?: 'interrupt' | 'stop') => {
    if (clarification.options && clarification.options.length > 0) {
      setClarificationSnapshotInternal({
        options: clarification.options,
        originalIntent: clarification.originalIntent,
        type: clarification.type,
        turnsSinceSet: 0,
        timestamp: Date.now(),
        paused: paused ?? false,
        pausedReason: paused ? (pausedReason ?? 'interrupt') : undefined,
      })
    }
  }, [])

  const incrementSnapshotTurn = useCallback(() => {
    setClarificationSnapshotInternal((prev) => {
      if (!prev) return null
      const newTurns = prev.turnsSinceSet + 1
      // No turn-based expiry for either active or paused snapshots.
      // Active snapshots: "visible = active" (per plan §144).
      // Paused snapshots: persist until explicit exit or new list replaces them
      // (per interrupt-resume-plan §46-51).
      return {
        ...prev,
        turnsSinceSet: newTurns,
      }
    })
  }, [])

  const pauseSnapshotWithReason = useCallback((reason: 'interrupt' | 'stop') => {
    setClarificationSnapshotInternal((prev) => {
      if (!prev) return null
      return { ...prev, paused: true, pausedReason: reason }
    })
  }, [])

  const clearClarificationSnapshot = useCallback(() => {
    setClarificationSnapshotInternal(null)
  }, [])

  // Stop suppression functions (per stop-scope-plan §40-48)
  const setStopSuppressionCount = useCallback((count: number) => {
    setStopSuppressionCountInternal(count)
  }, [])

  const decrementStopSuppression = useCallback(() => {
    setStopSuppressionCountInternal((prev) => (prev > 0 ? prev - 1 : 0))
  }, [])

  // Last options shown state for grounding-set soft-active window (per grounding-set-fallback-plan.md §G)
  const [lastOptionsShown, setLastOptionsShownInternal] = useState<LastOptionsShown | null>(null)

  const saveLastOptionsShown = useCallback((options: ClarificationOption[], messageId: string) => {
    if (options.length > 0) {
      setLastOptionsShownInternal({
        options,
        messageId,
        timestamp: Date.now(),
        turnsSinceShown: 0,
      })
    }
  }, [])

  const incrementLastOptionsShownTurn = useCallback(() => {
    setLastOptionsShownInternal((prev) => {
      if (!prev) return null
      const newTurns = prev.turnsSinceShown + 1
      // Expire after SOFT_ACTIVE_TURN_LIMIT full turns (> not >=, so TTL=2 allows turns 0,1,2)
      if (newTurns > SOFT_ACTIVE_TURN_LIMIT) return null
      return { ...prev, turnsSinceShown: newTurns }
    })
  }, [])

  const clearLastOptionsShown = useCallback(() => {
    setLastOptionsShownInternal(null)
  }, [])

  // Scope-cue recovery memory state (explicit-only, no TTL, per scope-cue-recovery-plan)
  const [scopeCueRecoveryMemory, setScopeCueRecoveryMemoryInternal] = useState<ScopeCueRecoveryMemory | null>(null)

  const saveScopeCueRecoveryMemory = useCallback((options: ClarificationOption[], messageId: string) => {
    if (options.length > 0) {
      setScopeCueRecoveryMemoryInternal({ options, messageId, timestamp: Date.now() })
    }
  }, [])

  const clearScopeCueRecoveryMemory = useCallback(() => {
    setScopeCueRecoveryMemoryInternal(null)
  }, [])

  // Widget selection context state for universal selection resolver (per universal-selection-resolver-plan.md)
  const [widgetSelectionContext, setWidgetSelectionContextInternal] = useState<WidgetSelectionContext | null>(null)

  const setWidgetSelectionContext = useCallback((context: WidgetSelectionContext | null) => {
    setWidgetSelectionContextInternal(context)
  }, [])

  const incrementWidgetSelectionTurn = useCallback(() => {
    setWidgetSelectionContextInternal((prev) => {
      if (!prev) return null
      const newTurns = prev.turnsSinceShown + 1
      // Expire after WIDGET_SELECTION_TTL full turns (> not >=, so TTL=2 allows turns 0,1,2)
      if (newTurns > WIDGET_SELECTION_TTL) return null
      return { ...prev, turnsSinceShown: newTurns }
    })
  }, [])

  const clearWidgetSelectionContext = useCallback(() => {
    setWidgetSelectionContextInternal(null)
  }, [])

  // Focus latch state for selection intent arbitration (per selection-intent-arbitration-incubation-plan.md)
  // Feature flag: when false, all latch state setters are no-ops
  const isLatchEnabled = process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 === 'true'
  const [focusLatch, setFocusLatchInternal] = useState<FocusLatchState | null>(null)

  const setFocusLatch = useCallback((latch: FocusLatchState | null) => {
    if (!isLatchEnabled) return
    setFocusLatchInternal(latch)
  }, [isLatchEnabled])

  const suspendFocusLatch = useCallback(() => {
    if (!isLatchEnabled) return
    setFocusLatchInternal(prev => prev ? { ...prev, suspended: true } : null)
  }, [isLatchEnabled])

  const incrementFocusLatchTurn = useCallback(() => {
    if (!isLatchEnabled) return
    setFocusLatchInternal((prev) => {
      if (!prev) return null
      const newTurns = prev.turnsSinceLatched + 1
      // Expire after FOCUS_LATCH_TTL full turns (> not >=, so TTL=5 allows turns 0-5)
      if (newTurns > FOCUS_LATCH_TTL) return null
      return { ...prev, turnsSinceLatched: newTurns }
    })
  }, [isLatchEnabled])

  const clearFocusLatch = useCallback(() => {
    if (!isLatchEnabled) return
    setFocusLatchInternal(null)
  }, [isLatchEnabled])

  // Selection continuity state (Plan 20 — per Plan 19 canonical contract)
  const isContinuityEnabled = process.env.NEXT_PUBLIC_SELECTION_CONTINUITY_LANE_ENABLED === 'true'
  const [selectionContinuity, setSelectionContinuity] = useState<SelectionContinuityState>(EMPTY_CONTINUITY_STATE)

  const updateSelectionContinuity = useCallback((updates: Partial<SelectionContinuityState>) => {
    if (!isContinuityEnabled) return
    setSelectionContinuity(prev => ({ ...prev, ...updates }))
  }, [isContinuityEnabled])

  const recordAcceptedChoice = useCallback((choiceId: string, action: SelectionActionTrace) => {
    if (!isContinuityEnabled) return
    setSelectionContinuity(prev => ({
      ...prev,
      lastResolvedAction: action,
      lastAcceptedChoiceId: choiceId,
      recentActionTrace: [action, ...prev.recentActionTrace].slice(0, MAX_ACTION_TRACE),
      recentAcceptedChoiceIds: [choiceId, ...prev.recentAcceptedChoiceIds].slice(0, MAX_ACCEPTED_WINDOW),
    }))
  }, [isContinuityEnabled])

  const recordRejectedChoice = useCallback((choiceId: string) => {
    if (!isContinuityEnabled) return
    setSelectionContinuity(prev => ({
      ...prev,
      recentRejectedChoiceIds: [choiceId, ...prev.recentRejectedChoiceIds].slice(0, MAX_REJECTED_WINDOW),
    }))
  }, [isContinuityEnabled])

  const resetSelectionContinuity = useCallback(() => {
    setSelectionContinuity(EMPTY_CONTINUITY_STATE)
  }, [])

  // Dev-only provenance debug overlay (per provenance-debug-overlay plan)
  const [provenanceMap, setProvenanceMap] = useState<Map<string, ChatProvenance>>(new Map())
  const setProvenance = useCallback((messageId: string, provenance: ChatProvenance) => {
    setProvenanceMap(prev => { const next = new Map(prev); next.set(messageId, provenance); return next })
  }, [])
  const clearProvenanceMap = useCallback(() => setProvenanceMap(new Map()), [])
  // Context-level ref: tracks the ID of the last assistant message added via addMessage.
  // handleSelectOption calls addMessage from its closure (the context's addMessage),
  // so tracking must live here to catch auto-execute paths.
  const lastAddedAssistantIdRef = useRef<string | null>(null)

  return (
    <ChatNavigationContext.Provider
      value={{
        messages,
        addMessage,
        clearMessages,
        input,
        setInput,
        isOpen,
        setOpen,
        openChat,
        closeChat,
        sessionState,
        setCurrentLocation,
        setLastAction,
        incrementOpenCount,
        setLastQuickLinksBadge,
        appendActionHistory,
        appendRequestHistory,
        recordExecutedAction,
        conversationId,
        isLoadingHistory,
        hasMoreMessages,
        loadOlderMessages,
        conversationSummary,
        initialMessageCount,
        // Panel visibility (Gap 2)
        visiblePanels,
        focusedPanelId,
        setVisiblePanels,
        setFocusedPanelId,
        registerVisiblePanel,
        unregisterVisiblePanel,
        uiContext,
        setUiContext,
        // Suggestion rejection handling
        lastSuggestion,
        rejectedSuggestions,
        setLastSuggestion,
        addRejectedSuggestions,
        clearRejectedSuggestions,
        isRejectedSuggestion,
        // Clarification follow-up handling (Phase 2a)
        lastClarification,
        setLastClarification,
        // Doc retrieval conversation state (v4 plan)
        docRetrievalState,
        setDocRetrievalState,
        updateDocRetrievalState,
        // Repair memory for response-fit (per clarification-response-fit-plan.md)
        repairMemory,
        setRepairMemory,
        incrementRepairMemoryTurn,
        clearRepairMemory,
        // Clarification snapshot for post-action repair window (per plan §153-161)
        clarificationSnapshot,
        saveClarificationSnapshot,
        pauseSnapshotWithReason,
        incrementSnapshotTurn,
        clearClarificationSnapshot,
        // Stop suppression (per stop-scope-plan §40-48)
        stopSuppressionCount,
        setStopSuppressionCount,
        decrementStopSuppression,
        // Last options shown for grounding-set soft-active window
        lastOptionsShown,
        saveLastOptionsShown,
        incrementLastOptionsShownTurn,
        clearLastOptionsShown,
        // Scope-cue recovery memory (explicit-only, per scope-cue-recovery-plan)
        scopeCueRecoveryMemory,
        saveScopeCueRecoveryMemory,
        clearScopeCueRecoveryMemory,
        // Widget selection context for universal selection resolver
        widgetSelectionContext,
        setWidgetSelectionContext,
        incrementWidgetSelectionTurn,
        clearWidgetSelectionContext,
        // Focus latch for selection intent arbitration
        focusLatch,
        setFocusLatch,
        suspendFocusLatch,
        incrementFocusLatchTurn,
        clearFocusLatch,
        // Selection continuity state (Plan 20)
        selectionContinuity,
        updateSelectionContinuity,
        recordAcceptedChoice,
        recordRejectedChoice,
        resetSelectionContinuity,
        // Dev-only provenance debug overlay
        provenanceMap,
        setProvenance,
        clearProvenanceMap,
        lastAddedAssistantIdRef,
      }}
    >
      {children}
    </ChatNavigationContext.Provider>
  )
}

// =============================================================================
// Hook
// =============================================================================

export function useChatNavigationContext() {
  const context = useContext(ChatNavigationContext)
  if (!context) {
    throw new Error('useChatNavigationContext must be used within ChatNavigationProvider')
  }
  return context
}
