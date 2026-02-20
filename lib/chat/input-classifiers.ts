/**
 * Input Classifiers (shared utility)
 *
 * Extracted from routing-dispatcher.ts to avoid circular dependency
 * when chat-routing.ts needs these classifiers.
 *
 * Per selection-intent-arbitration plan Step 5:
 * Unified isSelectionOnly with strict/embedded modes.
 * normalizeOrdinalTypos and ORDINAL_TARGETS moved here to break
 * circular dependency (routing-dispatcher.ts imports from this file).
 */

import { levenshteinDistance } from '@/lib/chat/typo-suggestions'
import { hasQuestionIntent } from '@/lib/chat/query-patterns'

// =============================================================================
// Explicit Command Detection
// =============================================================================

/**
 * Check if input is an explicit command (has action verb).
 * Used by Tier 2 to clear pending options before executing new commands.
 * Used by focus-latch bypass to prevent selection binding on commands (Rule 4).
 */
export function isExplicitCommand(input: string): boolean {
  const normalized = input.toLowerCase()

  // Phase 2b: Ordinal/number language bypass
  const hasOrdinal = /\b(first|second|third|fourth|fifth|last|[1-9])\b/i.test(normalized)
  if (hasOrdinal) {
    return false
  }

  // Action verbs that indicate a new command
  const actionVerbs = [
    'open', 'show', 'list', 'view', 'go', 'back', 'home',
    'create', 'rename', 'delete', 'remove',
  ]

  return actionVerbs.some(verb => normalized.includes(verb))
}

// =============================================================================
// Command Canonicalization (shared by Tier 2c + Tier 4)
// =============================================================================

/**
 * Canonicalize user input for command/noun matching.
 * Strips polite prefixes, leading articles, and trailing filler words.
 * Shared by Tier 2c (panel-command-matcher) and Tier 4 (known-noun-routing)
 * to prevent normalization drift across tiers.
 *
 * Design: minimal and deterministic — only strips known prefixes, articles,
 * and trailing filler. No broad conversational parsing.
 */
export function canonicalizeCommandInput(input: string): string {
  let normalized = input.toLowerCase().trim()

  // Strip trailing punctuation
  normalized = normalized.replace(/[?!.]+$/, '')

  // Strip polite/verb prefixes (longest first to avoid partial matches)
  const prefixes = [
    'hey can you please open ', 'hey can you please show ',
    'hey can you pls open ', 'hey can you pls show ',
    'hey can you open ', 'hey can you show ',
    'hey could you please open ', 'hey could you please show ',
    'hey could you pls open ', 'hey could you pls show ',
    'hey could you open ', 'hey could you show ',
    'hey can you please ', 'hey can you pls ',
    'hey could you please ', 'hey could you pls ',
    'can you please open ', 'can you please show ',
    'can you pls open ', 'can you pls show ',
    'can you please ', 'can you pls ',
    'could you please open ', 'could you please show ',
    'could you pls open ', 'could you pls show ',
    'could you please ', 'could you pls ',
    'would you please open ', 'would you please show ',
    'would you pls open ', 'would you pls show ',
    'would you please ', 'would you pls ',
    'can you open ', 'can you show ',
    'could you open ', 'could you show ',
    'would you open ', 'would you show ',
    'please open ', 'pls open ',
    'please show ', 'pls show ',
    'hey open ', 'hey show ', 'hey ',
    'open ', 'show ', 'view ', 'go to ', 'launch ',
  ]
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length).trim()
      break
    }
  }

  // Strip leading articles
  normalized = normalized.replace(/^(the|a|an)\s+/i, '').trim()

  // Strip trailing politeness/filler
  normalized = normalized.replace(/\s+(pls|please|plz|thanks|thx|now)$/i, '').trim()

  // Normalize whitespace
  return normalized.replace(/\s+/g, ' ').trim()
}

// =============================================================================
// Ordinal Normalization
// =============================================================================

