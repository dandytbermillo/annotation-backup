import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { normalizeForStorage, computeQueryFingerprint, sha256Hex } from '@/lib/chat/routing-log/normalization'
import {
  OPTION_A_TENANT_ID,
  OPTION_A_USER_ID,
  MEMORY_SCHEMA_VERSION,
  MEMORY_TOOL_VERSION,
  ROUTING_MEMORY_CURATED_SEED_USER_ID,
} from '@/lib/chat/routing-log/types'
import { computeEmbedding } from '@/lib/chat/routing-log/embedding-service'
import { canonicalJsonSerialize, stripVolatileFields } from '@/lib/chat/routing-log/context-snapshot'
import type { ContextSnapshotV1 } from '@/lib/chat/routing-log/context-snapshot'

/**
 * Legacy Stage 5/B2 semantic similarity search SQL.
 * Unchanged from Phase 3 — action_intent only, 0.92 cosine floor.
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
 * Phase 5: learned exemplar lookup for history_info scope.
 * No context_fingerprint filter — history intents resolve from committed session state,
 * so the live UI may have changed since the original successful query.
 * No cosine floor in SQL — threshold applied in application code.
 */
const PHASE5_LEARNED_HISTORY_SQL = `
  SELECT id AS matched_row_id,
         intent_id, intent_class, slots_json, target_ids, risk_tier,
         success_count, context_fingerprint, scope_source,
         1 - (semantic_embedding <=> $4) AS similarity_score
  FROM chat_routing_memory_index
  WHERE tenant_id = $1 AND user_id = $2
    AND intent_class = $3
    AND schema_version = $6 AND tool_version = $7
    AND risk_tier IN ('low', 'medium')
    AND is_deleted = false
    AND semantic_embedding IS NOT NULL
    AND (ttl_expires_at IS NULL OR ttl_expires_at > now())
  ORDER BY semantic_embedding <=> $4
  LIMIT $5
`

/**
 * Phase 5: learned exemplar lookup for navigation scope.
 * Strict context_fingerprint filter ($8) — navigation hints must match current context.
 */
const PHASE5_LEARNED_NAVIGATION_SQL = `
  SELECT id AS matched_row_id,
         intent_id, intent_class, slots_json, target_ids, risk_tier,
         success_count, context_fingerprint, scope_source,
         1 - (semantic_embedding <=> $4) AS similarity_score
  FROM chat_routing_memory_index
  WHERE tenant_id = $1 AND user_id = $2
    AND intent_class = $3
    AND context_fingerprint = $8
    AND schema_version = $6 AND tool_version = $7
    AND risk_tier IN ('low', 'medium')
    AND is_deleted = false
    AND semantic_embedding IS NOT NULL
    AND (ttl_expires_at IS NULL OR ttl_expires_at > now())
  ORDER BY semantic_embedding <=> $4
  LIMIT $5
`

/**
 * Phase 5: curated seed lookup via sentinel user_id.
 * Same filters but queries the curated-seed partition.
 */
const PHASE5_SEED_LOOKUP_SQL = `
  SELECT id AS matched_row_id,
         intent_id, intent_class, slots_json, target_ids, risk_tier,
         success_count, context_fingerprint, scope_source,
         1 - (semantic_embedding <=> $4) AS similarity_score
  FROM chat_routing_memory_index
  WHERE tenant_id = $1 AND user_id = $2
    AND scope_source = 'curated_seed'
    AND intent_class = $3
    AND schema_version = $6 AND tool_version = $7
    AND risk_tier IN ('low', 'medium')
    AND is_deleted = false
    AND semantic_embedding IS NOT NULL
    AND (ttl_expires_at IS NULL OR ttl_expires_at > now())
  ORDER BY semantic_embedding <=> $4
  LIMIT $5
`

// Scope-dependent similarity thresholds (applied in application code)
const NAVIGATION_SIMILARITY_FLOOR = 0.92
const HISTORY_INFO_SIMILARITY_FLOOR = 0.80

// Clarified-exemplar down-rank factor
const CLARIFIED_EXEMPLAR_PENALTY = 0.85

/**
 * POST /api/chat/routing-memory/semantic-lookup
 *
 * Shared route for:
 * - Legacy Stage 5/B2 semantic replay (no intent_scope)
 * - Phase 5 hint retrieval (with intent_scope)
 *
 * Flag branching:
 * - No intent_scope → governed by CHAT_ROUTING_MEMORY_SEMANTIC_READ_ENABLED
 * - With intent_scope → governed by CHAT_ROUTING_MEMORY_HINT_READ_ENABLED
 *
 * Fail-open: returns { candidates: [] } on any error.
 */
