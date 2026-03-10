/**
 * Routing Log Payload — Phase 1 Observe-Only
 *
 * Data structure sent from client to server API route.
 * The server handles normalization, hashing, redaction, and DB insert.
 * This keeps crypto (SHA-256) and DB access server-side only.
 *
 * One payload per routing decision (not per user turn). Deduplicated
 * server-side by interaction_id via ON CONFLICT DO NOTHING.
 */

import type { RoutingLane, DecisionSource, RiskTier, ResultStatus, LogPhase } from './types'
import type { ContextSnapshotV1 } from './context-snapshot'

/**
 * Payload sent from client → /api/chat/routing-log.
 * Contains raw routing data. Server applies:
 * - format-only normalization (normalizeForStorage)
 * - SHA-256 fingerprinting (query + context)
 * - redaction (redactQueryText)
 * - DB insert with ON CONFLICT DO NOTHING
 */
export interface RoutingLogPayload {
  // Raw inputs (server normalizes/hashes/redacts these)
  raw_query_text: string
  context_snapshot: ContextSnapshotV1

  // Pre-computed routing metadata (client has this info)
  session_id: string
  interaction_id: string
  turn_index: number
  routing_lane: RoutingLane
  decision_source: DecisionSource
  risk_tier: RiskTier
  provenance: string
  result_status: ResultStatus
  tier_label: string | undefined
  handled_by_tier: number | undefined

  // Phase 2 commit-point revalidation (optional — only set for memory-served decisions)
  commit_revalidation_result?: string    // 'passed' | 'rejected' | undefined
  commit_revalidation_reason_code?: string  // validation reason from Gate 3 checks

  // Bug #3 two-phase logging (optional — defaults to 'routing_attempt' on server)
  log_phase?: LogPhase

  // Phase 3 B2: Semantic hint telemetry (stored separately from context_snapshot to avoid fingerprint drift)
  semantic_hint_count?: number
  semantic_top_score?: number
  semantic_hint_used?: boolean

  // Phase 3 B2: B2 lookup attempt telemetry — set in dispatcher for ALL B2 outcomes
  // Only emitted when memoryReadEnabled=true (B2-eligible).
  // candidates_found means "raw candidates returned from API" — use b2_validated_count to check usable count.
  b2_status?: 'skipped' | 'no_candidates' | 'timeout_or_error' | 'candidates_found' | 'discarded_handled'
  b2_raw_count?: number        // candidates from API (before Gate 3 validation)
  b2_validated_count?: number   // candidates after Gate 3 validation
  b2_latency_ms?: number        // B2 lookup wall-clock time

  // Phase 3c: Clarifier assist telemetry — set when grounding clarifier is shown
  // Preserves Phase 3a lookup status precision (empty vs timeout vs error).
  b2_clarifier_status?: 'not_applicable' | 'no_b2_empty' | 'no_b2_timeout' | 'no_b2_error' | 'no_match' | 'matched_no_reorder' | 'reordered' | 'shadow_reordered'
  b2_clarifier_match_count?: number        // grounding candidates matching B2 candidates
  b2_clarifier_top_match_rank?: number     // original 1-based rank of top B2-matched candidate
  b2_clarifier_top_match_id?: string       // ID of top B2-matched grounding candidate
  b2_clarifier_top_score?: number          // similarity score of top matched B2 candidate
  b2_clarifier_message_id?: string         // clarifier message ID (for selection correlation)
  b2_clarifier_option_ids?: string[]       // ordered list of grounding candidate IDs as shown

  // Phase 3c: Selection correlation — set on the selection turn (user picks from clarifier)
  clarifier_origin_message_id?: string     // clarifier message ID that spawned this selection
  selected_option_id?: string              // ID of the option the user selected

  // Stage 4: Bounded LLM telemetry — set when Tier 4.5 grounding LLM is called
  llm_decision?: 'select' | 'need_more_info' | 'timeout' | 'error' | 'disabled'
  llm_confidence?: number                  // LLM-reported confidence (0.0-1.0)
  llm_latency_ms?: number                  // LLM round-trip wall-clock time
  llm_choice_id?: string                   // choiceId returned by LLM (before validation)
  llm_candidate_count?: number             // candidates passed to LLM (post-G4 validation)
  llm_rejection_reason?: 'invalid_choice_id' | 'low_confidence' | 'timeout' | 'error' | null

  // Stage 4 G4: Validator gate telemetry
  llm_g4_total_in?: number                 // candidates before G4 validation
  llm_g4_total_out?: number                // candidates after G4 validation
  llm_g4_duplicates_removed?: number       // duplicate IDs removed
  llm_g4_rejections?: Record<string, number>  // rejection reason → count

  // Stage 4 G2+G3: Cap/trim telemetry
  llm_g23_pre_cap_count?: number           // validated candidates before cap
  llm_g23_post_cap_count?: number          // candidates after cap (sent to LLM)
  llm_g23_was_trimmed?: boolean            // whether cap was applied
  llm_g23_trimmed_ids?: string[]           // IDs of trimmed candidates (if any)

  // Stage 4 G1: Shadow threshold telemetry (no behavior change)
  llm_g1_shadow_rejected?: boolean         // true when select survives 0.4 but would fail 0.75

  // Stage 4 G5: TOCTOU revalidation telemetry (shadow mode — no behavior change)
  llm_g5_toctou_result?: 'pass' | 'fail' | 'not_revalidated'
  llm_g5_toctou_reason?: string            // fail/not_revalidated reason code
  llm_g5_toctou_window_ms?: number         // ms between turnSnapshot capture and revalidation check
}
