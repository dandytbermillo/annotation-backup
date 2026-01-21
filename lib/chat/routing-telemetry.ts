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
  ROUTE_CORE_TERMS = 'ROUTE_CORE_TERMS',          // DEPRECATED: CORE_APP_TERMS removed in TD-1
  ROUTE_LLM_FALLBACK = 'ROUTE_LLM_FALLBACK',      // LLM fallback (no match)

  // Special cases
  CORRECTION = 'CORRECTION',                       // "no / not that"
  CLARIFICATION_EXIT = 'CLARIFICATION_EXIT',       // New question exits clarification
  AMBIGUOUS_CROSS_DOC = 'AMBIGUOUS_CROSS_DOC',    // Cross-doc ambiguity

  // TD-7: High-ambiguity clarification
  CLARIFY_HIGH_AMBIGUITY = 'CLARIFY_HIGH_AMBIGUITY', // High-ambiguity term triggered clarification

  // Semantic fallback classifier
  SEMANTIC_FALLBACK = 'SEMANTIC_FALLBACK',           // Classifier routed to docs/actions

  // Prereq 4: Cross-corpus patterns
  CROSS_CORPUS_AMBIGUOUS = 'CROSS_CORPUS_AMBIGUOUS', // Both corpora have viable results
  CROSS_CORPUS_NOTES_EXPLICIT = 'CROSS_CORPUS_NOTES_EXPLICIT', // Explicit notes intent
  CROSS_CORPUS_DOCS_EXPLICIT = 'CROSS_CORPUS_DOCS_EXPLICIT',   // Explicit docs intent

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
  known_terms_fetch_status?: 'snapshot' | 'cached' | 'fetched' | 'fetch_error' | 'fetch_timeout'  // Track source of knownTerms
  used_core_terms_fallback?: boolean  // DEPRECATED: Always false after TD-1 (CORE_APP_TERMS removed)
  matched_core_term?: boolean  // DEPRECATED: No longer set after TD-1 (CORE_APP_TERMS removed)
  matched_known_term?: boolean  // Did knownTerms contain a token from this query?
  // TD-2: Fuzzy matching telemetry
  fuzzy_matched?: boolean  // Did a fuzzy match contribute to routing?
  fuzzy_match_token?: string  // The input token that was fuzzy-matched
  fuzzy_match_term?: string  // The known term it matched to
  fuzzy_match_distance?: number  // Levenshtein distance (1 or 2)
  retrieval_query_corrected?: boolean  // Was the retrieval query corrected via fuzzy match?
  // TD-7: Stricter app-relevance telemetry
  strict_app_relevance_triggered?: boolean  // Did TD-7 clarification trigger?
  strict_term?: string  // The high-ambiguity term that triggered clarification
  last_doc_slug_present: boolean
  last_doc_slug?: string

  // Classifier info (if called)
  classifier_called: boolean
  classifier_result?: boolean
  classifier_latency_ms?: number
  classifier_timeout?: boolean  // TD-4: Added per plan
  classifier_error?: boolean
  // Semantic fallback classifier info (route classifier)
  semantic_classifier_called?: boolean
  semantic_classifier_domain?: 'app' | 'general'
  semantic_classifier_intent?: 'doc_explain' | 'action' | 'search_notes' | 'other'
  semantic_classifier_confidence?: number
  semantic_classifier_needs_clarification?: boolean
  semantic_classifier_latency_ms?: number
  semantic_classifier_timeout?: boolean
  semantic_classifier_error?: boolean

  // Retrieval result
  doc_status?: 'found' | 'weak' | 'ambiguous' | 'no_match'
  doc_slug_top?: string
  doc_slug_alt?: string[]

  // HS3: Bounded formatting telemetry
  hs3_called?: boolean
  hs3_latency_ms?: number
  hs3_input_len?: number
  hs3_output_len?: number
  hs3_trigger_reason?: 'long_snippet' | 'steps_request' | 'two_chunks'
  hs3_timeout?: boolean
  hs3_error?: boolean

  // Follow-up context
  followup_detected: boolean
  is_new_question: boolean

  // Performance
  routing_latency_ms: number

  // Cross-turn tracking (set by subsequent turn if user corrects)
  // Note: This is set retrospectively when "no / not that" is detected
  user_corrected_next_turn?: boolean

  // Prereq 4: Cross-corpus telemetry
  cross_corpus_ambiguity_shown?: boolean  // Were cross-corpus pills shown?
  cross_corpus_choice?: 'docs' | 'notes'  // User's corpus selection
  cross_corpus_score_gap?: number         // Score gap between top doc and top note
  cross_corpus_docs_status?: 'found' | 'weak' | 'ambiguous' | 'no_match'
  cross_corpus_notes_status?: 'found' | 'weak' | 'ambiguous' | 'no_match'
  cross_corpus_intent?: 'docs' | 'notes' | 'both' | 'none'  // Detected intent signals
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
      // TD-2: Fuzzy matching
      fuzzy_matched: event.fuzzy_matched,
      fuzzy_match_token: event.fuzzy_match_token,
      fuzzy_match_term: event.fuzzy_match_term,
      fuzzy_match_distance: event.fuzzy_match_distance,
      retrieval_query_corrected: event.retrieval_query_corrected,
      // TD-7: Stricter app-relevance
      strict_app_relevance_triggered: event.strict_app_relevance_triggered,
      strict_term: event.strict_term,
      last_doc_slug_present: event.last_doc_slug_present,
      last_doc_slug: event.last_doc_slug,

      // Classifier info
      classifier_called: event.classifier_called,
      classifier_result: event.classifier_result,
      classifier_latency_ms: event.classifier_latency_ms,
      classifier_timeout: event.classifier_timeout,
      classifier_error: event.classifier_error,
      semantic_classifier_called: event.semantic_classifier_called,
      semantic_classifier_domain: event.semantic_classifier_domain,
      semantic_classifier_intent: event.semantic_classifier_intent,
      semantic_classifier_confidence: event.semantic_classifier_confidence,
      semantic_classifier_needs_clarification: event.semantic_classifier_needs_clarification,
      semantic_classifier_latency_ms: event.semantic_classifier_latency_ms,
      semantic_classifier_timeout: event.semantic_classifier_timeout,
      semantic_classifier_error: event.semantic_classifier_error,

      // Retrieval result
      doc_status: event.doc_status,
      doc_slug_top: event.doc_slug_top,
      doc_slug_alt: event.doc_slug_alt,

      // HS3: Bounded formatting
      hs3_called: event.hs3_called,
      hs3_latency_ms: event.hs3_latency_ms,
      hs3_input_len: event.hs3_input_len,
      hs3_output_len: event.hs3_output_len,
      hs3_trigger_reason: event.hs3_trigger_reason,
      hs3_timeout: event.hs3_timeout,
      hs3_error: event.hs3_error,

      // Follow-up context
      followup_detected: event.followup_detected,
      is_new_question: event.is_new_question,

      // Performance
      routing_latency_ms: event.routing_latency_ms,

      // Cross-turn tracking (set retrospectively when user corrects)
      user_corrected_next_turn: event.user_corrected_next_turn,

      // Prereq 4: Cross-corpus telemetry
      cross_corpus_ambiguity_shown: event.cross_corpus_ambiguity_shown,
      cross_corpus_choice: event.cross_corpus_choice,
      cross_corpus_score_gap: event.cross_corpus_score_gap,
      cross_corpus_docs_status: event.cross_corpus_docs_status,
      cross_corpus_notes_status: event.cross_corpus_notes_status,
      cross_corpus_intent: event.cross_corpus_intent,
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
  knownTermsFetchStatus?: 'snapshot' | 'cached' | 'fetched' | 'fetch_error' | 'fetch_timeout',
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

// =============================================================================
// Helper: Set Matched Known Term Telemetry (Step 2 Refactor)
// =============================================================================

/**
 * Set the matched_known_term field on a telemetry event.
 * Checks if any token matches knownTerms or if the normalized query matches.
 *
 * This helper reduces duplication across meta-explain, correction, follow-up,
 * and main routing paths.
 *
 * @param event - The telemetry event to update (mutates in place)
 * @param tokens - Array of tokens from the query
 * @param normalizedQuery - The normalized query string
 * @param knownTerms - Set of known terms (optional)
 */
export function setMatchedKnownTermTelemetry(
  event: Partial<RoutingTelemetryEvent>,
  tokens: string[],
  normalizedQuery: string,
  knownTerms?: Set<string> | null
): void {
  event.matched_known_term = knownTerms
    ? (tokens.some(t => knownTerms.has(t)) || knownTerms.has(normalizedQuery))
    : false
}
