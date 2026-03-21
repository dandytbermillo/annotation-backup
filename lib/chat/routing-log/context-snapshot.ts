/**
 * Context Snapshot v1 — Phase 1 Observe-Only
 *
 * Minimal, deterministic context snapshot with canonical JSON serialization.
 * No new UI hooks — derived entirely from existing routing context and turn snapshot.
 *
 * Client-safe: no Node.js crypto imports.
 * Fingerprint computation lives in server-only code (API route uses sha256Hex directly).
 */

// --- Snapshot interface ---

export interface ContextSnapshotV1 {
  version: 'v1_minimal'
  active_panel_count: number
  has_pending_options: boolean
  has_active_option_set: boolean
  has_last_clarification: boolean
  has_last_suggestion: boolean
  latch_enabled: boolean
  message_count: number
}

// --- Snapshot builder ---

export interface SnapshotInputs {
  openWidgetCount: number
  pendingOptionsCount: number
  activeOptionSetId: string | null
  hasLastClarification: boolean
  hasLastSuggestion: boolean
  latchEnabled: boolean
  messageCount: number
}

export function buildContextSnapshot(inputs: SnapshotInputs): ContextSnapshotV1 {
  return {
    version: 'v1_minimal',
    active_panel_count: inputs.openWidgetCount,
    has_pending_options: inputs.pendingOptionsCount > 0,
    has_active_option_set: inputs.activeOptionSetId !== null,
    has_last_clarification: inputs.hasLastClarification,
    has_last_suggestion: inputs.hasLastSuggestion,
    latch_enabled: inputs.latchEnabled,
    message_count: inputs.messageCount,
  }
}

// --- Memory-key canonicalizer (strips volatile fields for stable fingerprinting) ---

/**
 * Strip volatile fields from a context snapshot for memory keying.
 * Used only by memory write/read routes — durable log keeps the full snapshot.
 */
export function stripVolatileFields(snapshot: ContextSnapshotV1): Omit<ContextSnapshotV1, 'message_count'> {
  const { message_count: _mc, ...stable } = snapshot
  return stable
}

/**
 * Strip volatile AND ephemeral fields for Phase 5 navigation replay keying.
 * Navigation replay safety comes from stored target IDs + execution validation,
 * not from matching ephemeral UI state like panel count or pending clarifiers.
 *
 * Retains only: version, latch_enabled (config-level, stable across turns).
 * Full context_snapshot is still stored for diagnostics — only fingerprint changes.
 */
export function stripVolatileFieldsForNavigation(snapshot: ContextSnapshotV1): Pick<ContextSnapshotV1, 'version' | 'latch_enabled'> {
  return {
    version: snapshot.version,
    latch_enabled: snapshot.latch_enabled,
  }
}

// --- Canonical JSON serializer (client-safe, no crypto) ---

/**
 * Canonical JSON serializer with recursive stable key ordering.
 * - Object keys sorted lexicographically at every depth
 * - Arrays preserved in order (no reordering)
 * - No whitespace, no trailing commas
 * - Deterministic: same input always produces same output
 */
export function canonicalJsonSerialize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value))
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value

  if (Array.isArray(value)) {
    return value.map(sortKeysDeep)
  }

  const obj = value as Record<string, unknown>
  const sortedKeys = Object.keys(obj).sort()
  const sorted: Record<string, unknown> = {}
  for (const key of sortedKeys) {
    sorted[key] = sortKeysDeep(obj[key])
  }
  return sorted
}
