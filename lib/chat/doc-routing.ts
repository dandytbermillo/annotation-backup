/**
 * Doc Retrieval Routing Helpers
 * Part of: Step 3 Refactor (routing handlers extraction)
 *
 * Pure routing functions extracted from chat-navigation-panel.tsx.
 * These determine how user input should be routed (doc, action, bare_noun, llm, clarify_ambiguous).
 */

import {
  normalizeInputForRouting,
  normalizeTitle,
  ACTION_NOUNS,
  DOC_VERBS,
  BARE_META_PHRASES,
  hasQuestionIntent,
  hasActionVerb,
  containsDocInstructionCue,
  isCommandLike,
  hasFuzzyMatch,
  getHighAmbiguityOnlyMatch,
  extractDocQueryTerm,
  getResponseStyle,
  findAllFuzzyMatches,
  stripConversationalPrefix,
} from '@/lib/chat/query-patterns'
import { debugLog } from '@/lib/utils/debug-logger'
import {
  createRoutingTelemetryEvent,
  logRoutingDecision,
  getPatternId,
  RoutingPatternId,
  setMatchedKnownTermTelemetry,
  type RoutingTelemetryEvent,
} from '@/lib/chat/routing-telemetry'
import { getKnownTermsSync } from '@/lib/docs/known-terms-client'
import type { UIContext } from '@/lib/chat/intent-prompt'
import type { ChatMessage, SelectionOption, DocRetrievalState, LastClarificationState } from '@/lib/chat'
import type { PendingOptionState } from '@/lib/chat/chat-routing'

// =============================================================================
// Semantic Fallback Classifier (Gated)
// =============================================================================

const SEMANTIC_FALLBACK_ENABLED = process.env.NEXT_PUBLIC_SEMANTIC_FALLBACK_ENABLED !== 'false'
const SEMANTIC_FALLBACK_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_SEMANTIC_FALLBACK_TIMEOUT_MS ?? 1200)
const SEMANTIC_FALLBACK_TIMEOUT_DOC_STYLE_MS = Number(process.env.NEXT_PUBLIC_SEMANTIC_FALLBACK_TIMEOUT_DOC_STYLE_MS ?? 2000)
const SEMANTIC_FALLBACK_CONFIDENCE_MIN = Number(process.env.NEXT_PUBLIC_SEMANTIC_FALLBACK_CONFIDENCE_MIN ?? 0.7)

// =============================================================================
// HS3: Bounded Formatting (Excerpt-Only LLM Formatting)
// =============================================================================

const HS3_ENABLED = process.env.NEXT_PUBLIC_HS3_ENABLED !== 'false'
const HS3_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_HS3_TIMEOUT_MS ?? 2500)
const HS3_LENGTH_THRESHOLD = Number(process.env.NEXT_PUBLIC_HS3_LENGTH_THRESHOLD ?? 600)

type Hs3FormatStyle = 'short' | 'medium' | 'steps'
type Hs3TriggerReason = 'long_snippet' | 'steps_request' | 'two_chunks'

interface Hs3Result {
  ok: boolean
  latencyMs: number
  formatted?: string
  inputLen?: number
  outputLen?: number
  triggerReason: Hs3TriggerReason
  timeout?: boolean
  error?: boolean
}

/**
 * Detect if user is asking for step-by-step instructions.
 */
function isStepsRequest(input: string): boolean {
  return /\b(walk me through|step by step|steps|how to|how do i)\b/i.test(input)
}

/**
 * Determine HS3 format style based on user input and response policy.
 */
function getHs3FormatStyle(userInput: string, responseStyle: 'short' | 'medium' | 'detailed'): Hs3FormatStyle {
  if (isStepsRequest(userInput)) return 'steps'
  if (responseStyle === 'short') return 'short'
  return 'medium'
}

/**
 * Check if HS3 should be triggered and return the reason.
 */
function shouldTriggerHs3(
  snippetLength: number,
  userInput: string,
  appendedChunkCount: number
): Hs3TriggerReason | null {
  // Trigger 1: Long snippet
  if (snippetLength > HS3_LENGTH_THRESHOLD) return 'long_snippet'

  // Trigger 2: User asked for steps
  if (isStepsRequest(userInput)) return 'steps_request'

  // Trigger 3: Two chunks appended (needs condensation)
  if (appendedChunkCount >= 2) return 'two_chunks'

  return null
}

/**
 * Call the HS3 formatter endpoint with timeout handling.
 */
async function runHs3Formatter(
  snippet: string,
  style: Hs3FormatStyle,
  userQuery: string,
  docTitle?: string
): Promise<{
  ok: boolean
  latencyMs: number
  formatted?: string
  inputLen?: number
  outputLen?: number
  timeout: boolean
  error: boolean
}> {
  const startTime = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), HS3_TIMEOUT_MS)

  try {
    const response = await fetch('/api/chat/format-snippet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snippet,
        style,
        userQuery,
        docTitle,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const data = await response.json()
    return {
      ok: data.ok,
      latencyMs: Date.now() - startTime,
      formatted: data.formatted,
      inputLen: data.inputLen,
      outputLen: data.outputLen,
      timeout: false,
      error: !data.ok && !data.formatted,
    }
  } catch (err) {
    clearTimeout(timeoutId)
    const isAbort = err instanceof Error && err.name === 'AbortError'
    return {
      ok: false,
      latencyMs: Date.now() - startTime,
      timeout: isAbort,
      error: !isAbort,
    }
  }
}

/**
 * Attempt to format a snippet using HS3 if conditions are met.
 * Returns the formatted snippet or the original if HS3 is disabled/fails.
 */
