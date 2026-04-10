/**
 * Semantic Memory Reader (Client-Side) — Phase 3
 *
 * Sends semantic lookup request to server API for B2 candidate retrieval.
 * Same bounded-await pattern as Phase 2 memory-reader.ts: tight timeout, fail-open.
 *
 * Client-safe: no crypto, no DB imports, no embedding computation.
 * Server handles normalization, embedding computation, and vector similarity search.
 */

import type { ContextSnapshotV1 } from './context-snapshot'
import type { MemoryLookupResult } from './memory-reader'

export interface SemanticCandidate extends MemoryLookupResult {
  similarity_score: number
  /** Memory index row UUID — used for Slice 3a replay-hit accounting. Separate from target/candidate IDs. */
  matchedRowId?: string
}

/** Structured result from semantic lookup — disambiguates empty vs timeout vs error vs disabled. */
export interface SemanticLookupResult {
  status: 'ok' | 'empty' | 'timeout' | 'error' | 'disabled'
  candidates: SemanticCandidate[]
  latencyMs: number
  /** Current context fingerprint computed server-side. Stage 5 uses this to compare against candidate fingerprints. */
  currentContextFingerprint?: string
}

/** Client-side semantic lookup timeout. Must exceed server-side EMBEDDING_TIMEOUT_MS (1200ms)
 *  to avoid premature client timeout. Separate from MEMORY_READ_TIMEOUT_MS (150ms) used by B1. */
export const MEMORY_SEMANTIC_READ_TIMEOUT_MS = 2000

const SEMANTIC_LOOKUP_ENDPOINT = '/api/chat/routing-memory/semantic-lookup'
const SEMANTIC_READ_SLOW_THRESHOLD_MS = 200

// Sentinel used internally to distinguish timeout from fetch success
const TIMEOUT_SENTINEL = Symbol('timeout')

/**
 * Look up semantic memory candidates via server API.
 * - Gated by NEXT_PUBLIC_CHAT_ROUTING_MEMORY_SEMANTIC_READ on client (build-time inline)
 * - Server also checks CHAT_ROUTING_MEMORY_SEMANTIC_READ_ENABLED (runtime, authoritative)
 * - Bounded await (800ms timeout) + fail-open (returns error/timeout status)
 *
 * Returns structured SemanticLookupResult with status, candidates, and latencyMs.
 */
// ── Phase 5: Hint-oriented semantic lookup ──

export interface SemanticHintCandidate extends SemanticCandidate {
  from_curated_seed: boolean
}

export interface SemanticHintLookupResult {
  status: 'ok' | 'empty' | 'timeout' | 'error' | 'disabled'
  candidates: SemanticHintCandidate[]
  latencyMs: number
  currentContextFingerprint?: string
  // Phase 5 addendum: retrieval normalization + exact-hit telemetry
  retrievalNormalizationApplied?: boolean
  phase5ExactHitUsed?: boolean
  phase5ExactHitSource?: 'learned' | 'curated_seed'
  rawQueryText?: string
  retrievalQueryText?: string
  // Phase 5 addendum: multi-pass retrieval telemetry
  phase5NearTie?: boolean
  rawPassUsed?: boolean
  normalizedPassUsed?: boolean
}

/**
 * Phase 5 semantic hint lookup — separate from Stage 5/B2 replay.
 * Gated by NEXT_PUBLIC_CHAT_ROUTING_MEMORY_HINT_READ (build-time).
 * Server gated by CHAT_ROUTING_MEMORY_HINT_READ_ENABLED (runtime).
 * Posts to the same shared endpoint with intent_scope in the body.
 */
