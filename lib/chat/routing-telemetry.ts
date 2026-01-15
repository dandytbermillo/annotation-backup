/**
 * Routing Telemetry Module
 * Part of: TD-4 (Durable Routing Telemetry)
 *
 * Provides structured telemetry for doc retrieval routing decisions.
 * Events are persisted to PostgreSQL via debugLog for analysis.
 */

import { debugLog } from '@/lib/utils/debug-logger'

// =============================================================================
// Pattern ID Enum (Stable across releases)
// =============================================================================

/**
 * Stable enum for routing pattern identification.
 * Used in telemetry to track which patterns are matching/missing.
 * DO NOT change existing values - only append new ones.
 */
export enum RoutingPatternId {
  // Meta-explain patterns
  DEF_WHAT_IS = 'DEF_WHAT_IS',                    // "what is X"
  DEF_WHAT_ARE = 'DEF_WHAT_ARE',                  // "what are X"
  DEF_EXPLAIN = 'DEF_EXPLAIN',                    // "explain X"
  DEF_CONVERSATIONAL = 'DEF_CONVERSATIONAL',      // "can you tell me what is X"

  // Follow-up patterns
  FOLLOWUP_TELL_ME_MORE = 'FOLLOWUP_TELL_ME_MORE', // "tell me more"
  FOLLOWUP_PRONOUN = 'FOLLOWUP_PRONOUN',           // "how does it work"
  FOLLOWUP_CLASSIFIER = 'FOLLOWUP_CLASSIFIER',     // Classifier detected follow-up
  FOLLOWUP_POLITE = 'FOLLOWUP_POLITE',             // "can you tell me more"

  // Action patterns
  ACTION_COMMAND = 'ACTION_COMMAND',               // "open notes"
  ACTION_WIDGET = 'ACTION_WIDGET',                 // Visible widget match

  // Routing decisions
  ROUTE_DOC_STYLE = 'ROUTE_DOC_STYLE',            // Doc-style query
  ROUTE_BARE_NOUN = 'ROUTE_BARE_NOUN',            // Bare noun query
  ROUTE_APP_RELEVANT = 'ROUTE_APP_RELEVANT',      // App-relevant fallback
  ROUTE_CORE_TERMS = 'ROUTE_CORE_TERMS',          // CORE_APP_TERMS fallback
  ROUTE_LLM_FALLBACK = 'ROUTE_LLM_FALLBACK',      // LLM fallback (no match)

  // Special cases
  CORRECTION = 'CORRECTION',                       // "no / not that"
  CLARIFICATION_EXIT = 'CLARIFICATION_EXIT',       // New question exits clarification
  AMBIGUOUS_CROSS_DOC = 'AMBIGUOUS_CROSS_DOC',    // Cross-doc ambiguity

  // Unknown/unmatched
  UNKNOWN = 'UNKNOWN',
}

// =============================================================================
// Event Schema Types
// =============================================================================

export interface RoutingTelemetryEvent {
  // Query info
  input_len: number
  normalized_query: string

  // Routing decision
  route_deterministic: 'doc' | 'action' | 'bare_noun' | 'llm' | 'followup' | 'clarify'
  route_final: 'doc' | 'action' | 'bare_noun' | 'llm' | 'followup' | 'clarify'
  matched_pattern_id: RoutingPatternId

  // State context
  known_terms_loaded: boolean
  known_terms_count: number
  known_terms_fetch_status?: 'cached' | 'fetched' | 'fetch_error' | 'fetch_timeout'  // Track why knownTerms may be empty
  used_core_terms_fallback?: boolean  // True when CORE_APP_TERMS was used due to timeout/error
  matched_core_term?: boolean  // Did CORE_APP_TERMS contain a token from this query?
  matched_known_term?: boolean  // Did knownTerms contain a token from this query?
  last_doc_slug_present: boolean
  last_doc_slug?: string

  // Classifier info (if called)
  classifier_called: boolean
  classifier_result?: boolean
  classifier_latency_ms?: number
  classifier_timeout?: boolean  // TD-4: Added per plan
  classifier_error?: boolean

  // Retrieval result
  doc_status?: 'found' | 'weak' | 'ambiguous' | 'no_match'
  doc_slug_top?: string
  doc_slug_alt?: string[]

  // Follow-up context
  followup_detected: boolean
  is_new_question: boolean

  // Performance
  routing_latency_ms: number

  // Cross-turn tracking (set by subsequent turn if user corrects)
  // Note: This is set retrospectively when "no / not that" is detected
  user_corrected_next_turn?: boolean
}

// =============================================================================
// Telemetry Logger
// =============================================================================

/**
 * Log a routing decision for analysis.
 * Uses debugLog to persist to PostgreSQL.
 * TD-4: Uses forceLog to ensure telemetry is always persisted (not gated by debug flag).
 */
