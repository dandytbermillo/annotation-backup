/**
 * Chat Routing — Panel Disambiguation Handler
 *
 * Handles panel disambiguation BEFORE LLM. When user types a partial panel
 * name matching multiple panels, shows disambiguation directly.
 * Extracted from chat-routing.ts for modularity.
 *
 * @internal — Do not import directly outside lib/chat/.
 * Use the barrel at @/lib/chat/chat-routing instead.
 */

import { debugLog } from '@/lib/utils/debug-logger'
import { matchVisiblePanelCommand } from '@/lib/chat/panel-command-matcher'
import { isStrictExactMatch, classifyExecutionMeta } from '@/lib/chat/input-classifiers'
import type { ChatMessage, SelectionOption } from '@/lib/chat'
import type { PanelDisambiguationHandlerContext, PanelDisambiguationHandlerResult, PendingOptionState } from './chat-routing-types'

// =============================================================================
// Panel Disambiguation Handler (Pre-LLM)
// =============================================================================

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
    saveLastOptionsShown,
    clearWidgetSelectionContext,
    clearFocusLatch,
    openPanelDrawer,
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
      // Removed widget.type sublabel - not helpful for users (shows internal type like "links_note_tiptap")
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

    // Per universal-selection-resolver-plan.md: clear widget context when registering chat context
    // This prevents leftover widget context from causing bypass guard to skip clarification handling
    clearWidgetSelectionContext?.()

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

    // Populate soft-active window so shorthand works after selection clears activeOptionSetId
    saveLastOptionsShown?.(
      pendingOptions.map(opt => ({ id: opt.id, label: opt.label, sublabel: opt.sublabel, type: opt.type })),
      messageId,
    )

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

  // Single high-confidence panel match → open directly (deterministic, Rule 1)
  // Handles both partial ("open links panel" → 1 Links Panel D) and
  // exact ("open links panels" → 1 "Links Panels") single-match cases.
  // With token canonicalization (panels→panel), some single-panel cases produce exact, not partial.
  const isSingleMatch =
    matchResult.matches.length === 1 &&
    (matchResult.type === 'partial' || matchResult.type === 'exact')

  if (isSingleMatch && openPanelDrawer) {
    const singleMatch = matchResult.matches[0]

    // Addendum Rule B: strict ^...$ match determines matchKind for classifier.
    // Token-containment 'exact' from matchVisiblePanelCommand is NOT strict exact.
    // Only raw input === panel title qualifies as deterministic 'exact'.
    const strictExact = isStrictExactMatch(trimmedInput, singleMatch.title)
    const effectiveMatchKind: 'exact' | 'partial' = strictExact ? 'exact' : 'partial'

    const meta = classifyExecutionMeta({
      matchKind: effectiveMatchKind,
      candidateCount: 1,
      resolverPath: 'panelDisambiguation',
    })

    // Unresolved gate: non-strict-exact → fall through to LLM tier (Rule B, Rule C)
    // NO state cleared before this return — context preserved for LLM
    if (meta.reasonCode === 'unknown') {
      return { handled: false, matchType: matchResult.type, matchCount: 1 }
    }

    void debugLog({
      component: 'ChatNavigation',
      action: 'panel_disambiguation_single_match_open',
      metadata: {
        input: trimmedInput,
        matchType: matchResult.type,
        matchedTitle: singleMatch.title,
      },
    })

    // Clear stale selection state
    setPendingOptions([])
    setPendingOptionsMessageId(null)
    setLastClarification(null)
    clearWidgetSelectionContext?.()
    // Clear stale focus latch — panel switch starts fresh scope
    // (prevents grounding tier from scoping to wrong widget's candidates)
    clearFocusLatch?.()

    // Direct open with executionMeta
    openPanelDrawer(singleMatch.id, singleMatch.title, meta)

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: `Opening ${singleMatch.title}.`,
      timestamp: new Date(),
      isError: false,
    }
    addMessage(assistantMessage)
    setIsLoading(false)
    return { handled: true, matchType: matchResult.type, matchCount: 1 }
  }

  // Let LLM handle other cases (no match, or openPanelDrawer unavailable)
  return { handled: false, matchType: matchResult.type, matchCount: matchResult.matches.length }
}
