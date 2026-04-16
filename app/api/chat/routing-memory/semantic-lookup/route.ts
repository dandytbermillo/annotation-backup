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
import { canonicalJsonSerialize, stripVolatileFields, stripVolatileFieldsForNavigation } from '@/lib/chat/routing-log/context-snapshot'
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
      intent_scope?: 'history_info' | 'navigation' | 'state_info'
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

    // Compute BOTH context fingerprints up front so cross-class retrieval can use
    // the correct one per-candidate:
    // - navContextFingerprint (strict: version + latch_enabled only) for action_intent / navigation SQLs
    // - broadContextFingerprint for info_intent and legacy paths
    // See "Semantic-First Unification — Change 1" in plan.
    const navContextFingerprint = sha256Hex(
      canonicalJsonSerialize(stripVolatileFieldsForNavigation(payload.context_snapshot))
    )
    const broadContextFingerprint = sha256Hex(
      canonicalJsonSerialize(stripVolatileFields(payload.context_snapshot))
    )
    // Backward-compatible single value used by legacy non-scoped callers below.
    const isNavigationScope = payload.intent_scope === 'navigation'
    const currentContextFingerprint = isNavigationScope ? navContextFingerprint : broadContextFingerprint

    // Phase 5 addendum: retrieval normalization + exact-hit shortcut
    // Only for Phase 5 hint lookups with intent_scope
    if (payload.intent_scope) {
      const retrievalText = normalizeForRetrieval(normalizedText)
      const retrievalFingerprint = computeQueryFingerprint(retrievalText)
      const retrievalNormalizationApplied = retrievalText !== normalizedText
      const maxCandidates = payload.max_candidates ?? 3

      // Semantic-First Unification — Change 1: cross-class retrieval.
      // 'navigation' and 'state_info' now run BOTH action_intent and info_intent
      // SQLs in parallel so the unified pool contains both navigation and
      // state-info candidates. 'history_info' stays info_intent-only to preserve
      // the legacy history path.
      const isCrossClassScope =
        payload.intent_scope === 'navigation' || payload.intent_scope === 'state_info'

      // Dispatch allowlist: only candidates with these action_types enter the
      // unified pool for navigation/state-info routing. Matches
      // S5_ACTION_ALLOWLIST in lib/chat/routing-log/stage5-evaluator.ts.
      // History-specific action types (last_action, verify_action) are excluded
      // from cross-class results because they belong to the history_info lane.
      const DISPATCH_ALLOWLIST = new Set([
        'execute_widget_item',
        'execute_referent',
        'surface_manifest_execute',
        'open_panel',
        'open_entry',
        'open_workspace',
        'go_home',
        'state_info',
      ])

      const mapRow = (row: Record<string, unknown>, fromSeed: boolean) => {
        let score = Number(row.similarity_score ?? 1.0)
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

      // Per-candidate dedupe identity. Mirrors lib/chat/routing-dispatcher.ts
      // `candidateIdentity`: navigation uses (intent_id, first target_id);
      // state_info uses (query_type, target_name, family_id, scope) because many
      // state_info seeds share intent_id='state_info' with empty target_ids
      // and would collapse under the legacy (intent_id, target_ids) key.
      //
      // State_info identity intentionally has NO learned/curated prefix:
      // a learned row and a curated seed row that share the same slot shape
      // represent the exact same logical state-info question and MUST dedupe.
      // Without this, maxCandidates truncation can drop a distinct candidate
      // in favor of a learned+curated duplicate pair. The dedupe loop below
      // keeps the higher score (or first-in on ties), which handles the merge
      // naturally.
      const routeCandidateIdentity = (c: ReturnType<typeof mapRow>): string => {
        const slots = c.slots_json as Record<string, unknown> | undefined
        const actionType = slots?.action_type as string | undefined
        if (actionType === 'state_info') {
          const queryType = (slots?.query_type as string | undefined) ?? 'unknown'
          // Phase 1.5 fix 1b: canonicalize target_name to lowercase so seeds
          // and live-derived synthetics collapse during retrieval-level dedupe.
          // Matches fix 1a in routing-dispatcher.ts candidateIdentity.
          const targetName = ((slots?.target_name as string | undefined) ?? 'generic').toLowerCase()
          const familyId = (slots?.family_id as string | undefined) ?? 'none'
          const scope = (slots?.scope as string | undefined) ?? 'none'
          return `state_info:${queryType}:${targetName}:${familyId}:${scope}`
        }
        // Learned rows: dedupe by matched_row_id so distinct row IDs stay distinct.
        // Curated seeds: dedupe by (intent_id, first target_id) so duplicate seeds
        // across the two classes of parallel queries collapse while still letting
        // distinct intents coexist.
        if (c.from_curated_seed) {
          return `curated:${c.intent_id}:${(c.target_ids && c.target_ids[0]) ?? 'none'}`
        }
        return c.matched_row_id
      }

      // Per-candidate similarity floor based on action_type (not per-scope).
      // state_info keeps low-threshold candidates in the bounded set (0.70) so
      // the bounded-LLM/clarifier can use them; navigation stays at 0.85.
      // Per-candidate allowlist filter: reject rows whose action_type is not
      // in DISPATCH_ALLOWLIST when running a cross-class scope.
      const perCandidateFloor = (actionType: string | undefined) =>
        actionType === 'state_info' ? 0.70 : NAVIGATION_SIMILARITY_FLOOR
      const passesPoolFilter = (c: ReturnType<typeof mapRow>) => {
        if (!isCrossClassScope) return true // legacy history_info path: no filter
        const actionType = (c.slots_json as any)?.action_type as string | undefined
        if (!actionType || !DISPATCH_ALLOWLIST.has(actionType)) return false
        return c.similarity_score >= perCandidateFloor(actionType)
      }

      // ── Exact-hit shortcut ──
      // Single unique exact hit short-circuits. Multiple exact hits merge and
      // go through the normal winner/clarifier ladder downstream. This prevents
      // a cross-class exact-hit pool from auto-executing an ambiguous candidate.
      let exactRowsUnified: ReturnType<typeof mapRow>[] = []

      if (isCrossClassScope) {
        // Run navigation exact-hit (action_intent, strict nav fingerprint) AND
        // history exact-hit (info_intent, no context filter) in parallel.
        const [navLearnedRes, infoLearnedRes, navSeedRes, infoSeedRes] = await Promise.all([
          serverPool.query(PHASE5_EXACT_HIT_LEARNED_NAVIGATION_SQL, [
            OPTION_A_TENANT_ID, OPTION_A_USER_ID, retrievalFingerprint,
            'action_intent', MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION, navContextFingerprint,
          ]),
          serverPool.query(PHASE5_EXACT_HIT_LEARNED_HISTORY_SQL, [
            OPTION_A_TENANT_ID, OPTION_A_USER_ID, retrievalFingerprint,
            'info_intent', MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
          ]),
          serverPool.query(PHASE5_EXACT_HIT_SEED_SQL, [
            OPTION_A_TENANT_ID, ROUTING_MEMORY_CURATED_SEED_USER_ID,
            retrievalFingerprint, 'action_intent',
            MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
          ]),
          serverPool.query(PHASE5_EXACT_HIT_SEED_SQL, [
            OPTION_A_TENANT_ID, ROUTING_MEMORY_CURATED_SEED_USER_ID,
            retrievalFingerprint, 'info_intent',
            MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
          ]),
        ])
        const learnedRows = [
          ...navLearnedRes.rows.map((r: Record<string, unknown>) => mapRow(r, false)),
          ...infoLearnedRes.rows.map((r: Record<string, unknown>) => mapRow(r, false)),
        ]
        const seedRows = [
          ...navSeedRes.rows.map((r: Record<string, unknown>) => mapRow(r, true)),
          ...infoSeedRes.rows.map((r: Record<string, unknown>) => mapRow(r, true)),
        ]
        // Learned wins over curated — only keep seeds if no learned exact rows
        // for this exact retrieval fingerprint.
        exactRowsUnified = learnedRows.length > 0 ? learnedRows : seedRows
      } else {
        // Legacy history_info path: single info_intent query.
        const exactHitSql = PHASE5_EXACT_HIT_LEARNED_HISTORY_SQL
        const intentClass = 'info_intent'
        const exactHitParams = [OPTION_A_TENANT_ID, OPTION_A_USER_ID, retrievalFingerprint, intentClass, MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION]
        const { rows: learnedExactRows } = await serverPool.query(exactHitSql, exactHitParams)
        if (learnedExactRows.length > 0) {
          exactRowsUnified = learnedExactRows.map((r: Record<string, unknown>) => mapRow(r, false))
        } else {
          const { rows: seedExactRows } = await serverPool.query(PHASE5_EXACT_HIT_SEED_SQL, [
            OPTION_A_TENANT_ID, ROUTING_MEMORY_CURATED_SEED_USER_ID,
            retrievalFingerprint, intentClass,
            MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
          ])
          exactRowsUnified = seedExactRows.map((r: Record<string, unknown>) => mapRow(r, true))
        }
      }

      // Filter exact-hit rows by the dispatch allowlist for cross-class scopes.
      const exactFiltered = exactRowsUnified.filter(passesPoolFilter)

      // Per-candidate dedupe via routeCandidateIdentity — state_info candidates
      // stay distinct by (query_type, target_name, family_id, scope) instead of
      // collapsing under the legacy (intent_id, target_ids) key.
      const exactDeduped = new Map<string, ReturnType<typeof mapRow>>()
      for (const c of exactFiltered) {
        const k = routeCandidateIdentity(c)
        const existing = exactDeduped.get(k)
        if (!existing || c.similarity_score > existing.similarity_score) {
          exactDeduped.set(k, c)
        }
      }
      const exactUniqueCount = exactDeduped.size
      const exactSource: 'learned' | 'curated_seed' =
        exactRowsUnified.length > 0 && exactRowsUnified[0].from_curated_seed ? 'curated_seed' : 'learned'

      // If exactly one unique exact hit → short-circuit.
      // Preserve the score already applied by mapRow (including
      // CLARIFIED_EXEMPLAR_PENALTY for rows with
      // resolution_required_clarification: true). For rows without that
      // penalty, mapRow returns similarity_score: 1.0 from the SQL SELECT
      // default, so the net effect on non-penalised rows is unchanged.
      if (exactUniqueCount === 1) {
        const winner = Array.from(exactDeduped.values())[0]
        return NextResponse.json({
          candidates: [winner].slice(0, maxCandidates),
          lookup_status: 'ok',
          current_context_fingerprint: currentContextFingerprint,
          raw_query_text: payload.raw_query_text,
          retrieval_query_text: retrievalText,
          retrieval_normalization_applied: retrievalNormalizationApplied,
          phase5_exact_hit_used: true,
          phase5_exact_hit_source: exactSource,
        }, { status: 200 })
      }

      // If 2+ unique exact hits → do NOT short-circuit. Fall through to
      // embedding phase so the caller gets the merged pool and runs the
      // normal winner/clarifier ladder on it. The embedding phase will see
      // the same rows via semantic match at score ~1.0 and include them in
      // `merged` below, honoring near-tie and threshold rules.
      // (exactUniqueCount === 0 also falls through to embedding phase.)

      // ── Embedding phase ──
      // Navigation SQL filters by strict context fingerprint; history SQL does not.
      // Cross-class mode runs BOTH in parallel. Legacy history_info runs only history SQL.
      const rawFingerprint = computeQueryFingerprint(normalizedText)
      const rawEmbedding = await computeEmbedding(normalizedText, rawFingerprint)

      let rawPassUsed = false
      let rawPassCandidates: ReturnType<typeof mapRow>[] = []
      if (rawEmbedding) {
        rawPassUsed = true
        const rawEmbeddingParam = `[${rawEmbedding.join(',')}]`
        if (isCrossClassScope) {
          const [rawNavLearned, rawInfoLearned, rawNavSeeds, rawInfoSeeds] = await Promise.all([
            serverPool.query(PHASE5_LEARNED_NAVIGATION_SQL, [
              OPTION_A_TENANT_ID, OPTION_A_USER_ID, 'action_intent', rawEmbeddingParam, maxCandidates,
              MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION, navContextFingerprint,
            ]),
            serverPool.query(PHASE5_LEARNED_HISTORY_SQL, [
              OPTION_A_TENANT_ID, OPTION_A_USER_ID, 'info_intent', rawEmbeddingParam, maxCandidates,
              MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
            ]),
            serverPool.query(PHASE5_SEED_LOOKUP_SQL, [
              OPTION_A_TENANT_ID, ROUTING_MEMORY_CURATED_SEED_USER_ID,
              'action_intent', rawEmbeddingParam, maxCandidates,
              MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
            ]),
            serverPool.query(PHASE5_SEED_LOOKUP_SQL, [
              OPTION_A_TENANT_ID, ROUTING_MEMORY_CURATED_SEED_USER_ID,
              'info_intent', rawEmbeddingParam, maxCandidates,
              MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
            ]),
          ])
          rawPassCandidates = [
            ...rawNavLearned.rows.map((r: Record<string, unknown>) => mapRow(r, false)),
            ...rawInfoLearned.rows.map((r: Record<string, unknown>) => mapRow(r, false)),
            ...rawNavSeeds.rows.map((r: Record<string, unknown>) => mapRow(r, true)),
            ...rawInfoSeeds.rows.map((r: Record<string, unknown>) => mapRow(r, true)),
          ]
        } else {
          // Legacy history_info: single class (info_intent), no context filter
          const { rows: rawLearned } = await serverPool.query(PHASE5_LEARNED_HISTORY_SQL, [
            OPTION_A_TENANT_ID, OPTION_A_USER_ID, 'info_intent', rawEmbeddingParam, maxCandidates,
            MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
          ])
          const { rows: rawSeeds } = await serverPool.query(PHASE5_SEED_LOOKUP_SQL, [
            OPTION_A_TENANT_ID, ROUTING_MEMORY_CURATED_SEED_USER_ID,
            'info_intent', rawEmbeddingParam, maxCandidates,
            MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
          ])
          rawPassCandidates = [
            ...rawLearned.map((r: Record<string, unknown>) => mapRow(r, false)),
            ...rawSeeds.map((r: Record<string, unknown>) => mapRow(r, true)),
          ]
        }
      }

      // ── Pass 2: normalized-query embedding (only when normalization changed the text) ──
      let normalizedPassUsed = false
      let normPassCandidates: ReturnType<typeof mapRow>[] = []
      if (retrievalNormalizationApplied) {
        const normEmbedding = await computeEmbedding(retrievalText, retrievalFingerprint)
        if (normEmbedding) {
          normalizedPassUsed = true
          const normEmbeddingParam = `[${normEmbedding.join(',')}]`
          if (isCrossClassScope) {
            const [normNavLearned, normInfoLearned, normNavSeeds, normInfoSeeds] = await Promise.all([
              serverPool.query(PHASE5_LEARNED_NAVIGATION_SQL, [
                OPTION_A_TENANT_ID, OPTION_A_USER_ID, 'action_intent', normEmbeddingParam, maxCandidates,
                MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION, navContextFingerprint,
              ]),
              serverPool.query(PHASE5_LEARNED_HISTORY_SQL, [
                OPTION_A_TENANT_ID, OPTION_A_USER_ID, 'info_intent', normEmbeddingParam, maxCandidates,
                MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
              ]),
              serverPool.query(PHASE5_SEED_LOOKUP_SQL, [
                OPTION_A_TENANT_ID, ROUTING_MEMORY_CURATED_SEED_USER_ID,
                'action_intent', normEmbeddingParam, maxCandidates,
                MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
              ]),
              serverPool.query(PHASE5_SEED_LOOKUP_SQL, [
                OPTION_A_TENANT_ID, ROUTING_MEMORY_CURATED_SEED_USER_ID,
                'info_intent', normEmbeddingParam, maxCandidates,
                MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
              ]),
            ])
            normPassCandidates = [
              ...normNavLearned.rows.map((r: Record<string, unknown>) => mapRow(r, false)),
              ...normInfoLearned.rows.map((r: Record<string, unknown>) => mapRow(r, false)),
              ...normNavSeeds.rows.map((r: Record<string, unknown>) => mapRow(r, true)),
              ...normInfoSeeds.rows.map((r: Record<string, unknown>) => mapRow(r, true)),
            ]
          } else {
            const { rows: normLearned } = await serverPool.query(PHASE5_LEARNED_HISTORY_SQL, [
              OPTION_A_TENANT_ID, OPTION_A_USER_ID, 'info_intent', normEmbeddingParam, maxCandidates,
              MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
            ])
            const { rows: normSeeds } = await serverPool.query(PHASE5_SEED_LOOKUP_SQL, [
              OPTION_A_TENANT_ID, ROUTING_MEMORY_CURATED_SEED_USER_ID,
              'info_intent', normEmbeddingParam, maxCandidates,
              MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
            ])
            normPassCandidates = [
              ...normLearned.map((r: Record<string, unknown>) => mapRow(r, false)),
              ...normSeeds.map((r: Record<string, unknown>) => mapRow(r, true)),
            ]
          }
        }
      }

      // ── Merge + dedupe + rerank ──
      // Per-candidate dedupe via routeCandidateIdentity — same rule as the
      // exact-hit block above. Keeps distinct state_info question forms
      // separate while collapsing duplicate rows across the cross-class
      // parallel queries.
      const allRaw = [...rawPassCandidates, ...normPassCandidates]
      const deduped = new Map<string, ReturnType<typeof mapRow>>()
      for (const c of allRaw) {
        const key = routeCandidateIdentity(c)
        const existing = deduped.get(key)
        if (!existing || c.similarity_score > existing.similarity_score) {
          deduped.set(key, c)
        }
      }

      // Apply per-candidate floor + cross-class dispatch allowlist filter.
      // For cross-class scopes, only action_types in DISPATCH_ALLOWLIST pass.
      // Per-candidate similarity floor: state_info ≥ 0.70, others ≥ 0.85.
      // Legacy history_info uses the single HISTORY_INFO_SIMILARITY_FLOOR.
      const legacyFloor = HISTORY_INFO_SIMILARITY_FLOOR
      const merged = Array.from(deduped.values())
        .filter(c => {
          if (isCrossClassScope) return passesPoolFilter(c)
          return c.similarity_score >= legacyFloor
        })
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
