/**
 * Cross-Corpus Retrieval Handler
 * Part of: Prereq 4 (Cross-Corpus Ambiguity UX)
 *
 * Handles routing queries to the appropriate corpus (docs or notes)
 * and showing cross-corpus disambiguation pills when needed.
 */

import {
  detectCorpusIntent,
  normalizeInputForRouting,
  hasDocsCorpusIntent,
  hasNotesCorpusIntent,
  isPronounFollowUp,
} from '@/lib/chat/query-patterns'
import {
  queryCrossCorpus,
  CrossCorpusDecision,
  CrossCorpusDecisionWithFailure,
  fetchCorpusResults,
  fetchNotesWithFallback,
  NotesFallbackReason,
} from '@/lib/chat/cross-corpus-retrieval'
import {
  RoutingPatternId,
  logRoutingDecision,
  createRoutingTelemetryEvent,
} from '@/lib/chat/routing-telemetry'
import { debugLog } from '@/lib/utils/debug-logger'
import { getKnownTermsSync } from '@/lib/docs/known-terms-client'
import type { DocRetrievalState, ChatMessage, CrossCorpusSelectData, SelectionOption } from '@/lib/chat'
import type { PendingOptionState } from '@/lib/chat/chat-routing'

// =============================================================================
// Types
// =============================================================================

export interface CrossCorpusHandlerResult {
  handled: boolean
  decision?: CrossCorpusDecision
  patternId?: RoutingPatternId
}

export interface CrossCorpusHandlerContext {
  // Input
  trimmedInput: string

  // State
  docRetrievalState: DocRetrievalState | null

  // Callbacks
  addMessage: (message: ChatMessage) => void
  updateDocRetrievalState: (update: Partial<DocRetrievalState>) => void
  setIsLoading: (loading: boolean) => void
  setPendingOptions: (options: PendingOptionState[]) => void
  setPendingOptionsMessageId: (messageId: string) => void
}

// =============================================================================
// Main Handler
// =============================================================================

/**
 * Handle cross-corpus routing decision.
 *
 * This handler intercepts queries that:
 * 1. Have explicit notes corpus intent ("my notes", "search notes", etc.)
 * 2. Could apply to both corpora with similar results (shows pills)
 *
 * Returns handled=true if:
 * - Query routed to notes corpus (showed notes results)
 * - Cross-corpus pills were shown
 *
 * Returns handled=false if:
 * - Query should go through normal docs retrieval
 * - Neither corpus had results
 */
