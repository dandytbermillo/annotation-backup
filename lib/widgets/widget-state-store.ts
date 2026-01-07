/**
 * Widget State Store (Runtime)
 *
 * Client-side ephemeral storage for widget chat state.
 * Widgets report their internal state here, and it's injected into UIContext
 * for the LLM to answer questions like "What is this widget showing?"
 *
 * Reference: docs/proposal/chat-navigation/plan/panels/widget_manager/widget-chat-state-contract.md
 *
 * NOTE: This is runtime-only, NOT persisted to DB. State is lost on refresh.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Selection state for widgets that support item selection
 */
export interface WidgetSelection {
  id: string
  label: string
}

/**
 * Widget state reported by widgets (required fields)
 */
export interface WidgetState {
  /** Schema version for forward compatibility */
  _version: 1
  /** Widget type ID (e.g., "demo", "quick-links", "recent") */
  widgetId: string
  /** Unique instance ID (panel ID) */
  instanceId: string
  /** Human-readable title */
  title: string
  /** Current view (e.g., "list", "details", "settings") */
  view: string | null
  /** Currently selected item */
  selection: WidgetSelection | null
  /** 1-2 line human summary of current state */
  summary: string | null
  /** Timestamp when state was last updated */
  updatedAt: number
  /** Optional: Active filters */
  filters?: string[]
  /** Optional: Counts (e.g., { total: 10, visible: 5 }) */
  counts?: Record<string, number>
  /** Optional: Available actions */
  actions?: string[]
  /** Optional: Context tags for LLM grounding */
  contextTags?: string[]
  /** Set by store when state exceeds TTL */
  stale?: boolean
}

/**
 * Input for upsertWidgetState (required fields only)
 */
export interface WidgetStateInput {
  _version: 1
  widgetId: string
  instanceId: string
  title: string
  view?: string | null
  selection?: WidgetSelection | null
  summary?: string | null
  updatedAt: number
  filters?: string[]
  counts?: Record<string, number>
  actions?: string[]
  contextTags?: string[]
}

// ============================================================================
// Validation Constants
// ============================================================================

const MAX_STRING_LENGTH = 120
const MAX_SUMMARY_LENGTH = 200
const MAX_ARRAY_LENGTH = 10
const MAX_COUNTS_KEYS = 10

// ============================================================================
// Store (In-Memory Map)
// ============================================================================

const widgetStates = new Map<string, WidgetState>()

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Truncate string to max length
 */
function truncateString(str: string | null | undefined, maxLength: number): string | null {
  if (str == null) return null
  return str.length > maxLength ? str.slice(0, maxLength) : str
}

/**
 * Validate and sanitize widget state input
 * Returns null if invalid (missing required fields)
 */
