/**
 * Stage 6: Agent Tool Loop — Contract Types (Slice 6.1)
 *
 * Typed schemas for the Stage 6 tool loop. Contract-first: no implementation,
 * no dispatcher wiring, no prompt logic. Just stable interfaces and validation rules.
 *
 * Design note: stage6-agent-tool-loop-design.md
 *
 * Categories:
 *   §1 Snapshot payloads (observation model)
 *   §2 Inspect tool contracts (read-only)
 *   §3 Action tool contracts (execute)
 *   §4 Clarification request (model-requested, app-authoritative)
 *   §5 Loop envelope (request/response wrapper)
 *   §6 Validation rules
 */

// ============================================================================
// §1 Snapshot Payloads (Observation Model)
// ============================================================================

/**
 * Widget-level snapshot exposed to the model.
 * Computed at inspect-call time, not cached.
 */
export interface S6WidgetSnapshot {
  widgetId: string            // slug (e.g., "w_links_b")
  label: string               // display name
  panelId: string             // parent panel UUID
  items: S6WidgetItem[]
  itemCount: number           // total, including items not in viewport
  /** Normalized scroll position (0 = top, 1 = bottom). Undefined if not scrollable. */
  scrollPosition?: number
  capturedAtMs: number        // when this snapshot was taken
}

export interface S6WidgetItem {
  id: string
  label: string
  type: 'entry' | 'folder' | 'link'
  /** Whether this item is currently in the visible viewport */
  visible: boolean
}

/**
 * Dashboard-level snapshot exposed to the model.
 * Lists all open widgets without their item details.
 */
export interface S6DashboardSnapshot {
  dashboardId: string
  dashboardName: string
  widgets: S6DashboardWidget[]
  widgetCount: number
  capturedAtMs: number
}

export interface S6DashboardWidget {
  widgetId: string
  label: string
  panelId: string
  itemCount: number
}

/**
 * Recent items snapshot.
 * Items the user has accessed, ordered by recency.
 */
export interface S6RecentItemsSnapshot {
  items: S6RecentItem[]
  windowDays: number          // how far back this query looked
  capturedAtMs: number
}

export interface S6RecentItem {
  id: string
  label: string
  widgetId: string
  lastAccessedAt: string      // ISO 8601 timestamp
}

/**
 * Search result snapshot.
 * Name/label index only — no body text. Snippet capped at 80 chars.
 */
export interface S6SearchResultSnapshot {
  query: string
  results: S6SearchResult[]
  totalMatches: number        // may exceed results.length if capped
  capturedAtMs: number
}

export interface S6SearchResult {
  id: string
  label: string
  widgetId: string
  /** Short snippet from name/label match context. Max 80 characters. */
  snippet: string
  /** Relevance score, 0-1. */
  score: number
}

// ============================================================================
// §2 Inspect Tool Contracts (Read-Only)
// ============================================================================

/**
 * Discriminated union of all inspect tool requests.
 * The model emits one of these to read app state.
 */
export type S6InspectRequest =
  | S6InspectActiveWidget
  | S6InspectDashboard
  | S6InspectVisibleItems
  | S6InspectRecentItems
  | S6InspectSearch

export interface S6InspectActiveWidget {
  tool: 'inspect_active_widget'
}

export interface S6InspectDashboard {
  tool: 'inspect_dashboard'
}

export interface S6InspectVisibleItems {
  tool: 'inspect_visible_items'
}

export interface S6InspectRecentItems {
  tool: 'inspect_recent_items'
  /** How many days back to look. Default: 7. Max: 30. */
  windowDays?: number
}

export interface S6InspectSearch {
  tool: 'inspect_search'
  /** Search query string. Searched against item names/labels only. */
  query: string
  /** Max results to return. Default: 10. Max: 25. */
  limit?: number
}

/**
 * Discriminated union of all inspect tool responses.
 * The app returns one of these after processing an inspect request.
 */
export type S6InspectResponse =
  | S6InspectActiveWidgetResponse
  | S6InspectDashboardResponse
  | S6InspectVisibleItemsResponse
  | S6InspectRecentItemsResponse
  | S6InspectSearchResponse
  | S6InspectErrorResponse

export interface S6InspectActiveWidgetResponse {
  tool: 'inspect_active_widget'
  status: 'ok'
  data: S6WidgetSnapshot | null   // null if no widget is active
}

