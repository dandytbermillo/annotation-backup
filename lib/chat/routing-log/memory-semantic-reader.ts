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

/** Semantic lookup timeout: 400ms (embedding ~200ms + DB ~100ms + overhead).
 *  Separate from MEMORY_READ_TIMEOUT_MS (150ms) used by B1 exact lookup. */
export const MEMORY_SEMANTIC_READ_TIMEOUT_MS = 400

const SEMANTIC_LOOKUP_ENDPOINT = '/api/chat/routing-memory/semantic-lookup'
const SEMANTIC_READ_SLOW_THRESHOLD_MS = 200

/**
 * Look up semantic memory candidates via server API.
 * - Gated by NEXT_PUBLIC_CHAT_ROUTING_MEMORY_SEMANTIC_READ on client (build-time inline)
 * - Server also checks CHAT_ROUTING_MEMORY_SEMANTIC_READ_ENABLED (runtime, authoritative)
 * - Bounded await (400ms timeout) + fail-open (returns null on error/timeout)
 *
 * Returns array of validated candidates sorted by similarity, or null on timeout/error.
 */
export async function lookupSemanticMemory(payload: {
  raw_query_text: string
  context_snapshot: ContextSnapshotV1
}): Promise<SemanticCandidate[] | null> {
  // Client-side early bail-out
  if (process.env.NEXT_PUBLIC_CHAT_ROUTING_MEMORY_SEMANTIC_READ !== 'true') {
    return null
  }

  const start = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined

  const fetchPromise = fetch(SEMANTIC_LOOKUP_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  try {
    const result = await Promise.race([
      fetchPromise.then(async (res) => {
        clearTimeout(timer)
        if (!res.ok) return null
        const data = await res.json()
        const candidates = data.candidates as SemanticCandidate[] | undefined
        return candidates && candidates.length > 0 ? candidates : null
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null)
        }, MEMORY_SEMANTIC_READ_TIMEOUT_MS)
      }),
    ])

    const latencyMs = Math.round(performance.now() - start)
    if (latencyMs > SEMANTIC_READ_SLOW_THRESHOLD_MS && result !== null) {
      console.warn(`[routing-memory] semantic lookup slow: ${latencyMs}ms`)
    }

    return result
  } catch (err: unknown) {
    clearTimeout(timer)
    console.warn('[routing-memory] semantic lookup failed (non-fatal):', (err as Error).message)
    return null
  }
}
