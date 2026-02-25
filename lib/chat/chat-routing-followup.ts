/**
 * Chat Routing — Follow-Up Handler
 *
 * Handles pronoun follow-up queries like "tell me more", "how does it work".
 * Uses HS2 expansion to show additional content from the same doc.
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
  isPronounFollowUp,
} from '@/lib/chat/query-patterns'
import { maybeFormatSnippetWithHs3, stripMarkdownHeadersForUI } from '@/lib/chat/doc-routing'
import type { ChatMessage } from '@/lib/chat'
import type { FollowUpHandlerContext, FollowUpHandlerResult } from './chat-routing-types'

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
// Follow-Up Handler
// =============================================================================

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
