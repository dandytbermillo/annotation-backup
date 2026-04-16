/**
 * Phase 1 Counter Emitter
 *
 * Single typed surface for Phase 1 diagnostic counters from
 * installed-widget-registry-and-alias-plan.md.
 *
 * ---
 * Transport decision (deferred from plan wording):
 *
 * The plan's T12 wording asks for counters "wired into the existing routing-log
 * writer path." On inspection, `RoutingLogPayload` (lib/chat/routing-log/payload.ts)
 * and the durable log table `chat_routing_durable_log` are fundamentally per-chat-turn —
 * every row requires `raw_query_text`, `context_snapshot`, `interaction_id`,
 * `routing_lane`, `decision_source`, and other turn-scoped fields that do not exist
 * for Phase 1 counter events.
 *
 * Half of the Phase 1 counter events are NOT chat-turn events:
 *   - `installed_widget_view_stale_fetch_discarded` fires from dashboard fetches
 *     (mount, workspace switch, refresh), with no routing turn in scope.
 *   - `installed_widget_contract_mismatch` fires from a dev-only integrity assertion.
 *
 * Forcing these into the turn-shaped durable log would either require:
 *   (a) synthetic placeholder `interaction_id` / `raw_query_text` values (pollutes the
 *       durable table and breaks downstream consumers that assume per-turn semantics), or
 *   (b) buffering until the next real routing log (introduces subscription/flush complexity
 *       and delays fetch-discard signals indefinitely if the user never chats).
 *
 * Both violate the anti-pattern guidance against coupling unrelated semantics for the sake
 * of satisfying the letter of a plan. Phase 1 therefore:
 *
 *   1. Establishes a single typed counter emitter (`emitPhase1Counter`) with the six
 *      counter names the plan defines.
 *   2. Routes all call sites through this function.
 *   3. Backs the transport with `debugLog` for Phase 1. Durable storage for these
 *      counters is deferred — Phase 2 can migrate the transport in one file without
 *      touching any call site.
 *
 * This is an explicit, documented deviation from the plan's literal T12 wording.
 * Plan file updated at:
 *   docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/installed-widget-registry-and-alias-plan.md
 * ---
 */

import { debugLog } from '@/lib/utils/debug-logger'

/**
 * The six counter names defined by Phase 1 of installed-widget-registry-and-alias-plan.md.
 * Additional Phase 1 diagnostic events (`installed_widget_resolution_mismatch`,
 * `installed_widget_contract_mismatch`) are included here for single-surface routing.
 */
export type Phase1CounterName =
  // Emitted (active):
  | 'installed_widget_view_stale'
  | 'installed_widget_view_stale_fetch_discarded'
  | 'hardcoded_widget_authority_read'
  | 'installed_widget_resolution_mismatch'
  | 'installed_widget_contract_mismatch'
  // Phase 1.6 Fix 1 (write-side poison guard):
  | 'memory_write_rejected_state_info_open_panel'
  // Phase 1.6 Fix 1b (retrieval-side veto):
  | 'memory_retrieval_vetoed_state_info_open_panel'
  // Phase 1.6 Fix 4 (exact-target dominance for T17 single-instance matches):
  | 'memory_state_info_exact_target_dominance'
  // Fix 6 (exact-instance dominance for open_panel preseeds):
  | 'memory_open_panel_exact_instance_dominance'
  // Stubs (no consumer in Phase 1; Phase 2 consumers will wire these):
  | 'installed_widget_lookup_zero_result'
  | 'live_resolution_gate_dropped_candidate'
  | 'execution_time_revalidation_failed'

export interface Phase1CounterDimensions {
  [key: string]: unknown
}

/**
 * Emit a Phase 1 counter event.
 *
 * Phase 1 transport: `debugLog`. All call sites go through this function so the
 * transport can be migrated in a single file when durable storage for non-turn
 * counter events becomes available.
 */
export function emitPhase1Counter(
  name: Phase1CounterName,
  dimensions?: Phase1CounterDimensions,
): void {
  void debugLog({
    component: 'Phase1Counter',
    action: name,
    metadata: dimensions ?? {},
  })
}
