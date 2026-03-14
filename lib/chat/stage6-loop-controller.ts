/**
 * Stage 6: Agent Tool Loop — Client Controller (Slices 6.3 + 6.5)
 *
 * Client-side orchestrator that:
 *   1. Pre-computes client snapshots (dashboard, active widget, visible items)
 *   2. Calls the server-side loop route (/api/chat/stage6-loop)
 *   3. Returns the S6LoopResult (or null on failure)
 *   4. Writes durable telemetry via recordRoutingLog (execution_outcome row)
 *
 * Two modes:
 *   - Shadow (6.3): fire-and-forget. Logs what it would have done.
 *   - Enforcement (6.5): awaitable. Returns result to dispatcher for execution.
 *
 * Feature flags:
 *   - NEXT_PUBLIC_STAGE6_SHADOW_ENABLED — shadow mode
 *   - NEXT_PUBLIC_STAGE6_ENFORCE_ENABLED — enforcement mode (takes priority)
 *
 * Design note: stage6-agent-tool-loop-design.md §7c
 */

import { handleInspect } from './stage6-inspect-handlers'
import { debugLog } from '@/lib/utils/debug-logger'
import { recordRoutingLog } from '@/lib/chat/routing-log/writer'
import type { RoutingLogPayload } from '@/lib/chat/routing-log/payload'
import { buildContextSnapshot } from '@/lib/chat/routing-log/context-snapshot'
import type {
  S6LoopInput,
  S6LoopResult,
  S6EscalationReason,
  S6GroundingCandidate,
  S6ContentContext,
  S6DashboardSnapshot,
  S6InspectDashboardResponse,
} from './stage6-tool-contracts'
import { S6_LOOP_LIMITS } from './stage6-tool-contracts'

// ============================================================================
// Public API
// ============================================================================

export interface S6ShadowLoopParams {
  userInput: string
  groundingCandidates: S6GroundingCandidate[]
  escalationReason: S6EscalationReason
  /** Correlation: same interaction_id as the routing attempt that triggered S6 */
  interactionId: string
  /** Correlation: session ID for durable log row */
  sessionId: string
  /** Turn index for durable log row */
  turnIndex: number
  /** Content-intent context (6x.3). Present only when escalationReason is 'content_intent'. */
  contentContext?: S6ContentContext
}

/**
 * Fire-and-forget shadow loop.
 * Called by the dispatcher when Stage 4 abstains/times out.
 * Logs the result but never executes the action.
 * Writes durable telemetry for shadow evaluation.
 */
export async function runS6ShadowLoop(
  params: S6ShadowLoopParams,
): Promise<void> {
  // Client-only guard
  if (typeof window === 'undefined') return
  if (process.env.NEXT_PUBLIC_STAGE6_SHADOW_ENABLED !== 'true') return

  try {
    const result = await executeS6Loop(params)
    if (result) {
      void debugLog({
        component: 'Stage6Shadow',
        action: 's6_shadow_loop_complete',
        metadata: {
          outcome: result.outcome,
          inspectRounds: result.inspectRoundsUsed,
          durationMs: result.durationMs,
          toolTrace: result.telemetry.s6_tool_trace,
          actionType: result.telemetry.s6_action_type,
          actionTargetId: result.telemetry.s6_action_target_id,
          clarifyCandidateCount: result.telemetry.s6_clarify_candidate_count,
          abortReason: result.telemetry.s6_abort_reason,
        },
      })

      // Durable telemetry: write execution_outcome row correlatable via interaction_id
      void writeDurableShadowLog(params, result)
    }
  } catch {
    // Shadow mode: swallow all errors silently
  }
}

/**
 * Awaitable enforcement loop (Slice 6.5).
 * Called by the dispatcher when Stage 4 abstains/times out AND enforcement is enabled.
 * Returns the S6LoopResult so the dispatcher can execute the action or fall back.
 * Also writes durable telemetry (same as shadow, but with enforcement provenance).
 */