export async function maybeFormatSnippetWithHs3(
  snippet: string,
  userInput: string,
  responseStyle: 'short' | 'medium' | 'detailed',
  appendedChunkCount: number,
  docTitle?: string
): Promise<Hs3Result & { finalSnippet: string }> {
  // Check if HS3 should trigger
  const triggerReason = shouldTriggerHs3(snippet.length, userInput, appendedChunkCount)

  // Return early if no trigger or HS3 disabled
  if (!HS3_ENABLED || !triggerReason) {
    return {
      ok: false,
      latencyMs: 0,
      triggerReason: triggerReason || 'long_snippet', // default for type safety
      finalSnippet: snippet,
    }
  }

  const hs3Style = getHs3FormatStyle(userInput, responseStyle)
  const result = await runHs3Formatter(snippet, hs3Style, userInput, docTitle)

  // Use formatted result if successful, otherwise fall back to raw snippet
  const finalSnippet = result.ok && result.formatted ? result.formatted : snippet

  return {
    ok: result.ok,
    latencyMs: result.latencyMs,
    formatted: result.formatted,
    inputLen: result.inputLen,
    outputLen: result.outputLen,
    triggerReason,
    timeout: result.timeout,
    error: result.error,
    finalSnippet,
  }
}

type SemanticRouteResult = {
  domain: 'app' | 'general'
  intent: 'doc_explain' | 'action' | 'search_notes' | 'other'
  confidence: number
  rewrite?: string
  entities?: {
    docTopic?: string
    widgetName?: string
    noteQuery?: string
  }
  needs_clarification: boolean
  clarify_question?: string
}

async function runSemanticClassifier(
  userMessage: string,
  lastDocSlug?: string,
  lastTopicTokens?: string[],
  timeoutMs: number = SEMANTIC_FALLBACK_TIMEOUT_MS
): Promise<{
  ok: boolean
  latencyMs: number
  timeout: boolean
  result?: SemanticRouteResult
}> {
  const startTime = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch('/api/chat/classify-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userMessage,
        lastDocSlug,
        lastTopicTokens,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const payload = await response.json()
    return {
      ok: !!payload.ok && !!payload.result,
      latencyMs: Date.now() - startTime,
      timeout: false,
      result: payload.result,
    }
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError'
    return {
      ok: false,
      latencyMs: Date.now() - startTime,
      timeout: isTimeout,
    }
  }
}

// =============================================================================
// Route Type
// =============================================================================

/**
 * Route types for doc retrieval routing decision.
 * TD-7: Added 'clarify_ambiguous' for high-ambiguity term clarification.
 */
export type DocRoute = 'doc' | 'action' | 'bare_noun' | 'llm' | 'clarify_ambiguous'

/**
 * TD-7: Feature flag for stricter app-relevance.
 * When enabled, high-ambiguity terms trigger clarification instead of direct routing.
 */
export const STRICT_APP_RELEVANCE_ENABLED = process.env.NEXT_PUBLIC_STRICT_APP_RELEVANCE_HIGH_AMBIGUITY === 'true'

// =============================================================================
// V4 Doc Retrieval Routing Helpers
// Per general-doc-retrieval-routing-plan.md (v4)
// =============================================================================

/**
 * Check if input matches a visible widget title.
 * Per v4 plan: visible widget bypass routes to action.
 * Component-specific: requires UIContext.
 */
export function matchesVisibleWidgetTitle(normalized: string, uiContext?: UIContext | null): boolean {
  const widgets = uiContext?.dashboard?.visibleWidgets
  if (!widgets?.length) return false

  return widgets.some(w => normalizeTitle(w.title) === normalized)
}

/**
 * Check if input is a doc-style query.
 * Per v4 plan: question intent OR doc-verb cues, AND not command-like.
 * Component-specific: requires UIContext for widget matching.
 */
export function isDocStyleQuery(input: string, uiContext?: UIContext | null): boolean {
  const { normalized, tokens } = normalizeInputForRouting(input)

  // Skip bare meta-explain phrases (handled by existing meta-explain handler)
  if (BARE_META_PHRASES.includes(normalized)) {
    return false
  }

  // Action noun bypass
  if (ACTION_NOUNS.has(normalized)) return false

  // Visible widget bypass
  if (matchesVisibleWidgetTitle(normalized, uiContext)) return false

  // Command-like bypass
  if (isCommandLike(normalized)) return false

  // Broad doc-style trigger: instruction cue OR question intent OR doc-verb cue
  if (containsDocInstructionCue(normalized)) return true
  if (hasQuestionIntent(normalized)) return true
  return tokens.some(t => DOC_VERBS.has(t))
}

/**
 * Check if input passes the bare-noun guard for doc retrieval.
 * Per v4 plan: 1-3 tokens, no action verbs, no digits, matches known terms,
 * not action noun, not visible widget.
 */
export function isBareNounQuery(
  input: string,
  uiContext?: UIContext | null,
  knownTerms?: Set<string>
): boolean {
  const { normalized, tokens } = normalizeInputForRouting(input)

  // Guard: 1-3 tokens
  if (tokens.length === 0 || tokens.length > 3) return false

  // Guard: no action verbs
  if (hasActionVerb(normalized)) return false

  // Guard: no digits (e.g., "workspace 6", "note 2")
  if (/\d/.test(normalized)) return false

  // If knownTerms provided, check for match
  if (knownTerms) {
    const matchesKnown =
      tokens.some(t => knownTerms.has(t)) || knownTerms.has(normalized)
    if (!matchesKnown) return false
  }

  // Bypass: action noun
  if (ACTION_NOUNS.has(normalized)) return false

  // Bypass: visible widget
  if (matchesVisibleWidgetTitle(normalized, uiContext)) return false

  // Passes all guards - this is a bare noun that should try retrieval
  return true
}

/**
 * Main routing function for doc retrieval.
 * Per v4 plan: determines if input should go to doc, action, bare_noun, or llm route.
 *
 * Now with full knownTerms integration for app relevance gate.
 */
