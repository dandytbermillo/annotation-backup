/**
 * Shared semantic rescue utility — post-LLM guard for misclassified semantic queries.
 *
 * Used by both:
 * 1. answer_from_context remap (existing guard)
 * 2. need_context rescue (new guard)
 *
 * Extracted to a separate module for testability and to prevent behavior drift
 * between the two guard paths.
 */

import { detectLocalSemanticIntent } from './input-classifiers'
import type { SessionState } from './intent-prompt'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SemanticRescueIntent = 'last_action' | 'explain_last_action'

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * Attempt to rescue a misclassified semantic query by running the narrow
 * `detectLocalSemanticIntent` detector against the user message.
 *
 * Returns the correct resolver intent, or null if rescue conditions are not met.
 *
 * 5 hard guards (all must pass):
 * 1. isSemanticLaneEnabled — feature flag
 * 2. !pendingOptions?.length — no pending options
 * 3. !lastClarification — no active clarification
 * 4. detectLocalSemanticIntent returns non-null (narrow pattern match)
 * 5. lastAction exists (resolver needs data)
 */
export function trySemanticRescue(
  userMessage: string,
  isSemanticLaneEnabled: boolean,
  pendingOptions: unknown[] | undefined,
  lastClarification: unknown | undefined,
  lastAction: SessionState['lastAction']
): SemanticRescueIntent | null {
  if (!isSemanticLaneEnabled) return null
  if (pendingOptions?.length) return null
  if (lastClarification) return null
  const detected = detectLocalSemanticIntent(userMessage)
  if (!detected) return null
  if (!lastAction) return null
  return detected
}