export async function runS6EnforcementLoop(
  params: S6ShadowLoopParams,
): Promise<S6LoopResult | null> {
  // Client-only guard
  if (typeof window === 'undefined') return null
  if (process.env.NEXT_PUBLIC_STAGE6_ENFORCE_ENABLED !== 'true') return null

  try {
    const result = await executeS6Loop(params)
    if (result) {
      void debugLog({
        component: 'Stage6Enforce',
        action: 's6_enforcement_loop_complete',
        metadata: {
          outcome: result.outcome,
          inspectRounds: result.inspectRoundsUsed,
          durationMs: result.durationMs,
          toolTrace: result.telemetry.s6_tool_trace,
          actionType: result.telemetry.s6_action_type,
          actionTargetId: result.telemetry.s6_action_target_id,
        },
      })

      // Durable telemetry: write enforcement row (no :s6 suffix — this is primary execution)
      void writeDurableEnforcementLog(params, result)
    }
    return result
  } catch {
    return null
  }
}

// ============================================================================
// Internal
// ============================================================================

async function executeS6Loop(
  params: S6ShadowLoopParams,
): Promise<S6LoopResult | null> {
  // Pre-compute client-side snapshots in parallel
  const [dashboardRes, activeWidgetRes, visibleItemsRes] = await Promise.all([
    handleInspect({ tool: 'inspect_dashboard' }),
    handleInspect({ tool: 'inspect_active_widget' }),
    handleInspect({ tool: 'inspect_visible_items' }),
  ])

  // Extract dashboard snapshot for loop input
  const dashboardSnapshot: S6DashboardSnapshot =
    dashboardRes.status === 'ok' && dashboardRes.tool === 'inspect_dashboard'
      ? (dashboardRes as S6InspectDashboardResponse).data
      : {
          dashboardId: 'unknown',
          dashboardName: 'Dashboard',
          widgets: [],
          widgetCount: 0,
          capturedAtMs: Date.now(),
        }

  const loopInput: S6LoopInput = {
    userInput: params.userInput,
    dashboardSnapshot,
    groundingCandidates: params.groundingCandidates,
    escalationReason: params.escalationReason,
    constraints: {
      maxInspectRounds: S6_LOOP_LIMITS.MAX_INSPECT_ROUNDS_DEFAULT,
      timeoutMs: S6_LOOP_LIMITS.TIMEOUT_MS_DEFAULT,
      clarificationAllowed: true,
    },
    contentContext: params.contentContext,
  }

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    S6_LOOP_LIMITS.TIMEOUT_MS_CEILING,
  )

  try {
    const res = await fetch('/api/chat/stage6-loop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loopInput,
        clientSnapshots: {
          dashboard: dashboardRes,
          activeWidget: activeWidgetRes,
          visibleItems: visibleItemsRes,
        },
      }),
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (!res.ok) return null
    return (await res.json()) as S6LoopResult
  } catch {
    clearTimeout(timer)
    return null
  }
}

/**
 * Write a durable execution_outcome row for the S6 shadow result.
 * Uses the same routing log pipeline (recordRoutingLog → /api/chat/routing-log).
 * Correlatable with the original routing attempt via interaction_id prefix
 * (suffix ':s6' avoids unique constraint conflict with fireOutcomeLog rows).
 * Fail-open: errors are caught and swallowed.
 */
