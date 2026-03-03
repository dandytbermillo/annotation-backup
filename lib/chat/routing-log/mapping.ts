/**
 * Lane / Source / Status Mapping — Phase 1 Observe-Only
 *
 * Phase 1 stable mapping table (temporary, documented).
 * All output values MUST match migration 067 CHECK constraints exactly.
 *
 * ChatProvenance union (from chat-navigation-context.tsx):
 *   'deterministic' | 'llm_executed' | 'llm_influenced' | 'llm_clarifier' | 'safe_clarifier' | 'memory_exact'
 */

import type { RoutingLane, DecisionSource, ResultStatus, RiskTier } from './types'

// --- Tier → Lane ---

/**
 * Map dispatcher tier to routing lane.
 * Phase 1 temporary mapping — kept stable until lane architecture replaces tiers.
 *
 * | Tier | Lane | Rationale |
 * |------|------|-----------|
 * | 0    | A    | Deterministic clarification intercept |
 * | 1    | A    | Deterministic scope-cue |
 * | 2    | A    | Deterministic exact match |
 * | 3    | A    | Deterministic ordinal/selection |
 * | 4    | D    | Grounding/LLM-assisted |
 * | 5    | D    | Classifier/LLM-assisted |
 * | undefined | E | Clarifier/fallback lane |
 */
export function tierToLane(tier: number | undefined): RoutingLane {
  switch (tier) {
    case 0: return 'A'
    case 1: return 'A'
    case 2: return 'A'
    case 3: return 'A'
    case 4: return 'D'
    case 5: return 'D'
    default: return 'E'
  }
}

// --- Provenance → decision_source ---

/**
 * Map _devProvenanceHint to decision_source.
 * Unknown/undefined defaults to 'clarifier' — NEVER default to 'deterministic'
 * (would poison analytics).
 */
export function provenanceToDecisionSource(hint: string | undefined): DecisionSource {
  switch (hint) {
    case 'deterministic': return 'deterministic'
    case 'llm_executed': return 'llm'
    case 'llm_influenced': return 'llm'
    case 'llm_clarifier': return 'clarifier'
    case 'safe_clarifier': return 'clarifier'
    case 'memory_exact': return 'memory_exact'
    default: return 'clarifier'
  }
}

// --- Result status ---

/**
 * Derive result_status from routing result.
 * Explicit rules for ambiguous handled paths — never claim 'executed' without clear provenance.
 */
export function deriveResultStatus(
  handled: boolean,
  provenanceHint: string | undefined,
  tierLabel: string | undefined,
): ResultStatus {
  // Memory-exact: always 'executed' (validated against live snapshot before use)
  if (provenanceHint === 'memory_exact') return 'executed'

  // Clarifier paths: always 'clarified'
  if (provenanceHint === 'safe_clarifier') return 'clarified'
  if (provenanceHint === 'llm_clarifier') return 'clarified'

  if (!handled) return 'failed'

  // Deterministic execute
  if (provenanceHint === 'deterministic') return 'executed'

  // LLM-confirmed execute
  if (provenanceHint === 'llm_executed') return 'executed'

  // LLM-influenced: check tierLabel for execute/select indicators
  if (provenanceHint === 'llm_influenced') {
    if (tierLabel && (tierLabel.includes('execute') || tierLabel.includes('select'))) {
      return 'executed'
    }
    return 'clarified'
  }

  // Unknown provenance + handled: safe default (never claim executed without clear provenance)
  return 'clarified'
}

// --- Risk tier ---

/**
 * Phase 1 heuristic risk tier.
 * LLM-assisted actions → 'medium', all others → 'low'.
 * No 'high' in Phase 1 (requires policy override infrastructure).
 */
export function deriveRiskTier(
  handled: boolean,
  tier: number | undefined,
): RiskTier {
  if (handled && (tier === 4 || tier === 5)) return 'medium'
  return 'low'
}
