/**
 * Widget UI Snapshot Registry (Layer 1)
 *
 * Ephemeral in-memory store where widgets self-register structured snapshots
 * with typed segments (list + context). The routing system reads these at
 * Tier 4.5 via the snapshot builder (Layer 2).
 *
 * This store is separate from widget-state-store.ts:
 * - widget-state-store → LLM / intent-prompt (summaries, counts)
 * - ui-snapshot-registry → routing / grounding-set (selectable items)
 *
 * Reference: widget-registry-implementation-plan.md
 *
 * NOTE: Runtime-only, NOT persisted to DB. State is lost on refresh.
 */

// ============================================================================
// Types
// ============================================================================

export interface SnapshotListItem {
  /** Stable, unique within widget */
  itemId: string
  /** Human-readable display text */
  label: string
  /** Single-letter badge (e.g., "D") */
  badge?: string
  /** Whether badge is rendered */
  badgeVisible?: boolean
  /** Allowed actions (e.g., ["open"]) — must have at least one */
  actions: string[]
}

export interface SnapshotListSegment {
  /** e.g., "w_recent:list" */
  segmentId: string
  segmentType: 'list'
  /** e.g., "Recent Workspaces" */
  listLabel: string
  badgesEnabled: boolean
  /** start is inclusive (0-based), end is exclusive (like Array.slice) */
  visibleItemRange: { start: number; end: number }
  items: SnapshotListItem[]
  /** Currently focused/highlighted item */
  focusItemId?: string
}

export interface SnapshotContextSegment {
  /** e.g., "w_recent:context" */
  segmentId: string
  segmentType: 'context'
  /** 1-2 line description */
  summary: string
  /** e.g., "list", "drawer" */
  currentView: string
  /** Currently focused text */
  focusText?: string
}

export type SnapshotSegment = SnapshotListSegment | SnapshotContextSegment

export interface WidgetSnapshot {
  /** Schema version — registry rejects unrecognized versions */
  _version: 1
  /** Unique widget key (e.g., "w_recent") */
  widgetId: string
  /** Human-readable (e.g., "Recent") */
  title: string
  isVisible: boolean
  segments: SnapshotSegment[]
  /** Date.now() when registered */
  registeredAt: number
}

// ============================================================================
// Validation Constants
// ============================================================================

const MAX_STRING_LENGTH = 120
const MAX_SUMMARY_LENGTH = 200
const MAX_LIST_ITEMS = 20
const MAX_SEGMENTS = 10
const MAX_ACTIONS = 10

// ============================================================================
// Store (In-Memory Map)
// ============================================================================

const widgetSnapshots = new Map<string, WidgetSnapshot>()
let activeWidgetId: string | null = null

// ============================================================================
// Validation Helpers
// ============================================================================

function truncateString(str: string, maxLength: number): string {
  return str.length > maxLength ? str.slice(0, maxLength) : str
}

function validateListItem(item: unknown): SnapshotListItem | null {
  if (!item || typeof item !== 'object') return null
  const data = item as Record<string, unknown>

  if (typeof data.itemId !== 'string' || !data.itemId) return null
  if (typeof data.label !== 'string' || !data.label) return null
  if (!Array.isArray(data.actions) || data.actions.length === 0) return null

  const actions = data.actions
    .slice(0, MAX_ACTIONS)
    .filter((a): a is string => typeof a === 'string' && a.length > 0)
  if (actions.length === 0) return null

  return {
    itemId: data.itemId,
    label: truncateString(data.label, MAX_STRING_LENGTH),
    badge: typeof data.badge === 'string' ? data.badge.slice(0, 1) : undefined,
    badgeVisible: typeof data.badgeVisible === 'boolean' ? data.badgeVisible : undefined,
    actions,
  }
}

