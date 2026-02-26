/**
 * Grounding-Set Fallback Module
 *
 * Per grounding-set-fallback-plan.md: Provides a general fallback that uses a small,
 * explicit "grounding set" when deterministic routing fails. This prevents dead-end
 * replies and avoids hallucinations by constraining the LLM to known candidates.
 *
 * Lists are just one kind of grounding set; this module works whether or not a list
 * is present.
 *
 * Integration point: after Tier 4 (known-noun) and before Tier 5 (doc retrieval)
 * in routing-dispatcher.ts.
 */

import { debugLog } from '@/lib/utils/debug-logger'
import { levenshteinDistance } from '@/lib/chat/typo-suggestions'
import { matchVisiblePanelCommand, STOPWORDS, type PanelMatchResult } from '@/lib/chat/panel-command-matcher'
import { isExplicitCommand, canonicalizeCommandInput } from '@/lib/chat/input-classifiers'
import type { ClarificationOption, ClarificationSnapshot, LastClarificationState, RepairMemoryState, SessionState } from '@/lib/chat/chat-navigation-context'

// =============================================================================
// Types
// =============================================================================

/** A single candidate in a grounding set */
export interface GroundingCandidate {
  id: string
  label: string
  type: 'option' | 'widget_option' | 'referent' | 'capability'
  /** Optional hint about what action this candidate performs */
  actionHint?: string
  /** Source grounding set this candidate came from */
  source: GroundingSetType
}

/** Types of grounding sets, in priority order per plan §Decision Flow Step 1 */
export type GroundingSetType =
  | 'active_options'
  | 'visible_panels'
  | 'paused_snapshot'
  | 'widget_list'
  | 'recent_referent'
  | 'capability'

/** A grounding set with its type and candidates */
export interface GroundingSet {
  type: GroundingSetType
  candidates: GroundingCandidate[]
  /** Whether this is a list-type set (allows larger candidate counts) */
  isList: boolean
  /** Source widget ID if this is a widget list */
  widgetId?: string
  /** Source widget label if this is a widget list */
  widgetLabel?: string
}

/** State needed for building grounding sets */
export interface GroundingSetBuildContext {
  /** Active option set ID — non-null when a list is currently active */
  activeOptionSetId: string | null
  /** Current active options (from lastClarification or pendingOptions) */
  activeOptions: ClarificationOption[]
  /** Paused clarification snapshot (if any) */
  pausedSnapshot: ClarificationSnapshot | null
  /** Open widget lists (if multiple widgets expose options) */
  openWidgets: OpenWidgetState[]
  /** Recent referents from session state */
  recentReferents: RecentReferent[]
  /**
   * Visible panels from the dashboard (per raw-strict-exact plan Phase 3).
   * Used as LLM-only candidates — NOT eligible for resolveUniqueDeterministic.
   * When a non-exact panel command falls to grounding, these candidates let
   * the bounded LLM resolve "open the links panel plsss" to the correct panel.
   */
  visiblePanels?: Array<{ id: string; title: string; type: string }>
}

/** Open widget state for multi-list grounding */
export interface OpenWidgetState {
  id: string
  label: string
  options: ClarificationOption[]
  /** Number of list segments in this widget (for Rule 12 segment-level counting) */
  listSegmentCount: number
  /** Panel UUID for mapping activeWidgetId (UUID) → widget slug */
  panelId?: string
}

/** Recent referent for non-list grounding */
export interface RecentReferent {
  id: string
  label: string
  type: 'last_action' | 'last_target' | 'recent_entity'
  actionHint?: string
}

/** Result of deterministic unique match */
export interface DeterministicMatchResult {
  matched: boolean
  candidate?: GroundingCandidate
  /** Index in the grounding set (for ordinal matches) */
  index?: number
  /** How the match was made */
  matchMethod?: 'ordinal' | 'shorthand_keyword' | 'badge_token' | 'unique_token_subset'
}

/** Result of the grounding-set fallback handler */
export interface GroundingSetResult {
  handled: boolean
  /** Which grounding set type resolved the input */
  resolvedBy?: GroundingSetType
  /** The selected candidate (if deterministic match succeeded) */
  selectedCandidate?: GroundingCandidate
  /** Whether LLM fallback is needed */
  needsLLM?: boolean
  /** Candidates to pass to constrained LLM */
  llmCandidates?: GroundingCandidate[]
  /** Whether multi-list ambiguity was detected */
  multiListAmbiguity?: boolean
  /** Whether a clarifier question should be asked */
  askClarifier?: boolean
  /** Clarifier message to show */
  clarifierMessage?: string
  /** Widget options for multi-list disambiguation */
  widgetOptions?: { id: string; label: string }[]
}

// =============================================================================
// Constants
// =============================================================================

/** Max candidates for non-list grounding sets (plan §Candidate Size Rule) */
const NON_LIST_CANDIDATE_CAP = 5

/** Max candidates for list-type grounding sets (plan §Candidate Size Rule) */
const LIST_CANDIDATE_CAP = 12

/** Known system capabilities for capability grounding set */
const CAPABILITY_SET: GroundingCandidate[] = [
  { id: 'cap_open', label: 'Open', type: 'capability', actionHint: 'open a panel or resource', source: 'capability' },
  { id: 'cap_search', label: 'Search', type: 'capability', actionHint: 'search for content', source: 'capability' },
  { id: 'cap_create', label: 'Create', type: 'capability', actionHint: 'create a new item', source: 'capability' },
  { id: 'cap_explain', label: 'Explain', type: 'capability', actionHint: 'explain a concept or feature', source: 'capability' },
]

// =============================================================================
// A2) Grounding Set Build Order (Decision Flow Step 1)
// =============================================================================

