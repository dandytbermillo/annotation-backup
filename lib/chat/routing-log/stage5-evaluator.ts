/**
 * Stage 5 Evaluator — Unified Semantic Replay Arbitration
 *
 * Evaluates the unified candidate pool (B2 learned + Phase 5 curated seeds)
 * for replay eligibility using the shared strong-winner / near-tie contract.
 *
 * Pipeline per candidate:
 * 0. Context fingerprint match (curated seeds bypass — context-independent)
 * 1. Action type allowlist (execute_widget_item, execute_referent, surface_manifest_execute, open_panel, open_entry, open_workspace, go_home)
 * 2. Risk tier gate (low only)
 * 3. Target exists + visible (reuses validateMemoryCandidate with visibleWidgets)
 *
 * Outcome (shared strong-winner / near-tie arbitration):
 * - Top candidate >= 0.88 AND margin over runner-up >= 0.03 → shadow_replay_eligible
 * - Near-tie (margin < 0.03) → rejected_ambiguous
 * - Below threshold → rejected_ambiguous
 * - 0 survivors → rejection reason (closest-to-passing priority)
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
// No-clarifier convergence: surface_manifest_execute added for list_items/open_surface semantic replay
const S5_ACTION_ALLOWLIST = new Set(['execute_widget_item', 'execute_referent', 'surface_manifest_execute', 'open_panel', 'open_entry', 'open_workspace', 'go_home'])

/**
 * Validation result — mutually exclusive, final.
 * Priority for 0-survivor case: target > risk_tier > action_type > context_mismatch
 * (closest-to-passing reported first)
 */
export type S5ValidationResult =
  | 'shadow_replay_eligible'
  | 'replay_executed'
  | 'replay_build_failed'
  | 'rejected_context_mismatch'
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
  /** The single surviving candidate — only set on shadow_replay_eligible */
  winnerCandidate?: SemanticCandidate
}

/**
 * Evaluate B2 semantic candidates for Stage 5 replay eligibility.
 *
 * @param candidates - B2 validated candidates (already Gate 3 passed, >= 0.92 similarity)
 * @param turnSnapshot - Current live UI snapshot for target validation
 * @param currentContextFingerprint - Current context fingerprint (computed server-side).
 *        When provided, candidates whose stored context_fingerprint doesn't match are rejected.
 * @returns Evaluation result with shadow telemetry fields
 */
// Navigation action types use a minimal fingerprint (version + latch_enabled only).
// Matches the write route at app/api/chat/routing-memory/route.ts:105-108.
const NAVIGATION_ACTION_TYPES = new Set(['open_panel', 'open_entry', 'open_workspace', 'go_home'])

