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
