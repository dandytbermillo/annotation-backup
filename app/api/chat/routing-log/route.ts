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
    idempotency_key
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
    $26
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
    ])

    return NextResponse.json({ status: 'ok' }, { status: 200 })
  } catch (err: unknown) {
    // Fail-open: log warning, return 200 to avoid polluting client error handling
    console.warn('[routing-log] server insert failed (non-fatal):', (err as Error).message)
    return NextResponse.json({ status: 'error', message: 'non-fatal' }, { status: 200 })
  }
}
