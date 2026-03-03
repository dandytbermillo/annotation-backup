/**
 * Memory Action Builder (Client-Side) — Phase 2b
 *
 * Reconstructs a RoutingDispatcherResult from a validated memory entry.
 * Returns null for unknown action types (fall through to normal tier chain).
 *
 * Client-safe: no crypto, no DB imports.
 */

import type { MemoryLookupResult } from './memory-reader'

// Forward-reference to avoid importing full dispatcher (too many deps)
interface MinimalRoutingResult {
  handled: boolean
  handledByTier?: number
  tierLabel?: string
  clarificationCleared: boolean
  isNewQuestionOrCommandDetected: boolean
  classifierCalled: boolean
  classifierTimeout: boolean
  classifierError: boolean
  isFollowUp: boolean
  _devProvenanceHint?: string
  _memoryCandidate?: MemoryLookupResult
  groundingAction?: {
    type: 'execute_referent'
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
}

/**
 * Reconstruct a RoutingDispatcherResult from a validated memory entry.
 *
 * Gate 2: Uses 'memory_exact' provenance — distinct from 'deterministic'.
 * Gate 1: Attaches _memoryCandidate for commit-point revalidation in sendMessage.
 *
 * Returns null for unknown action types.
 */
export function buildResultFromMemory(
  candidate: MemoryLookupResult,
  defaultResult: MinimalRoutingResult,
): MinimalRoutingResult | null {
  const actionType = candidate.slots_json.action_type as string | undefined

  let groundingAction: MinimalRoutingResult['groundingAction']

  if (actionType === 'execute_widget_item') {
    groundingAction = {
      type: 'execute_widget_item',
      widgetId: candidate.slots_json.widgetId as string,
      segmentId: (candidate.slots_json.segmentId as string | null) ?? undefined,
      itemId: candidate.slots_json.itemId as string,
      itemLabel: candidate.slots_json.itemLabel as string,
      action: candidate.slots_json.action as string,
    }
  } else if (actionType === 'execute_referent') {
    groundingAction = {
      type: 'execute_referent',
      syntheticMessage: candidate.slots_json.syntheticMessage as string,
      candidateId: candidate.slots_json.candidateId as string,
      candidateLabel: candidate.slots_json.candidateLabel as string,
      actionHint: (candidate.slots_json.actionHint as string | null) ?? undefined,
    }
  } else {
    // Unknown action type — cannot reconstruct, fall through
    return null
  }

  return {
    ...defaultResult,
    handled: true,
    handledByTier: undefined, // Memory lane, not a tier
    tierLabel: `memory_exact:${candidate.intent_id}`,
    _devProvenanceHint: 'memory_exact',
    _memoryCandidate: candidate,
    groundingAction,
  }
}
