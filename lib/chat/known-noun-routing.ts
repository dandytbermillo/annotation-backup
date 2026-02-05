/**
 * Known-Noun Command Routing — Tier 4
 *
 * Per routing-order-priority-plan.md, Tier 4 handles known-noun commands:
 *   - "links panel", "widget manager" → execute deterministically
 *   - "links panel?" → question signal → skip to Tier 5 (docs)
 *   - "widget managr" → near match → "Did you mean Widget Manager?"
 *   - unknown noun → fall through to Tier 5
 *
 * This module provides the allowlist, matching, and execution logic.
 * The dispatcher calls handleKnownNounRouting() at the Tier 4 position.
 */

import { debugLog } from '@/lib/utils/debug-logger'
import type { ChatMessage, SelectionOption, ViewPanelContent } from '@/lib/chat'
import type { PendingOptionState } from '@/lib/chat/chat-routing'
import type { LastClarificationState } from '@/lib/chat/chat-navigation-context'
import { hasQuestionIntent } from '@/lib/chat/query-patterns'

// =============================================================================
// Known-Noun Allowlist
// =============================================================================

/**
 * Static mapping of known noun phrases to panel IDs and display titles.
 * These are nouns that should execute deterministically (open the panel)
 * rather than routing to docs when typed without a verb.
 *
 * Sources:
 *   - ACTION_NOUNS from query-patterns.ts
 *   - Panel IDs from intent-prompt.ts
 *   - Common panel name patterns from the UI
 */
export interface KnownNounEntry {
  panelId: string
  title: string
}

export const KNOWN_NOUN_MAP: Record<string, KnownNounEntry> = {
  // Recent panel
  'recent': { panelId: 'recent', title: 'Recent' },
  'recents': { panelId: 'recent', title: 'Recent' },
  'recent items': { panelId: 'recent', title: 'Recent' },

  // Quick Links family (default — no specific badge)
  'quick links': { panelId: 'quick-links', title: 'Quick Links' },
  'quicklinks': { panelId: 'quick-links', title: 'Quick Links' },
  'links': { panelId: 'quick-links', title: 'Quick Links' },
  'links panel': { panelId: 'quick-links', title: 'Quick Links' },

  // Quick Links with specific badges
  'quick links a': { panelId: 'quick-links-a', title: 'Quick Links A' },
  'quick links b': { panelId: 'quick-links-b', title: 'Quick Links B' },
  'quick links c': { panelId: 'quick-links-c', title: 'Quick Links C' },
  'quick links d': { panelId: 'quick-links-d', title: 'Quick Links D' },
  'quick links e': { panelId: 'quick-links-e', title: 'Quick Links E' },
  'links panel a': { panelId: 'quick-links-a', title: 'Links Panel A' },
  'links panel b': { panelId: 'quick-links-b', title: 'Links Panel B' },
  'links panel c': { panelId: 'quick-links-c', title: 'Links Panel C' },
  'links panel d': { panelId: 'quick-links-d', title: 'Links Panel D' },
  'links panel e': { panelId: 'quick-links-e', title: 'Links Panel E' },

  // Other known panels
  // NOTE: Structural suffixes ("widget", "panel") and prefix "widget" are
  // stripped automatically by matchKnownNoun() — no need to enumerate
  // variants like "recent widget", "demo panel", "widget demo" here.
  'navigator': { panelId: 'navigator', title: 'Navigator' },
  'demo': { panelId: 'demo', title: 'Demo' },
  'widget manager': { panelId: 'widget-manager', title: 'Widget Manager' },
  'quick capture': { panelId: 'quick-capture', title: 'Quick Capture' },
  'links overview': { panelId: 'links-overview', title: 'Links Overview' },
}

/**
 * All known noun keys as a Set for fast membership checks.
 */
const KNOWN_NOUN_KEYS = new Set(Object.keys(KNOWN_NOUN_MAP))

// =============================================================================
// Matching Functions
// =============================================================================

/**
 * Normalize input for noun matching.
 * Strips action verbs, punctuation, and normalizes whitespace.
 */
function normalizeForNounMatch(input: string): string {
  let normalized = input.toLowerCase().trim()

  // Strip trailing punctuation (?, !, .)
  normalized = normalized.replace(/[?!.]+$/, '')

  // Strip leading action verbs that may have been missed by earlier tiers
  const verbPrefixes = [
    'open ', 'show ', 'view ', 'go to ', 'launch ',
    'can you open ', 'can you show ', 'please open ', 'pls open ',
    'please show ', 'pls show ',
  ]
  for (const prefix of verbPrefixes) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length).trim()
      break
    }
  }

  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim()

  return normalized
}

