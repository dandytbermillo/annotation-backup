/**
 * Chat Routing — Clarification Intercept Handler
 *
 * Contains handleClarificationIntercept and its helper functions.
 * Extracted from chat-routing.ts for modularity.
 *
 * @internal — Do not import directly outside lib/chat/.
 * Use the barrel at @/lib/chat/chat-routing instead.
 */

import { debugLog } from '@/lib/utils/debug-logger'
import { getKnownTermsSync } from '@/lib/docs/known-terms-client'
import {
  normalizeInputForRouting,
  isAffirmationPhrase,
  isRejectionPhrase,
  isMetaPhrase,
  isNewQuestionOrCommand,
  hasFuzzyMatch,
  hasQuestionIntent,
  isPoliteImperativeRequest,
} from '@/lib/chat/query-patterns'
import { isBareNounQuery } from '@/lib/chat/doc-routing'
import type { ChatMessage, SelectionOption, WorkspaceMatch, NoteMatch } from '@/lib/chat'
import type { ClarificationOption, PanelDrawerData, DocData } from '@/lib/chat/chat-navigation-context'
import { REPAIR_MEMORY_TURN_LIMIT, STOP_SUPPRESSION_TURN_LIMIT, getLatchId } from '@/lib/chat/chat-navigation-context'
import type {
  PreferredCandidateHint,
  PendingOptionState,
  ClarificationInterceptResult,
  ClarificationInterceptContext,
} from './chat-routing-types'
import {
  runBoundedArbitrationLoop,
  resetLLMArbitrationGuard,
  createEnrichmentCallback,
  tryContinuityDeterministicResolve,
} from './chat-routing-arbitration'
import type { EntryMatch } from '@/lib/chat/resolution-types'
import { matchVisiblePanelCommand } from '@/lib/chat/panel-command-matcher'
import {
  classifyResponseFit,
  getEscalationMessage,
  getExitOptions,
  isExitPhrase,
  classifyExitIntent,
  isHesitationPhrase,
  isRepairPhrase,
  isListRejectionPhrase,
  isNoise,
  getHesitationPrompt,
  getBasePrompt,
  getRepairPrompt,
  getNoRefusalPrompt,
  getRefinePrompt,
  getNoisePrompt,
  getAskClarifyPrompt,
  getSoftRejectPrompt,
  getConfirmPrompt,
  detectReturnSignal,
  CONFIDENCE_THRESHOLD_EXECUTE,
  CONFIDENCE_THRESHOLD_CONFIRM,
  type ClarificationType,
} from '@/lib/chat/clarification-offmenu'
import { matchKnownNoun } from '@/lib/chat/known-noun-routing'
import {
  shouldCallLLMFallback,
  callClarificationLLMClient,
  callReturnCueLLM,
  isLLMFallbackEnabledClient,
} from '@/lib/chat/clarification-llm-fallback'
import { isExplicitCommand, isSelectionOnly, resolveScopeCue, canonicalizeCommandInput, isStrictExactMatch, evaluateDeterministicDecision, isVerifyOpenQuestion, findPoliteWrapperExactMatch, isStrictExactMode } from '@/lib/chat/input-classifiers'
import { isSelectionLike } from '@/lib/chat/grounding-set'

// =============================================================================
// Clarification Intercept Handler
// =============================================================================

/**
 * Reconstruct the `data` payload for a ClarificationOption when selecting from
 * a snapshot (post-action ordinal/repair window). ClarificationOption doesn't
 * store data, so we build minimal-valid data from id/label/type.
 * Per plan §131-147 (Selection Persistence).
 */
