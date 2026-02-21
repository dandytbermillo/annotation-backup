/**
 * Centralized ActionTrace — Session-level execution recording types and helpers.
 *
 * Phase A foundation. No imports from chat-navigation-context.tsx or intent-prompt.ts
 * (avoids circular dependencies — converters live in the context provider).
 *
 * See: centralized-actiontrace-commit-recording-plan.md
 */

// ---------------------------------------------------------------------------
// Stable enums (single source of truth)
// ---------------------------------------------------------------------------

export type ActionType =
  | 'open_workspace'
  | 'open_entry'
  | 'open_panel'
  | 'rename_workspace'
  | 'delete_workspace'
  | 'create_workspace'
  | 'go_to_dashboard'
  | 'go_home'
  | 'select_option'
  | 'execute_widget_item'
  | 'add_link'
  | 'remove_link'

export type TargetRefKind = 'entry' | 'panel' | 'workspace' | 'widget_item' | 'none'

export interface TargetRef {
  kind: TargetRefKind
  id?: string
  name?: string
}

export type SourceKind = 'chat' | 'widget' | 'direct_ui'

export type ReasonCode =
  | 'explicit_label_match'
  | 'ordinal'
  | 'continuity_tiebreak'
  | 'llm_select_validated'
  | 'direct_ui'
  | 'scope_cue'
  | 'grounding_resolved'
  | 'disambiguation_resolved'
  | 'unknown'

export type ResolverPath =
  | 'handleSelectOption'
  | 'executeAction'
  | 'handleGroundingSet'
  | 'handleClarificationIntercept'
  | 'directUI'
  | 'unknown'

export type ActionOutcome = 'success' | 'failed'

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export interface ActionTraceEntry {
  // Identity/ordering
  traceId: string
  tsMs: number
  seq: number

  // Action
  actionType: ActionType
  target: TargetRef

  // Provenance
  source: SourceKind
  resolverPath: ResolverPath
  reasonCode: ReasonCode

  // Scope
  scopeKind: 'chat' | 'widget' | 'dashboard' | 'workspace' | 'none'
  scopeInstanceId?: string

  // Linking/dedup
  dedupeKey: string
  parentTraceId?: string

  // Flags
  isUserMeaningful: boolean
  outcome: ActionOutcome

  // Optional trigger metadata
  intentTag?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum entries retained in session-level action trace (newest-first). */
export const ACTION_TRACE_MAX_SIZE = 50

/** Time window (ms) for deterministic dedupe — same dedupeKey within this window is skipped. */
export const ACTION_TRACE_DEDUPE_WINDOW_MS = 500

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic dedupe key from action + target + scope.
 * Two entries with the same key within ACTION_TRACE_DEDUPE_WINDOW_MS are considered duplicates.
 */
export function computeDedupeKey(
  entry: Pick<ActionTraceEntry, 'actionType' | 'target' | 'scopeKind' | 'scopeInstanceId'>
): string {
  return [
    entry.actionType,
    entry.target.kind,
    entry.target.id ?? '',
    entry.scopeKind,
    entry.scopeInstanceId ?? '',
  ].join(':')
}

/**
 * Generate a unique trace ID. Prefers crypto.randomUUID() for lower collision risk,
 * falls back to timestamp + random suffix.
 */
export function generateTraceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
