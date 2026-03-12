/**
 * Stage 6: Agent Tool Loop — Action Validators (Slice 6.4)
 *
 * Validates action tool requests before producing an S6ActionResult.
 * Each validator checks whether the action *could* be executed given
 * the available state, and returns executed or rejected + reason.
 *
 * Freshness model:
 *   - Server-side (validateNavigateEntry): truly fresh — queries DB at validation time.
 *   - Client-side (validateOpenPanel, validateOpenWidgetItem): validates against
 *     pre-computed clientSnapshots from loop entry. Stale-by-design relative to
 *     validation time. True commit-time revalidation deferred to 6.5 enforcement.
 *
 * Visibility rule:
 *   target_not_visible means "item not present in the widget's snapshot item list"
 *   — NOT "not scrolled into viewport." Off-screen items are valid targets.
 *
 * Design note: stage6-agent-tool-loop-design.md §7a
 */

import type {
  S6ActionResult,
  S6ActionRejectionReason,
  S6InspectDashboardResponse,
  S6InspectVisibleItemsResponse,
} from './stage6-tool-contracts'

// ============================================================================
// Types
// ============================================================================

/** Client-side snapshots available to validators (from loop entry). */
export interface ActionValidationSnapshots {
  dashboard: S6InspectDashboardResponse
  visibleItems: S6InspectVisibleItemsResponse
}

// ============================================================================
// §1 validateOpenPanel
// ============================================================================

/**
 * Validate an open_panel action.
 * Checks: panel slug resolves to a registered panel in the dashboard snapshot.
 */
export function validateOpenPanel(
  panelSlug: string,
  snapshots: ActionValidationSnapshots,
): S6ActionResult {
  if (!panelSlug) {
    return reject('open_panel', 'panel_not_registered')
  }

  if (snapshots.dashboard.status !== 'ok') {
    return reject('open_panel', 'panel_not_registered')
  }

  const widgets = snapshots.dashboard.data.widgets
  const slugLower = panelSlug.toLowerCase()

  // Match by widgetId (slug-based) or panelId
  const found = widgets.some(
    w => w.widgetId.toLowerCase() === slugLower
      || w.panelId.toLowerCase() === slugLower
      || w.label.toLowerCase().replace(/\s+/g, '-') === slugLower,
  )

  if (!found) {
    return reject('open_panel', 'panel_not_registered')
  }

  return executed('open_panel')
}

// ============================================================================
// §2 validateOpenWidgetItem
// ============================================================================

/**
 * Validate an open_widget_item action.
 * Checks:
 *   1. Widget exists in dashboard snapshot → widget_not_open
 *   2. Item exists in widget's snapshot item list → target_not_found
 *
 * Does NOT produce target_not_visible — in 6.4's freshness model
 * (pre-computed snapshots), there is no way to distinguish "item exists
 * but isn't in snapshot" from "item doesn't exist." Both map to
 * target_not_found. target_not_visible deferred to 6.5 enforcement.
 */
export function validateOpenWidgetItem(
  widgetId: string,
  itemId: string,
  snapshots: ActionValidationSnapshots,
): S6ActionResult {
  if (!widgetId || !itemId) {
    return reject('open_widget_item', 'target_not_found')
  }

  // Check widget exists in dashboard
  if (snapshots.dashboard.status !== 'ok') {
    return reject('open_widget_item', 'widget_not_open')
  }

  const widgetExists = snapshots.dashboard.data.widgets.some(
    w => w.widgetId === widgetId,
  )

  if (!widgetExists) {
    return reject('open_widget_item', 'widget_not_open')
  }

  // Check item exists in visible items snapshot (any widget's item list)
  if (snapshots.visibleItems.status !== 'ok') {
    return reject('open_widget_item', 'target_not_found')
  }

  const itemExists = snapshots.visibleItems.data.items.some(
    item => item.id === itemId && item.widgetId === widgetId,
  )

  if (!itemExists) {
    return reject('open_widget_item', 'target_not_found')
  }

  return executed('open_widget_item')
}

// ============================================================================
// §3 validateNavigateEntry
// ============================================================================

/** Database query function — injected to keep validators testable. */
export type EntryExistsQuery = (
  entryId: string,
  userId: string,
) => Promise<{ exists: boolean; belongsToUser: boolean }>

/**
 * Validate a navigate_entry action.
 * Checks:
 *   1. Entry exists in DB (items table, deleted_at IS NULL) → entry_not_found
 *   2. Entry belongs to user's workspace → permission_denied
 *
 * This is the only truly fresh validation — queries DB at validation time.
 */
export async function validateNavigateEntry(
  entryId: string,
  userId: string,
  queryEntryExists: EntryExistsQuery,
): Promise<S6ActionResult> {
  if (!entryId) {
    return reject('navigate_entry', 'entry_not_found')
  }

  const result = await queryEntryExists(entryId, userId)

  if (!result.exists) {
    return reject('navigate_entry', 'entry_not_found')
  }

  if (!result.belongsToUser) {
    return reject('navigate_entry', 'permission_denied')
  }

  return executed('navigate_entry')
}

// ============================================================================
// Helpers
// ============================================================================

function executed(action: S6ActionResult['action']): S6ActionResult {
  return { action, status: 'executed' }
}

function reject(
  action: S6ActionResult['action'],
  reason: S6ActionRejectionReason,
): S6ActionResult {
  return { action, status: 'rejected', rejectionReason: reason }
}
