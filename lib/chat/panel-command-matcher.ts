/**
 * Panel Command Matcher
 * Part of: Panel-Aware Command Routing Plan
 *
 * Context-aware matching for panel commands using visible widgets.
 * Replaces hardcoded patterns in isCommandLike() with dynamic matching.
 *
 * Matching rules:
 * - Normalize: lowercase → strip punctuation → remove stopwords → token set
 * - Fuzzy correction: typos within edit distance 2 are corrected (e.g., "limk" → "links")
 * - Repeated letter normalization: "llink" → "link", "opwn" → "open"
 * - Exact match: all title tokens present in input
 * - Partial match: all input tokens present in title (for disambiguation)
 * - Trailing politeness words (pls, please, thanks) are ignored
 */

import { levenshteinDistance } from './typo-suggestions'
import { canonicalizeCommandInput } from './input-classifiers'

// =============================================================================
// Types
// =============================================================================

export interface VisibleWidget {
  id: string
  title: string
  type: string
}

export interface PanelMatchResult {
  /** Match type: 'exact' (full match), 'partial' (subset for disambiguation), 'none' */
  type: 'exact' | 'partial' | 'none'
  /** Matched widgets (may be multiple for disambiguation) */
  matches: VisibleWidget[]
}

// =============================================================================
// Stopwords
// =============================================================================

/**
 * Stopwords to remove during normalization.
 * Includes articles, possessives, and politeness words.
 *
 * NOTE: Panel/widget terms are normalized (singular/plural) instead of removed.
 */
const STOPWORDS = new Set([
  // Articles
  'a', 'an', 'the',
  // Possessives
  'my', 'your', 'our', 'their',
  // Politeness / filler
  'pls', 'please', 'plz', 'now', 'thanks', 'thank', 'thx',
])

/**
 * Known panel-related terms for fuzzy matching.
 * These are the canonical forms that typos should be corrected to.
 */
const KNOWN_PANEL_TERMS = new Set([
  // Panel/widget keywords
  'panel', 'panels', 'widget', 'widgets',
  'link', 'links', 'recent', 'demo',
  // Action verbs
  'open', 'show', 'close', 'go', 'view',
])

/**
 * Maximum edit distance for fuzzy matching.
 * Distance 1-2 are acceptable for typo correction.
 */
const MAX_FUZZY_DISTANCE = 2

// =============================================================================
// Normalization
// =============================================================================

/**
 * Normalize repeated letters in a token.
 * E.g., "llink" → "link", "opwn" → "opwn" (no repeated letters)
 * Per plan §216-229: handles common typos like "llink", "ppanel"
 */
function normalizeRepeatedLetters(token: string): string {
  return token.replace(/(.)\1+/g, '$1')
}

/**
 * Find the best fuzzy match for a token against known panel terms.
 * Returns the matched term if within edit distance threshold, null otherwise.
 */
function findFuzzyPanelMatch(token: string): string | null {
  if (token.length < 3) return null // Too short for fuzzy matching

  let bestMatch: string | null = null
  let bestDistance = MAX_FUZZY_DISTANCE + 1

  for (const term of KNOWN_PANEL_TERMS) {
    const distance = levenshteinDistance(token, term)
    if (distance <= MAX_FUZZY_DISTANCE && distance < bestDistance) {
      bestDistance = distance
      bestMatch = term
    }
  }

  return bestMatch
}

/**
 * Normalize a string to a set of tokens for matching.
 * - Lowercase
 * - Strip punctuation
 * - Normalize repeated letters (e.g., "llink" → "link")
 * - Fuzzy match against known panel terms (e.g., "limk" → "links")
 * - Remove stopwords
 * - Return as Set (order-independent matching)
 */
function normalizeToTokenSet(s: string): Set<string> {
  const canonicalTokens: Record<string, string> = {
    panel: 'panel',
    panels: 'panel',
    widget: 'widget',
    widgets: 'widget',
    link: 'links',
    links: 'links',
  }
  const tokens = s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t && !STOPWORDS.has(t))
    .map(t => {
      // Step 1: Normalize repeated letters (e.g., "llink" → "link")
      const deduped = normalizeRepeatedLetters(t)

      // Step 2: Check canonical tokens first (exact match after dedup)
      if (canonicalTokens[deduped]) {
        return canonicalTokens[deduped]
      }

      // Step 3: Try fuzzy matching against known panel terms
      const fuzzyMatch = findFuzzyPanelMatch(deduped)
      if (fuzzyMatch) {
        // Apply canonical mapping to fuzzy match result
        return canonicalTokens[fuzzyMatch] ?? fuzzyMatch
      }

      // Step 4: Return original (possibly deduped) token
      return canonicalTokens[t] ?? deduped
    })
  return new Set(tokens)
}

