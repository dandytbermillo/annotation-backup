/**
 * Memory Validator (Client-Side) — Phase 2b
 *
 * Validates a memory candidate against the live UI snapshot.
 * Gate 3: Strict ID-based validation — concrete entity IDs, never label-only.
 *
 * Client-safe: no crypto, no DB imports.
 */

import type { MemoryLookupResult } from './memory-reader'

// Minimal turn snapshot interface to avoid importing the full UI snapshot builder
interface MinimalTurnSnapshot {
  openWidgets: {
    id: string
    label: string
    options: { id: string; label: string }[]
  }[]
}

export interface ValidationResult {
  valid: boolean
  reason?: 'target_widget_gone' | 'target_item_gone' | 'target_candidate_gone' | 'high_risk' | 'unknown_action_type'
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

  // Unknown action type
  return { valid: false, reason: 'unknown_action_type' }
}