export async function logRoutingDecision(event: RoutingTelemetryEvent): Promise<void> {
  await debugLog({
    component: 'DocRouting',
    action: 'route_decision',
    content_preview: `Route: ${event.route_final} | Pattern: ${event.matched_pattern_id}`,
    forceLog: true, // TD-4: Always persist routing telemetry for analysis
    metadata: {
      // Query info
      input_len: event.input_len,
      normalized_query: event.normalized_query,

      // Routing decision
      route_deterministic: event.route_deterministic,
      route_final: event.route_final,
      matched_pattern_id: event.matched_pattern_id,

      // State context
      known_terms_loaded: event.known_terms_loaded,
      known_terms_count: event.known_terms_count,
      known_terms_fetch_status: event.known_terms_fetch_status,
      used_core_terms_fallback: event.used_core_terms_fallback,
      matched_core_term: event.matched_core_term,
      matched_known_term: event.matched_known_term,
      last_doc_slug_present: event.last_doc_slug_present,
      last_doc_slug: event.last_doc_slug,

      // Classifier info
      classifier_called: event.classifier_called,
      classifier_result: event.classifier_result,
      classifier_latency_ms: event.classifier_latency_ms,
      classifier_timeout: event.classifier_timeout,
      classifier_error: event.classifier_error,

      // Retrieval result
      doc_status: event.doc_status,
      doc_slug_top: event.doc_slug_top,
      doc_slug_alt: event.doc_slug_alt,

      // Follow-up context
      followup_detected: event.followup_detected,
      is_new_question: event.is_new_question,

      // Performance
      routing_latency_ms: event.routing_latency_ms,

      // Cross-turn tracking (set retrospectively when user corrects)
      user_corrected_next_turn: event.user_corrected_next_turn,
    },
    metrics: {
      event: 'doc_routing_decision',
      docSlug: event.doc_slug_top,
      timestamp: Date.now(),
    },
  })
}

// =============================================================================
// Helper: Create Telemetry Event
// =============================================================================

/**
 * Create a partial telemetry event with defaults.
 * Fill in the rest as routing progresses.
 */
export function createRoutingTelemetryEvent(
  input: string,
  normalizedQuery: string,
  knownTermsLoaded: boolean,
  knownTermsCount: number,
  lastDocSlug?: string,
  knownTermsFetchStatus?: 'cached' | 'fetched' | 'fetch_error' | 'fetch_timeout',
  usedCoreTermsFallback?: boolean
): Partial<RoutingTelemetryEvent> {
  return {
    input_len: input.length,
    normalized_query: normalizedQuery,
    known_terms_loaded: knownTermsLoaded,
    known_terms_count: knownTermsCount,
    known_terms_fetch_status: knownTermsFetchStatus,
    used_core_terms_fallback: usedCoreTermsFallback,
    last_doc_slug_present: !!lastDocSlug,
    last_doc_slug: lastDocSlug,
    classifier_called: false,
    followup_detected: false,
    is_new_question: false,
  }
}

// =============================================================================
// Helper: Determine Pattern ID
// =============================================================================

/**
 * Determine the pattern ID based on the matched pattern.
 */
export function getPatternId(
  input: string,
  route: string,
  isFollowUp: boolean,
  isNewQuestion: boolean,
  classifierCalled: boolean,
  isConversationalPrefix: boolean
): RoutingPatternId {
  const normalized = input.trim().toLowerCase()

  // Follow-up patterns
  if (isFollowUp) {
    if (/^tell me more/.test(normalized)) return RoutingPatternId.FOLLOWUP_TELL_ME_MORE
    if (/^(can|could|would) you .*(tell me more|explain more)/.test(normalized)) {
      return RoutingPatternId.FOLLOWUP_POLITE
    }
    if (classifierCalled) return RoutingPatternId.FOLLOWUP_CLASSIFIER
    return RoutingPatternId.FOLLOWUP_PRONOUN
  }

  // Meta-explain patterns
  if (/^what is\b/.test(normalized)) return RoutingPatternId.DEF_WHAT_IS
  if (/^what are\b/.test(normalized)) return RoutingPatternId.DEF_WHAT_ARE
  if (/^explain\b/.test(normalized)) return RoutingPatternId.DEF_EXPLAIN
  if (isConversationalPrefix && /what (is|are)/.test(normalized)) {
    return RoutingPatternId.DEF_CONVERSATIONAL
  }

  // Action patterns
  if (/^(open|close|show|go|navigate)\b/.test(normalized)) return RoutingPatternId.ACTION_COMMAND

  // Route-based patterns
  if (route === 'doc') return RoutingPatternId.ROUTE_DOC_STYLE
  if (route === 'bare_noun') return RoutingPatternId.ROUTE_BARE_NOUN
  if (route === 'action') return RoutingPatternId.ACTION_WIDGET
  if (route === 'llm') return RoutingPatternId.ROUTE_LLM_FALLBACK

  return RoutingPatternId.UNKNOWN
}