export interface S6InspectDashboardResponse {
  tool: 'inspect_dashboard'
  status: 'ok'
  data: S6DashboardSnapshot
}

export interface S6InspectVisibleItemsResponse {
  tool: 'inspect_visible_items'
  status: 'ok'
  data: S6VisibleItemsSnapshot
}

/**
 * Flat view of all visible items across all open widgets.
 * Freshness-bearing wrapper consistent with other snapshot types.
 */
export interface S6VisibleItemsSnapshot {
  items: S6VisibleItem[]
  /** Total count of visible items across all widgets. */
  totalCount: number
  capturedAtMs: number
}

export interface S6VisibleItem extends S6WidgetItem {
  widgetId: string
  widgetLabel: string
}

export interface S6InspectRecentItemsResponse {
  tool: 'inspect_recent_items'
  status: 'ok'
  data: S6RecentItemsSnapshot
}

export interface S6InspectSearchResponse {
  tool: 'inspect_search'
  status: 'ok'
  data: S6SearchResultSnapshot
}

export interface S6InspectErrorResponse {
  tool: string
  status: 'error'
  error: string
}

// ============================================================================
// §3 Action Tool Contracts (Execute)
// ============================================================================

/**
 * Discriminated union of all action tool requests.
 * The model emits at most one action per loop iteration.
 */
export type S6ActionRequest =
  | S6OpenWidgetItem
  | S6OpenPanel
  | S6NavigateEntry

export interface S6OpenWidgetItem {
  action: 'open_widget_item'
  widgetId: string
  itemId: string
  /** Optional: model's stated reason for choosing this item. For telemetry. */
  reason?: string
}

export interface S6OpenPanel {
  action: 'open_panel'
  /** Panel slug (e.g., "links-panel-b") */
  panelSlug: string
  reason?: string
}

export interface S6NavigateEntry {
  action: 'navigate_entry'
  entryId: string
  reason?: string
}

/**
 * Result of an action tool execution.
 * Returned to the loop envelope, not to the model (loop terminates on action).
 */
export interface S6ActionResult {
  action: S6ActionRequest['action']
  status: 'executed' | 'rejected'
  /** Set when status is 'rejected'. */
  rejectionReason?: S6ActionRejectionReason
}

export type S6ActionRejectionReason =
  | 'target_not_found'
  | 'target_not_visible'
  | 'widget_not_open'
  | 'panel_not_registered'
  | 'entry_not_found'
  | 'permission_denied'      // action outside user's permission scope
  | 'toctou_stale'           // final revalidation failed
  | 'duplicate_action'       // idempotency guard

// ============================================================================
// §4 Clarification Request (Model-Requested, App-Authoritative)
// ============================================================================

/**
 * The model requests clarification by emitting this signal.
 * The app decides whether to honor it and controls the UI.
 */
export interface S6ClarificationRequest {
  type: 'request_clarification'
  /** Candidate IDs the model considers plausible. Min 2. */
  candidateIds: string[]
  /** Model's reason for needing clarification. */
  reason: string
}

/**
 * App's response to a clarification request.
 */
export interface S6ClarificationResponse {
  type: 'clarification_result'
  status: 'accepted' | 'rejected'
  /** When rejected, the app may force the model to act instead. */
  rejectionReason?: 'single_candidate' | 'no_valid_candidates' | 'policy_override'
}

// ============================================================================
// §5 Loop Envelope (Request/Response Wrapper)
// ============================================================================

/**
 * What the model receives at the start of a Stage 6 loop.
 */
export interface S6LoopInput {
  /** The user's original input text. */
  userInput: string
  /** Dashboard snapshot at loop entry (not stale — computed fresh). */
  dashboardSnapshot: S6DashboardSnapshot
  /** Grounding candidates from Stage 4 (may be empty if Stage 4 fully abstained). */
  groundingCandidates: S6GroundingCandidate[]
  /** Why Stage 4 escalated to Stage 6. */
  escalationReason: S6EscalationReason
  /** Loop constraints. */
  constraints: S6LoopConstraints
}

export interface S6GroundingCandidate {
  id: string
  label: string
  source: string             // grounding set type
  widgetId?: string
}

