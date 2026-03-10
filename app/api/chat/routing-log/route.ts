import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { normalizeForStorage, computeQueryFingerprint, sha256Hex } from '@/lib/chat/routing-log/normalization'
import { canonicalJsonSerialize, stripVolatileFields } from '@/lib/chat/routing-log/context-snapshot'
import { redactQueryText } from '@/lib/chat/routing-log/redaction'
import {
  OPTION_A_TENANT_ID,
  OPTION_A_USER_ID,
  NORMALIZATION_VERSION,
  EMBEDDING_MODEL_VERSION_NONE,
  THRESHOLDS_VERSION_NONE,
  MARGIN_VERSION_NONE,
} from '@/lib/chat/routing-log/types'
import type { RoutingLogPayload } from '@/lib/chat/routing-log/payload'

const INSERT_SQL = `
  INSERT INTO chat_routing_durable_log (
    tenant_id, user_id,
    session_id, interaction_id, turn_index,
    raw_query_text, normalized_query_text, normalization_version, query_fingerprint,
    context_snapshot_json, context_fingerprint,
    routing_lane, decision_source, candidate_ids_considered, chosen_id,
    risk_tier, provenance, result_status,
    embedding_model_version, effective_thresholds_version, effective_margin_version,
    effective_confidence_threshold, effective_near_tie_margin,
    commit_revalidation_result, commit_revalidation_reason_code,
    idempotency_key,
    log_phase,
    semantic_hint_metadata
  ) VALUES (
    $1, $2,
    $3, $4, $5,
    $6, $7, $8, $9,
    $10, $11,
    $12, $13, $14, $15,
    $16, $17, $18,
    $19, $20, $21,
    $22, $23,
    $24, $25,
    $26,
    $27,
    $28
  )
  ON CONFLICT ON CONSTRAINT uq_chat_routing_durable_log_interaction DO NOTHING
`

/**
 * POST /api/chat/routing-log
 *
 * Phase 1 observe-only: receives routing log payload from client,
 * normalizes, hashes, redacts, and inserts into chat_routing_durable_log.
 * Fail-open: returns 200 even on DB errors to avoid client-side noise.
 */
