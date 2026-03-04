/**
 * Durable Log Types — Phase 1 Observe-Only
 *
 * 1:1 match with migrations/067_chat_routing_durable_log.up.sql columns.
 * All enum values must match CHECK constraints in the migration exactly.
 */

// --- Enum types matching migration 067 CHECK constraints ---

/** routing_lane CHECK (line 32): 'A','B1','B2','C','D','E' */
export type RoutingLane = 'A' | 'B1' | 'B2' | 'C' | 'D' | 'E'

/** decision_source CHECK (line 33): 'deterministic','memory_exact','memory_semantic','llm','clarifier' */
export type DecisionSource = 'deterministic' | 'memory_exact' | 'memory_semantic' | 'llm' | 'clarifier'

/** risk_tier CHECK (line 36): 'low','medium','high' */
export type RiskTier = 'low' | 'medium' | 'high'

/** result_status CHECK (line 38): 'executed','clarified','blocked','failed' */
export type ResultStatus = 'executed' | 'clarified' | 'blocked' | 'failed'

// --- Option A constants ---

export const OPTION_A_TENANT_ID = 'default'
export const OPTION_A_USER_ID = 'local'

// --- Phase 1 version constants ---

export const NORMALIZATION_VERSION = 'format_v1'
export const EMBEDDING_MODEL_VERSION_NONE = 'none'
export const THRESHOLDS_VERSION_NONE = 'none'
export const MARGIN_VERSION_NONE = 'none'

// --- Phase 2 memory index constants ---

export const MEMORY_SCHEMA_VERSION = 'v1'
export const MEMORY_TOOL_VERSION = 'v2'
export const MEMORY_DEFAULT_TTL_DAYS = 30
export const MEMORY_WRITE_TIMEOUT_MS = 50
export const MEMORY_READ_TIMEOUT_MS = 150

// --- Row interface ---

/**
 * DurableLogRow — represents one row in chat_routing_durable_log.
 * Fields `id` and `created_at` are DB defaults (not included here).
 */
export interface DurableLogRow {
  // Tenant/user isolation
  tenant_id: string
  user_id: string

  // Session and turn identification
  session_id: string
  interaction_id: string
  turn_index: number

  // Query text (raw + normalized)
  raw_query_text: string
  normalized_query_text: string
  normalization_version: string
  query_fingerprint: string

  // Context snapshot and fingerprint
  context_snapshot_json: Record<string, unknown>
  context_fingerprint: string

  // Routing decision metadata
  routing_lane: RoutingLane
  decision_source: DecisionSource
  candidate_ids_considered: string[]
  chosen_id: string | null
  risk_tier: RiskTier
  provenance: string
  result_status: ResultStatus

  // Model and config versions
  embedding_model_version: string
  effective_thresholds_version: string
  effective_margin_version: string
  effective_confidence_threshold: number | null
  effective_near_tie_margin: number | null

  // TOCTOU commit-time revalidation
  commit_revalidation_result: string | null
  commit_revalidation_reason_code: string | null

  // Idempotency
  idempotency_key: string | null
}
