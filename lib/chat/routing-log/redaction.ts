/**
 * Redaction Policy — Phase 1 Observe-Only
 *
 * Baseline pattern masking for raw query text before durable log storage.
 * Even chat commands can contain identifiers (emails, tokens, numeric IDs).
 */

import type { ContextSnapshotV1 } from './context-snapshot'

// REDACTION_REVIEW: v1 baseline — patterns applied sequentially after lowercase normalization.
// Regex uses 'i' flag for safety even though normalization lowercases first.

const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // JWT-like patterns (must come before generic token match)
  { pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/gi, replacement: '[REDACTED_JWT]' },
  // Bearer/API tokens (20+ char token after "bearer")
  { pattern: /(bearer\s+)\S{20,}/gi, replacement: '$1[REDACTED_TOKEN]' },
  // Email addresses
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi, replacement: '[REDACTED_EMAIL]' },
  // Long numeric IDs (16+ digits, not part of common timestamp-based IDs like "user-1234567890123")
  { pattern: /(?<![a-z-])\b\d{16,}\b/gi, replacement: '[REDACTED_ID]' },
]

/**
 * Redact sensitive patterns from raw query text before storage.
 * Applied after format-only normalization (text is already lowercased).
 */
export function redactQueryText(text: string): string {
  let result = text
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

/**
 * Redact sensitive fields from context snapshot before storage.
 * REDACTION_REVIEW: v1_minimal safe — all fields are booleans/counts, no sensitive data.
 * When snapshot evolves to v2_full, concrete redaction rules must be added here.
 */
export function redactContextSnapshot(snapshot: ContextSnapshotV1): ContextSnapshotV1 {
  // v1_minimal: pass-through (booleans and counts only)
  return snapshot
}