export async function POST(request: NextRequest) {
  // Kill switch — kills all memory paths
  if (process.env.CHAT_ROUTING_MEMORY_KILL === 'true') {
    return NextResponse.json({ candidates: [], lookup_status: 'disabled' }, { status: 200 })
  }

  try {
    // Parse request body BEFORE flag branching
    const payload: {
      raw_query_text: string
      context_snapshot: ContextSnapshotV1
      intent_scope?: 'history_info' | 'navigation'
      max_candidates?: number
    } = await request.json()

    // Flag branching based on intent_scope
    if (payload.intent_scope) {
      // Phase 5 hint path — governed by Phase 5 flag only
      if (process.env.CHAT_ROUTING_MEMORY_HINT_READ_ENABLED !== 'true') {
        return NextResponse.json({ candidates: [], lookup_status: 'disabled' }, { status: 200 })
      }
    } else {
      // Legacy Stage 5/B2 path — governed by existing flag
      if (process.env.CHAT_ROUTING_MEMORY_SEMANTIC_READ_ENABLED !== 'true') {
        return NextResponse.json({ candidates: [], lookup_status: 'disabled' }, { status: 200 })
      }
    }

    // Normalize query text and compute fingerprint (for embedding cache key)
    const normalizedText = normalizeForStorage(payload.raw_query_text)
    const queryFingerprint = computeQueryFingerprint(normalizedText)

    // Compute query embedding (fail-open — null on failure)
    const queryEmbedding = await computeEmbedding(normalizedText, queryFingerprint)
    if (!queryEmbedding) {
      return NextResponse.json({ candidates: [], lookup_status: 'embedding_failure' }, { status: 200 })
    }

    const embeddingParam = `[${queryEmbedding.join(',')}]`

    // Compute current context fingerprint
    const currentContextFingerprint = sha256Hex(
      canonicalJsonSerialize(stripVolatileFields(payload.context_snapshot))
    )

    // ── Legacy path: no intent_scope ──
    if (!payload.intent_scope) {
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

      return NextResponse.json({
        candidates,
        lookup_status: candidates.length > 0 ? 'ok' : 'empty_results',
        current_context_fingerprint: currentContextFingerprint,
      }, { status: 200 })
    }

    // ── Phase 5 hint path: with intent_scope ──

    const intentClass = payload.intent_scope === 'history_info' ? 'info_intent' : 'action_intent'
    const maxCandidates = payload.max_candidates ?? 3
    const similarityFloor = payload.intent_scope === 'navigation'
      ? NAVIGATION_SIMILARITY_FLOOR
      : HISTORY_INFO_SIMILARITY_FLOOR

    // Query 1: learned exemplars (current user)
    // Navigation: strict context_fingerprint filter. History_info: no fingerprint filter.
    const learnedSql = payload.intent_scope === 'navigation'
      ? PHASE5_LEARNED_NAVIGATION_SQL
      : PHASE5_LEARNED_HISTORY_SQL
    const learnedParams = payload.intent_scope === 'navigation'
      ? [OPTION_A_TENANT_ID, OPTION_A_USER_ID, intentClass, embeddingParam, maxCandidates, MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION, currentContextFingerprint]
      : [OPTION_A_TENANT_ID, OPTION_A_USER_ID, intentClass, embeddingParam, maxCandidates, MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION]
    const { rows: learnedRows } = await serverPool.query(learnedSql, learnedParams)

    // Query 2: curated seeds (sentinel user_id)
    const { rows: seedRows } = await serverPool.query(PHASE5_SEED_LOOKUP_SQL, [
      OPTION_A_TENANT_ID,
      ROUTING_MEMORY_CURATED_SEED_USER_ID,
      intentClass,
      embeddingParam,
      maxCandidates,
      MEMORY_SCHEMA_VERSION,
      MEMORY_TOOL_VERSION,
    ])

    // Map rows to candidates
    const mapRow = (row: Record<string, unknown>, fromSeed: boolean) => {
      let score = Number(row.similarity_score)
      const slotsJson = row.slots_json as Record<string, unknown>

      // Clarified-exemplar down-ranking
      if (slotsJson?.resolution_required_clarification === true) {
        score *= CLARIFIED_EXEMPLAR_PENALTY
      }

      return {
        matched_row_id: row.matched_row_id as string,
        intent_id: row.intent_id as string,
        intent_class: row.intent_class as string,
        slots_json: slotsJson,
        target_ids: row.target_ids as string[],
        risk_tier: row.risk_tier as string,
        success_count: row.success_count as number,
        context_fingerprint: row.context_fingerprint as string,
        similarity_score: score,
        from_curated_seed: fromSeed,
      }
    }

    // Merge: learned first, then seeds. Apply similarity floor.
    const allCandidates = [
      ...learnedRows.map((r: Record<string, unknown>) => mapRow(r, false)),
      ...seedRows.map((r: Record<string, unknown>) => mapRow(r, true)),
    ]
      .filter(c => c.similarity_score >= similarityFloor)
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, maxCandidates)

    return NextResponse.json({
      candidates: allCandidates,
      lookup_status: allCandidates.length > 0 ? 'ok' : 'empty_results',
      current_context_fingerprint: currentContextFingerprint,
    }, { status: 200 })
  } catch (err: unknown) {
    // Fail-open: return empty candidates on DB/embedding errors
    console.warn('[routing-memory] semantic lookup failed (non-fatal):', (err as Error).message)
    return NextResponse.json({ candidates: [], lookup_status: 'server_error' }, { status: 200 })
  }
}
