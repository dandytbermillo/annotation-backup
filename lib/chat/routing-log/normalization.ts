/**
 * Storage Normalization — Phase 1 Observe-Only
 *
 * Format-only normalization for durable log storage.
 * Do NOT use canonicalizeCommandInput() here — it strips verbs and alters
 * semantics (removes polite prefixes, strips punctuation). That's correct
 * for routing dispatch but wrong for durable log storage.
 *
 * NOTE: This module uses Node.js crypto (server-side only).
 * It is imported by the API route, NOT by client-side code.
 */

import { createHash } from 'crypto'

/**
 * Format-only normalization: trim, collapse whitespace, lowercase.
 * Preserves semantic content (verbs, punctuation, polite prefixes).
 */
export function normalizeForStorage(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * Compute SHA-256 hex fingerprint of a string.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/**
 * Compute query fingerprint from normalized text.
 */
export function computeQueryFingerprint(normalizedText: string): string {
  return sha256Hex(normalizedText)
}
