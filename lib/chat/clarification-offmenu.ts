/**
 * Clarification Off-Menu Handling
 * Per clarification-offmenu-handling-plan.md (v1)
 *
 * Handles off-menu input during clarification mode:
 * - Micro-alias token matching (label-derived, no global synonyms)
 * - New topic detection (bounded)
 * - Escalation messaging policy
 * - Clarification type differentiation
 */

import type { ClarificationOption, LastClarificationState } from './chat-navigation-context'

// =============================================================================
// Types
// =============================================================================

export interface OffMenuMappingResult {
  type: 'mapped' | 'ambiguous' | 'no_match'
  /** Matched option (if type === 'mapped') */
  matchedOption?: ClarificationOption
  /** Confidence level for telemetry */
  confidence: 'high' | 'medium' | 'low'
  /** Reason for the mapping result */
  reason: string
}

export interface NewTopicDetectionResult {
  isNewTopic: boolean
  reason: string
  /** Non-overlapping tokens that triggered detection */
  nonOverlappingTokens?: string[]
}

export type ClarificationType = LastClarificationState['type']

// =============================================================================
// Constants
// =============================================================================

/** Maximum off-menu attempts before showing escalation exits */
export const MAX_ATTEMPT_COUNT = 3

/** Stopwords to remove during normalization */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'my', 'your', 'our', 'their',
  'pls', 'please', 'plz', 'now', 'thanks', 'thank', 'thx',
])

/**
 * Micro-alias allowlist (tight, explicit)
 * Maps morphological variants to their canonical form.
 * Per plan: "Do not use broad stemming. Keep variants opt-in and minimal."
 *
 * Only includes tokens that commonly appear in option labels:
 * - Singular/plural normalization for UI terms
 * - Morphological variants from plan examples
 *
 * Expand only when telemetry shows repeated user phrasing that fails mapping.
 */
const MICRO_ALIAS_ALLOWLIST: Record<string, string> = {
  // Singular/plural normalization (common UI terms in option labels)
  panel: 'panel',
  panels: 'panel',
  widget: 'widget',
  widgets: 'widget',
  link: 'links',
  links: 'links',
  workspace: 'workspace',
  workspaces: 'workspace',
  note: 'note',
  notes: 'note',
  setting: 'settings',
  settings: 'settings',
  preference: 'preferences',
  preferences: 'preferences',
  // Morphological variants (per plan allowlist examples)
  personal: 'personalization',
  personalization: 'personalization',
  personalize: 'personalization',
  customize: 'customization',
  customization: 'customization',
  custom: 'customization',
}

/**
 * Command/question verbs for new topic detection.
 * Per plan: "contains an imperative action verb" or "starts with question verb"
 */
const QUESTION_VERBS = new Set([
  'what', 'how', 'why', 'tell', 'explain', 'describe', 'clarify', 'show',
])

const ACTION_VERBS = new Set([
  'open', 'show', 'go', 'create', 'rename', 'delete', 'add', 'remove',
  'find', 'search', 'list', 'view', 'edit', 'update', 'close', 'hide',
])

// =============================================================================
// Canonical Token Normalization
// =============================================================================

/**
 * Normalize a string to canonical tokens.
 * - Lowercase
 * - Remove punctuation (except alphanumeric and space)
 * - Remove stopwords
 * - Apply micro-alias mapping
 */
export function toCanonicalTokens(s: string): Set<string> {
  const tokens = s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t && !STOPWORDS.has(t))
    .map(t => MICRO_ALIAS_ALLOWLIST[t] ?? t)
  return new Set(tokens)
}

/**
 * Get alias tokens for a label (derived from the label itself).
 * This includes the canonical tokens plus any micro-aliases.
 */
export function getLabelAliasTokens(label: string): Set<string> {
  const tokens = toCanonicalTokens(label)
  // Add original tokens (before alias mapping) for broader matching
  const originalTokens = label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t && !STOPWORDS.has(t))

  for (const t of originalTokens) {
    tokens.add(t)
    // Add alias if exists
    if (MICRO_ALIAS_ALLOWLIST[t]) {
      tokens.add(MICRO_ALIAS_ALLOWLIST[t])
    }
  }
  return tokens
}

