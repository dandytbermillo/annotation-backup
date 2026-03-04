/**
 * Outcome Logger — Bug #3 Two-Phase Logging
 *
 * Fires execution_outcome rows after sendMessage execution completes.
 * Derives outcome fields from the actual API resolution (success, action),
 * NOT from the UI provenance badge.
 *
 * Lane/source semantics: Outcome rows use routing_lane='D' and
 * decision_source='llm' — the ACTUAL outcome, not the original attempt's lane.
 * The dedup view (which prefers execution_outcome) reports final user-visible
 * results. To analyze initial routing attempt distribution, query
 * WHERE log_phase = 'routing_attempt' directly.
 *
 * Client-safe: uses only recordRoutingLog (HTTP wrapper).
 */

import type { RoutingLogPayload } from './payload'
import type { ResultStatus, DecisionSource, RoutingLane } from './types'
import { recordRoutingLog } from './writer'

interface OutcomeInput {
  basePayload: RoutingLogPayload
  /** resolution.action from the API response */
  action: string
  /** resolution.success from the API response */
  success: boolean
  /** resolution.executionMeta?.reasonCode (optional enrichment) */
  executionMetaReasonCode?: string
}

const CLARIFIER_ACTIONS = new Set(['error', 'need_context'])
const OPTION_PROMPT_ACTIONS = new Set([
  'select', 'list_workspaces', 'clarify_type',
  'confirm_delete', 'confirm_panel_write', 'reshow_options', 'select_option',
])

export function fireOutcomeLog(input: OutcomeInput): void {
  const { basePayload, action, success } = input

  // Derive result_status from actual API result
  let resultStatus: ResultStatus
  // select_option with success=true means LLM correctly picked an option and we executed it.
  // Don't let OPTION_PROMPT_ACTIONS override this to 'clarified'.
  if (action === 'select_option' && success) {
    resultStatus = 'executed'
  } else if (!success && CLARIFIER_ACTIONS.has(action)) {
    resultStatus = 'failed'
  } else if (OPTION_PROMPT_ACTIONS.has(action)) {
    resultStatus = 'clarified'
  } else if (success) {
    resultStatus = 'executed'
  } else {
    resultStatus = 'failed'
  }

  // All LLM fallthrough outcomes are lane D
  const outcomeLane: RoutingLane = 'D'
  const decisionSource: DecisionSource = 'llm'

  recordRoutingLog({
    ...basePayload,
    log_phase: 'execution_outcome',
    routing_lane: outcomeLane,
    decision_source: decisionSource,
    result_status: resultStatus,
    provenance: `outcome:${action}:${success ? 'ok' : 'fail'}`,
  }).catch(() => {})
}

/** Fire a failed outcome for error/timeout paths */
export function fireFailedOutcomeLog(
  basePayload: RoutingLogPayload,
  reason: string,
): void {
  recordRoutingLog({
    ...basePayload,
    log_phase: 'execution_outcome',
    routing_lane: 'D',
    decision_source: 'llm',
    result_status: 'failed',
    provenance: `outcome:error:${reason}`,
  }).catch(() => {})
}
