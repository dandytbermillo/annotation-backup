/**
 * Stage 6: Execution Bridge (Slice 6.5, Phase 1)
 *
 * Maps validated S6ActionResult to existing UI execution mechanisms.
 * Phase 1: open_panel only. Other actions return not_enforced.
 *
 * Commit-point revalidation: before executing, re-reads fresh client
 * state and re-validates. If stale → returns toctou_stale.
 *
 * Design note: stage6-agent-tool-loop-design.md §7c
 */

import { handleInspect } from './stage6-inspect-handlers'
import { validateOpenPanel } from './stage6-action-validators'
import type { S6ActionResult } from './stage6-tool-contracts'
import type { S6InspectDashboardResponse, S6InspectVisibleItemsResponse } from './stage6-tool-contracts'
import type { ActionValidationSnapshots } from './stage6-action-validators'

// ============================================================================
// Types
// ============================================================================

export interface S6ExecutionBridgeResult {
  executed: boolean
  reason?: 'not_enforced' | 'not_open_panel' | 'validation_rejected' | 'toctou_stale' | 'bridge_error'
  /** Panel slug that was opened (for UI message) */
  panelSlug?: string
  /** Resolved panel label (for UI message) */
  panelLabel?: string
}

/** Parsed action from the LLM response */
export interface S6ParsedAction {
  action: string
  panelSlug?: string
  widgetId?: string
  itemId?: string
  entryId?: string
  reason?: string
}

/**
 * Duplicate action signature.
 * Used to prevent double-execution within the same interaction.
 */
export interface S6ActionSignature {
  interactionId: string
  actionType: string
  targetId: string
}

// ============================================================================
// Execution Bridge
// ============================================================================

/**
 * Execute a validated Stage 6 action via existing UI mechanisms.
 *
 * Phase 1: open_panel only.
 *   1. Check action is open_panel with status=executed
 *   2. Commit-point TOCTOU revalidation (fresh dashboard read)
 *   3. Dispatch open-panel-drawer event
 *
 * Returns { executed: true } on success, { executed: false, reason } on failure.
 */
export async function executeS6OpenPanel(
  actionResult: S6ActionResult,
  parsedAction: S6ParsedAction,
  openPanelDrawer: (panelId: string, panelTitle?: string) => void,
): Promise<S6ExecutionBridgeResult> {
  // Guard: only open_panel in Phase 1
  if (actionResult.action !== 'open_panel') {
    return { executed: false, reason: 'not_open_panel' }
  }

  if (actionResult.status !== 'executed') {
    return { executed: false, reason: 'validation_rejected' }
  }

  const panelSlug = parsedAction.panelSlug
  if (!panelSlug) {
    return { executed: false, reason: 'bridge_error' }
  }

  // Commit-point TOCTOU revalidation: fresh dashboard read
  try {
    const freshDashboard = await handleInspect({ tool: 'inspect_dashboard' })

    const freshSnapshots: ActionValidationSnapshots = {
      dashboard: freshDashboard as S6InspectDashboardResponse,
      visibleItems: { tool: 'inspect_visible_items', status: 'ok', data: { items: [], totalCount: 0, capturedAtMs: Date.now() } } as S6InspectVisibleItemsResponse,
    }

    const revalidation = validateOpenPanel(panelSlug, freshSnapshots)

    if (revalidation.status !== 'executed') {
      return { executed: false, reason: 'toctou_stale' }
    }

    // Resolve panel label from fresh dashboard for UI message
    let panelLabel = panelSlug
    if (freshDashboard.status === 'ok' && freshDashboard.tool === 'inspect_dashboard') {
      const slugLower = panelSlug.toLowerCase()
      const widget = (freshDashboard as S6InspectDashboardResponse).data.widgets.find(
        w => w.widgetId.toLowerCase() === slugLower
          || w.panelId.toLowerCase() === slugLower
          || w.label.toLowerCase().replace(/\s+/g, '-') === slugLower,
      )
      if (widget) panelLabel = widget.label
    }

    // Execute via existing mechanism
    openPanelDrawer(panelSlug, panelLabel)

    return { executed: true, panelSlug, panelLabel }
  } catch {
    return { executed: false, reason: 'bridge_error' }
  }
}

/**
 * Check if an action has already been executed in this interaction.
 * Used to prevent duplicate execution between S6 and main routing.
 */
export function isDuplicateAction(
  signature: S6ActionSignature,
  executedActions: S6ActionSignature[],
): boolean {
  return executedActions.some(
    a => a.interactionId === signature.interactionId
      && a.actionType === signature.actionType
      && a.targetId === signature.targetId,
  )
}
