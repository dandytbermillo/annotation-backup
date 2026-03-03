import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { normalizeForStorage, computeQueryFingerprint, sha256Hex } from '@/lib/chat/routing-log/normalization'
import { canonicalJsonSerialize, stripVolatileFields } from '@/lib/chat/routing-log/context-snapshot'
import { redactQueryText } from '@/lib/chat/routing-log/redaction'
import {
  OPTION_A_TENANT_ID,
  OPTION_A_USER_ID,
  EMBEDDING_MODEL_VERSION_NONE,
  MEMORY_SCHEMA_VERSION,
  MEMORY_TOOL_VERSION,
  MEMORY_DEFAULT_TTL_DAYS,
} from '@/lib/chat/routing-log/types'
import type { MemoryWritePayload } from '@/lib/chat/routing-log/memory-write-payload'

const UPSERT_SQL = `
  INSERT INTO chat_routing_memory_index (
    tenant_id, user_id, scope_source, intent_class,
    query_fingerprint, normalized_query_text,
    semantic_embedding, embedding_model_version,
    context_fingerprint,
    intent_id, slots_json, target_ids,
    schema_version, tool_version, permission_signature,
    risk_tier, success_count, last_success_at, ttl_expires_at
  ) VALUES (
    $1, $2, $3, $4,
    $5, $6,
    NULL, $7,
    $8,
    $9, $10, $11,
    $12, $13, $14,
    $15, 1, now(), now() + interval '${MEMORY_DEFAULT_TTL_DAYS} days'
  )
  ON CONFLICT (tenant_id, user_id, query_fingerprint, context_fingerprint, schema_version, tool_version)
    WHERE is_deleted = false
  DO UPDATE SET
    success_count = chat_routing_memory_index.success_count + 1,
    last_success_at = now(),
    ttl_expires_at = now() + interval '${MEMORY_DEFAULT_TTL_DAYS} days',
    updated_at = now()
`

/**
 * POST /api/chat/routing-memory
 *
 * Phase 2a: receives MemoryWritePayload from client,
 * normalizes, fingerprints, redacts, and UPSERTs into chat_routing_memory_index.
 *
 * Gate 4: Server-authoritative kill switch (CHAT_ROUTING_MEMORY_KILL)
 * Gate 7: Server-authoritative enable flag (CHAT_ROUTING_MEMORY_WRITE_ENABLED)
 * Fail-open: returns 200 even on DB errors to avoid client-side noise.
 */
export async function POST(request: NextRequest) {
  // Gate 4: Emergency kill switch — kills both read and write paths server-side
  if (process.env.CHAT_ROUTING_MEMORY_KILL === 'true') {
    return NextResponse.json({ status: 'killed' }, { status: 200 })
  }

  // Gate 7: Server-authoritative enable flag (runtime, not build-time)
  if (process.env.CHAT_ROUTING_MEMORY_WRITE_ENABLED !== 'true') {
    return NextResponse.json({ status: 'disabled' }, { status: 200 })
  }

  try {
    const payload: MemoryWritePayload = await request.json()

    // Normalize and hash on server side (crypto available here)
    const normalizedText = normalizeForStorage(payload.raw_query_text)
    const queryFingerprint = computeQueryFingerprint(normalizedText)
    const redactedText = redactQueryText(normalizedText)

    const contextFingerprint = sha256Hex(canonicalJsonSerialize(stripVolatileFields(payload.context_snapshot)))

    await serverPool.query(UPSERT_SQL, [
      OPTION_A_TENANT_ID, OPTION_A_USER_ID, 'routing_dispatcher', payload.intent_class,
      queryFingerprint, redactedText,
      EMBEDDING_MODEL_VERSION_NONE,
      contextFingerprint,
      payload.intent_id, JSON.stringify(payload.slots_json), JSON.stringify(payload.target_ids),
      payload.schema_version, payload.tool_version, 'default',
      payload.risk_tier,
    ])

    return NextResponse.json({ status: 'ok' }, { status: 200 })
  } catch (err: unknown) {
    // Fail-open: log warning, return 200 to avoid polluting client error handling
    console.warn('[routing-memory] server upsert failed (non-fatal):', (err as Error).message)
    return NextResponse.json({ status: 'error', message: 'non-fatal' }, { status: 200 })
  }
}
