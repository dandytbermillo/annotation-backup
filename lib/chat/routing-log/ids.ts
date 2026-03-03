/**
 * Interaction ID Utilities — Phase 1 Observe-Only
 *
 * Deterministic interaction ID derivation for durable log dedup.
 * Client-safe: no Node.js crypto dependency.
 */

/**
 * Simple deterministic string hash (FNV-1a 32-bit).
 * Client-safe: no crypto dependency. NOT for security — only for deterministic dedup.
 */
export function simpleStringHash(str: string): string {
  let hash = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) // FNV prime
  }
  return (hash >>> 0).toString(36)
}

/**
 * Derive a deterministic fallback interaction ID when user message ID is unavailable.
 * Uses session_id + turn_index + query hash to ensure retry idempotency.
 *
 * Same inputs always produce the same output — safe for ON CONFLICT dedup.
 */
export function deriveFallbackInteractionId(
  sessionId: string,
  turnIndex: number,
  rawQuery: string,
): string {
  return `fb-${sessionId}-${turnIndex}-${simpleStringHash(rawQuery)}`
}