/**
 * Check if input matches a known noun (exact match after normalization).
 * Tries the full normalized form first, then strips trailing generic
 * suffixes ("widget", "panel") so "recent widget" matches "recent".
 * Returns the matched entry or null.
 */
export function matchKnownNoun(input: string): KnownNounEntry | null {
  const normalized = normalizeForNounMatch(input)

  // Try exact match first (includes explicit "X widget" variants in map)
  if (KNOWN_NOUN_MAP[normalized]) {
    return KNOWN_NOUN_MAP[normalized]
  }

  // Strip trailing generic suffixes and retry
  // "recent widget" → "recent", "demo panel" → "demo", "widget demo" → "demo"
  const withoutSuffix = normalized
    .replace(/\s+(widget|panel)$/i, '')
    .replace(/^widget\s+/i, '')
    .trim()
  if (withoutSuffix && withoutSuffix !== normalized && KNOWN_NOUN_MAP[withoutSuffix]) {
    return KNOWN_NOUN_MAP[withoutSuffix]
  }

  return null
}

/**
 * Find a near-match for a noun input using simple edit distance.
 * Returns the closest known noun entry if within distance threshold.
 */
export function findNounNearMatch(input: string): {
  entry: KnownNounEntry
  matchedKey: string
  distance: number
} | null {
  const normalized = normalizeForNounMatch(input)

  // Skip very short inputs (too ambiguous for fuzzy matching)
  if (normalized.length < 4) return null

  let bestMatch: { entry: KnownNounEntry; matchedKey: string; distance: number } | null = null
  const maxDistance = 2

  for (const key of KNOWN_NOUN_KEYS) {
    // Skip keys that differ too much in length
    if (Math.abs(normalized.length - key.length) > maxDistance) continue

    const distance = levenshteinDistance(normalized, key)
    if (distance > 0 && distance <= maxDistance) {
      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = {
          entry: KNOWN_NOUN_MAP[key],
          matchedKey: key,
          distance,
        }
      }
    }
  }

  return bestMatch
}

/**
 * Simple Levenshtein distance implementation.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1,     // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

// =============================================================================
// Question Signal Detection
// =============================================================================

/**
 * Check if input is a FULL question that should skip Tier 4 entirely
 * and route to Tier 5 (docs).
 *
 * Full questions: "what is links panel?", "how does widget manager work?"
 * These have explicit question framing BEYOND just a trailing "?".
 *
 * NOTE: A known noun with ONLY a trailing "?" (e.g., "links panel?") is
 * NOT a full question — it gets the "Open or Docs?" prompt instead.
 * See isTrailingQuestionOnly() for that case.
 */