function validateAndSanitize(input: unknown): WidgetState | null {
  if (!input || typeof input !== 'object') return null

  const data = input as Record<string, unknown>

  // Required fields check
  if (data._version !== 1) return null
  if (typeof data.widgetId !== 'string' || !data.widgetId) return null
  if (typeof data.instanceId !== 'string' || !data.instanceId) return null
  if (typeof data.title !== 'string' || !data.title) return null
  if (typeof data.updatedAt !== 'number') return null

  // Selection validation (if present)
  let selection: WidgetSelection | null = null
  if (data.selection != null) {
    const sel = data.selection as Record<string, unknown>
    if (typeof sel.id !== 'string' || typeof sel.label !== 'string') {
      return null // Invalid selection format
    }
    selection = {
      id: truncateString(sel.id, MAX_STRING_LENGTH) || '',
      label: truncateString(sel.label, MAX_STRING_LENGTH) || '',
    }
  }

  // Build sanitized state (allowlist only)
  const state: WidgetState = {
    _version: 1,
    widgetId: truncateString(data.widgetId as string, MAX_STRING_LENGTH) || '',
    instanceId: data.instanceId as string, // Keep full ID for lookup
    title: truncateString(data.title as string, MAX_STRING_LENGTH) || '',
    view: truncateString(data.view as string | null, MAX_STRING_LENGTH),
    selection,
    summary: truncateString(data.summary as string | null, MAX_SUMMARY_LENGTH),
    updatedAt: data.updatedAt as number,
  }

  // Optional arrays (capped)
  if (Array.isArray(data.filters)) {
    state.filters = data.filters
      .slice(0, MAX_ARRAY_LENGTH)
      .filter((f): f is string => typeof f === 'string')
      .map(f => truncateString(f, MAX_STRING_LENGTH) || '')
  }

  if (Array.isArray(data.actions)) {
    state.actions = data.actions
      .slice(0, MAX_ARRAY_LENGTH)
      .filter((a): a is string => typeof a === 'string')
      .map(a => truncateString(a, MAX_STRING_LENGTH) || '')
  }

  if (Array.isArray(data.contextTags)) {
    state.contextTags = data.contextTags
      .slice(0, MAX_ARRAY_LENGTH)
      .filter((t): t is string => typeof t === 'string')
      .map(t => truncateString(t, MAX_STRING_LENGTH) || '')
  }

  // Optional counts (capped keys)
  if (data.counts && typeof data.counts === 'object') {
    const counts = data.counts as Record<string, unknown>
    const keys = Object.keys(counts).slice(0, MAX_COUNTS_KEYS)
    state.counts = {}
    for (const key of keys) {
      if (typeof counts[key] === 'number') {
        state.counts[key] = counts[key] as number
      }
    }
  }

  return state
}

// ============================================================================
// Store API
// ============================================================================

/**
 * Upsert widget state
 * Returns true if state was stored, false if validation failed
 */
export function upsertWidgetState(input: WidgetStateInput): boolean {
  const state = validateAndSanitize(input)
  if (!state) {
    console.warn('[widget-state-store] Invalid state rejected:', input)
    return false
  }

  widgetStates.set(state.instanceId, state)
  return true
}

/**
 * Get widget state by instance ID
 */
export function getWidgetState(instanceId: string): WidgetState | null {
  return widgetStates.get(instanceId) || null
}

/**
 * Get all widget states (for UIContext injection)
 * Returns as Record<instanceId, WidgetState> for easier consumption
 */
export function getAllWidgetStates(): Record<string, WidgetState> {
  const result: Record<string, WidgetState> = {}
  for (const [id, state] of widgetStates) {
    result[id] = state
  }
  return result
}

/**
 * Get all non-stale widget states
 */
export function getFreshWidgetStates(): Record<string, WidgetState> {
  const result: Record<string, WidgetState> = {}
  for (const [id, state] of widgetStates) {
    if (!state.stale) {
      result[id] = state
    }
  }
  return result
}

/**
 * Remove widget state (call on unmount)
 */
export function removeWidgetState(instanceId: string): boolean {
  return widgetStates.delete(instanceId)
}

/**
 * Clear all widget states
 */
export function clearAllWidgetStates(): void {
  widgetStates.clear()
}

/**
 * Mark stale states and optionally remove very old ones
 * @param now Current timestamp
 * @param staleTtlMs Time after which state is marked stale (default: 60s)
 * @param removeTtlMs Time after which state is removed (default: 5min)
 */
export function pruneStaleWidgetStates(
  now: number,
  staleTtlMs: number = 60_000,
  removeTtlMs: number = 300_000
): { markedStale: number; removed: number } {
  let markedStale = 0
  let removed = 0

  for (const [id, state] of widgetStates) {
    const age = now - state.updatedAt

    if (age > removeTtlMs) {
      widgetStates.delete(id)
      removed++
    } else if (age > staleTtlMs && !state.stale) {
      state.stale = true
      markedStale++
    }
  }

  return { markedStale, removed }
}

/**
 * Get count of stored states (for debugging)
 */
export function getWidgetStateCount(): number {
  return widgetStates.size
}
