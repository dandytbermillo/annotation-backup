/**
 * Panel Command Matcher
 * Part of: Panel-Aware Command Routing Plan
 *
 * Context-aware matching for panel commands using visible widgets.
 * Replaces hardcoded patterns in isCommandLike() with dynamic matching.
 *
 * Matching rules:
 * - Normalize: lowercase → strip punctuation → remove stopwords → token set
 * - Exact match: all title tokens present in input
 * - Partial match: all input tokens present in title (for disambiguation)
 * - Trailing politeness words (pls, please, thanks) are ignored
 */

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
 */
const STOPWORDS = new Set([
  // Articles
  'a', 'an', 'the',
  // Possessives
  'my', 'your', 'our', 'their',
  // Politeness / filler
  'pls', 'please', 'plz', 'now', 'thanks', 'thank', 'thx',
  // Common panel words (optional - keep if causes issues)
  'panel', 'widget',
])

// =============================================================================
// Normalization
// =============================================================================

/**
 * Normalize a string to a set of tokens for matching.
 * - Lowercase
 * - Strip punctuation
 * - Remove stopwords
 * - Return as Set (order-independent matching)
 */
function normalizeToTokenSet(s: string): Set<string> {
  const tokens = s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t && !STOPWORDS.has(t))
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
// Main Matcher
// =============================================================================

/**
 * Match user input against visible widget titles.
 *
 * Matching behavior:
 * - **Exact match**: All title tokens are in input (e.g., "link notes d pls" matches "Link Notes D")
 * - **Partial match**: All input tokens are in title (e.g., "link notes" matches "Link Notes D" and "Link Notes E")
 *
 * @param input - User input (e.g., "link notes d", "open recent", "link notes d pls")
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

  const inputTokens = normalizeToTokenSet(input)
  if (inputTokens.size === 0) {
    return { type: 'none', matches: [] }
  }

  const exactMatches: VisibleWidget[] = []
  const partialMatches: VisibleWidget[] = []

  for (const widget of visibleWidgets) {
    const titleTokens = normalizeToTokenSet(widget.title)
    if (titleTokens.size === 0) continue

    // Exact match: all title tokens are in input
    // "link notes d pls" contains all tokens of "Link Notes D" → exact match
    if (isSubset(titleTokens, inputTokens)) {
      exactMatches.push(widget)
    }
    // Partial match: all input tokens are in title
    // "link notes" tokens are all in "Link Notes D" → partial match (for disambiguation)
    else if (isSubset(inputTokens, titleTokens)) {
      partialMatches.push(widget)
    }
  }

  // Prefer exact matches
  if (exactMatches.length > 0) {
    return { type: 'exact', matches: exactMatches }
  }

  // Fall back to partial matches (disambiguation case)
  if (partialMatches.length > 0) {
    return { type: 'partial', matches: partialMatches }
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
