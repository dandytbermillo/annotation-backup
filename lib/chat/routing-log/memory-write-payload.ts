/**
 * Memory Write Payload Builder — Phase 2a
 *
 * Client-safe. Extracts structured action data from RoutingDispatcherResult
 * and builds a payload for UPSERT into chat_routing_memory_index.
 *
 * Returns null when result is ineligible (not handled, not executed, no structured action).
 * Only groundingAction results (execute_widget_item, execute_referent) are storable.
 */

import type { ContextSnapshotV1, SnapshotInputs } from './context-snapshot'
import { buildContextSnapshot } from './context-snapshot'
import { deriveResultStatus, deriveRiskTier } from './mapping'
import type { RiskTier } from './types'
import { MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION } from './types'

// Forward-reference types to avoid importing the full dispatcher (which pulls in too many deps).
// These match the shapes in routing-dispatcher.ts without creating a hard import.
interface MinimalRoutingResult {
  handled: boolean
  handledByTier?: number
  tierLabel?: string
  _devProvenanceHint?: string
  groundingAction?: {
    type: 'execute_referent'
    syntheticMessage: string
    candidateId: string
    candidateLabel: string
    actionHint?: string
  } | {
    type: 'execute_widget_item'
    widgetId: string
    segmentId?: string
    itemId: string
    itemLabel: string
    action: string
  }
}

interface MinimalTurnSnapshot {
  openWidgets: { id: string; label: string; options: { id: string; label: string }[] }[]
}

interface MinimalContext {
  trimmedInput: string
  pendingOptions: unknown[]
  activeOptionSetId: string | null
  lastClarification: unknown
  lastSuggestion: unknown
  messages: unknown[]
}

// --- Payload interface ---

export interface MemoryWritePayload {
  raw_query_text: string
  context_snapshot: ContextSnapshotV1
  intent_id: string
  intent_class: 'action_intent' | 'info_intent'
  slots_json: Record<string, unknown>
  target_ids: string[]
  risk_tier: RiskTier
  schema_version: string
  tool_version: string
  /** Slice 3a: memory index row UUID of the semantically matched winner.
   *  When present, server performs transactional replay-hit accounting:
   *  increments winner's success_count if the UPSERT wrote to a different row. */
  replay_source_row_id?: string
}

// --- Builder ---

/**
 * Build a MemoryWritePayload from a successful routing result.
 *
 * Eligibility gates (all must pass):
 * 1. result.handled === true
 * 2. result_status === 'executed' (derived from provenance + tierLabel)
 * 3. Has groundingAction (execute_widget_item or execute_referent)
 *
 * Returns null when ineligible.
 */
export function buildMemoryWritePayload(
  ctx: MinimalContext,
  result: MinimalRoutingResult,
  turnSnapshot: MinimalTurnSnapshot,
): MemoryWritePayload | null {
  // Gate 1: must be handled
  if (!result.handled) return null

  // Gate 2: must be 'executed' status
  const resultStatus = deriveResultStatus(result.handled, result._devProvenanceHint, result.tierLabel)
  if (resultStatus !== 'executed') return null

  // Gate 3: must have a groundingAction
  if (!result.groundingAction) return null

  const action = result.groundingAction

  // Extract slots_json and target_ids by action type
  let slots_json: Record<string, unknown>
  let target_ids: string[]

  if (action.type === 'execute_widget_item') {
    slots_json = {
      action_type: 'execute_widget_item',
      widgetId: action.widgetId,
      segmentId: action.segmentId ?? null,
      itemId: action.itemId,
      itemLabel: action.itemLabel,
      action: action.action,
    }
    target_ids = [action.widgetId, action.itemId]
  } else if (action.type === 'execute_referent') {
    slots_json = {
      action_type: 'execute_referent',
      syntheticMessage: action.syntheticMessage,
      candidateId: action.candidateId,
      candidateLabel: action.candidateLabel,
      actionHint: action.actionHint ?? null,
    }
    target_ids = [action.candidateId]
  } else {
    // Unknown action type — not storable
    return null
  }

  const isLatchEnabled = process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 === 'true'
  const snapshot = buildContextSnapshot({
    openWidgetCount: turnSnapshot.openWidgets.length,
    pendingOptionsCount: ctx.pendingOptions.length,
    activeOptionSetId: ctx.activeOptionSetId,
    hasLastClarification: ctx.lastClarification !== null,
    hasLastSuggestion: ctx.lastSuggestion !== null,
    latchEnabled: isLatchEnabled,
    messageCount: ctx.messages.length,
  })

  return {
    raw_query_text: ctx.trimmedInput,
    context_snapshot: snapshot,
    intent_id: result.tierLabel ?? 'unknown',
    intent_class: 'action_intent', // All structured groundingActions are navigation/mutation actions
    slots_json,
    target_ids,
    risk_tier: deriveRiskTier(result.handled, result.handledByTier),
    schema_version: MEMORY_SCHEMA_VERSION,
    tool_version: MEMORY_TOOL_VERSION,
  }
}