export function routeDocInput(
  input: string,
  uiContext?: UIContext | null,
  knownTerms?: Set<string>
): DocRoute {
  const { normalized, tokens } = normalizeInputForRouting(input)

  // Step 1: app relevance gate (v4 plan)
  // TD-1: Now relies solely on knownTerms (SSR snapshot guarantees availability)
  let isAppRelevant = false

  if (knownTerms && knownTerms.size > 0) {
    const hasKnownTerm =
      tokens.some(t => knownTerms.has(t)) ||
      knownTerms.has(normalized) ||
      ACTION_NOUNS.has(normalized) ||
      matchesVisibleWidgetTitle(normalized, uiContext)

    if (hasKnownTerm) {
      isAppRelevant = true
    } else {
      // TD-2: Try fuzzy matching as fallback (gated: length >= 5, distance <= 2)
      const hasFuzzy = hasFuzzyMatch(tokens, knownTerms)
      if (hasFuzzy) {
        isAppRelevant = true
      } else {
        // Not app-relevant (no known terms, no fuzzy) - skip retrieval, go to LLM
        return 'llm'
      }
    }
  } else {
    // Edge case: knownTerms not available (should not happen with SSR snapshot)
    console.warn('[routeDocInput] knownTerms not available - SSR snapshot may have failed')
    // Fall through to other routing checks (action, doc-style, etc.)
  }

  // Step 2: visible widget bypass
  if (matchesVisibleWidgetTitle(normalized, uiContext)) return 'action'

  // Step 3: action-noun bypass
  if (ACTION_NOUNS.has(normalized)) return 'action'

  // Step 4: command-like (includes index-like digits)
  if (isCommandLike(normalized)) return 'action'

  // Step 5: doc-style routing (has explicit intent cue)
  if (isDocStyleQuery(input, uiContext)) return 'doc'

  // Step 6: bare noun routing (stricter)
  // TD-7: Check for high-ambiguity terms before routing to bare_noun
  if (isBareNounQuery(input, uiContext, knownTerms)) {
    if (STRICT_APP_RELEVANCE_ENABLED) {
      const highAmbiguityTerm = getHighAmbiguityOnlyMatch(tokens, normalized, knownTerms)
      if (highAmbiguityTerm) {
        // High-ambiguity bare noun without explicit intent → clarification
        return 'clarify_ambiguous'
      }
    }
    return 'bare_noun'
  }

  // Step 7: App-relevant fallback - if query contains known terms but doesn't match
  // specific patterns (e.g., typos like "an you pls tell me what are workspaces action?"),
  // route to doc retrieval anyway. Let keyword matching handle intent extraction.
  // TD-7: Check for high-ambiguity terms before fallback routing
  if (isAppRelevant) {
    if (STRICT_APP_RELEVANCE_ENABLED) {
      const highAmbiguityTerm = getHighAmbiguityOnlyMatch(tokens, normalized, knownTerms)
      if (highAmbiguityTerm) {
        // High-ambiguity fallback without explicit intent → clarification
        return 'clarify_ambiguous'
      }
    }
    return 'doc'
  }

  return 'llm'
}

// =============================================================================
// V4 Response Policy Helpers
// Per general-doc-retrieval-routing-plan.md (v4)
// =============================================================================

/**
 * Format snippet based on response style.
 * Per v4 plan: Match User Effort.
 */
export function formatSnippet(snippet: string, style: 'short' | 'medium' | 'detailed'): string {
  if (!snippet) return snippet

  // Split into sentences
  const sentences = snippet.split(/(?<=[.!?])\s+/).filter(s => s.trim())

  switch (style) {
    case 'short':
      // 1-2 sentences
      return sentences.slice(0, 2).join(' ')
    case 'medium':
      // 2-3 sentences
      return sentences.slice(0, 3).join(' ')
    case 'detailed':
      // Full snippet
      return snippet
    default:
      return snippet
  }
}

/**
 * Add next step offer based on context.
 * Per v4 plan: Offer Next Steps (only when natural).
 */
export function getNextStepOffer(style: 'short' | 'medium' | 'detailed', hasMoreContent: boolean): string {
  if (style === 'short' && hasMoreContent) {
    return '\n\nWant more detail?'
  }
  if (style === 'medium' && hasMoreContent) {
    return '\n\nWant the step-by-step?'
  }
  return ''
}

// =============================================================================
// V5 Hybrid Response Selection Helpers (HS1)
// Per general-doc-retrieval-routing-plan.md (v5)
// =============================================================================

/** V5 configurable thresholds */
export const V5_MIN_BODY_CHARS = 80
export const V5_HEADING_ONLY_MAX_CHARS = 50

/**
 * Strip markdown headers from text for body char count.
 * Removes lines starting with # to get actual body content.
 */
export function stripMarkdownHeadersForUI(text: string): string {
  return text
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .join('\n')
    .trim()
}

/**
 * Deduplicate consecutive identical segments in header path.
 * e.g., "Note Actions > Note Actions > Overview" → "Note Actions > Overview"
 */
export function dedupeHeaderPath(headerPath: string): string {
  const segments = headerPath.split(' > ').map(s => s.trim())
  const deduped: string[] = []

  for (const segment of segments) {
    // Only add if different from the previous segment
    if (deduped.length === 0 || deduped[deduped.length - 1] !== segment) {
      deduped.push(segment)
    }
  }

  return deduped.join(' > ')
}

/**
 * Check if snippet is low quality (heading-only or too short).
 * Per v5 plan: HS1 snippet quality guard.
 */
export function isLowQualitySnippet(snippet: string, isHeadingOnly?: boolean, bodyCharCount?: number): boolean {
  // Use server-provided values if available
  if (isHeadingOnly === true) return true
  if (bodyCharCount !== undefined && bodyCharCount < V5_MIN_BODY_CHARS) return true

  // Fallback: compute locally if server didn't provide
  const strippedBody = stripMarkdownHeadersForUI(snippet)

  // Check if it's just a header
  if (snippet.trim().startsWith('#') && strippedBody.length < V5_HEADING_ONLY_MAX_CHARS) {
    return true
  }

  // Check if too short overall
  if (strippedBody.length < V5_MIN_BODY_CHARS) {
    return true
  }

  return false
}

