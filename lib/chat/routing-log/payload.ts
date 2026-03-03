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

import type { RoutingLane, DecisionSource, RiskTier, ResultStatus } from './types'
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
}
