/**
 * Stage 5 Evaluator — Semantic Resolution Reuse (Shadow Mode)
 *
 * Pure function that evaluates B2 semantic candidates for replay eligibility.
 * Slice 1: shadow-only — logs what would happen, never executes.
 *
 * Pipeline per candidate:
 * 1. Action type allowlist (execute_widget_item, execute_referent)
 * 2. Risk tier gate (low only)
 * 3. Target exists + visible (reuses validateMemoryCandidate from memory-validator)
 *
 * Outcome:
 * - Exactly 1 survivor → shadow_replay_eligible
 * - 0 survivors → rejection reason (closest-to-passing priority)
 * - >1 survivors → rejected_ambiguous (silent fall-through)
 *
 * Does NOT threshold on similarity_score — B2 SQL pre-thresholds at >= 0.92.
 * Does NOT check schema/tool version — single-deployment, deferred to Slice 2.
 *
 * Client-safe: no crypto, no DB imports.
 */

import type { SemanticCandidate } from './memory-semantic-reader'
import { validateMemoryCandidate } from './memory-validator'

// Minimal turn snapshot — same interface as memory-validator
interface MinimalTurnSnapshot {
  openWidgets: {
    id: string
    label: string
    options: { id: string; label: string }[]
  }[]
}

// Action types eligible for Stage 5 replay
const S5_ACTION_ALLOWLIST = new Set(['execute_widget_item', 'execute_referent'])

/**
 * Validation result — mutually exclusive, final.
 * Priority for 0-survivor case: target > risk_tier > action_type
 * (closest-to-passing reported first)
 */
export type S5ValidationResult =
  | 'shadow_replay_eligible'
  | 'replay_executed'
  | 'replay_build_failed'
  | 'rejected_action_type'
  | 'rejected_risk_tier'
  | 'rejected_target_gone'
  | 'rejected_target_not_visible'
  | 'rejected_ambiguous'
  | 'no_eligible'

export interface S5EvaluationResult {
  attempted: true
  candidateCount: number
  topSimilarity: number | undefined
  validationResult: S5ValidationResult
  replayedIntentId?: string
  replayedTargetId?: string
  fallbackReason?: string
}

/**
 * Evaluate B2 semantic candidates for Stage 5 replay eligibility.
 *
 * @param candidates - B2 validated candidates (already Gate 3 passed, >= 0.92 similarity)
 * @param turnSnapshot - Current live UI snapshot for target validation
 * @returns Evaluation result with shadow telemetry fields
 */
export function evaluateStage5Replay(
  candidates: SemanticCandidate[],
  turnSnapshot: MinimalTurnSnapshot,
): S5EvaluationResult {
  const candidateCount = candidates.length
  const topSimilarity = candidateCount > 0
    ? Math.max(...candidates.map(c => c.similarity_score))
    : undefined

  // Per-gate rejection counters (for closest-to-passing reporting)
  let rejActionType = 0
  let rejRiskTier = 0
  let rejTarget = 0
  let lastTargetReason: string | undefined

  const survivors: SemanticCandidate[] = []

  for (const c of candidates) {
    // Gate 1: action type allowlist
    const actionType = c.slots_json.action_type as string | undefined
    if (!actionType || !S5_ACTION_ALLOWLIST.has(actionType)) {
      rejActionType++
      continue
    }

    // Gate 2: risk tier (low only — B2 SQL returns low + medium, Stage 5 narrows to low)
    if (c.risk_tier !== 'low') {
      rejRiskTier++
      continue
    }

    // Gate 3: target exists + visible (reuse memory-validator)
    const v = validateMemoryCandidate(c, turnSnapshot)
    if (!v.valid) {
      rejTarget++
      lastTargetReason = v.reason
      continue
    }

    survivors.push(c)
  }

  // --- Determine outcome ---

  if (survivors.length === 1) {
    const winner = survivors[0]
    const at = winner.slots_json.action_type as string
    const targetId = at === 'execute_widget_item'
      ? (winner.slots_json.itemId as string)
      : (winner.slots_json.candidateId as string)

    return {
      attempted: true,
      candidateCount,
      topSimilarity,
      validationResult: 'shadow_replay_eligible',
      replayedIntentId: winner.intent_id,
      replayedTargetId: targetId,
    }
  }

  if (survivors.length > 1) {
    return {
      attempted: true,
      candidateCount,
      topSimilarity,
      validationResult: 'rejected_ambiguous',
      fallbackReason: `${survivors.length}_passed_all_gates`,
    }
  }

  // 0 survivors — report closest-to-passing rejection
  // Priority: target (passed action_type + risk_tier) > risk_tier (passed action_type) > action_type
  let validationResult: S5ValidationResult = 'no_eligible'
  let fallbackReason: string | undefined

  if (rejTarget > 0) {
    validationResult = lastTargetReason === 'target_candidate_gone'
      ? 'rejected_target_not_visible'
      : 'rejected_target_gone'
    fallbackReason = lastTargetReason
  } else if (rejRiskTier > 0) {
    validationResult = 'rejected_risk_tier'
    fallbackReason = `${rejRiskTier}_medium_or_high`
  } else if (rejActionType > 0) {
    validationResult = 'rejected_action_type'
    fallbackReason = `${rejActionType}_not_in_allowlist`
  }

  return {
    attempted: true,
    candidateCount,
    topSimilarity,
    validationResult,
    fallbackReason,
  }
}