/**
 * Attempt to upgrade a low-quality snippet via follow-up retrieval.
 * Per v5 plan: HS1 same-doc fallback search.
 * Returns upgraded snippet or null if upgrade failed.
 */
export async function attemptSnippetUpgrade(
  docSlug: string,
  excludeChunkIds: string[]
): Promise<{ snippet: string; chunkIds: string[] } | null> {
  try {
    const response = await fetch('/api/docs/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'chunks',
        query: docSlug, // Use docSlug as query to get related content
        scopeDocSlug: docSlug,
        excludeChunkIds,
      }),
    })

    if (!response.ok) return null

    const result = await response.json()
    if (result.status === 'found' && result.results?.length > 0) {
      // Find first non-heading-only chunk
      for (const chunk of result.results) {
        if (!isLowQualitySnippet(chunk.snippet, chunk.isHeadingOnly, chunk.bodyCharCount)) {
          return {
            snippet: chunk.snippet,
            chunkIds: [chunk.chunkId],
          }
        }
      }
    }

    return null
  } catch (error) {
    console.error('[attemptSnippetUpgrade] Error:', error)
    return null
  }
}

// =============================================================================
// Doc Retrieval Handler
// =============================================================================

/**
 * Handler result type
 */
export interface DocRetrievalHandlerResult {
  handled: boolean
  /** The determined route (for telemetry/debugging) */
  route?: DocRoute
}

/**
 * Context for doc retrieval handler
 */
export interface DocRetrievalHandlerContext {
  // Input
  trimmedInput: string

  // UI context
  uiContext?: UIContext | null

  // State (read-only)
  docRetrievalState: DocRetrievalState | null
  lastClarification: LastClarificationState | null
  clarificationCleared: boolean

  // Telemetry context
  knownTermsFetchStatus: 'snapshot' | 'cached' | 'fetched' | 'fetch_error' | 'fetch_timeout'
  usedCoreAppTermsFallback: boolean

  // Classifier state (from follow-up handler - matches FollowUpHandlerResult)
  classifierCalled: boolean
  classifierResult?: boolean
  classifierTimeout: boolean
  classifierLatencyMs?: number
  classifierError: boolean
  isNewQuestionOrCommandDetected: boolean
  isFollowUp: boolean

  // Callbacks
  addMessage: (message: ChatMessage) => void
  updateDocRetrievalState: (update: Partial<DocRetrievalState>) => void
  setIsLoading: (loading: boolean) => void
  setPendingOptions: (options: PendingOptionState[]) => void
  setPendingOptionsMessageId: (messageId: string) => void
  setLastClarification: (state: LastClarificationState | null) => void
}

/**
 * Handle general doc retrieval routing.
 * Routes queries to doc retrieval, clarification, or LLM based on input analysis.
 *
 * Handles:
 * - docRoute === 'action': logs telemetry, returns not handled (falls through to LLM)
 * - docRoute === 'clarify_ambiguous': shows TD-7 clarification, returns handled
 * - docRoute === 'doc' or 'bare_noun': calls retrieval API, shows results
 * - docRoute === 'llm': shows redirect message (not app-relevant)
 */