/** Canonical ordinals for per-token fuzzy matching. */
export const ORDINAL_TARGETS = ['first', 'second', 'third', 'fourth', 'fifth', 'last']

/**
 * Normalize ordinal typos before selection matching.
 * Handles repeated letters, common misspellings, and concatenated ordinals.
 *
 * Examples:
 * - "ffirst" → "first" (repeated letters)
 * - "sedond" → "second" (common misspelling)
 * - "secondoption" → "second option" (concatenation)
 * - "firstoption" → "first option" (concatenation)
 */
export function normalizeOrdinalTypos(input: string): string {
  let n = input.toLowerCase().trim()

  // Strip polite suffixes
  n = n.replace(/\s*(pls|plz|please|thx|thanks|ty)\.?$/i, '').trim()

  // Deduplicate repeated letters: "ffirst" → "first", "seecond" → "second"
  n = n.replace(/(.)\1+/g, '$1')

  // Split concatenated ordinal+option: "secondoption" → "second option"
  n = n.replace(/^(first|second|third|fourth|fifth|last)(option|one)$/i, '$1 $2')

  // Per-token fuzzy match against canonical ordinals (distance ≤ 2, token length ≥ 4).
  // Catches typos like "sesecond" → "second", "scond" → "second", "thrid" → "third".
  const tokens = n.split(/\s+/)
  const normalized = tokens.map(token => {
    if (token.length < 4) return token // Guard: skip short tokens to avoid "for"→"fourth"
    // Skip tokens that are already canonical ordinals
    if (ORDINAL_TARGETS.includes(token)) return token

    let bestOrdinal: string | null = null
    let bestDist = Infinity
    for (const ordinal of ORDINAL_TARGETS) {
      const dist = levenshteinDistance(token, ordinal)
      if (dist > 0 && dist <= 2 && dist < bestDist) {
        bestDist = dist
        bestOrdinal = ordinal
      }
    }
    return bestOrdinal ?? token
  }).join(' ')

  return normalized
}

// =============================================================================
// Unified Selection Parser
// =============================================================================

/**
 * Extract ordinal from any phrase that contains ordinal tokens.
 * Used by 'embedded' mode for long-tail phrasing.
 *
 * Examples:
 * - "the first option" → 0
 * - "I pick the first" → 0
 * - "go with the second" → 1
 * - "I choose the second one" → 1
 * - "pick number two" → 1
 * - "option 2 please" → 1
 */
function extractOrdinalFromPhrase(input: string, optionCount: number): number | undefined {
  // Word-based ordinal patterns (match anywhere in phrase)
  const wordOrdinals: Array<{ pattern: RegExp; index: number | 'last' }> = [
    { pattern: /\bfirst\b/i, index: 0 },
    { pattern: /\b1st\b/i, index: 0 },
    { pattern: /\bsecond\b/i, index: 1 },
    { pattern: /\b2nd\b/i, index: 1 },
    { pattern: /\bthird\b/i, index: 2 },
    { pattern: /\b3rd\b/i, index: 2 },
    { pattern: /\bfourth\b/i, index: 3 },
    { pattern: /\b4th\b/i, index: 3 },
    { pattern: /\bfifth\b/i, index: 4 },
    { pattern: /\b5th\b/i, index: 4 },
    { pattern: /\blast\b/i, index: 'last' },
    { pattern: /\bnumber\s+one\b/i, index: 0 },
    { pattern: /\bnumber\s+two\b/i, index: 1 },
    { pattern: /\bnumber\s+three\b/i, index: 2 },
  ]

  for (const { pattern, index: rawIndex } of wordOrdinals) {
    if (pattern.test(input)) {
      const resolvedIndex = rawIndex === 'last' ? optionCount - 1 : rawIndex
      if (resolvedIndex >= 0 && resolvedIndex < optionCount) {
        return resolvedIndex
      }
    }
  }

  // Numeric extraction: "option 2", "pick 1", etc.
  // Only match standalone numbers 1-5 (to avoid false positives)
  if (optionCount <= 5) {
    const numericMatch = input.match(/\b([1-5])\b/)
    if (numericMatch) {
      const num = parseInt(numericMatch[1], 10)
      if (num >= 1 && num <= optionCount) {
        return num - 1
      }
    }
  }

  return undefined
}

