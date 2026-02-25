/**
 * Chat Routing — Meta-Explain Handler
 *
 * Handles meta-explain queries like "what is X", "explain X" outside clarification.
 * Routes to doc retrieval and handles ambiguous results with pills.
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
import {
  normalizeInputForRouting,
  isMetaExplainOutsideClarification,
  isPronounFollowUp,
  extractMetaExplainConcept,
  findFuzzyMatch,
} from '@/lib/chat/query-patterns'
import { maybeFormatSnippetWithHs3, dedupeHeaderPath, stripMarkdownHeadersForUI } from '@/lib/chat/doc-routing'
import type { ChatMessage, SelectionOption } from '@/lib/chat'
import type { MetaExplainHandlerContext, HandlerResult } from './chat-routing-types'

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
    saveLastOptionsShown,
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
        saveLastOptionsShown?.(options.map(opt => ({ id: opt.id, label: opt.label, sublabel: opt.sublabel, type: opt.type })), messageId)

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
        saveLastOptionsShown?.([{ id: weakOption.id, label: weakOption.label, sublabel: weakOption.sublabel, type: weakOption.type }], messageId)

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
