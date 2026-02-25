/**
 * Chat Routing — Correction Handler
 *
 * Handles correction phrases like "no" / "not that" after doc retrieval.
 * Extracted from chat-routing.ts for modularity.
 *
 * @internal — Do not import directly outside lib/chat/.
 * Use the barrel at @/lib/chat/chat-routing instead.
 */

import { debugLog } from '@/lib/utils/debug-logger'
import { getKnownTermsSync } from '@/lib/docs/known-terms-client'
import {
  createRoutingTelemetryEvent,
  logRoutingDecision,
  RoutingPatternId,
  setMatchedKnownTermTelemetry,
  type RoutingTelemetryEvent,
} from '@/lib/chat/routing-telemetry'
import { normalizeInputForRouting, isCorrectionPhrase } from '@/lib/chat/query-patterns'
import type { ChatMessage } from '@/lib/chat'
import type { RoutingHandlerContext, HandlerResult } from './chat-routing-types'

// =============================================================================
// Correction Handler
// =============================================================================

/**
 * Handle correction phrases like "no" / "not that" after doc retrieval.
 * Acknowledges the correction and clears doc retrieval state.
 *
 * Trigger: User says correction phrase AND lastDocSlug exists
 * Result: Clears state, asks for clarification
 */
export function handleCorrection(ctx: RoutingHandlerContext): HandlerResult {
  const {
    trimmedInput,
    docRetrievalState,
    knownTermsFetchStatus,
    usedCoreAppTermsFallback,
    addMessage,
    updateDocRetrievalState,
    setIsLoading,
  } = ctx

  // Check if this is a correction scenario
  if (!docRetrievalState?.lastDocSlug || !isCorrectionPhrase(trimmedInput)) {
    return { handled: false }
  }

  // TD-4: Log correction telemetry
  const { normalized: normalizedQuery, tokens: correctionTokens } = normalizeInputForRouting(trimmedInput)
  const correctionKnownTerms = getKnownTermsSync()
  const correctionTelemetryEvent: Partial<RoutingTelemetryEvent> = createRoutingTelemetryEvent(
    trimmedInput,
    normalizedQuery,
    !!correctionKnownTerms,
    correctionKnownTerms?.size ?? 0,
    docRetrievalState.lastDocSlug,
    knownTermsFetchStatus,
    usedCoreAppTermsFallback
  )
  correctionTelemetryEvent.route_deterministic = 'clarify'
  correctionTelemetryEvent.route_final = 'clarify'
  correctionTelemetryEvent.matched_pattern_id = RoutingPatternId.CORRECTION
  setMatchedKnownTermTelemetry(correctionTelemetryEvent, correctionTokens, normalizedQuery, correctionKnownTerms)
  correctionTelemetryEvent.doc_slug_top = docRetrievalState.lastDocSlug
  correctionTelemetryEvent.user_corrected_next_turn = true
  correctionTelemetryEvent.routing_latency_ms = 0
  void logRoutingDecision(correctionTelemetryEvent as RoutingTelemetryEvent)

  void debugLog({
    component: 'ChatNavigation',
    action: 'doc_correction',
    metadata: { userInput: trimmedInput, lastDocSlug: docRetrievalState.lastDocSlug },
    metrics: {
      event: 'correction_triggered',
      docSlug: docRetrievalState.lastDocSlug,
      correctionPhrase: trimmedInput,
      timestamp: Date.now(),
    },
  })

  // Acknowledge correction
  const correctionMessage: ChatMessage = {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    content: "Got it — let's try again. Which topic were you asking about?",
    timestamp: new Date(),
    isError: false,
  }
  addMessage(correctionMessage)

  // Clear doc retrieval state
  updateDocRetrievalState({ lastDocSlug: undefined, lastTopicTokens: undefined })
  setIsLoading(false)

  return { handled: true }
}
