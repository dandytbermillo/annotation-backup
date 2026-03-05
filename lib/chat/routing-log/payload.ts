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
}