export async function POST(request: NextRequest) {
  // Unified feature flag: NEXT_PUBLIC_ vars are available server-side in Next.js.
  // Single flag eliminates client/server mismatch risk.
  if (process.env.NEXT_PUBLIC_CHAT_ROUTING_OBSERVE_ONLY !== 'true') {
    return NextResponse.json({ status: 'disabled' }, { status: 200 })
  }

  try {
    const payload: RoutingLogPayload = await request.json()

    // Normalize and hash on server side (crypto available here)
    const normalizedText = normalizeForStorage(payload.raw_query_text)
    const queryFingerprint = computeQueryFingerprint(normalizedText)
    const redactedText = redactQueryText(normalizedText)
    const rawRedacted = redactQueryText(payload.raw_query_text)

    const contextSnapshot = payload.context_snapshot
    // Hash stripped snapshot (without message_count) to match memory index fingerprint contract.
    // Full snapshot is still stored in context_snapshot_json for diagnostics.
    const contextFingerprint = sha256Hex(canonicalJsonSerialize(stripVolatileFields(contextSnapshot)))

    // Phase 3 B2/3c + Stage 4: build semantic_hint_metadata JSON when any telemetry present
    const hasSemanticMeta = payload.semantic_hint_count != null || payload.b2_status != null || payload.b2_clarifier_status != null || payload.llm_decision != null || payload.llm_g4_total_in != null || payload.s5_lookup_attempted != null
    const semanticHintMeta = hasSemanticMeta
      ? JSON.stringify({
          count: payload.semantic_hint_count,
          top_score: payload.semantic_top_score,
          hint_used: payload.semantic_hint_used,
          b2_status: payload.b2_status,
          b2_raw_count: payload.b2_raw_count,
          b2_validated_count: payload.b2_validated_count,
          b2_latency_ms: payload.b2_latency_ms,
          b2_clarifier_status: payload.b2_clarifier_status,
          b2_clarifier_match_count: payload.b2_clarifier_match_count,
          b2_clarifier_top_match_rank: payload.b2_clarifier_top_match_rank,
          b2_clarifier_top_match_id: payload.b2_clarifier_top_match_id,
          b2_clarifier_top_score: payload.b2_clarifier_top_score,
          b2_clarifier_message_id: payload.b2_clarifier_message_id,
          b2_clarifier_option_ids: payload.b2_clarifier_option_ids,
          clarifier_origin_message_id: payload.clarifier_origin_message_id,
          selected_option_id: payload.selected_option_id,
          // Stage 4: Bounded LLM telemetry
          llm_decision: payload.llm_decision,
          llm_confidence: payload.llm_confidence,
          llm_latency_ms: payload.llm_latency_ms,
          llm_choice_id: payload.llm_choice_id,
          llm_candidate_count: payload.llm_candidate_count,
          llm_rejection_reason: payload.llm_rejection_reason,
          // Stage 4 G4: Validator gate telemetry
          llm_g4_total_in: payload.llm_g4_total_in,
          llm_g4_total_out: payload.llm_g4_total_out,
          llm_g4_duplicates_removed: payload.llm_g4_duplicates_removed,
          llm_g4_rejections: payload.llm_g4_rejections,
          // Stage 4 G2+G3: Cap/trim telemetry
          llm_g23_pre_cap_count: payload.llm_g23_pre_cap_count,
          llm_g23_post_cap_count: payload.llm_g23_post_cap_count,
          llm_g23_was_trimmed: payload.llm_g23_was_trimmed,
          llm_g23_trimmed_ids: payload.llm_g23_trimmed_ids,
          // Stage 4 G1: Shadow threshold telemetry
          llm_g1_shadow_rejected: payload.llm_g1_shadow_rejected,
          // Stage 4 G5: TOCTOU shadow revalidation telemetry
          llm_g5_toctou_result: payload.llm_g5_toctou_result,
          llm_g5_toctou_reason: payload.llm_g5_toctou_reason,
          llm_g5_toctou_window_ms: payload.llm_g5_toctou_window_ms,
          // Stage 4 G7: Near-tie guard telemetry
          llm_g7_near_tie_detected: payload.llm_g7_near_tie_detected,
          llm_g7_margin: payload.llm_g7_margin,
          llm_g7_top1_score: payload.llm_g7_top1_score,
          llm_g7_top2_score: payload.llm_g7_top2_score,
          llm_g7_candidate_basis: payload.llm_g7_candidate_basis,
          // Stage 5: Semantic resolution reuse shadow telemetry
          s5_lookup_attempted: payload.s5_lookup_attempted,
          s5_candidate_count: payload.s5_candidate_count,
          s5_top_similarity: payload.s5_top_similarity,
          s5_validation_result: payload.s5_validation_result,
          s5_replayed_intent_id: payload.s5_replayed_intent_id,
          s5_replayed_target_id: payload.s5_replayed_target_id,
          s5_fallback_reason: payload.s5_fallback_reason,
        })
      : null

    await serverPool.query(INSERT_SQL, [
      OPTION_A_TENANT_ID, OPTION_A_USER_ID,
      payload.session_id, payload.interaction_id, payload.turn_index,
      rawRedacted, redactedText, NORMALIZATION_VERSION, queryFingerprint,
      JSON.stringify(contextSnapshot), contextFingerprint,
      payload.routing_lane, payload.decision_source, JSON.stringify([]), null,
      payload.risk_tier, payload.provenance, payload.result_status,
      EMBEDDING_MODEL_VERSION_NONE, THRESHOLDS_VERSION_NONE, MARGIN_VERSION_NONE,
      null, null,
      payload.commit_revalidation_result ?? null, payload.commit_revalidation_reason_code ?? null,
      null,
      payload.log_phase ?? 'routing_attempt',
      semanticHintMeta,
    ])

    return NextResponse.json({ status: 'ok' }, { status: 200 })
  } catch (err: unknown) {
    // Fail-open: log warning, return 200 to avoid polluting client error handling
    console.warn('[routing-log] server insert failed (non-fatal):', (err as Error).message)
    return NextResponse.json({ status: 'error', message: 'non-fatal' }, { status: 200 })
  }
}