export async function handleCrossCorpusRetrieval(
  ctx: CrossCorpusHandlerContext
): Promise<CrossCorpusHandlerResult> {
  const {
    trimmedInput,
    docRetrievalState,
    addMessage,
    updateDocRetrievalState,
    setIsLoading,
    setPendingOptions,
    setPendingOptionsMessageId,
  } = ctx

  const knownTerms = getKnownTermsSync()
  const intent = detectCorpusIntent(trimmedInput, knownTerms)

  // Check if docs intent is EXPLICIT (via phrases) vs just from known terms
  const hasExplicitDocsIntent = hasDocsCorpusIntent(trimmedInput)
  const hasExplicitNotesIntent = hasNotesCorpusIntent(trimmedInput)

  // Phase 2: Guard for notes follow-up continuity
  // If user is in notes context and says "tell me more", let handleFollowUp handle it
  if (
    docRetrievalState?.lastRetrievalCorpus === 'notes' &&
    docRetrievalState?.lastItemId &&
    isPronounFollowUp(trimmedInput)
  ) {
    void debugLog({
      component: 'CrossCorpus',
      action: 'skip_for_notes_followup',
      content_preview: `Notes follow-up guard: "${trimmedInput.slice(0, 30)}"`,
      forceLog: true,
      metadata: {
        cross_corpus_intent: intent,
        last_retrieval_corpus: 'notes',
        last_item_id: docRetrievalState.lastItemId,
      },
    })
    return { handled: false }
  }

  // Quick exit: Only when explicit docs intent WITHOUT any notes intent
  // This is the "documentation please" case - user clearly wants docs
  if (hasExplicitDocsIntent && !hasExplicitNotesIntent && intent === 'docs') {
    return { handled: false }
  }

  // Explicit notes intent takes precedence - query notes corpus directly
  // This handles "my notes on X" even if X is a known doc term
  if (hasExplicitNotesIntent && !hasExplicitDocsIntent) {
    setIsLoading(true)
    try {
      // Prereq 5: Use fetch with failure tracking
      const notesFetchResult = await fetchNotesWithFallback(trimmedInput)
      const notesResult = notesFetchResult.result
      const notesFailure = notesFetchResult.failure

      // Prereq 5: Handle notes fetch failure with graceful message
      if (notesFailure) {
        const message: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: "I couldn't access your notes right now. Would you like to try again or search the documentation instead?",
          timestamp: new Date(),
        }
        addMessage(message)

        // Emit telemetry for notes failure
        void debugLog({
          component: 'CrossCorpus',
          action: 'notes_explicit_failed',
          content_preview: `Notes fetch failed: ${notesFailure.reason}`,
          forceLog: true,
          metadata: {
            cross_corpus_intent: 'notes',
            notes_index_available: false,
            notes_retrieval_error: true,
            notes_fallback_reason: notesFailure.reason,
          },
        })

        return {
          handled: true,
          patternId: RoutingPatternId.CROSS_CORPUS_NOTES_EXPLICIT,
        }
      }

      if (notesResult && notesResult.status !== 'no_match') {
        // Show notes result directly
        const message: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: `From your notes - **${notesResult.topTitle}**:\n\n${notesResult.topResourceId ? 'Found relevant content in your notes.' : 'No preview available.'}`,
          timestamp: new Date(),
        }
        addMessage(message)

        // Update state for follow-ups
        updateDocRetrievalState({
          lastRetrievalCorpus: 'notes',
          lastItemId: notesResult.topResourceId,
          lastResourceId: notesResult.topResourceId,
          timestamp: Date.now(),
        })

        // Emit telemetry
        void debugLog({
          component: 'CrossCorpus',
          action: 'notes_explicit',
          content_preview: `Notes result: ${notesResult.topTitle}`,
          forceLog: true,
          metadata: {
            cross_corpus_intent: 'notes',
            cross_corpus_notes_status: notesResult.status,
            cross_corpus_ambiguity_shown: false,
            notes_index_available: true,
            notes_retrieval_error: false,
          },
        })

        return {
          handled: true,
          patternId: RoutingPatternId.CROSS_CORPUS_NOTES_EXPLICIT,
        }
      }

      // Notes intent but no results - fall through to docs
      return { handled: false }
    } finally {
      setIsLoading(false)
    }
  }

  // Query both corpora when:
  // 1. Both intents present (explicit signals for both)
  // 2. Docs intent is from term matching only (not explicit) - need to check notes
  // 3. No explicit intent at all - check both for close scores
  const shouldQueryBoth =
    intent === 'both' ||
    intent === 'none' ||
    (intent === 'docs' && !hasExplicitDocsIntent)

  if (shouldQueryBoth) {
    setIsLoading(true)
    try {
      const decision = await queryCrossCorpus(trimmedInput, knownTerms, {
        isExplicitDocsIntent: hasExplicitDocsIntent,
      }) as CrossCorpusDecisionWithFailure

      // Prereq 5: If notes failed but docs succeeded, fall through with telemetry
      // The docs retrieval will handle showing results; we add telemetry here
      if (decision.notesFailure && decision.singleCorpus === 'docs') {
        void debugLog({
          component: 'CrossCorpus',
          action: 'notes_fallback_to_docs',
          content_preview: `Notes unavailable (${decision.notesFailure.reason}), using docs only`,
          forceLog: true,
          metadata: {
            cross_corpus_intent: intent,
            notes_index_available: false,
            notes_retrieval_error: true,
            notes_fallback_reason: decision.notesFailure.reason,
            cross_corpus_reason: decision.reason,
          },
        })

        // Fall through to docs retrieval - the standard doc handler will show results
        // No special message needed here since user didn't explicitly ask for notes
        return { handled: false, decision }
      }

      if (decision.showPills && decision.docsResult && decision.notesResult) {
        // Show cross-corpus pills
        const options: PendingOptionState[] = [
          {
            index: 1,
            label: `Docs: ${decision.docsResult.topTitle}`,
            sublabel: 'Documentation',
            type: 'cross_corpus_select',
            id: `docs-${decision.docsResult.topResourceId}`,
            data: {
              corpus: 'docs',
              resourceId: decision.docsResult.topResourceId,
              title: decision.docsResult.topTitle,
            },
          },
          {
            index: 2,
            label: `Notes: ${decision.notesResult.topTitle}`,
            sublabel: 'Your notes',
            type: 'cross_corpus_select',
            id: `notes-${decision.notesResult.topResourceId}`,
            data: {
              corpus: 'notes',
              resourceId: decision.notesResult.topResourceId,
              title: decision.notesResult.topTitle,
            },
          },
        ]

        const message: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'I found results in both documentation and your notes. Which would you like to see?',
          timestamp: new Date(),
          options: options.map(opt => ({
            label: opt.label,
            sublabel: opt.sublabel,
            type: opt.type as SelectionOption['type'],
            id: opt.id,
            data: opt.data as CrossCorpusSelectData,
          })),
        }

        addMessage(message)
        setPendingOptions(options)
        setPendingOptionsMessageId(message.id)

        // Emit telemetry for cross-corpus ambiguity
        void debugLog({
          component: 'CrossCorpus',
          action: 'ambiguity_shown',
          content_preview: `Pills: Docs(${decision.docsResult.topTitle}) vs Notes(${decision.notesResult.topTitle})`,
          forceLog: true,
          metadata: {
            cross_corpus_intent: intent,
            cross_corpus_explicit_docs: hasExplicitDocsIntent,
            cross_corpus_explicit_notes: hasExplicitNotesIntent,
            cross_corpus_ambiguity_shown: true,
            cross_corpus_score_gap: decision.scoreGap,
            cross_corpus_docs_status: decision.docsResult.status,
            cross_corpus_notes_status: decision.notesResult.status,
            cross_corpus_docs_score: decision.docsResult.topScore,
            cross_corpus_notes_score: decision.notesResult.topScore,
            // Prereq 5: Fallback telemetry
            notes_index_available: true,
            notes_retrieval_error: false,
          },
        })

        return {
          handled: true,
          decision,
          patternId: RoutingPatternId.CROSS_CORPUS_AMBIGUOUS,
        }
      }

      // Decision says single corpus - check which one
      if (decision.singleCorpus === 'notes' && decision.notesResult) {
        // Show notes result
        const message: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: `From your notes - **${decision.notesResult.topTitle}**`,
          timestamp: new Date(),
        }
        addMessage(message)

        updateDocRetrievalState({
          lastRetrievalCorpus: 'notes',
          lastItemId: decision.notesResult.topResourceId,
          lastResourceId: decision.notesResult.topResourceId,
          timestamp: Date.now(),
        })

        return {
          handled: true,
          decision,
          patternId: RoutingPatternId.CROSS_CORPUS_NOTES_EXPLICIT,
        }
      }

      // Docs or neither - fall through to normal docs flow
      void debugLog({
        component: 'CrossCorpus',
        action: 'fallthrough_to_docs',
        content_preview: `Decision: ${decision.reason}, singleCorpus: ${decision.singleCorpus}`,
        forceLog: true,
        metadata: {
          cross_corpus_intent: intent,
          cross_corpus_explicit_docs: hasExplicitDocsIntent,
          cross_corpus_explicit_notes: hasExplicitNotesIntent,
          cross_corpus_reason: decision.reason,
          cross_corpus_docs_score: decision.docsResult?.topScore,
          cross_corpus_notes_score: decision.notesResult?.topScore,
          cross_corpus_score_gap: decision.scoreGap,
          // Prereq 5: Fallback telemetry
          notes_index_available: !decision.notesFailure,
          notes_retrieval_error: !!decision.notesFailure,
          notes_fallback_reason: decision.notesFailure?.reason,
        },
      })

      return { handled: false, decision }
    } finally {
      setIsLoading(false)
    }
  }

  void debugLog({
    component: 'CrossCorpus',
    action: 'skip_cross_corpus',
    content_preview: `Intent: ${intent}, explicitDocs: ${hasExplicitDocsIntent}, explicitNotes: ${hasExplicitNotesIntent}`,
    forceLog: true,
    metadata: {
      cross_corpus_intent: intent,
      cross_corpus_explicit_docs: hasExplicitDocsIntent,
      cross_corpus_explicit_notes: hasExplicitNotesIntent,
      cross_corpus_should_query_both: shouldQueryBoth,
    },
  })

  return { handled: false }
}

