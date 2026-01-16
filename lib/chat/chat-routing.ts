/**
 * Chat Routing Handlers
 * Part of: Step 3 Refactor (routing handlers extraction)
 *
 * Contains extracted routing handlers from chat-navigation-panel.tsx.
 * Each handler returns { handled: boolean } to indicate if it processed the input.
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
import {
  normalizeInputForRouting,
  isCorrectionPhrase,
  isMetaExplainOutsideClarification,
  isPronounFollowUp,
  extractMetaExplainConcept,
  findFuzzyMatch,
} from '@/lib/chat/query-patterns'
import type { ChatMessage, DocRetrievalState, SelectionOption, LastClarificationState } from '@/lib/chat'

// =============================================================================
// Handler Result Type
// =============================================================================

export interface HandlerResult {
  handled: boolean
}

// =============================================================================
// Pending Option State (for setPendingOptions callback)
// =============================================================================

export interface PendingOptionState {
  index: number
  label: string
  sublabel?: string
  type: string
  id: string
  notesScopeFollowUp?: boolean
  data: unknown
}

// =============================================================================
// Handler Context Types
// =============================================================================

/**
 * Base context passed to routing handlers.
 * Bundles the dependencies each handler needs to process input.
 */
export interface RoutingHandlerContext {
  // Input
  trimmedInput: string

  // State (read-only)
  docRetrievalState: DocRetrievalState | null

  // Telemetry context
  knownTermsFetchStatus: 'snapshot' | 'cached' | 'fetched' | 'fetch_error' | 'fetch_timeout'
  usedCoreAppTermsFallback: boolean

  // Callbacks
  addMessage: (message: ChatMessage) => void
  updateDocRetrievalState: (update: Partial<DocRetrievalState>) => void
  setIsLoading: (loading: boolean) => void
}

/**
 * Extended context for meta-explain handler.
 * Includes additional state and callbacks for disambiguation handling.
 */
export interface MetaExplainHandlerContext extends RoutingHandlerContext {
  // Additional state
  messages: ChatMessage[]
  lastClarification: LastClarificationState | null
  clarificationCleared: boolean

  // Additional callbacks
  setPendingOptions: (options: PendingOptionState[]) => void
  setPendingOptionsMessageId: (messageId: string) => void
  setLastClarification: (state: LastClarificationState | null) => void
}

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

// =============================================================================
// Meta-Explain Handler
// =============================================================================

/**
 * Handle meta-explain queries like "what is X", "explain X" outside clarification.
 * Routes to doc retrieval and handles ambiguous results with pills.
 *
 * Trigger: isMetaExplainOutsideClarification(input) AND not in clarification mode
 * Result: Shows explanation from docs or asks for disambiguation
 */