function isFullQuestionAboutNoun(input: string): boolean {
  const normalized = input.toLowerCase().trim()

  // Explicit question framing (regardless of trailing ?)
  if (/^(what is|what are|what's|how does|how do|how to|tell me about|explain|describe|define)\b/.test(normalized)) {
    return true
  }

  // Question word + trailing ? (but not just trailing ? alone)
  // e.g., "can you explain links panel?" → full question
  if (normalized.endsWith('?')) {
    const withoutMark = normalized.slice(0, -1).trim()
    if (/^(what|which|where|when|how|why|who|can|could|should|would|is|are|do|does)\b/.test(withoutMark)) {
      return true
    }
  }

  return false
}

/**
 * Check if input is ONLY a trailing "?" on what would otherwise be a noun.
 * e.g., "links panel?" → true
 * e.g., "what is links panel?" → false (that's a full question)
 */
function isTrailingQuestionOnly(input: string): boolean {
  const normalized = input.toLowerCase().trim()
  if (!normalized.endsWith('?')) return false

  // Strip the trailing ? and check if the remainder is noun-like (no question word)
  const withoutMark = normalized.slice(0, -1).trim()
  if (/^(what|which|where|when|how|why|who|can|could|should|would|is|are|do|does)\b/.test(withoutMark)) {
    return false // Has a question word → full question, not trailing-? only
  }

  return true // e.g., "links panel?" → true
}

// =============================================================================
// Handler Context & Result
// =============================================================================

export interface KnownNounRoutingContext {
  trimmedInput: string
  visibleWidgets?: Array<{ id: string; title: string; type: string }>
  addMessage: (message: ChatMessage) => void
  setIsLoading: (loading: boolean) => void
  openPanelDrawer: (panelId: string, panelTitle?: string) => void
  setPendingOptions: (options: PendingOptionState[]) => void
  setPendingOptionsMessageId: (messageId: string | null) => void
  setLastClarification: (state: LastClarificationState | null) => void
  handleSelectOption: (option: SelectionOption) => void
  /** When true, an active option set is displayed — skip fuzzy/unknown-noun fallbacks (Steps 4–5) */
  hasActiveOptionSet?: boolean
  /**
   * When true, a soft-active list exists and the input is selection-like.
   * In this case, unknown-noun fallback should decline to let Tier 4.5 resolve.
   */
  hasSoftActiveSelectionLike?: boolean
  /**
   * When true, at least one widget list is visible.
   * In this case, unknown-noun fallback should decline to let Tier 4.5 try matching.
   */
  hasVisibleWidgetList?: boolean
  /** Save last options shown for soft-active window */
  saveLastOptionsShown?: (options: import('@/lib/chat/chat-navigation-context').ClarificationOption[], messageId: string) => void
  /** Per universal-selection-resolver-plan.md: clear widget context when registering chat context */
  clearWidgetSelectionContext?: () => void
}

export interface KnownNounRoutingResult {
  handled: boolean
}

// =============================================================================
// Visible Widget Lookup
// =============================================================================

/**
 * Resolve a known noun entry to an actual visible panel by matching title.
 * Returns the real panel (with database ID) or null if not found.
 *
 * This is critical because KNOWN_NOUN_MAP stores logical slugs (e.g., "recent"),
 * but DashboardView's open-panel-drawer listener matches by panel.id (database UUID).
 * We must look up the real panel ID from visibleWidgets to open the drawer correctly.
 */
function resolveToVisiblePanel(
  nounEntry: KnownNounEntry,
  visibleWidgets?: Array<{ id: string; title: string; type: string }>
): { id: string; title: string; type: string } | null {
  if (!visibleWidgets || visibleWidgets.length === 0) return null

  const nounTitle = nounEntry.title.toLowerCase().trim()

  // Try exact title match first
  const exactMatch = visibleWidgets.find(
    w => w.title.toLowerCase().trim() === nounTitle
  )
  if (exactMatch) return exactMatch

  // Try matching by panel type (e.g., panelId "recent" matches type "recent")
  // KNOWN_NOUN_MAP uses hyphenated slugs, PanelTypeId uses underscores
  const panelTypeSlug = nounEntry.panelId.replace(/-/g, '_')
  const typeMatch = visibleWidgets.find(
    w => w.type === panelTypeSlug
  )
  if (typeMatch) return typeMatch

  return null
}

// =============================================================================
// Main Handler
// =============================================================================

/**
 * Handle known-noun command routing (Tier 4).
 *
 * Priority order within Tier 4 (per routing-order-priority-plan.md):
 *   1. Known noun + trailing "?" only → "Open X, or read docs?" prompt
 *   2. Full question signal → skip (let Tier 5 docs handle)
 *   3. Exact known-noun match → execute (open panel)
 *   4. Near match (fuzzy) → "Did you mean ___?"
 *   5. Unknown noun → "Open or Docs?" fallback prompt
 *
 * Rule: If a known-noun command executes while a paused snapshot exists,
 * the snapshot remains paused (no implicit resume). This is enforced by
 * the dispatcher — we simply execute and return.
 */
export function handleKnownNounRouting(
  ctx: KnownNounRoutingContext
): KnownNounRoutingResult {
  // Step 1: Known noun + trailing "?" → ask "Open X, or read docs?"
  // e.g., "links panel?" → not a full question, but ambiguous intent
  if (isTrailingQuestionOnly(ctx.trimmedInput)) {
    // Strip the "?" and check if it matches a known noun
    const strippedInput = ctx.trimmedInput.replace(/[?]+$/, '').trim()
    const match = matchKnownNoun(strippedInput)
    if (match) {
      // Resolve to actual visible panel (need real DB ID for option data)
      const realPanel = resolveToVisiblePanel(match, ctx.visibleWidgets)
      const effectivePanelId = realPanel?.id ?? match.panelId
      const effectiveTitle = realPanel?.title ?? match.title

      void debugLog({
        component: 'ChatNavigation',
        action: 'known_noun_command_docs_guard',
        metadata: {
          input: ctx.trimmedInput,
          reason: 'trailing_question_on_known_noun',
          panelId: effectivePanelId,
          nounPanelId: match.panelId,
          tier: 4,
        },
      })

      // Show "Open or Docs?" disambiguation
      const messageId = `assistant-${Date.now()}`
      const options: SelectionOption[] = [
        {
          type: 'panel_drawer',
          id: `open-${effectivePanelId}`,
          label: `Open ${effectiveTitle}`,
          sublabel: `Open the ${effectiveTitle} panel`,
          data: { panelId: effectivePanelId, panelTitle: effectiveTitle, panelType: 'known_noun' },
        },
        {
          type: 'doc',
          id: `docs-${match.panelId}`,
          label: `Read docs about ${effectiveTitle}`,
          sublabel: `Learn what ${effectiveTitle} does`,
          data: { docSlug: strippedInput, originalQuery: strippedInput },
        },
      ]

      const assistantMessage: ChatMessage = {
        id: messageId,
        role: 'assistant',
        content: `Open ${effectiveTitle}, or read docs about it?`,
        timestamp: new Date(),
        isError: false,
        options,
      }
      ctx.addMessage(assistantMessage)

      // Per universal-selection-resolver-plan.md: clear widget context when registering chat context
      ctx.clearWidgetSelectionContext?.()

      ctx.setPendingOptions(options.map((opt, idx) => ({
        index: idx + 1,
        label: opt.label,
        sublabel: opt.sublabel,
        type: opt.type,
        id: opt.id,
        data: opt.data,
      })))
      ctx.setPendingOptionsMessageId(messageId)
      ctx.saveLastOptionsShown?.(options.map(opt => ({ id: opt.id, label: opt.label, sublabel: opt.sublabel, type: opt.type })), messageId)

      ctx.setLastClarification({
        type: 'option_selection',
        originalIntent: 'known_noun_open_or_docs',
        messageId,
        timestamp: Date.now(),
        clarificationQuestion: `Open ${effectiveTitle}, or read docs about it?`,
        options: options.map(opt => ({
          id: opt.id,
          label: opt.label,
          sublabel: opt.sublabel,
          type: opt.type,
        })),
        metaCount: 0,
      })

      ctx.setIsLoading(false)
      return { handled: true }
    }
    // Not a known noun with trailing ? → continue to step 2
  }

  // Step 2: Full question signal → skip to Tier 5 (docs)
  // e.g., "what is links panel?", "how does widget manager work?"
  if (isFullQuestionAboutNoun(ctx.trimmedInput)) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'known_noun_command_docs_guard',
      metadata: { input: ctx.trimmedInput, reason: 'full_question_signal', tier: 4 },
    })
    return { handled: false }
  }

  // Step 3: Exact known-noun match → execute (open panel)
  const match = matchKnownNoun(ctx.trimmedInput)
  if (match) {
    // Resolve to actual visible panel (need real DB ID for DashboardView)
    const realPanel = resolveToVisiblePanel(match, ctx.visibleWidgets)
    if (!realPanel) {
      // Panel exists in allowlist but not on the current dashboard — can't open
      void debugLog({
        component: 'ChatNavigation',
        action: 'known_noun_panel_not_visible',
        metadata: {
          input: ctx.trimmedInput,
          panelId: match.panelId,
          title: match.title,
          tier: 4,
        },
      })

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: `The ${match.title} panel isn't available on the current dashboard.`,
        timestamp: new Date(),
        isError: false,
      }
      ctx.addMessage(assistantMessage)
      ctx.setIsLoading(false)
      return { handled: true }
    }

    void debugLog({
      component: 'ChatNavigation',
      action: 'known_noun_command_execute',
      metadata: {
        input: ctx.trimmedInput,
        panelId: realPanel.id,
        nounPanelId: match.panelId,
        title: realPanel.title,
        tier: 4,
      },
    })

    // Execute: open the panel drawer using the real panel ID
    ctx.openPanelDrawer(realPanel.id, realPanel.title ?? match.title)

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: `Opening ${realPanel.title ?? match.title}.`,
      timestamp: new Date(),
      isError: false,
    }
    ctx.addMessage(assistantMessage)
    ctx.setIsLoading(false)
    return { handled: true }
  }

  // Step 4: Near match (fuzzy) → ask "Did you mean ___?"
  // Skip when active option set exists — fuzzy matching could mis-bind user's
  // intended list selection (e.g., "panel layoout" → incorrectly matches "panel layout")
  if (ctx.hasActiveOptionSet) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'skip_noun_fuzzy_active_options',
      metadata: { input: ctx.trimmedInput, reason: 'active_option_set', tier: 4 },
    })
    // Fall through to Tier 5 (LLM can handle contextually with the active list)
    return { handled: false }
  }

  const nearMatch = findNounNearMatch(ctx.trimmedInput)
  if (nearMatch) {
    // Resolve to actual visible panel (need real DB ID for option data)
    const nearRealPanel = resolveToVisiblePanel(nearMatch.entry, ctx.visibleWidgets)
    const nearEffectiveId = nearRealPanel?.id ?? nearMatch.entry.panelId
    const nearEffectiveTitle = nearRealPanel?.title ?? nearMatch.entry.title

    void debugLog({
      component: 'ChatNavigation',
      action: 'known_noun_near_match_prompt',
      metadata: {
        input: ctx.trimmedInput,
        matchedKey: nearMatch.matchedKey,
        distance: nearMatch.distance,
        panelId: nearEffectiveId,
        nounPanelId: nearMatch.entry.panelId,
        tier: 4,
      },
    })

    // Show disambiguation with the near-match as a suggested option
    const messageId = `assistant-${Date.now()}`
    const options: SelectionOption[] = [
      {
        type: 'panel_drawer',
        id: nearEffectiveId,
        label: nearEffectiveTitle,
        sublabel: `Open ${nearEffectiveTitle}`,
        data: { panelId: nearEffectiveId, panelTitle: nearEffectiveTitle, panelType: 'known_noun' } as SelectionOption['data'],
      },
    ]

    const assistantMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: `Did you mean "${nearEffectiveTitle}"?`,
      timestamp: new Date(),
      isError: false,
      options,
    }
    ctx.addMessage(assistantMessage)

    // Per universal-selection-resolver-plan.md: clear widget context when registering chat context
    ctx.clearWidgetSelectionContext?.()

    // Set pending options for selection handling
    ctx.setPendingOptions(options.map((opt, idx) => ({
      index: idx + 1,
      label: opt.label,
      sublabel: opt.sublabel,
      type: opt.type,
      id: opt.id,
      data: opt.data,
    })))
    ctx.setPendingOptionsMessageId(messageId)
    ctx.saveLastOptionsShown?.(options.map(opt => ({ id: opt.id, label: opt.label, sublabel: opt.sublabel, type: opt.type })), messageId)

    // Sync lastClarification
    ctx.setLastClarification({
      type: 'option_selection',
      originalIntent: 'known_noun_near_match',
      messageId,
      timestamp: Date.now(),
      clarificationQuestion: `Did you mean "${nearEffectiveTitle}"?`,
      options: options.map(opt => ({
        id: opt.id,
        label: opt.label,
        sublabel: opt.sublabel,
        type: opt.type,
      })),
      metaCount: 0,
    })

    ctx.setIsLoading(false)
    return { handled: true }
  }

  // Step 5: Unknown noun fallback → "Open or Docs?" prompt
  // Per routing-order-priority-plan.md item 10: don't silently route to docs.
  // Only trigger for short, noun-like inputs (1-4 words, no question framing).
  const normalized = normalizeForNounMatch(ctx.trimmedInput)
  const wordCount = normalized.split(/\s+/).length
  const isShortNounLike = wordCount >= 1 && wordCount <= 4
    && !hasQuestionIntent(ctx.trimmedInput)
    && !/^(yes|no|ok|cancel|stop|help|thanks|thank you|hi|hello|hey)\b/i.test(normalized)

  if (isShortNounLike) {
    // Soft-active window exists with selection-like input — let Tier 4.5 handle it.
    if (ctx.hasSoftActiveSelectionLike) {
      return { handled: false }
    }

    // Visible widget list exists — let Tier 4.5 try to match against it.
    // Example: "open summary144" should match against Links Panel D's list.
    if (ctx.hasVisibleWidgetList) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'unknown_noun_bypass_for_widget_list',
        metadata: { input: ctx.trimmedInput, normalized, wordCount, tier: 4 },
      })
      return { handled: false }
    }

    void debugLog({
      component: 'ChatNavigation',
      action: 'unknown_noun_fallback_shown',
      metadata: { input: ctx.trimmedInput, normalized, wordCount, tier: 4 },
    })

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: `I'm not sure what "${normalized}" refers to. Could you try again or ask a question about it?`,
      timestamp: new Date(),
      isError: false,
    }
    ctx.addMessage(assistantMessage)
    ctx.setIsLoading(false)
    return { handled: true }
  }

  // Not noun-like → fall through to Tier 5 / LLM
  return { handled: false }
}