function validateSegment(segment: unknown): SnapshotSegment | null {
  if (!segment || typeof segment !== 'object') return null
  const data = segment as Record<string, unknown>

  if (typeof data.segmentId !== 'string' || !data.segmentId) return null

  if (data.segmentType === 'list') {
    if (typeof data.listLabel !== 'string') return null
    if (!Array.isArray(data.items)) return null

    const range = data.visibleItemRange as { start?: number; end?: number } | undefined
    const items: SnapshotListItem[] = []
    const seenIds = new Set<string>()

    for (const rawItem of (data.items as unknown[]).slice(0, MAX_LIST_ITEMS)) {
      const item = validateListItem(rawItem)
      if (item && !seenIds.has(item.itemId)) {
        seenIds.add(item.itemId)
        items.push(item)
      }
    }

    return {
      segmentId: data.segmentId,
      segmentType: 'list',
      listLabel: truncateString(data.listLabel, MAX_STRING_LENGTH),
      badgesEnabled: data.badgesEnabled === true,
      visibleItemRange: {
        start: typeof range?.start === 'number' ? range.start : 0,
        end: typeof range?.end === 'number' ? range.end : items.length,
      },
      items,
      focusItemId: typeof data.focusItemId === 'string' ? data.focusItemId : undefined,
    } satisfies SnapshotListSegment
  }

  if (data.segmentType === 'context') {
    if (typeof data.summary !== 'string') return null
    if (typeof data.currentView !== 'string') return null

    return {
      segmentId: data.segmentId,
      segmentType: 'context',
      summary: truncateString(data.summary, MAX_SUMMARY_LENGTH),
      currentView: truncateString(data.currentView, MAX_STRING_LENGTH),
      focusText: typeof data.focusText === 'string'
        ? truncateString(data.focusText, MAX_STRING_LENGTH)
        : undefined,
    } satisfies SnapshotContextSegment
  }

  // Unknown segment type — reject
  return null
}

function validateSnapshot(input: unknown): WidgetSnapshot | null {
  if (!input || typeof input !== 'object') return null
  const data = input as Record<string, unknown>

  // Required fields
  if (data._version !== 1) return null
  if (typeof data.widgetId !== 'string' || !data.widgetId) return null
  if (typeof data.title !== 'string' || !data.title) return null
  if (typeof data.isVisible !== 'boolean') return null
  if (!Array.isArray(data.segments)) return null
  if (typeof data.registeredAt !== 'number') return null

  // Validate segments
  const segments: SnapshotSegment[] = []
  for (const rawSegment of (data.segments as unknown[]).slice(0, MAX_SEGMENTS)) {
    const segment = validateSegment(rawSegment)
    if (segment) {
      segments.push(segment)
    }
  }

  return {
    _version: 1,
    widgetId: truncateString(data.widgetId, MAX_STRING_LENGTH),
    title: truncateString(data.title, MAX_STRING_LENGTH),
    isVisible: data.isVisible,
    segments,
    registeredAt: data.registeredAt as number,
  }
}

// ============================================================================
// Store API
// ============================================================================

/**
 * Register or update a widget snapshot.
 * Validates and stores. Overwrites previous registration for same widgetId.
 * Returns false if validation fails.
 */
export function registerWidgetSnapshot(snapshot: WidgetSnapshot): boolean {
  const validated = validateSnapshot(snapshot)
  if (!validated) {
    console.warn('[ui-snapshot-registry] Invalid snapshot rejected:', snapshot)
    return false
  }
  widgetSnapshots.set(validated.widgetId, validated)
  console.log('[ui-snapshot-registry] Registered:', validated.widgetId, {
    segments: validated.segments.length,
    items: validated.segments
      .filter(s => s.segmentType === 'list')
      .reduce((sum, s) => sum + (s as any).items.length, 0),
  })
  return true
}

/**
 * Remove widget snapshot on unmount/hide.
 */
export function unregisterWidgetSnapshot(widgetId: string): boolean {
  return widgetSnapshots.delete(widgetId)
}

/**
 * Get a single widget snapshot.
 */
export function getWidgetSnapshot(widgetId: string): WidgetSnapshot | null {
  return widgetSnapshots.get(widgetId) || null
}

/**
 * Get all visible widget snapshots.
 */
export function getAllVisibleSnapshots(): WidgetSnapshot[] {
  const result: WidgetSnapshot[] = []
  for (const snapshot of widgetSnapshots.values()) {
    if (snapshot.isVisible) {
      result.push(snapshot)
    }
  }
  return result
}

/**
 * Track which widget is currently focused/active (e.g., open drawer).
 */
export function setActiveWidgetId(id: string | null): void {
  activeWidgetId = id
}

export function getActiveWidgetId(): string | null {
  return activeWidgetId
}

// ============================================================================
// Debug / Testing Helpers (not required for core behavior)
// ============================================================================

export function clearAllSnapshots(): void {
  widgetSnapshots.clear()
  activeWidgetId = null
}

export function getSnapshotCount(): number {
  return widgetSnapshots.size
}

// Dev-only: expose registry on window for console inspection
if (typeof window !== 'undefined') {
  ;(window as any).__snapshotRegistry = {
    getAll: () => Array.from(widgetSnapshots.entries()),
    get: (id: string) => widgetSnapshots.get(id) ?? null,
    count: () => widgetSnapshots.size,
    activeWidgetId: () => activeWidgetId,
  }
}