export async function handleMetaExplain(ctx: MetaExplainHandlerContext): Promise<HandlerResult> {
  const {
    trimmedInput,
    docRetrievalState,
    messages,
    lastClarification,
    clarificationCleared,
    knownTermsFetchStatus,
    usedCoreAppTermsFallback,
    addMessage,
    updateDocRetrievalState,
    setIsLoading,
    setPendingOptions,
    setPendingOptionsMessageId,
    setLastClarification,
  } = ctx

  // Check if we should defer to follow-up handler
  const shouldDeferToV4FollowUp = docRetrievalState?.lastDocSlug && isPronounFollowUp(trimmedInput)

  // Check if this is a meta-explain scenario
  if ((lastClarification && !clarificationCleared) || !isMetaExplainOutsideClarification(trimmedInput) || shouldDeferToV4FollowUp) {
    return { handled: false }
  }

  const metaExplainStartTime = Date.now()

  // TD-4: Log meta-explain route telemetry
  const { normalized: normalizedMetaQuery, tokens: metaExplainTokens } = normalizeInputForRouting(trimmedInput)
  const metaExplainKnownTerms = getKnownTermsSync()
  const metaExplainTelemetryEvent: Partial<RoutingTelemetryEvent> = createRoutingTelemetryEvent(
    trimmedInput,
    normalizedMetaQuery,
    !!metaExplainKnownTerms,
    metaExplainKnownTerms?.size ?? 0,
    docRetrievalState?.lastDocSlug,
    knownTermsFetchStatus,
    usedCoreAppTermsFallback
  )
  metaExplainTelemetryEvent.route_deterministic = 'doc'
  metaExplainTelemetryEvent.route_final = 'doc'

  // Determine pattern based on query structure
  if (/^what is\b/i.test(normalizedMetaQuery)) {
    metaExplainTelemetryEvent.matched_pattern_id = RoutingPatternId.DEF_WHAT_IS
  } else if (/^what are\b/i.test(normalizedMetaQuery)) {
    metaExplainTelemetryEvent.matched_pattern_id = RoutingPatternId.DEF_WHAT_ARE
  } else if (/^explain\b/i.test(normalizedMetaQuery)) {
    metaExplainTelemetryEvent.matched_pattern_id = RoutingPatternId.DEF_EXPLAIN
  } else {
    metaExplainTelemetryEvent.matched_pattern_id = RoutingPatternId.DEF_CONVERSATIONAL
  }

  // TD-1: Track term matching on meta-explain path
  setMatchedKnownTermTelemetry(metaExplainTelemetryEvent, metaExplainTokens, normalizedMetaQuery, metaExplainKnownTerms)

  void debugLog({
    component: 'ChatNavigation',
    action: 'meta_explain_outside_clarification',
    metadata: { userInput: trimmedInput },
  })

  try {
    // Extract specific concept or use last assistant message context
    const concept = extractMetaExplainConcept(trimmedInput)
    let queryTerm = concept

    // If no specific concept, try to infer from last assistant message
    if (!queryTerm) {
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
      if (lastAssistant?.content) {
        const contentLower = lastAssistant.content.toLowerCase()
        if (contentLower.includes('dashboard') && contentLower.includes('home')) {
          queryTerm = 'home'
        } else if (contentLower.includes('workspace')) {
          queryTerm = 'workspace'
        } else if (contentLower.includes('recent')) {
          queryTerm = 'recent'
        } else if (contentLower.includes('quick links')) {
          queryTerm = 'quick links'
        } else if (contentLower.includes('navigator')) {
          queryTerm = 'navigator'
        } else if (contentLower.includes('panel') || contentLower.includes('drawer')) {
          queryTerm = 'drawer'
        }
      }
    }

    // TD-2: Apply fuzzy correction for meta-explain queries
    let metaFuzzyCorrectionApplied = false
    if (queryTerm && metaExplainKnownTerms) {
      const fuzzyMatch = findFuzzyMatch(queryTerm, metaExplainKnownTerms)
      if (fuzzyMatch) {
        console.log(`[MetaExplain] Fuzzy correction: "${queryTerm}" → "${fuzzyMatch.matchedTerm}"`)
        queryTerm = fuzzyMatch.matchedTerm
        metaFuzzyCorrectionApplied = true
        metaExplainTelemetryEvent.fuzzy_matched = true
        metaExplainTelemetryEvent.fuzzy_match_token = fuzzyMatch.inputToken
        metaExplainTelemetryEvent.fuzzy_match_term = fuzzyMatch.matchedTerm
        metaExplainTelemetryEvent.fuzzy_match_distance = fuzzyMatch.distance
      }
    }
    metaExplainTelemetryEvent.retrieval_query_corrected = metaFuzzyCorrectionApplied

    // Detect definitional query for concept preference
    const isDefinitionalPattern = !!concept
    const hasActionIntent = isDefinitionalPattern
      ? /\b(action|actions|create|delete|rename|list|open)\b/i.test(trimmedInput)
      : false
    const isDefinitionalQuery = isDefinitionalPattern && !hasActionIntent

    // Call retrieval API
    const retrieveResponse = await fetch('/api/docs/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: queryTerm || trimmedInput,
        mode: 'explain',
        isDefinitionalQuery,
      }),
    })

    if (retrieveResponse.ok) {
      const result = await retrieveResponse.json()

      // TD-4: Update telemetry with retrieval result
      metaExplainTelemetryEvent.doc_status = result.status as RoutingTelemetryEvent['doc_status']
      metaExplainTelemetryEvent.doc_slug_top = result.docSlug || result.options?.[0]?.docSlug
      metaExplainTelemetryEvent.doc_slug_alt = result.options?.slice(1, 3).map((o: { docSlug: string }) => o.docSlug)
      metaExplainTelemetryEvent.routing_latency_ms = Date.now() - metaExplainStartTime

      if (result.status === 'ambiguous' && result.options?.length >= 2) {
        metaExplainTelemetryEvent.matched_pattern_id = RoutingPatternId.AMBIGUOUS_CROSS_DOC
      }
      void logRoutingDecision(metaExplainTelemetryEvent as RoutingTelemetryEvent)

      // Handle ambiguous results with pills
      if (result.status === 'ambiguous' && result.options?.length >= 2) {
        const messageId = `assistant-${Date.now()}`
        const options: SelectionOption[] = result.options.slice(0, 2).map((opt: { docSlug: string; label: string; title: string }) => ({
          type: 'doc' as const,
          id: opt.docSlug,
          label: opt.label || opt.title,
          sublabel: opt.title !== opt.label ? opt.title : undefined,
          data: { docSlug: opt.docSlug },
        }))

        const assistantMessage: ChatMessage = {
          id: messageId,
          role: 'assistant',
          content: result.explanation || `Do you mean "${options[0].label}" or "${options[1].label}"?`,
          timestamp: new Date(),
          isError: false,
          options,
        }
        addMessage(assistantMessage)

        // Set clarification state for pill selection handling
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
          originalIntent: 'meta_explain',
          messageId,
          timestamp: Date.now(),
          clarificationQuestion: result.explanation || 'Which one do you mean?',
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
          action: 'meta_explain_ambiguous_pills',
          metadata: { optionCount: options.length, labels: options.map(o => o.label), source: 'meta_explain' },
          metrics: {
            event: 'clarification_shown',
            optionCount: options.length,
            timestamp: Date.now(),
          },
        })

        setIsLoading(false)
        return { handled: true }
      }

      // Non-ambiguous: show explanation text directly
      const explanation = result.explanation || 'Which part would you like me to explain?'

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: explanation,
        timestamp: new Date(),
        isError: false,
      }
      addMessage(assistantMessage)

      // Wire meta-explain into v4 state for follow-ups
      const metaQueryTerm = queryTerm || trimmedInput
      const { tokens: metaTokens } = normalizeInputForRouting(metaQueryTerm)

      // TD-8: Only set lastDocSlug for confident results
      const isConfidentResult = result.status === 'found' || !result.status
      updateDocRetrievalState({
        lastDocSlug: isConfidentResult ? (result.docSlug || metaQueryTerm) : undefined,
        lastTopicTokens: metaTokens,
        lastMode: 'doc',
        lastChunkIdsShown: isConfidentResult && result.chunkId ? [result.chunkId] : [],
      })

      setIsLoading(false)
      return { handled: true }
    }
  } catch (error) {
    console.error('[ChatNavigation] Meta-explain retrieval error:', error)
  }

  // Fallback if retrieval fails
  const fallbackMessage: ChatMessage = {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    content: 'Which part would you like me to explain?',
    timestamp: new Date(),
    isError: false,
  }
  addMessage(fallbackMessage)
  setIsLoading(false)
  return { handled: true }
}