// =============================================================================
// Off-Menu Mapping
// =============================================================================

/**
 * Check if input tokens exactly match label tokens (canonical equality).
 */
function hasCanonicalEquality(inputTokens: Set<string>, labelTokens: Set<string>): boolean {
  if (inputTokens.size !== labelTokens.size) return false
  for (const t of inputTokens) {
    if (!labelTokens.has(t)) return false
  }
  return true
}

/**
 * Check if input tokens are a subset of label tokens (canonical subset).
 */
function isCanonicalSubset(inputTokens: Set<string>, labelTokens: Set<string>): boolean {
  if (inputTokens.size === 0) return false
  for (const t of inputTokens) {
    if (!labelTokens.has(t)) return false
  }
  return true
}

/**
 * Map off-menu input to an option using deterministic heuristics.
 * Per plan Section B: Confidence criteria.
 *
 * @param input - User input
 * @param options - Available clarification options
 * @param clarificationType - Type of clarification (affects strictness)
 * @returns Mapping result with matched option or ambiguity info
 */
export function mapOffMenuInput(
  input: string,
  options: ClarificationOption[],
  clarificationType: ClarificationType
): OffMenuMappingResult {
  if (!options || options.length === 0) {
    return { type: 'no_match', confidence: 'low', reason: 'no_options' }
  }

  const inputTokens = toCanonicalTokens(input)
  if (inputTokens.size === 0) {
    return { type: 'no_match', confidence: 'low', reason: 'empty_input_tokens' }
  }

  // Cross-corpus: strict mode (only exact label / ordinal)
  // Per plan: "disable micro-alias mapping"
  if (clarificationType === 'cross_corpus') {
    const normalizedInput = input.toLowerCase().trim()
    const exactMatch = options.find(opt =>
      opt.label.toLowerCase() === normalizedInput
    )
    if (exactMatch) {
      return {
        type: 'mapped',
        matchedOption: exactMatch,
        confidence: 'high',
        reason: 'cross_corpus_exact_match',
      }
    }
    return { type: 'no_match', confidence: 'low', reason: 'cross_corpus_no_exact_match' }
  }

  // Build matching data for each option
  const matchData = options.map(opt => {
    const labelTokens = getLabelAliasTokens(opt.label)
    const hasEquality = hasCanonicalEquality(inputTokens, labelTokens)
    const isSubset = isCanonicalSubset(inputTokens, labelTokens)
    return { option: opt, labelTokens, hasEquality, isSubset }
  })

  // Check for canonical equality (highest confidence)
  const equalityMatches = matchData.filter(m => m.hasEquality)
  if (equalityMatches.length === 1) {
    return {
      type: 'mapped',
      matchedOption: equalityMatches[0].option,
      confidence: 'high',
      reason: 'canonical_equality',
    }
  }

  // Check for canonical subset (only if single match)
  // Per plan: "Canonical token subset where only one option satisfies it"
  const subsetMatches = matchData.filter(m => m.isSubset)

  // Workspace list: prefer ordinal or exact label; avoid fuzzy auto-select
  if (clarificationType === 'workspace_list') {
    // Only allow equality matches for workspace, not subset
    return { type: 'no_match', confidence: 'low', reason: 'workspace_requires_exact' }
  }

  if (subsetMatches.length === 1) {
    return {
      type: 'mapped',
      matchedOption: subsetMatches[0].option,
      confidence: 'medium',
      reason: 'canonical_subset_single',
    }
  }

  if (subsetMatches.length > 1 || equalityMatches.length > 1) {
    return {
      type: 'ambiguous',
      confidence: 'low',
      reason: 'multiple_options_match',
    }
  }

  return { type: 'no_match', confidence: 'low', reason: 'no_token_match' }
}

// =============================================================================
// New Topic Detection
// =============================================================================

/**
 * Check if input is a "clear command/question".
 * Per plan: contains ?, starts with question verb, or contains action verb.
 */
