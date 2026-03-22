/**
 * Memory Validator (Client-Side) — Phase 2b
 *
 * Validates a memory candidate against the live UI snapshot.
 * Gate 3: Strict ID-based validation — concrete entity IDs, never label-only.
 *
 * Client-safe: no crypto, no DB imports.
 */

import type { MemoryLookupResult } from './memory-reader'
import type { RoutingLogPayload } from './payload'
import { recordRoutingLog } from './writer'

// Minimal turn snapshot interface to avoid importing the full UI snapshot builder
interface MinimalTurnSnapshot {
  openWidgets: {
    id: string
    label: string
    options: { id: string; label: string }[]
  }[]
}

/** Visible widget metadata for duplicate-family validation */
interface VisibleWidgetForValidation {
  id: string
  duplicateFamily?: string
}

export interface ValidationResult {
  valid: boolean
  reason?: 'target_widget_gone' | 'target_item_gone' | 'target_candidate_gone' | 'high_risk' | 'unknown_action_type' | 'duplicate_family_ambiguous' | 'target_panel_hidden'
}

/**
 * Validate a memory candidate against the current live UI snapshot.
 *
 * Gate 3 rules (strict ID-based, never label-only):
 * - execute_widget_item: widgetId must exist in openWidgets[].id AND itemId
 *   must exist in that widget's options[].id
 * - execute_referent: candidateId must exist in ANY openWidgets[].options[].id
 * - Risk tier 'high' is rejected (safety guard)
 * - Unknown action types are rejected
 *
 * Context fingerprint matching is already guaranteed by the SQL query.
 * This validator adds concrete entity ID checks against the live snapshot.
 */
export function validateMemoryCandidate(
  candidate: MemoryLookupResult,
  turnSnapshot: MinimalTurnSnapshot,
  visibleWidgets?: VisibleWidgetForValidation[],
): ValidationResult {
  // Safety guard: reject high-risk actions
  if (candidate.risk_tier === 'high') {
    return { valid: false, reason: 'high_risk' }
  }

  const actionType = candidate.slots_json.action_type as string | undefined

  if (actionType === 'execute_widget_item') {
    const widgetId = candidate.slots_json.widgetId as string
    const itemId = candidate.slots_json.itemId as string

    // Check widgetId exists in live snapshot (exact ID match)
    const widget = turnSnapshot.openWidgets.find((w) => w.id === widgetId)
    if (!widget) {
      return { valid: false, reason: 'target_widget_gone' }
    }

    // Check itemId exists in that widget's options (exact ID match)
    const item = widget.options.find((o) => o.id === itemId)
    if (!item) {
      return { valid: false, reason: 'target_item_gone' }
    }

    return { valid: true }
  }

  if (actionType === 'execute_referent') {
    const candidateId = candidate.slots_json.candidateId as string

    // Check candidateId exists in ANY widget's options (exact ID match)
    const found = turnSnapshot.openWidgets.some((w) =>
      w.options.some((o) => o.id === candidateId)
    )
    if (!found) {
      return { valid: false, reason: 'target_candidate_gone' }
    }

    return { valid: true }
  }

  // Phase 5 navigation action types — lighter validation because final target
  // validation happens in the execution path (executeAction → navigate handlers).
  // Risk tier is already checked above. Context fingerprint match is guaranteed by SQL.
  const PHASE5_NAV_ACTIONS = new Set(['open_entry', 'open_workspace', 'go_home', 'open_panel'])
  if (PHASE5_NAV_ACTIONS.has(actionType!)) {
    // Duplicate-family guard for open_panel: if the stored panel belongs to a
    // duplicable family with multiple visible siblings, reject the replay.
    // The user should go through the duplicate-aware routing path instead.
    if (actionType === 'open_panel' && visibleWidgets && visibleWidgets.length > 0) {
      const storedPanelId = candidate.slots_json.panelId as string | undefined
      if (storedPanelId) {
        // Check if stored panel is still visible (not hidden via Widget Manager)
        const storedWidget = visibleWidgets.find(w => w.id === storedPanelId)
        if (!storedWidget) {
          return { valid: false, reason: 'target_panel_hidden' }
        }
        // Duplicate-family ambiguity check
        const family = storedWidget.duplicateFamily
        if (family) {
          const siblingCount = visibleWidgets.filter(w => w.duplicateFamily === family).length
          if (siblingCount > 1) {
            return { valid: false, reason: 'duplicate_family_ambiguous' }
          }
        }
      }
    }
    return { valid: true }
  }

  // Unknown action type
  return { valid: false, reason: 'unknown_action_type' }
}

// --- Commit-point revalidation helper (Gate 1) ---

/**
 * Minimal routing result shape for revalidation.
 * Avoids importing the full RoutingDispatcherResult from the dispatcher.
 */
interface RevalidatableResult {
  handled: boolean
  groundingAction?: unknown
  _memoryCandidate?: MemoryLookupResult
  _pendingMemoryLog?: RoutingLogPayload
  _pendingMemoryWrite?: unknown
}

/**
 * Commit-point revalidation for memory-served actions (Gate 1).
 *
 * Called by sendMessage() just before executing a groundingAction.
 * Re-validates the memory candidate against a fresh UI snapshot.
 *
 * If invalid:
 * - Fires a failed durable log (best-effort, fail-open) with commit_revalidation fields (Gate 9)
 * - Returns the result with handled=false and memory fields cleared (falls through to LLM)
 *
 * If valid or not a memory-served result: returns unchanged.
 *
 * Client-safe: uses only validateMemoryCandidate + recordRoutingLog (HTTP wrapper).
 */
export function revalidateMemoryHit<T extends RevalidatableResult>(
  result: T,
  freshSnapshot: MinimalTurnSnapshot,
  visibleWidgets?: VisibleWidgetForValidation[],
): T {
  if (!result._memoryCandidate) return result

  const check = validateMemoryCandidate(result._memoryCandidate, freshSnapshot, visibleWidgets)
  if (check.valid) return result

  console.warn('[routing-memory] commit-point revalidation failed:', check.reason)

  // Gate 9: Fire failed log (best-effort — fail-open, gated by observe-only flag)
  if (result._pendingMemoryLog) {
    const failedLog: RoutingLogPayload = {
      ...result._pendingMemoryLog,
      result_status: 'failed',
      commit_revalidation_result: 'rejected',
      commit_revalidation_reason_code: check.reason ?? 'unknown',
    }
    recordRoutingLog(failedLog).catch(() => {})
  }

  return {
    ...result,
    handled: false,
    groundingAction: undefined,
    _memoryCandidate: undefined,
    _pendingMemoryLog: undefined,
    _pendingMemoryWrite: undefined,
  }
}
