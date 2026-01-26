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
 * Attempt 1: "I didn't catch that. Reply first or second..." (per Example 5)
 * Attempt 2: "Which one is closer?" + exit pills
 * Attempt 3+: guidance + ask for 3–6 word description + exit pills
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
      showExits: true,
    }
  }

  // Attempt 1: Use consistent unparseable prompt per Example 5
  // "I didn't catch that. Reply first or second, or say 'none of these'..."
  return {
    content: 'I didn\'t catch that. Reply **first** or **second**, or say **"none of these"** (or **"none of those"**), or tell me one detail.',
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
 * Check if input is an explicit exit phrase.
 * Per plan: "cancel / never mind / stop / forget it"
 *
 * NOTE: "no" by itself is NOT an exit - it's handled separately as rejection/repair.
 * NOTE: "none of these/those" is NOT an exit - it triggers Refine Mode (list rejection).
 *
 * Only explicit exits clear clarification completely.
 */
export function isExitPhrase(input: string): boolean {
  const normalizedInput = input.toLowerCase().trim()

  // First check if it's a list rejection (NOT an exit)
  if (isListRejectionPhrase(normalizedInput)) {
    return false
  }

  const exitPhrases = [
    'cancel', 'never mind', 'nevermind', 'stop',
    'forget it', 'start over', 'exit',
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
 * Updated per clarification-offmenu-handling-plan.md consistent template.
 */
export function getHesitationPrompt(): string {
  return '**Which one do you mean — or** if neither looks right, say **"none of these"** (or **"none of those"**) or tell me one detail (where it is / what it\'s called).'
}

// =============================================================================
// Consistent Prompt Templates (per clarification-offmenu-handling-plan.md)
// =============================================================================

/**
 * Base prompt template for showing options.
 * Per plan: "Which one do you mean — or if neither looks right, say 'none of these' or tell me one detail"
 */
export function getBasePrompt(): string {
  return '**Which one do you mean — or** if neither looks right, say **"none of these"** (or **"none of those"**) or tell me one detail (where it is / what it\'s called).'
}

/**
 * Prompt after "not that" (item-level repair).
 * Per plan: "Okay — not that one. Which one do you mean instead..."
 */
export function getRepairPrompt(): string {
  return 'Okay — not that one. **Which one do you mean instead — or** say **"none of these"** (or **"none of those"**) or tell me what it\'s called.'
}

/**
 * Prompt after "no" (ambiguous refusal).
 * Per plan: "No problem. Which one do you mean..."
 */
export function getNoRefusalPrompt(): string {
  return 'No problem. **Which one do you mean — or** say **"none of these"** (or **"none of those"**) or tell me where it is (Docs or Notes).'
}

/**
 * Prompt after 2+ unparseable replies (escalation).
 * Per plan: "I didn't catch that. Reply first or second..."
 */
export function getUnparseablePrompt(): string {
  return 'I didn\'t catch that. Reply **first** or **second**, or say **"none of these"** (or **"none of those"**), or tell me one detail.'
}

/**
 * Refine Mode prompt after list rejection ("none of those").
 * Per plan: "Got it. Tell me one detail (exact name or where it lives) — or I can show more results."
 */
export function getRefinePrompt(): string {
  return 'Got it. Tell me one detail (exact name or where it lives) — or I can show more results.'
}

// =============================================================================
// List Rejection Detection (separate from exit)
// =============================================================================

// =============================================================================
// Noise Detection (per clarification-response-fit-plan.md)
// =============================================================================

/**
 * Check if input is noise/gibberish that should trigger re-prompt.
 * Per clarification-response-fit-plan.md Section 3) Noise Definition:
 * - alphabetic ratio < 50%
 * - token count == 1 and token length < 3
 * - contains no vowel (a/e/i/o/u) AND is keyboard smash pattern
 * - emoji-only / keyboard smash
 *
 * Noise should never trigger selection or zero-overlap escape.
 *
 * IMPORTANT: This function should NOT classify valid hesitation phrases
 * or short hints as noise - those are handled by other tiers.
 */
export function isNoise(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return true

  const normalized = trimmed.toLowerCase()

  // Known valid patterns that should NOT be noise (hesitations, short hints)
  // These are handled by other tiers
  const validPatterns = [
    // Hesitation sounds (handled by isHesitationPhrase)
    /^h+m+$/i,
    /^u+[hm]+$/i,
    /^idk$/i,
    /^hmm+$/i,
    /^umm+$/i,
    /^hm+$/i,
    // Short valid words/abbreviations (handled as hints)
    /^sdk$/i,
    /^api$/i,
    /^css$/i,
    /^dns$/i,
  ]

  for (const pattern of validPatterns) {
    if (pattern.test(normalized)) {
      return false
    }
  }

  // Check for emoji-only (common emoji patterns)
  const emojiOnlyPattern = /^[\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Modifier_Base}\p{Emoji_Component}\s]+$/u
  if (emojiOnlyPattern.test(trimmed)) {
    return true
  }

  // Calculate alphabetic ratio
  const alphaChars = (trimmed.match(/[a-zA-Z]/g) || []).length
  const totalChars = trimmed.replace(/\s/g, '').length
  const alphabeticRatio = totalChars > 0 ? alphaChars / totalChars : 0

  // alphabetic ratio < 50%
  if (alphabeticRatio < 0.5) {
    return true
  }

  // Get tokens for further checks
  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean)

  // token count == 1 and token length < 3
  if (tokens.length === 1 && tokens[0].length < 3) {
    return true
  }

  // Keyboard smash patterns (random consonants, common smash sequences)
  // Only flag as noise if it's clearly keyboard mashing, not valid words
  const keyboardSmashPatterns = [
    /^[asdfghjkl]+$/i,           // Home row smash (only consonants)
    /^[zxcvbnm]+$/i,             // Bottom row smash (only consonants)
    /^(.)\1{3,}$/i,              // Same char repeated 4+ times
    /^[bcdfghjklmnpqrstvwxyz]{5,}$/i,  // 5+ consonants in a row
  ]

  const strippedInput = trimmed.replace(/\s/g, '')
  for (const pattern of keyboardSmashPatterns) {
    if (pattern.test(strippedInput)) {
      return true
    }
  }

  return false
}

/**
 * Get the unparseable prompt for noise input.
 * Per clarification-response-fit-plan.md: re-prompt with standard clarification template.
 */
export function getNoisePrompt(): string {
  return 'I didn\'t catch that. Reply **first** or **second**, or say **"none of these"** (or **"none of those"**), or tell me one detail.'
}

// =============================================================================
// Response-Fit Classifier (per clarification-response-fit-plan.md)
// =============================================================================

/**
 * Response-Fit classification result.
 * Per plan: intent + optional choiceId + confidence.
 */
export interface ResponseFitResult {
  intent: 'select' | 'repair' | 'reject_list' | 'hesitate' | 'new_topic' | 'noise' | 'ask_clarify' | 'soft_reject'
  /** Choice ID when intent is 'select' or 'repair' */
  choiceId?: string
  /** Confidence score 0.0-1.0 */
  confidence: number
  /** Reason for the classification */
  reason: string
  /** Matched option (if any) */
  matchedOption?: ClarificationOption
}

/**
 * Confidence thresholds per clarification-response-fit-plan.md §4.
 */
export const CONFIDENCE_THRESHOLD_EXECUTE = 0.75
export const CONFIDENCE_THRESHOLD_CONFIRM = 0.55

/**
 * Get ask-clarify prompt for short hints.
 * Per plan: "Are you looking for X? If yes, choose A; if not, choose B."
 */
export function getAskClarifyPrompt(hintTokens: string[]): string {
  const hint = hintTokens.join(' ')
  return `I'm not sure which one you mean by "${hint}". Could you pick one of the options, or tell me more?`
}

/**
 * Get soft-reject prompt for ambiguous near-matches.
 * Per plan: "Did you mean {Option A}, or would you like to try again?"
 */
export function getSoftRejectPrompt(candidateLabels: string[]): string {
  if (candidateLabels.length === 1) {
    return `Did you mean **${candidateLabels[0]}**? Pick it below, or say "none of these" if that's not it.`
  }
  if (candidateLabels.length === 2) {
    return `Do you mean **${candidateLabels[0]}** or **${candidateLabels[1]}**? Pick one below.`
  }
  return `Which one did you mean? Pick from the options below, or say "none of these".`
}

/**
 * Get confirm prompt for medium-confidence matches.
 * Per plan: "Do you mean X?" (confidence 0.55-0.75)
 */
export function getConfirmPrompt(label: string): string {
  return `Do you mean **${label}**? Pick it below to confirm, or choose a different option.`
}

/**
 * Classify user input using Response-Fit logic.
 * Per clarification-response-fit-plan.md:
 * - Short hint (≤2 tokens) → ask_clarify
 * - Near-match but ambiguous → soft_reject
 * - Clear command + non-overlapping tokens → new_topic
 * - Mapped with confidence → apply ladder
 *
 * @param input - User input
 * @param options - Current clarification options
 * @param clarificationType - Type of clarification context
 * @returns Classification result with intent, confidence, and optional choiceId
 */
export function classifyResponseFit(
  input: string,
  options: ClarificationOption[],
  clarificationType: ClarificationType
): ResponseFitResult {
  if (!options || options.length === 0) {
    return { intent: 'ask_clarify', confidence: 0, reason: 'no_options' }
  }

  const inputTokens = toCanonicalTokens(input)

  // Short hint (≤2 meaningful tokens) → ask_clarify
  // Per plan §3.1: "If input is short hint (≤2 tokens) → ask_clarify"
  // Skip this check if we have an exact label match
  const normalizedInput = input.toLowerCase().trim()
  const hasExactMatch = options.some(opt => opt.label.toLowerCase() === normalizedInput)

  if (!hasExactMatch && inputTokens.size <= 2 && inputTokens.size > 0) {
    // Check if it's a partial match (could relate to options but not specific enough)
    const allOptionTokens = new Set<string>()
    for (const opt of options) {
      for (const t of getLabelAliasTokens(opt.label)) {
        allOptionTokens.add(t)
      }
    }

    // If some tokens overlap but not all → could be a hint
    let overlappingCount = 0
    for (const t of inputTokens) {
      if (allOptionTokens.has(t)) overlappingCount++
    }

    if (overlappingCount > 0 && overlappingCount < inputTokens.size) {
      // Partial overlap - ambiguous hint
      return {
        intent: 'ask_clarify',
        confidence: 0.3,
        reason: 'short_hint_partial_overlap',
      }
    }

    if (overlappingCount === 0) {
      // No overlap at all - might be a new topic or just unclear
      return {
        intent: 'ask_clarify',
        confidence: 0.2,
        reason: 'short_hint_no_overlap',
      }
    }
  }

  // Call mapOffMenuInput for token-based matching
  const offMenuResult = mapOffMenuInput(input, options, clarificationType)

  // Handle mapped result with confidence ladder
  if (offMenuResult.type === 'mapped' && offMenuResult.matchedOption) {
    // Convert off-menu confidence to numeric score
    const confidenceScore = offMenuResult.confidence === 'high' ? 0.85
      : offMenuResult.confidence === 'medium' ? 0.65
      : 0.45

    return {
      intent: 'select',
      choiceId: offMenuResult.matchedOption.id,
      confidence: confidenceScore,
      reason: `mapped_${offMenuResult.reason}`,
      matchedOption: offMenuResult.matchedOption,
    }
  }

  // Handle ambiguous result → soft_reject
  if (offMenuResult.type === 'ambiguous') {
    // Find candidate options that partially match
    const candidates: ClarificationOption[] = []
    for (const opt of options) {
      const labelTokens = getLabelAliasTokens(opt.label)
      let matchCount = 0
      for (const t of inputTokens) {
        if (labelTokens.has(t)) matchCount++
      }
      if (matchCount > 0) {
        candidates.push(opt)
      }
    }

    return {
      intent: 'soft_reject',
      confidence: 0.4,
      reason: 'ambiguous_multiple_matches',
      matchedOption: candidates.length > 0 ? candidates[0] : undefined,
    }
  }

  // No match - check for new topic
  const newTopicResult = detectNewTopic(input, options, offMenuResult)
  if (newTopicResult.isNewTopic) {
    return {
      intent: 'new_topic',
      confidence: 0.8,
      reason: `new_topic_${newTopicResult.reason}`,
    }
  }

  // No match and not a new topic → ask_clarify
  return {
    intent: 'ask_clarify',
    confidence: 0.2,
    reason: 'no_match_no_new_topic',
  }
}

// =============================================================================
// List Rejection Detection (separate from exit)
// =============================================================================

/**
 * Check if input is a list rejection phrase (rejects the whole list, not just one item).
 * Per clarification-offmenu-handling-plan.md (E):
 * - "none of these", "none of those", "neither" → refine prompt (NOT exit)
 *
 * This is DIFFERENT from exit phrases - list rejection keeps the same intent
 * but asks for more details.
 *
 * Uses exact match (after stripping trailing politeness words) to avoid
 * capturing compound inputs like "none of those, open dashboard" which
 * should fall through to topic detection instead.
 */
export function isListRejectionPhrase(input: string): boolean {
  const normalized = input.toLowerCase().trim()

  // Strip trailing politeness words before matching
  // This allows "none of those please" to match while "none of those, open dashboard" falls through
  const stripped = normalized.replace(/[,.]?\s*(please|thanks|thank you|pls|thx)$/i, '').trim()

  const listRejectionPhrases = [
    'none of these',
    'none of those',
    'neither',
    'neither of these',
    'neither of those',
    'not these',
    'not those',
    'none of them',
    'neither one',
    'neither option',
  ]

  return listRejectionPhrases.includes(stripped)
}