// =============================================================================
// Follow-Up Handler
// =============================================================================

/**
 * Extended result for follow-up handler that includes classifier state.
 * Classifier state is needed by subsequent routing code for telemetry.
 */
export interface FollowUpHandlerResult extends HandlerResult {
  // Classifier state (used by subsequent routing telemetry)
  classifierCalled: boolean
  classifierResult?: boolean
  classifierTimeout: boolean
  classifierLatencyMs?: number
  classifierError: boolean
}

/**
 * Context for follow-up handler (simpler than meta-explain).
 */
export interface FollowUpHandlerContext extends RoutingHandlerContext {
  // Additional state
  isNewQuestionOrCommandDetected: boolean
}

/**
 * Handle pronoun follow-up queries like "tell me more", "how does it work".
 * Uses HS2 expansion to show additional content from the same doc.
 *
 * Trigger: isPronounFollowUp(input) OR classifier detects follow-up
 * Result: Shows next chunk from same doc or "that's all" message
 */
export async function handleFollowUp(ctx: FollowUpHandlerContext): Promise<FollowUpHandlerResult> {
  const {
    trimmedInput,
    docRetrievalState,
    isNewQuestionOrCommandDetected,
    knownTermsFetchStatus,
    usedCoreAppTermsFallback,
    addMessage,
    updateDocRetrievalState,
    setIsLoading,
  } = ctx

  // Initialize classifier state
  let classifierCalled = false
  let classifierResult: boolean | undefined
  let classifierTimeout = false
  let classifierLatencyMs: number | undefined
  let classifierError = false

  // Check for deterministic follow-up first
  let isFollowUp = isPronounFollowUp(trimmedInput)

  // Classifier backup: If lastDocSlug is set but deterministic check missed,
  // call classifier as backup BEFORE falling to LLM routing
  // Skip classifier for new questions/commands - they are clearly new intents
  if (docRetrievalState?.lastDocSlug && !isFollowUp && !isNewQuestionOrCommandDetected) {
    classifierCalled = true
    const classifierStartTime = Date.now()

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 2000)

      const classifyResponse = await fetch('/api/chat/classify-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: trimmedInput,
          lastDocSlug: docRetrievalState.lastDocSlug,
          lastTopicTokens: docRetrievalState.lastTopicTokens,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      const classifyResultData = await classifyResponse.json()
      classifierLatencyMs = Date.now() - classifierStartTime
      classifierResult = classifyResultData.isFollowUp

      if (classifyResultData.isFollowUp) {
        isFollowUp = true
        void debugLog({
          component: 'ChatNavigation',
          action: 'followup_classifier_backup',
          metadata: {
            userInput: trimmedInput,
            lastDocSlug: docRetrievalState.lastDocSlug,
            latencyMs: classifierLatencyMs,
          },
          metrics: {
            event: 'classifier_followup_detected',
            docSlug: docRetrievalState.lastDocSlug,
            timestamp: Date.now(),
          },
        })
      }
    } catch (error) {
      classifierLatencyMs = Date.now() - classifierStartTime
      if (error instanceof Error && error.name === 'AbortError') {
        classifierTimeout = true
        console.warn('[ChatNavigation] Follow-up classifier timed out')
      } else {
        classifierError = true
        console.error('[ChatNavigation] Follow-up classifier backup error:', error)
      }
      // Continue without classifier result - fall through to normal routing
    }
  }

  // If not a follow-up, return with classifier state for subsequent routing
  if (!docRetrievalState?.lastDocSlug || !isFollowUp) {
    return {
      handled: false,
      classifierCalled,
      classifierResult,
      classifierTimeout,
      classifierLatencyMs,
      classifierError,
    }
  }

  const excludeChunkIds = docRetrievalState.lastChunkIdsShown || []
  const followupStartTime = Date.now()

  // TD-4: Log follow-up route telemetry
  const { normalized: normalizedQuery, tokens: followupTokens } = normalizeInputForRouting(trimmedInput)
  const followupKnownTerms = getKnownTermsSync()
  const followupTelemetryEvent: Partial<RoutingTelemetryEvent> = createRoutingTelemetryEvent(
    trimmedInput,
    normalizedQuery,
    !!followupKnownTerms,
    followupKnownTerms?.size ?? 0,
    docRetrievalState.lastDocSlug,
    knownTermsFetchStatus,
    usedCoreAppTermsFallback
  )
  followupTelemetryEvent.route_deterministic = 'followup'
  followupTelemetryEvent.route_final = 'followup'
  followupTelemetryEvent.followup_detected = true
  followupTelemetryEvent.classifier_called = classifierCalled
  followupTelemetryEvent.classifier_result = classifierResult
  followupTelemetryEvent.classifier_timeout = classifierTimeout
  followupTelemetryEvent.classifier_latency_ms = classifierLatencyMs
  followupTelemetryEvent.classifier_error = classifierError
  followupTelemetryEvent.matched_pattern_id = classifierCalled && classifierResult
    ? RoutingPatternId.FOLLOWUP_CLASSIFIER
    : isPronounFollowUp(trimmedInput)
      ? RoutingPatternId.FOLLOWUP_PRONOUN
      : RoutingPatternId.FOLLOWUP_TELL_ME_MORE
  setMatchedKnownTermTelemetry(followupTelemetryEvent, followupTokens, normalizedQuery, followupKnownTerms)
  followupTelemetryEvent.routing_latency_ms = Date.now() - followupStartTime
  void logRoutingDecision(followupTelemetryEvent as RoutingTelemetryEvent)

  void debugLog({
    component: 'ChatNavigation',
    action: 'doc_followup_v5',
    metadata: {
      userInput: trimmedInput,
      lastDocSlug: docRetrievalState.lastDocSlug,
      excludeChunkIds,
    },
    metrics: {
      event: 'followup_expansion',
      docSlug: docRetrievalState.lastDocSlug,
      excludedChunks: excludeChunkIds.length,
      timestamp: Date.now(),
    },
  })

  try {
    // V5 HS2: Use mode='chunks' with excludeChunkIds for same-doc expansion
    let retrieveResponse = await fetch('/api/docs/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'chunks',
        query: docRetrievalState.lastDocSlug,
        scopeDocSlug: docRetrievalState.lastDocSlug,
        excludeChunkIds,
      }),
    })

    let result = retrieveResponse.ok ? await retrieveResponse.json() : null

    // If scoped retrieval fails, try query-based without scope
    if (!result || result.status === 'no_match' || !result.results?.length) {
      retrieveResponse = await fetch('/api/docs/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'chunks',
          query: docRetrievalState.lastDocSlug,
          excludeChunkIds,
        }),
      })
      result = retrieveResponse.ok ? await retrieveResponse.json() : null
    }

    if (result && (result.status === 'found' || result.status === 'weak') && result.results?.length > 0) {
      // V5 HS2: Find first non-heading-only chunk (quality filter)
      let selectedResult = null
      for (const chunk of result.results) {
        if (!isLowQualitySnippet(chunk.snippet, chunk.isHeadingOnly, chunk.bodyCharCount)) {
          selectedResult = chunk
          break
        }
      }

      // If all results are low quality, use first one anyway
      if (!selectedResult) {
        selectedResult = result.results[0]
        console.log('[DocRetrieval:HS2] All follow-up chunks are low quality, using first')
      }

      const snippet = selectedResult.snippet || selectedResult.content?.slice(0, 500) || ''
      const newChunkId = selectedResult.chunkId

      // Check if we actually have new content
      if (snippet.length > 0) {
        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: snippet + (snippet.length >= 500 ? '...' : ''),
          timestamp: new Date(),
          isError: false,
        }
        addMessage(assistantMessage)

        // V5: Update lastChunkIdsShown to include newly shown chunk
        if (newChunkId) {
          updateDocRetrievalState({
            lastChunkIdsShown: [...excludeChunkIds, newChunkId],
          })
        }

        setIsLoading(false)
        return {
          handled: true,
          classifierCalled,
          classifierResult,
          classifierTimeout,
          classifierLatencyMs,
          classifierError,
        }
      }
    }

    // No more content in this doc - inform user
    const exhaustedMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: "That's all I have on this topic. What else would you like to know?",
      timestamp: new Date(),
      isError: false,
    }
    addMessage(exhaustedMessage)
    setIsLoading(false)
    return {
      handled: true,
      classifierCalled,
      classifierResult,
      classifierTimeout,
      classifierLatencyMs,
      classifierError,
    }
  } catch (error) {
    console.error('[ChatNavigation] Doc follow-up error:', error)
  }

  // Fallback if follow-up fails
  const fallbackMessage: ChatMessage = {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    content: "I don't have more details on that. What else would you like to know?",
    timestamp: new Date(),
    isError: false,
  }
  addMessage(fallbackMessage)
  setIsLoading(false)
  return {
    handled: true,
    classifierCalled,
    classifierResult,
    classifierTimeout,
    classifierLatencyMs,
    classifierError,
  }
}

// =============================================================================
// Helper: Low Quality Snippet Check
// =============================================================================

/**
 * Check if a snippet is low quality (heading-only or too short).
 * Used by HS1/HS2 quality filters.
 */
function isLowQualitySnippet(
  snippet: string,
  isHeadingOnly?: boolean,
  bodyCharCount?: number
): boolean {
  // Explicit heading-only flag from backend
  if (isHeadingOnly) return true
  // Body too short (less than 50 chars of actual content)
  if (bodyCharCount !== undefined && bodyCharCount < 50) return true
  // Fallback: check snippet length
  if (snippet.length < 50) return true
  return false
}