/**
 * Build grounding sets in priority order per plan §Decision Flow Step 1:
 *   1) Active options
 *   2) Paused snapshot options
 *   3) Active widget lists
 *   4) Recent referents
 *   5) Capability set
 *
 * Returns all non-empty grounding sets. The caller uses the first one for
 * deterministic matching and falls back to LLM with the full list.
 */
export function buildGroundingSets(ctx: GroundingSetBuildContext): GroundingSet[] {
  const sets: GroundingSet[] = []

  // 1) Active options (if activeOptionSetId != null and options exist)
  if (ctx.activeOptionSetId !== null && ctx.activeOptions.length > 0) {
    const candidates = ctx.activeOptions.slice(0, LIST_CANDIDATE_CAP).map(opt => ({
      id: opt.id,
      label: opt.label,
      type: 'option' as const,
      source: 'active_options' as const,
    }))
    sets.push({ type: 'active_options', candidates, isList: true })
  }

  // 1.5) Visible panels (per raw-strict-exact plan Phase 3):
  // Injected as LLM-only candidates when visible panels exist.
  // Priority: after active_options, before widget_list.
  // CRITICAL: These are NOT eligible for resolveUniqueDeterministic — they are
  // LLM-only candidates to prevent non-exact panel text from being deterministic-executed.
  // NOTE: No NON_LIST_CANDIDATE_CAP here — DashboardView.tsx already caps at 10 panels,
  // and Step 2.6 evidence matching needs ALL visible panels to avoid scope misses.
  if (ctx.visiblePanels && ctx.visiblePanels.length > 0) {
    const panelCandidates = ctx.visiblePanels.map(panel => ({
      id: panel.id,
      label: panel.title,
      type: 'option' as const,
      actionHint: 'open panel',
      source: 'visible_panels' as const,
    }))
    sets.push({ type: 'visible_panels', candidates: panelCandidates, isList: false })
  }

  // 2) Active widget lists (from openWidgets[])
  // Per plan §I: visible widget lists win over paused snapshots unless
  // user explicitly returns to the paused list.
  for (const widget of ctx.openWidgets) {
    if (widget.options.length > 0) {
      const candidates = widget.options.slice(0, LIST_CANDIDATE_CAP).map(opt => ({
        id: opt.id,
        label: opt.label,
        type: 'widget_option' as const,
        source: 'widget_list' as const,
      }))
      sets.push({
        type: 'widget_list',
        candidates,
        isList: true,
        widgetId: widget.id,
        widgetLabel: widget.label,
      })
    }
  }

  // 3) Paused snapshot options (if any, and not expired)
  // Ranked after widget lists per plan §I precedence rule.
  if (ctx.pausedSnapshot && ctx.pausedSnapshot.options.length > 0) {
    const candidates = ctx.pausedSnapshot.options.slice(0, LIST_CANDIDATE_CAP).map(opt => ({
      id: opt.id,
      label: opt.label,
      type: 'option' as const,
      source: 'paused_snapshot' as const,
    }))
    sets.push({ type: 'paused_snapshot', candidates, isList: true })
  }

  // 4) Recent referents (last_action, last_target, recent_entities)
  if (ctx.recentReferents.length > 0) {
    const candidates = ctx.recentReferents.slice(0, NON_LIST_CANDIDATE_CAP).map(ref => ({
      id: ref.id,
      label: ref.label,
      type: 'referent' as const,
      actionHint: ref.actionHint,
      source: 'recent_referent' as const,
    }))
    sets.push({ type: 'recent_referent', candidates, isList: false })
  }

  // 5) Capability set (always available as last resort)
  sets.push({ type: 'capability', candidates: CAPABILITY_SET, isList: false })

  return sets
}

// =============================================================================
// B) Selection-Like Detector (single source of truth)
// =============================================================================