/**
 * Unified selection-only parser with strict/embedded modes.
 *
 * - 'strict': Anchored regex — only pure ordinal patterns match.
 *   Used by Tier 3a primary/message-derived paths.
 * - 'embedded': Levenshtein + extractOrdinalFromPhrase — catches long-tail phrasing.
 *   Used by chat-routing.ts and looksLikeNewCommand negative test (line 2335).
 */
export function isSelectionOnly(
  input: string,
  optionCount: number,
  optionLabels: string[],
  mode: 'strict' | 'embedded'
): { isSelection: boolean; index?: number } {
  if (mode === 'strict') {
    return isSelectionOnlyStrict(input, optionCount, optionLabels)
  }
  return isSelectionOnlyEmbedded(input, optionCount, optionLabels)
}

// -------------- strict mode (anchored regex) --------------

function isSelectionOnlyStrict(
  input: string,
  optionCount: number,
  optionLabels: string[]
): { isSelection: boolean; index?: number } {
  const normalized = normalizeOrdinalTypos(input)

  const selectionPattern = /^(first|second|third|fourth|fifth|last|[1-9]|option\s*[1-9]|the\s+(first|second|third|fourth|fifth|last)\s+(one|option)|first\s+option|second\s+option|third\s+option|fourth\s+option|fifth\s+option|[a-e])$/i

  if (!selectionPattern.test(normalized)) {
    return { isSelection: false }
  }

  const ordinalMap: Record<string, number> = {
    'first': 0, '1': 0, 'option 1': 0, 'the first one': 0, 'the first option': 0, 'first option': 0, 'a': 0,
    'second': 1, '2': 1, 'option 2': 1, 'the second one': 1, 'the second option': 1, 'second option': 1, 'b': 1,
    'third': 2, '3': 2, 'option 3': 2, 'the third one': 2, 'the third option': 2, 'third option': 2, 'c': 2,
    'fourth': 3, '4': 3, 'option 4': 3, 'the fourth one': 3, 'the fourth option': 3, 'fourth option': 3, 'd': 3,
    'fifth': 4, '5': 4, 'option 5': 4, 'the fifth one': 4, 'the fifth option': 4, 'fifth option': 4, 'e': 4,
  }

  // Handle "last"
  if (normalized === 'last' || normalized === 'the last one' || normalized === 'the last option') {
    const index = optionCount - 1
    if (index >= 0) {
      return { isSelection: true, index }
    }
    return { isSelection: false }
  }

  // For single letters, check if option labels contain that letter badge
  if (/^[a-e]$/.test(normalized) && optionLabels.length > 0) {
    const letterUpper = normalized.toUpperCase()
    const matchIndex = optionLabels.findIndex(label =>
      label.toUpperCase().includes(letterUpper) ||
      label.toUpperCase().endsWith(` ${letterUpper}`)
    )
    if (matchIndex >= 0) {
      return { isSelection: true, index: matchIndex }
    }
    return { isSelection: false }
  }

  const index = ordinalMap[normalized]
  if (index !== undefined && index < optionCount) {
    return { isSelection: true, index }
  }

  return { isSelection: false }
}

// -------------- embedded mode (Levenshtein + phrase extraction) --------------

