import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { normalizeForStorage, computeQueryFingerprint, sha256Hex } from '@/lib/chat/routing-log/normalization'
import { canonicalJsonSerialize, stripVolatileFields } from '@/lib/chat/routing-log/context-snapshot'
import { redactQueryText } from '@/lib/chat/routing-log/redaction'
import {
  OPTION_A_TENANT_ID,
  OPTION_A_USER_ID,
  MEMORY_SCHEMA_VERSION,
  MEMORY_TOOL_VERSION,
  MEMORY_DEFAULT_TTL_DAYS,
} from '@/lib/chat/routing-log/types'
import type { MemoryWritePayload } from '@/lib/chat/routing-log/memory-write-payload'
import { computeEmbedding, EMBEDDING_MODEL_VERSION } from '@/lib/chat/routing-log/embedding-service'

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
    $7, $8,
    $9,
    $10, $11, $12,
    $13, $14, $15,
    $16, 1, now(), now() + interval '${MEMORY_DEFAULT_TTL_DAYS} days'
  )
  ON CONFLICT (tenant_id, user_id, query_fingerprint, context_fingerprint, schema_version, tool_version)
    WHERE is_deleted = false
  DO UPDATE SET
    success_count = chat_routing_memory_index.success_count + 1,
    last_success_at = now(),
    ttl_expires_at = now() + interval '${MEMORY_DEFAULT_TTL_DAYS} days',
    semantic_embedding = COALESCE(EXCLUDED.semantic_embedding, chat_routing_memory_index.semantic_embedding),
    embedding_model_version = CASE
      WHEN EXCLUDED.semantic_embedding IS NOT NULL THEN EXCLUDED.embedding_model_version
      ELSE chat_routing_memory_index.embedding_model_version
    END,
    updated_at = now()
  RETURNING id
`

/**
 * Slice 3a: Increment success_count on the semantically matched winner row.
 * Only fires when the UPSERT wrote to a DIFFERENT row than the winner.
 * Scoped to same tenant/user to prevent cross-scope increment.
 *
 * After Slice 3a, success_count means "row strength as a semantic source"
 * (both direct executions AND semantic replays from other phrasings),
 * not just "exact row executions."
 */
const WINNER_INCREMENT_SQL = `
  UPDATE chat_routing_memory_index
  SET success_count = success_count + 1,
      last_success_at = now(),
      updated_at = now()
  WHERE id = $1
    AND tenant_id = $2
    AND user_id = $3
    AND is_deleted = false
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

    // Phase 3: compute embedding for semantic search (fail-open — null on failure)
    const embedding = await computeEmbedding(normalizedText, queryFingerprint)
    // pgvector expects the vector as a string like '[0.1,0.2,...]' or null
    const embeddingParam = embedding ? `[${embedding.join(',')}]` : null
    const embeddingModelVersion = embedding ? EMBEDDING_MODEL_VERSION : 'none'

    const upsertParams = [
      OPTION_A_TENANT_ID, OPTION_A_USER_ID, 'routing_dispatcher', payload.intent_class,
      queryFingerprint, redactedText,
      embeddingParam, embeddingModelVersion,
      contextFingerprint,
      payload.intent_id, JSON.stringify(payload.slots_json), JSON.stringify(payload.target_ids),
      payload.schema_version, payload.tool_version, 'default',
      payload.risk_tier,
    ]

    // Slice 3a: transactional replay-hit accounting
    // When replay_source_row_id is present (semantic replay), do UPSERT + conditional winner increment
    // in one transaction. Increment winner only if UPSERT wrote to a different row.
    const replaySourceRowId = payload.replay_source_row_id
    let winnerIncremented = false
    let winnerIncrementSkippedReason: 'same_row' | 'source_missing' | undefined

    if (replaySourceRowId) {
      const client = await serverPool.connect()
      try {
        await client.query('BEGIN')
        const upsertResult = await client.query(UPSERT_SQL, upsertParams)
        const writtenRowId = upsertResult.rows[0]?.id as string | undefined

        if (writtenRowId && writtenRowId !== replaySourceRowId) {
          await client.query(WINNER_INCREMENT_SQL, [
            replaySourceRowId,
            OPTION_A_TENANT_ID,
            OPTION_A_USER_ID,
          ])
          winnerIncremented = true
        } else {
          winnerIncrementSkippedReason = 'same_row'
        }
        await client.query('COMMIT')
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {})
        throw txErr
      } finally {
        client.release()
      }
    } else {
      await serverPool.query(UPSERT_SQL, upsertParams)
      winnerIncrementSkippedReason = replaySourceRowId === undefined ? 'source_missing' : undefined
    }

    return NextResponse.json({
      status: 'ok',
      winner_incremented: winnerIncremented,
      winner_increment_skipped_reason: winnerIncrementSkippedReason,
    }, { status: 200 })
  } catch (err: unknown) {
    // Fail-open: log warning, return 200 to avoid polluting client error handling
    console.warn('[routing-memory] server upsert failed (non-fatal):', (err as Error).message)
    return NextResponse.json({ status: 'error', message: 'non-fatal' }, { status: 200 })
  }
}