function reconstructSnapshotData(option: ClarificationOption): SelectionOption['data'] {
  switch (option.type) {
    case 'panel_drawer':
      return {
        panelId: option.id,
        panelTitle: option.label,
        panelType: 'default',
      } as PanelDrawerData
    case 'doc':
      return { docSlug: option.id } as DocData
    case 'note':
      return {
        id: option.id,
        title: option.label,
        noteId: option.id,
      } as NoteMatch
    case 'workspace':
      return {
        id: option.id,
        name: option.label,
        entryId: option.id,
        entryName: option.label,
        isDefault: false,
      } as WorkspaceMatch
    case 'entry':
      return {
        id: option.id,
        name: option.label,
        isSystem: false,
      } as EntryMatch
    default:
      // Fallback: use id-based doc data
      return { docSlug: option.id } as DocData
  }
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
    // Repair memory (per clarification-response-fit-plan.md §5)
    repairMemory,
    setRepairMemory,
    incrementRepairMemoryTurn,
    clearRepairMemory,
    // Clarification snapshot for post-action repair window (per plan §153-161)
    clarificationSnapshot,
    saveClarificationSnapshot,
    pauseSnapshotWithReason,
    incrementSnapshotTurn,
    clearClarificationSnapshot,
    // Stop suppression (per stop-scope-plan §40-48)
    stopSuppressionCount,
    setStopSuppressionCount,
    // Soft-active window
    saveLastOptionsShown,
    // Widget selection context (per universal-selection-resolver-plan.md Phase 5)
    widgetSelectionContext,
    clearWidgetSelectionContext,
    setActiveOptionSetId,
    // Focus latch (per selection-intent-arbitration-incubation-plan.md)
    focusLatch,
    setFocusLatch,
    suspendFocusLatch,
    clearFocusLatch,
    hasVisibleWidgetItems,
    totalListSegmentCount,
    lastOptionsShown,
    isLatchEnabled,
    activeSnapshotWidgetId,
    scopeCueRecoveryMemory,
    clearScopeCueRecoveryMemory,
    // Selection continuity (Plan 20)
    updateSelectionContinuity,
    resetSelectionContinuity,
  } = ctx

  void debugLog({
    component: 'ChatNavigation',
    action: 'intercept_entry',
    metadata: {
      input: trimmedInput,
      hasSnapshot: !!clarificationSnapshot,
      snapshotPausedReason: clarificationSnapshot?.pausedReason ?? null,
      isLatchEnabled,
      focusLatch: focusLatch ? { latchId: getLatchId(focusLatch), kind: focusLatch.kind, suspended: focusLatch.suspended } : null,
      activeSnapshotWidgetId,
      pendingOptionsCount: pendingOptions.length,
    },
  })

  // Clear stale LLM arbitration loop guard when previous clarification cycle has ended.
  // After any resolution (option selection, exit, new intent), lastClarification is set to null.
  // The guard must not persist across clarification cycles.
  if (!lastClarification) {
    resetLLMArbitrationGuard()
  }

  // Hard invariant: when latch is resolved or pending, stale-chat ordinal paths are blocked
  const latchBlocksStaleChat = isLatchEnabled && !!focusLatch && !focusLatch.suspended

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
  // NOTE: `let` because Tier 2 known-noun interrupt may set this to true later
  let isNewQuestionOrCommandDetected =
    isNewQuestionOrCommand(trimmedInput) ||
    trimmedInput.endsWith('?') ||
    isBareNounNewIntent ||
    isFuzzyMatchNewIntent

  // Track if clarification was cleared within this execution cycle
  let clarificationCleared = false

  // =========================================================================
  // Semantic Answer Lane: escape clarification handler for semantic question inputs.
  // Clears stale clarification state and returns handled: false so the input reaches
  // the LLM API via the normal routing path (which has semantic intent descriptions).
  // =========================================================================
  if (ctx.semanticLaneDetected) {
    if (lastClarification) {
      if (lastClarification.options && lastClarification.options.length > 0) {
        saveClarificationSnapshot(lastClarification, true)
      }
      setLastClarification(null)
      setPendingOptions([])
      setPendingOptionsMessageId(null)
      setPendingOptionsGraceCount(0)
    }
    void debugLog({
      component: 'ChatNavigation',
      action: 'semantic_lane_escape_clarification',
      metadata: { userInput: trimmedInput, hadClarificationContext: !!lastClarification },
    })
    return { handled: false, clarificationCleared: !!lastClarification, isNewQuestionOrCommandDetected }
  }

  // Reset stop suppression on any non-exit input (per stop-scope-plan §40-48).
  // Must run before any early-return path so the counter doesn't leak across
  // unrelated commands (e.g., "cancel this" → "open recent" → "stop" should
  // NOT suppress the second stop).
  if (stopSuppressionCount > 0 && !isExitPhrase(trimmedInput)) {
    setStopSuppressionCount(0)
  }

  // ==========================================================================
  // EARLY REPAIR MEMORY HANDLER (before clarification block)
  // Per clarification-response-fit-plan.md §5: Support "the other one" even after
  // clarification is cleared. This runs BEFORE the hasClarificationContext check.
  // ==========================================================================
  if (isRepairPhrase(trimmedInput) && repairMemory &&
      repairMemory.lastChoiceId &&
      repairMemory.turnsSinceSet < REPAIR_MEMORY_TURN_LIMIT &&
      repairMemory.lastOptionsShown.length > 0) {

    void debugLog({
      component: 'ChatNavigation',
      action: 'early_repair_memory_handler',
      metadata: {
        userInput: trimmedInput,
        lastChoiceId: repairMemory.lastChoiceId,
        optionCount: repairMemory.lastOptionsShown.length,
        turnsSinceSet: repairMemory.turnsSinceSet,
      },
    })

    // For 2-option repair memory, auto-select the other option
    if (repairMemory.lastOptionsShown.length === 2) {
      const otherOption = repairMemory.lastOptionsShown.find(
        opt => opt.id !== repairMemory.lastChoiceId
      )

      if (otherOption) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'early_repair_auto_select',
          metadata: {
            userInput: trimmedInput,
            lastChoiceId: repairMemory.lastChoiceId,
            selectedOtherId: otherOption.id,
            response_fit_intent: 'repair',
          },
        })

        // Update repair memory with the new selection
        setRepairMemory(otherOption.id, repairMemory.lastOptionsShown)

        const optionToSelect: SelectionOption = {
          type: otherOption.type as SelectionOption['type'],
          id: otherOption.id,
          label: otherOption.label,
          sublabel: otherOption.sublabel,
          data: otherOption.type === 'doc'
            ? { docSlug: otherOption.id }
            : { term: otherOption.id, action: 'doc' as const },
        }
        setIsLoading(false)
        handleSelectOption(optionToSelect)
        return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
      }
    }

    // For >2 options, re-show options from repair memory with repair prompt
    void debugLog({
      component: 'ChatNavigation',
      action: 'early_repair_reshow_options',
      metadata: {
        userInput: trimmedInput,
        optionCount: repairMemory.lastOptionsShown.length,
        response_fit_intent: 'repair',
      },
    })

    const repairMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: getRepairPrompt(),
      timestamp: new Date(),
      isError: false,
      options: repairMemory.lastOptionsShown.map(opt => ({
        type: opt.type as SelectionOption['type'],
        id: opt.id,
        label: opt.label,
        sublabel: opt.sublabel,
        data: reconstructSnapshotData(opt),
      })),
    }
    addMessage(repairMessage)

    // Restore clarification state so subsequent responses work
    setLastClarification({
      type: 'option_selection',
      originalIntent: 'repair_memory_restore',
      messageId: repairMessage.id,
      timestamp: Date.now(),
      clarificationQuestion: getRepairPrompt(),
      options: repairMemory.lastOptionsShown,
      metaCount: 0,
    })

    setIsLoading(false)
    return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
  }

  // ==========================================================================
  // POST-ACTION REPAIR WINDOW (per plan §153-161)
  // If user sends repair phrase after an action (no active clarification) but we
  // have a recent snapshot, restore the clarification options instead of routing
  // to cross-corpus or treating as new intent.
  // ==========================================================================
  if (isRepairPhrase(trimmedInput) &&
      clarificationSnapshot &&
      !clarificationSnapshot.paused &&
      clarificationSnapshot.options.length > 0) {

    void debugLog({
      component: 'ChatNavigation',
      action: 'post_action_repair_window',
      metadata: {
        userInput: trimmedInput,
        snapshotTurnsSince: clarificationSnapshot.turnsSinceSet,
        optionCount: clarificationSnapshot.options.length,
        originalIntent: clarificationSnapshot.originalIntent,
        response_fit_intent: 'repair',
      },
    })

    // For 2-option snapshot, auto-select the other option (mirroring repair memory logic)
    if (clarificationSnapshot.options.length === 2) {
      // Find the "other" option - since we don't know which was selected last,
      // show the options again with repair prompt instead of auto-selecting
      void debugLog({
        component: 'ChatNavigation',
        action: 'post_action_repair_reshow_options',
        metadata: {
          optionCount: 2,
          response_fit_intent: 'repair',
        },
      })
    }

    // Restore clarification options with repair prompt
    const repairMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: getRepairPrompt(),
      timestamp: new Date(),
      isError: false,
      options: clarificationSnapshot.options.map(opt => ({
        type: opt.type as SelectionOption['type'],
        id: opt.id,
        label: opt.label,
        sublabel: opt.sublabel,
        data: reconstructSnapshotData(opt),
      })),
    }
    addMessage(repairMessage)

    // Restore clarification state
    setLastClarification({
      type: clarificationSnapshot.type,
      originalIntent: clarificationSnapshot.originalIntent,
      messageId: repairMessage.id,
      timestamp: Date.now(),
      clarificationQuestion: getRepairPrompt(),
      options: clarificationSnapshot.options,
      metaCount: 0,
    })

    // Clear snapshot after use
    clearClarificationSnapshot()
    setIsLoading(false)
    return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
  }

  // ==========================================================================
  // RETURN SIGNAL: Resume Paused List (per interrupt-resume-plan §21-38)
  // If the snapshot is paused (from an interrupt), the user can resume it
  // with an explicit return signal ("back to the panels", "continue that list").
  // Compound inputs ("back to panels — second option") are supported.
  // ==========================================================================
  if (!lastClarification &&
      clarificationSnapshot &&
      clarificationSnapshot.paused &&
      clarificationSnapshot.options.length > 0) {

    // Affirmation with paused snapshot = confirm return (Tier 3 recovery).
    // When the Tier 3 confirm prompt ("Do you want to go back to the previous
    // options?") is shown and the user replies "yes", treat it as a return signal.
    // Safe: affirmation with a paused list always means "restore it".
    if (isAffirmationPhrase(trimmedInput)) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'paused_list_affirmation_return',
        metadata: {
          userInput: trimmedInput,
          optionCount: clarificationSnapshot.options.length,
          pausedReason: clarificationSnapshot.pausedReason,
        },
      })

      const rawIntent = clarificationSnapshot.originalIntent
      const isInternalIntent = !rawIntent || /repair_|_restore|panel_disambiguation|cross_corpus/i.test(rawIntent)
      const restoreContent = clarificationSnapshot.pausedReason === 'stop'
        ? 'Here are the options you closed earlier:'
        : isInternalIntent
          ? 'Here are the previous options:'
          : `Here are the options for "${rawIntent}":`
      const restoreMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: restoreContent,
        timestamp: new Date(),
        isError: false,
        options: clarificationSnapshot.options.map(opt => ({
          type: opt.type as SelectionOption['type'],
          id: opt.id,
          label: opt.label,
          sublabel: opt.sublabel,
          data: reconstructSnapshotData(opt),
        })),
      }
      addMessage(restoreMessage)

      setLastClarification({
        type: clarificationSnapshot.type,
        originalIntent: clarificationSnapshot.originalIntent,
        messageId: restoreMessage.id,
        timestamp: Date.now(),
        clarificationQuestion: restoreMessage.content,
        options: clarificationSnapshot.options,
        metaCount: 0,
      })

      clearClarificationSnapshot()
      setIsLoading(false)
      return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
    }

    const returnResult = detectReturnSignal(trimmedInput)

    if (returnResult.isReturn) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'paused_list_return_signal',
        metadata: {
          userInput: trimmedInput,
          remainder: returnResult.remainder,
          optionCount: clarificationSnapshot.options.length,
        },
      })

      // Check if the remainder contains an ordinal (compound: "back to panels — second option")
      if (returnResult.remainder) {
        const compoundSelection = isSelectionOnly(
          returnResult.remainder,
          clarificationSnapshot.options.length,
          clarificationSnapshot.options.map(o => o.label),
          'embedded'
        )

        if (compoundSelection.isSelection && compoundSelection.index !== undefined) {
          // Compound return + ordinal: select directly from paused list
          const selectedOption = clarificationSnapshot.options[compoundSelection.index]
          const reconstructedData = reconstructSnapshotData(selectedOption)

          const optionToSelect: SelectionOption = {
            type: selectedOption.type as SelectionOption['type'],
            id: selectedOption.id,
            label: selectedOption.label,
            sublabel: selectedOption.sublabel,
            data: reconstructedData,
          }

          setRepairMemory(selectedOption.id, clarificationSnapshot.options)
          clearClarificationSnapshot()
          setIsLoading(false)
          handleSelectOption(optionToSelect)
          return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
        }
      }

      // Simple return signal (no ordinal): restore the paused list as active clarification
      // Filter internal intent labels (repair_, _restore, panel_disambiguation, etc.)
      const rawIntent = clarificationSnapshot.originalIntent
      const isInternalIntent = !rawIntent || /repair_|_restore|panel_disambiguation|cross_corpus/i.test(rawIntent)
      const restoreContent = clarificationSnapshot.pausedReason === 'stop'
        ? 'Here are the options you closed earlier:'
        : isInternalIntent
          ? 'Here are the previous options:'
          : `Here are the options for "${rawIntent}":`
      const restoreMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: restoreContent,
        timestamp: new Date(),
        isError: false,
        options: clarificationSnapshot.options.map(opt => ({
          type: opt.type as SelectionOption['type'],
          id: opt.id,
          label: opt.label,
          sublabel: opt.sublabel,
          data: reconstructSnapshotData(opt),
        })),
      }
      addMessage(restoreMessage)

      // Restore as active clarification
      setLastClarification({
        type: clarificationSnapshot.type,
        originalIntent: clarificationSnapshot.originalIntent,
        messageId: restoreMessage.id,
        timestamp: Date.now(),
        clarificationQuestion: restoreMessage.content,
        options: clarificationSnapshot.options,
        metaCount: 0,
      })

      clearClarificationSnapshot()
      setIsLoading(false)
      return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
    }

    // ------------------------------------------------------------------
    // Tier 2: LLM fallback for return-cue detection (per interrupt-resume-plan §58-64)
    // Deterministic cue didn't match — ask LLM if the user wants to return.
    // Only if feature flag is enabled. On failure → Tier 3 confirm prompt.
    //
    // Guards (allowlist approach):
    // 1. Skip ordinals — they belong in the ordinal window below.
    // 2. Skip repair phrases — they belong in repair handling.
    // 3. Return-cue candidate check — only enter LLM if input contains a
    //    return-related token. Inputs like "links panel", "no", "stop",
    //    "open recent" are clearly not return cues and must fall through
    //    to normal routing. Without this guard, LLM timeouts cause a
    //    Tier 3 confirm loop that traps the user.
    // ------------------------------------------------------------------
    const isOrdinalInput = isSelectionOnly(
      trimmedInput,
      clarificationSnapshot.options.length,
      clarificationSnapshot.options.map(o => o.label),
      'embedded'
    ).isSelection

    // Allowlist: only inputs containing return-related tokens are candidates
    // for the return-cue LLM. Everything else falls through to normal routing.
    const RETURN_CUE_TOKENS = /\b(back|return|resume|continue|previous|old|earlier|before|again|options|list|choices)\b/i
    const isReturnCandidate = RETURN_CUE_TOKENS.test(trimmedInput)

    if (isLLMFallbackEnabledClient() && !isRepairPhrase(trimmedInput) && !isOrdinalInput && isReturnCandidate) {
      try {
        const llmResult = await callReturnCueLLM(trimmedInput)

        void debugLog({
          component: 'ChatNavigation',
          action: 'paused_return_llm_called',
          metadata: {
            userInput: trimmedInput,
            success: llmResult.success,
            decision: llmResult.response?.decision,
            confidence: llmResult.response?.confidence,
            latencyMs: llmResult.latencyMs,
          },
        })

        if (llmResult.success && llmResult.response) {
          if (llmResult.response.decision === 'return') {
            void debugLog({
              component: 'ChatNavigation',
              action: 'paused_return_llm_return',
              metadata: {
                userInput: trimmedInput,
                confidence: llmResult.response.confidence,
                reason: llmResult.response.reason,
              },
            })

            // LLM says return → restore the paused list (same logic as deterministic restore)
            const rawIntent = clarificationSnapshot.originalIntent
            const isInternalIntent = !rawIntent || /repair_|_restore|panel_disambiguation|cross_corpus/i.test(rawIntent)
            const restoreContent = clarificationSnapshot.pausedReason === 'stop'
              ? 'Here are the options you closed earlier:'
              : isInternalIntent
                ? 'Here are the previous options:'
                : `Here are the options for "${rawIntent}":`
            const restoreMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: restoreContent,
              timestamp: new Date(),
              isError: false,
              options: clarificationSnapshot.options.map(opt => ({
                type: opt.type as SelectionOption['type'],
                id: opt.id,
                label: opt.label,
                sublabel: opt.sublabel,
                data: reconstructSnapshotData(opt),
              })),
            }
            addMessage(restoreMessage)

            setLastClarification({
              type: clarificationSnapshot.type,
              originalIntent: clarificationSnapshot.originalIntent,
              messageId: restoreMessage.id,
              timestamp: Date.now(),
              clarificationQuestion: restoreMessage.content,
              options: clarificationSnapshot.options,
              metaCount: 0,
            })

            clearClarificationSnapshot()
            setIsLoading(false)
            return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
          }

          // LLM says not_return → fall through to normal routing
          void debugLog({
            component: 'ChatNavigation',
            action: 'paused_return_llm_not_return',
            metadata: {
              userInput: trimmedInput,
              confidence: llmResult.response.confidence,
              reason: llmResult.response.reason,
            },
          })
        } else {
          // LLM failed → Tier 3: confirm prompt (per interrupt-resume-plan §66-68)
          // Instead of falling through to normal routing (which causes doc routing
          // for return-like inputs), show a confirm prompt so the user can recover.
          void debugLog({
            component: 'ChatNavigation',
            action: 'paused_return_llm_failed',
            metadata: {
              userInput: trimmedInput,
              error: llmResult.error,
            },
          })

          const confirmMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: 'Do you want to go back to the previous options?',
            timestamp: new Date(),
            isError: false,
          }
          addMessage(confirmMessage)
          setIsLoading(false)
          return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
        }
      } catch (error) {
        // LLM call threw → Tier 3: confirm prompt (same recovery as above)
        void debugLog({
          component: 'ChatNavigation',
          action: 'paused_return_llm_error',
          metadata: {
            userInput: trimmedInput,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        })

        const confirmMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'Do you want to go back to the previous options?',
          timestamp: new Date(),
          isError: false,
        }
        addMessage(confirmMessage)
        setIsLoading(false)
        return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
      }
    }
  }

  // ==========================================================================
  // PAUSED-SNAPSHOT REPAIR GUARD (per interrupt-resume-plan §80-85)
  // If user sends repair phrase ("not that") after an interrupt (paused snapshot),
  // do NOT restore the paused list and do NOT fall into doc/notes routing.
  // Absorb with a neutral cancel/clarify prompt.
  // Compound inputs with return cues ("not that — back to the panels") are
  // already handled by the return signal handler above.
  // ==========================================================================
  if (!lastClarification &&
      clarificationSnapshot &&
      clarificationSnapshot.paused &&
      clarificationSnapshot.options.length > 0 &&
      isRepairPhrase(trimmedInput)) {

    void debugLog({
      component: 'ChatNavigation',
      action: 'paused_snapshot_repair_absorbed',
      metadata: {
        userInput: trimmedInput,
        snapshotTurnsSince: clarificationSnapshot.turnsSinceSet,
        optionCount: clarificationSnapshot.options.length,
        response_fit_intent: 'repair_after_interrupt',
      },
    })

    addMessage({
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: 'Okay — what would you like to do instead?',
      timestamp: new Date(),
      isError: false,
    })
    setIsLoading(false)
    return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
  }

  // ==========================================================================
  // POST-ACTION ORDINAL WINDOW (Selection Persistence, per plan §131-147)
  // Ordinals resolve against snapshots — both active and paused. After an
  // interrupt, the paused list stays ordinal-selectable until invalidated by:
  //   - explicit exit (stop/cancel confirmed)
  //   - a new list replacing it
  // Per interrupt-resume-plan §46-51: no automatic expiry on unrelated commands.
  // Repair phrases with paused snapshots are caught by step 5 above.
  // ==========================================================================
  if (!lastClarification &&
      clarificationSnapshot &&
      clarificationSnapshot.options.length > 0) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'post_action_ordinal_window_entered',
      metadata: {
        input: trimmedInput,
        snapshotPausedReason: clarificationSnapshot.pausedReason,
        snapshotOptionsCount: clarificationSnapshot.options.length,
      },
    })

    const snapshotSelection = isSelectionOnly(
      trimmedInput,
      clarificationSnapshot.options.length,
      clarificationSnapshot.options.map(o => o.label),
      'embedded'
    )

    if (snapshotSelection.isSelection && snapshotSelection.index !== undefined) {
      // ====================================================================
      // POST-ACTION SELECTION GATE (anti-garbage guard)
      // Per routing-order-priority-plan.md Tier 1:
      // Only run post-action selection if input is strictly selection-like:
      //   - contains a recognized ordinal keyword (first/second/1/2/last/etc.)
      //   - OR exactly matches an option label
      // This prevents fuzzy ordinal normalization from mis-selecting garbage
      // input (e.g., "anel layot" → "anel last" → selects last option).
      // ====================================================================
      const rawNormalized = trimmedInput.toLowerCase().trim()
      const STRICT_ORDINAL_PATTERN = /\b(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th|one|two|three|four|five|top|bottom)\b/i
      const hasStrictOrdinal = STRICT_ORDINAL_PATTERN.test(rawNormalized) || /^[1-9]$/.test(rawNormalized) || /^[a-e]$/i.test(rawNormalized) || /^option\s*[1-9]$/i.test(rawNormalized)
      const hasExactLabelMatch = clarificationSnapshot.options.some(
        opt => opt.label.toLowerCase().trim() === rawNormalized
      )

      if (!hasStrictOrdinal && !hasExactLabelMatch) {
        // Garbage input — skip post-action selection, fall through to normal routing
        void debugLog({
          component: 'ChatNavigation',
          action: 'post_action_selection_gate_blocked',
          metadata: {
            userInput: trimmedInput,
            detectedIndex: snapshotSelection.index,
            reason: 'input_not_strictly_selection_like',
            snapshotTurnsSince: clarificationSnapshot.turnsSinceSet,
          },
        })
        // Don't return — let input fall through to downstream handlers
      } else {
      // STOP-PAUSED ORDINAL GUARD: If snapshot was paused by stop, do NOT auto-resume.
      // Per stop-scope-plan §39-44: ordinals should not resolve when pausedReason === 'stop'.
      // Guide user to use explicit return cue instead.
      if (clarificationSnapshot.pausedReason === 'stop') {
        void debugLog({
          component: 'ChatNavigation',
          action: 'stop_paused_ordinal_blocked',
          metadata: {
            userInput: trimmedInput,
            detectedIndex: snapshotSelection.index,
            snapshotTurnsSince: clarificationSnapshot.turnsSinceSet,
            response_fit_intent: 'ordinal_after_stop',
          },
        })

        const guidanceMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: "That list was closed. Say 'back to the options' to reopen it, or tell me what you want instead.",
          timestamp: new Date(),
          isError: false,
        }
        addMessage(guidanceMessage)
        setIsLoading(false)
        return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
      }

      // INTERRUPT-PAUSED ORDINAL GUARD (Guard #2):
      // Per routing-order-priority-plan.md lines 55-62:
      // If pausedReason === 'interrupt', ordinals only bind if:
      //   (a) An explicit return cue was given (handled earlier by return signal handler), OR
      //   (b) The paused list is the ONLY plausible list (no other list context active).
      //
      // Since we reach here without a return cue (return handler runs first),
      // we must check that no other list context is active.
      // "Other list context active" per plan lines 59-62:
      //   - Other visible option pills in chat (pendingOptions > 0)
      //   - Widget/panel showing a selectable list (open drawer)
      if (clarificationSnapshot.pausedReason === 'interrupt') {
        const hasOtherActivePills = pendingOptions.length > 0
        const hasOpenDrawerList = !!(uiContext?.dashboard?.openDrawer)

        if (hasOtherActivePills || hasOpenDrawerList || latchBlocksStaleChat) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'interrupt_paused_ordinal_blocked_other_context',
            metadata: {
              userInput: trimmedInput,
              detectedIndex: snapshotSelection.index,
              snapshotTurnsSince: clarificationSnapshot.turnsSinceSet,
              hasOtherActivePills,
              hasOpenDrawerList,
              response_fit_intent: 'ordinal_after_interrupt_with_other_context',
            },
          })

          // Don't handle — let ordinal fall through to other handlers
          // (it might be intended for the active pills or drawer list)
        } else {
          // No other list context — paused list is the only plausible list.
          // Allow ordinal to bind (fall through to selection below).
          void debugLog({
            component: 'ChatNavigation',
            action: 'interrupt_paused_ordinal_allowed_only_list',
            metadata: {
              userInput: trimmedInput,
              detectedIndex: snapshotSelection.index,
              snapshotTurnsSince: clarificationSnapshot.turnsSinceSet,
              response_fit_intent: 'ordinal_after_interrupt_only_list',
            },
          })
        }

        // If blocked (other context exists or latch active), skip selection from paused list
        if (hasOtherActivePills || hasOpenDrawerList || latchBlocksStaleChat) {
          // Fall through to downstream handlers — ordinal may match other context
        } else {
          // Only list — proceed with selection (code below)
          const selectedOption = clarificationSnapshot.options[snapshotSelection.index]

          void debugLog({
            component: 'ChatNavigation',
            action: 'post_action_ordinal_window',
            metadata: {
              userInput: trimmedInput,
              selectedIndex: snapshotSelection.index,
              selectedLabel: selectedOption.label,
              selectedType: selectedOption.type,
              snapshotTurnsSince: clarificationSnapshot.turnsSinceSet,
              response_fit_intent: 'select',
            },
          })

          const reconstructedData = reconstructSnapshotData(selectedOption)

          const optionToSelect: SelectionOption = {
            type: selectedOption.type as SelectionOption['type'],
            id: selectedOption.id,
            label: selectedOption.label,
            sublabel: selectedOption.sublabel,
            data: reconstructedData,
          }

          setRepairMemory(selectedOption.id, clarificationSnapshot.options)
          setIsLoading(false)
          handleSelectOption(optionToSelect)
          return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
        }
      }

      // Non-paused snapshot (active post-selection window) — allow ordinal binding
      if (!clarificationSnapshot.pausedReason) {
        // Focus latch / pre-latch guard (per selection-intent-arbitration-incubation-plan.md):
        // When latch is active or pre-latch conditions met (Rule 12: single widget list,
        // no active chat), defer ordinal to Tier 4.5 widget resolution instead of resolving
        // against stale snapshot options (which would bind "second" to old chat pills).
        // Pre-latch focused: widget has UI focus (activeSnapshotWidgetId set by Phase 0).
        // Uses focused widget instead of strict totalListSegmentCount === 1 because
        // dashboards commonly have multiple list segments — the focus signal disambiguates.
        const isLatchOrPreLatch = isLatchEnabled && (
          (focusLatch && !focusLatch.suspended) ||  // Active latch
          (!focusLatch && !!activeSnapshotWidgetId)  // Pre-latch: focused widget exists
        )

        void debugLog({
          component: 'ChatNavigation',
          action: 'post_action_ordinal_guard',
          metadata: {
            isLatchOrPreLatch,
            latchKind: focusLatch?.kind ?? null,
            activeSnapshotWidgetId,
            input: trimmedInput,
          },
        })

        if (isLatchOrPreLatch) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'post_action_ordinal_deferred_to_widget',
            metadata: {
              userInput: trimmedInput,
              detectedIndex: snapshotSelection.index,
              snapshotLabel: clarificationSnapshot.options[snapshotSelection.index]?.label,
              hasLatch: !!(focusLatch && !focusLatch.suspended),
              isPreLatch: !focusLatch && !!activeSnapshotWidgetId,
            },
          })
          // Fix target #1: Set focus latch on the active widget if pre-latch (no latch yet).
          // This promotes pre-latch → latch so subsequent ordinals bypass the intercept
          // entirely via the latch bypass block (line 2450+), avoiding stale snapshot re-entry.
          if (isLatchEnabled && !focusLatch && activeSnapshotWidgetId) {
            setFocusLatch({
              kind: 'resolved',
              widgetId: activeSnapshotWidgetId,
              widgetLabel: activeSnapshotWidgetId, // Widget slug as label (human label resolved in dispatcher)
              latchedAt: Date.now(),
              turnsSinceLatched: 0,
            })
            void debugLog({ component: 'ChatNavigation', action: 'focus_latch_set', metadata: { widgetId: activeSnapshotWidgetId, trigger: 'post_action_ordinal_prelatch_promotion' } })
          }
          // Fix target #2: Demote competing chat disambiguation context.
          // Clear the snapshot so it doesn't catch future ordinals — the latch now owns resolution.
          clearClarificationSnapshot()
          // Fall through — don't return, let Tier 4.5 resolve against widget
        } else {
          const selectedOption = clarificationSnapshot.options[snapshotSelection.index]

          void debugLog({
            component: 'ChatNavigation',
            action: 'post_action_ordinal_window',
            metadata: {
              userInput: trimmedInput,
              selectedIndex: snapshotSelection.index,
              selectedLabel: selectedOption.label,
              selectedType: selectedOption.type,
              snapshotTurnsSince: clarificationSnapshot.turnsSinceSet,
              response_fit_intent: 'select',
            },
          })

          const reconstructedData = reconstructSnapshotData(selectedOption)

          const optionToSelect: SelectionOption = {
            type: selectedOption.type as SelectionOption['type'],
            id: selectedOption.id,
            label: selectedOption.label,
            sublabel: selectedOption.sublabel,
            data: reconstructedData,
          }

          setRepairMemory(selectedOption.id, clarificationSnapshot.options)
          setIsLoading(false)
          handleSelectOption(optionToSelect)
          return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
        }
      }
      } // end else (post-action selection gate passed)
    }
  }

  // ==========================================================================
  // STOP SCOPE RESOLUTION — Priority 3: No Active Scope
  // Per clarification-stop-scope-plan.md §8-24:
  // When no active clarification exists, exit phrases are caught here to prevent
  // them from falling through to doc/panel routing (which re-triggers old searches).
  // ==========================================================================
  if (!lastClarification && isExitPhrase(trimmedInput)) {
    // Repeated stop suppression (per plan §40-48):
    // If user already confirmed stop within the last N turns, suppress re-confirm.
    if (stopSuppressionCount > 0) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'stop_scope_repeated_suppression',
        metadata: {
          userInput: trimmedInput,
          stopSuppressionCount,
        },
      })
      // Don't decrement here — decrementStopSuppression() runs below for every turn
      const suppressMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: 'All set — what would you like to do?',
        timestamp: new Date(),
        isError: false,
      }
      addMessage(suppressMessage)
      setIsLoading(false)
      return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
    }

    void debugLog({
      component: 'ChatNavigation',
      action: 'stop_scope_no_active_scope',
      metadata: {
        userInput: trimmedInput,
        hadSnapshot: !!clarificationSnapshot,
        snapshotPaused: clarificationSnapshot?.paused ?? null,
      },
    })

    // Pause snapshot with reason 'stop' (no auto-resume, but explicit return cues can restore).
    // Per stop-scope-plan §39-44: pausedReason 'stop' blocks ordinals, allows return signal.
    if (clarificationSnapshot) {
      pauseSnapshotWithReason('stop')
    }

    // Latch-off: stop/start-over clears focus latch (Phase 6b)
    clearFocusLatch()
    clearWidgetSelectionContext() // Phase 6: stop/exit clears widget selection context
    // Session boundary: stop-confirmed clears durable recovery memory (per scope-cue-recovery-plan)
    clearScopeCueRecoveryMemory()
    // Session boundary: reset selection continuity (Plan 20, B9)
    resetSelectionContinuity()

    // Set suppression counter for next N=2 turns
    setStopSuppressionCount(STOP_SUPPRESSION_TURN_LIMIT)

    const exitMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: 'No problem — what would you like to do instead?',
      timestamp: new Date(),
      isError: false,
    }
    addMessage(exitMessage)
    setIsLoading(false)
    return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
  }

  // ==========================================================================
  // BARE ORDINAL DETECTION — No context available
  // Per stop-scope-plan acceptance test 3 (§74-76):
  // After stop clears the snapshot, ordinals like "second option" should not
  // silently fall through to doc routing. Ask what list the user means.
  //
  // Guards (Step 6 — widget-registry-implementation-plan):
  //   - Skip if input is a command/question (let it reach Tier 4.5 widget resolution)
  //   - Skip if input is longer than 4 words (not a bare ordinal)
  //   - Skip if widgetSelectionContext exists (per universal-selection-resolver-plan.md)
  //   - Skip if focusLatch active (Rule 6: ordinals resolve to latched widget)
  //   - Skip if pre-latch single list (Rule 12: one list-segment + no chat → Tier 4.5)
  // ==========================================================================
  const bareOrdinalWordCount = trimmedInput.split(/\s+/).length

  // Pre-latch check: focused widget exists OR exactly one list-segment group, no active chat
  // Uses activeSnapshotWidgetId (Phase 0 resolved focus) as primary signal since dashboards
  // commonly have totalListSegmentCount > 1. Falls back to strict Rule 12 when no focus signal.
  // Gated by isLatchEnabled — when feature flag is off, this is always false
  const isPreLatchSingleList = isLatchEnabled
    && (!focusLatch || focusLatch.suspended)
    && hasVisibleWidgetItems
    && (!!activeSnapshotWidgetId || totalListSegmentCount === 1)
    && !lastClarification

  // focusLatch active (not suspended) → Rule 6: ordinals resolve to latched widget, skip guard
  const hasActiveLatch = isLatchEnabled && focusLatch && !focusLatch.suspended
  if (!lastClarification && !clarificationSnapshot && !widgetSelectionContext
      && !hasActiveLatch && !isPreLatchSingleList
      && !isNewQuestionOrCommandDetected && bareOrdinalWordCount <= 4) {
    const bareOrdinalCheck = isSelectionOnly(trimmedInput, 10, [], 'embedded')
    if (bareOrdinalCheck.isSelection) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'bare_ordinal_no_context',
        metadata: {
          userInput: trimmedInput,
          detectedIndex: bareOrdinalCheck.index,
        },
      })

      const askMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: "Which options are you referring to? If you meant a previous list, say 'back to the options', or tell me what you want instead.",
        timestamp: new Date(),
        isError: false,
      }
      addMessage(askMessage)
      setIsLoading(false)
      return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
    }
  }

  // Increment snapshot turn counter for every non-intercepted message.
  // No turn-based expiry for either active or paused snapshots.
  // Paused snapshots persist until explicit exit or new list (per interrupt-resume-plan §46-51).
  incrementSnapshotTurn()

  // Check if we should enter clarification mode
  const hasClarificationContext = lastClarification?.nextAction ||
    (lastClarification?.options && lastClarification.options.length > 0)

  // ==========================================================================
  // Hoisted scope-cue resolution (needed before widget bypass decision).
  // Chat scope cues ("from chat", "in chat") must override widget context
  // to recover chat-origin options via getRecoverableChatOptionsWithIdentity().
  // Gated on isLatchEnabled (feature flag), NOT on isLatchActive.
  // ==========================================================================
  const isLatchActive = focusLatch && !focusLatch.suspended
  const scopeCue = isLatchEnabled ? resolveScopeCue(trimmedInput) : { scope: 'none' as const, cueText: null, confidence: 'none' as const }

  // ==========================================================================
  // Widget Selection Context Bypass (per universal-selection-resolver-plan.md)
  //
  // When widgetSelectionContext is active, skip ALL clarification-mode handling
  // and defer to the universal resolver in the dispatcher. This MUST be before
  // any label-matching code to prevent widget_option → handleSelectOption path.
  //
  // EXCEPTION: Chat scope cues ("from chat", "in chat") override the widget
  // bypass so the user can explicitly reach chat-origin options even when a
  // widget clarifier is active (e.g., "open panel d from chat" after a widget
  // LLM clarification created widgetSelectionContext for different items).
  // ==========================================================================
  if (widgetSelectionContext !== null && scopeCue.scope !== 'chat') {
    void debugLog({
      component: 'ChatNavigation',
      action: 'clarification_bypass_widget_context',
      metadata: {
        userInput: trimmedInput,
        widgetId: widgetSelectionContext.widgetId,
        optionCount: widgetSelectionContext.options.length,
        reason: 'widget_selection_context_active',
      },
    })
    // Return handled: false so universal resolver handles it
    return { handled: false, clarificationCleared: false, isNewQuestionOrCommandDetected }
  }

  // ==========================================================================
  // Hoisted Tier 1b.3 matching helpers (pure functions — safe to hoist)
  // Used by scope-cue Phase 2b, the pre-gate (selection-vs-command arbitration),
  // and Tier 1b.3 label matching. Single source of truth to prevent semantic drift.
  // ==========================================================================

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

  // Helper: Canonical token matching for singular/plural handling
  // e.g., "links panels d" → tokens {links, panel, d} matches "Links Panel D" → {links, panel, d}
  // e.g., "link panels d" → tokens {links, panel, d} matches "Links Panel D"
  const canonicalTokens: Record<string, string> = {
    panel: 'panel', panels: 'panel',
    widget: 'widget', widgets: 'widget',
    link: 'links', links: 'links',
  }
  // Note: this intentionally shadows the import from clarification-offmenu
  // which has different semantics (stopwords + micro-alias). This version
  // uses panel/widget singular-plural normalization for label matching.
  const toCanonicalTokens = (s: string): Set<string> => {
    const tokens = s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean)
    return new Set(tokens.map(t => canonicalTokens[t] ?? t))
  }
  const tokensMatch = (inputTokens: Set<string>, labelTokens: Set<string>): boolean => {
    // Exact token match: all label tokens in input AND all input tokens in label
    if (inputTokens.size !== labelTokens.size) return false
    for (const t of inputTokens) {
      if (!labelTokens.has(t)) return false
    }
    return true
  }

  /**
   * Shared label matcher: checks if a candidate string matches ANY active option.
   * Used by scope-cue Phase 2b, the pre-gate (candidate-aware exception),
   * and Tier 1b.3 label matching. Single definition prevents semantic drift.
   *
   * Returns matching options (empty array = no match).
   */
  const findMatchingOptions = (
    candidate: string,
    options: ClarificationOption[],
  ): ClarificationOption[] => {
    const normalizedCandidate = candidate.toLowerCase().trim()
    if (!normalizedCandidate) return []
    return options.filter(opt => {
      const label = opt.label.toLowerCase().trim()
      // 1. Exact / substring / word-boundary match
      if (label === normalizedCandidate ||
          label.includes(normalizedCandidate) ||
          matchesWithWordBoundary(normalizedCandidate, label)) {
        return true
      }
      // 2. Canonical token matching (handles singular/plural)
      const inputTokens = toCanonicalTokens(normalizedCandidate)
      const labelTokens = toCanonicalTokens(label)
      return tokensMatch(inputTokens, labelTokens)
    })
  }

  /**
   * Exact-normalized matcher: finds options whose canonical tokens match the
   * candidate EXACTLY (same token set, no superset/subset).
   *
   * Per intra-selection precedence (exact-first) rule:
   * "open links panel" → {links, panel} matches "Links Panels" → {links, panel} exactly,
   * but NOT "Links Panel D" → {links, panel, d} (superset).
   *
   * Reuses toCanonicalTokens + tokensMatch — no new matching logic.
   */
  const findExactNormalizedMatches = (
    candidate: string,
    options: ClarificationOption[],
  ): ClarificationOption[] => {
    const normalizedCandidate = candidate.toLowerCase().trim()
    if (!normalizedCandidate) return []
    const inputTokens = toCanonicalTokens(normalizedCandidate)
    if (inputTokens.size === 0) return []
    return options.filter(opt => {
      const labelTokens = toCanonicalTokens(opt.label)
      return tokensMatch(inputTokens, labelTokens)
    })
  }

  // ==========================================================================
  // FOCUS LATCH — Scope-Cue Normalization (per scope-cues-addendum-plan.md)
  // Explicit scope cues override latch default. Runs before latch bypass.
  // NOTE: isLatchActive + scopeCue are hoisted above the widget bypass block.
  // ==========================================================================

  if (scopeCue.scope === 'chat') {
    /** Recoverable result with original message identity for option-set linkage. */
    interface RecoverableResult {
      options: ClarificationOption[]
      messageId: string
      source: 'snapshot' | 'lastOptionsShown' | 'lastClarification' | 'recoveryMemory'
    }

    function getRecoverableChatOptionsWithIdentity(): RecoverableResult | null {
      if (clarificationSnapshot?.options?.length) {
        return {
          options: clarificationSnapshot.options,
          messageId: `snapshot-${clarificationSnapshot.timestamp}`,
          source: 'snapshot',
        }
      }
      if (lastOptionsShown?.options?.length) {
        return {
          options: lastOptionsShown.options,
          messageId: lastOptionsShown.messageId,
          source: 'lastOptionsShown',
        }
      }
      if (lastClarification?.options?.length) {
        return {
          options: lastClarification.options,
          messageId: lastClarification.messageId,
          source: 'lastClarification',
        }
      }
      // Durable fallback: explicit-only recovery memory (no TTL, per scope-cue-recovery-plan)
      if (scopeCueRecoveryMemory?.options?.length) {
        return {
          options: scopeCueRecoveryMemory.options,
          messageId: scopeCueRecoveryMemory.messageId,
          source: 'recoveryMemory',
        }
      }
      return null
    }

    /** Restore full chat-active state so subsequent ordinal turns execute against chat options. */
    function restoreFullChatState(options: ClarificationOption[], messageId: string) {
      const pendingOpts: PendingOptionState[] = options.map((o, idx) => ({
        index: idx + 1,
        id: o.id,
        label: o.label,
        sublabel: o.sublabel,
        type: o.type,
        data: reconstructSnapshotData(o),
      }))
      setPendingOptions(pendingOpts)
      setPendingOptionsMessageId(messageId)
      setPendingOptionsGraceCount(0)
      setActiveOptionSetId(messageId)
      setLastClarification({
        type: 'option_selection',
        originalIntent: trimmedInput,
        messageId,
        timestamp: Date.now(),
        options,
      })
      // Update continuity state to track new active option set (Plan 20, B9)
      updateSelectionContinuity({
        activeOptionSetId: messageId,
        activeScope: 'chat',
        pendingClarifierType: 'selection_disambiguation',
      })
    }

    const recoverable = getRecoverableChatOptionsWithIdentity()

    // --- Phase 1: Suspend latch if active (respect scope intent) ---
    if (isLatchActive) {
      suspendFocusLatch()
      clearWidgetSelectionContext()
      void debugLog({ component: 'ChatNavigation', action: 'scope_cue_applied_chat', metadata: { cueText: scopeCue.cueText, latchId: getLatchId(focusLatch), optionCount: recoverable?.options.length ?? 0, source: recoverable?.source } })
    } else {
      // Clear widget selection context when chat scope cue overrides it (no latch case).
      // Without this, stale widgetSelectionContext would re-trigger the bypass on next input.
      if (widgetSelectionContext !== null) {
        clearWidgetSelectionContext()
      }
      void debugLog({ component: 'ChatNavigation', action: 'scope_cue_applied_chat_no_latch', metadata: { cueText: scopeCue.cueText, optionCount: recoverable?.options.length ?? 0, source: recoverable?.source } })
    }

    if (recoverable) {
      const { options: recoverableOptions, messageId: originalMessageId } = recoverable

      // --- Phase 2: Check for selection in input ---
      const optionLabels = recoverableOptions.map(o => o.label)
      const selectionResult = isSelectionOnly(trimmedInput, recoverableOptions.length, optionLabels, 'embedded')

      if (selectionResult.isSelection && selectionResult.index !== undefined) {
        // Single-turn execution: scope cue + ordinal → execute against chat options.
        // Do NOT call restoreFullChatState here — it sets pendingOptions which persist
        // after handleSelectOption (which only clears lastClarification, not pending).
        // Stale pending options cause subsequent inputs to resolve against chat options
        // instead of widget items. We have all data from recoverableOptions directly.
        const selectedOption = recoverableOptions[selectionResult.index]
        const optionToSelect: SelectionOption = {
          type: selectedOption.type as SelectionOption['type'],
          id: selectedOption.id,
          label: selectedOption.label,
          sublabel: selectedOption.sublabel,
          data: reconstructSnapshotData(selectedOption),
        }
        void debugLog({ component: 'ChatNavigation', action: 'scope_cue_chat_single_turn_select', metadata: { index: selectionResult.index, label: selectedOption.label } })
        // Clear any stale pending options before executing (follows pattern at lines 3261, 4242, 4286)
        setPendingOptions([])
        setPendingOptionsMessageId(null)
        setPendingOptionsGraceCount(0)
        setActiveOptionSetId(null)
        setIsLoading(false)
        handleSelectOption(optionToSelect)
        return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
      }

      // --- Phase 2b: Label/shorthand matching against recovered chat options ---
      // Strip scope-cue text from input, then canonicalize for label matching.
      // e.g., "open the panel d from chat" → strip "from chat" → "open the panel d"
      //        → canonicalize → "panel d" → findMatchingOptions → "Links Panel D"
      const cueText = scopeCue.cueText! // guaranteed non-null inside scope === 'chat'
      const lowerInput = trimmedInput.toLowerCase()
      const cueIdx = lowerInput.indexOf(cueText)
      const scopeCueStripped = cueIdx >= 0
        ? (trimmedInput.slice(0, cueIdx) + trimmedInput.slice(cueIdx + cueText.length)).trim()
        : trimmedInput
      const candidateForLabelMatch = canonicalizeCommandInput(scopeCueStripped)

      if (candidateForLabelMatch) {
        // Reuse Tier 1b.3 matching: substring + word-boundary + canonical token matching
        const labelMatches = findMatchingOptions(candidateForLabelMatch, recoverableOptions)

        if (labelMatches.length === 1) {
          // Universal gate: single-match must be high-confidence to execute deterministically
          const scopeCueSingleCandidate = { id: labelMatches[0].id, label: labelMatches[0].label, sublabel: labelMatches[0].sublabel }
          const scopeCueSingleGate = evaluateDeterministicDecision(candidateForLabelMatch, [scopeCueSingleCandidate], 'active_option')

          if (scopeCueSingleGate.outcome === 'execute') {
            const selectedOption = labelMatches[0]
            const optionToSelect: SelectionOption = {
              type: selectedOption.type as SelectionOption['type'],
              id: selectedOption.id,
              label: selectedOption.label,
              sublabel: selectedOption.sublabel,
              data: reconstructSnapshotData(selectedOption),
            }
            void debugLog({
              component: 'ChatNavigation',
              action: 'scope_cue_chat_label_match_select',
              metadata: { label: selectedOption.label, candidate: candidateForLabelMatch, source: recoverable.source, confidence: scopeCueSingleGate.confidence, reason: scopeCueSingleGate.reason },
            })
            setPendingOptions([])
            setPendingOptionsMessageId(null)
            setPendingOptionsGraceCount(0)
            setActiveOptionSetId(null)
            setIsLoading(false)
            handleSelectOption(optionToSelect)
            return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected, _devProvenanceHint: 'deterministic' as const }
          } else {
            // Gate says not high-confidence → fall through to unresolved hook
            // (bounded LLM → safe clarifier). Gate outcome is authoritative.
            void debugLog({
              component: 'ChatNavigation',
              action: 'deterministic_gate_scope_cue_single_soft_match_to_llm',
              metadata: { input: candidateForLabelMatch, matchLabel: labelMatches[0].label, reason: scopeCueSingleGate.reason, confidence: scopeCueSingleGate.confidence },
            })
          }
        }

        if (labelMatches.length > 1) {
          // Multi-match → try exact-first (same findExactNormalizedMatches as Tier 1b.3)
          const exactMatches = findExactNormalizedMatches(candidateForLabelMatch, labelMatches)

          if (exactMatches.length === 1) {
            // Universal gate: exact-normalized must be high-confidence to execute deterministically
            const scopeCueExactCandidate = { id: exactMatches[0].id, label: exactMatches[0].label, sublabel: exactMatches[0].sublabel }
            const scopeCueExactGate = evaluateDeterministicDecision(candidateForLabelMatch, [scopeCueExactCandidate], 'active_option')

            if (scopeCueExactGate.outcome === 'execute') {
              const selectedOption = exactMatches[0]
              const optionToSelect: SelectionOption = {
                type: selectedOption.type as SelectionOption['type'],
                id: selectedOption.id,
                label: selectedOption.label,
                sublabel: selectedOption.sublabel,
                data: reconstructSnapshotData(selectedOption),
              }
              void debugLog({
                component: 'ChatNavigation',
                action: 'scope_cue_chat_label_exact_first_select',
                metadata: { label: selectedOption.label, candidate: candidateForLabelMatch, totalMatches: labelMatches.length, confidence: scopeCueExactGate.confidence, reason: scopeCueExactGate.reason },
              })
              setPendingOptions([])
              setPendingOptionsMessageId(null)
              setPendingOptionsGraceCount(0)
              setActiveOptionSetId(null)
              setIsLoading(false)
              handleSelectOption(optionToSelect)
              return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected, _devProvenanceHint: 'deterministic' as const }
            } else {
              // Gate says not high-confidence → fall through to unresolved hook
              void debugLog({
                component: 'ChatNavigation',
                action: 'deterministic_gate_scope_cue_exact_soft_match_to_llm',
                metadata: { input: candidateForLabelMatch, matchLabel: exactMatches[0].label, reason: scopeCueExactGate.reason, confidence: scopeCueExactGate.confidence },
              })
            }
          }

          // No exact winner or gate blocked → fall through to unified hook below
        }

        // Shared classifiers for continuity resolver (used inside UNIFIED HOOK)
        const strippedIsExplicitCommand = isExplicitCommand(scopeCueStripped)
        const strippedIsSelection = isSelectionOnly(
          scopeCueStripped, recoverableOptions.length,
          recoverableOptions.map(o => o.label), 'embedded'
        ).isSelection

        // Per selection-continuity-execution-lane-plan.md:116 (binding #5):
        // Scope-cue active arbitration with recoverable scoped options keeps
        // one scoped unresolved entry path. Zero-match command phrasing must
        // NOT bypass to downstream routing — stay in scoped unresolved ladder
        // (deterministic → LLM → safe clarifier). Hard exclusions
        // (question_intent, interrupt) are handled inside tryLLMLastChance
        // or before this block (early returns in the scope-cue flow).
        if (recoverableOptions.length > 0) {
          // Strict-exact policy: non-exact signals become advisory hints for the LLM
          let scopeCuePreferredHint: PreferredCandidateHint = null

          // --- Continuity deterministic resolver (Plan 20, Site 1: scope-cue Phase 2b) ---
          // Try deterministic resolution with continuity state before LLM arbitration.
          const isContinuityEnabled = process.env.NEXT_PUBLIC_SELECTION_CONTINUITY_LANE_ENABLED === 'true'
          if (isContinuityEnabled) {
            const inputForQuestionCheck = trimmedInput.replace(/[?!.]+$/, '').trim()
            const continuityResult = tryContinuityDeterministicResolve({
              trimmedInput: scopeCueStripped,
              candidates: recoverableOptions.map(o => ({ id: o.id, label: o.label, sublabel: o.sublabel })),
              continuityState: ctx.selectionContinuity,
              currentOptionSetId: originalMessageId,
              currentScope: scopeCue.scope,
              isCommandOrSelection: strippedIsExplicitCommand || strippedIsSelection,
              isQuestionIntent: hasQuestionIntent(inputForQuestionCheck) && !isPoliteImperativeRequest(trimmedInput),
              labelMatchCount: labelMatches.length,
            })
            if (continuityResult.resolved && continuityResult.winnerId) {
              const winnerCandidate = recoverableOptions.find(o => o.id === continuityResult.winnerId)
              if (winnerCandidate) {
                if (isStrictExactMode()) {
                  // Strict policy: continuity is non-exact → set advisory hint, fall through to LLM
                  scopeCuePreferredHint = { id: winnerCandidate.id, label: winnerCandidate.label, source: 'continuity' }
                  void debugLog({
                    component: 'ChatNavigation',
                    action: 'continuity_hint_deferred_to_llm',
                    metadata: { site: 'scope_cue_phase_2b', winnerId: continuityResult.winnerId, winnerLabel: winnerCandidate.label },
                  })
                  // Fall through to LLM arbitration
                } else {
                  // Legacy: direct execute
                  const optionToSelect: SelectionOption = {
                    type: winnerCandidate.type as SelectionOption['type'],
                    id: winnerCandidate.id,
                    label: winnerCandidate.label,
                    sublabel: winnerCandidate.sublabel,
                    data: reconstructSnapshotData(winnerCandidate),
                  }
                  void debugLog({
                    component: 'ChatNavigation',
                    action: 'selection_deterministic_continuity_resolve',
                    metadata: {
                      site: 'scope_cue_phase_2b',
                      winnerId: continuityResult.winnerId,
                      winnerLabel: winnerCandidate.label,
                      activeOptionSetId: ctx.selectionContinuity.activeOptionSetId,
                      activeScope: ctx.selectionContinuity.activeScope,
                      candidateCount: recoverableOptions.length,
                    },
                  })
                  setPendingOptions([])
                  setPendingOptionsMessageId(null)
                  setPendingOptionsGraceCount(0)
                  setActiveOptionSetId(null)
                  setIsLoading(false)
                  handleSelectOption(optionToSelect)
                  return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected, _devProvenanceHint: 'deterministic' as const }
                }
              }
            }
          }

          // --- UNIFIED HOOK: LLM arbitration for unresolved scope-cue ---
          const scopeCueCandidates = recoverableOptions.map(o => ({
            id: o.id, label: o.label, sublabel: o.sublabel,
          }))
          // Same fix as Tier 1b.3: if we reach the unresolved hook, the gate blocked all matches.
          // Pass matchCount: 0 so the classifier routes to bounded LLM instead of classifier_not_eligible.
          const llmResult = await runBoundedArbitrationLoop({
            trimmedInput,
            initialCandidates: scopeCueCandidates,
            context: 'scope_cue_unresolved',
            clarificationMessageId: originalMessageId,
            inputIsExplicitCommand: isExplicitCommand(trimmedInput),
            isNewQuestionOrCommandDetected,
            matchCount: 0,
            exactMatchCount: 0,
            scope: scopeCue.scope,
            enrichmentCallback: createEnrichmentCallback(scopeCue.scope, 'scope_cue_unresolved', ctx),
            preferredCandidateHint: scopeCuePreferredHint,
          })

          // Scope-specific fallback (per context-enrichment-retry-loop-plan §Binding Hardening)
          if (llmResult.fallbackReason === 'scope_not_available') {
            const scopeLabel = 'This scope'
            addMessage({
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: `${scopeLabel}-scoped selection is not yet available. Please select from the active options shown above.`,
              timestamp: new Date(),
              isError: false,
            })
            setIsLoading(false)
            return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected, _devProvenanceHint: 'safe_clarifier' as const }
          }

          if (llmResult.fallbackReason === 'question_intent') {
            // Question → fall through to Phase 3
            void debugLog({
              component: 'ChatNavigation',
              action: 'scope_cue_unresolved_hook_question_escape',
              metadata: { input: trimmedInput, matchCount: labelMatches.length, source: recoverable.source },
            })
          } else if (llmResult.autoExecute && llmResult.suggestedId) {
            // ===== Phase C: LLM high-confidence auto-execute (scope-cue parity) =====
            // All 3 gates passed in tryLLMLastChance (kill switch + confidence + allowlisted reason).
            const selectedOption = recoverableOptions.find(o => o.id === llmResult.suggestedId)
            if (selectedOption) {
              void debugLog({
                component: 'ChatNavigation',
                action: 'scope_cue_unresolved_hook_llm_auto_execute',
                metadata: {
                  input: trimmedInput,
                  selectedLabel: selectedOption.label,
                  suggestedId: llmResult.suggestedId,
                  source: recoverable.source,
                },
              })

              // Full state cleanup — SAME pattern as Tier 1b.3 auto-execute (scope-cue parity)
              saveClarificationSnapshot(lastClarification ?? {
                type: 'option_selection' as const,
                originalIntent: trimmedInput,
                messageId: originalMessageId,
                timestamp: Date.now(),
                options: recoverableOptions,
              })
              setRepairMemory(selectedOption.id, recoverableOptions)
              setLastClarification(null)
              setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)
              setActiveOptionSetId(null)

              const optionToSelect: SelectionOption = {
                type: selectedOption.type as SelectionOption['type'],
                id: selectedOption.id,
                label: selectedOption.label,
                sublabel: selectedOption.sublabel,
                data: reconstructSnapshotData(selectedOption),
              }
              setIsLoading(false)
              handleSelectOption(optionToSelect)
              return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected, _devProvenanceHint: 'llm_executed' }
            }
            // suggestedId not found in options → fall through to safe clarifier
          } else {
            // --- need_more_info veto (Plan 20, Site 1) ---
            // When LLM couldn't resolve but continuity deterministic can, execute.
            // Note: veto does NOT directly execute. It returns to the existing
            // auto-execute / safe-clarifier flow. autoExecute: false ensures the
            // caller applies its own governing Phase C gates.
            if (isContinuityEnabled && llmResult.attempted && !llmResult.suggestedId) {
              const inputForQuestionCheck = trimmedInput.replace(/[?!.]+$/, '').trim()
              const vetoResult = tryContinuityDeterministicResolve({
                trimmedInput: scopeCueStripped,
                candidates: recoverableOptions.map(o => ({ id: o.id, label: o.label, sublabel: o.sublabel })),
                continuityState: ctx.selectionContinuity,
                currentOptionSetId: originalMessageId,
                currentScope: scopeCue.scope,
                isCommandOrSelection: strippedIsExplicitCommand || strippedIsSelection,
                isQuestionIntent: hasQuestionIntent(inputForQuestionCheck) && !isPoliteImperativeRequest(trimmedInput),
                labelMatchCount: labelMatches.length,
              })
              if (vetoResult.resolved && vetoResult.winnerId) {
                const vetoWinner = recoverableOptions.find(o => o.id === vetoResult.winnerId)
                if (vetoWinner) {
                  if (isStrictExactMode()) {
                    // Strict policy: veto is non-exact → use as reorder hint for safe clarifier
                    scopeCuePreferredHint = scopeCuePreferredHint ?? { id: vetoWinner.id, label: vetoWinner.label, source: 'continuity' }
                    void debugLog({
                      component: 'ChatNavigation',
                      action: 'need_more_info_veto_hint_deferred_to_safe_clarifier',
                      metadata: { site: 'scope_cue_phase_2b', winnerId: vetoResult.winnerId, winnerLabel: vetoWinner.label },
                    })
                    // Fall through to safe clarifier below
                  } else {
                    // Legacy: direct execute
                    void debugLog({
                      component: 'ChatNavigation',
                      action: 'selection_need_more_info_veto_applied',
                      metadata: {
                        site: 'scope_cue_phase_2b',
                        winnerId: vetoResult.winnerId,
                        winnerLabel: vetoWinner.label,
                        activeOptionSetId: ctx.selectionContinuity.activeOptionSetId,
                      },
                    })
                    const optionToSelect: SelectionOption = {
                      type: vetoWinner.type as SelectionOption['type'],
                      id: vetoWinner.id,
                      label: vetoWinner.label,
                      sublabel: vetoWinner.sublabel,
                      data: reconstructSnapshotData(vetoWinner),
                    }
                    setPendingOptions([])
                    setPendingOptionsMessageId(null)
                    setPendingOptionsGraceCount(0)
                    setActiveOptionSetId(null)
                    setIsLoading(false)
                    handleSelectOption(optionToSelect)
                    return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected, _devProvenanceHint: 'deterministic' as const }
                  }
                }
              }
              if (!vetoResult.resolved) {
                void debugLog({
                  component: 'ChatNavigation',
                  action: 'selection_need_more_info_veto_blocked_reason',
                  metadata: { site: 'scope_cue_phase_2b', reason: vetoResult.reason, activeOptionSetId: ctx.selectionContinuity.activeOptionSetId },
                })
              }
            }

            // Safe clarifier — reorder if LLM suggested or hint available (Rules C, D, F)
            const scopeCueReorderHintId = llmResult.suggestedId ?? scopeCuePreferredHint?.id ?? null
            const reorderSource = scopeCueReorderHintId
              ? [
                  ...recoverableOptions.filter(o => o.id === scopeCueReorderHintId),
                  ...recoverableOptions.filter(o => o.id !== scopeCueReorderHintId),
                ]
              : recoverableOptions

            void debugLog({
              component: 'ChatNavigation',
              action: 'scope_cue_unresolved_hook_safe_clarifier',
              metadata: {
                input: trimmedInput,
                llmAttempted: llmResult.attempted,
                llmSuggestedId: llmResult.suggestedId,
                fallbackReason: llmResult.fallbackReason,
                source: recoverable.source,
                matchCount: labelMatches.length,
                strictExactMode: isStrictExactMode(),
                hintSource: scopeCuePreferredHint?.source ?? null,
                hintId: scopeCuePreferredHint?.id ?? null,
              },
            })

            const clarifierMessageId = `assistant-${Date.now()}`
            const clarifierMessage: ChatMessage = {
              id: clarifierMessageId,
              role: 'assistant',
              content: getBasePrompt(),
              timestamp: new Date(),
              isError: false,
              options: reorderSource.map(opt => ({
                type: opt.type as SelectionOption['type'],
                id: opt.id,
                label: opt.label,
                sublabel: opt.sublabel,
                data: reconstructSnapshotData(opt),
              })),
            }
            addMessage(clarifierMessage)
            // CRITICAL: Use reorderSource so ordinal follow-ups match displayed order
            setPendingOptions(reorderSource.map((o, idx) => ({
              index: idx + 1,
              id: o.id,
              label: o.label,
              sublabel: o.sublabel,
              type: o.type,
              data: reconstructSnapshotData(o),
            })))
            setPendingOptionsMessageId(clarifierMessageId)
            setPendingOptionsGraceCount(0)
            setActiveOptionSetId(clarifierMessageId)
            setLastClarification({
              type: 'option_selection',
              originalIntent: trimmedInput,
              messageId: clarifierMessageId,
              timestamp: Date.now(),
              options: reorderSource,
            })
            // Update continuity state to track new active option set (Plan 20, B9)
            // Note: inside scopeCue.scope === 'chat' branch, scope is already 'chat'
            updateSelectionContinuity({
              activeOptionSetId: clarifierMessageId,
              activeScope: 'chat',
              pendingClarifierType: 'selection_disambiguation',
            })
            setIsLoading(false)
            return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected, _devProvenanceHint: (llmResult.suggestedId || scopeCuePreferredHint) ? 'llm_influenced' : 'safe_clarifier' as const }
          }
        }
        // No recoverable options or question-intent → fall through to Phase 3
      }

      // --- Phase 3: No selection detected — check command/question guard ---
      if (isNewQuestionOrCommandDetected) {
        // Input like "open recent in chat" — scope cue intent is respected (latch
        // already suspended above), but the command portion must fall through to
        // downstream routing (Tier 2/4 known-noun). Do NOT restore full chat state
        // here — options stay dormant for a future explicit "from chat" re-anchor.
        void debugLog({ component: 'ChatNavigation', action: 'scope_cue_chat_command_fallthrough', metadata: { cueText: scopeCue.cueText } })
        return { handled: false, clarificationCleared: false, isNewQuestionOrCommandDetected }
      }

      // --- Phase 4: Standalone re-anchor (e.g., "from chat") ---
      restoreFullChatState(recoverableOptions, originalMessageId)
      return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
    } else {
      // No recoverable options
      if (isNewQuestionOrCommandDetected) {
        // "open recent in chat" with no chat options — just fall through
        return { handled: false, clarificationCleared: false, isNewQuestionOrCommandDetected }
      }
      addMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: 'No earlier options available.',
        timestamp: new Date(),
        isError: false,
      })
      setIsLoading(false)
      return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
    }
  } else if (scopeCue.scope === 'dashboard') {
    // Scope-specific need_more_info: dashboard scope is not yet available.
    // Per context-enrichment-retry-loop-plan.md §Binding Hardening Rule 2:
    // unhandled scope must return scope-specific need_more_info, never default to mixed pools.
    void debugLog({ component: 'ChatNavigation', action: 'scope_cue_dashboard_not_available', metadata: { cueText: scopeCue.cueText, input: trimmedInput } })
    addMessage({
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: 'Dashboard-scoped selection is not yet available. Please select from the active options shown above.',
      timestamp: new Date(),
      isError: false,
    })
    setIsLoading(false)
    return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
  } else if (scopeCue.scope === 'workspace') {
    // Scope-specific need_more_info: workspace scope is not yet available.
    void debugLog({ component: 'ChatNavigation', action: 'scope_cue_workspace_not_available', metadata: { cueText: scopeCue.cueText, input: trimmedInput } })
    addMessage({
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: 'Workspace-scoped selection is not yet available. Please select from the active options shown above.',
      timestamp: new Date(),
      isError: false,
    })
    setIsLoading(false)
    return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
  }
  // scopeCue.scope === 'widget' or 'none' falls through to latch/bypass logic below

  // ==========================================================================
  // FOCUS LATCH — Selection-Like Bypass (Rules 2, 4, 6)
  // Per selection-intent-arbitration-incubation-plan.md:
  //   When latch is active + input is selection-like (not command/question),
  //   skip intercept and let Tier 4.5 resolve against latched widget.
  //   Command/question bypass logs fire regardless of selection-like status
  //   so that "open recent" (not selection-like) still logs the bypass.
  // ==========================================================================
  if (isLatchActive) {
    const selectionClassified = isSelectionLike(trimmedInput, { hasBadgeLetters: false })
    const commandDetected = isExplicitCommand(trimmedInput)
    const questionDetected = hasQuestionIntent(trimmedInput)

    // Log input classification for observability (per incubation plan §Observability)
    void debugLog({ component: 'ChatNavigation', action: 'selection_input_classified', metadata: { input: trimmedInput, isSelectionLike: selectionClassified, isCommand: commandDetected, isQuestion: questionDetected, latchActive: true, latchId: getLatchId(focusLatch) } })

    if (commandDetected) {
      // Rule 4: command bypasses latch — logged regardless of selection-like status
      void debugLog({ component: 'ChatNavigation', action: 'focus_latch_bypassed_command', metadata: { latchId: getLatchId(focusLatch), input: trimmedInput } })
    } else if (questionDetected) {
      // Rule 4: question bypasses latch — logged regardless of selection-like status
      void debugLog({ component: 'ChatNavigation', action: 'focus_latch_bypassed_question_intent', metadata: { latchId: getLatchId(focusLatch), input: trimmedInput } })
    } else if (selectionClassified) {
      // Pure selection-like with no command/question → latch applies (Rules 2, 6)
      void debugLog({ component: 'ChatNavigation', action: 'focus_latch_applied', metadata: { latchId: getLatchId(focusLatch), input: trimmedInput } })
      // Return handled: false so Tier 4.5 resolves against latched widget
      return { handled: false, clarificationCleared: false, isNewQuestionOrCommandDetected }
    }
    // else: latch active but input is not selection-like, not command, not question → fall through
  }

  // Fallback guard: If all options are widget_option but no widgetSelectionContext
  // (edge case during transition), still skip clarification-mode handling.
  const allWidgetOptions = lastClarification?.options?.length
    ? lastClarification.options.every(opt => opt.type === 'widget_option')
    : false

  if (allWidgetOptions && hasClarificationContext) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'clarification_skip_widget_options_fallback',
      metadata: {
        userInput: trimmedInput,
        optionCount: lastClarification?.options?.length,
        reason: 'all_widget_options_no_context',
      },
    })
    return { handled: false, clarificationCleared: false, isNewQuestionOrCommandDetected }
  }

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
      setPendingOptions([])
      setPendingOptionsMessageId(null)
      setPendingOptionsGraceCount(0)

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
        saveLastOptionsShown?.(workspaceOptions.map(opt => ({ id: opt.id, label: opt.label, sublabel: opt.sublabel, type: opt.type })), messageId)
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
        // Save clarification snapshot as paused (per interrupt-resume-plan §8-18)
        if (lastClarification?.options && lastClarification.options.length > 0) {
          saveClarificationSnapshot(lastClarification, true)
        }
        setLastClarification(null)
        setPendingOptions([])
        setPendingOptionsMessageId(null)
        setPendingOptionsGraceCount(0)
        return true
      }

      // Per pending-options-resilience-fix.md: If options exist, re-show them with pills
      // instead of showing a generic yes/no message
      // Per clarification-offmenu-handling-plan.md: Use consistent base prompt
      if (lastClarification?.type === 'option_selection' && lastClarification.options && lastClarification.options.length > 0) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'clarification_unclear_reshow_options',
          metadata: { userInput: trimmedInput, optionsCount: lastClarification.options.length },
        })

        const reaskMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: getBasePrompt(),
          timestamp: new Date(),
          isError: false,
          options: lastClarification.options.map(opt => ({
            type: opt.type as SelectionOption['type'],
            id: opt.id,
            label: opt.label,
            sublabel: opt.sublabel,
            data: reconstructSnapshotData(opt),
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
          data: reconstructSnapshotData(opt),
        })) : undefined,
      }
      addMessage(metaMessage)

      setLastClarification({
        ...lastClarification!,
        metaCount: currentMetaCount + 1,
      })
    }

    // Tier -1: Noise pre-check (FIRST check per clarification-response-fit-plan.md)
    // Noise should never trigger selection or zero-overlap escape.
    // Treat input as noise if: alphabetic ratio < 50%, short token, no vowels, emoji-only
    //
    // Exemption: strict ordinals ("1", "2", "a", "b", "first", "last", etc.) bypass noise.
    // Without this, bare digits like "2" hit isNoise (single short token + zero alphabetic
    // ratio) and never reach the ordinal execution path at Tier 1d.
    const noiseOrdinalExempt = lastClarification?.options && lastClarification.options.length > 0
      && isSelectionOnly(trimmedInput, lastClarification.options.length, lastClarification.options.map(o => o.label), 'strict').isSelection

    if (!noiseOrdinalExempt && isNoise(trimmedInput)) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_tier_noise_detected',
        metadata: { userInput: trimmedInput, response_fit_intent: 'noise' },
      })

      // Re-prompt without incrementing attemptCount (noise doesn't count as an attempt)
      const noiseMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: getNoisePrompt(),
        timestamp: new Date(),
        isError: false,
        options: lastClarification!.options?.map(opt => ({
          type: opt.type as SelectionOption['type'],
          id: opt.id,
          label: opt.label,
          sublabel: opt.sublabel,
          data: reconstructSnapshotData(opt),
        })),
      }
      addMessage(noiseMessage)
      setIsLoading(false)
      return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
    }

    // Tier 0: List rejection detection (BEFORE exit phrase check)
    // Per clarification-offmenu-handling-plan.md (E):
    // "none of these", "none of those", "neither" → Refine Mode (NOT exit)
    // Keep the same intent but ask for one detail
    if (isListRejectionPhrase(trimmedInput)) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_tier0_list_rejection',
        metadata: { userInput: trimmedInput, previousOptions: lastClarification?.options?.length, response_fit_intent: 'reject_list' },
      })

      // Enter Refine Mode: clear options but keep intent context
      // Don't fully clear clarification - we're refining, not exiting
      const refineMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: getRefinePrompt(),
        timestamp: new Date(),
        isError: false,
        // No options - we're asking for detail instead
      }
      addMessage(refineMessage)

      // Clear the options but keep clarification active for potential follow-up
      setLastClarification({
        ...lastClarification!,
        options: undefined, // Clear options since user rejected the list
        attemptCount: 0, // Reset attempt count for new refinement
      })
      setPendingOptions([])
      setPendingOptionsMessageId(null)
      setPendingOptionsGraceCount(0)
      setIsLoading(false)
      return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
    }

    // Tier 1a: Exit phrase detection (per clarification-response-fit-plan.md §103-130)
    // "visible = active" rule: ambiguous exits confirm, explicit exits hard-exit.
    // NOTE: "none of these/those" is NOT an exit - it's handled above as list rejection
    //
    // Confirm-prompt reply handling (§125-129):
    // If exitCount >= 1, user already saw a confirm prompt. Check their reply:
    //   - Affirmation → hard-exit
    //   - Negation / "keep choosing" → dismiss confirm, reset exitCount
    //   - Ordinal / label → falls through to normal selection (not handled here)
    //   - Another exit phrase → hard-exit (repeated)
    const currentExitCount = lastClarification?.exitCount ?? 0
    const optionsAreVisible = lastClarification?.options && lastClarification.options.length > 0

    // Check if user is responding to an exit confirmation prompt (exitCount >= 1)
    if (currentExitCount >= 1 && optionsAreVisible) {
      // Affirmation after confirm prompt → hard-exit (§126)
      if (isAffirmationPhrase(trimmedInput)) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'clarification_tier1a_exit_confirmed',
          metadata: { userInput: trimmedInput, exitCount: currentExitCount, response_fit_intent: 'exit_cancel' },
        })
        setLastClarification(null)
        setPendingOptions([])
        setPendingOptionsMessageId(null)
        setPendingOptionsGraceCount(0)
        // Pause snapshot with reason 'stop' so explicit return cues can restore it.
        // Per stop-scope-plan §39-44: pausedReason 'stop' blocks ordinals, allows return signal.
        if (lastClarification?.options && lastClarification.options.length > 0) {
          saveClarificationSnapshot(lastClarification, true, 'stop')
        } else if (clarificationSnapshot) {
          pauseSnapshotWithReason('stop')
        }
        clearFocusLatch() // Latch-off: stop clears focus latch (Phase 6b)
        clearWidgetSelectionContext() // Phase 6: stop/exit clears widget selection context
        setStopSuppressionCount(STOP_SUPPRESSION_TURN_LIMIT) // Per stop-scope-plan §40-48
        const exitMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'Okay — we\'ll drop that. What would you like to do instead?',
          timestamp: new Date(),
          isError: false,
        }
        addMessage(exitMessage)
        setIsLoading(false)
        return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
      }

      // Negation / "keep choosing" after confirm prompt → dismiss confirm, reset exitCount (§127)
      const isKeepChoosing = /^(no|nope|nah|keep\s+(choosing|going)|stay|continue)$/i.test(trimmedInput.trim())
      if (isKeepChoosing) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'clarification_tier1a_exit_dismissed',
          metadata: { userInput: trimmedInput, exitCount: currentExitCount, response_fit_intent: 'keep_choosing' },
        })
        // Reset exitCount, keep options visible
        setLastClarification({
          ...lastClarification!,
          exitCount: 0,
        })
        const keepMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: lastClarification!.clarificationQuestion || 'Which one would you like?',
          timestamp: new Date(),
          isError: false,
          options: lastClarification!.options!.map(opt => ({
            type: opt.type as SelectionOption['type'],
            id: opt.id,
            label: opt.label,
            sublabel: opt.sublabel,
            data: reconstructSnapshotData(opt),
          })),
        }
        addMessage(keepMessage)
        setIsLoading(false)
        return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
      }
      // Ordinal / label / other input after confirm → falls through to normal selection tiers
    }

    // Classify exit intent (pure text check, no state)
    const exitClassification = classifyExitIntent(trimmedInput)

    if (exitClassification !== 'none') {
      // Explicit exit OR repeated ambiguous exit → hard-exit (§114-118, §124)
      if (exitClassification === 'explicit' || currentExitCount >= 1) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'clarification_tier1a_exit_phrase',
          metadata: {
            userInput: trimmedInput,
            exitClassification,
            exitCount: currentExitCount,
            response_fit_intent: 'exit_cancel',
          },
        })
        setLastClarification(null)
        setPendingOptions([])
        setPendingOptionsMessageId(null)
        setPendingOptionsGraceCount(0)
        // Pause snapshot with reason 'stop' so explicit return cues can restore it.
        // Per stop-scope-plan §39-44: pausedReason 'stop' blocks ordinals, allows return signal.
        if (lastClarification?.options && lastClarification.options.length > 0) {
          saveClarificationSnapshot(lastClarification, true, 'stop')
        } else if (clarificationSnapshot) {
          pauseSnapshotWithReason('stop')
        }
        clearFocusLatch() // Latch-off: stop clears focus latch (Phase 6b)
        clearWidgetSelectionContext() // Phase 6: stop/exit clears widget selection context
        resetSelectionContinuity() // Plan 20, B9: Tier 1a exit clears continuity
        setStopSuppressionCount(STOP_SUPPRESSION_TURN_LIMIT) // Per stop-scope-plan §40-48
        const exitMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'Okay — we\'ll drop that. What would you like to do instead?',
          timestamp: new Date(),
          isError: false,
        }
        addMessage(exitMessage)
        setIsLoading(false)
        return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
      }

      // Ambiguous exit, first time, options visible → ask confirm (§122-123)
      if (exitClassification === 'ambiguous' && optionsAreVisible) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'clarification_tier1a_exit_confirm',
          metadata: {
            userInput: trimmedInput,
            exitCount: currentExitCount,
            response_fit_intent: 'potential_exit',
          },
        })
        // Increment exitCount, keep options visible, show confirm prompt
        setLastClarification({
          ...lastClarification!,
          exitCount: currentExitCount + 1,
        })
        const confirmMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'Do you want to cancel and start over, or keep choosing from these options?',
          timestamp: new Date(),
          isError: false,
          options: lastClarification!.options!.map(opt => ({
            type: opt.type as SelectionOption['type'],
            id: opt.id,
            label: opt.label,
            sublabel: opt.sublabel,
            data: reconstructSnapshotData(opt),
          })),
        }
        addMessage(confirmMessage)
        setIsLoading(false)
        return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
      }

      // Ambiguous exit without visible options → hard-exit (no options to preserve)
      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_tier1a_exit_phrase',
        metadata: {
          userInput: trimmedInput,
          exitClassification,
          exitCount: currentExitCount,
          noVisibleOptions: true,
          response_fit_intent: 'exit_cancel',
        },
      })
      setLastClarification(null)
      setPendingOptions([])
      setPendingOptionsMessageId(null)
      setPendingOptionsGraceCount(0)
      // Pause snapshot with reason 'stop' so explicit return cues can restore it.
      // Per stop-scope-plan §39-44: pausedReason 'stop' blocks ordinals, allows return signal.
      if (lastClarification?.options && lastClarification.options.length > 0) {
        saveClarificationSnapshot(lastClarification, true, 'stop')
      } else if (clarificationSnapshot) {
        pauseSnapshotWithReason('stop')
      }
      clearFocusLatch() // Latch-off: stop clears focus latch (Phase 6b)
      clearWidgetSelectionContext() // Phase 6: stop/exit clears widget selection context
      setStopSuppressionCount(STOP_SUPPRESSION_TURN_LIMIT) // Per stop-scope-plan §40-48
      const exitMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: 'Okay — we\'ll drop that. What would you like to do instead?',
        timestamp: new Date(),
        isError: false,
      }
      addMessage(exitMessage)
      setIsLoading(false)
      return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
    }

    // Tier A0: Hesitation/Pause Detection (per clarification-offmenu-handling-plan.md)
    // "hmm", "i don't know", "not sure" → DO NOT increment attemptCount, show softer prompt
    if (isHesitationPhrase(trimmedInput)) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_tier_a0_hesitation',
        metadata: { userInput: trimmedInput, attemptCount: lastClarification?.attemptCount ?? 0, response_fit_intent: 'hesitate' },
      })

      // Re-show pills with softer prompt (NO attemptCount increment)
      const hesitationMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: getHesitationPrompt(),
        timestamp: new Date(),
        isError: false,
        options: lastClarification!.options?.map(opt => ({
          type: opt.type as SelectionOption['type'],
          id: opt.id,
          label: opt.label,
          sublabel: opt.sublabel,
          data: reconstructSnapshotData(opt),
        })),
      }
      addMessage(hesitationMessage)
      setIsLoading(false)
      return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
    }

    // Tier 1b: Local affirmation check
    const hasMultipleOptions = lastClarification!.options && lastClarification!.options.length > 0
    if (isAffirmationPhrase(trimmedInput) && !hasMultipleOptions) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_tier1b_affirmation',
        metadata: { userInput: trimmedInput },
      })
      await executeNextAction()
      setIsLoading(false)
      return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
    }

    // Tier 1c: Local rejection / repair phrase handling
    // Per clarification-offmenu-handling-plan.md (E): Repair phrases stay in context
    // E1: Repair phrases ("not that", "the other one") → stay in context, offer alternative
    // Per clarification-response-fit-plan.md §5: Use repairMemory to resolve "the other one"
    const hasOptions = lastClarification?.options && lastClarification.options.length > 0
    if (isRepairPhrase(trimmedInput) && hasOptions) {
      // Per plan §5: If repairMemory exists and is within turn limit, use it to resolve "the other one"
      const canUseRepairMemory = repairMemory &&
        repairMemory.lastChoiceId &&
        repairMemory.turnsSinceSet < REPAIR_MEMORY_TURN_LIMIT &&
        repairMemory.lastOptionsShown.length > 0

      // For 2-option clarifications with valid repair memory, auto-select the other option
      if (canUseRepairMemory && lastClarification!.options!.length === 2) {
        const otherOption = lastClarification!.options!.find(opt => opt.id !== repairMemory!.lastChoiceId)

        if (otherOption) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_tier1c_repair_phrase_auto_select',
            metadata: {
              userInput: trimmedInput,
              lastChoiceId: repairMemory!.lastChoiceId,
              selectedOtherId: otherOption.id,
              response_fit_intent: 'repair',
            },
          })

          const fullOption = pendingOptions.find(opt => opt.id === otherOption.id)

          // Save clarification snapshot for post-action repair window (per plan §153-161)
          saveClarificationSnapshot(lastClarification!)
          // Update repair memory with the new selection
          setRepairMemory(otherOption.id, lastClarification!.options!)
          setLastClarification(null)
          setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)

          const optionToSelect: SelectionOption = {
            type: (fullOption?.type ?? otherOption.type) as SelectionOption['type'],
            id: otherOption.id,
            label: otherOption.label,
            sublabel: otherOption.sublabel,
            data: fullOption?.data as SelectionOption['data'] ??
              reconstructSnapshotData(otherOption),
          }
          setIsLoading(false)
          handleSelectOption(optionToSelect)
          return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
        }
      }

      // For >2 options or no repair memory, re-show options with repair prompt
      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_tier1c_repair_phrase',
        metadata: {
          userInput: trimmedInput,
          action: 'offer_alternative',
          optionCount: lastClarification!.options!.length,
          hasRepairMemory: !!canUseRepairMemory,
          response_fit_intent: 'repair',
        },
      })

      // Re-show options with repair prompt
      const repairMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: getRepairPrompt(),
        timestamp: new Date(),
        isError: false,
        options: lastClarification!.options?.map(opt => ({
          type: opt.type as SelectionOption['type'],
          id: opt.id,
          label: opt.label,
          sublabel: opt.sublabel,
          data: reconstructSnapshotData(opt),
        })),
      }
      addMessage(repairMessage)
      setIsLoading(false)
      return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
    }

    // E2: Simple "no" → treat as ambiguous refusal, stay in context
    // Per clarification-offmenu-handling-plan.md: Use consistent prompt template
    // Per clarification-response-fit-plan.md §122-130: Repeated "no" escalation
    // Works with ANY number of options (not just 2) - see Example 8 with 7 workspaces
    const isSimpleNo = /^(no|nope|nah)$/i.test(trimmedInput.trim())
    if (isSimpleNo && hasOptions) {
      const currentNoCount = lastClarification!.noCount ?? 0
      const newNoCount = currentNoCount + 1

      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_tier1c_no_as_repair',
        metadata: { userInput: trimmedInput, action: newNoCount >= 2 ? 'reject_list' : 'stay_in_context', noCount: newNoCount, optionCount: lastClarification!.options!.length },
      })

      // Per plan §122-130: If noCount >= 2, treat as reject_list → refine prompt
      if (newNoCount >= 2) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'clarification_repeated_no_escalation',
          metadata: { noCount: newNoCount },
        })

        const refineMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: getRefinePrompt(),
          timestamp: new Date(),
          isError: false,
        }
        addMessage(refineMessage)

        // Clear options but keep clarification active for refinement (same as reject_list)
        setLastClarification({
          ...lastClarification!,
          options: undefined,
          attemptCount: 0,
          noCount: 0, // Reset noCount
        })
        setPendingOptions([])
        setPendingOptionsMessageId(null)
        setPendingOptionsGraceCount(0)
        setIsLoading(false)
        return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
      }

      // Stay in context, re-show options with consistent prompt
      const noRepairMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: getNoRefusalPrompt(),
        timestamp: new Date(),
        isError: false,
        options: lastClarification!.options?.map(opt => ({
          type: opt.type as SelectionOption['type'],
          id: opt.id,
          label: opt.label,
          sublabel: opt.sublabel,
          data: reconstructSnapshotData(opt),
        })),
      }
      addMessage(noRepairMessage)

      // Increment noCount for next time
      setLastClarification({
        ...lastClarification!,
        noCount: newNoCount,
      })
      setIsLoading(false)
      return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
    }

    // E3: Other rejection phrases (not repair, not simple "no" with 2 options) → exit
    if (isRejectionPhrase(trimmedInput)) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_tier1c_rejection_exit',
        metadata: { userInput: trimmedInput },
      })
      handleRejection()
      setIsLoading(false)
      return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
    }

    // Tier 1b.3 matching helpers hoisted above scope-cue block.
    // See findMatchingOptions / findExactNormalizedMatches defined after widget context bypass.

    // ==========================================================================
    // Selection-vs-Command Arbitration Pre-gate
    // Per selection-vs-command-arbitration-rule-plan.md:
    // When command-like input doesn't target any active option, bypass
    // label matching and let it reach Tier 2c/Tier 4 command routing.
    // ==========================================================================
    const inputIsExplicitCommand = isExplicitCommand(trimmedInput)
    const inputIsSelectionLike = isSelectionLike(trimmedInput)

    // Candidate-aware label check: does the RAW input strictly match ANY active option?
    // Per raw-strict-exact plan (Contract rule 1): no stripping/canonicalization for routing decisions.
    // Only raw strict exact match (case-insensitive) qualifies as "targeting" an active option.
    const inputTargetsActiveOption = (() => {
      if (!lastClarification?.options?.length) return false
      if (!inputIsExplicitCommand && !isNewQuestionOrCommandDetected) return false
      return lastClarification.options.some(opt => isStrictExactMatch(trimmedInput, opt.label))
    })()

    const commandBypassesLabelMatching =
      (isNewQuestionOrCommandDetected || inputIsExplicitCommand)
      && !inputIsSelectionLike
      && !inputTargetsActiveOption  // ANY match keeps in selection flow

    // Tier 1b.3: Label matching for option selection (BEFORE new-intent escape)
    // Per pending-options-resilience-fix.md: "links panel e" should match "Links Panel E" option
    // even if it looks like a new command. Selection takes priority over new-intent escape.
    // IMPORTANT: If input matches MULTIPLE options (e.g., "links panel" matches both D and E),
    // do NOT auto-select - fall through to re-show options instead.
    if (commandBypassesLabelMatching) {
      // Clear stale clarification state so downstream tiers don't inherit it.
      // Without this, Tier 4.5 grounding LLM picks up stale options as candidates.
      // MUST return immediately — local lastClarification param stays stale otherwise.
      if (lastClarification?.options?.length) {
        saveClarificationSnapshot(lastClarification)
        setLastClarification(null)
        setPendingOptions([])
        setPendingOptionsMessageId(null)
        setPendingOptionsGraceCount(0)
      }
      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_selection_bypassed_command_intent',
        metadata: {
          input: trimmedInput,
          activeOptionsCount: lastClarification?.options?.length ?? 0,
          isExplicitCommand: inputIsExplicitCommand,
          isNewQuestionOrCommandDetected,
          inputTargetsActiveOption,
          clarificationCleared: !!lastClarification?.options?.length,
          escapeReason: inputIsExplicitCommand ? 'explicit_command_priority'
            : !lastClarification?.options?.length ? 'no_active_options'
            : 'command_bypass_not_selection_like',
        },
      })
      return {
        handled: false,
        clarificationCleared: !!lastClarification?.options?.length,
        isNewQuestionOrCommandDetected,
      }
    } else if (lastClarification?.options && lastClarification.options.length > 0) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_selection_allowed_selection_like',
        metadata: {
          input: trimmedInput,
          activeOptionsCount: lastClarification.options.length,
          isSelectionLike: inputIsSelectionLike,
          isExplicitCommand: inputIsExplicitCommand,
          inputTargetsActiveOption,
        },
      })

      // ==========================================================================
      // Clarification-Mode Command Normalization (per plan §215-227)
      // Strip command verbs, normalize typos, enable badge-aware selection
      // ==========================================================================

      // Command verbs to strip from input before matching
      const COMMAND_VERBS = new Set(['open', 'show', 'go', 'view', 'close'])


      // Normalize command verb typos in input
      const normalizeCommandVerbs = (input: string): { normalized: string, hadVerb: boolean, originalVerb: string | null } => {
        const tokens = input.toLowerCase().split(/\s+/)
        let hadVerb = false
        let originalVerb: string | null = null

        const normalizedTokens = tokens.map((token, index) => {
          // Only check first token for verb
          if (index === 0) {
            // Check for exact verb match
            if (COMMAND_VERBS.has(token)) {
              hadVerb = true
              originalVerb = token
              return token
            }
          }
          return token
        })

        return {
          normalized: normalizedTokens.join(' '),
          hadVerb,
          originalVerb,
        }
      }

      // Strip command verb from input for label matching
      const stripCommandVerb = (input: string): string => {
        const tokens = input.toLowerCase().split(/\s+/)
        if (tokens.length > 1 && COMMAND_VERBS.has(tokens[0])) {
          return tokens.slice(1).join(' ')
        }
        return input
      }

      // Extract badge from input (single letter or number at the end)
      // e.g., "link panel d" → badge: "d", "panel 2" → badge: "2"
      const extractBadge = (input: string): { badge: string | null, inputWithoutBadge: string } => {
        const tokens = input.toLowerCase().split(/\s+/).filter(Boolean)
        if (tokens.length === 0) return { badge: null, inputWithoutBadge: input }

        // Strip trailing punctuation (e.g., "d?" → "d", "d!" → "d")
        const lastToken = tokens[tokens.length - 1].replace(/[?!.,;:]+$/, '')
        // Badge is a single letter (a-z) or single digit (1-9)
        if (/^[a-z]$/.test(lastToken) || /^[1-9]$/.test(lastToken)) {
          return {
            badge: lastToken,
            inputWithoutBadge: tokens.slice(0, -1).join(' '),
          }
        }
        return { badge: null, inputWithoutBadge: input }
      }

      // Apply clarification-mode normalization
      const verbNormResult = normalizeCommandVerbs(trimmedInput)
      const inputAfterVerbNorm = verbNormResult.normalized
      const inputWithoutVerb = stripCommandVerb(inputAfterVerbNorm)
      const { badge: extractedBadge, inputWithoutBadge } = extractBadge(inputWithoutVerb)

      // ==========================================================================
      // Command Verb Escape (per plan §224-226)
      // If input starts with an exact command verb and targets a non-option,
      // allow new-topic escape. Only fires for exact COMMAND_VERBS.
      // e.g., "open recent" → escape to new topic
      // ==========================================================================
      if (verbNormResult.hadVerb && verbNormResult.originalVerb) {
        // Check if the rest of the input (after verb) does NOT match any current option
        const restOfInput = inputWithoutVerb.toLowerCase().trim()
        const matchesCurrentOption = lastClarification.options.some(opt => {
          const normalizedLabel = opt.label.toLowerCase()
          return normalizedLabel.includes(restOfInput) || restOfInput.includes(normalizedLabel)
        })

        // If it doesn't match current options, it might be a new-topic command
        // Check if it looks like a valid command target (e.g., "recent", "panel", known term)
        const knownCommandTargets = ['recent', 'panel', 'widget', 'demo', 'note', 'notes', 'doc', 'docs']
        const isKnownTarget = knownCommandTargets.some(target => restOfInput.includes(target))

        if (!matchesCurrentOption && isKnownTarget) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_command_typo_escape',
            metadata: {
              originalInput: trimmedInput,
              normalizedInput: inputAfterVerbNorm,
              verb: verbNormResult.originalVerb,
              target: restOfInput,
            },
          })

          // Save clarification snapshot as paused — command typo escape (per interrupt-resume-plan §8-18)
          saveClarificationSnapshot(lastClarification, true)
          setLastClarification(null)
          setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)
          clarificationCleared = true
          // Fall through to normal routing with the normalized input
          // The normalized input will be handled by other handlers
        }
      }

      const normalizedInput = trimmedInput.toLowerCase().trim()
      // Also prepare verb-stripped version for matching (per plan §215-218)
      const inputForMatching = inputWithoutVerb.toLowerCase().trim()

      // Strict-exact policy: non-exact signals become advisory hints for the LLM
      let preferredCandidateHint: PreferredCandidateHint = null

      // ==========================================================================
      // Badge-aware Selection (per plan §220-222)
      // If input has a badge suffix (d, e, 1, 2), match against option labels
      // e.g., "open link panel d" → badge "d" → match "Links Panel D"
      // Guard: verify-open questions skip badge execution → fall through to LLM.
      // "did i open the links panel d?" → isVerifyOpenQuestion → skip badge → LLM answers.
      // ==========================================================================
      if (extractedBadge && inputWithoutBadge && !isVerifyOpenQuestion(trimmedInput)) {
        const badgeMatchingOptions = lastClarification.options.filter(opt => {
          const normalizedLabel = opt.label.toLowerCase()
          // Check if label ends with the badge (case-insensitive)
          // e.g., "Links Panel D" ends with "d"
          const labelTokens = normalizedLabel.split(/\s+/)
          const lastLabelToken = labelTokens[labelTokens.length - 1]
          return lastLabelToken === extractedBadge
        })

        if (badgeMatchingOptions.length === 1) {
          const matchedOption = badgeMatchingOptions[0]

          if (isStrictExactMode()) {
            // Strict policy: badge is non-exact → set advisory hint, fall through to unresolved hook
            preferredCandidateHint = { id: matchedOption.id, label: matchedOption.label, source: 'badge' }
            void debugLog({
              component: 'ChatNavigation',
              action: 'badge_hint_deferred_to_llm',
              metadata: { input: trimmedInput, badge: extractedBadge, matchedLabel: matchedOption.label },
            })
            // Fall through — do NOT execute, do NOT clear state
          } else {
            // Legacy: direct execute
            const fullOption = pendingOptions.find(opt => opt.id === matchedOption.id)

            void debugLog({
              component: 'ChatNavigation',
              action: 'clarification_badge_aware_selection',
              metadata: {
                input: trimmedInput,
                badge: extractedBadge,
                matchedLabel: matchedOption.label,
              },
            })

            // Save clarification snapshot for post-action repair window
            saveClarificationSnapshot(lastClarification)
            setRepairMemory(matchedOption.id, lastClarification.options)
            setLastClarification(null)
            setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)

            const optionToSelect: SelectionOption = {
              type: (fullOption?.type ?? matchedOption.type) as SelectionOption['type'],
              id: matchedOption.id,
              label: matchedOption.label,
              sublabel: matchedOption.sublabel,
              data: fullOption?.data as SelectionOption['data'] ??
                reconstructSnapshotData(matchedOption),
            }
            setIsLoading(false)
            handleSelectOption(optionToSelect)
            return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected, _devProvenanceHint: 'deterministic' as const }
          }
        }
      }

      // ==========================================================================
      // Polite-wrapper exact pass (pre-gate)
      // Canonicalize input (strip polite phrases, verbs, articles, punctuation),
      // then check for strict exact label match (case-insensitive) among active options.
      // "can you open links panels?" → canonical "links panels" === "Links Panels" → execute.
      // Only fires on strict label equality — no canonical token or soft matching.
      // Guard: verify-open questions skip this pass entirely.
      // Scoped exception: active-option clarification context (Tier 1b.3) only.
      // ==========================================================================
      // Per raw-strict-exact plan (Contract rule 1): polite-wrapper stripping is advisory only.
      // Never deterministic-execute from stripped match. Always set as hint for bounded LLM.
      const politeExactMatch = findPoliteWrapperExactMatch(trimmedInput, lastClarification.options)
      if (politeExactMatch) {
        preferredCandidateHint = preferredCandidateHint ?? { id: politeExactMatch.id, label: politeExactMatch.label, source: 'polite_wrapper' }
        void debugLog({
          component: 'ChatNavigation',
          action: 'polite_wrapper_hint_deferred_to_llm',
          metadata: { input: trimmedInput, canonical: canonicalizeCommandInput(trimmedInput), matchedLabel: politeExactMatch.label },
        })
        // Fall through — do NOT execute, do NOT clear state
      }

      // Track exact match count for unresolved hook (hoisted for Step 4)
      let lastExactMatchCount = 0

      // Find ALL matching options using shared findMatchingOptions helper.
      // Per raw-strict-exact contract Rule 1: raw input only, no verb-stripped union.
      const matchingOptions = findMatchingOptions(normalizedInput, lastClarification.options)

      // Only auto-select if EXACTLY ONE option matches AND it's high-confidence.
      // If multiple match (e.g., "links panel" matches both D and E), fall through to re-show.
      // Universal deterministic confidence gate: soft matches fall through to unresolved hook.
      if (matchingOptions.length === 1) {
        const matchedOption = matchingOptions[0]

        // Route through shared gate — same contract as Sites 1-3 in routing-dispatcher.ts
        const gateDecision = evaluateDeterministicDecision(
          trimmedInput,
          [{ id: matchedOption.id, label: matchedOption.label, sublabel: matchedOption.sublabel }],
          'active_option'
        )

        if (gateDecision.outcome === 'execute') {
          const fullOption = pendingOptions.find(opt => opt.id === matchedOption.id)

          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_tier1b3_label_selection',
            metadata: {
              input: trimmedInput,
              matchedLabel: matchedOption.label,
              hasFullOption: !!fullOption,
              matchCount: 1,
              confidence: gateDecision.confidence,
              reason: gateDecision.reason,
            },
          })

          // Save clarification snapshot for post-action repair window (per plan §153-161)
          saveClarificationSnapshot(lastClarification)
          // Set repair memory for label selection (enables "the other one" after label match)
          setRepairMemory(matchedOption.id, lastClarification.options)
          setLastClarification(null)
          setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)

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
            return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected, _devProvenanceHint: 'deterministic' as const }
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
            return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected, _devProvenanceHint: 'deterministic' as const }
          }
        } else {
          // Gate says not high-confidence → fall through to unresolved hook
          // (bounded LLM → safe clarifier). Gate outcome is authoritative.
          void debugLog({
            component: 'ChatNavigation',
            action: 'deterministic_gate_tier1b3_soft_match_to_llm',
            metadata: {
              input: trimmedInput,
              matchedLabel: matchedOption.label,
              confidence: gateDecision.confidence,
              reason: gateDecision.reason,
              outcome: gateDecision.outcome,
            },
          })
          // Do NOT clear pendingOptions or lastClarification — preserve for LLM
        }
      } else if (matchingOptions.length > 1) {
        // Multiple options match (e.g., "links panel" matches both D and E)
        // =================================================================
        // Intra-Selection Precedence: Exact-First
        // Per selection-vs-command-arbitration-rule-plan.md addendum:
        // Before re-showing, check if ONE option matches EXACTLY on
        // canonical tokens. If so, auto-select the exact winner.
        // e.g., "open links panel" → {links,panel} matches "Links Panels"
        //        exactly but NOT "Links Panel D" (superset).
        // =================================================================
        // Per raw-strict-exact contract Rule 1: raw input only, no verb-stripped union.
        const exactMatches = findExactNormalizedMatches(normalizedInput, matchingOptions)

        if (exactMatches.length === 1) {
          // Exact-first winner: one option matches exactly on canonical tokens.
          // Route through shared gate — gate outcome is authoritative.
          const matchedOption = exactMatches[0]
          // Per raw-strict-exact contract Rule 1: use raw input, no verb stripping.
          const exactNormGateDecision = evaluateDeterministicDecision(
            trimmedInput,
            [{ id: matchedOption.id, label: matchedOption.label, sublabel: matchedOption.sublabel }],
            'active_option'
          )

          if (exactNormGateDecision.outcome === 'execute') {
            // Gate confirms high-confidence → deterministic execute
            const fullOption = pendingOptions.find(opt => opt.id === matchedOption.id)

            void debugLog({
              component: 'ChatNavigation',
              action: 'clarification_exact_normalized_match_selected',
              metadata: {
                input: trimmedInput,
                matchedLabel: matchedOption.label,
                hasFullOption: !!fullOption,
                broadMatchCount: matchingOptions.length,
                exactMatchCount: 1,
                activeOptionsCount: lastClarification.options.length,
                isExplicitCommand: inputIsExplicitCommand,
                isSelectionLike: inputIsSelectionLike,
                gateOutcome: exactNormGateDecision.outcome,
                gateConfidence: exactNormGateDecision.confidence,
                gateReason: exactNormGateDecision.reason,
              },
            })

            // Save clarification snapshot for post-action repair window
            saveClarificationSnapshot(lastClarification)
            setRepairMemory(matchedOption.id, lastClarification.options)
            setLastClarification(null)
            setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)

            const optionToSelect: SelectionOption = {
              type: (fullOption?.type ?? matchedOption.type) as SelectionOption['type'],
              id: matchedOption.id,
              label: matchedOption.label,
              sublabel: matchedOption.sublabel,
              data: fullOption?.data as SelectionOption['data'] ??
                reconstructSnapshotData(matchedOption),
            }
            setIsLoading(false)
            handleSelectOption(optionToSelect)
            return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected, _devProvenanceHint: 'deterministic' as const }
          } else {
            // Gate says not high-confidence (token-exact but not string-exact)
            // → fall through to unresolved hook (bounded LLM). Do NOT execute.
            void debugLog({
              component: 'ChatNavigation',
              action: 'deterministic_gate_exact_normalized_to_llm',
              metadata: {
                input: trimmedInput,
                matchedLabel: matchedOption.label,
                broadMatchCount: matchingOptions.length,
                gateOutcome: exactNormGateDecision.outcome,
                gateConfidence: exactNormGateDecision.confidence,
                gateReason: exactNormGateDecision.reason,
              },
            })
            // Do NOT clear state — preserve for LLM
          }
        }

        // No exact winner — hoist count for unresolved hook, then fall through
        // (Rule E: LLM arbitration moved to single unresolved hook below)
        lastExactMatchCount = exactMatches.length
      }

      // =================================================================
      // Ordinal guard — skip hook for ordinal inputs
      // Ordinals like "first", "2", "the second one" should be handled
      // by Tier 1b.3a (deterministic), not by LLM.
      // Strict mode: only bare ordinals ("first", "2") skip; embedded
      // ordinals ("can you open the first one pls") enter the hook.
      // =================================================================
      const ordinalCheck = isSelectionOnly(
        trimmedInput,
        lastClarification.options.length,
        lastClarification.options.map(o => o.label),
        isStrictExactMode() ? 'strict' : 'embedded'
      )

      if (!ordinalCheck.isSelection || preferredCandidateHint) {
        // =================================================================
        // UNRESOLVED HOOK (Rule E: single post-deterministic arbitration)
        // Reached when:
        //   - matchingOptions.length === 0 (no deterministic match), OR
        //   - matchingOptions.length > 1 with no single exact winner
        // Both mean: the app is NOT 100% sure → call LLM, don't force action.
        //
        // Rule G: NO inputIsExplicitCommand bypass here.
        // If we're inside label matching, input IS related to active options
        // (isSelectionLike=true OR inputTargetsActiveOption=true).
        // Deterministic failed. LLM is mandatory.
        // Hard exclusions (Rule G): question-intent only (handled inside
        // tryLLMLastChance). Pre-gate already handles "nothing to do with
        // active options" escapes via commandBypassesLabelMatching.
        // =================================================================

        // --- Continuity deterministic resolver (Plan 20, Site 2: Tier 1b.3) ---
        const isContinuityEnabledTier1b3 = process.env.NEXT_PUBLIC_SELECTION_CONTINUITY_LANE_ENABLED === 'true'
        if (isContinuityEnabledTier1b3) {
          const inputForQuestionCheck = trimmedInput.replace(/[?!.]+$/, '').trim()
          const continuityResult = tryContinuityDeterministicResolve({
            trimmedInput,
            candidates: lastClarification.options.map(o => ({ id: o.id, label: o.label, sublabel: o.sublabel })),
            continuityState: ctx.selectionContinuity,
            currentOptionSetId: lastClarification.messageId ?? null,
            currentScope: scopeCue.scope === 'none' ? 'chat' : scopeCue.scope,
            isCommandOrSelection: inputIsExplicitCommand || ordinalCheck.isSelection || inputIsSelectionLike,
            isQuestionIntent: hasQuestionIntent(inputForQuestionCheck) && !isPoliteImperativeRequest(trimmedInput),
            labelMatchCount: matchingOptions.length,
          })
          if (continuityResult.resolved && continuityResult.winnerId) {
            const winnerCandidate = lastClarification.options.find(o => o.id === continuityResult.winnerId)
            if (winnerCandidate) {
              if (isStrictExactMode()) {
                // Strict policy: continuity is non-exact → set advisory hint, fall through to LLM
                preferredCandidateHint = preferredCandidateHint ?? { id: winnerCandidate.id, label: winnerCandidate.label, source: 'continuity' }
                void debugLog({
                  component: 'ChatNavigation',
                  action: 'continuity_hint_deferred_to_llm',
                  metadata: { site: 'tier1b3_unresolved', winnerId: continuityResult.winnerId, winnerLabel: winnerCandidate.label },
                })
                // Fall through to LLM arbitration
              } else {
                // Legacy: direct execute
                const fullOption = pendingOptions.find(opt => opt.id === winnerCandidate.id)
                const optionToSelect: SelectionOption = {
                  type: (fullOption?.type ?? winnerCandidate.type) as SelectionOption['type'],
                  id: winnerCandidate.id,
                  label: winnerCandidate.label,
                  sublabel: winnerCandidate.sublabel,
                  data: fullOption?.data as SelectionOption['data'] ??
                    reconstructSnapshotData(winnerCandidate),
                }
                void debugLog({
                  component: 'ChatNavigation',
                  action: 'selection_deterministic_continuity_resolve',
                  metadata: {
                    site: 'tier1b3_unresolved',
                    winnerId: continuityResult.winnerId,
                    winnerLabel: winnerCandidate.label,
                    activeOptionSetId: ctx.selectionContinuity.activeOptionSetId,
                    activeScope: ctx.selectionContinuity.activeScope,
                    candidateCount: lastClarification.options.length,
                  },
                })
                saveClarificationSnapshot(lastClarification)
                setRepairMemory(winnerCandidate.id, lastClarification.options)
                setLastClarification(null)
                setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)
                setIsLoading(false)
                handleSelectOption(optionToSelect)
                return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
              }
            }
          }
        }

        // If we reach here, no match survived the gate (deterministic, badge, or polite-wrapper).
        // Pass matchCount: 0 so the arbitration classifier treats this as "no viable deterministic match"
        // and routes to bounded LLM. Without this, matchCount=1 (a soft match the gate rejected)
        // causes classifier_not_eligible, preventing the LLM from ever being called.
        const tier1b3Candidates = lastClarification.options.map(o => ({
          id: o.id, label: o.label, sublabel: o.sublabel,
        }))
        const llmResult = await runBoundedArbitrationLoop({
          trimmedInput,
          initialCandidates: tier1b3Candidates,
          context: 'tier1b3_unresolved',
          clarificationMessageId: lastClarification.messageId ?? '',
          inputIsExplicitCommand,
          isNewQuestionOrCommandDetected,
          matchCount: 0,
          exactMatchCount: 0,
          scope: scopeCue.scope,
          enrichmentCallback: createEnrichmentCallback(scopeCue.scope, 'tier1b3_unresolved', ctx),
          preferredCandidateHint,
        })

        // Scope-specific fallback (per context-enrichment-retry-loop-plan §Binding Hardening)
        if (llmResult.fallbackReason === 'scope_not_available') {
          const scopeLabel = 'This scope'
          addMessage({
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: `${scopeLabel}-scoped selection is not yet available. Please select from the active options shown above.`,
            timestamp: new Date(),
            isError: false,
          })
          setIsLoading(false)
          return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected, _devProvenanceHint: 'safe_clarifier' as const }
        }

        if (llmResult.fallbackReason === 'question_intent') {
          // Question → fall through to downstream (hard exclusion per Rule G)
          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_unresolved_hook_question_escape',
            metadata: {
              input: trimmedInput,
              matchCount: matchingOptions.length,
              exactMatchCount: lastExactMatchCount,
              activeOptionsCount: lastClarification.options.length,
            },
          })
          // Fall through to downstream tiers
        } else if (llmResult.autoExecute && llmResult.suggestedId) {
          // ===== Phase C: LLM high-confidence auto-execute =====
          // All 3 gates passed in tryLLMLastChance (kill switch + confidence + allowlisted reason).
          const selectedOption = lastClarification.options.find(o => o.id === llmResult.suggestedId)
          if (selectedOption) {
            const fullOption = pendingOptions.find(opt => opt.id === selectedOption.id)

            void debugLog({
              component: 'ChatNavigation',
              action: 'clarification_unresolved_hook_llm_auto_execute',
              metadata: {
                input: trimmedInput,
                selectedLabel: selectedOption.label,
                suggestedId: llmResult.suggestedId,
                matchCount: matchingOptions.length,
              },
            })

            // Full state cleanup — same pattern as badge-aware selection (lines 3798-3802)
            saveClarificationSnapshot(lastClarification)
            setRepairMemory(selectedOption.id, lastClarification.options)
            setLastClarification(null)
            setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)

            const optionToSelect: SelectionOption = {
              type: (fullOption?.type ?? selectedOption.type) as SelectionOption['type'],
              id: selectedOption.id,
              label: selectedOption.label,
              sublabel: selectedOption.sublabel,
              data: fullOption?.data as SelectionOption['data'] ?? reconstructSnapshotData(selectedOption),
            }
            setIsLoading(false)
            handleSelectOption(optionToSelect)
            return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected, _devProvenanceHint: 'llm_executed' }
          }
          // suggestedId not found in options → fall through to safe clarifier
        } else {
          // --- need_more_info veto (Plan 20, Site 2: Tier 1b.3) ---
          if (isContinuityEnabledTier1b3 && llmResult.attempted && !llmResult.suggestedId) {
            const inputForQuestionCheck = trimmedInput.replace(/[?!.]+$/, '').trim()
            const vetoResult = tryContinuityDeterministicResolve({
              trimmedInput,
              candidates: lastClarification.options.map(o => ({ id: o.id, label: o.label, sublabel: o.sublabel })),
              continuityState: ctx.selectionContinuity,
              currentOptionSetId: lastClarification.messageId ?? null,
              currentScope: scopeCue.scope === 'none' ? 'chat' : scopeCue.scope,
              isCommandOrSelection: inputIsExplicitCommand || ordinalCheck.isSelection || inputIsSelectionLike,
              isQuestionIntent: hasQuestionIntent(inputForQuestionCheck) && !isPoliteImperativeRequest(trimmedInput),
              labelMatchCount: matchingOptions.length,
            })
            if (vetoResult.resolved && vetoResult.winnerId) {
              const vetoWinner = lastClarification.options.find(o => o.id === vetoResult.winnerId)
              if (vetoWinner) {
                if (isStrictExactMode()) {
                  // Strict policy: veto is non-exact → use as reorder hint for safe clarifier
                  preferredCandidateHint = preferredCandidateHint ?? { id: vetoWinner.id, label: vetoWinner.label, source: 'continuity' }
                  void debugLog({
                    component: 'ChatNavigation',
                    action: 'need_more_info_veto_hint_deferred_to_safe_clarifier',
                    metadata: { site: 'tier1b3_unresolved', winnerId: vetoResult.winnerId, winnerLabel: vetoWinner.label },
                  })
                  // Fall through to safe clarifier below
                } else {
                  // Legacy: direct execute
                  const fullOption = pendingOptions.find(opt => opt.id === vetoWinner.id)
                  void debugLog({
                    component: 'ChatNavigation',
                    action: 'selection_need_more_info_veto_applied',
                    metadata: {
                      site: 'tier1b3_unresolved',
                      winnerId: vetoResult.winnerId,
                      winnerLabel: vetoWinner.label,
                      activeOptionSetId: ctx.selectionContinuity.activeOptionSetId,
                    },
                  })
                  saveClarificationSnapshot(lastClarification)
                  setRepairMemory(vetoWinner.id, lastClarification.options)
                  setLastClarification(null)
                  setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)
                  const optionToSelect: SelectionOption = {
                    type: (fullOption?.type ?? vetoWinner.type) as SelectionOption['type'],
                    id: vetoWinner.id,
                    label: vetoWinner.label,
                    sublabel: vetoWinner.sublabel,
                    data: fullOption?.data as SelectionOption['data'] ?? reconstructSnapshotData(vetoWinner),
                  }
                  setIsLoading(false)
                  handleSelectOption(optionToSelect)
                  return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
                }
              }
            }
            if (!vetoResult.resolved) {
              void debugLog({
                component: 'ChatNavigation',
                action: 'selection_need_more_info_veto_blocked_reason',
                metadata: { site: 'tier1b3_unresolved', reason: vetoResult.reason, activeOptionSetId: ctx.selectionContinuity.activeOptionSetId },
              })
            }
          }

          // Safe clarifier — reorder if LLM suggested or hint available (Rules C, D, F)
          const reorderHintId = llmResult.suggestedId ?? preferredCandidateHint?.id ?? null
          const reorderSource = reorderHintId
            ? [
                ...lastClarification.options.filter(o => o.id === reorderHintId),
                ...lastClarification.options.filter(o => o.id !== reorderHintId),
              ]
            : lastClarification.options

          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_unresolved_hook_safe_clarifier',
            metadata: {
              input: trimmedInput,
              matchCount: matchingOptions.length,
              exactMatchCount: lastExactMatchCount,
              llmAttempted: llmResult.attempted,
              llmSuggestedId: llmResult.suggestedId,
              fallbackReason: llmResult.fallbackReason,
              activeOptionsCount: lastClarification.options.length,
              strictExactMode: isStrictExactMode(),
              hintSource: preferredCandidateHint?.source ?? null,
              hintId: preferredCandidateHint?.id ?? null,
            },
          })

          const messageId = `assistant-${Date.now()}`
          const reshowMessage: ChatMessage = {
            id: messageId,
            role: 'assistant',
            content: getBasePrompt(),
            timestamp: new Date(),
            isError: false,
            options: reorderSource.map(opt => {
              const fullOpt = pendingOptions.find(p => p.id === opt.id)
              return {
                type: opt.type as SelectionOption['type'],
                id: opt.id,
                label: opt.label,
                sublabel: opt.sublabel,
                data: fullOpt?.data as SelectionOption['data'] ?? reconstructSnapshotData(opt),
              }
            }),
          }
          addMessage(reshowMessage)
          // Full state rebinding — prevents desync between displayed options and ordinal follow-ups
          setPendingOptions(reorderSource.map((o, idx) => {
            const fullOpt = pendingOptions.find(p => p.id === o.id)
            return {
              index: idx + 1,
              id: o.id,
              label: o.label,
              sublabel: o.sublabel,
              type: o.type,
              data: fullOpt?.data as SelectionOption['data'] ?? reconstructSnapshotData(o),
            }
          }))
          setPendingOptionsMessageId(messageId)
          setPendingOptionsGraceCount(0)
          setActiveOptionSetId(messageId)
          setLastClarification({
            type: 'option_selection',
            originalIntent: trimmedInput,
            messageId,
            timestamp: Date.now(),
            options: reorderSource,
          })
          // Update continuity state to track new active option set (Plan 20, B9)
          updateSelectionContinuity({
            activeOptionSetId: messageId,
            activeScope: scopeCue.scope === 'none' ? 'chat' : scopeCue.scope,
            pendingClarifierType: 'selection_disambiguation',
          })
          setIsLoading(false)
          return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected, _devProvenanceHint: (llmResult.suggestedId || preferredCandidateHint) ? 'llm_influenced' : 'safe_clarifier' as const }
        }
      }
      // ordinal → skip hook, Tier 1b.3a handles it
    }

    // Tier 1b.3a: Ordinal selection (BEFORE off-menu mapping)
    // "first", "1", "second", "2", etc. should select the corresponding option
    // Must come BEFORE off-menu mapping to prevent ordinals from being treated as no_match
    // Strict mode: only strict ordinals execute; embedded ordinals → hint → unresolved hook
    if (lastClarification?.options && lastClarification.options.length > 0) {
      const tier1b3aOrdinalResult = isSelectionOnly(
        trimmedInput,
        lastClarification.options.length,
        lastClarification.options.map(opt => opt.label),
        isStrictExactMode() ? 'strict' : 'embedded'
      )

      if (tier1b3aOrdinalResult.isSelection && tier1b3aOrdinalResult.index !== undefined) {
        const selectedOption = lastClarification.options[tier1b3aOrdinalResult.index]
        const fullOption = pendingOptions.find(opt => opt.id === selectedOption.id)

        void debugLog({
          component: 'ChatNavigation',
          action: 'clarification_tier1b3a_ordinal_selection',
          metadata: {
            input: trimmedInput,
            index: tier1b3aOrdinalResult.index,
            selectedLabel: selectedOption.label,
            clarificationType: lastClarification.type,
          },
          metrics: {
            event: 'clarification_resolved',
            selectedLabel: selectedOption.label,
            timestamp: Date.now(),
          },
        })

        // Save clarification snapshot for post-action repair window (per plan §153-161)
        saveClarificationSnapshot(lastClarification)
        // Set repair memory for ordinal selection (enables "the other one" after ordinal)
        setRepairMemory(selectedOption.id, lastClarification.options)
        setLastClarification(null)
        setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)

        const optionToSelect: SelectionOption = {
          type: (fullOption?.type ?? selectedOption.type) as SelectionOption['type'],
          id: selectedOption.id,
          label: selectedOption.label,
          sublabel: selectedOption.sublabel,
          data: fullOption?.data as SelectionOption['data'] ??
            reconstructSnapshotData(selectedOption),
        }
        setIsLoading(false)
        handleSelectOption(optionToSelect)
        return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected, _devProvenanceHint: 'deterministic' as const }
      }
    }

    // ==========================================================================
    // Known-Noun Interrupt (per routing-order-priority-plan.md Tier 2 item 8)
    //
    // If a clarification list is active and the input is a known noun without
    // a verb, allow it to interrupt ONLY when:
    //   - it does NOT overlap the active list's option labels, and
    //   - it is NOT a question signal.
    // This prevents "widget manager" from being trapped by an unrelated list.
    // ==========================================================================
    if (lastClarification?.options && lastClarification.options.length > 0 && !isNewQuestionOrCommandDetected) {
      const knownNounMatch = matchKnownNoun(trimmedInput)
      if (knownNounMatch && !hasQuestionIntent(trimmedInput)) {
        // Check label overlap: tokenize input and all option labels
        const inputTokens = toCanonicalTokens(trimmedInput)
        const allOptionTokens = new Set<string>()
        for (const opt of lastClarification.options) {
          for (const t of toCanonicalTokens(opt.label)) {
            allOptionTokens.add(t)
          }
        }
        let hasOverlap = false
        for (const t of inputTokens) {
          if (allOptionTokens.has(t)) { hasOverlap = true; break }
        }

        if (!hasOverlap) {
          // No overlap → treat as interrupt: pause active list and return
          // unhandled so the dispatcher routes to Tier 4 (known-noun execution).
          // We must return immediately BEFORE the response-fit classifier runs,
          // otherwise the classifier consumes the input as ask_clarify.
          void debugLog({
            component: 'ChatNavigation',
            action: 'known_noun_interrupt_active_list',
            metadata: {
              input: trimmedInput,
              nounPanelId: knownNounMatch.panelId,
              nounTitle: knownNounMatch.title,
              activeListOptions: lastClarification.options.map(o => o.label),
              tier: 2,
            },
          })
          // Pause the active list (same as handleUnclear new-intent path)
          if (lastClarification?.options && lastClarification.options.length > 0) {
            saveClarificationSnapshot(lastClarification, true)
          }
          setLastClarification(null)
          setPendingOptions([])
          setPendingOptionsMessageId(null)
          setPendingOptionsGraceCount(0)
          isNewQuestionOrCommandDetected = true
          // Return unhandled so dispatcher continues to Tier 4
          return { handled: false, clarificationCleared: true, isNewQuestionOrCommandDetected }
        }
      }
    }

    // ==========================================================================
    // Response-Fit Classifier (per clarification-response-fit-plan.md)
    // Unified classification layer that handles:
    // - Short hints → ask_clarify
    // - Mapped with confidence → execute/confirm/ask (ladder)
    // - Ambiguous → soft_reject
    // - New topic → escape
    // - Optional LLM fallback
    // - Escalation as last resort
    // ==========================================================================
    if (lastClarification?.options && lastClarification.options.length > 0 && !isNewQuestionOrCommandDetected) {
      // Map clarification type to ClarificationType
      const clarificationType: ClarificationType = lastClarification.type === 'cross_corpus'
        ? 'cross_corpus'
        : lastClarification.type === 'workspace_list'
          ? 'workspace_list'
          : lastClarification.originalIntent === 'panel_disambiguation'
            ? 'panel_disambiguation'
            : 'option_selection'

      // Run Response-Fit classification
      const responseFit = classifyResponseFit(trimmedInput, lastClarification.options, clarificationType)

      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_response_fit',
        metadata: {
          input: trimmedInput,
          intent: responseFit.intent,
          confidence: responseFit.confidence,
          reason: responseFit.reason,
          choiceId: responseFit.choiceId,
          matchedLabel: responseFit.matchedOption?.label,
          response_fit_intent: responseFit.intent,
        },
      })

      // Handle based on intent
      switch (responseFit.intent) {
        case 'select': {
          // Apply confidence ladder per plan §4
          if (responseFit.confidence >= CONFIDENCE_THRESHOLD_EXECUTE && responseFit.matchedOption) {
            // High confidence → execute selection
            const matchedOption = responseFit.matchedOption
            const fullOption = pendingOptions.find(opt => opt.id === matchedOption.id)

            void debugLog({
              component: 'ChatNavigation',
              action: 'clarification_response_fit_execute',
              metadata: {
                input: trimmedInput,
                matchedLabel: matchedOption.label,
                confidence: responseFit.confidence,
              },
              metrics: {
                event: 'clarification_response_fit_select',
                timestamp: Date.now(),
              },
            })

            // Save clarification snapshot for post-action repair window (per plan §153-161)
            saveClarificationSnapshot(lastClarification)
            // Wire repair memory: store selection for "the other one" support
            setRepairMemory(matchedOption.id, lastClarification.options)

            setLastClarification(null)
            setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)

            const optionToSelect: SelectionOption = {
              type: (fullOption?.type ?? matchedOption.type) as SelectionOption['type'],
              id: matchedOption.id,
              label: matchedOption.label,
              sublabel: matchedOption.sublabel,
              data: fullOption?.data as SelectionOption['data'] ??
                reconstructSnapshotData(matchedOption),
            }
            setIsLoading(false)
            handleSelectOption(optionToSelect)
            return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }

          } else if (responseFit.confidence >= CONFIDENCE_THRESHOLD_CONFIRM && responseFit.matchedOption) {
            // Medium confidence → ask confirmation
            const matchedOption = responseFit.matchedOption

            void debugLog({
              component: 'ChatNavigation',
              action: 'clarification_response_fit_confirm',
              metadata: {
                input: trimmedInput,
                matchedLabel: matchedOption.label,
                confidence: responseFit.confidence,
                response_fit_intent: 'asked_confirm_instead_of_execute',
              },
            })

            // Don't increment attemptCount for confirmation
            const confirmMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: getConfirmPrompt(matchedOption.label),
              timestamp: new Date(),
              isError: false,
              options: lastClarification.options.map(opt => ({
                type: opt.type as SelectionOption['type'],
                id: opt.id,
                label: opt.label,
                sublabel: opt.sublabel,
                data: reconstructSnapshotData(opt),
              })),
            }
            addMessage(confirmMessage)
            setIsLoading(false)
            return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }

          } else {
            // Low confidence → ask clarify (don't execute)
            void debugLog({
              component: 'ChatNavigation',
              action: 'clarification_response_fit_low_confidence',
              metadata: {
                input: trimmedInput,
                confidence: responseFit.confidence,
                response_fit_intent: 'prevented_low_confidence_execute',
              },
            })

            // Fall through to ask_clarify handling below
          }
          break
        }

        case 'soft_reject': {
          // Near-match but ambiguous → ask explicit clarification
          // Use actual best-matching candidates from Response-Fit, not arbitrary first 2
          const candidateLabels = (responseFit.candidateOptions && responseFit.candidateOptions.length > 0)
            ? responseFit.candidateOptions.map(opt => opt.label)
            : lastClarification.options.slice(0, 2).map(opt => opt.label)

          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_response_fit_soft_reject',
            metadata: {
              input: trimmedInput,
              candidateLabels,
              response_fit_intent: 'soft_reject',
            },
          })

          // Don't increment attemptCount for soft reject
          const softRejectMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: getSoftRejectPrompt(candidateLabels),
            timestamp: new Date(),
            isError: false,
            options: lastClarification.options.map(opt => ({
              type: opt.type as SelectionOption['type'],
              id: opt.id,
              label: opt.label,
              sublabel: opt.sublabel,
              data: reconstructSnapshotData(opt),
            })),
          }
          addMessage(softRejectMessage)
          setIsLoading(false)
          return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
        }

        case 'new_topic': {
          // Clear command / new topic → escape clarification
          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_response_fit_new_topic',
            metadata: {
              input: trimmedInput,
              reason: responseFit.reason,
              response_fit_intent: 'new_topic',
            },
            metrics: {
              event: 'clarification_response_fit_reroute',
              timestamp: Date.now(),
            },
          })

          // Save clarification snapshot as paused — new topic escape (per interrupt-resume-plan §8-18)
          saveClarificationSnapshot(lastClarification, true)
          // Clear repair memory on new topic
          clearRepairMemory()
          setLastClarification(null)
          setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)
          clarificationCleared = true
          // Fall through to normal routing
          break
        }

        case 'ask_clarify':
        default: {
          // Short hint or unclear → try LLM fallback, then escalate
          const currentAttemptCount = lastClarification.attemptCount ?? 0

          // Try LLM fallback for uncertain cases
          if (shouldCallLLMFallback(currentAttemptCount, trimmedInput)) {
            void debugLog({
              component: 'ChatNavigation',
              action: 'clarification_llm_fallback_triggered',
              metadata: {
                input: trimmedInput,
                attemptCount: currentAttemptCount,
                optionCount: lastClarification.options.length,
                triggerReason: responseFit.reason,
              },
            })

            // Build context for LLM including repair memory status
            const hasValidRepairMemory = repairMemory &&
              repairMemory.lastChoiceId &&
              repairMemory.turnsSinceSet < REPAIR_MEMORY_TURN_LIMIT &&
              repairMemory.lastOptionsShown.length > 0
            const contextParts: string[] = []
            if (lastClarification.type === 'cross_corpus') {
              contextParts.push('cross-corpus search')
            }
            if (!hasValidRepairMemory) {
              contextParts.push('No prior selection made - "repair" intent is invalid, use "reject_list" instead if user rejects')
            }

            const llmResult = await callClarificationLLMClient({
              userInput: trimmedInput,
              // Per plan: pass stable IDs to LLM for choiceId contract
              options: lastClarification.options.map(opt => ({
                id: opt.id,
                label: opt.label,
                sublabel: opt.sublabel,
              })),
              context: contextParts.length > 0 ? contextParts.join('. ') : undefined,
            })

            if (llmResult.success && llmResult.response) {
              const { choiceId, choiceIndex, decision, confidence, reason } = llmResult.response

              void debugLog({
                component: 'ChatNavigation',
                action: 'clarification_llm_fallback_result',
                metadata: {
                  decision,
                  choiceId,
                  choiceIndex,
                  confidence,
                  reason,
                  latencyMs: llmResult.latencyMs,
                },
                metrics: {
                  event: 'clarification_llm_decision',
                  timestamp: Date.now(),
                },
              })

              // Apply confidence ladder to LLM result
              // Per plan: use choiceId (stable ID) for selection, not choiceIndex
              if (decision === 'select' && choiceId) {
                // Find option by stable ID (preferred per plan contract)
                const selectedOpt = lastClarification.options.find(opt => opt.id === choiceId)
                if (selectedOpt && confidence >= CONFIDENCE_THRESHOLD_EXECUTE) {
                  // LLM high confidence → execute
                  const fullOption = pendingOptions.find(opt => opt.id === selectedOpt.id)

                  // Save clarification snapshot for post-action repair window (per plan §153-161)
                  saveClarificationSnapshot(lastClarification)
                  setRepairMemory(selectedOpt.id, lastClarification.options)
                  setLastClarification(null)
                  setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)

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
                  }
                } else if (selectedOpt && confidence >= CONFIDENCE_THRESHOLD_CONFIRM) {
                  // LLM medium confidence → confirm
                  const confirmMsg: ChatMessage = {
                    id: `assistant-${Date.now()}`,
                    role: 'assistant',
                    content: getConfirmPrompt(selectedOpt.label),
                    timestamp: new Date(),
                    isError: false,
                    options: lastClarification.options.map(opt => ({
                      type: opt.type as SelectionOption['type'],
                      id: opt.id,
                      label: opt.label,
                      sublabel: opt.sublabel,
                      data: reconstructSnapshotData(opt),
                    })),
                  }
                  addMessage(confirmMsg)
                  setIsLoading(false)
                  return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
                }
                // Low confidence or invalid choiceId → fall through to escalation
              } else if (decision === 'reroute') {
                // Save clarification snapshot as paused — LLM reroute (per interrupt-resume-plan §8-18)
                saveClarificationSnapshot(lastClarification, true)
                clearRepairMemory()
                setLastClarification(null)
                setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)
                clarificationCleared = true
                // Fall through to normal routing
                break
              } else if (decision === 'repair') {
                // LLM detected repair intent (e.g., "nto that" = "not that")
                // Use repair memory to resolve, similar to deterministic repair handler
                void debugLog({
                  component: 'ChatNavigation',
                  action: 'clarification_llm_repair',
                  metadata: { userInput: trimmedInput, confidence, reason },
                })

                // Check if we have valid repair memory
                if (repairMemory && repairMemory.lastChoiceId &&
                    repairMemory.turnsSinceSet < REPAIR_MEMORY_TURN_LIMIT &&
                    repairMemory.lastOptionsShown.length > 0) {

                  // For 2-option repair memory, auto-select the other option
                  if (repairMemory.lastOptionsShown.length === 2) {
                    const otherOption = repairMemory.lastOptionsShown.find(
                      opt => opt.id !== repairMemory.lastChoiceId
                    )

                    if (otherOption) {
                      void debugLog({
                        component: 'ChatNavigation',
                        action: 'clarification_llm_repair_auto_select',
                        metadata: {
                          lastChoiceId: repairMemory.lastChoiceId,
                          selectedOtherId: otherOption.id,
                        },
                      })

                      // Save clarification snapshot for post-action repair window (per plan §153-161)
                      saveClarificationSnapshot(lastClarification)
                      setRepairMemory(otherOption.id, repairMemory.lastOptionsShown)
                      setLastClarification(null)
                      setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)

                      const optionToSelect: SelectionOption = {
                        type: otherOption.type as SelectionOption['type'],
                        id: otherOption.id,
                        label: otherOption.label,
                        sublabel: otherOption.sublabel,
                        data: otherOption.type === 'doc'
                          ? { docSlug: otherOption.id }
                          : { term: otherOption.id, action: 'doc' as const },
                      }
                      setIsLoading(false)
                      handleSelectOption(optionToSelect)
                      return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
                    }
                  }

                  // For >2 options, re-show options with repair prompt
                  const repairMessage: ChatMessage = {
                    id: `assistant-${Date.now()}`,
                    role: 'assistant',
                    content: getRepairPrompt(),
                    timestamp: new Date(),
                    isError: false,
                    options: repairMemory.lastOptionsShown.map(opt => ({
                      type: opt.type as SelectionOption['type'],
                      id: opt.id,
                      label: opt.label,
                      sublabel: opt.sublabel,
                      data: reconstructSnapshotData(opt),
                    })),
                  }
                  addMessage(repairMessage)

                  setLastClarification({
                    type: 'option_selection',
                    originalIntent: 'llm_repair_restore',
                    messageId: repairMessage.id,
                    timestamp: Date.now(),
                    clarificationQuestion: getRepairPrompt(),
                    options: repairMemory.lastOptionsShown,
                    metaCount: 0,
                  })

                  setIsLoading(false)
                  return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
                }
                // No valid repair memory - user said "not that" but hasn't selected anything
                // Treat as list rejection ("none of that") and enter Refine Mode
                void debugLog({
                  component: 'ChatNavigation',
                  action: 'clarification_llm_repair_no_memory_as_reject',
                  metadata: { userInput: trimmedInput, confidence, reason },
                })

                const refineMessage: ChatMessage = {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: getRefinePrompt(),
                  timestamp: new Date(),
                  isError: false,
                }
                addMessage(refineMessage)

                // Clear options but keep clarification active for refinement (same as reject_list)
                setLastClarification({
                  ...lastClarification!,
                  options: undefined,
                  attemptCount: 0,
                })
                setPendingOptions([])
                setPendingOptionsMessageId(null)
                setPendingOptionsGraceCount(0)
                setIsLoading(false)
                return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
              } else if (decision === 'reject_list') {
                // LLM detected list rejection (e.g., "nto those" = "none of those")
                // Enter Refine Mode, similar to deterministic list rejection handler
                void debugLog({
                  component: 'ChatNavigation',
                  action: 'clarification_llm_reject_list',
                  metadata: { userInput: trimmedInput, confidence, reason },
                })

                const refineMessage: ChatMessage = {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: getRefinePrompt(),
                  timestamp: new Date(),
                  isError: false,
                }
                addMessage(refineMessage)

                // Clear options but keep clarification active for refinement
                setLastClarification({
                  ...lastClarification!,
                  options: undefined,
                  attemptCount: 0,
                })
                setPendingOptions([])
                setPendingOptionsMessageId(null)
                setPendingOptionsGraceCount(0)
                setIsLoading(false)
                return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
              }
              // 'none', 'ask_clarify', or low confidence → fall through to escalation
            }
          }

          // Escalation: re-show options with escalation/ask-clarify message
          const newAttemptCount = currentAttemptCount + 1

          // Use ask-clarify prompt for short hints WITH overlap, escalation for no-overlap or repeated attempts
          // Don't use "Are you looking for X?" when X has no overlap with options (e.g., "nto that")
          const inputTokens = toCanonicalTokens(trimmedInput)
          const hasOverlap = responseFit.reason.includes('partial_overlap') || responseFit.reason.includes('full_overlap')
          const useAskClarifyPrompt = hasOverlap && newAttemptCount === 1
          const escalation = getEscalationMessage(newAttemptCount)

          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_response_fit_escalate',
            metadata: {
              input: trimmedInput,
              attemptCount: newAttemptCount,
              showExits: escalation.showExits,
              useAskClarifyPrompt,
              reason: responseFit.reason,
            },
            metrics: {
              event: 'clarification_response_fit_escalate',
              timestamp: Date.now(),
            },
          })

          const messageId = `assistant-${Date.now()}`

          // Build options array
          const baseOptions: SelectionOption[] = lastClarification.options.map(opt => {
            const fullOpt = pendingOptions.find(p => p.id === opt.id)
            return {
              type: opt.type as SelectionOption['type'],
              id: opt.id,
              label: opt.label,
              sublabel: opt.sublabel,
              data: fullOpt?.data as SelectionOption['data'] ?? reconstructSnapshotData(opt),
            }
          })

          // Append exit pills when escalation threshold reached
          const exitPills: SelectionOption[] = escalation.showExits
            ? getExitOptions().map(exit => ({
                type: 'exit' as const,
                id: exit.id,
                label: exit.label,
                data: { exitType: exit.id === 'exit_none' ? 'none' : 'start_over' } as const,
              }))
            : []

          if (escalation.showExits) {
            void debugLog({
              component: 'ChatNavigation',
              action: 'clarification_exit_pill_shown',
              metadata: { attemptCount: newAttemptCount },
              metrics: { event: 'clarification_exit_pill_shown', timestamp: Date.now() },
            })
          }

          // Affirmation with multiple options: targeted "Which one?" prompt
          // instead of generic escalation (per clarification-response-fit-plan.md Step 1)
          const isAffirmationMultiple = responseFit.reason === 'affirmation_multiple_options'
          const optionOrdinals = lastClarification.options.map((_: ClarificationOption, i: number) => {
            const words = ['first', 'second', 'third', 'fourth', 'fifth']
            return `**${words[i] ?? `${i + 1}`}**`
          })
          const affirmationPrompt = `Which one? Reply ${optionOrdinals.join(', ')}, or say **"none of these"**.`

          const reaskMessage: ChatMessage = {
            id: messageId,
            role: 'assistant',
            content: isAffirmationMultiple
              ? affirmationPrompt
              : useAskClarifyPrompt
                ? getAskClarifyPrompt(Array.from(inputTokens), lastClarification.options.map(o => o.label))
                : escalation.content,
            timestamp: new Date(),
            isError: false,
            options: [...baseOptions, ...exitPills],
          }
          addMessage(reaskMessage)
          setPendingOptionsMessageId(messageId)

          // Update attemptCount
          setLastClarification({
            ...lastClarification,
            attemptCount: newAttemptCount,
          })

          // Increment repair memory turn counter
          incrementRepairMemoryTurn()

          setIsLoading(false)
          return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
        }
      }
    }

    // Tier 1b.4: Fuzzy/typo match against pending options (before new-intent escape)
    // Per clarification-typo-resilience-fix: Catches typos like:
    // - "links panelx" → resembles "Links Panel D/E" options
    // - "workspaces 2b" → resembles "Workspace 2" option
    // If input resembles a pending option but triggered isNewQuestionOrCommandDetected,
    // it's likely a typo - re-show options instead of escaping to cross-corpus.
    if (lastClarification?.options && lastClarification.options.length > 0 && isNewQuestionOrCommandDetected) {
      // Guard: skip fuzzy re-show if input matches visible panels (command-like panel intent).
      // Only check on dashboard mode where visibleWidgets exist.
      // "can you open links panel pls" should NOT re-show stale Recent options —
      // it should fall through to Tier 2c panel disambiguation.
      const dashboardWidgets = uiContext?.mode === 'dashboard' ? uiContext?.dashboard?.visibleWidgets : undefined
      const panelMatch = dashboardWidgets?.length ? matchVisiblePanelCommand(trimmedInput, dashboardWidgets) : null
      if (panelMatch && panelMatch.type !== 'none') {
        void debugLog({
          component: 'ChatNavigation',
          action: 'tier1b4_skip_panel_command_intent',
          metadata: { input: trimmedInput, matchType: panelMatch.type, matchCount: panelMatch.matches.length },
        })
        // Fall through to normal routing — don't re-show stale options
      } else {
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
              data: fullOpt?.data as SelectionOption['data'] ?? reconstructSnapshotData(opt),
            }
          }),
        }
        addMessage(reaskMessage)
        setPendingOptionsMessageId(messageId)
        setIsLoading(false)
        return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
      }
      } // end else (no panel-match guard)
    }

    // Tier 1b.5: New intent escape
    if (isNewQuestionOrCommandDetected) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_exit_new_intent',
        metadata: { userInput: trimmedInput, isBareNounNewIntent },
      })
      // Save clarification snapshot as paused — new intent escape (per interrupt-resume-plan §8-18)
      if (lastClarification?.options && lastClarification.options.length > 0) {
        saveClarificationSnapshot(lastClarification, true)
      }
      setLastClarification(null)
      setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)
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
      const clarificationSelectionResult = isSelectionOnly(trimmedInput, lastClarification.options.length, clarificationOptionLabels, 'embedded')

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
        setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)
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
          return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected, _devProvenanceHint: 'deterministic' as const }
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
          return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected, _devProvenanceHint: 'deterministic' as const }
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