/** Ordinal patterns per plan §Selection-like definition */
const ORDINAL_WORDS = /\b(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\b/i
const NUMERIC_SINGLE = /^[1-9]$/
// "one" is only selection-like in short inputs (≤3 words) to avoid false positives
// on phrases like "one moment" or "which one do you think".
// "panel" only matches when followed by a letter/number (e.g., "panel d", "panel 3").
const SHORTHAND_KEYWORDS = /\b(option|item|choice)\b/i
const PANEL_SELECTION = /\bpanel\s+[a-e1-9]\b/i
const ONE_SHORT_INPUT = /^(the\s+)?(one|this one|that one|the other one)$/i
const SEQUENTIAL_ONE = /^(next|previous|the next|the previous)(\s+one)?$/i
const BADGE_SINGLE_LETTER = /^[a-e]$/i
// Action verb + pronoun referent per plan acceptance tests §1-3:
//   "open it", "fix it", "do that again", "run this", "delete them"
// Only action verbs — NOT informational verbs ("what is it", "explain it" → Tier 5).
// Kept short (≤5 words) to avoid matching conversational sentences.
const ACTION_PRONOUN_REF = /^(open|fix|run|show|delete|remove|close|do|undo|redo|rename|move|copy|create)\s+(it|that|this|them)(\s+again)?$/i

/**
 * Selection-Like Detector — single source of truth per plan §Selection-Like Detector.
 *
 * Returns true if the input looks like a selection attempt:
 *   - Ordinals: first/second/third/1/2/3/last
 *   - Shorthand keywords: option/panel/item/choice/one
 *   - Badge token: only when UI displays badge letters (caller must confirm)
 *   - Action + pronoun referent: "open it", "fix it", "do that again"
 *   - Unique token-subset match (checked separately by resolveUniqueDeterministic)
 *
 * This function checks the first four categories. Token-subset matching is
 * deferred to resolveUniqueDeterministic() since it needs the candidate list.
 */
export function isSelectionLike(
  input: string,
  options?: { hasBadgeLetters?: boolean }
): boolean {
  const normalized = input.trim().toLowerCase()

  // Ordinals
  if (ORDINAL_WORDS.test(normalized)) return true
  if (NUMERIC_SINGLE.test(normalized)) return true

  // Shorthand keywords
  if (SHORTHAND_KEYWORDS.test(normalized)) return true
  if (PANEL_SELECTION.test(normalized)) return true
  if (ONE_SHORT_INPUT.test(normalized)) return true
  if (SEQUENTIAL_ONE.test(normalized)) return true

  // Badge tokens (only if UI displays badge letters)
  if (options?.hasBadgeLetters && BADGE_SINGLE_LETTER.test(normalized)) return true

  // Action verb + pronoun referent (per plan acceptance tests §1-3)
  if (ACTION_PRONOUN_REF.test(normalized)) return true

  return false
}

// =============================================================================
// C) Candidate Size Rule (enforced in buildGroundingSets via caps)
// =============================================================================

/**
 * Validate candidate count against plan rules.
 * Non-list: 1-5, List-type: up to 12 (or full UI-bounded list).
 */
export function isValidCandidateCount(set: GroundingSet): boolean {
  if (set.isList) {
    return set.candidates.length >= 1 && set.candidates.length <= LIST_CANDIDATE_CAP
  }
  return set.candidates.length >= 1 && set.candidates.length <= NON_LIST_CANDIDATE_CAP
}

// =============================================================================
// E) Deterministic Unique Match Before LLM
// =============================================================================

/**
 * Attempt a deterministic unique match of user input against a grounding set.
 * Per plan §E: "If list-type grounding set exists and selection-like resolves
 * uniquely: Execute directly. Do not call LLM until deterministic unique match fails."
 *
 * Match methods (in order):
 *   1. Ordinal index (first/second/1/2/last)
 *   2. Exact label match
 *   3. Unique token-subset match (unique-only)
 */
export function resolveUniqueDeterministic(
  input: string,
  candidates: GroundingCandidate[]
): DeterministicMatchResult {
  const normalized = input.trim().toLowerCase()

  if (candidates.length === 0) {
    return { matched: false }
  }

  // 1. Ordinal index resolution
  const ordinalIndex = resolveOrdinalIndex(normalized, candidates.length)
  if (ordinalIndex !== undefined && ordinalIndex >= 0 && ordinalIndex < candidates.length) {
    return {
      matched: true,
      candidate: candidates[ordinalIndex],
      index: ordinalIndex,
      matchMethod: 'ordinal',
    }
  }

  // 2. Exact label match (case-insensitive)
  const exactMatch = candidates.find(c => c.label.toLowerCase() === normalized)
  if (exactMatch) {
    return {
      matched: true,
      candidate: exactMatch,
      index: candidates.indexOf(exactMatch),
      matchMethod: 'shorthand_keyword',
    }
  }

  // 3. Unique token-subset match
  // Input tokens must be a subset of exactly one candidate's label tokens.
  // Per plan: "unique-only" — must resolve to exactly one option.
  // Strip leading verb prefixes so "open panel e" → "panel e" matches "Links Panel E"
  const verbStripped = normalized
    .replace(/^(pls\s+|please\s+)?(open|show|view|go\s+to|launch|list|find)\s+/i, '')
    .trim()
  const inputTokens = tokenize(verbStripped || normalized)
  if (inputTokens.length > 0) {
    const subsetMatches: { candidate: GroundingCandidate; index: number }[] = []

    for (let i = 0; i < candidates.length; i++) {
      const candidateTokens = new Set(tokenize(candidates[i].label.toLowerCase()))
      const allMatch = inputTokens.every(t => candidateTokens.has(t))
      if (allMatch) {
        subsetMatches.push({ candidate: candidates[i], index: i })
      }
    }

    // Also try fuzzy token matching (Levenshtein ≤ 2 per token, min length 4)
    if (subsetMatches.length === 0) {
      for (let i = 0; i < candidates.length; i++) {
        const candidateTokens = tokenize(candidates[i].label.toLowerCase())
        const allFuzzyMatch = inputTokens.every(inputToken => {
          if (inputToken.length < 4) {
            return candidateTokens.includes(inputToken)
          }
          return candidateTokens.some(ct =>
            ct === inputToken || (ct.length >= 4 && levenshteinDistance(inputToken, ct) <= 2)
          )
        })
        if (allFuzzyMatch) {
          subsetMatches.push({ candidate: candidates[i], index: i })
        }
      }
    }

    // Uniqueness invariant: must resolve to exactly one
    if (subsetMatches.length === 1) {
      return {
        matched: true,
        candidate: subsetMatches[0].candidate,
        index: subsetMatches[0].index,
        matchMethod: 'unique_token_subset',
      }
    }
  }

  return { matched: false }
}

// =============================================================================
// E2) Strict Raw Deterministic Match (no verb stripping, no fuzzy)
// =============================================================================

/**
 * Strict whole-string ordinal parser.
 * Only matches when ENTIRE input is an ordinal — no embedded extraction.
 * "first" → 0 ✓, "the first one" → 0 ✓, "open the first one" → undefined ✓ (rejected)
 */
function resolveStrictOrdinalIndex(normalized: string, optionCount: number): number | undefined {
  const ordinalMap: Record<string, number> = {
    'first': 0, '1st': 0, '1': 0,
    'second': 1, '2nd': 1, '2': 1,
    'third': 2, '3rd': 2, '3': 2,
    'fourth': 3, '4th': 3, '4': 3,
    'fifth': 4, '5th': 4, '5': 4,
    'sixth': 5, '6': 5,
    'seventh': 6, '7': 6,
    'eighth': 7, '8': 7,
    'ninth': 8, '9': 8,
    'last': optionCount - 1,
    'the first': 0, 'the second': 1, 'the third': 2,
    'the fourth': 3, 'the fifth': 4, 'the last': optionCount - 1,
    'the first one': 0, 'the second one': 1, 'the third one': 2,
    'the fourth one': 3, 'the fifth one': 4, 'the last one': optionCount - 1,
    'option 1': 0, 'option 2': 1, 'option 3': 2,
    'option 4': 3, 'option 5': 4,
  }
  // Whole-string only — NO embedded ordinal extraction
  if (ordinalMap[normalized] !== undefined) return ordinalMap[normalized]
  // Strip "panel X" / "item X" shorthand prefix, then re-check
  const stripped = normalized.replace(/^(option|panel|item|choice)\s+/i, '').trim()
  if (ordinalMap[stripped] !== undefined) return ordinalMap[stripped]
  if (/^[1-9]$/.test(stripped)) return parseInt(stripped, 10) - 1
  return undefined
}

/**
 * Strict raw deterministic resolver for widget-list Step 2.5.
 * Per raw-strict-exact contract Rule 2: deterministic execute only on raw strict exact.
 *
 * Match methods (in order):
 *   1. Strict whole-string ordinal (no embedded extraction)
 *   2. Raw exact label match (case-insensitive only)
 *   3. Badge letter (when UI displays badge letters)
 *
 * NO: verb stripping, fuzzy token-subset, embedded ordinal extraction.
 */
function resolveStrictRawDeterministic(
  input: string,
  candidates: GroundingCandidate[],
  options?: { hasBadgeLetters?: boolean }
): DeterministicMatchResult {
  const normalized = input.trim().toLowerCase()
  if (candidates.length === 0) return { matched: false }

  // 1. Strict whole-string ordinal (no embedded extraction)
  const ordinalIndex = resolveStrictOrdinalIndex(normalized, candidates.length)
  if (ordinalIndex !== undefined && ordinalIndex >= 0 && ordinalIndex < candidates.length) {
    return { matched: true, candidate: candidates[ordinalIndex], index: ordinalIndex, matchMethod: 'ordinal' }
  }

  // 2. Raw exact label match (case-insensitive only — no verb stripping, no fuzzy)
  const exactMatch = candidates.find(c => c.label.toLowerCase() === normalized)
  if (exactMatch) {
    return { matched: true, candidate: exactMatch, index: candidates.indexOf(exactMatch), matchMethod: 'shorthand_keyword' }
  }

  // 3. Badge letter (only when UI displays badge letters)
  if (options?.hasBadgeLetters && /^[a-e]$/i.test(normalized)) {
    const badgeIndex = normalized.charCodeAt(0) - 'a'.charCodeAt(0)
    if (badgeIndex >= 0 && badgeIndex < candidates.length) {
      return { matched: true, candidate: candidates[badgeIndex], index: badgeIndex, matchMethod: 'ordinal' }
    }
  }

  return { matched: false }
}

// =============================================================================
// D) Multi-List Early Guard (Decision Flow Step 2)
// =============================================================================

/**
 * Check for multi-list ambiguity per plan §D.
 * If multiple widget lists are open AND input is selection-like,
 * return the widget options for disambiguation.
 *
 * Multi-list context is computed only from visible widget lists,
 * NOT from paused snapshots (per plan clarification).
 */
export function checkMultiListAmbiguity(
  input: string,
  openWidgets: OpenWidgetState[],
  options?: { hasBadgeLetters?: boolean }
): { isAmbiguous: boolean; widgets?: { id: string; label: string }[] } {
  // Need at least 2 visible widget lists with options
  const listsWithOptions = openWidgets.filter(w => w.options.length > 0)
  if (listsWithOptions.length < 2) {
    return { isAmbiguous: false }
  }

  // Only trigger if input is selection-like
  if (!isSelectionLike(input, options)) {
    return { isAmbiguous: false }
  }

  // Check if user explicitly references a widget by name
  const normalizedInput = input.trim().toLowerCase()
  for (const widget of listsWithOptions) {
    if (normalizedInput.includes(widget.label.toLowerCase())) {
      // User specified which widget — not ambiguous
      return { isAmbiguous: false }
    }
  }

  return {
    isAmbiguous: true,
    widgets: listsWithOptions.map(w => ({ id: w.id, label: w.label })),
  }
}

/**
 * Resolve a selection-like input against a specific widget's options.
 * Used when user explicitly references a widget (e.g., "first option in Recent").
 */
/**
 * @deprecated Per raw-strict-exact policy: this function rewrites input (strips widget
 * label/prepositions) before matching, which violates "non-exact → never deterministic."
 * No runtime code calls this — handleGroundingSetFallback's widget-reference branch
 * is diagnostic-only. Retained for test compatibility only. Do NOT use for routing.
 */
export function resolveWidgetSelection(
  input: string,
  widget: OpenWidgetState
): DeterministicMatchResult {
  const widgetPattern = escapeRegex(widget.label.toLowerCase())
  const normalizedInput = input.trim().toLowerCase()
    .replace(new RegExp(`\\b(in|from)\\s+(the\\s+)?${widgetPattern}\\b`, 'gi'), '')
    .replace(new RegExp(`\\b(the\\s+)?${widgetPattern}\\b`, 'gi'), '')
    .replace(/\s+/g, ' ')
    .trim()

  const candidates: GroundingCandidate[] = widget.options.map(opt => ({
    id: opt.id,
    label: opt.label,
    type: 'widget_option' as const,
    source: 'widget_list' as const,
  }))

  return resolveStrictRawDeterministic(normalizedInput, candidates, { hasBadgeLetters: true })
}

// =============================================================================
// G) Soft-Active Window (list stickiness)
// =============================================================================

/**
 * Check if a soft-active window applies.
 * Per plan §G: If activeOptionSetId == null but lastOptionsShown still valid
 * (within TTL) and input is selection-like, treat it as a list grounding set.
 *
 * The soft-active window uses the clarificationSnapshot when:
 *   - activeOptionSetId is null (list was cleared by an action)
 *   - snapshot exists and is NOT paused (post-action, not post-stop)
 *   - snapshot is within TTL (turnsSinceSet < SNAPSHOT_TURN_LIMIT)
 *   - input is selection-like
 *
 * Returns the snapshot options as a grounding set if applicable.
 */
export function checkSoftActiveWindow(params: {
  activeOptionSetId: string | null
  clarificationSnapshot: ClarificationSnapshot | null
  input: string
  snapshotTurnLimit: number
  hasBadgeLetters?: boolean
}): { isSoftActive: boolean; options?: ClarificationOption[] } {
  // Only applies when no active option set
  if (params.activeOptionSetId !== null) {
    return { isSoftActive: false }
  }

  const snapshot = params.clarificationSnapshot
  if (!snapshot || snapshot.options.length === 0) {
    return { isSoftActive: false }
  }

  // Paused snapshots (stop/interrupt) are NOT soft-active — they have their own rules (H)
  if (snapshot.paused) {
    return { isSoftActive: false }
  }

  // Check TTL
  if (snapshot.turnsSinceSet >= params.snapshotTurnLimit) {
    return { isSoftActive: false }
  }

  // Only activate for selection-like input
  if (!isSelectionLike(params.input, { hasBadgeLetters: params.hasBadgeLetters })) {
    return { isSoftActive: false }
  }

  return { isSoftActive: true, options: snapshot.options }
}

// =============================================================================
// H) Paused-List Re-Anchor (after stop)
// =============================================================================

/**
 * Check if a paused re-anchor response is needed.
 * Per plan §H: If paused list exists and activeOptionSetId == null,
 * and user uses ordinal/shorthand without return cue, respond with
 * guidance to reopen the list.
 *
 * Returns the guidance message if re-anchor is needed, null otherwise.
 * Note: The existing stop-paused ordinal guard in chat-routing.ts (lines 1987-2009)
 * already implements this. This function provides a reusable check for the
 * grounding-set fallback pathway.
 */
export function checkPausedReAnchor(params: {
  activeOptionSetId: string | null
  clarificationSnapshot: ClarificationSnapshot | null
  input: string
  hasBadgeLetters?: boolean
}): { needsReAnchor: boolean; message?: string } {
  if (params.activeOptionSetId !== null) {
    return { needsReAnchor: false }
  }

  const snapshot = params.clarificationSnapshot
  if (!snapshot || !snapshot.paused || snapshot.pausedReason !== 'stop') {
    return { needsReAnchor: false }
  }

  if (snapshot.options.length === 0) {
    return { needsReAnchor: false }
  }

  // Only trigger for selection-like input
  if (!isSelectionLike(params.input, { hasBadgeLetters: params.hasBadgeLetters })) {
    return { needsReAnchor: false }
  }

  return {
    needsReAnchor: true,
    message: "That list was closed. Say 'back to the options' to reopen it — or tell me what you want instead.",
  }
}

// =============================================================================
// Main Grounding-Set Fallback Handler
// =============================================================================

/**
 * Main grounding-set fallback handler.
 *
 * Per plan §Decision Flow:
 *   1) Build grounding sets
 *   2) Multi-list early guard
 *   3) Deterministic unique match (if list-type + selection-like)
 *   4) Otherwise: return candidates for LLM fallback
 *   5) If no grounding set: ask for missing slot
 *
 * This function handles steps 1-3 and 5. Step 4 (LLM call) is deferred
 * to the caller (constrained LLM module, Task #10).
 */
export function handleGroundingSetFallback(
  input: string,
  ctx: GroundingSetBuildContext,
  options?: { hasBadgeLetters?: boolean; activeWidgetId?: string }
): GroundingSetResult {
  const trimmed = input.trim()

  // Step 1: Build grounding sets
  const groundingSets = buildGroundingSets(ctx)

  void debugLog({
    component: 'ChatNavigation',
    action: 'grounding_set_built',
    metadata: {
      sets: groundingSets.map(s => ({ type: s.type, size: s.candidates.length })),
      totalSets: groundingSets.length,
    },
  })

  // Per incubation plan §Observability: log candidate context for latch-aware resolution
  if (options?.activeWidgetId) {
    const widgetSet = groundingSets.find(s => s.widgetId === options.activeWidgetId)
    void debugLog({
      component: 'ChatNavigation',
      action: 'selection_context_candidates_built',
      metadata: {
        activeWidgetId: options.activeWidgetId,
        widgetCandidateCount: widgetSet?.candidates.length ?? 0,
        totalSets: groundingSets.length,
        input: trimmed,
      },
    })
  }

  // Filter to non-empty sets (capability set is always present but may not be useful)
  const nonCapabilitySets = groundingSets.filter(s => s.type !== 'capability')

  // ---- Advisory Panel Evidence (hoisted before multi-list guard) ----
  // Compute raw + canonical panel evidence early. If panel intent is detected,
  // multi-list ambiguity is suppressed — the user is targeting a panel, not a
  // widget-list item. Evidence is advisory only (scopes LLM candidates).
  const visiblePanelSet = groundingSets.find(s => s.type === 'visible_panels')
  let panelEvidenceResult: { candidates: GroundingCandidate[]; matchType: PanelMatchResult['type']; source: 'raw' | 'canonical' } | null = null

  if (visiblePanelSet && visiblePanelSet.candidates.length > 0) {
    const panelWidgets = visiblePanelSet.candidates.map(c => ({
      id: c.id, title: c.label, type: 'panel'
    }))

    // Raw evidence (current behavior)
    const rawEvidence = matchVisiblePanelCommand(trimmed, panelWidgets)
    if (rawEvidence.type !== 'none') {
      const matchedIds = new Set(rawEvidence.matches.map(m => m.id))
      panelEvidenceResult = {
        candidates: visiblePanelSet.candidates.filter(c => matchedIds.has(c.id)),
        matchType: rawEvidence.type,
        source: 'raw',
      }
    }

    // Canonical fallback (strip verb prefix, articles, politeness)
    // Guardrail: only attempt canonical matching for panel-like command forms
    // to prevent unrelated text from getting panel-biased.
    // Gate: isExplicitCommand OR input contains "panel"/"panels"/"widget"/"widgets"
    if (!panelEvidenceResult) {
      const lowerTrimmed = trimmed.toLowerCase()
      const isPanelLikeForm = isExplicitCommand(trimmed)
        || /\b(panels?|widgets?)\b/.test(lowerTrimmed)
      if (isPanelLikeForm) {
        const canonical = canonicalizeCommandInput(trimmed)
        if (canonical && canonical !== lowerTrimmed.trim()) {
          const canonicalEvidence = matchVisiblePanelCommand(canonical, panelWidgets)
          if (canonicalEvidence.type !== 'none') {
            const matchedIds = new Set(canonicalEvidence.matches.map(m => m.id))
            panelEvidenceResult = {
              candidates: visiblePanelSet.candidates.filter(c => matchedIds.has(c.id)),
              matchType: canonicalEvidence.type,
              source: 'canonical',
            }
          }
        }
      }
    }
  }

  // Step 2: Multi-list early guard
  // Per selection-intent-arbitration-incubation-plan Rule 2 + Test 9:
  // When activeWidgetId is set (latch active or pre-latch single list),
  // skip multi-list ambiguity — the active widget is authoritative.
  // Guardrail: panelEvidenceResult is only non-null when candidates.length > 0
  // (both raw and canonical paths only set it on non-none match with actual candidates)
  const multiListCheck = options?.activeWidgetId
    ? { isAmbiguous: false as const }
    : panelEvidenceResult
      ? { isAmbiguous: false as const }  // Panel intent detected — skip multi-list
      : checkMultiListAmbiguity(trimmed, ctx.openWidgets, options)
  if (multiListCheck.isAmbiguous) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'multi_list_ambiguity_prompt_shown',
      metadata: {
        input: trimmed,
        widgetCount: multiListCheck.widgets?.length,
        widgets: multiListCheck.widgets?.map(w => w.label),
      },
    })

    return {
      handled: true,
      multiListAmbiguity: true,
      askClarifier: true,
      clarifierMessage: 'I see multiple option lists open. Which one do you mean?',
      widgetOptions: multiListCheck.widgets,
    }
  }

  // Widget-reference detection: log when input contains a widget label.
  // Per raw-strict-exact policy: NO deterministic execution here. The widget label
  // substring match is NOT a raw exact match, and resolveWidgetSelection rewrites
  // the input (strips widget label/prepositions) before matching — that violates
  // "non-exact → never deterministic."
  //
  // Instead: log the widget reference for diagnostics and fall through.
  // Step 2.5 handles raw strict exact matches (ordinal, exact label, badge).
  // Step 2.6 handles panel evidence → bounded LLM.
  // Step 2.7 handles widget-list → bounded LLM.
  if (ctx.openWidgets.length > 0 && !isExplicitCommand(trimmed)) {
    const normalizedInput = trimmed.toLowerCase()
    for (const widget of ctx.openWidgets) {
      if (normalizedInput.includes(widget.label.toLowerCase()) && widget.options.length > 0) {
        // Diagnostic only — no deterministic return.
        void debugLog({
          component: 'ChatNavigation',
          action: 'widget_reference_detected',
          metadata: {
            input: trimmed,
            widgetId: widget.id,
            widgetLabel: widget.label,
            optionCount: widget.options.length,
            reason: 'falling_through_to_strict_and_llm_paths',
          },
        })
      }
    }
  }

  // Step 2.5: Widget-list strict raw direct match (widget-ui-snapshot-plan.md)
  // Uses resolveStrictRawDeterministic: ordinal + raw exact label + badge only.
  // NO verb stripping, NO fuzzy token-subset, NO embedded ordinal extraction.
  // Per raw-strict-exact contract Rule 2: deterministic execute only on raw strict exact.
  // Priority: (1) activeWidgetId's list, (2) any list with unique match
  const widgetListSets = groundingSets.filter(s => s.type === 'widget_list')
  if (widgetListSets.length > 0) {
    // (1) If activeWidgetId is set (focus latch or pre-latch default), scope to that widget
    const activeWidgetList = options?.activeWidgetId
      ? widgetListSets.find(s => s.widgetId === options.activeWidgetId)
      : (ctx.openWidgets.length > 0
        ? widgetListSets.find(s => s.widgetId === ctx.openWidgets[0]?.id)
        : undefined)

    if (activeWidgetList) {
      const matchResult = resolveStrictRawDeterministic(trimmed, activeWidgetList.candidates, options)
      if (matchResult.matched) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'active_widget_list_direct_match',
          metadata: {
            input: trimmed,
            widgetId: activeWidgetList.widgetId,
            widgetLabel: activeWidgetList.widgetLabel,
            matchedLabel: matchResult.candidate?.label,
            matchMethod: matchResult.matchMethod,
          },
        })
        return {
          handled: true,
          resolvedBy: 'widget_list',
          selectedCandidate: matchResult.candidate,
        }
      }
    }

    // (2) Try all widget lists - if exactly one has a unique match, use it
    const matchingResults: Array<{ set: GroundingSet; result: DeterministicMatchResult }> = []
    for (const listSet of widgetListSets) {
      const matchResult = resolveStrictRawDeterministic(trimmed, listSet.candidates, options)
      if (matchResult.matched) {
        matchingResults.push({ set: listSet, result: matchResult })
      }
    }

    if (matchingResults.length === 1) {
      const { set, result } = matchingResults[0]
      void debugLog({
        component: 'ChatNavigation',
        action: 'widget_list_unique_match',
        metadata: {
          input: trimmed,
          widgetId: set.widgetId,
          widgetLabel: set.widgetLabel,
          matchedLabel: result.candidate?.label,
          matchMethod: result.matchMethod,
          totalWidgetLists: widgetListSets.length,
        },
      })
      return {
        handled: true,
        resolvedBy: 'widget_list',
        selectedCandidate: result.candidate,
      }
    }

    // Multiple lists match → log ambiguity (fall through to clarifier)
    if (matchingResults.length > 1) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'widget_list_ambiguous_match',
        metadata: {
          input: trimmed,
          matchingWidgets: matchingResults.map(m => m.set.widgetLabel),
        },
      })
    }
  }

  // Step 2.6: Visible-panels LLM fallback (independent of widget lists).
  // Uses pre-computed panelEvidenceResult (raw or canonical, hoisted above multi-list guard).
  // Per raw-strict-exact contract Rule 1 (refined): advisory normalization for LLM candidate
  // selection is permitted since the LLM makes the final routing decision.
  // NOTE: Runs whenever visible_panels exists — NOT coupled to widgetListSets.
  if (panelEvidenceResult && panelEvidenceResult.candidates.length > 0) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'visible_panels_evidence_gated_llm_fallback',
      metadata: {
        input: trimmed,
        matchType: panelEvidenceResult.matchType,
        source: panelEvidenceResult.source,
        matchedCount: panelEvidenceResult.candidates.length,
        matchedLabels: panelEvidenceResult.candidates.map(c => c.label),
      },
    })
    return {
      handled: false,
      needsLLM: true,
      llmCandidates: panelEvidenceResult.candidates,
    }
  }

  // Step 2.7: Widget-list LLM fallback (demoted — after visible_panels).
  // Per widget-ui-snapshot-plan.md §Canonical Resolver Path:
  //   "If deterministic matching failed/ambiguous AND widget lists are visible
  //    THEN → Call constrained LLM with candidates from widget lists"
  // Scope to the active widget first when available to avoid mixing other widget items
  // into the candidate set (e.g., Links Panel D vs Links Panel E).
  if (widgetListSets.length > 0) {
    // Recompute activeWidgetList for scoping (same logic as Step 2.5)
    const activeWidgetListForLLM = options?.activeWidgetId
      ? widgetListSets.find(s => s.widgetId === options.activeWidgetId)
      : (ctx.openWidgets.length > 0
        ? widgetListSets.find(s => s.widgetId === ctx.openWidgets[0]?.id)
        : undefined)
    const widgetCandidates = activeWidgetListForLLM?.candidates?.length
      ? activeWidgetListForLLM.candidates
      : widgetListSets.flatMap(s => s.candidates)
    if (widgetCandidates.length > 0) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'widget_list_deterministic_failed_llm_fallback',
        metadata: {
          input: trimmed,
          candidateCount: widgetCandidates.length,
          candidateScope: activeWidgetListForLLM?.candidates?.length ? 'active_widget' : 'all_widgets',
          activeWidgetId: activeWidgetListForLLM?.widgetId,
          activeWidgetLabel: activeWidgetListForLLM?.widgetLabel,
          widgetIds: widgetListSets.map(s => s.widgetId),
        },
      })

      return {
        handled: false,
        needsLLM: true,
        llmCandidates: widgetCandidates,
      }
    }
  }

  // Step 3: Deterministic unique match on first list-type set (selection-like required)
  // Per raw-strict-exact policy: use strict resolver — no verb stripping, no fuzzy, no token-subset.
  const firstListSet = groundingSets.find(s => s.isList)
  if (firstListSet && isSelectionLike(trimmed, options)) {
    const deterministicResult = resolveStrictRawDeterministic(trimmed, firstListSet.candidates, options)
    if (deterministicResult.matched) {
      return {
        handled: true,
        resolvedBy: firstListSet.type,
        selectedCandidate: deterministicResult.candidate,
      }
    }
  }

  // Gate: list-type and capability-only sets require selection-like input.
  // Referent sets are allowed for non-selection-like inputs (e.g. "fix it", "open it")
  // because the plan's trigger (§Trigger) is general, not list-only.
  const selectionLike = isSelectionLike(trimmed, options)
  const referentSets = nonCapabilitySets.filter(s => s.type === 'recent_referent')
  const hasReferents = referentSets.length > 0 &&
    referentSets.some(s => s.candidates.length > 0)

  // If input is NOT selection-like AND no referent sets exist, fall through to Tier 5.
  // Capability-only sets should not intercept informational queries.
  if (!selectionLike && !hasReferents) {
    return { handled: false }
  }

  // Step 4: If any list-type grounding set exists and input is selection-like,
  // defer to constrained LLM with list candidates.
  const listSets = nonCapabilitySets.filter(s => s.isList)
  if (listSets.length > 0 && selectionLike) {
    const listCandidates = listSets.flatMap(s => s.candidates)

    return {
      handled: false,
      needsLLM: true,
      llmCandidates: listCandidates,
    }
  }

  // Step 4b: Referent-type sets exist (per plan acceptance tests §1-2).
  // Allowed for both selection-like ("open it") and non-selection-like ("fix it")
  // inputs when referents are available.
  if (hasReferents) {
    const referentCandidates = referentSets.flatMap(s => s.candidates)
    return {
      handled: false,
      needsLLM: true,
      llmCandidates: referentCandidates,
    }
  }

  // Step 5: Selection-like input but no non-capability grounding set — ask for missing slot
  return {
    handled: false,
    needsLLM: false,
    askClarifier: true,
    clarifierMessage: 'I\'m not sure what you\'re referring to. Could you tell me what you\'d like to do?',
  }
}

