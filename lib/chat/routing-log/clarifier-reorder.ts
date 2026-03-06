/**
 * Clarifier Reorder — Phase 3c
 *
 * Pure function: takes grounding candidates + B2 semantic candidates,
 * returns reordered grounding candidates with B2-matched items promoted.
 *
 * Contract (per semantic-memory-clarifier-assist-plan.md §2):
 * - Reorder only — never adds new options
 * - No auto-execute — user still picks from the list
 * - No tier bypass — tiers 0-5 remain authoritative
 * - Existing validators stay authoritative
 *
 * Client-safe: no crypto, no DB imports.
 */

import type { SemanticCandidate } from './memory-semantic-reader'

// Minimal grounding candidate interface to avoid importing from grounding-set
// (which has heavy deps). Only the fields needed for ID matching.
export interface ReorderableCandidate {
  id: string
  label: string
  type: string
  actionHint?: string
}

export interface ClarifierReorderResult {
  /** Reordered candidates (same length as input, no additions) */
  candidates: ReorderableCandidate[]
  /** Whether any reordering occurred */
  reordered: boolean
  /** Number of grounding candidates that matched B2 candidates */
  matchCount: number
  /** Original 1-based rank of the top B2-matched candidate (before reordering) */
  topMatchOriginalRank: number | undefined
  /** ID of the top B2-matched grounding candidate */
  topMatchId: string | undefined
  /** Similarity score of the top matched B2 candidate */
  topMatchScore: number | undefined
}

/**
 * Reorder grounding candidates by promoting B2-matched items to the front.
 *
 * Match condition: groundingCandidate.id === b2Candidate.slots_json.itemId
 *                  || groundingCandidate.id === b2Candidate.slots_json.candidateId
 *
 * If multiple B2 candidates match multiple grounding candidates, matched candidates
 * are sorted by B2 similarity_score DESC and placed before unmatched candidates.
 * Unmatched candidates preserve their original relative order.
 *
 * @param groundingCandidates - Current grounding candidates in original order
 * @param semanticCandidates - B2 semantic candidates (may be empty/undefined)
 * @returns Reorder result with candidates and telemetry metadata
 */
/** Telemetry output from computeClarifierReorderTelemetry */
export interface ClarifierReorderTelemetry {
  status: string
  messageId: string
  optionIds: string[]
  matchCount: number
  topMatchOriginalRank?: number
  topMatchId?: string
  topMatchScore?: number
}

/**
 * Compute clarifier reorder telemetry for a shadow-mode clarifier turn.
 *
 * Pure function: takes grounding candidates, B2 semantic candidates, and B2 lookup status.
 * Returns telemetry describing what would happen if reordering were applied.
 *
 * Status classification:
 * - not_applicable — B2 not attempted (undefined/disabled lookup status)
 * - no_b2_empty — B2 succeeded but no usable candidates (empty or ok with all filtered)
 * - no_b2_timeout — B2 timed out
 * - no_b2_error — B2 errored
 * - no_match — B2 returned candidates but none matched grounding candidates by ID
 * - matched_no_reorder — B2 matched but top match already at position 1
 * - shadow_reordered — B2 would have changed visible order
 */
export function computeClarifierReorderTelemetry(
  groundingCandidates: ReorderableCandidate[],
  semanticCandidates: SemanticCandidate[] | undefined,
  clarifierMsgId: string,
  b2LookupStatus: 'ok' | 'empty' | 'timeout' | 'error' | 'disabled' | undefined,
): ClarifierReorderTelemetry {
  const optionIds = groundingCandidates.map(c => c.id)

  // No usable B2 candidates — classify based on lookup status
  if (!semanticCandidates || semanticCandidates.length === 0) {
    let status: string
    if (b2LookupStatus === 'timeout') status = 'no_b2_timeout'
    else if (b2LookupStatus === 'error') status = 'no_b2_error'
    else if (b2LookupStatus === 'empty' || b2LookupStatus === 'ok') status = 'no_b2_empty'
    else status = 'not_applicable' // undefined (not attempted) or 'disabled'

    return { status, messageId: clarifierMsgId, optionIds, matchCount: 0 }
  }

  const reorderResult = reorderClarifierCandidates(groundingCandidates, semanticCandidates)

  if (!reorderResult.reordered) {
    return {
      status: reorderResult.matchCount > 0 ? 'matched_no_reorder' : 'no_match',
      messageId: clarifierMsgId,
      optionIds,
      matchCount: reorderResult.matchCount,
      topMatchOriginalRank: reorderResult.topMatchOriginalRank,
      topMatchId: reorderResult.topMatchId,
      topMatchScore: reorderResult.topMatchScore,
    }
  }

  return {
    status: 'shadow_reordered',
    messageId: clarifierMsgId,
    optionIds, // original order (shadow mode)
    matchCount: reorderResult.matchCount,
    topMatchOriginalRank: reorderResult.topMatchOriginalRank,
    topMatchId: reorderResult.topMatchId,
    topMatchScore: reorderResult.topMatchScore,
  }
}

export function reorderClarifierCandidates(
  groundingCandidates: ReorderableCandidate[],
  semanticCandidates: SemanticCandidate[] | undefined,
): ClarifierReorderResult {
  // No B2 candidates → no reorder
  if (!semanticCandidates || semanticCandidates.length === 0) {
    return {
      candidates: groundingCandidates,
      reordered: false,
      matchCount: 0,
      topMatchOriginalRank: undefined,
      topMatchId: undefined,
      topMatchScore: undefined,
    }
  }

  // Build a map from B2 target ID → best similarity score
  // A single B2 candidate can match via itemId or candidateId
  const b2ScoreMap = new Map<string, number>()
  for (const sc of semanticCandidates) {
    const itemId = sc.slots_json.itemId as string | undefined
    const candidateId = sc.slots_json.candidateId as string | undefined
    for (const id of [itemId, candidateId]) {
      if (id) {
        const existing = b2ScoreMap.get(id)
        if (existing === undefined || sc.similarity_score > existing) {
          b2ScoreMap.set(id, sc.similarity_score)
        }
      }
    }
  }

  // Partition grounding candidates into matched and unmatched
  const matched: { candidate: ReorderableCandidate; originalIndex: number; score: number }[] = []
  const unmatched: ReorderableCandidate[] = []

  for (let i = 0; i < groundingCandidates.length; i++) {
    const gc = groundingCandidates[i]
    const score = b2ScoreMap.get(gc.id)
    if (score !== undefined) {
      matched.push({ candidate: gc, originalIndex: i, score })
    } else {
      unmatched.push(gc)
    }
  }

  // No matches → no reorder
  if (matched.length === 0) {
    return {
      candidates: groundingCandidates,
      reordered: false,
      matchCount: 0,
      topMatchOriginalRank: undefined,
      topMatchId: undefined,
      topMatchScore: undefined,
    }
  }

  // Sort matched by B2 similarity_score DESC
  matched.sort((a, b) => b.score - a.score)

  const topMatch = matched[0]

  // Check if reordering actually changes the order
  // (top match is already at position 0 AND only one match → no visible change)
  const reordered = topMatch.originalIndex !== 0 || matched.length > 1

  return {
    candidates: [...matched.map(m => m.candidate), ...unmatched],
    reordered,
    matchCount: matched.length,
    topMatchOriginalRank: topMatch.originalIndex + 1, // 1-based
    topMatchId: topMatch.candidate.id,
    topMatchScore: topMatch.score,
  }
}