async function writeDurableShadowLog(
  params: S6ShadowLoopParams,
  result: S6LoopResult,
): Promise<void> {
  try {
    const outcomeStatus = result.outcome === 'action_executed' ? 'executed' : 'failed'

    const payload: RoutingLogPayload = {
      raw_query_text: params.userInput,
      context_snapshot: buildContextSnapshot({
        openWidgetCount: 0,
        pendingOptionsCount: 0,
        activeOptionSetId: null,
        hasLastClarification: false,
        hasLastSuggestion: false,
        latchEnabled: false,
        messageCount: 0,
      }),
      session_id: params.sessionId,
      interaction_id: `${params.interactionId}:s6`,
      turn_index: params.turnIndex,
      routing_lane: 'D',
      decision_source: 'llm',
      risk_tier: 'low',
      provenance: `s6_shadow:${result.outcome}`,
      result_status: outcomeStatus,
      tier_label: 's6_shadow',
      handled_by_tier: 6,
      log_phase: 'execution_outcome',

      // Stage 6 telemetry fields
      s6_loop_entered: true,
      s6_escalation_reason: params.escalationReason,
      s6_inspect_rounds: result.inspectRoundsUsed,
      s6_outcome: result.outcome,
      s6_duration_ms: result.durationMs,
      s6_tool_trace: result.telemetry.s6_tool_trace,
      s6_action_type: result.telemetry.s6_action_type,
      s6_action_target_id: result.telemetry.s6_action_target_id,
      s6_action_status: result.telemetry.s6_action_status,
      s6_action_rejection_reason: result.telemetry.s6_action_rejection_reason,
      s6_clarify_candidate_count: result.telemetry.s6_clarify_candidate_count,
      s6_abort_reason: result.telemetry.s6_abort_reason,
      s6_evidence_gate: result.telemetry.s6_evidence_gate,
      s6_evidence_sibling_count: result.telemetry.s6_evidence_sibling_count,
      // Content extension telemetry (6x.3)
      s6_content_tool_used: result.telemetry.s6_content_tool_used,
      s6_content_call_count: result.telemetry.s6_content_call_count,
      s6_content_chars_returned: result.telemetry.s6_content_chars_returned,
    }

    await recordRoutingLog(payload)
  } catch {
    // Shadow telemetry is best-effort — never throw into caller
  }
}

/**
 * Write a durable execution_outcome row for S6 enforcement result.
 * Uses ':s6' suffix on interaction_id to avoid unique constraint conflict
 * with the dispatcher-built routing log row for the same interaction.
 * Provenance: s6_enforced:<action_type> when action executed, s6_enforced:fallback otherwise.
 */
async function writeDurableEnforcementLog(
  params: S6ShadowLoopParams,
  result: S6LoopResult,
): Promise<void> {
  try {
    const actionType = result.telemetry.s6_action_type
    const isExecuted = result.outcome === 'action_executed'
    const provenance = isExecuted
      ? `s6_enforced:${actionType ?? 'unknown'}`
      : `s6_enforced:fallback`

    const payload: RoutingLogPayload = {
      raw_query_text: params.userInput,
      context_snapshot: buildContextSnapshot({
        openWidgetCount: 0,
        pendingOptionsCount: 0,
        activeOptionSetId: null,
        hasLastClarification: false,
        hasLastSuggestion: false,
        latchEnabled: false,
        messageCount: 0,
      }),
      session_id: params.sessionId,
      interaction_id: `${params.interactionId}:s6`,
      turn_index: params.turnIndex,
      routing_lane: 'D',
      decision_source: 'llm',
      risk_tier: 'low',
      provenance,
      result_status: isExecuted ? 'executed' : 'failed',
      tier_label: 's6_enforce',
      handled_by_tier: 6,
      log_phase: 'execution_outcome',

      // Stage 6 telemetry fields
      s6_loop_entered: true,
      s6_escalation_reason: params.escalationReason,
      s6_inspect_rounds: result.inspectRoundsUsed,
      s6_outcome: result.outcome,
      s6_duration_ms: result.durationMs,
      s6_tool_trace: result.telemetry.s6_tool_trace,
      s6_action_type: result.telemetry.s6_action_type,
      s6_action_target_id: result.telemetry.s6_action_target_id,
      s6_action_status: result.telemetry.s6_action_status,
      s6_action_rejection_reason: result.telemetry.s6_action_rejection_reason,
      s6_clarify_candidate_count: result.telemetry.s6_clarify_candidate_count,
      s6_abort_reason: result.telemetry.s6_abort_reason,
      s6_evidence_gate: result.telemetry.s6_evidence_gate,
      s6_evidence_sibling_count: result.telemetry.s6_evidence_sibling_count,
      // Content extension telemetry (6x.3)
      s6_content_tool_used: result.telemetry.s6_content_tool_used,
      s6_content_call_count: result.telemetry.s6_content_call_count,
      s6_content_chars_returned: result.telemetry.s6_content_chars_returned,
    }

    await recordRoutingLog(payload)
  } catch {
    // Enforcement telemetry is best-effort
  }
}
