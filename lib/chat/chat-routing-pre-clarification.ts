/**
 * Chat Routing — Pre-Clarification Phases
 *
 * Extracted from chat-routing-clarification-intercept.ts (PR3c).
 * Handles all early-return phases that run BEFORE the main clarification
 * mode handler: repair memory, return signals, post-action ordinals,
 * stop scope, and bare ordinal detection.
 *
 * @internal — Do not import directly outside lib/chat/.
 * Use the barrel at @/lib/chat/chat-routing instead.
 */

import { debugLog } from '@/lib/utils/debug-logger'
import {
  isRepairPhrase,
  getRepairPrompt,
  detectReturnSignal,
  isExitPhrase,
} from '@/lib/chat/clarification-offmenu'
import {
  isAffirmationPhrase,
} from '@/lib/chat/query-patterns'
import {
  isSelectionOnly,
  isExplicitCommand,
} from '@/lib/chat/input-classifiers'
import {
  isLLMFallbackEnabledClient,
  callReturnCueLLM,
} from '@/lib/chat/clarification-llm-fallback'
import { REPAIR_MEMORY_TURN_LIMIT, STOP_SUPPRESSION_TURN_LIMIT } from '@/lib/chat/chat-navigation-context'
import type { ChatMessage, SelectionOption } from '@/lib/chat'
import type {
  ClarificationInterceptContext,
  ClarificationInterceptResult,
  PreClarificationComputedState,
} from './chat-routing-types'
import { reconstructSnapshotData } from './chat-routing-clarification-utils'

// =============================================================================
// Cluster 1: Repair Handlers
// =============================================================================

/**
 * Early repair memory handler (before clarification block).
 * Per clarification-response-fit-plan.md §5: Support "the other one" even after
 * clarification is cleared. Runs BEFORE the hasClarificationContext check.
 *
 * Returns result if handled, null to continue.
 */
