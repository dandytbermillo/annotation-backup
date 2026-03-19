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
// Navigation lowered from 0.92 to 0.85 — measured data shows wrapper variants
// score 0.85-0.90 against seeded exemplars (e.g., "pls take me home" = 0.90)
const NAVIGATION_SIMILARITY_FLOOR = 0.85
const HISTORY_INFO_SIMILARITY_FLOOR = 0.80

// Clarified-exemplar down-rank factor
const CLARIFIED_EXEMPLAR_PENALTY = 0.85

// Near-tie threshold for merge — if top-2 candidates are within this gap, clarify
const NEAR_TIE_THRESHOLD = 0.03

// ---------------------------------------------------------------------------
// Phase 5 addendum: retrieval-only normalization
// ---------------------------------------------------------------------------

/**
 * Strip harmless conversational wrappers for Phase 5 hint retrieval.
 * Mirrors detectLocalSemanticIntent (input-classifiers.ts:1129-1130).
 * Anchored prefix/suffix only — never strips internal words.
 */
function normalizeForRetrieval(text: string): string {
  let cleaned = text.trim().toLowerCase()
  // Leading wrappers (anchored prefix only)
  cleaned = cleaned.replace(/^(?:hey|hi|hello|assistant|please|pls|ok|okay|um|uh)\b[,]?\s*/i, '')
  // Trailing fillers (anchored suffix only)
  // "now pls" / "now please" are removable bundles; bare "now" is NOT removable
  cleaned = cleaned.replace(/[,]?\s*(?:thank you|thanks|thx|now\s+(?:pls|please)|pls|please)\s*[.!?]*$/i, '')
  // Punctuation cleanup — collapse repeated punctuation, preserve type (don't convert ! to ?)
  cleaned = cleaned.replace(/([?])[?]+$/g, '$1').replace(/([!])[!]+$/g, '$1').replace(/\s+/g, ' ').trim()
  return cleaned
}

// ---------------------------------------------------------------------------
// Phase 5 addendum: exact-hit shortcut SQL
// ---------------------------------------------------------------------------

/**
 * Exact-hit: learned rows (history_info — no context fingerprint filter)
 */
const PHASE5_EXACT_HIT_LEARNED_HISTORY_SQL = `
  SELECT id AS matched_row_id,
         intent_id, intent_class, slots_json, target_ids, risk_tier,
         success_count, context_fingerprint, scope_source
  FROM chat_routing_memory_index
  WHERE tenant_id = $1 AND user_id = $2
    AND query_fingerprint = $3
    AND intent_class = $4
    AND schema_version = $5 AND tool_version = $6
    AND risk_tier IN ('low', 'medium')
    AND is_deleted = false
    AND (ttl_expires_at IS NULL OR ttl_expires_at > now())
  LIMIT 3
`

/**
 * Exact-hit: learned rows (navigation — strict context fingerprint)
 */
const PHASE5_EXACT_HIT_LEARNED_NAVIGATION_SQL = `
  SELECT id AS matched_row_id,
         intent_id, intent_class, slots_json, target_ids, risk_tier,
         success_count, context_fingerprint, scope_source
  FROM chat_routing_memory_index
  WHERE tenant_id = $1 AND user_id = $2
    AND query_fingerprint = $3
    AND intent_class = $4
    AND context_fingerprint = $7
    AND schema_version = $5 AND tool_version = $6
    AND risk_tier IN ('low', 'medium')
    AND is_deleted = false
    AND (ttl_expires_at IS NULL OR ttl_expires_at > now())
  LIMIT 3
`

/**
 * Exact-hit: curated seeds (no context fingerprint — hint-only)
 */