export type S6EscalationReason =
  | 'stage4_abstain'           // need_more_info
  | 'stage4_low_confidence'    // below threshold (future: G1 enforcement)
  | 'stage4_timeout'           // LLM call timed out

export interface S6LoopConstraints {
  /** Max inspect calls before the loop must decide. */
  maxInspectRounds: number     // default: 3
  /** Total time budget in milliseconds. */
  timeoutMs: number            // default: 5000
  /** Whether the model may request clarification. */
  clarificationAllowed: boolean
}

/**
 * What the model emits on each loop turn.
 * Exactly one of: inspect, action, clarify, or abort.
 */
export type S6LoopTurn =
  | { type: 'inspect'; request: S6InspectRequest }
  | { type: 'action'; request: S6ActionRequest }
  | { type: 'clarify'; request: S6ClarificationRequest }
  | { type: 'abort'; reason: string }

/**
 * Final result of a completed Stage 6 loop.
 */
export interface S6LoopResult {
  /** How the loop terminated. */
  outcome: S6LoopOutcome
  /** Number of inspect rounds used. */
  inspectRoundsUsed: number
  /** Total loop duration in milliseconds. */
  durationMs: number
  /** Action result (only if outcome is 'action_executed' or 'action_rejected'). */
  actionResult?: S6ActionResult
  /** Clarification result (only if outcome is 'clarification_*'). */
  clarificationResult?: S6ClarificationResponse
  /** Telemetry for durable log. */
  telemetry: S6LoopTelemetry
}

export type S6LoopOutcome =
  | 'action_executed'
  | 'action_rejected'
  | 'clarification_accepted'
  | 'clarification_rejected'
  | 'abort'
  | 'timeout'
  | 'max_rounds_exhausted'

// ============================================================================
// §6 Validation Rules
// ============================================================================

/**
 * Validation constraints for inspect tool parameters.
 */
export const S6_INSPECT_LIMITS = {
  /** Max days for recent items lookup. */
  RECENT_ITEMS_MAX_DAYS: 30,
  RECENT_ITEMS_DEFAULT_DAYS: 7,
  /** Max search results. */
  SEARCH_MAX_RESULTS: 25,
  SEARCH_DEFAULT_RESULTS: 10,
  /** Max snippet length in search results. */
  SEARCH_SNIPPET_MAX_CHARS: 80,
} as const

/**
 * Loop constraint defaults and bounds.
 */
export const S6_LOOP_LIMITS = {
  MAX_INSPECT_ROUNDS_DEFAULT: 3,
  MAX_INSPECT_ROUNDS_CEILING: 5,
  TIMEOUT_MS_DEFAULT: 5_000,
  TIMEOUT_MS_CEILING: 10_000,
  /** Minimum candidates for a clarification request. */
  MIN_CLARIFICATION_CANDIDATES: 2,
} as const

// ============================================================================
// §7 Telemetry (for Durable Log)
// ============================================================================

/**
 * Stage 6 telemetry written to the durable log's semantic_hint_metadata.
 */
export interface S6LoopTelemetry {
  s6_loop_entered: true
  s6_escalation_reason: S6EscalationReason
  s6_inspect_rounds: number
  s6_outcome: S6LoopOutcome
  s6_duration_ms: number
  s6_action_type?: S6ActionRequest['action']
  s6_action_target_id?: string
  s6_action_status?: S6ActionResult['status']
  s6_action_rejection_reason?: S6ActionRejectionReason
  s6_clarify_candidate_count?: number
  s6_abort_reason?: string
  /** Tools called, in order. */
  s6_tool_trace: string[]
  /** Evidence gate result for open_panel (Slice 6.7.3).
   *  Only 'allowed' and 'ambiguous_siblings' are reachable — target_not_found
   *  is caught by validateOpenPanel() before the evidence gate runs. */
  s6_evidence_gate?: 'allowed' | 'ambiguous_siblings'
  /** Number of sibling panels sharing base name (when ambiguous). */
  s6_evidence_sibling_count?: number
  // Content extension telemetry (6x.3)
  /** Whether any content tool was called in this loop. */
  s6_content_tool_used?: boolean
  /** Number of content-tool calls made in this loop. */
  s6_content_call_count?: number
  /** Total characters returned across all content tool responses. */
  s6_content_chars_returned?: number
}