function isSelectionOnlyEmbedded(
  input: string,
  optionCount: number,
  optionLabels: string[]
): { isSelection: boolean; index?: number } {
  // Normalize: strip polite suffixes, fix typos, split concatenations
  let normalized = input.trim().toLowerCase()
  normalized = normalized.replace(/\s*(pls|plz|please|thx|thanks|ty)\.?$/i, '').trim()
  // Deduplicate repeated letters: "ffirst" → "first", "seecond" → "second"
  normalized = normalized.replace(/(.)\1+/g, '$1')
  // Split concatenated ordinal+option: "secondoption" → "second option"
  normalized = normalized.replace(/^(first|second|third|fourth|fifth|last)(option|one)$/i, '$1 $2')
  // Per-token fuzzy match against canonical ordinals (distance ≤ 2, token length ≥ 4).
  normalized = normalized.split(/\s+/).map(token => {
    if (token.length < 4) return token
    if (ORDINAL_TARGETS.includes(token)) return token
    let bestOrdinal: string | null = null
    let bestDist = Infinity
    for (const ordinal of ORDINAL_TARGETS) {
      const dist = levenshteinDistance(token, ordinal)
      if (dist > 0 && dist <= 2 && dist < bestDist) {
        bestDist = dist
        bestOrdinal = ordinal
      }
    }
    return bestOrdinal ?? token
  }).join(' ')

  // Map input to index
  let index: number | undefined

  // Static ordinal map (includes typos and variations)
  const ordinalMap: Record<string, number> = {
    // Basic ordinals
    'first': 0, 'second': 1, 'third': 2, 'fourth': 3, 'fifth': 4,
    '1st': 0, '2nd': 1, '3rd': 2, '4th': 3, '5th': 4,
    // Word numbers
    'one': 0, 'two': 1, 'three': 2, 'four': 3, 'five': 4,
    'number one': 0, 'number two': 1, 'number three': 2, 'number four': 3, 'number five': 4,
    'num one': 0, 'num two': 1, 'num 1': 0, 'num 2': 1,
    // Phrases
    'the first': 0, 'the second': 1, 'the third': 2, 'the fourth': 3, 'the fifth': 4,
    'the first one': 0, 'the second one': 1, 'the third one': 2,
    'the fourth one': 3, 'the fifth one': 4,
    // Common typos (after dedup normalization, "ffirst"→"first" is already handled)
    'frist': 0, 'fisrt': 0, 'frst': 0,
    'sedond': 1, 'secnd': 1, 'secon': 1, 'scond': 1, 'secod': 1, 'sceond': 1,
    'thrid': 2, 'tird': 2,
    'foruth': 3, 'fouth': 3,
    'fith': 4, 'fifht': 4,
    '2n': 1, '1s': 0, '3r': 2,
    // Last
    'last': optionCount - 1, 'the last': optionCount - 1, 'the last one': optionCount - 1,
  }

  // Check static map first
  if (ordinalMap[normalized] !== undefined) {
    index = ordinalMap[normalized]
  }
  // Numeric: "1", "2", etc.
  else if (/^[1-9]$/.test(normalized)) {
    index = parseInt(normalized, 10) - 1
  }
  // Option phrases: "option 1", "option 2"
  else if (/^option\s*[1-9]$/i.test(normalized)) {
    const num = normalized.match(/[1-9]/)?.[0]
    if (num) index = parseInt(num, 10) - 1
  }
  // Single letters: "a", "b", "c", "d", "e"
  else if (/^[a-e]$/i.test(normalized)) {
    index = normalized.charCodeAt(0) - 'a'.charCodeAt(0)
    if (index >= optionCount) {
      return { isSelection: false }
    }
  }
  // Positional: "top", "bottom", "upper", "lower"
  else if (/^(top|upper|first one|top one)$/.test(normalized)) {
    index = 0
  }
  else if (/^(bottom|lower|last one|bottom one)$/.test(normalized)) {
    index = optionCount - 1
  }
  // "the other one" (only valid when exactly 2 options)
  else if (/^(the other one|the other|other one|other)$/.test(normalized) && optionCount === 2) {
    // Ambiguous without context, but conventionally means "not the first" = second
    index = 1
  }

  // =========================================================================
  // Ordinal Extraction Rule (per clarification-llm-last-resort-plan.md)
  // Extract ordinals from ANY phrase, not only exact matches.
  // =========================================================================
  if (index === undefined) {
    const extractedIndex = extractOrdinalFromPhrase(normalized, optionCount)
    if (extractedIndex !== undefined) {
      index = extractedIndex
    }
  }

  // Validate index is within bounds
  if (index !== undefined && index >= 0 && index < optionCount) {
    return { isSelection: true, index }
  }

  return { isSelection: false }
}

