/**
 * Memory Writer (Client-Side) — Phase 2a
 *
 * Sends memory write payload to the server API for UPSERT into chat_routing_memory_index.
 * Same bounded-await pattern as Phase 1 writer.ts: tight timeout, fail-open, late-write tracking.
 *
 * Client-safe: no crypto, no DB imports.
 * The server-side API route handles normalization, hashing, redaction, and DB UPSERT.
 *
 * Write semantics:
 * - Best-effort: timeout, network failure, or disabled flags can drop a write.
 * - Fired by sendMessage() after confirmed execution only (Gate 5), not at
 *   routing decision time. A dropped write means the action won't be cached
 *   for future memory-assist — it does not affect correctness.
 */

import type { MemoryWritePayload } from './memory-write-payload'
import { MEMORY_WRITE_TIMEOUT_MS } from './types'

const MEMORY_SLOW_THRESHOLD_MS = 30
const MEMORY_WRITE_ENDPOINT = '/api/chat/routing-memory'

/**
 * Record a memory index entry via server API.
 * - Gated by NEXT_PUBLIC_CHAT_ROUTING_MEMORY_WRITE on client (build-time inline)
 * - Server also checks CHAT_ROUTING_MEMORY_WRITE_ENABLED (runtime, authoritative)
 * - Bounded await (50ms timeout) + fail-open
 * - Late-write handling: if timeout fires first, fetch outcome is still logged
 */
export async function recordMemoryEntry(payload: MemoryWritePayload): Promise<void> {
  // Client-side early bail-out: NEXT_PUBLIC_ env var is inlined at build time by Next.js.
  if (process.env.NEXT_PUBLIC_CHAT_ROUTING_MEMORY_WRITE !== 'true') {
    return
  }

  const start = performance.now()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const fetchPromise = fetch(MEMORY_WRITE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  try {
    await Promise.race([
      fetchPromise.then((res) => {
        clearTimeout(timer)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          reject(new Error('timeout'))
        }, MEMORY_WRITE_TIMEOUT_MS)
      })
    ])
    const latencyMs = Math.round(performance.now() - start)
    if (latencyMs > MEMORY_SLOW_THRESHOLD_MS) {
      console.warn(`[routing-memory] write slow: ${latencyMs}ms`)
    }
  } catch (err: unknown) {
    clearTimeout(timer)
    const latencyMs = Math.round(performance.now() - start)
    const isTimeout = (err as Error).message === 'timeout'
    console.warn(
      `[routing-memory] write ${isTimeout ? 'timeout' : 'failed'} (non-fatal):`,
      (err as Error).message,
      { latency_ms: latencyMs }
    )
  }

  // If timeout fired first, the fetch may still complete.
  // Track late-write vs true failure for telemetry.
  if (timedOut) {
    fetchPromise
      .then((res) => {
        if (res.ok) {
          console.warn('[routing-memory] timed_out_but_late_write: request completed after timeout')
        } else {
          console.warn(`[routing-memory] timed_out_and_failed: HTTP ${res.status}`)
        }
      })
      .catch((err) => console.warn('[routing-memory] timed_out_and_failed:', (err as Error).message))
  }
}