/**
 * Check if setA is a subset of setB (all elements of A are in B).
 */
function isSubset(setA: Set<string>, setB: Set<string>): boolean {
  for (const item of setA) {
    if (!setB.has(item)) return false
  }
  return true
}

// =============================================================================
// Verb Prefix Stripping
// =============================================================================

/**
 * Strip leading action verb prefixes from user input before panel token matching.
 * Same verb set as known-noun-routing.ts normalizeForNounMatch.
 * Applied to input only (not panel titles) so Tier 2c sees the same tokens
 * regardless of whether the user typed "links panel" or "open links panel".
 *
 * Exported as a shared utility — both panel-command-matcher (Tier 2c) and
 * known-noun-routing (Tier 4) import from here to prevent drift.
 */
export function stripVerbPrefix(input: string): string {
  return canonicalizeCommandInput(input)
}

// =============================================================================
// Main Matcher
// =============================================================================

/**
 * Match user input against visible widget titles.
 *
 * Matching behavior:
 * - **Exact match**: All title tokens are in input (e.g., "links panel d pls" matches "Links Panel D")
 * - **Partial match**: All input tokens are in title (e.g., "links panel" matches "Links Panel D" and "Links Panel E")
 *
 * @param input - User input (e.g., "links panel d", "open recent", "links panel d pls")
 * @param visibleWidgets - Array of visible widgets with id, title, type
 * @returns Match result with type and matched widgets
 */
export function matchVisiblePanelCommand(
  input: string,
  visibleWidgets?: VisibleWidget[]
): PanelMatchResult {
  if (!visibleWidgets || visibleWidgets.length === 0) {
    return { type: 'none', matches: [] }
  }

  const inputTokens = normalizeToTokenSet(canonicalizeCommandInput(input))
  if (inputTokens.size === 0) {
    return { type: 'none', matches: [] }
  }

  const exactMatches: VisibleWidget[] = []
  const partialMatches: VisibleWidget[] = []

  for (const widget of visibleWidgets) {
    const titleTokens = normalizeToTokenSet(widget.title)
    if (titleTokens.size === 0) continue

    // Exact match: all title tokens are in input
    // "links panel d pls" contains all tokens of "Links Panel D" → exact match
    if (isSubset(titleTokens, inputTokens)) {
      exactMatches.push(widget)
    }
    // Partial match: all input tokens are in title
    // "links panel" tokens are all in "Links Panel D" → partial match (for disambiguation)
    else if (isSubset(inputTokens, titleTokens)) {
      partialMatches.push(widget)
    }
  }

  // ==========================================================================
  // Disambiguation Logic Fix:
  // If we have BOTH exact matches AND partial matches, the input is ambiguous.
  // Example: "links panel" matches "Links Panels" (exact) but also matches
  // "Links Panel D" and "Links Panel E" (partial). User should disambiguate.
  // ==========================================================================

  // If there are partial matches, include exact matches in disambiguation
  if (partialMatches.length > 0) {
    const allMatches = [...exactMatches, ...partialMatches]
    return { type: 'partial', matches: allMatches }
  }

  // Only return exact if there are NO partial matches (unambiguous)
  if (exactMatches.length > 0) {
    return { type: 'exact', matches: exactMatches }
  }

  return { type: 'none', matches: [] }
}

/**
 * Quick check: does input match any visible panel?
 * Used for early skip in cross-corpus handler.
 *
 * @param input - User input
 * @param visibleWidgets - Array of visible widgets
 * @returns true if input matches any panel (exact or partial)
 */
export function inputMatchesVisiblePanel(
  input: string,
  visibleWidgets?: VisibleWidget[]
): boolean {
  const result = matchVisiblePanelCommand(input, visibleWidgets)
  return result.type !== 'none'
}