// =============================================================================
// Scope-Cue Classifier
// =============================================================================

/**
 * Result of scope-cue classification.
 * scope: 'chat' means user explicitly wants to target chat options.
 * scope: 'widget' means user explicitly wants to target a widget context.
 * scope: 'dashboard' means user explicitly wants to target dashboard context.
 * scope: 'workspace' means user explicitly wants to target workspace context.
 * scope: 'none' means no explicit scope cue detected.
 */
export interface ScopeCueResult {
  scope: 'chat' | 'widget' | 'dashboard' | 'workspace' | 'none'
  cueText: string | null
  confidence: 'high' | 'none'
}

/**
 * Detect explicit scope cues in user input.
 * Per scope-cues-addendum-plan.md + context-enrichment-retry-loop-plan.md §Explicit Scope Cue Matrix.
 *
 * Multi-cue precedence: chat → widget → dashboard → workspace.
 * If input contains multiple cues, first match in evaluation order wins
 * (sequential early-returns). This is deterministic regardless of cue position in the string.
 *
 * Chat cue families (longest match first to avoid partial matches):
 * - "back to options", "from earlier options", "from chat options"
 * - "from the chat", "from chat", "in chat"
 */
export function resolveScopeCue(input: string): ScopeCueResult {
  const normalized = input.toLowerCase().trim()

  // --- Chat cues (highest precedence) — longest match first ---
  const CHAT_CUE_PATTERN = /\b(back to options|from earlier options|from chat options?|from the chat|from chat|in chat)\b/i
  const chatMatch = normalized.match(CHAT_CUE_PATTERN)
  if (chatMatch) {
    return { scope: 'chat', cueText: chatMatch[0], confidence: 'high' }
  }

  // --- Widget cues ---
  const WIDGET_CUE_PATTERN = /\b(from links panel\s*[a-z]?|from recent|from active widget|from the widget)\b/i
  const widgetMatch = normalized.match(WIDGET_CUE_PATTERN)
  if (widgetMatch) {
    return { scope: 'widget', cueText: widgetMatch[0], confidence: 'high' }
  }

  // --- Dashboard cues ---
  const DASHBOARD_CUE_PATTERN = /\b(from dashboard|in dashboard|from active dashboard|from the dashboard)\b/i
  const dashboardMatch = normalized.match(DASHBOARD_CUE_PATTERN)
  if (dashboardMatch) {
    return { scope: 'dashboard', cueText: dashboardMatch[0], confidence: 'high' }
  }

  // --- Workspace cues ---
  const WORKSPACE_CUE_PATTERN = /\b(from workspace|in workspace|from active workspace|from the workspace)\b/i
  const workspaceMatch = normalized.match(WORKSPACE_CUE_PATTERN)
  if (workspaceMatch) {
    return { scope: 'workspace', cueText: workspaceMatch[0], confidence: 'high' }
  }

  return { scope: 'none', cueText: null, confidence: 'none' }
}

// =============================================================================
// Arbitration Confidence Classification
// Per deterministic-llm-arbitration-fallback-plan.md §18-38 (Confidence Contract):
// Define confidence once in one shared function — no per-tier reinterpretation.
// =============================================================================

export type ConfidenceBucket =
  | 'high_confidence_execute'
  | 'low_confidence_llm_eligible'
  | 'low_confidence_clarifier_only'