export async function lookupSemanticHints(payload: {
  raw_query_text: string
  context_snapshot: ContextSnapshotV1
  intent_scope: 'history_info' | 'navigation' | 'state_info'
  max_candidates?: number
}): Promise<SemanticHintLookupResult> {
  if (process.env.NEXT_PUBLIC_CHAT_ROUTING_MEMORY_HINT_READ !== 'true') {
    return { status: 'disabled', candidates: [], latencyMs: 0 }
  }

  const start = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined

  const fetchPromise = fetch(SEMANTIC_LOOKUP_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  try {
    const raceResult = await Promise.race([
      fetchPromise.then(async (res) => {
        clearTimeout(timer)
        if (!res.ok) return { status: 'error' as const, candidates: [] as SemanticHintCandidate[] }
        const data = await res.json()
        const candidates = (data.candidates ?? []) as SemanticHintCandidate[]
        const lookupStatus = data.lookup_status as string | undefined
        const currentContextFingerprint = data.current_context_fingerprint as string | undefined

        // Phase 5 addendum: extract normalization + exact-hit telemetry
        const addendumTelemetry = {
          retrievalNormalizationApplied: data.retrieval_normalization_applied as boolean | undefined,
          phase5ExactHitUsed: data.phase5_exact_hit_used as boolean | undefined,
          phase5ExactHitSource: data.phase5_exact_hit_source as 'learned' | 'curated_seed' | undefined,
          rawQueryText: data.raw_query_text as string | undefined,
          retrievalQueryText: data.retrieval_query_text as string | undefined,
          // Multi-pass retrieval telemetry
          phase5NearTie: data.phase5_near_tie as boolean | undefined,
          rawPassUsed: data.raw_pass_used as boolean | undefined,
          normalizedPassUsed: data.normalized_pass_used as boolean | undefined,
        }

        if (lookupStatus === 'embedding_failure' || lookupStatus === 'server_error') {
          return { status: 'error' as const, candidates: [] as SemanticHintCandidate[], currentContextFingerprint, ...addendumTelemetry }
        }
        if (candidates.length > 0) {
          for (const c of candidates) {
            const raw = c as unknown as Record<string, unknown>
            if (raw.matched_row_id && !c.matchedRowId) {
              c.matchedRowId = raw.matched_row_id as string
            }
          }
          return { status: 'ok' as const, candidates, currentContextFingerprint, ...addendumTelemetry }
        }
        return { status: 'empty' as const, candidates: [] as SemanticHintCandidate[], currentContextFingerprint, ...addendumTelemetry }
      }),
      new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), MEMORY_SEMANTIC_READ_TIMEOUT_MS)
      }),
    ])

    const latencyMs = Math.round(performance.now() - start)

    if (raceResult === TIMEOUT_SENTINEL) {
      return { status: 'timeout', candidates: [], latencyMs }
    }

    return { ...raceResult, latencyMs }
  } catch (err: unknown) {
    clearTimeout(timer)
    const latencyMs = Math.round(performance.now() - start)
    console.warn('[routing-memory] Phase 5 hint lookup failed (non-fatal):', (err as Error).message)
    return { status: 'error', candidates: [], latencyMs }
  }
}

// ── Legacy Stage 5/B2 semantic lookup ──

export async function lookupSemanticMemory(payload: {
  raw_query_text: string
  context_snapshot: ContextSnapshotV1
}): Promise<SemanticLookupResult> {
  // Client-side early bail-out
  if (process.env.NEXT_PUBLIC_CHAT_ROUTING_MEMORY_SEMANTIC_READ !== 'true') {
    return { status: 'disabled', candidates: [], latencyMs: 0 }
  }

  const start = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined

  const fetchPromise = fetch(SEMANTIC_LOOKUP_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  try {
    const raceResult = await Promise.race([
      fetchPromise.then(async (res) => {
        clearTimeout(timer)
        if (!res.ok) return { status: 'error' as const, candidates: [] as SemanticCandidate[] }
        const data = await res.json()
        const candidates = data.candidates as SemanticCandidate[] | undefined
        const lookupStatus = data.lookup_status as string | undefined
        const currentContextFingerprint = data.current_context_fingerprint as string | undefined

        // Use server-reported lookup_status when available for truthful telemetry
        if (lookupStatus === 'embedding_failure' || lookupStatus === 'server_error') {
          return { status: 'error' as const, candidates: [] as SemanticCandidate[], currentContextFingerprint }
        }
        if (candidates && candidates.length > 0) {
          // Map server snake_case matched_row_id → camelCase matchedRowId
          for (const c of candidates) {
            const raw = c as unknown as Record<string, unknown>
            if (raw.matched_row_id && !c.matchedRowId) {
              c.matchedRowId = raw.matched_row_id as string
            }
          }
          return { status: 'ok' as const, candidates, currentContextFingerprint }
        }
        return { status: 'empty' as const, candidates: [] as SemanticCandidate[], currentContextFingerprint }
      }),
      new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
        timer = setTimeout(() => {
          resolve(TIMEOUT_SENTINEL)
        }, MEMORY_SEMANTIC_READ_TIMEOUT_MS)
      }),
    ])

    const latencyMs = Math.round(performance.now() - start)

    if (raceResult === TIMEOUT_SENTINEL) {
      return { status: 'timeout', candidates: [], latencyMs }
    }

    if (latencyMs > SEMANTIC_READ_SLOW_THRESHOLD_MS && raceResult.status === 'ok') {
      console.warn(`[routing-memory] semantic lookup slow: ${latencyMs}ms`)
    }

    return { ...raceResult, latencyMs }
  } catch (err: unknown) {
    clearTimeout(timer)
    const latencyMs = Math.round(performance.now() - start)
    console.warn('[routing-memory] semantic lookup failed (non-fatal):', (err as Error).message)
    return { status: 'error', candidates: [], latencyMs }
  }
}
