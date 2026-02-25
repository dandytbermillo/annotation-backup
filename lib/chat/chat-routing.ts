/**
 * Chat Routing Handlers — Barrel Module
 *
 * Re-exports all routing handlers and types from their respective modules.
 * Do not add logic here — this file is a pure re-export barrel.
 */

// Handlers
export { handleClarificationIntercept } from './chat-routing-clarification-intercept'
export { handleCorrection } from './chat-routing-correction'
export { handleMetaExplain } from './chat-routing-meta-explain'
export { handleFollowUp } from './chat-routing-followup'
export { handlePanelDisambiguation } from './chat-routing-panel-disambiguation'

// Arbitration
export { runBoundedArbitrationLoop, resetLLMArbitrationGuard } from './chat-routing-arbitration'

// Types
export type {
  PreferredCandidateHint,
  HandlerResult,
  PendingOptionState,
  RoutingHandlerContext,
  MetaExplainHandlerContext,
  FollowUpHandlerResult,
  FollowUpHandlerContext,
  ClarificationInterceptResult,
  ClarificationInterceptContext,
  PanelDisambiguationHandlerContext,
  PanelDisambiguationHandlerResult,
  ArbitrationFallbackReason,
  ContextEnrichmentCallback,
} from './chat-routing-types'
