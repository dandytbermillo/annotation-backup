import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { normalizeForStorage, computeQueryFingerprint, sha256Hex } from '@/lib/chat/routing-log/normalization'
import {
  OPTION_A_TENANT_ID,
  OPTION_A_USER_ID,
  MEMORY_SCHEMA_VERSION,
  MEMORY_TOOL_VERSION,
} from '@/lib/chat/routing-log/types'
import { computeEmbedding } from '@/lib/chat/routing-log/embedding-service'
import { canonicalJsonSerialize, stripVolatileFields } from '@/lib/chat/routing-log/context-snapshot'
import type { ContextSnapshotV1 } from '@/lib/chat/routing-log/context-snapshot'

/**
 * Semantic similarity search SQL with strict safety filters.
 *
 * Safety filters:
 * 1. intent_class = 'action_intent' — only action intents for B2
 * 2. risk_tier IN ('low','medium') — reject high-risk at DB level
 * 3. schema_version + tool_version — compatibility guard
 * 4. is_deleted = false — honor soft deletes
 * 5. ttl_expires_at guard — TTL enforcement
 * 6. semantic_embedding IS NOT NULL — only entries with embeddings
 * 7. Cosine similarity >= 0.92 — floor threshold
 */
const SEMANTIC_LOOKUP_SQL = `
  SELECT id AS matched_row_id,
         intent_id, intent_class, slots_json, target_ids, risk_tier,
         success_count, context_fingerprint,
         1 - (semantic_embedding <=> $3) AS similarity_score
  FROM chat_routing_memory_index
  WHERE tenant_id = $1 AND user_id = $2
    AND schema_version = $4 AND tool_version = $5
    AND intent_class = 'action_intent'
    AND risk_tier IN ('low', 'medium')
    AND is_deleted = false
    AND semantic_embedding IS NOT NULL
    AND (ttl_expires_at IS NULL OR ttl_expires_at > now())
    AND 1 - (semantic_embedding <=> $3) >= 0.92
  ORDER BY semantic_embedding <=> $3
  LIMIT 5
`

/**
 * POST /api/chat/routing-memory/semantic-lookup
 *
 * Phase 3: semantic memory lookup via vector similarity search.
 * Returns top-5 candidates above 0.92 cosine similarity floor.
 *
 * Gate: CHAT_ROUTING_MEMORY_KILL (kills all memory paths)
 * Gate: CHAT_ROUTING_MEMORY_SEMANTIC_READ_ENABLED (server-authoritative)
 * Fail-open: returns { candidates: [] } on any error.
 */
export async function POST(request: NextRequest) {
  // Kill switch — kills all memory (B1 + B2 + writes)
  if (process.env.CHAT_ROUTING_MEMORY_KILL === 'true') {
    return NextResponse.json({ candidates: [], lookup_status: 'disabled' }, { status: 200 })
  }

  // Server-authoritative enable flag for B2 semantic read
  if (process.env.CHAT_ROUTING_MEMORY_SEMANTIC_READ_ENABLED !== 'true') {
    return NextResponse.json({ candidates: [], lookup_status: 'disabled' }, { status: 200 })
  }

  try {
    const payload: { raw_query_text: string; context_snapshot: ContextSnapshotV1 } =
      await request.json()

    // Normalize query text and compute fingerprint (for embedding cache key)
    const normalizedText = normalizeForStorage(payload.raw_query_text)
    const queryFingerprint = computeQueryFingerprint(normalizedText)

    // Compute query embedding (fail-open — null on failure)
    const queryEmbedding = await computeEmbedding(normalizedText, queryFingerprint)
    if (!queryEmbedding) {
      // Cannot search without an embedding — fail-open
      return NextResponse.json({ candidates: [], lookup_status: 'embedding_failure' }, { status: 200 })
    }

    // pgvector expects vector as string like '[0.1,0.2,...]'
    const embeddingParam = `[${queryEmbedding.join(',')}]`

    const { rows } = await serverPool.query(SEMANTIC_LOOKUP_SQL, [
      OPTION_A_TENANT_ID,
      OPTION_A_USER_ID,
      embeddingParam,
      MEMORY_SCHEMA_VERSION,
      MEMORY_TOOL_VERSION,
    ])

    const candidates = rows.map((row: Record<string, unknown>) => ({
      matched_row_id: row.matched_row_id as string,
      intent_id: row.intent_id as string,
      intent_class: row.intent_class as string,
      slots_json: row.slots_json as Record<string, unknown>,
      target_ids: row.target_ids as string[],
      risk_tier: row.risk_tier as string,
      success_count: row.success_count as number,
      context_fingerprint: row.context_fingerprint as string,
      similarity_score: Number(row.similarity_score),
    }))

    // Compute current context fingerprint using same formula as memory write route.
    // Stage 5 evaluator uses this to compare against each candidate's stored fingerprint.
    const currentContextFingerprint = sha256Hex(
      canonicalJsonSerialize(stripVolatileFields(payload.context_snapshot))
    )

    return NextResponse.json({
      candidates,
      lookup_status: candidates.length > 0 ? 'ok' : 'empty_results',
      current_context_fingerprint: currentContextFingerprint,
    }, { status: 200 })
  } catch (err: unknown) {
    // Fail-open: return empty candidates on DB/embedding errors
    console.warn('[routing-memory] semantic lookup failed (non-fatal):', (err as Error).message)
    return NextResponse.json({ candidates: [], lookup_status: 'server_error' }, { status: 200 })
  }
}
