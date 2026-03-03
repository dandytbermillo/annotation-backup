/**
 * DB Writer (Client-Side) — Phase 1 Observe-Only
 *
 * Sends routing log payload to the server API for durable storage.
 * Bounded-await with fetch timeout.
 * Fail-open: never throws into routing, never blocks beyond timeout budget.
 * Latency tracked and logged for telemetry.
 *
 * The server-side API route handles normalization, hashing, redaction, and DB insert.
 */

import type { RoutingLogPayload } from './payload'

const LOG_WRITE_TIMEOUT_MS = 50   // tight budget: typical local fetch < 10ms
const LOG_SLOW_THRESHOLD_MS = 30  // warn if write exceeds this
const LOG_ENDPOINT = '/api/chat/routing-log'

/**
 * Record a routing log entry via server API.
 * - Gated by NEXT_PUBLIC_CHAT_ROUTING_OBSERVE_ONLY on client (build-time inline)
 * - Server also checks CHAT_ROUTING_OBSERVE_ONLY (runtime check, authoritative)
 * - Bounded await (50ms timeout) + fail-open
 * - Late-write handling: if timeout fires first, fetch outcome is still logged
 */
export async function recordRoutingLog(payload: RoutingLogPayload): Promise<void> {
  // Client-side early bail-out: NEXT_PUBLIC_ env var is inlined at build time by Next.js.
  // Server endpoint also checks its own flag — this avoids a no-op fetch when disabled.
  if (process.env.NEXT_PUBLIC_CHAT_ROUTING_OBSERVE_ONLY !== 'true') {
    return
  }

  const start = performance.now()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const fetchPromise = fetch(LOG_ENDPOINT, {
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
        }, LOG_WRITE_TIMEOUT_MS)
      })
    ])
    const latencyMs = Math.round(performance.now() - start)
    if (latencyMs > LOG_SLOW_THRESHOLD_MS) {
      console.warn(`[routing-log] write slow: ${latencyMs}ms`)
    }
  } catch (err: unknown) {
    clearTimeout(timer)
    const latencyMs = Math.round(performance.now() - start)
    const isTimeout = (err as Error).message === 'timeout'
    console.warn(
      `[routing-log] write ${isTimeout ? 'timeout' : 'failed'} (non-fatal):`,
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
          console.warn('[routing-log] timed_out_but_late_write: request completed after timeout')
        } else {
          console.warn(`[routing-log] timed_out_and_failed: HTTP ${res.status}`)
        }
      })
      .catch((err) => console.warn('[routing-log] timed_out_and_failed:', (err as Error).message))
  }
}
