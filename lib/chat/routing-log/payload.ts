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

  // Stage 4 G7: Near-tie guard telemetry (shadow mode — no behavior change)
  // Only emitted when >= 2 validated candidates have B2 scores on select path
  llm_g7_near_tie_detected?: boolean       // true when top1 - top2 < 0.02
  llm_g7_margin?: number                   // score difference between top-1 and top-2 B2 candidates
  llm_g7_top1_score?: number               // B2 similarity score of highest-scored candidate
  llm_g7_top2_score?: number               // B2 similarity score of second-highest candidate
  llm_g7_candidate_basis?: string          // 'b2_scored_validated' — which candidate set was scored

  // Stage 5: Semantic resolution reuse shadow telemetry
  // Emitted when B2 returns validated candidates (Stage 5 evaluation ran)
  s5_lookup_attempted?: boolean            // true = Stage 5 evaluation ran on B2 candidates
  s5_candidate_count?: number              // B2 validated candidates evaluated by Stage 5
  s5_top_similarity?: number               // highest similarity score among evaluated candidates
  s5_validation_result?: string            // mutually exclusive outcome (see S5ValidationResult)
  s5_replayed_intent_id?: string           // only on shadow_replay_eligible
  s5_replayed_target_id?: string           // only on shadow_replay_eligible
  s5_fallback_reason?: string              // detail on why Stage 5 fell through

  // Stage 6: Agent Tool Loop shadow telemetry
  // Emitted as a separate execution_outcome row when shadow loop completes
  s6_loop_entered?: boolean               // true = Stage 6 shadow loop fired
  s6_escalation_reason?: string           // why Stage 4 escalated (stage4_abstain, stage4_timeout)
  s6_inspect_rounds?: number              // inspect tool calls made in loop
  s6_outcome?: string                     // S6LoopOutcome (action_executed, clarification_accepted, abort, etc.)
  s6_duration_ms?: number                 // loop wall-clock time
  s6_tool_trace?: string[]                // ordered tool/action names from loop
  s6_action_type?: string                 // terminal action type (open_widget_item, open_panel, navigate_entry)
  s6_action_target_id?: string            // target ID of the terminal action
  s6_action_status?: string               // action execution status
  s6_action_rejection_reason?: string     // rejection reason when action_status is 'rejected'
  s6_clarify_candidate_count?: number     // candidate count when clarification chosen
  s6_abort_reason?: string                // reason if outcome was abort
  s6_evidence_gate?: string               // open_panel evidence gate result (allowed, ambiguous_siblings)
  s6_evidence_sibling_count?: number      // sibling panel count when evidence gate is ambiguous
  // Content extension telemetry (6x.3)
  s6_content_tool_used?: boolean          // whether any content tool was called in this loop
  s6_content_call_count?: number          // number of content-tool calls made
  s6_content_chars_returned?: number      // total characters returned across content tool responses
  // Content answer telemetry (6x.4)
  s6_answer_outcome?: string              // S6ContentAnswerOutcome (answered, clarified, abort)
  s6_answer_grounded?: boolean            // whether answer was grounded in evidence
  s6_answer_cited_count?: number          // number of unique cited snippet IDs
  s6_answer_reason?: string               // reason for clarify or abort outcome
  // Auto-fill transparency markers (6x.5)
  s6_citations_autofilled?: boolean       // whether citedSnippetIds was server-filled
  s6_grounded_autofilled?: boolean        // whether grounded was server-filled
  // Stage 6x.7: Anchored-note intent resolver (Phase A) — legacy
  note_intent_resolver_called?: boolean
  note_intent_resolver_decision?: string
  note_intent_resolver_confidence?: number
  note_intent_resolver_reason?: string
  note_intent_resolver_result?: string
  // Stage 6x.8: Cross-surface arbiter (Phase 3)
  cross_surface_arbiter_called?: boolean
  cross_surface_arbiter_surface?: string
  cross_surface_arbiter_intent?: string
  cross_surface_arbiter_confidence?: number
  cross_surface_arbiter_result?: string

  // Phase 5: Retrieval-backed semantic hint telemetry
  h1_lookup_attempted?: boolean
  h1_lookup_status?: string              // 'ok' | 'empty' | 'timeout' | 'error' | 'disabled'
  h1_candidate_count?: number
  h1_top_similarity?: number
  h1_scope?: string                      // 'history_info' | 'navigation'
  h1_hint_accepted_by_llm?: boolean
  h1_retrieved_intent_id?: string
  h1_latency_ms?: number
  h1_from_curated_seed?: boolean
}