const PHASE5_EXACT_HIT_SEED_SQL = `
  SELECT id AS matched_row_id,
         intent_id, intent_class, slots_json, target_ids, risk_tier,
         success_count, context_fingerprint, scope_source
  FROM chat_routing_memory_index
  WHERE tenant_id = $1 AND user_id = $2
    AND query_fingerprint = $3
    AND scope_source = 'curated_seed'
    AND intent_class = $4
    AND schema_version = $5 AND tool_version = $6
    AND risk_tier IN ('low', 'medium')
    AND is_deleted = false
    AND (ttl_expires_at IS NULL OR ttl_expires_at > now())
  LIMIT 3
`

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

    // Normalize query text and compute fingerprint
    const normalizedText = normalizeForStorage(payload.raw_query_text)

    // Compute current context fingerprint
    const currentContextFingerprint = sha256Hex(
      canonicalJsonSerialize(stripVolatileFields(payload.context_snapshot))
    )

    // Phase 5 addendum: retrieval normalization + exact-hit shortcut
    // Only for Phase 5 hint lookups with intent_scope
    if (payload.intent_scope) {
      const retrievalText = normalizeForRetrieval(normalizedText)
      const retrievalFingerprint = computeQueryFingerprint(retrievalText)
      const retrievalNormalizationApplied = retrievalText !== normalizedText
      const intentClass = payload.intent_scope === 'history_info' ? 'info_intent' : 'action_intent'
      const maxCandidates = payload.max_candidates ?? 3

      // ── Exact-hit shortcut: check learned rows first, then curated seeds ──
      const exactHitSql = payload.intent_scope === 'navigation'
        ? PHASE5_EXACT_HIT_LEARNED_NAVIGATION_SQL
        : PHASE5_EXACT_HIT_LEARNED_HISTORY_SQL
      const exactHitParams = payload.intent_scope === 'navigation'
        ? [OPTION_A_TENANT_ID, OPTION_A_USER_ID, retrievalFingerprint, intentClass, MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION, currentContextFingerprint]
        : [OPTION_A_TENANT_ID, OPTION_A_USER_ID, retrievalFingerprint, intentClass, MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION]

      const { rows: learnedExactRows } = await serverPool.query(exactHitSql, exactHitParams)

      // Learned wins over curated — only check seeds if no learned exact hit
      let exactRows = learnedExactRows
      let exactSource: 'learned' | 'curated_seed' = 'learned'
      if (exactRows.length === 0) {
        const { rows: seedExactRows } = await serverPool.query(PHASE5_EXACT_HIT_SEED_SQL, [
          OPTION_A_TENANT_ID, ROUTING_MEMORY_CURATED_SEED_USER_ID,
          retrievalFingerprint, intentClass,
          MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
        ])
        exactRows = seedExactRows
        exactSource = 'curated_seed'
      }

      if (exactRows.length > 0) {
        // Exact hit found — return immediately, skip embedding
        const candidates = exactRows.map((row: Record<string, unknown>) => {
          let score = 1.0
          const slotsJson = row.slots_json as Record<string, unknown>
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
            from_curated_seed: exactSource === 'curated_seed',
          }
        }).slice(0, maxCandidates)

        return NextResponse.json({
          candidates,
          lookup_status: 'ok',
          current_context_fingerprint: currentContextFingerprint,
          raw_query_text: payload.raw_query_text,
          retrieval_query_text: retrievalText,
          retrieval_normalization_applied: retrievalNormalizationApplied,
          phase5_exact_hit_used: true,
          phase5_exact_hit_source: exactSource,
        }, { status: 200 })
      }

      // No exact hit — multi-pass embedding retrieval

      const similarityFloor = payload.intent_scope === 'navigation'
        ? NAVIGATION_SIMILARITY_FLOOR
        : HISTORY_INFO_SIMILARITY_FLOOR

      const mapRow = (row: Record<string, unknown>, fromSeed: boolean) => {
        let score = Number(row.similarity_score)
        const slotsJson = row.slots_json as Record<string, unknown>
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

      const learnedSql = payload.intent_scope === 'navigation'
        ? PHASE5_LEARNED_NAVIGATION_SQL
        : PHASE5_LEARNED_HISTORY_SQL

      // ── Pass 1: raw-query embedding ──
      let rawPassUsed = false
      let rawPassCandidates: ReturnType<typeof mapRow>[] = []
      const rawFingerprint = computeQueryFingerprint(normalizedText)
      const rawEmbedding = await computeEmbedding(normalizedText, rawFingerprint)
      if (rawEmbedding) {
        rawPassUsed = true
        const rawEmbeddingParam = `[${rawEmbedding.join(',')}]`
        const rawLearnedParams = payload.intent_scope === 'navigation'
          ? [OPTION_A_TENANT_ID, OPTION_A_USER_ID, intentClass, rawEmbeddingParam, maxCandidates, MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION, currentContextFingerprint]
          : [OPTION_A_TENANT_ID, OPTION_A_USER_ID, intentClass, rawEmbeddingParam, maxCandidates, MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION]
        const { rows: rawLearned } = await serverPool.query(learnedSql, rawLearnedParams)
        const { rows: rawSeeds } = await serverPool.query(PHASE5_SEED_LOOKUP_SQL, [
          OPTION_A_TENANT_ID, ROUTING_MEMORY_CURATED_SEED_USER_ID,
          intentClass, rawEmbeddingParam, maxCandidates,
          MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
        ])
        rawPassCandidates = [
          ...rawLearned.map((r: Record<string, unknown>) => mapRow(r, false)),
          ...rawSeeds.map((r: Record<string, unknown>) => mapRow(r, true)),
        ]
      }

      // ── Pass 2: normalized-query embedding (only when normalization changed the text) ──
      let normalizedPassUsed = false
      let normPassCandidates: ReturnType<typeof mapRow>[] = []
      if (retrievalNormalizationApplied) {
        const normEmbedding = await computeEmbedding(retrievalText, retrievalFingerprint)
        if (normEmbedding) {
          normalizedPassUsed = true
          const normEmbeddingParam = `[${normEmbedding.join(',')}]`
          const normLearnedParams = payload.intent_scope === 'navigation'
            ? [OPTION_A_TENANT_ID, OPTION_A_USER_ID, intentClass, normEmbeddingParam, maxCandidates, MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION, currentContextFingerprint]
            : [OPTION_A_TENANT_ID, OPTION_A_USER_ID, intentClass, normEmbeddingParam, maxCandidates, MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION]
          const { rows: normLearned } = await serverPool.query(learnedSql, normLearnedParams)
          const { rows: normSeeds } = await serverPool.query(PHASE5_SEED_LOOKUP_SQL, [
            OPTION_A_TENANT_ID, ROUTING_MEMORY_CURATED_SEED_USER_ID,
            intentClass, normEmbeddingParam, maxCandidates,
            MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
          ])
          normPassCandidates = [
            ...normLearned.map((r: Record<string, unknown>) => mapRow(r, false)),
            ...normSeeds.map((r: Record<string, unknown>) => mapRow(r, true)),
          ]
        }
      }

      // ── Merge + dedupe + rerank ──
      const allRaw = [...rawPassCandidates, ...normPassCandidates]
      const deduped = new Map<string, ReturnType<typeof mapRow>>()
      for (const c of allRaw) {
        // Dedupe key: matched_row_id for learned, (intent_id, target_ids, scope_source) for curated
        const key = c.from_curated_seed
          ? `curated:${c.intent_id}:${JSON.stringify(c.target_ids)}`
          : c.matched_row_id
        const existing = deduped.get(key)
        if (!existing || c.similarity_score > existing.similarity_score) {
          deduped.set(key, c)
        }
      }

      const merged = Array.from(deduped.values())
        .filter(c => c.similarity_score >= similarityFloor)
        .sort((a, b) => b.similarity_score - a.similarity_score)
        .slice(0, maxCandidates)

      // Near-tie detection
      let phase5NearTie = false
      if (merged.length >= 2) {
        const gap = merged[0].similarity_score - merged[1].similarity_score
        if (gap < NEAR_TIE_THRESHOLD) {
          phase5NearTie = true
        }
      }

      // Fail-open: if both passes failed to embed, return embedding_failure
      if (!rawPassUsed && !normalizedPassUsed) {
        return NextResponse.json({
          candidates: [], lookup_status: 'embedding_failure',
          retrieval_normalization_applied: retrievalNormalizationApplied,
        }, { status: 200 })
      }

      return NextResponse.json({
        candidates: merged,
        lookup_status: merged.length > 0 ? 'ok' : 'empty_results',
        current_context_fingerprint: currentContextFingerprint,
        raw_query_text: payload.raw_query_text,
        retrieval_query_text: retrievalText,
        retrieval_normalization_applied: retrievalNormalizationApplied,
        phase5_exact_hit_used: false,
        raw_pass_used: rawPassUsed,
        normalized_pass_used: normalizedPassUsed,
        phase5_near_tie: phase5NearTie,
      }, { status: 200 })
    }

    // ── Legacy path: no intent_scope ──
    // No retrieval normalization, no exact-hit shortcut
    const queryFingerprint = computeQueryFingerprint(normalizedText)
    const queryEmbedding = await computeEmbedding(normalizedText, queryFingerprint)
    if (!queryEmbedding) {
      return NextResponse.json({ candidates: [], lookup_status: 'embedding_failure' }, { status: 200 })
    }
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