// =============================================================================
// Context Builder — bridges existing state to GroundingSetBuildContext
// =============================================================================

/**
 * Build a GroundingSetBuildContext from the existing routing state.
 * This avoids adding new state fields — it derives the grounding context
 * from lastClarification, clarificationSnapshot, sessionState, etc.
 *
 * The openWidgets parameter is empty by default (multi-widget UI not yet implemented).
 * When multi-widget support is added, pass the actual open widgets here.
 */
export function buildGroundingContext(params: {
  activeOptionSetId: string | null
  lastClarification: LastClarificationState | null
  clarificationSnapshot: ClarificationSnapshot | null
  sessionState: SessionState
  repairMemory: RepairMemoryState | null
  openWidgets?: OpenWidgetState[]
  visiblePanels?: Array<{ id: string; title: string; type: string }>
}): GroundingSetBuildContext {
  // Derive active options from lastClarification
  const activeOptions: ClarificationOption[] =
    (params.activeOptionSetId !== null && params.lastClarification?.options)
      ? params.lastClarification.options
      : []

  // Derive paused snapshot — only if it's actually paused
  const pausedSnapshot =
    (params.clarificationSnapshot?.paused === true)
      ? params.clarificationSnapshot
      : null

  // Soft-active window: if no active options but clarificationSnapshot exists
  // (not paused, within TTL), treat it as a soft-active grounding set.
  // This is handled by buildGroundingSets via the activeOptions/pausedSnapshot
  // distinction — the caller should set activeOptionSetId to a synthetic value
  // when soft-active applies. See Task #8 for soft-active wiring.

  // Derive recent referents from sessionState
  const recentReferents: RecentReferent[] = []
  if (params.sessionState.lastAction) {
    const la = params.sessionState.lastAction
    const label = la.panelTitle || la.entryName || la.workspaceName || la.type
    recentReferents.push({
      id: `last_action_${la.type}`,
      label: label,
      type: 'last_action',
      actionHint: la.type,
    })
    // Also add the target as a separate referent if it has an ID
    if (la.panelId) {
      recentReferents.push({
        id: la.panelId,
        label: la.panelTitle || la.panelId,
        type: 'last_target',
      })
    } else if (la.entryId) {
      recentReferents.push({
        id: la.entryId,
        label: la.entryName || la.entryId,
        type: 'last_target',
      })
    } else if (la.workspaceId) {
      recentReferents.push({
        id: la.workspaceId,
        label: la.workspaceName || la.workspaceId,
        type: 'last_target',
      })
    }
  }

  return {
    activeOptionSetId: params.activeOptionSetId,
    activeOptions,
    pausedSnapshot,
    // FUTURE: Wire actual open widgets when multi-widget UI is implemented.
    // Currently always [] — multi-list guard (§E) is a no-op until then.
    openWidgets: params.openWidgets ?? [],
    recentReferents,
    visiblePanels: params.visiblePanels,
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Resolve ordinal words/numbers to a 0-based index */
function resolveOrdinalIndex(normalized: string, optionCount: number): number | undefined {
  const ordinalMap: Record<string, number> = {
    'first': 0, '1st': 0, '1': 0,
    'second': 1, '2nd': 1, '2': 1,
    'third': 2, '3rd': 2, '3': 2,
    'fourth': 3, '4th': 3, '4': 3,
    'fifth': 4, '5th': 4, '5': 4,
    'sixth': 5, '6': 5,
    'seventh': 6, '7': 6,
    'eighth': 7, '8': 7,
    'ninth': 8, '9': 8,
    'last': optionCount - 1,
    'the first': 0, 'the second': 1, 'the third': 2,
    'the fourth': 3, 'the fifth': 4, 'the last': optionCount - 1,
    'the first one': 0, 'the second one': 1, 'the third one': 2,
    'the fourth one': 3, 'the fifth one': 4, 'the last one': optionCount - 1,
    'option 1': 0, 'option 2': 1, 'option 3': 2,
    'option 4': 3, 'option 5': 4,
  }

  // Strip shorthand wrapping: "panel X" → "X", "item X" → "X"
  const stripped = normalized
    .replace(/^(option|panel|item|choice)\s+/i, '')
    .trim()

  // 1. Exact whole-string match
  if (ordinalMap[normalized] !== undefined) return ordinalMap[normalized]
  if (ordinalMap[stripped] !== undefined) return ordinalMap[stripped]

  // Try numeric after stripping
  if (/^[1-9]$/.test(stripped)) {
    return parseInt(stripped, 10) - 1
  }

  // 2. Extract ordinal from within a longer string.
  //    Handles inputs like "open the first option in the widget" where the
  //    ordinal is embedded in a command sentence. Matches the FIRST ordinal
  //    token found via word-boundary search.
  const embeddedOrdinals: [RegExp, number][] = [
    [/\bfirst\b|(?<!\d)1st\b/, 0],
    [/\bsecond\b|(?<!\d)2nd\b/, 1],
    [/\bthird\b|(?<!\d)3rd\b/, 2],
    [/\bfourth\b|(?<!\d)4th\b/, 3],
    [/\bfifth\b|(?<!\d)5th\b/, 4],
    [/\bsixth\b/, 5],
    [/\bseventh\b/, 6],
    [/\beighth\b/, 7],
    [/\bninth\b/, 8],
    [/\blast\b/, optionCount - 1],
  ]

  // Also match "option N" / "item N" / "#N" embedded anywhere
  const embeddedNumbered = normalized.match(/\b(?:option|item|#)\s*([1-9])\b/)
  if (embeddedNumbered) {
    const idx = parseInt(embeddedNumbered[1], 10) - 1
    if (idx >= 0 && idx < optionCount) return idx
  }

  for (const [pattern, index] of embeddedOrdinals) {
    if (pattern.test(normalized) && index >= 0 && index < optionCount) {
      return index
    }
  }

  return undefined
}

/** Tokenize a string into lowercase words, removing punctuation */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 0)
}

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
