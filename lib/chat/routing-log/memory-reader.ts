/**
 * Memory Reader (Client-Side) — Phase 2b
 *
 * Sends exact lookup request to server API for memory retrieval.
 * Same bounded-await pattern as Phase 1 writer.ts: tight timeout, fail-open.
 *
 * Client-safe: no crypto, no DB imports.
 * The server-side API route handles normalization, fingerprinting, and DB query.
 */

import type { ContextSnapshotV1 } from './context-snapshot'
import type { RiskTier } from './types'
import { MEMORY_READ_TIMEOUT_MS } from './types'

const MEMORY_READ_SLOW_THRESHOLD_MS = 30
const MEMORY_LOOKUP_ENDPOINT = '/api/chat/routing-memory/lookup'

export interface MemoryLookupResult {
  intent_id: string
  intent_class: 'action_intent' | 'info_intent'
  slots_json: Record<string, unknown>
  target_ids: string[]
  risk_tier: RiskTier
  success_count: number
  context_fingerprint: string
}

/**
 * Look up exact memory match via server API.
 * - Gated by NEXT_PUBLIC_CHAT_ROUTING_MEMORY_READ on client (build-time inline)
 * - Server also checks CHAT_ROUTING_MEMORY_READ_ENABLED (runtime, authoritative)
 * - Bounded await (50ms timeout) + fail-open (returns null on error/timeout)
 */
export async function lookupExactMemory(payload: {
  raw_query_text: string
  context_snapshot: ContextSnapshotV1
  navigation_replay_mode?: boolean  // Phase 5: use navigation-specific minimal fingerprint
}): Promise<MemoryLookupResult | null> {
  // Client-side early bail-out
  if (process.env.NEXT_PUBLIC_CHAT_ROUTING_MEMORY_READ !== 'true') {
    return null
  }

  const start = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined

  const fetchPromise = fetch(MEMORY_LOOKUP_ENDPOINT, {
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
        return (data.match as MemoryLookupResult) ?? null
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null)
        }, MEMORY_READ_TIMEOUT_MS)
      }),
    ])

    const latencyMs = Math.round(performance.now() - start)
    if (latencyMs > MEMORY_READ_SLOW_THRESHOLD_MS && result !== null) {
      console.warn(`[routing-memory] lookup slow: ${latencyMs}ms`)
    }

    return result
  } catch (err: unknown) {
    clearTimeout(timer)
    console.warn('[routing-memory] lookup failed (non-fatal):', (err as Error).message)
    return null
  }
}