/**
 * Handle cross-corpus pill selection.
 * Called when user selects a Docs or Notes pill.
 */
export async function handleCrossCorpusPillSelection(
  option: PendingOptionState,
  ctx: {
    addMessage: (message: ChatMessage) => void
    updateDocRetrievalState: (update: Partial<DocRetrievalState>) => void
    setIsLoading: (loading: boolean) => void
  }
): Promise<{ success: boolean }> {
  const data = option.data as {
    corpus: 'docs' | 'notes'
    resourceId: string
    title: string
  }

  ctx.setIsLoading(true)
  try {
    // Fetch full content for the selected resource
    const response = await fetch('/api/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        corpus: data.corpus,
        resourceId: data.resourceId,
      }),
    })

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`)
    }

    const result = await response.json()
    const topResult = result.results?.[0]

    if (topResult) {
      const message: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.corpus === 'docs'
          ? `**${topResult.title}**\n\n${topResult.snippet || 'No content available.'}`
          : `From your notes - **${topResult.title}**\n\n${topResult.snippet || 'No content available.'}`,
        timestamp: new Date(),
      }
      ctx.addMessage(message)

      // Update state for follow-ups
      ctx.updateDocRetrievalState({
        lastRetrievalCorpus: data.corpus,
        lastDocSlug: data.corpus === 'docs' ? data.resourceId : undefined,
        lastItemId: data.corpus === 'notes' ? data.resourceId : undefined,
        lastResourceId: data.resourceId,
        lastChunkIdsShown: topResult.chunkId ? [topResult.chunkId] : [],
        timestamp: Date.now(),
      })

      // Emit telemetry for corpus selection
      void debugLog({
        component: 'CrossCorpus',
        action: 'pill_selected',
        content_preview: `Selected ${data.corpus}: ${data.title}`,
        forceLog: true,
        metadata: {
          cross_corpus_choice: data.corpus,
          cross_corpus_resource_id: data.resourceId,
        },
      })

      return { success: true }
    }

    return { success: false }
  } catch (error) {
    console.error('[CrossCorpus] Pill selection error:', error)
    return { success: false }
  } finally {
    ctx.setIsLoading(false)
  }
}