export function evaluateStage5Replay(
  candidates: SemanticCandidate[],
  turnSnapshot: MinimalTurnSnapshot,
  currentContextFingerprint?: string,
  visibleWidgets?: Array<{ id: string; title: string; type: string; instanceLabel?: string; duplicateFamily?: string }>,
  navigationContextFingerprint?: string,
): S5EvaluationResult {
  const candidateCount = candidates.length
  const topSimilarity = candidateCount > 0
    ? Math.max(...candidates.map(c => c.similarity_score))
    : undefined

  // Per-gate rejection counters (for closest-to-passing reporting)
  let rejContextMismatch = 0
  let rejActionType = 0
  let rejRiskTier = 0
  let rejTarget = 0
  let lastTargetReason: string | undefined

  const survivors: SemanticCandidate[] = []

  for (const c of candidates) {
    const actionType = c.slots_json.action_type as string | undefined

    // Gate 0: context fingerprint match (Fix B — strict context check)
    // Curated seeds bypass Gate 0 — they are context-independent by design.
    // Navigation action types use the navigation fingerprint (minimal: version + latch_enabled).
    // Non-navigation action types use the broad fingerprint (includes panel count, clarification state).
    const isCuratedSeed = (c as any).from_curated_seed === true
    const isNavAction = actionType ? NAVIGATION_ACTION_TYPES.has(actionType) : false
    const gate0Fingerprint = isNavAction && navigationContextFingerprint
      ? navigationContextFingerprint
      : currentContextFingerprint
    if (!isCuratedSeed && gate0Fingerprint && c.context_fingerprint !== gate0Fingerprint) {
      console.log('[stage5] Gate 0 REJECT (context mismatch):', { intentId: c.intent_id, actionType })
      rejContextMismatch++
      continue
    }

    // Gate 1: action type allowlist
    if (!actionType || !S5_ACTION_ALLOWLIST.has(actionType)) {
      console.log('[stage5] Gate 1 REJECT (action type):', { intentId: c.intent_id, actionType })
      rejActionType++
      continue
    }

    // Gate 2: risk tier (low only)
    if (c.risk_tier !== 'low') {
      console.log('[stage5] Gate 2 REJECT (risk tier):', { intentId: c.intent_id, actionType, riskTier: c.risk_tier })
      rejRiskTier++
      continue
    }

    // Gate 3: target exists + visible (reuse memory-validator with visibleWidgets for open_panel checks)
    const v = validateMemoryCandidate(c, turnSnapshot, visibleWidgets)
    if (!v.valid) {
      console.log('[stage5] Gate 3 REJECT (validation):', { intentId: c.intent_id, actionType, reason: v.reason })
      rejTarget++
      lastTargetReason = v.reason
      continue
    }

    console.log('[stage5] SURVIVOR:', { intentId: c.intent_id, actionType, riskTier: c.risk_tier, score: c.similarity_score })
    survivors.push(c)
  }

  // --- Determine outcome using shared strong-winner / near-tie arbitration ---
  // Replaces the old crude "exactly 1 survivor" rule with the plan's threshold contract:
  // - top candidate >= 0.88, margin over runner-up >= 0.03, validation passes → execute
  // - otherwise → clarify (rejected_ambiguous)

  const DIRECT_EXECUTE_THRESHOLD = 0.88
  const NEAR_TIE_MARGIN = 0.03

  if (survivors.length >= 1) {
    // Sort by score descending
    survivors.sort((a, b) => b.similarity_score - a.similarity_score)
    const top = survivors[0]
    const runnerUpScore = survivors.length >= 2 ? survivors[1].similarity_score : 0
    const margin = top.similarity_score - runnerUpScore
    const isNearTie = survivors.length >= 2 && margin < NEAR_TIE_MARGIN
    const isStrongWinner = top.similarity_score >= DIRECT_EXECUTE_THRESHOLD && !isNearTie

    if (isStrongWinner) {
      const at = top.slots_json.action_type as string
      const targetId = at === 'execute_widget_item'
        ? (top.slots_json.itemId as string)
        : at === 'execute_referent'
          ? (top.slots_json.candidateId as string)
          : (top.target_ids[0] ?? '')

      return {
        attempted: true,
        candidateCount,
        topSimilarity,
        validationResult: 'shadow_replay_eligible',
        replayedIntentId: top.intent_id,
        replayedTargetId: targetId,
        winnerCandidate: top,
      }
    }

    // Multiple survivors with no clear strong winner → ambiguous
    return {
      attempted: true,
      candidateCount,
      topSimilarity,
      validationResult: 'rejected_ambiguous',
      fallbackReason: isNearTie
        ? `near_tie_${survivors.length}_survivors_margin_${margin.toFixed(3)}`
        : `below_threshold_${top.similarity_score.toFixed(3)}`,
    }
  }

  // 0 survivors — report closest-to-passing rejection
  // Priority: target (passed all prior gates) > risk_tier > action_type > context_mismatch
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
  } else if (rejContextMismatch > 0) {
    validationResult = 'rejected_context_mismatch'
    fallbackReason = `${rejContextMismatch}_fingerprint_mismatch`
  }

  return {
    attempted: true,
    candidateCount,
    topSimilarity,
    validationResult,
    fallbackReason,
  }
}