export function handleEarlyRepairMemory(
  ctx: ClarificationInterceptContext,
  computed: Pick<PreClarificationComputedState, 'isNewQuestionOrCommandDetected'>,
): ClarificationInterceptResult | null {
  const {
    trimmedInput,
    repairMemory,
    setRepairMemory,
    setIsLoading,
    handleSelectOption,
    addMessage,
    setLastClarification,
  } = ctx
  const { isNewQuestionOrCommandDetected } = computed

  if (!(isRepairPhrase(trimmedInput) && repairMemory &&
      repairMemory.lastChoiceId &&
      repairMemory.turnsSinceSet < REPAIR_MEMORY_TURN_LIMIT &&
      repairMemory.lastOptionsShown.length > 0)) {
    return null
  }

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

/**
 * Post-action repair window (per plan §153-161).
 * If user sends repair phrase after an action (no active clarification) but we
 * have a recent snapshot, restore the clarification options.
 *
 * Returns result if handled, null to continue.
 */
export function handlePostActionRepairWindow(
  ctx: ClarificationInterceptContext,
  computed: Pick<PreClarificationComputedState, 'isNewQuestionOrCommandDetected'>,
): ClarificationInterceptResult | null {
  const {
    trimmedInput,
    clarificationSnapshot,
    addMessage,
    setLastClarification,
    setIsLoading,
    clearClarificationSnapshot,
  } = ctx
  const { isNewQuestionOrCommandDetected } = computed

  if (!(isRepairPhrase(trimmedInput) &&
      clarificationSnapshot &&
      !clarificationSnapshot.paused &&
      clarificationSnapshot.options.length > 0)) {
    return null
  }

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

  // For 2-option snapshot, log (auto-select not possible without knowing last choice)
  if (clarificationSnapshot.options.length === 2) {
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

// =============================================================================
// Cluster 2: Return Signal + Paused Repair
// =============================================================================

/**
 * Return signal: resume paused list (per interrupt-resume-plan §21-38).
 * If the snapshot is paused (from an interrupt), the user can resume it
 * with an explicit return signal, LLM return-cue detection, or affirmation.
 *
 * Returns result if handled, null to continue.
 */
export async function handleReturnSignal(
  ctx: ClarificationInterceptContext,
  computed: Pick<PreClarificationComputedState, 'isNewQuestionOrCommandDetected'>,
): Promise<ClarificationInterceptResult | null> {
  const {
    trimmedInput,
    lastClarification,
    clarificationSnapshot,
    addMessage,
    setLastClarification,
    setIsLoading,
    setRepairMemory,
    handleSelectOption,
    clearClarificationSnapshot,
  } = ctx
  const { isNewQuestionOrCommandDetected } = computed

  if (!(
    !lastClarification &&
    clarificationSnapshot &&
    clarificationSnapshot.paused &&
    clarificationSnapshot.options.length > 0
  )) {
    return null
  }

  // Affirmation with paused snapshot = confirm return (Tier 3 recovery).
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

    // Simple return signal (no ordinal): restore the paused list
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

  // ------------------------------------------------------------------
  // Tier 2: LLM fallback for return-cue detection
  // ------------------------------------------------------------------
  const isOrdinalInput = isSelectionOnly(
    trimmedInput,
    clarificationSnapshot.options.length,
    clarificationSnapshot.options.map(o => o.label),
    'embedded'
  ).isSelection

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

        // LLM says not_return → fall through
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
        // LLM failed → Tier 3: confirm prompt
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

  return null
}

/**
 * Paused-snapshot repair guard (per interrupt-resume-plan §80-85).
 * If user sends repair phrase after an interrupt (paused snapshot),
 * absorb with a neutral cancel/clarify prompt.
 *
 * Returns result if handled, null to continue.
 */
export function handlePausedSnapshotRepairGuard(
  ctx: ClarificationInterceptContext,
  computed: Pick<PreClarificationComputedState, 'isNewQuestionOrCommandDetected'>,
): ClarificationInterceptResult | null {
  const {
    trimmedInput,
    lastClarification,
    clarificationSnapshot,
    addMessage,
    setIsLoading,
  } = ctx
  const { isNewQuestionOrCommandDetected } = computed

  if (!(
    !lastClarification &&
    clarificationSnapshot &&
    clarificationSnapshot.paused &&
    clarificationSnapshot.options.length > 0 &&
    isRepairPhrase(trimmedInput)
  )) {
    return null
  }

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

// =============================================================================
// Cluster 3: Post-Action Ordinal + Stop Scope + Bare Ordinal
// =============================================================================

/**
 * Post-action ordinal window (Selection Persistence, per plan §131-147).
 * Ordinals resolve against snapshots — both active and paused.
 *
 * Returns result if handled, null to continue.
 */
export function handlePostActionOrdinalWindow(
  ctx: ClarificationInterceptContext,
  computed: Pick<PreClarificationComputedState, 'isNewQuestionOrCommandDetected' | 'latchBlocksStaleChat'>,
): ClarificationInterceptResult | null {
  const {
    trimmedInput,
    lastClarification,
    pendingOptions,
    uiContext,
    clarificationSnapshot,
    setRepairMemory,
    setIsLoading,
    handleSelectOption,
    addMessage,
    clearClarificationSnapshot,
    focusLatch,
    setFocusLatch,
    isLatchEnabled,
    activeSnapshotWidgetId,
  } = ctx
  const { isNewQuestionOrCommandDetected, latchBlocksStaleChat } = computed

  if (!(
    !lastClarification &&
    clarificationSnapshot &&
    clarificationSnapshot.options.length > 0
  )) {
    return null
  }

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
    // POST-ACTION SELECTION GATE (anti-garbage guard)
    const rawNormalized = trimmedInput.toLowerCase().trim()
    const STRICT_ORDINAL_PATTERN = /\b(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th|one|two|three|four|five|top|bottom)\b/i
    const hasStrictOrdinal = STRICT_ORDINAL_PATTERN.test(rawNormalized) || /^[1-9]$/.test(rawNormalized) || /^[a-e]$/i.test(rawNormalized) || /^option\s*[1-9]$/i.test(rawNormalized)
    const hasExactLabelMatch = clarificationSnapshot.options.some(
      opt => opt.label.toLowerCase().trim() === rawNormalized
    )

    if (!hasStrictOrdinal && !hasExactLabelMatch) {
      // Garbage input — skip post-action selection, fall through
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
      // STOP-PAUSED ORDINAL GUARD
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

      // INTERRUPT-PAUSED ORDINAL GUARD (Guard #2)
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
          // Don't handle — let ordinal fall through
        } else {
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

        if (hasOtherActivePills || hasOpenDrawerList || latchBlocksStaleChat) {
          // Fall through to downstream handlers
        } else {
          // Only list — proceed with selection
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

      // Non-paused snapshot (active post-selection window)
      if (!clarificationSnapshot.pausedReason) {
        const isLatchOrPreLatch = isLatchEnabled && (
          (focusLatch && !focusLatch.suspended) ||
          (!focusLatch && !!activeSnapshotWidgetId)
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
          if (isLatchEnabled && !focusLatch && activeSnapshotWidgetId) {
            setFocusLatch({
              kind: 'resolved',
              widgetId: activeSnapshotWidgetId,
              widgetLabel: activeSnapshotWidgetId,
              latchedAt: Date.now(),
              turnsSinceLatched: 0,
            })
            void debugLog({ component: 'ChatNavigation', action: 'focus_latch_set', metadata: { widgetId: activeSnapshotWidgetId, trigger: 'post_action_ordinal_prelatch_promotion' } })
          }
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

  return null
}

/**
 * Stop scope resolution — Priority 3: No Active Scope.
 * Per clarification-stop-scope-plan.md §8-24.
 *
 * Returns result if handled, null to continue.
 */
export function handleStopScopeResolution(
  ctx: ClarificationInterceptContext,
  computed: Pick<PreClarificationComputedState, 'isNewQuestionOrCommandDetected'>,
): ClarificationInterceptResult | null {
  const {
    trimmedInput,
    lastClarification,
    clarificationSnapshot,
    addMessage,
    setIsLoading,
    pauseSnapshotWithReason,
    stopSuppressionCount,
    setStopSuppressionCount,
    clearFocusLatch,
    clearWidgetSelectionContext,
    clearScopeCueRecoveryMemory,
    resetSelectionContinuity,
  } = ctx
  const { isNewQuestionOrCommandDetected } = computed

  if (!(!lastClarification && isExitPhrase(trimmedInput))) {
    return null
  }

  // Repeated stop suppression
  if (stopSuppressionCount > 0) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'stop_scope_repeated_suppression',
      metadata: {
        userInput: trimmedInput,
        stopSuppressionCount,
      },
    })
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

  if (clarificationSnapshot) {
    pauseSnapshotWithReason('stop')
  }

  clearFocusLatch()
  clearWidgetSelectionContext()
  clearScopeCueRecoveryMemory()
  resetSelectionContinuity()

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

/**
 * Bare ordinal detection — No context available.
 * Per stop-scope-plan acceptance test 3 (§74-76).
 *
 * Returns result if handled, null to continue.
 */
export function handleBareOrdinalDetection(
  ctx: ClarificationInterceptContext,
  computed: Pick<PreClarificationComputedState, 'isNewQuestionOrCommandDetected'>,
): ClarificationInterceptResult | null {
  const {
    trimmedInput,
    lastClarification,
    clarificationSnapshot,
    widgetSelectionContext,
    focusLatch,
    isLatchEnabled,
    hasVisibleWidgetItems,
    totalListSegmentCount,
    activeSnapshotWidgetId,
    addMessage,
    setIsLoading,
  } = ctx
  const { isNewQuestionOrCommandDetected } = computed

  const bareOrdinalWordCount = trimmedInput.split(/\s+/).length

  const isPreLatchSingleList = isLatchEnabled
    && (!focusLatch || focusLatch.suspended)
    && hasVisibleWidgetItems
    && (!!activeSnapshotWidgetId || totalListSegmentCount === 1)
    && !lastClarification

  const hasActiveLatch = isLatchEnabled && focusLatch && !focusLatch.suspended

  if (!(
    !lastClarification && !clarificationSnapshot && !widgetSelectionContext
    && !hasActiveLatch && !isPreLatchSingleList
    && !isNewQuestionOrCommandDetected && bareOrdinalWordCount <= 4
  )) {
    return null
  }

  const bareOrdinalCheck = isSelectionOnly(trimmedInput, 10, [], 'embedded')
  if (!bareOrdinalCheck.isSelection) {
    return null
  }

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

// =============================================================================
// Orchestrator: handlePreClarificationPhases
// =============================================================================

/**
 * Run all pre-clarification phases in order.
 * Returns result if any phase handled the input, null to continue to main handler.
 *
 * Phase order:
 * 1. Semantic lane escape
 * 2. Stop suppression reset
 * 3. Early repair memory
 * 4. Post-action repair window
 * 5. Return signal (paused list resume)
 * 6. Paused-snapshot repair guard
 * 7. Post-action ordinal window
 * 8. Stop scope resolution
 * 9. Bare ordinal detection
 * 10. Increment snapshot turn
 */
export async function handlePreClarificationPhases(
  ctx: ClarificationInterceptContext,
  computed: PreClarificationComputedState,
): Promise<ClarificationInterceptResult | null> {
  // --- Phase 1: Semantic lane escape ---
  if (ctx.semanticLaneDetected) {
    if (ctx.lastClarification) {
      if (ctx.lastClarification.options && ctx.lastClarification.options.length > 0) {
        ctx.saveClarificationSnapshot(ctx.lastClarification, true)
      }
      ctx.setLastClarification(null)
      ctx.setPendingOptions([])
      ctx.setPendingOptionsMessageId(null)
      ctx.setPendingOptionsGraceCount(0)
    }
    void debugLog({
      component: 'ChatNavigation',
      action: 'semantic_lane_escape_clarification',
      metadata: { userInput: ctx.trimmedInput, hadClarificationContext: !!ctx.lastClarification },
    })
    return { handled: false, clarificationCleared: !!ctx.lastClarification, isNewQuestionOrCommandDetected: computed.isNewQuestionOrCommandDetected }
  }

  // --- Phase 2: Stop suppression reset ---
  if (ctx.stopSuppressionCount > 0 && !isExitPhrase(ctx.trimmedInput)) {
    ctx.setStopSuppressionCount(0)
  }

  // --- Phase 3: Early repair memory ---
  const repairResult = handleEarlyRepairMemory(ctx, computed)
  if (repairResult) return repairResult

  // --- Phase 4: Post-action repair window ---
  const postRepairResult = handlePostActionRepairWindow(ctx, computed)
  if (postRepairResult) return postRepairResult

  // --- Phase 5: Return signal (paused list resume) ---
  const returnResult = await handleReturnSignal(ctx, computed)
  if (returnResult) return returnResult

  // --- Phase 6: Paused-snapshot repair guard ---
  const pausedRepairResult = handlePausedSnapshotRepairGuard(ctx, computed)
  if (pausedRepairResult) return pausedRepairResult

  // --- Phase 7: Post-action ordinal window ---
  const ordinalResult = handlePostActionOrdinalWindow(ctx, computed)
  if (ordinalResult) return ordinalResult

  // --- Phase 8: Stop scope resolution ---
  const stopResult = handleStopScopeResolution(ctx, computed)
  if (stopResult) return stopResult

  // --- Phase 9: Bare ordinal detection ---
  const bareOrdinalResult = handleBareOrdinalDetection(ctx, computed)
  if (bareOrdinalResult) return bareOrdinalResult

  // --- Phase 10: Increment snapshot turn counter ---
  ctx.incrementSnapshotTurn()

  return null
}
