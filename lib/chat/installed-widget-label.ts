/**
 * Shared late-bound display label helper for installed widgets.
 *
 * Phase 1 of installed-widget-registry-and-alias-plan.md (T5) and prerequisite
 * for rename-proof-live-resolution-plan.md's Phase 1.
 *
 * CONTRACT (binding):
 * - Reads ONLY from the passed-in `installedWidgets` published contract.
 * - NO registry-backed fallback, NO `workspace_panels` reads, NO second
 *   authority path of any kind. That would violate the main plan's
 *   "one shared live object view" rule at installed-widget-registry-and-alias-plan.md:11.
 * - Returns `null` on missing input or unresolved panelId. Callers own their
 *   own fallback display logic; this helper never consults a second source.
 *
 * Phase 1 callers expected: clarifier pill builders, replay-message builders,
 * "Opening X..." message builders, and anywhere a stored panelTitle is
 * currently rendered directly. Phase 1 task T5 only introduces the helper;
 * switching existing call sites is scoped to rename-proof plan's Phase 1.
 */

import type { InstalledWidgetView } from '@/lib/chat/intent-prompt'

/**
 * Resolve the current live display label for a panel from the published
 * installed-widget contract.
 *
 * @param panelId  Stable panel identity. Must match `InstalledWidgetView.panelId`.
 * @param installedWidgets  The current installed-widget view from
 *   `uiContext.dashboard.installedWidgets` or `TurnSnapshotResult.installedWidgets`.
 *   Pass `undefined` when the caller does not have the contract in scope —
 *   the helper returns `null` and the caller chooses its own fallback.
 *
 * @returns The live title for the panel, or `null` if the panel is not
 *   present in the contract (deleted, missing, cross-workspace, or the
 *   contract itself is absent).
 */
export function resolveLiveLabel(
  panelId: string,
  installedWidgets: InstalledWidgetView[] | undefined,
): string | null {
  if (!panelId) return null
  if (!installedWidgets) return null
  const hit = installedWidgets.find((w) => w.panelId === panelId)
  if (!hit) return null
  if (!hit.title) return null
  return hit.title
}