// --- Phase 5: Info-intent write builder ---

/**
 * Build a MemoryWritePayload for successful history/info intent resolutions.
 *
 * Eligible intents: last_action, explain_last_action, verify_action.
 * These produce info_intent rows with no groundingAction.
 * answerSource must be the real truth source ('session_state' or 'action_history'),
 * not the routing mechanism.
 */
export function buildInfoIntentMemoryWritePayload(
  userInput: string,
  resolvedIntent: 'last_action' | 'explain_last_action' | 'verify_action',
  answerSource: 'session_state' | 'action_history',
  contextSnapshot: ContextSnapshotV1,
  options?: { resolutionRequiredClarification?: boolean },
): MemoryWritePayload {
  return {
    raw_query_text: userInput,
    context_snapshot: contextSnapshot,
    intent_id: resolvedIntent,
    intent_class: 'info_intent',
    slots_json: {
      resolved_intent: resolvedIntent,
      answer_source: answerSource,
      ...(options?.resolutionRequiredClarification ? { resolution_required_clarification: true } : {}),
    },
    target_ids: [],
    risk_tier: 'low',
    schema_version: MEMORY_SCHEMA_VERSION,
    tool_version: MEMORY_TOOL_VERSION,
  }
}

// --- Phase 5: Navigation write builder ---

/**
 * Build a MemoryWritePayload for successful Phase 5 navigation executions.
 *
 * Eligible intents: open_entry, open_workspace, open_panel, go_home.
 * These produce action_intent rows with target IDs from the resolved navigation.
 * The raw user query text is the writeback source — normal server-side storage
 * normalization and fingerprinting still applies before storage.
 *
 * Returns null for unresolved, failed, or ambiguous resolutions.
 */
export function buildPhase5NavigationWritePayload(params: {
  rawQueryText: string
  intentId: 'open_entry' | 'open_workspace' | 'open_panel' | 'go_home'
  resolution: {
    success: boolean
    action: string
    entry?: { id: string; name: string; dashboardWorkspaceId?: string }
    workspace?: { id: string; name: string; entryId?: string; entryName?: string; isDefault?: boolean }
    panel?: { id?: string; title?: string }
  }
  contextSnapshot: ContextSnapshotV1
}): MemoryWritePayload | null {
  const { rawQueryText, intentId, resolution, contextSnapshot } = params

  if (!resolution.success) return null

  let slotsJson: Record<string, unknown> = { action_type: intentId }
  let targetIds: string[] = []

  if (intentId === 'open_entry' && resolution.entry) {
    // Reject incomplete: dashboardWorkspaceId is required for replay execution
    if (!resolution.entry.dashboardWorkspaceId) return null
    slotsJson.entryId = resolution.entry.id
    slotsJson.entryName = resolution.entry.name
    slotsJson.dashboardWorkspaceId = resolution.entry.dashboardWorkspaceId
    targetIds = [resolution.entry.id]
  } else if (intentId === 'open_workspace' && resolution.workspace) {
    // Reject incomplete: entryId/entryName required for WorkspaceMatch reconstruction
    if (!resolution.workspace.entryId || !resolution.workspace.entryName) return null
    slotsJson.workspaceId = resolution.workspace.id
    slotsJson.workspaceName = resolution.workspace.name
    slotsJson.entryId = resolution.workspace.entryId
    slotsJson.entryName = resolution.workspace.entryName
    slotsJson.isDefault = resolution.workspace.isDefault ?? false
    targetIds = [resolution.workspace.id]
  } else if (intentId === 'open_panel' && resolution.panel?.id) {
    // Reject incomplete: panelTitle required for replay surfaced message
    if (!resolution.panel.title) return null
    slotsJson.panelId = resolution.panel.id
    slotsJson.panelTitle = resolution.panel.title
    targetIds = [resolution.panel.id]
  } else if (intentId === 'go_home') {
    // go_home has no specific target ID — home entry resolved by client
    slotsJson.action_type = 'go_home'
  } else {
    // Missing required target data for this intent — don't write
    return null
  }

  return {
    raw_query_text: rawQueryText,
    context_snapshot: contextSnapshot,
    intent_id: intentId,
    intent_class: 'action_intent',
    slots_json: slotsJson,
    target_ids: targetIds,
    risk_tier: 'medium', // LLM-mediated fallback writes
    schema_version: MEMORY_SCHEMA_VERSION,
    tool_version: MEMORY_TOOL_VERSION,
  }
}