export type AmbiguityReason =
  | 'multi_match_no_exact_winner'
  | 'cross_source_tie'
  | 'typo_ambiguous'
  | 'command_selection_collision'
  | 'no_candidate'
  | 'no_deterministic_match'

export interface ArbitrationConfidence {
  bucket: ConfidenceBucket
  ambiguityReason: AmbiguityReason | null
  candidates: { id: string; label: string; sublabel?: string }[]
}

/**
 * Classify the confidence of a deterministic arbitration result.
 * Single source of truth — all callers use the same classification logic.
 *
 * Returns a bucket (high/low-llm/low-clarifier) and an ambiguity reason.
 */
export function classifyArbitrationConfidence(params: {
  matchCount: number
  exactMatchCount: number
  inputIsExplicitCommand: boolean
  isNewQuestionOrCommandDetected: boolean
  candidates: { id: string; label: string; sublabel?: string }[]
  hasActiveOptionContext?: boolean
}): ArbitrationConfidence {
  const {
    matchCount, exactMatchCount,
    inputIsExplicitCommand, isNewQuestionOrCommandDetected,
    candidates,
    hasActiveOptionContext = false,
  } = params

  // No candidates at all → clarifier only (nothing to resolve)
  if (matchCount === 0) {
    // Scoped: only LLM-eligible when caller explicitly signals active-option context
    if (hasActiveOptionContext && candidates.length > 0) {
      return { bucket: 'low_confidence_llm_eligible', ambiguityReason: 'no_deterministic_match', candidates }
    }
    return { bucket: 'low_confidence_clarifier_only', ambiguityReason: 'no_candidate', candidates }
  }

  // Unique match → high confidence
  if (matchCount === 1) {
    return { bucket: 'high_confidence_execute', ambiguityReason: null, candidates }
  }

  // Exact winner among multi-match → high confidence
  if (exactMatchCount === 1) {
    return { bucket: 'high_confidence_execute', ambiguityReason: null, candidates }
  }

  // Multi-match with no exact winner:
  // Selection-vs-command collision: command intent + active options without unique winner
  if (inputIsExplicitCommand || isNewQuestionOrCommandDetected) {
    return {
      bucket: 'low_confidence_llm_eligible',
      ambiguityReason: 'command_selection_collision',
      candidates,
    }
  }

  // General multi-match without exact winner
  return {
    bucket: 'low_confidence_llm_eligible',
    ambiguityReason: 'multi_match_no_exact_winner',
    candidates,
  }
}

// =============================================================================
// Phase 10: Semantic Answer Lane Detector
// =============================================================================

/**
 * Pattern for imperative-form semantic triggers that hasQuestionIntent misses.
 * Catches "summarize my session", "recap what we did", etc.
 */
const SEMANTIC_LANE_PATTERN = /\b(why did|explain|what (just )?happened|what was that|summarize|recap|what have i been doing|what did we do|my (recent )?activity|my session)\b/i

/**
 * Detect semantic question/imperative inputs for the semantic answer lane.
 * Catches both question-form ("why did I do that?") and imperative-form ("summarize my session").
 * Excludes command-like and selection-like inputs to avoid false positives on mixed prompts.
 */
export function isSemanticQuestionInput(
  input: string,
  optionCount?: number,
  optionLabels?: string[],
): boolean {
  // Exclude command-like inputs ("open X and explain why")
  if (isExplicitCommand(input)) return false
  // Exclude selection-like inputs ("2", "bottom")
  // isSelectionOnly signature: (input, optionCount, optionLabels, mode) → { isSelection, index? }
  const sel = isSelectionOnly(input, optionCount ?? 0, optionLabels ?? [], 'strict')
  if (sel.isSelection) return false

  return hasQuestionIntent(input) || SEMANTIC_LANE_PATTERN.test(input)
}
