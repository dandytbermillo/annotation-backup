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
  isAffirmationPhrase,
  isRejectionPhrase,
  isMetaPhrase,
  isNewQuestionOrCommand,
  hasFuzzyMatch,
} from '@/lib/chat/query-patterns'
import { isBareNounQuery, maybeFormatSnippetWithHs3, dedupeHeaderPath, stripMarkdownHeadersForUI } from '@/lib/chat/doc-routing'
import type { UIContext } from '@/lib/chat/intent-prompt'
import type { ChatMessage, DocRetrievalState, SelectionOption, LastClarificationState } from '@/lib/chat'
import type { ClarificationOption } from '@/lib/chat/chat-navigation-context'
import { matchVisiblePanelCommand, type VisibleWidget } from '@/lib/chat/panel-command-matcher'

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

  // Check if we should defer to follow-up handler (docs or notes context)
  const hasActiveContext = docRetrievalState?.lastDocSlug ||
    (docRetrievalState?.lastRetrievalCorpus === 'notes' && docRetrievalState?.lastItemId)
  const shouldDeferToFollowUp = hasActiveContext && isPronounFollowUp(trimmedInput)

  // Check if this is a meta-explain scenario
  if ((lastClarification && !clarificationCleared) || !isMetaExplainOutsideClarification(trimmedInput) || shouldDeferToFollowUp) {
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
          label: dedupeHeaderPath(opt.label || opt.title),
          sublabel: opt.title !== opt.label ? opt.title : undefined,
          data: { docSlug: opt.docSlug, originalQuery: trimmedInput },
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

      // Handle weak results with single-pill confirmation (parity with doc-routing)
      if (result.status === 'weak' && result.options?.length > 0) {
        const weakOpt = result.options[0]
        const messageId = `assistant-${Date.now()}`

        const weakOption: SelectionOption = {
          type: 'doc' as const,
          id: weakOpt.docSlug,
          label: weakOpt.label,
          sublabel: weakOpt.category || weakOpt.title,
          data: { docSlug: weakOpt.docSlug, originalQuery: trimmedInput },
        }

        const assistantMessage: ChatMessage = {
          id: messageId,
          role: 'assistant',
          content: result.explanation || `I think you mean "${weakOpt.label}". Is that right?`,
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

        setLastClarification({
          type: 'doc_disambiguation',
          originalIntent: 'meta_explain',
          messageId,
          timestamp: Date.now(),
          clarificationQuestion: assistantMessage.content,
          options: [{
            id: weakOption.id,
            label: weakOption.label,
            sublabel: weakOption.sublabel,
            type: weakOption.type,
          }],
          metaCount: 0,
        })

        void debugLog({
          component: 'ChatNavigation',
          action: 'meta_explain_weak_pill',
          metadata: { label: weakOption.label, source: 'meta_explain' },
          metrics: {
            event: 'clarification_shown',
            optionCount: 1,
            timestamp: Date.now(),
          },
        })

        // TD-8: do NOT set lastDocSlug on weak; keep tokens for context
        const metaQueryTerm = queryTerm || trimmedInput
        const { tokens: metaTokens } = normalizeInputForRouting(metaQueryTerm)
        updateDocRetrievalState({
          lastTopicTokens: metaTokens,
          lastMode: 'doc',
        })

        setIsLoading(false)
        return { handled: true }
      }

      // Non-ambiguous: show explanation text directly (with HS3 formatting if applicable)
      const rawExplanation = result.explanation || 'Which part would you like me to explain?'

      // TD-5: Apply HS3 bounded formatting for long/steps responses
      const metaQueryTerm = queryTerm || trimmedInput

      // Strip markdown headers before HS3 for cleaner output
      const strippedExplanation = stripMarkdownHeadersForUI(rawExplanation)
      const explanationForHs3 = strippedExplanation.length > 0 ? strippedExplanation : rawExplanation

      // Optional: Enable HS3 for short meta-explain definitions via flag
      // Only applies to snippets > 100 chars (very short ones don't need formatting)
      const metaExplainShortEnabled = process.env.NEXT_PUBLIC_HS3_META_EXPLAIN_SHORT === 'true'
      const shouldForceHs3 = metaExplainShortEnabled && explanationForHs3.length > 100

      const hs3Result = await maybeFormatSnippetWithHs3(
        explanationForHs3,
        trimmedInput,
        'short', // Meta-explain uses short style
        shouldForceHs3 ? 2 : 1, // Force two_chunks trigger if flag enabled and snippet > 100 chars
        result.docSlug || metaQueryTerm
      )

      const explanation = hs3Result.finalSnippet

      // Log HS3 telemetry if it was called
      if (hs3Result.ok) {
        await debugLog({
          component: 'ChatRouting',
          action: 'meta_explain_hs3',
          content_preview: `HS3 formatted: ${explanation.slice(0, 50)}...`,
          forceLog: true,
          metadata: {
            trigger_reason: hs3Result.triggerReason,
            latency_ms: hs3Result.latencyMs,
            input_len: hs3Result.inputLen,
            output_len: hs3Result.outputLen,
            doc_slug: result.docSlug,
          },
        })
      }

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: explanation,
        timestamp: new Date(),
        isError: false,
        // Doc metadata for "Show more" button (per show-more-button-spec.md)
        docSlug: result.docSlug,
        chunkId: result.chunkId,
        headerPath: metaQueryTerm, // Use query term as header path fallback
      }
      addMessage(assistantMessage)

      // Wire meta-explain into v4 state for follow-ups
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

  // Phase 2: Handle notes follow-up (before docs follow-up check)
  // If user selected notes and says "tell me more", continue within notes corpus
  if (
    docRetrievalState?.lastRetrievalCorpus === 'notes' &&
    docRetrievalState?.lastItemId &&
    isFollowUp
  ) {
    setIsLoading(true)
    try {
      const excludeChunkIds = docRetrievalState.lastChunkIdsShown || []

      // Query notes corpus with excludeChunkIds for expansion
      const response = await fetch('/api/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          corpus: 'notes',
          resourceId: docRetrievalState.lastItemId,
          excludeChunkIds,
        }),
      })

      const result = response.ok ? await response.json() : null

      if (result && result.results?.length > 0) {
        const topResult = result.results[0]
        const message: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: `From your notes - **${topResult.title}**:\n\n${topResult.snippet || 'Here\'s more from your notes.'}`,
          timestamp: new Date(),
          // Notes metadata for "Show more" button
          itemId: docRetrievalState.lastItemId,
          itemName: topResult.title,
          chunkId: topResult.chunkId,
          corpus: 'notes',
        }
        addMessage(message)

        // Update state - append new chunk ID
        const newChunkIds = topResult.chunkId
          ? [...excludeChunkIds, topResult.chunkId]
          : excludeChunkIds

        updateDocRetrievalState({
          lastRetrievalCorpus: 'notes',
          lastItemId: docRetrievalState.lastItemId,
          lastResourceId: docRetrievalState.lastItemId,
          lastChunkIdsShown: newChunkIds,
          timestamp: Date.now(),
        })

        void debugLog({
          component: 'ChatNavigation',
          action: 'notes_followup_expanded',
          content_preview: `Notes follow-up: ${topResult.title}`,
          forceLog: true,
          metadata: {
            last_item_id: docRetrievalState.lastItemId,
            chunks_shown: newChunkIds.length,
          },
        })

        return {
          handled: true,
          classifierCalled,
          classifierResult,
          classifierTimeout,
          classifierLatencyMs,
          classifierError,
        }
      }

      // No more content from notes
      const message: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: "That's all I have from this note. Would you like to search for something else?",
        timestamp: new Date(),
      }
      addMessage(message)

      void debugLog({
        component: 'ChatNavigation',
        action: 'notes_followup_exhausted',
        content_preview: 'No more notes content',
        forceLog: true,
        metadata: {
          last_item_id: docRetrievalState.lastItemId,
        },
      })

      return {
        handled: true,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
      }
    } catch (error) {
      console.error('[ChatNavigation] Notes follow-up error:', error)
      // Fall through to docs on error
    } finally {
      setIsLoading(false)
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

    const result = retrieveResponse.ok ? await retrieveResponse.json() : null

    // Note: We intentionally do NOT fallback to unscoped search when scoped retrieval fails.
    // The unscoped fallback was causing off-topic results (e.g., "Sprint 6" appearing when
    // asking about "workspace") because it would match any doc containing the query term.
    // Better to return "That's all I have" than drift into unrelated documents.

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

      const rawSnippet = selectedResult.snippet || selectedResult.content?.slice(0, 500) || ''
      const newChunkId = selectedResult.chunkId
      const headerPath = selectedResult.header_path || selectedResult.title || ''

      // Check if we actually have new content
      if (rawSnippet.length > 0) {
        // Detect list-type sections that should be shown verbatim, not reformatted
        // to avoid misleading "you're interested in..." conversational inferences
        // Covers: "Examples", "Example questions", "Related concepts", "Related topics"
        const isExampleSection = /\bexample/i.test(headerPath)
        const isRelatedSection = /\brelated/i.test(headerPath)
        const isLiteralListSection = isExampleSection || isRelatedSection

        // Strip markdown headers before HS3 for cleaner output
        const strippedSnippet = stripMarkdownHeadersForUI(rawSnippet)
        const snippetForHs3 = strippedSnippet.length > 0 ? strippedSnippet : rawSnippet

        let hs3Result: { ok: boolean; finalSnippet: string; latencyMs: number; inputLen?: number; outputLen?: number; triggerReason?: 'long_snippet' | 'steps_request' | 'two_chunks'; timeout?: boolean; error?: boolean }

        if (isLiteralListSection) {
          // List-type sections: format as literal list, skip HS3 to avoid misleading rewrites
          const listLines = snippetForHs3
            .split('\n')
            .map((line: string) => line.trim())
            .filter((line: string) => line.length > 0)

          // Choose appropriate intro based on section type
          const introText = isExampleSection ? 'Here are some examples' : 'Related topics'
          const singleIntro = isExampleSection ? 'Example' : 'Related'

          const formattedList = listLines.length > 1
            ? `${introText}:\n${listLines.map((l: string) => `• ${l.replace(/^[-•]\s*/, '').replace(/^["']|["']$/g, '')}`).join('\n')}`
            : `${singleIntro}: ${listLines[0]?.replace(/^[-•]\s*/, '').replace(/^["']|["']$/g, '') || snippetForHs3}`

          hs3Result = {
            ok: false, // Mark as not HS3-processed for telemetry
            finalSnippet: formattedList,
            latencyMs: 0,
            triggerReason: undefined, // Not HS3-processed
          }
        } else {
          // Normal content: apply HS3 bounded formatting
          // appendedChunkCount = total chunks shown including this one
          const appendedChunkCount = excludeChunkIds.length + 1

          // Guard: Don't pass vague pronoun-style queries to HS3 (e.g., "tell me more", "continue")
          // These cause HS3 to say "I don't see that info" since they're not real questions
          const isVagueFollowup = /^(tell me more|more|continue|go on|keep going|and\??|yes|ok|okay)$/i.test(trimmedInput.trim())
          const hs3Query = isVagueFollowup ? '' : trimmedInput

          hs3Result = await maybeFormatSnippetWithHs3(
            snippetForHs3,
            hs3Query,
            'medium', // Follow-ups typically want more detail
            appendedChunkCount,
            docRetrievalState.lastDocSlug
          )
        }

        // Update telemetry with HS3 results (re-log like doc-routing)
        if (hs3Result.ok || hs3Result.latencyMs > 0) {
          followupTelemetryEvent.hs3_called = true
          followupTelemetryEvent.hs3_latency_ms = hs3Result.latencyMs
          followupTelemetryEvent.hs3_input_len = hs3Result.inputLen
          followupTelemetryEvent.hs3_output_len = hs3Result.outputLen
          followupTelemetryEvent.hs3_trigger_reason = hs3Result.triggerReason
          followupTelemetryEvent.hs3_timeout = hs3Result.timeout
          followupTelemetryEvent.hs3_error = hs3Result.error
          void logRoutingDecision(followupTelemetryEvent as RoutingTelemetryEvent)
        }

        const formattedContent = hs3Result.finalSnippet

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: formattedContent + (rawSnippet.length >= 500 && !hs3Result.ok ? '...' : ''),
          timestamp: new Date(),
          isError: false,
          // Doc metadata for "Show more" button (per show-more-button-spec.md)
          docSlug: docRetrievalState.lastDocSlug,
          chunkId: newChunkId,
          headerPath: headerPath,
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

// =============================================================================
// Clarification Intercept Handler
// =============================================================================

/**
 * Result from clarification intercept handler
 */
export interface ClarificationInterceptResult extends HandlerResult {
  /** Whether clarification was cleared (for downstream handlers) */
  clarificationCleared: boolean
  /** Whether new question/command was detected */
  isNewQuestionOrCommandDetected: boolean
}

/**
 * Context for clarification intercept handler
 */
export interface ClarificationInterceptContext {
  // Input
  trimmedInput: string

  // State (read-only)
  lastClarification: LastClarificationState | null
  lastSuggestion: unknown | null  // Any truthy value indicates active suggestion
  pendingOptions: PendingOptionState[]
  uiContext?: UIContext | null
  currentEntryId?: string

  // Callbacks
  addMessage: (message: ChatMessage) => void
  setLastClarification: (state: LastClarificationState | null) => void
  setIsLoading: (loading: boolean) => void
  setPendingOptions: (options: PendingOptionState[]) => void
  setPendingOptionsMessageId: (messageId: string | null) => void
  setPendingOptionsGraceCount: (count: number) => void
  setNotesScopeFollowUpActive: (active: boolean) => void
  handleSelectOption: (option: SelectionOption) => void
}

/**
 * Check if input is a selection-only pattern (ordinal or single letter).
 * Per llm-chat-context-first-plan.md: Only intercept pure selection patterns.
 */
function isSelectionOnly(
  input: string,
  optionCount: number,
  optionLabels: string[]
): { isSelection: boolean; index?: number } {
  const normalized = input.trim().toLowerCase()

  // Option phrases: option 1, option 2, the first one, the second one
  // Plus ordinals and single letters
  const selectionPattern = /^(first|second|third|fourth|fifth|last|[1-9]|option\s*[1-9]|the\s+(first|second|third|fourth|fifth|last)\s+one|[a-e])$/i

  if (!selectionPattern.test(normalized)) {
    return { isSelection: false }
  }

  // Map input to index
  let index: number | undefined

  // Check ordinals first
  const ordinalMap: Record<string, number> = {
    'first': 0, 'second': 1, 'third': 2, 'fourth': 3, 'fifth': 4,
    'the first one': 0, 'the second one': 1, 'the third one': 2,
    'the fourth one': 3, 'the fifth one': 4, 'the last one': optionCount - 1,
    'last': optionCount - 1,
  }

  if (ordinalMap[normalized] !== undefined) {
    index = ordinalMap[normalized]
  } else if (/^[1-9]$/.test(normalized)) {
    index = parseInt(normalized, 10) - 1
  } else if (/^option\s*[1-9]$/i.test(normalized)) {
    const num = normalized.match(/[1-9]/)?.[0]
    if (num) index = parseInt(num, 10) - 1
  } else if (/^[a-e]$/i.test(normalized)) {
    index = normalized.charCodeAt(0) - 'a'.charCodeAt(0)
    // Letter doesn't match any option - not a selection
    if (index >= optionCount) {
      return { isSelection: false }
    }
  }

  // Validate index is within bounds
  if (index !== undefined && index >= 0 && index < optionCount) {
    return { isSelection: true, index }
  }

  return { isSelection: false }
}

/**
 * Handle clarification mode intercept.
 * When clarification is active, ALL input goes through this handler first.
 * Clarification handling runs BEFORE new-intent detection to avoid premature exit.
 *
 * Handles:
 * - Tier 1: Local affirmation/rejection/meta checks
 * - Tier 1d: Ordinal selection for multi-option clarifications
 * - Tier 2: LLM interpretation for unclear responses
 *
 * Returns { handled: true } if input was processed here, false to continue routing.
 */
export async function handleClarificationIntercept(
  ctx: ClarificationInterceptContext
): Promise<ClarificationInterceptResult> {
  const {
    trimmedInput,
    lastClarification,
    lastSuggestion,
    pendingOptions,
    uiContext,
    currentEntryId,
    addMessage,
    setLastClarification,
    setIsLoading,
    setPendingOptions,
    setPendingOptionsMessageId,
    setPendingOptionsGraceCount,
    setNotesScopeFollowUpActive,
    handleSelectOption,
  } = ctx

  // TD-3: Check for bare noun new intent
  const bareNounKnownTerms = getKnownTermsSync()
  const isBareNounNewIntent = bareNounKnownTerms
    ? isBareNounQuery(trimmedInput, uiContext, bareNounKnownTerms)
    : false

  // TD-2: Check if input fuzzy-matches a known term (for typos like "wrkspace")
  const { tokens: clarificationTokens } = normalizeInputForRouting(trimmedInput)
  const isFuzzyMatchNewIntent = bareNounKnownTerms
    ? hasFuzzyMatch(clarificationTokens, bareNounKnownTerms)
    : false

  // Detect new question/command
  const isNewQuestionOrCommandDetected =
    isNewQuestionOrCommand(trimmedInput) ||
    trimmedInput.endsWith('?') ||
    isBareNounNewIntent ||
    isFuzzyMatchNewIntent

  // Track if clarification was cleared within this execution cycle
  let clarificationCleared = false

  // Check if we should enter clarification mode
  const hasClarificationContext = lastClarification?.nextAction ||
    (lastClarification?.options && lastClarification.options.length > 0)

  if (!lastSuggestion && hasClarificationContext) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'clarification_mode_intercept',
      metadata: {
        userInput: trimmedInput,
        nextAction: lastClarification?.nextAction,
        hasOptions: !!(lastClarification?.options?.length),
        clarificationType: lastClarification?.type,
      },
    })

    // Helper: Execute nextAction (show workspace picker for notes_scope)
    const executeNextAction = async () => {
      setLastClarification(null)

      try {
        const workspacesUrl = currentEntryId
          ? `/api/dashboard/workspaces/search?entryId=${currentEntryId}&limit=10`
          : `/api/dashboard/workspaces/search?limit=10`
        const workspacesResponse = await fetch(workspacesUrl)
        if (!workspacesResponse.ok) {
          throw new Error('Failed to fetch workspaces')
        }
        const workspacesData = await workspacesResponse.json()
        const workspaces = workspacesData.workspaces || []

        if (workspaces.length === 0) {
          const noWorkspacesMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: 'No workspaces found. Create a workspace first to view open notes.',
            timestamp: new Date(),
            isError: false,
          }
          addMessage(noWorkspacesMessage)
          return
        }

        const messageId = `assistant-${Date.now()}`
        const workspaceOptions: SelectionOption[] = workspaces.map((ws: { id: string; name: string; isDefault?: boolean; noteCount?: number; entryName?: string }) => ({
          type: 'workspace' as const,
          id: ws.id,
          label: ws.isDefault ? `${ws.name} (Default)` : ws.name,
          sublabel: ws.entryName || `${ws.noteCount || 0} notes`,
          data: ws,
        }))

        const workspacePickerMessage: ChatMessage = {
          id: messageId,
          role: 'assistant',
          content: 'Sure — which workspace?',
          timestamp: new Date(),
          isError: false,
          options: workspaceOptions,
        }
        addMessage(workspacePickerMessage)

        setPendingOptions(workspaceOptions.map((opt, idx) => ({
          index: idx + 1,
          ...opt,
        })) as PendingOptionState[])
        setPendingOptionsMessageId(messageId)
        setPendingOptionsGraceCount(0)
        setNotesScopeFollowUpActive(true)

        setLastClarification({
          type: 'option_selection',
          originalIntent: 'list_open_notes',
          messageId,
          timestamp: Date.now(),
          clarificationQuestion: 'Sure — which workspace?',
          options: workspaceOptions.map(opt => ({
            id: opt.id,
            label: opt.label,
            sublabel: opt.sublabel,
            type: opt.type,
          })),
          metaCount: 0,
        })
      } catch (error) {
        console.error('[ChatNavigation] Failed to fetch workspaces for clarification:', error)
        const errorMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'Sorry, I couldn\'t load workspaces. Please try again.',
          timestamp: new Date(),
          isError: true,
        }
        addMessage(errorMessage)
      }
    }

    // Helper: Handle rejection/cancel
    const handleRejection = () => {
      setLastClarification(null)
      setPendingOptions([])
      setPendingOptionsMessageId(null)
      setPendingOptionsGraceCount(0)
      const cancelMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: 'Okay — let me know what you want to do.',
        timestamp: new Date(),
        isError: false,
      }
      addMessage(cancelMessage)
    }

    // Helper: Handle unclear response
    // Per pending-options-resilience-fix.md: Re-show options on no-match instead of generic fallback
    const handleUnclear = (): boolean => {
      if (isNewQuestionOrCommandDetected) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'clarification_exit_unclear_new_intent',
          metadata: { userInput: trimmedInput },
        })
        setLastClarification(null)
        return true
      }

      // Per pending-options-resilience-fix.md: If options exist, re-show them with pills
      // instead of showing a generic yes/no message
      if (lastClarification?.type === 'option_selection' && lastClarification.options && lastClarification.options.length > 0) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'clarification_unclear_reshow_options',
          metadata: { userInput: trimmedInput, optionsCount: lastClarification.options.length },
        })

        const reaskMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'Please choose one of the options:',
          timestamp: new Date(),
          isError: false,
          options: lastClarification.options.map(opt => ({
            type: opt.type as SelectionOption['type'],
            id: opt.id,
            label: opt.label,
            sublabel: opt.sublabel,
            data: {} as SelectionOption['data'],
          })),
        }
        addMessage(reaskMessage)
        return false
      }

      // Fallback for non-option clarifications (yes/no questions)
      const reaskMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: 'I didn\'t quite catch that. Would you like to open a workspace to see your notes? (yes/no)',
        timestamp: new Date(),
        isError: false,
      }
      addMessage(reaskMessage)
      return false
    }

    // Helper: Handle META response (explanation request)
    const handleMeta = () => {
      const currentMetaCount = lastClarification!.metaCount ?? 0
      const META_LOOP_LIMIT = 2

      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_meta_response',
        metadata: { userInput: trimmedInput, metaCount: currentMetaCount },
      })

      if (currentMetaCount >= META_LOOP_LIMIT) {
        const escapeMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'I can show both options, or we can skip this for now. What would you like?',
          timestamp: new Date(),
          isError: false,
        }
        addMessage(escapeMessage)
        setLastClarification({
          ...lastClarification!,
          metaCount: 0,
        })
        return
      }

      let explanation: string
      let messageOptions: ClarificationOption[] | undefined

      if (lastClarification!.options && lastClarification!.options.length > 0) {
        const optionsList = lastClarification!.options
          .map((opt, i) => `${i + 1}. ${opt.label}${opt.sublabel ? ` (${opt.sublabel})` : ''}`)
          .join('\n')
        explanation = `Here are your options:\n${optionsList}\n\nJust say a number or name to select one.`
        messageOptions = lastClarification!.options
      } else if (lastClarification!.type === 'notes_scope') {
        explanation = 'I\'m asking because notes are organized within workspaces. To show which notes are open, I need to know which workspace to check. Would you like to pick a workspace? (yes/no)'
      } else {
        explanation = `I'm asking: ${lastClarification!.clarificationQuestion ?? 'Would you like to proceed?'} (yes/no)`
      }

      const metaMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: explanation,
        timestamp: new Date(),
        isError: false,
        options: messageOptions ? messageOptions.map(opt => ({
          type: opt.type as SelectionOption['type'],
          id: opt.id,
          label: opt.label,
          sublabel: opt.sublabel,
          data: {} as SelectionOption['data'],
        })) : undefined,
      }
      addMessage(metaMessage)

      setLastClarification({
        ...lastClarification!,
        metaCount: currentMetaCount + 1,
      })
    }

    // Tier 1: Local affirmation check
    const hasMultipleOptions = lastClarification!.options && lastClarification!.options.length > 0
    if (isAffirmationPhrase(trimmedInput) && !hasMultipleOptions) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_tier1_affirmation',
        metadata: { userInput: trimmedInput },
      })
      await executeNextAction()
      setIsLoading(false)
      return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
    }

    // Tier 1b: Local rejection check
    if (isRejectionPhrase(trimmedInput)) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_tier1_rejection',
        metadata: { userInput: trimmedInput },
      })
      handleRejection()
      setIsLoading(false)
      return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
    }

    // Tier 1b.3: Label matching for option selection (BEFORE new-intent escape)
    // Per pending-options-resilience-fix.md: "links panel e" should match "Links Panel E" option
    // even if it looks like a new command. Selection takes priority over new-intent escape.
    // IMPORTANT: If input matches MULTIPLE options (e.g., "links panel" matches both D and E),
    // do NOT auto-select - fall through to re-show options instead.
    if (lastClarification?.options && lastClarification.options.length > 0) {
      const normalizedInput = trimmedInput.toLowerCase().trim()

      // Helper: Check if label matches in input with word boundary
      // e.g., "workspace 2" in "workspace 2 please" → true (followed by space)
      // e.g., "workspace 2" in "workspace 22" → false (followed by digit, not word boundary)
      const matchesWithWordBoundary = (input: string, label: string): boolean => {
        if (!input.includes(label)) return false
        const index = input.indexOf(label)
        const endIndex = index + label.length
        // Label must end at word boundary (end of string or followed by space/punctuation)
        if (endIndex === input.length) return true
        const charAfter = input[endIndex]
        return /[\s,!?.]/.test(charAfter)
      }

      // Find ALL matching options, not just the first one
      const matchingOptions = lastClarification.options.filter(opt => {
        const normalizedLabel = opt.label.toLowerCase()
        // Exact match, or input is contained in label, or label is contained in input WITH word boundary
        return normalizedLabel === normalizedInput ||
               normalizedLabel.includes(normalizedInput) ||
               matchesWithWordBoundary(normalizedInput, normalizedLabel)
      })

      // Only auto-select if EXACTLY ONE option matches
      // If multiple match (e.g., "links panel" matches both D and E), fall through to re-show
      if (matchingOptions.length === 1) {
        const matchedOption = matchingOptions[0]
        const fullOption = pendingOptions.find(opt => opt.id === matchedOption.id)

        void debugLog({
          component: 'ChatNavigation',
          action: 'clarification_tier1b3_label_selection',
          metadata: {
            input: trimmedInput,
            matchedLabel: matchedOption.label,
            hasFullOption: !!fullOption,
            matchCount: 1,
          },
        })

        setLastClarification(null)

        if (fullOption) {
          const optionToSelect: SelectionOption = {
            type: fullOption.type as SelectionOption['type'],
            id: fullOption.id,
            label: fullOption.label,
            sublabel: fullOption.sublabel,
            data: fullOption.data as SelectionOption['data'],
          }
          setIsLoading(false)
          handleSelectOption(optionToSelect)
          return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
        } else {
          const optionToSelect: SelectionOption = {
            type: matchedOption.type as SelectionOption['type'],
            id: matchedOption.id,
            label: matchedOption.label,
            sublabel: matchedOption.sublabel,
            data: matchedOption.type === 'doc'
              ? { docSlug: matchedOption.id }
              : { term: matchedOption.id, action: 'doc' as const },
          }
          setIsLoading(false)
          handleSelectOption(optionToSelect)
          return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
        }
      } else if (matchingOptions.length > 1) {
        // Multiple options match (e.g., "links panel" matches both D and E)
        // EXPLICITLY re-show options - don't fall through to new-intent escape or LLM
        void debugLog({
          component: 'ChatNavigation',
          action: 'clarification_tier1b3_multi_match_reshow',
          metadata: {
            input: trimmedInput,
            matchCount: matchingOptions.length,
            matchedLabels: matchingOptions.map(o => o.label),
          },
        })

        // Re-show the disambiguation options directly, using pendingOptions for full data
        const messageId = `assistant-${Date.now()}`
        const reaskMessage: ChatMessage = {
          id: messageId,
          role: 'assistant',
          content: 'Here are your options:',
          timestamp: new Date(),
          isError: false,
          options: lastClarification.options.map(opt => {
            // Try to get full option data from pendingOptions
            const fullOpt = pendingOptions.find(p => p.id === opt.id)
            return {
              type: opt.type as SelectionOption['type'],
              id: opt.id,
              label: opt.label,
              sublabel: opt.sublabel,
              data: fullOpt?.data as SelectionOption['data'] ?? {} as SelectionOption['data'],
            }
          }),
        }
        addMessage(reaskMessage)
        // Sync message ID for proper state tracking
        setPendingOptionsMessageId(messageId)
        setIsLoading(false)
        // Return handled=true to prevent fall-through to LLM intent resolution
        return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
      }
    }

    // Tier 1b.4: Fuzzy/typo match against pending options (before new-intent escape)
    // Per clarification-typo-resilience-fix: Catches typos like:
    // - "links panelx" → resembles "Links Panel D/E" options
    // - "workspaces 2b" → resembles "Workspace 2" option
    // If input resembles a pending option but triggered isNewQuestionOrCommandDetected,
    // it's likely a typo - re-show options instead of escaping to cross-corpus.
    if (lastClarification?.options && lastClarification.options.length > 0 && isNewQuestionOrCommandDetected) {
      const normalizedInputForFuzzy = trimmedInput.toLowerCase().trim()
      const inputResemblesOption = lastClarification.options.some(opt => {
        const normalizedLabel = opt.label.toLowerCase()
        // Extract label prefix (before parenthetical info)
        // "Workspace 2 (0 notes · just now)" → "workspace 2"
        const labelPrefix = normalizedLabel.split(/\s*\(/)[0].trim()

        // Check 1: Input with trailing char removed matches label prefix
        // "links panelx" → "links panel" matches "links panel d"
        if (normalizedInputForFuzzy.length > 4) {
          const inputTrimmed = normalizedInputForFuzzy.replace(/[a-z]$/, '') // Remove trailing letter
          if (labelPrefix.startsWith(inputTrimmed) || inputTrimmed.startsWith(labelPrefix)) {
            return true
          }
        }

        // Check 2: Core word overlap (handles plural/singular and trailing junk)
        // "workspaces 2b" → core words: ["workspace"] → matches "workspace 2"
        // Normalize: remove digits, trailing letters, singularize
        const getCanonicalWords = (str: string): string[] => {
          return str
            .replace(/\d+[a-z]*/g, '') // Remove digit+trailing (e.g., "2b")
            .split(/\s+/)
            .map(w => w.replace(/s$/, '').replace(/[^a-z]/g, '')) // Singularize, alpha only
            .filter(w => w.length >= 4)
        }

        const inputCoreWords = getCanonicalWords(normalizedInputForFuzzy)
        const labelCoreWords = getCanonicalWords(labelPrefix)

        // If any significant core word from input matches a label core word, it resembles
        const hasWordOverlap = inputCoreWords.some(iw =>
          labelCoreWords.some(lw => lw === iw || lw.startsWith(iw) || iw.startsWith(lw))
        )
        if (hasWordOverlap) return true

        // Check 3: Input contains a digit that appears in option label
        // "workspaces 2b" has "2" → matches "Workspace 2"
        const inputDigits = normalizedInputForFuzzy.match(/\d+/g)
        if (inputDigits) {
          for (const digit of inputDigits) {
            if (new RegExp(`\\b${digit}\\b`).test(normalizedLabel)) {
              return true
            }
          }
        }

        return false
      })

      if (inputResemblesOption) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'clarification_tier1b4_fuzzy_reshow',
          metadata: {
            input: trimmedInput,
            optionsCount: lastClarification.options.length,
            reason: 'input_resembles_pending_option',
          },
        })

        // Re-show options instead of escaping to new intent
        const messageId = `assistant-${Date.now()}`
        const reaskMessage: ChatMessage = {
          id: messageId,
          role: 'assistant',
          content: 'Please choose one of the options:',
          timestamp: new Date(),
          isError: false,
          options: lastClarification.options.map(opt => {
            const fullOpt = pendingOptions.find(p => p.id === opt.id)
            return {
              type: opt.type as SelectionOption['type'],
              id: opt.id,
              label: opt.label,
              sublabel: opt.sublabel,
              data: fullOpt?.data as SelectionOption['data'] ?? {} as SelectionOption['data'],
            }
          }),
        }
        addMessage(reaskMessage)
        setPendingOptionsMessageId(messageId)
        setIsLoading(false)
        return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
      }
    }

    // Tier 1b.5: New intent escape
    if (isNewQuestionOrCommandDetected) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_exit_new_intent',
        metadata: { userInput: trimmedInput, isBareNounNewIntent },
      })
      setLastClarification(null)
      clarificationCleared = true
      // Don't return - continue to check if other handlers should process
    }

    // Tier 1c: Local META check
    if (lastClarification && !clarificationCleared && isMetaPhrase(trimmedInput)) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_tier1_meta',
        metadata: { userInput: trimmedInput },
      })
      handleMeta()
      setIsLoading(false)
      return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
    }

    // Tier 1d: Ordinal/selection check for multi-option clarifications
    if (lastClarification && !clarificationCleared && lastClarification.options && lastClarification.options.length > 0) {
      const clarificationOptionLabels = lastClarification.options.map(opt => opt.label)
      const clarificationSelectionResult = isSelectionOnly(trimmedInput, lastClarification.options.length, clarificationOptionLabels)

      if (clarificationSelectionResult.isSelection && clarificationSelectionResult.index !== undefined) {
        const selectedClarificationOption = lastClarification.options[clarificationSelectionResult.index]
        const fullOption = pendingOptions.find(opt => opt.id === selectedClarificationOption.id)

        void debugLog({
          component: 'ChatNavigation',
          action: 'clarification_tier1d_ordinal_selection',
          metadata: {
            input: trimmedInput,
            index: clarificationSelectionResult.index,
            selectedLabel: selectedClarificationOption.label,
            clarificationType: lastClarification.type,
            hasFullOption: !!fullOption,
          },
          metrics: {
            event: 'clarification_resolved',
            selectedLabel: selectedClarificationOption.label,
            timestamp: Date.now(),
          },
        })

        setLastClarification(null)
        clarificationCleared = true

        if (fullOption) {
          const optionToSelect: SelectionOption = {
            type: fullOption.type as SelectionOption['type'],
            id: fullOption.id,
            label: fullOption.label,
            sublabel: fullOption.sublabel,
            data: fullOption.data as SelectionOption['data'],
          }
          setIsLoading(false)
          handleSelectOption(optionToSelect)
          return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
        } else {
          const optionToSelect: SelectionOption = {
            type: selectedClarificationOption.type as SelectionOption['type'],
            id: selectedClarificationOption.id,
            label: selectedClarificationOption.label,
            sublabel: selectedClarificationOption.sublabel,
            data: selectedClarificationOption.type === 'doc'
              ? { docSlug: selectedClarificationOption.id }
              : { term: selectedClarificationOption.id, action: 'doc' as const },
          }
          setIsLoading(false)
          handleSelectOption(optionToSelect)
          return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
        }
      }
    }

    // Tier 2: LLM interpretation for unclear responses
    if (lastClarification && !clarificationCleared) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_tier2_llm',
        metadata: { userInput: trimmedInput },
      })

      try {
        const interpretResponse = await fetch('/api/chat/navigate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmedInput,
            clarificationMode: true,
            clarificationQuestion: 'Would you like to open a workspace to see your notes?',
          }),
        })

        if (interpretResponse.ok) {
          const interpretResult = await interpretResponse.json()
          const interpretation = interpretResult.clarificationInterpretation

          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_tier2_result',
            metadata: { interpretation },
          })

          if (interpretation === 'YES') {
            await executeNextAction()
            setIsLoading(false)
            return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
          } else if (interpretation === 'NO') {
            handleRejection()
            setIsLoading(false)
            return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
          } else if (interpretation === 'META') {
            handleMeta()
            setIsLoading(false)
            return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
          } else {
            if (!handleUnclear()) {
              setIsLoading(false)
              return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
            }
          }
        } else {
          if (!handleUnclear()) {
            setIsLoading(false)
            return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
          }
        }
      } catch (error) {
        console.error('[ChatNavigation] Clarification interpretation failed:', error)
        if (!handleUnclear()) {
          setIsLoading(false)
          return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
        }
      }
    }
  }

  // Not handled or fell through after new intent detection
  return { handled: false, clarificationCleared, isNewQuestionOrCommandDetected }
}

