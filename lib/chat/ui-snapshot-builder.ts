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
import {
  getAllVisibleSnapshots,
  getActiveWidgetId,
  getWidgetSnapshot,
  type WidgetSnapshot,
  type SnapshotListSegment,
} from '@/lib/widgets/ui-snapshot-registry'

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
}): TurnSnapshotResult {
  const now = params?.now ?? Date.now()
  const freshnessMs = params?.freshnessThresholdMs ?? DEFAULT_SNAPSHOT_FRESHNESS_MS

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

    openWidgets.push({
      id: snapshot.widgetId,
      label: snapshot.title,
      options,
    })
  }

  snapshotRevisionCounter++
  const uiSnapshotId = `snap_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`

  return {
    openWidgets,
    activeSnapshotWidgetId: getActiveWidgetId(),
    uiSnapshotId,
    revisionId: snapshotRevisionCounter,
    capturedAtMs: now,
    hasBadgeLetters,
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
