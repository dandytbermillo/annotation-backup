/**
 * UI Snapshot Builder (Layer 2)
 *
 * Per-turn assembler that reads the ui-snapshot-registry (Layer 1) and
 * produces OpenWidgetState[] for the grounding-set fallback at Tier 4.5.
 *
 * Pull model: called once per chat turn, no events or subscriptions.
 *
 * Reference: widget-registry-implementation-plan.md
 */

import type { ClarificationOption } from '@/lib/chat/chat-navigation-context'
import type { OpenWidgetState } from '@/lib/chat/grounding-set'
import type { InstalledWidgetView, InstalledWidgetFreshness, UIContext } from '@/lib/chat/intent-prompt'
import {
  getAllVisibleSnapshots,
  getActiveWidgetId,
  getWidgetSnapshot,
  getWidgetOpenState,
  getAllOpenPanelIds,
  getStateInfoActivePanelId,
  getInstalledWidgetRevision,
  type WidgetSnapshot,
  type SnapshotListSegment,
} from '@/lib/widgets/ui-snapshot-registry'
import { debugLog } from '@/lib/utils/debug-logger'
import { emitPhase1Counter } from '@/lib/chat/routing-log/phase1-counters'

/**
 * Per-panel runtime overlay entry composed per turn from existing registry getters.
 * Phase 1 of installed-widget-registry-and-alias-plan.md (T9).
 *
 * The overlay layer is distinct from the installed-widget registry — it answers
 * "what is currently visible/open/active/focused on this turn" whereas the
 * registry answers "what widget instances exist on the active workspace."
 * Both layers are captured in TurnSnapshotResult; resolvers read both.
 */
export interface OverlayEntry {
  isOpen: boolean
  isActive: boolean
  isFocused: boolean
  isPresentInVisibleWidgets: boolean
  openDrawerPanelId: string | null
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Fallback freshness threshold.
 * Not a fixed requirement — callers override via params.freshnessThresholdMs.
 */
export const DEFAULT_SNAPSHOT_FRESHNESS_MS = 60_000

/** Monotonically incrementing revision counter for snapshot identity */
let snapshotRevisionCounter = 0

// ============================================================================
// Main Builder
// ============================================================================

export interface TurnSnapshotResult {
  openWidgets: OpenWidgetState[]
  activeSnapshotWidgetId: string | null
  /** Stable snapshot identity for telemetry/debug (v1: not used by routing) */
  uiSnapshotId: string
  /** Monotonically incrementing revision counter per call */
  revisionId: number
  /** Timestamp when this snapshot was captured */
  capturedAtMs: number
  /** Whether any fresh visible widget has badge letters enabled */
  hasBadgeLetters: boolean

  // ============================================================================
  // Phase 1 (installed-widget-registry-and-alias-plan.md) — T6/T8/T9
  //
  // Copied from the uiContext passed to buildTurnSnapshot. Absent in turns
  // where uiContext has no dashboard or the installed catalog has not loaded.
  // Phase 1 is diagnostic/instrumentation only; these fields are not yet
  // consumed as routing authority. Phase 2 switches authority onto them.
  // ============================================================================

