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
}

/** Structured result from semantic lookup — disambiguates empty vs timeout vs error vs disabled. */
export interface SemanticLookupResult {
  status: 'ok' | 'empty' | 'timeout' | 'error' | 'disabled'
  candidates: SemanticCandidate[]
  latencyMs: number
}

/** Semantic lookup timeout: 800ms (embedding API ~200-400ms + DB ~100ms + HTTP overhead).
 *  The OpenAI embedding API takes 200-400ms from this environment; the server-side
 *  EMBEDDING_TIMEOUT_MS is 600ms. Client ceiling must exceed that to avoid premature
 *  timeout. Separate from MEMORY_READ_TIMEOUT_MS (150ms) used by B1 exact lookup. */
export const MEMORY_SEMANTIC_READ_TIMEOUT_MS = 800

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

        // Use server-reported lookup_status when available for truthful telemetry
        if (lookupStatus === 'embedding_failure' || lookupStatus === 'server_error') {
          return { status: 'error' as const, candidates: [] as SemanticCandidate[] }
        }
        if (candidates && candidates.length > 0) {
          return { status: 'ok' as const, candidates }
        }
        return { status: 'empty' as const, candidates: [] as SemanticCandidate[] }
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
