/**
 * Chat Routing — Scope-Cue Handler
 *
 * Extracted from chat-routing-clarification-intercept.ts (PR3b).
 * Handles scope-cue normalization for chat/dashboard/workspace.
 *
 * @internal — Do not import directly outside lib/chat/.
 * Use the barrel at @/lib/chat/chat-routing instead.
 */

import { debugLog } from '@/lib/utils/debug-logger'
import { hasQuestionIntent, isPoliteImperativeRequest } from '@/lib/chat/query-patterns'
import type { ChatMessage, SelectionOption } from '@/lib/chat'
import type { ClarificationOption } from '@/lib/chat/chat-navigation-context'
import { getLatchId } from '@/lib/chat/chat-navigation-context'
import { getBasePrompt } from '@/lib/chat/clarification-offmenu'
import {
  isSelectionOnly,
  canonicalizeCommandInput,
  evaluateDeterministicDecision,
  isExplicitCommand,
  isStrictExactMode,
  type ScopeCueResult,
} from '@/lib/chat/input-classifiers'
import type {
  ClarificationInterceptContext,
  ClarificationInterceptResult,
  PendingOptionState,
  PreferredCandidateHint,
} from './chat-routing-types'
import {
  runBoundedArbitrationLoop,
  createEnrichmentCallback,
  tryContinuityDeterministicResolve,
} from './chat-routing-arbitration'
import {
  reconstructSnapshotData,
  findMatchingOptions,
  findExactNormalizedMatches,
} from './chat-routing-clarification-utils'

interface ScopeCuePhaseParams {
  scopeCue: ScopeCueResult
  isLatchActive: boolean
  isNewQuestionOrCommandDetected: boolean
}

export async function handleScopeCuePhase(
  ctx: ClarificationInterceptContext,
  params: ScopeCuePhaseParams,
): Promise<ClarificationInterceptResult | null> {
  const {
    trimmedInput,
    lastClarification,
    addMessage,
    setLastClarification,
    setIsLoading,
    setPendingOptions,
    setPendingOptionsMessageId,
    setPendingOptionsGraceCount,
    handleSelectOption,
    repairMemory,
    setRepairMemory,
    clarificationSnapshot,
    saveClarificationSnapshot,
    widgetSelectionContext,
    clearWidgetSelectionContext,
    setActiveOptionSetId,
    focusLatch,
    suspendFocusLatch,
    lastOptionsShown,
    scopeCueRecoveryMemory,
    updateSelectionContinuity,
  } = ctx

  const { scopeCue, isLatchActive, isNewQuestionOrCommandDetected } = params

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
      void debugLog({ component: 'ChatNavigation', action: 'scope_cue_applied_chat', metadata: { cueText: scopeCue.cueText, latchId: focusLatch ? getLatchId(focusLatch) : null, optionCount: recoverable?.options.length ?? 0, source: recoverable?.source } })
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


  // scopeCue.scope === 'widget' or 'none' → continue in intercept.
  return null
}