export function isClearCommandOrQuestion(input: string): boolean {
  const normalizedInput = input.toLowerCase().trim()

  // Contains question mark
  if (normalizedInput.includes('?')) return true

  // Starts with question verb
  const firstWord = normalizedInput.split(/\s+/)[0]
  if (QUESTION_VERBS.has(firstWord)) return true

  // Contains action verb
  const words = normalizedInput.split(/\s+/)
  for (const word of words) {
    if (ACTION_VERBS.has(word)) return true
  }

  return false
}

/**
 * Detect if input is a new topic (should exit clarification).
 * Per plan Section C: Bounded new topic detection.
 *
 * Only treat as new topic IF:
 * - No direct selection, and
 * - No off-menu mapping match, and
 * - Input is a clear command/question, and
 * - Input contains at least one token not overlapping any option label tokens
 *
 * @param input - User input
 * @param options - Available clarification options
 * @param offMenuResult - Result from mapOffMenuInput
 * @returns Detection result
 */
export function detectNewTopic(
  input: string,
  options: ClarificationOption[],
  offMenuResult: OffMenuMappingResult
): NewTopicDetectionResult {
  // If off-menu mapping found a match, not a new topic
  if (offMenuResult.type === 'mapped') {
    return { isNewTopic: false, reason: 'has_offmenu_match' }
  }

  // Must be a clear command/question
  if (!isClearCommandOrQuestion(input)) {
    return { isNewTopic: false, reason: 'not_clear_command_or_question' }
  }

  // Check for non-overlapping tokens
  const inputTokens = toCanonicalTokens(input)
  const allOptionTokens = new Set<string>()

  for (const opt of options) {
    const labelTokens = getLabelAliasTokens(opt.label)
    for (const t of labelTokens) {
      allOptionTokens.add(t)
    }
  }

  // Find tokens in input that don't overlap with any option
  const nonOverlappingTokens: string[] = []
  for (const t of inputTokens) {
    // Skip common action verbs - they don't indicate new topic on their own
    if (ACTION_VERBS.has(t) || QUESTION_VERBS.has(t)) continue
    if (!allOptionTokens.has(t)) {
      nonOverlappingTokens.push(t)
    }
  }

  // Per plan: "Input contains at least one token not overlapping any option label tokens"
  if (nonOverlappingTokens.length > 0) {
    return {
      isNewTopic: true,
      reason: 'has_non_overlapping_tokens',
      nonOverlappingTokens,
    }
  }

  return { isNewTopic: false, reason: 'all_tokens_overlap_options' }
}

// =============================================================================
// Escalation Messaging
// =============================================================================

export interface EscalationMessage {
  content: string
  showExits: boolean
}

/**
 * Get escalation message based on attempt count.
 * Per clarification-offmenu-handling-plan.md: Escalation Messaging Policy + Loop Control (F).
 *
 * Attempt 1: gentle redirect (re-show pills)
 * Attempt 2+: show exit pills + clarifying question
 *
 * Updated per plan section F: "If attemptCount >= 2 → show explicit exits"
 *
 * @param attemptCount - Current attempt count
 * @returns Escalation message and whether to show exit options
 */
export function getEscalationMessage(attemptCount: number): EscalationMessage {
  if (attemptCount >= MAX_ATTEMPT_COUNT) {
    return {
      content: 'Which one is closer, or tell me the feature in 3-6 words (e.g., "change workspace theme").',
      showExits: true,
    }
  }

  // Per plan (F): show exit pills at attempt >= 2
  if (attemptCount >= 2) {
    return {
      content: 'Which one is closer to what you need?',
      showExits: true,  // Changed from false → true per plan
    }
  }

  // Attempt 1 (default)
  return {
    content: 'Please choose one of the options:',
    showExits: false,
  }
}

/**
 * Get soft-confirm message for broad mapping.
 * Per plan: "If mapping is confident but user input is very broad"
 *
 * @param mappedLabel - The label that was mapped to
 * @returns Soft confirmation message
 */
