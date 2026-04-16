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
  /** Optional semantic description for context routing (e.g., "Latest sprint workspace") */
  description?: string
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
  /** Total item count in the full dataset (may exceed items.length if paginated) */
  totalCount?: number
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
  /** Dashboard panel UUID — used to resolve activeWidgetId (UUID) → widgetId (slug) */
  panelId?: string
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
// Step 10a: Separate isOpen lifecycle store (keyed by panelId)
// This is the authoritative source for widget open/close state.
// It is separate from widgetSnapshots to prevent heartbeat re-registration from clobbering lifecycle state.
// ============================================================================

const widgetOpenState = new Map<string, boolean>()
let stateInfoActivePanelId: string | null = null

// ============================================================================
// Phase 1 (installed-widget-registry-and-alias-plan.md): workspace-keyed
// revision counter. Bumped atomically with each call to updateInstalledPanels
// (single-owner rule, T3). Read by DashboardView's buildDashboardUiContext
// and by buildTurnSnapshot's T8 staleness check.
//
// PROVISIONAL SCOPE (Phase 1):
// - Local-tab only — does not detect cross-tab or external-process mutations.
// - Cross-tab / external staleness is caught by Phase 2's execution-time
//   DB revalidation, not by this token.
// - Non-global: keyed by workspaceId so workspace switches within a tab
//   do not produce false staleness telemetry.
// ============================================================================

const installedWidgetRevisions = new Map<string, number>()

export function bumpInstalledWidgetRevision(workspaceId: string): number {
  if (!workspaceId) return 0
  const next = (installedWidgetRevisions.get(workspaceId) ?? 0) + 1
  installedWidgetRevisions.set(workspaceId, next)
  return next
}

export function getInstalledWidgetRevision(workspaceId: string): number {
  if (!workspaceId) return 0
  return installedWidgetRevisions.get(workspaceId) ?? 0
}

/**
 * Reset the revision counter for a workspace. Intended for test isolation.
 * Do not call in production code — the counter is monotonic by design.
 */
export function _resetInstalledWidgetRevisionForTests(workspaceId?: string): void {
  if (workspaceId) {
    installedWidgetRevisions.delete(workspaceId)
  } else {
    installedWidgetRevisions.clear()
  }
}

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
    description: typeof data.description === 'string'
      ? truncateString(data.description, MAX_SUMMARY_LENGTH)
      : undefined,
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
      totalCount: typeof data.totalCount === 'number' ? data.totalCount : undefined,
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
    panelId: typeof data.panelId === 'string' ? data.panelId : undefined,
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
 *
 * Step 10a: This MUST NOT touch widgetOpenState or stateInfoActivePanelId.
 * Snapshot lifecycle (mount/unmount/heartbeat) is independent of open-state lifecycle.
 *
 * A single panel may register multiple snapshots (e.g., the dashboard tile
 * RecentWidget = "w_recent_widget" and the drawer RecentPanel = "w_recent" both share
 * panel.id). When the drawer's snapshot unmounts because the user opened a different
 * drawer, the user has NOT closed the original panel — its open state must persist.
 *
 * Open state is owned exclusively by setWidgetOpen() / setStateInfoActivePanelId(),
 * which DashboardView.tsx calls from explicit drawer open/close handlers and from
 * panel hide/delete actions. clearAllSnapshots() handles full session reset.
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
// Step 10a: Widget Open State API (authoritative lifecycle registry)
// ============================================================================

/**
 * Set a widget's open state by panelId.
 * No exclusivity: opening B does NOT close A. Widgets stay open until explicitly closed.
 */
export function setWidgetOpen(panelId: string, isOpen: boolean): void {
  widgetOpenState.set(panelId, isOpen)
}

/**
 * Get whether a widget is currently open by panelId.
 * Defaults to false if not in the registry.
 */
export function getWidgetOpenState(panelId: string): boolean {
  return widgetOpenState.get(panelId) ?? false
}

/**
 * Get all currently open panelIds.
 */
export function getAllOpenPanelIds(): string[] {
  const result: string[] = []
  for (const [panelId, isOpen] of widgetOpenState) {
    if (isOpen) result.push(panelId)
  }
  return result
}

/**
 * Set the currently active/focused drawer panel.
 * Singular — at most one panel is active at a time.
 * This is separate from open state: active means "currently focused drawer",
 * open means "opened and not yet closed".
 */
export function setStateInfoActivePanelId(panelId: string | null): void {
  stateInfoActivePanelId = panelId
}

/**
 * Get the currently active/focused drawer panel, or null.
 */
export function getStateInfoActivePanelId(): string | null {
  return stateInfoActivePanelId
}

/** @deprecated Use getStateInfoActivePanelId() for state-info. Kept for backward compatibility. */
export function getOpenPanelId(): string | null {
  return stateInfoActivePanelId
}

// ============================================================================
// Debug / Testing Helpers (not required for core behavior)
// ============================================================================

export function clearAllSnapshots(): void {
  widgetSnapshots.clear()
  activeWidgetId = null
  widgetOpenState.clear()
  stateInfoActivePanelId = null
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