export async function handleDocRetrieval(ctx: DocRetrievalHandlerContext): Promise<DocRetrievalHandlerResult> {
  const {
    trimmedInput,
    uiContext,
    docRetrievalState,
    lastClarification,
    clarificationCleared,
    knownTermsFetchStatus,
    usedCoreAppTermsFallback,
    classifierCalled,
    classifierResult,
    classifierTimeout,
    classifierLatencyMs,
    classifierError,
    isNewQuestionOrCommandDetected,
    isFollowUp,
    addMessage,
    updateDocRetrievalState,
    setIsLoading,
    setPendingOptions,
    setPendingOptionsMessageId,
    setLastClarification,
  } = ctx

  // Get knownTerms for app relevance gate
  const knownTerms = getKnownTermsSync()
  const routingStartTime = Date.now()

  // Use the main routing function
  const docRoute = routeDocInput(trimmedInput, uiContext, knownTerms ?? undefined)
  const isDocStyle = docRoute === 'doc'
  const isBareNoun = docRoute === 'bare_noun'

  // Semantic fallback classifier (gated)
  let semanticClassifierCalled = false
  let semanticClassifierTimeout = false
  let semanticClassifierError = false
  let semanticClassifierLatencyMs: number | undefined
  let semanticClassifierResult: SemanticRouteResult | undefined
  let classifierSuggestedRoute: 'doc' | 'action' | null = null
  let classifierRewrite: string | undefined

  if (
    SEMANTIC_FALLBACK_ENABLED &&
    docRoute === 'llm' &&
    (!lastClarification || clarificationCleared) &&
    !isFollowUp
  ) {
    semanticClassifierCalled = true
    // Use higher timeout for doc-style queries that failed app relevance gate
    // (e.g., "describe the settings" has doc-style pattern but "settings" not in knownTerms)
    const isDocStylePattern = isDocStyleQuery(trimmedInput, uiContext)
    const classifierResult = await runSemanticClassifier(
      trimmedInput,
      docRetrievalState?.lastDocSlug,
      docRetrievalState?.lastTopicTokens,
      isDocStylePattern ? SEMANTIC_FALLBACK_TIMEOUT_DOC_STYLE_MS : SEMANTIC_FALLBACK_TIMEOUT_MS
    )
    semanticClassifierLatencyMs = classifierResult.latencyMs
    semanticClassifierTimeout = classifierResult.timeout
    semanticClassifierResult = classifierResult.result

    if (classifierResult.ok && semanticClassifierResult) {
      const isConfident = semanticClassifierResult.confidence >= SEMANTIC_FALLBACK_CONFIDENCE_MIN
      const needsClarification = !!semanticClassifierResult.needs_clarification

      if (semanticClassifierResult.domain === 'app' && isConfident && !needsClarification) {
        if (semanticClassifierResult.intent === 'doc_explain' || semanticClassifierResult.intent === 'search_notes') {
          classifierSuggestedRoute = 'doc'
          classifierRewrite = semanticClassifierResult.rewrite
        } else if (semanticClassifierResult.intent === 'action') {
          classifierSuggestedRoute = 'action'
        }
      }
    } else if (!classifierResult.ok && !classifierResult.timeout) {
      semanticClassifierError = true
    }
  }

  // TD-4: Create telemetry event for tracking
  const { normalized: normalizedQuery, tokens: queryTokens } = normalizeInputForRouting(trimmedInput)
  const telemetryEvent: Partial<RoutingTelemetryEvent> = createRoutingTelemetryEvent(
    trimmedInput,
    normalizedQuery,
    !!knownTerms,
    knownTerms?.size ?? 0,
    docRetrievalState?.lastDocSlug,
    knownTermsFetchStatus,
    usedCoreAppTermsFallback
  )
  telemetryEvent.route_deterministic = docRoute as RoutingTelemetryEvent['route_deterministic']
  telemetryEvent.route_final = docRoute as RoutingTelemetryEvent['route_final']
  telemetryEvent.is_new_question = isNewQuestionOrCommandDetected
  // TD-1: Track whether knownTerms matched this query
  setMatchedKnownTermTelemetry(telemetryEvent, queryTokens, normalizedQuery, knownTerms)
  // TD-2: Track fuzzy matching (only check if no exact match)
  if (knownTerms && !telemetryEvent.matched_known_term) {
    const fuzzyMatches = findAllFuzzyMatches(queryTokens, knownTerms)
    if (fuzzyMatches.length > 0) {
      const bestFuzzy = fuzzyMatches[0]
      telemetryEvent.fuzzy_matched = true
      telemetryEvent.fuzzy_match_token = bestFuzzy.inputToken
      telemetryEvent.fuzzy_match_term = bestFuzzy.matchedTerm
      telemetryEvent.fuzzy_match_distance = bestFuzzy.distance
    } else {
      telemetryEvent.fuzzy_matched = false
    }
  }
  // TD-4: Populate classifier telemetry fields
  telemetryEvent.classifier_called = classifierCalled
  telemetryEvent.classifier_result = classifierResult
  telemetryEvent.classifier_timeout = classifierTimeout
  telemetryEvent.classifier_latency_ms = classifierLatencyMs
  telemetryEvent.classifier_error = classifierError
  telemetryEvent.semantic_classifier_called = semanticClassifierCalled
  telemetryEvent.semantic_classifier_domain = semanticClassifierResult?.domain
  telemetryEvent.semantic_classifier_intent = semanticClassifierResult?.intent
  telemetryEvent.semantic_classifier_confidence = semanticClassifierResult?.confidence
  telemetryEvent.semantic_classifier_needs_clarification = semanticClassifierResult?.needs_clarification
  telemetryEvent.semantic_classifier_latency_ms = semanticClassifierLatencyMs
  telemetryEvent.semantic_classifier_timeout = semanticClassifierTimeout
  telemetryEvent.semantic_classifier_error = semanticClassifierError
  telemetryEvent.matched_pattern_id = getPatternId(
    trimmedInput,
    docRoute,
    isFollowUp,
    isNewQuestionOrCommandDetected,
    classifierCalled,
    stripConversationalPrefix(normalizedQuery) !== normalizedQuery
  )

  // TD-4: Log action route decisions (widget/command bypass)
  if (docRoute === 'action') {
    telemetryEvent.route_final = 'action'
    telemetryEvent.matched_pattern_id = matchesVisibleWidgetTitle(normalizedQuery, uiContext)
      ? RoutingPatternId.ACTION_WIDGET
      : RoutingPatternId.ACTION_COMMAND
    telemetryEvent.routing_latency_ms = Date.now() - routingStartTime
    void logRoutingDecision(telemetryEvent as RoutingTelemetryEvent)
    // Action routes fall through to LLM/tool processing
    return { handled: false, route: docRoute }
  }

  // Semantic classifier suggested action: allow LLM action router to handle
  if (docRoute === 'llm' && classifierSuggestedRoute === 'action') {
    telemetryEvent.route_final = 'action'
    telemetryEvent.matched_pattern_id = RoutingPatternId.SEMANTIC_FALLBACK
    telemetryEvent.routing_latency_ms = Date.now() - routingStartTime
    void logRoutingDecision(telemetryEvent as RoutingTelemetryEvent)
    return { handled: false, route: 'action' }
  }

  // Doc-style gate: queries with doc-style trigger but no known doc terms
  // Per routing plan: run classifier to determine if this is app-docs or general
  const hasKnownDocTermMatch = !!telemetryEvent.matched_known_term || !!telemetryEvent.fuzzy_matched
  let docStyleGateRejected = false

  if (
    SEMANTIC_FALLBACK_ENABLED &&
    isDocStyle &&
    !hasKnownDocTermMatch &&
    (!lastClarification || clarificationCleared) &&
    !isFollowUp
  ) {
    // Call classifier for doc-style queries without known doc terms
    // Use higher timeout for doc-style gate (needs classifier insight for "human" routing)
    semanticClassifierCalled = true
    const docStyleClassifierResult = await runSemanticClassifier(
      trimmedInput,
      docRetrievalState?.lastDocSlug,
      docRetrievalState?.lastTopicTokens,
      SEMANTIC_FALLBACK_TIMEOUT_DOC_STYLE_MS
    )
    semanticClassifierLatencyMs = docStyleClassifierResult.latencyMs
    semanticClassifierTimeout = docStyleClassifierResult.timeout
    semanticClassifierResult = docStyleClassifierResult.result

    // Update telemetry for this classifier call
    telemetryEvent.semantic_classifier_called = true
    telemetryEvent.semantic_classifier_latency_ms = docStyleClassifierResult.latencyMs
    telemetryEvent.semantic_classifier_timeout = docStyleClassifierResult.timeout

    if (docStyleClassifierResult.ok && semanticClassifierResult) {
      telemetryEvent.semantic_classifier_domain = semanticClassifierResult.domain
      telemetryEvent.semantic_classifier_intent = semanticClassifierResult.intent
      telemetryEvent.semantic_classifier_confidence = semanticClassifierResult.confidence
      telemetryEvent.semantic_classifier_needs_clarification = semanticClassifierResult.needs_clarification

      const isDocExplain = semanticClassifierResult.intent === 'doc_explain'
      const isConfident = semanticClassifierResult.confidence >= SEMANTIC_FALLBACK_CONFIDENCE_MIN
      const needsClarification = !!semanticClassifierResult.needs_clarification

      // Only proceed to doc retrieval if classifier confirms doc_explain with confidence
      if (!(isDocExplain && isConfident && !needsClarification)) {
        docStyleGateRejected = true
      }
    } else {
      // Classifier failed or timed out - reject doc retrieval to be safe
      if (!docStyleClassifierResult.ok && !docStyleClassifierResult.timeout) {
        telemetryEvent.semantic_classifier_error = true
      }
      docStyleGateRejected = true
    }

    // If gate rejected, fall back to LLM response
    if (docStyleGateRejected) {
      telemetryEvent.route_final = 'llm'
      telemetryEvent.matched_pattern_id = RoutingPatternId.SEMANTIC_FALLBACK
      telemetryEvent.routing_latency_ms = Date.now() - routingStartTime
      void logRoutingDecision(telemetryEvent as RoutingTelemetryEvent)

      const llmRouteMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: "I'm best at helping with this app. Try asking about workspaces, notes, widgets, or navigation.",
        timestamp: new Date(),
        isError: false,
      }
      addMessage(llmRouteMessage)
      setIsLoading(false)
      return { handled: true, route: 'llm' as DocRoute }
    }
  }

  // TD-7: Handle high-ambiguity clarification
  if (docRoute === 'clarify_ambiguous') {
    const highAmbiguityTerm = getHighAmbiguityOnlyMatch(queryTokens, normalizedQuery, knownTerms ?? undefined)

    // TD-7: Set telemetry fields
    telemetryEvent.strict_app_relevance_triggered = true
    telemetryEvent.strict_term = highAmbiguityTerm || normalizedQuery
    telemetryEvent.route_final = 'clarify'
    telemetryEvent.matched_pattern_id = RoutingPatternId.CLARIFY_HIGH_AMBIGUITY
    telemetryEvent.routing_latency_ms = Date.now() - routingStartTime
    void logRoutingDecision(telemetryEvent as RoutingTelemetryEvent)

    // Build clarification message
    const termDisplay = highAmbiguityTerm
      ? highAmbiguityTerm.charAt(0).toUpperCase() + highAmbiguityTerm.slice(1)
      : trimmedInput
    const messageId = `assistant-${Date.now()}`

    // Create 2 options per TD-7 spec
    const options: SelectionOption[] = [
      {
        id: 'app_feature',
        label: `${termDisplay} (App)`,
        sublabel: 'Ask about this app feature',
        type: 'td7_clarification',
        data: { term: highAmbiguityTerm || normalizedQuery, action: 'doc' as const },
      },
      {
        id: 'something_else',
        label: 'Something else',
        sublabel: 'Not asking about this app',
        type: 'td7_clarification',
        data: { term: highAmbiguityTerm || normalizedQuery, action: 'llm' as const },
      },
    ]

    const assistantMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: `Are you asking about ${termDisplay} in this app?`,
      timestamp: new Date(),
      isError: false,
      options,
    }
    addMessage(assistantMessage)

    // Set clarification state for selection handling
    setPendingOptions(options.map((opt, idx) => ({
      index: idx + 1,
      label: opt.label,
      sublabel: opt.sublabel,
      type: opt.type,
      id: opt.id,
      data: opt.data,
    })))
    setPendingOptionsMessageId(messageId)

    setLastClarification({
      type: 'td7_high_ambiguity',
      originalIntent: 'high_ambiguity_clarification',
      messageId,
      timestamp: Date.now(),
      clarificationQuestion: `Are you asking about ${termDisplay} in this app?`,
      options: options.map(opt => ({
        id: opt.id,
        label: opt.label,
        sublabel: opt.sublabel,
        type: opt.type,
      })),
      metaCount: 0,
    })

    void debugLog({
      component: 'ChatNavigation',
      action: 'td7_clarification_shown',
      metadata: {
        highAmbiguityTerm,
        userInput: trimmedInput,
        options: options.map(o => o.label),
      },
    })

    setIsLoading(false)
    return { handled: true, route: docRoute }
  }

  const shouldRouteToDocs = classifierSuggestedRoute === 'doc' || isDocStyle || isBareNoun
  const effectiveDocStyle = classifierSuggestedRoute === 'doc' ? true : isDocStyle
  const effectiveBareNoun = classifierSuggestedRoute === 'doc' ? false : isBareNoun

  // Handle doc/bare_noun routes with retrieval
  if ((!lastClarification || clarificationCleared) && shouldRouteToDocs) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'general_doc_retrieval',
      metadata: {
        userInput: trimmedInput,
        isDocStyle: effectiveDocStyle,
        isBareNoun: effectiveBareNoun,
        route: classifierSuggestedRoute ?? docRoute,
        classifierRewrite: classifierRewrite,
      },
    })

    try {
      // For doc-style queries, extract the term; for bare nouns, use as-is
      let queryTerm = classifierSuggestedRoute === 'doc'
        ? (classifierRewrite || trimmedInput.trim().toLowerCase())
        : (effectiveDocStyle ? extractDocQueryTerm(trimmedInput) : trimmedInput.trim().toLowerCase())

      // TD-2: Apply fuzzy correction for retrieval
      const { tokens: retrievalTokens } = normalizeInputForRouting(queryTerm)
      let fuzzyCorrectionApplied = false
      const originalQueryTerm = queryTerm

      if (knownTerms && !effectiveBareNoun) {
        const fuzzyMatches = findAllFuzzyMatches(retrievalTokens, knownTerms)
        if (fuzzyMatches.length > 0) {
          let correctedQuery = queryTerm
          for (const fm of fuzzyMatches) {
            correctedQuery = correctedQuery.replace(
              new RegExp(`\\b${fm.inputToken}\\b`, 'gi'),
              fm.matchedTerm
            )
          }
          console.log(`[DocRetrieval] Fuzzy correction (doc-style): "${queryTerm}" → "${correctedQuery}"`)
          queryTerm = correctedQuery
          fuzzyCorrectionApplied = true
        }
      } else if (knownTerms && effectiveBareNoun) {
        const fuzzyMatch = findAllFuzzyMatches(retrievalTokens, knownTerms)[0]
        if (fuzzyMatch) {
          console.log(`[DocRetrieval] Fuzzy correction (bare_noun): "${queryTerm}" → "${fuzzyMatch.matchedTerm}"`)
          queryTerm = fuzzyMatch.matchedTerm
          fuzzyCorrectionApplied = true
        }
      }

      void debugLog({
        component: 'DocRetrieval',
        action: 'fuzzy_correction_check',
        metadata: {
          originalQuery: originalQueryTerm,
          correctedQuery: queryTerm,
          fuzzyCorrectionApplied,
          isDocStyle: effectiveDocStyle,
          isBareNoun: effectiveBareNoun,
          knownTermsAvailable: !!knownTerms,
        },
      })

      telemetryEvent.retrieval_query_corrected = fuzzyCorrectionApplied
      if (classifierSuggestedRoute === 'doc') {
        telemetryEvent.route_final = 'doc'
        telemetryEvent.matched_pattern_id = RoutingPatternId.SEMANTIC_FALLBACK
      }

      const { tokens: queryTokensForRetrieval } = normalizeInputForRouting(queryTerm)
      const responseStyle = getResponseStyle(trimmedInput)

      // Call retrieval API
      const retrieveResponse = await fetch('/api/docs/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryTerm }),
      })

      if (retrieveResponse.ok) {
        const result = await retrieveResponse.json()

        console.log(`[DocRetrieval] query="${queryTerm}" status=${result.status} ` +
          `confidence=${result.confidence?.toFixed(2) ?? 'N/A'} ` +
          `resultsCount=${result.results?.length ?? 0}`)

        // TD-4: Update telemetry with retrieval result
        telemetryEvent.doc_status = result.status as RoutingTelemetryEvent['doc_status']
        telemetryEvent.doc_slug_top = result.results?.[0]?.doc_slug
        telemetryEvent.doc_slug_alt = result.results?.slice(1, 3).map((r: { doc_slug: string }) => r.doc_slug)
        telemetryEvent.routing_latency_ms = Date.now() - routingStartTime
        if (result.status === 'ambiguous' && result.results?.length >= 2) {
          telemetryEvent.matched_pattern_id = RoutingPatternId.AMBIGUOUS_CROSS_DOC
        }
        void logRoutingDecision(telemetryEvent as RoutingTelemetryEvent)

        // Handle: found
        if (result.status === 'found' && result.results?.length > 0) {
          const topResult = result.results[0]
          let rawSnippet = topResult.snippet || topResult.content?.slice(0, 300) || ''
          let chunkIdsShown: string[] = topResult.chunkId ? [topResult.chunkId] : []

          // V5 HS1: Snippet Quality Guard
          if (isLowQualitySnippet(rawSnippet, topResult.isHeadingOnly, topResult.bodyCharCount)) {
            console.log(`[DocRetrieval:HS1] Low quality snippet detected for ${topResult.doc_slug}, attempting upgrade`)

            const upgraded = await attemptSnippetUpgrade(topResult.doc_slug, chunkIdsShown)
            if (upgraded) {
              rawSnippet = upgraded.snippet
              chunkIdsShown = [...chunkIdsShown, ...upgraded.chunkIds]
              console.log(`[DocRetrieval:HS1] Snippet upgraded successfully`)

              void debugLog({
                component: 'ChatNavigation',
                action: 'hs1_snippet_upgrade',
                metadata: { docSlug: topResult.doc_slug, upgradeSuccess: true },
              })
            } else {
              let alternateUsed = false
              for (let i = 1; i < result.results.length; i++) {
                const altResult = result.results[i]
                if (!isLowQualitySnippet(altResult.snippet, altResult.isHeadingOnly, altResult.bodyCharCount)) {
                  rawSnippet = altResult.snippet
                  chunkIdsShown = altResult.chunkId ? [altResult.chunkId] : []
                  console.log(`[DocRetrieval:HS1] Using alternate result ${i}`)
                  alternateUsed = true
                  break
                }
              }

              void debugLog({
                component: 'ChatNavigation',
                action: 'hs1_snippet_upgrade',
                metadata: { docSlug: topResult.doc_slug, upgradeSuccess: false, alternateUsed },
              })
            }
          }

          // Track appended chunks for HS3 trigger detection
          const appendedChunkCount = chunkIdsShown.length

          // Strip markdown headers before HS3 for cleaner output
          const strippedSnippet = stripMarkdownHeadersForUI(rawSnippet)
          const snippetForHs3 = strippedSnippet.length > 0 ? strippedSnippet : rawSnippet

          // V5 HS3: Bounded Formatting (excerpt-only LLM formatting)
          const hs3Result = await maybeFormatSnippetWithHs3(
            snippetForHs3,
            trimmedInput,
            responseStyle,
            appendedChunkCount,
            topResult.title
          )

          // Update telemetry with HS3 results
          if (hs3Result.ok || hs3Result.latencyMs > 0) {
            telemetryEvent.hs3_called = true
            telemetryEvent.hs3_latency_ms = hs3Result.latencyMs
            telemetryEvent.hs3_input_len = hs3Result.inputLen
            telemetryEvent.hs3_output_len = hs3Result.outputLen
            telemetryEvent.hs3_trigger_reason = hs3Result.triggerReason
            telemetryEvent.hs3_timeout = hs3Result.timeout
            telemetryEvent.hs3_error = hs3Result.error

            // Re-log with HS3 telemetry
            void logRoutingDecision(telemetryEvent as RoutingTelemetryEvent)
          }

          // Use HS3 result if successful, otherwise fall back to simple formatting
          // Note: fallback uses stripped snippet for consistent header-free output
          const formattedSnippet = hs3Result.ok && hs3Result.formatted
            ? hs3Result.finalSnippet
            : formatSnippet(snippetForHs3, responseStyle)
          const hasMoreContent = rawSnippet.length > formattedSnippet.length
          const nextStepOffer = getNextStepOffer(responseStyle, hasMoreContent)

          const assistantMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: formattedSnippet + nextStepOffer,
            timestamp: new Date(),
            isError: false,
            // Doc metadata for "Show more" button (per show-more-button-spec.md)
            docSlug: topResult.doc_slug,
            chunkId: chunkIdsShown[0],
            headerPath: topResult.header_path || topResult.title,
          }
          addMessage(assistantMessage)

          updateDocRetrievalState({
            lastDocSlug: topResult.doc_slug,
            lastTopicTokens: queryTokensForRetrieval,
            lastMode: effectiveDocStyle ? 'doc' : 'bare_noun',
            lastChunkIdsShown: chunkIdsShown,
          })

          setIsLoading(false)
          return { handled: true, route: docRoute }
        }

        // Handle: weak
        if (result.status === 'weak' && result.results?.length > 0) {
          const topResult = result.results[0]
          const headerPath = topResult.header_path || topResult.title
          const messageId = `assistant-${Date.now()}`

          const weakOption: SelectionOption = {
            type: 'doc' as const,
            id: topResult.doc_slug,
            label: headerPath,
            sublabel: topResult.category || 'Documentation',
            data: { docSlug: topResult.doc_slug, originalQuery: trimmedInput },
          }

          const assistantMessage: ChatMessage = {
            id: messageId,
            role: 'assistant',
            content: result.clarification || `I think you mean "${headerPath}". Is that right?`,
            timestamp: new Date(),
            isError: false,
            options: [weakOption],
          }
          addMessage(assistantMessage)

          setPendingOptions([{
            index: 1,
            label: weakOption.label,
            sublabel: weakOption.sublabel,
            type: weakOption.type,
            id: weakOption.id,
            data: weakOption.data,
          }])
          setPendingOptionsMessageId(messageId)

          updateDocRetrievalState({
            lastTopicTokens: queryTokensForRetrieval,
            lastMode: effectiveDocStyle ? 'doc' : 'bare_noun',
          })

          setIsLoading(false)
          return { handled: true, route: docRoute }
        }

        // Handle: ambiguous
        if (result.status === 'ambiguous' && result.results?.length >= 2) {
          const messageId = `assistant-${Date.now()}`
          const options: SelectionOption[] = result.results.slice(0, 2).map((r: { doc_slug: string; header_path?: string; title: string; category: string }) => ({
            type: 'doc' as const,
            id: r.doc_slug,
            label: dedupeHeaderPath(r.header_path || r.title),
            sublabel: r.category,
            data: { docSlug: r.doc_slug, originalQuery: trimmedInput },
          }))

          const assistantMessage: ChatMessage = {
            id: messageId,
            role: 'assistant',
            content: result.clarification || `Do you mean "${options[0].label}" or "${options[1].label}"?`,
            timestamp: new Date(),
            isError: false,
            options,
          }
          addMessage(assistantMessage)

          setPendingOptions(options.map((opt, idx) => ({
            index: idx + 1,
            label: opt.label,
            sublabel: opt.sublabel,
            type: opt.type,
            id: opt.id,
            data: opt.data,
          })))
          setPendingOptionsMessageId(messageId)

          setLastClarification({
            type: 'doc_disambiguation',
            originalIntent: 'general_doc_retrieval',
            messageId,
            timestamp: Date.now(),
            clarificationQuestion: result.clarification || 'Which one do you mean?',
            options: options.map(opt => ({
              id: opt.id,
              label: opt.label,
              sublabel: opt.sublabel,
              type: opt.type,
            })),
            metaCount: 0,
          })

          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_shown',
            metadata: { optionCount: options.length, labels: options.map(o => o.label) },
          })

          updateDocRetrievalState({
            lastTopicTokens: queryTokensForRetrieval,
            lastMode: effectiveDocStyle ? 'doc' : 'bare_noun',
          })

          setIsLoading(false)
          return { handled: true, route: docRoute }
        }

        // Handle: no_match
        const noMatchMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.clarification || "I don't see docs for that exact term. Which feature are you asking about?\n(e.g., workspace, notes, widgets)",
          timestamp: new Date(),
          isError: false,
        }
        addMessage(noMatchMessage)

        updateDocRetrievalState({ lastDocSlug: undefined, lastTopicTokens: queryTokensForRetrieval })

        setIsLoading(false)
        return { handled: true, route: docRoute }
      }
    } catch (error) {
      console.error('[ChatNavigation] General doc retrieval error:', error)
      // Fall through to LLM on error
    }
  }

  // LLM route: not app-relevant
  if (docRoute === 'llm' && (!lastClarification || clarificationCleared)) {
    telemetryEvent.route_final = 'llm'
    telemetryEvent.matched_pattern_id = RoutingPatternId.ROUTE_LLM_FALLBACK
    telemetryEvent.routing_latency_ms = Date.now() - routingStartTime
    void logRoutingDecision(telemetryEvent as RoutingTelemetryEvent)

    const llmRouteMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: "I'm best at helping with this app. Try asking about workspaces, notes, widgets, or navigation.",
      timestamp: new Date(),
      isError: false,
    }
    addMessage(llmRouteMessage)
    setIsLoading(false)
    return { handled: true, route: docRoute }
  }

  // Not handled by this handler
  return { handled: false, route: docRoute }
}