// =============================================================================
// Panel Disambiguation Handler (Pre-LLM)
// =============================================================================

export interface PanelDisambiguationHandlerContext {
  trimmedInput: string
  visibleWidgets?: VisibleWidget[]
  addMessage: (message: ChatMessage) => void
  setIsLoading: (loading: boolean) => void
  setPendingOptions: (options: PendingOptionState[]) => void
  setPendingOptionsMessageId: (messageId: string) => void
  setLastClarification: (state: LastClarificationState | null) => void
}

export interface PanelDisambiguationHandlerResult extends HandlerResult {
  matchType?: 'exact' | 'partial' | 'none'
  matchCount?: number
}

/**
 * Handle panel disambiguation BEFORE LLM.
 *
 * When user types "links panel" (partial match for multiple panels),
 * show disambiguation directly without going to LLM.
 * This ensures deterministic behavior instead of relying on LLM parsing.
 *
 * Matches:
 * - Partial match (multiple panels): "links panel" → D and E → disambiguation
 * - Does NOT handle exact match (single panel) - let LLM handle for richer response
 * - Does NOT handle no match - let LLM try to interpret
 */
export function handlePanelDisambiguation(
  context: PanelDisambiguationHandlerContext
): PanelDisambiguationHandlerResult {
  const {
    trimmedInput,
    visibleWidgets,
    addMessage,
    setIsLoading,
    setPendingOptions,
    setPendingOptionsMessageId,
    setLastClarification,
  } = context

  const matchResult = matchVisiblePanelCommand(trimmedInput, visibleWidgets)

  // Only handle partial matches with multiple panels (disambiguation case)
  // Exact match (single panel) and no match are handled by LLM for richer responses
  if (matchResult.type === 'partial' && matchResult.matches.length > 1) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'panel_disambiguation_pre_llm',
      metadata: {
        input: trimmedInput,
        matchType: matchResult.type,
        matchCount: matchResult.matches.length,
        matchedTitles: matchResult.matches.map(m => m.title),
      },
    })

    // Create disambiguation options
    const messageId = `assistant-${Date.now()}`
    const options: SelectionOption[] = matchResult.matches.map((widget, idx) => ({
      type: 'panel_drawer' as const,
      id: widget.id,
      label: widget.title,
      sublabel: widget.type,
      data: { panelId: widget.id, panelTitle: widget.title, panelType: widget.type },
    }))

    // Build a friendly name for the message (e.g., "Links Panel" for quick-links panels)
    const isQuickLinks = matchResult.matches.some(m =>
      m.type === 'links_note' || m.type === 'links_note_tiptap'
    )
    const friendlyName = isQuickLinks ? 'Links Panel' : 'panels'

    const assistantMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: `Multiple ${friendlyName} panels found. Which one would you like to open?`,
      timestamp: new Date(),
      isError: false,
      options,
    }
    addMessage(assistantMessage)

    // Set pending options for pill selection
    const pendingOptions: PendingOptionState[] = options.map((opt, idx) => ({
      index: idx + 1,
      label: opt.label,
      sublabel: opt.sublabel,
      type: opt.type,
      id: opt.id,
      data: opt.data,
    }))
    setPendingOptions(pendingOptions)
    setPendingOptionsMessageId(messageId)

    // Sync lastClarification for follow-up handling
    setLastClarification({
      type: 'option_selection',
      originalIntent: 'panel_disambiguation',
      messageId,
      timestamp: Date.now(),
      clarificationQuestion: `Multiple ${friendlyName} panels found. Which one would you like to open?`,
      options: options.map(opt => ({
        id: opt.id,
        label: opt.label,
        sublabel: opt.sublabel,
        type: opt.type,
      })),
      metaCount: 0,
    })

    setIsLoading(false)
    return { handled: true, matchType: matchResult.type, matchCount: matchResult.matches.length }
  }

  // Let LLM handle other cases (exact match, no match)
  return { handled: false, matchType: matchResult.type, matchCount: matchResult.matches.length }
}