  /** Installed-widget view from uiContext.dashboard.installedWidgets. */
  installedWidgets?: InstalledWidgetView[]
  /** Freshness metadata carried on the published contract. */
  installedWidgetFreshness?: InstalledWidgetFreshness
  /**
   * True when the captured uiContext's freshness disagrees with the current
   * installed-widget-revision counter for its workspace, or when workspace
   * metadata is missing / internally inconsistent. T8 emits
   * `installed_widget_view_stale` for each true case but does NOT gate
   * execution in Phase 1.
   */
  installedWidgetViewStale: boolean
  /**
   * Per-panel runtime overlay composed per turn. Map keyed by panelId.
   * Covers every installed widget plus any open panel not in the installed
   * set (state-info materialization invariant preserved from
   * state-info-resolvers.ts:177-194).
   */
  overlay: Map<string, OverlayEntry>
}

/**
 * Build the per-turn snapshot for Tier 4.5 grounding.
 *
 * 1. Reads all visible snapshots from the registry.
 * 2. Filters by freshness (now - registeredAt < freshnessThresholdMs).
 * 3. Extracts list segments, maps items → ClarificationOption[].
 * 4. Builds OpenWidgetState per widget.
 */
export function buildTurnSnapshot(params?: {
  now?: number
  freshnessThresholdMs?: number
  /**
   * Phase 1 (T7): the UIContext published by DashboardView.
   * When present, buildTurnSnapshot copies `installedWidgets` and
   * `installedWidgetFreshness` onto the result and runs the T8
   * workspace-scoped staleness check. When absent, the new fields
   * stay undefined and `installedWidgetViewStale` defaults to false.
   */
  uiContext?: UIContext
}): TurnSnapshotResult {
  const now = params?.now ?? Date.now()
  const freshnessMs = params?.freshnessThresholdMs ?? DEFAULT_SNAPSHOT_FRESHNESS_MS
  const uiContext = params?.uiContext

  const allVisible = getAllVisibleSnapshots()
  const openWidgets: OpenWidgetState[] = []
  let hasBadgeLetters = false

  for (const snapshot of allVisible) {
    // Freshness guard: skip stale snapshots
    if (now - snapshot.registeredAt >= freshnessMs) {
      continue
    }

    // Check for badge letters in any list segment
    for (const seg of snapshot.segments) {
      if (seg.segmentType === 'list' && (seg as SnapshotListSegment).badgesEnabled) {
        hasBadgeLetters = true
        break
      }
    }

    // Extract list items from all list segments
    const options = extractListOptions(snapshot)
    if (options.length === 0) {
      continue // No list items → not useful for grounding selection
    }

    // Count list segments for Rule 12 segment-level ambiguity detection
    const listSegmentCount = snapshot.segments.filter(s => s.segmentType === 'list').length

    openWidgets.push({
      id: snapshot.widgetId,
      label: snapshot.title,
      options,
      listSegmentCount,
      panelId: snapshot.panelId,
    })
  }

  snapshotRevisionCounter++
  const uiSnapshotId = `snap_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`

  // Resolve activeWidgetId (may be panel UUID) → widget slug
  const rawActiveId = getActiveWidgetId()
  let resolvedActiveWidgetId: string | null = null
  if (rawActiveId) {
    // Try direct match (widgetId === rawActiveId)
    const directMatch = allVisible.find(s => s.widgetId === rawActiveId)
    if (directMatch) {
      resolvedActiveWidgetId = directMatch.widgetId
    } else {
      // Try panelId match (dashboard stores panel UUID as active)
      const panelMatch = allVisible.find(s => s.panelId === rawActiveId)
      if (panelMatch) {
        resolvedActiveWidgetId = panelMatch.widgetId
      }
    }
  }

  // Phase 1 T6: Copy installed-widget contract from uiContext.
  const installedWidgets = uiContext?.dashboard?.installedWidgets
  const installedWidgetFreshness = uiContext?.dashboard?.installedWidgetFreshness

  // Phase 1 T15 dev-only assertion: both-or-neither invariant. The published
  // contract pairs `installedWidgets` with `installedWidgetFreshness`; one
  // without the other indicates a publisher bug. Silent in production.
  if (process.env.NODE_ENV !== 'production') {
    const hasWidgets = installedWidgets !== undefined
    const hasFreshness = installedWidgetFreshness !== undefined
    if (hasWidgets !== hasFreshness) {
      emitPhase1Counter('installed_widget_contract_mismatch', { hasWidgets, hasFreshness })
    }
  }

  // Phase 1 T8: workspace-scoped staleness check. Four conditions, each
  // emitted as a telemetry dimension for downstream analysis. Phase 1 is
  // diagnostic-only — this flag does NOT gate execution or clarifier
  // behavior; Phase 2 switches authority onto it.
  const uiWorkspaceId = uiContext?.dashboard?.workspaceId
  const freshnessWorkspace = installedWidgetFreshness?.workspaceId
  const publishedRevision = installedWidgetFreshness?.revisionId
  const currentRevision = uiWorkspaceId ? getInstalledWidgetRevision(uiWorkspaceId) : null

  let installedWidgetViewStale = false
  let staleReason: 'no_workspace' | 'no_freshness' | 'internal_workspace_mismatch' | 'revision_mismatch' | null = null

  if (uiContext?.dashboard) {
    if (!uiWorkspaceId) {
      installedWidgetViewStale = true
      staleReason = 'no_workspace'
    } else if (!freshnessWorkspace) {
      installedWidgetViewStale = true
      staleReason = 'no_freshness'
    } else if (freshnessWorkspace !== uiWorkspaceId) {
      installedWidgetViewStale = true
      staleReason = 'internal_workspace_mismatch'
    } else if (currentRevision !== publishedRevision) {
      installedWidgetViewStale = true
      staleReason = 'revision_mismatch'
    }
  }

  if (installedWidgetViewStale) {
    emitPhase1Counter('installed_widget_view_stale', {
      reason: staleReason,
      uiWorkspaceId,
      freshnessWorkspace,
      publishedRevision,
      currentRevision,
    })
  }

  // Phase 1 T9: runtime overlay composition. One entry per installed widget,
  // plus any open-registry panel not in the installed set (preserves the
  // state-info materialization invariant at state-info-resolvers.ts:177-194).
  // The overlay is a distinct truth layer from the installed catalog — it
  // answers "what is currently visible/open/active" per turn, not identity.
  const overlay = new Map<string, OverlayEntry>()
  const activeWidgetId = getActiveWidgetId()
  const focusedPanelId = uiContext?.dashboard?.focusedPanelId ?? null
  const openDrawerPanelId = uiContext?.dashboard?.openDrawer?.panelId ?? null
  const visibleIds = new Set<string>((uiContext?.dashboard?.visibleWidgets ?? []).map((w) => w.id))

  const installedIds = new Set<string>()
  if (installedWidgets) {
    for (const iw of installedWidgets) {
      installedIds.add(iw.panelId)
      overlay.set(iw.panelId, {
        isOpen: getWidgetOpenState(iw.panelId),
        isActive: activeWidgetId === iw.panelId,
        isFocused: focusedPanelId === iw.panelId,
        isPresentInVisibleWidgets: visibleIds.has(iw.panelId),
        openDrawerPanelId,
      })
    }
  }

  // Materialize open panels that are not in installedWidgets. Mirrors the
  // materialization invariant so state-info can answer "is <open-but-not-
  // installed> open?" truthfully.
  for (const openId of getAllOpenPanelIds()) {
    if (installedIds.has(openId)) continue
    overlay.set(openId, {
      isOpen: true,
      isActive: activeWidgetId === openId,
      isFocused: focusedPanelId === openId,
      isPresentInVisibleWidgets: visibleIds.has(openId),
      openDrawerPanelId,
    })
  }

  // Also cover the separate stateInfoActivePanelId if distinct from both sets.
  const siActiveId = getStateInfoActivePanelId()
  if (siActiveId && !overlay.has(siActiveId)) {
    overlay.set(siActiveId, {
      isOpen: getWidgetOpenState(siActiveId),
      isActive: true,
      isFocused: focusedPanelId === siActiveId,
      isPresentInVisibleWidgets: visibleIds.has(siActiveId),
      openDrawerPanelId,
    })
  }

  return {
    openWidgets,
    activeSnapshotWidgetId: resolvedActiveWidgetId,
    uiSnapshotId,
    revisionId: snapshotRevisionCounter,
    capturedAtMs: now,
    hasBadgeLetters,
    installedWidgets,
    installedWidgetFreshness,
    installedWidgetViewStale,
    overlay,
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract all list items from a snapshot's list segments as ClarificationOption[].
 */
function extractListOptions(snapshot: WidgetSnapshot): ClarificationOption[] {
  const options: ClarificationOption[] = []

  for (const segment of snapshot.segments) {
    if (segment.segmentType !== 'list') continue
    const listSeg = segment as SnapshotListSegment

    for (const item of listSeg.items) {
      options.push({
        id: item.itemId,
        label: item.label,
        type: 'widget_option',
      })
    }
  }

  return options
}

/**
 * Get list items for a specific widget (and optionally a specific segment).
 * Useful for post-match lookups.
 */
export function getWidgetListItems(
  widgetId: string,
  segmentId?: string,
): ClarificationOption[] {
  const snapshot = getWidgetSnapshot(widgetId)
  if (!snapshot) return []

  const options: ClarificationOption[] = []

  for (const segment of snapshot.segments) {
    if (segment.segmentType !== 'list') continue
    if (segmentId && segment.segmentId !== segmentId) continue

    const listSeg = segment as SnapshotListSegment
    for (const item of listSeg.items) {
      options.push({
        id: item.itemId,
        label: item.label,
        type: 'widget_option',
      })
    }
  }

  return options
}