export function getSoftConfirmMessage(mappedLabel: string): string {
  return `Got it — I'll use **${mappedLabel}**. If you meant the other one, pick it below.`
}

// =============================================================================
// Exit Option Helpers
// =============================================================================

export interface ExitOption {
  id: string
  label: string
  type: 'exit'
}

/**
 * Get exit options for escalation.
 * Per plan: "None of these / Start over"
 */
export function getExitOptions(): ExitOption[] {
  return [
    { id: 'exit_none', label: 'None of these', type: 'exit' },
    { id: 'exit_start_over', label: 'Start over', type: 'exit' },
  ]
}

/**
 * Check if input is an exit phrase.
 * Per plan: "cancel / never mind / none / stop"
 * NOTE: "no" by itself is NOT an exit - it's handled separately as rejection/repair.
 */
export function isExitPhrase(input: string): boolean {
  const normalizedInput = input.toLowerCase().trim()
  const exitPhrases = [
    'cancel', 'never mind', 'nevermind', 'none', 'stop',
    'forget it', 'none of these', 'start over', 'exit',
    'quit', 'no thanks', 'skip', 'something else',
  ]
  return exitPhrases.some(phrase => normalizedInput.includes(phrase))
}

/**
 * Check if input is a hesitation/pause phrase.
 * Per clarification-offmenu-handling-plan.md (A0):
 * - Do NOT increment attemptCount
 * - Re-show pills with softer prompt
 *
 * Examples: "hmm", "hmmm", "i don't know", "not sure", "idk"
 */
export function isHesitationPhrase(input: string): boolean {
  const normalized = input.toLowerCase().trim()

  // Exact matches for short hesitation sounds
  const exactHesitations = [
    'hmm', 'hmmm', 'hmmmm', 'hm', 'hmn',
    'umm', 'ummm', 'um', 'uh', 'uhh',
    'idk', 'dunno', 'i dunno', 'i donno',
    'not sure', "i'm not sure", 'im not sure',
    "i don't know", 'i dont know', "don't know", 'dont know',
    'no idea', 'unsure', 'maybe', 'perhaps',
    'let me think', 'thinking', 'hold on',
  ]

  if (exactHesitations.includes(normalized)) {
    return true
  }

  // Pattern matches for variations
  const hesitationPatterns = [
    /^h+m+$/i,           // "hm", "hmm", "hmmm", "hhhmm"
    /^u+[hm]+$/i,        // "um", "umm", "uh", "uhm"
    /^i\s*(don'?t|dont)\s*know/i,
    /^not\s+sure/i,
    /^i\s*(don'?t|dont)\s*really\s*know/i,
    /^(i\s*)?dunno/i,
    /^(i\s*)?donno/i,
  ]

  return hesitationPatterns.some(pattern => pattern.test(normalized))
}

/**
 * Check if input is a repair phrase (rejection that should stay in context).
 * Per clarification-offmenu-handling-plan.md (E):
 * - "not that", "no, the other one" → keep clarification active
 * - Prefer alternative option when 2 choices exist
 *
 * Examples: "not that", "the other one", "no the other", "wrong one"
 */
export function isRepairPhrase(input: string): boolean {
  const normalized = input.toLowerCase().trim()

  const repairPhrases = [
    'not that', 'not that one', 'not this one',
    'the other one', 'the other', 'other one',
    'no the other', 'no, the other', 'no the other one',
    'wrong one', 'wrong', 'different one',
    'no not that', 'no, not that',
    'nope the other', 'nah the other',
  ]

  return repairPhrases.some(phrase => normalized.includes(phrase) || normalized === phrase)
}

/**
 * Get soft prompt for hesitation (gentler than escalation).
 * Per plan: "respond with a softer narrowing prompt"
 */
export function getHesitationPrompt(): string {
  const prompts = [
    'Take your time. Which one sounds closer to what you need?',
    'No rush — which one fits better?',
    "That's okay. Here are your options again:",
  ]
  return prompts[Math.floor(Math.random() * prompts.length)]
}
