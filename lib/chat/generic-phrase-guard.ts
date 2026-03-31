/**
 * Shared Generic-Phrase Ambiguity Guard
 *
 * One function used by ALL execution lanes to determine if a panel-open
 * command is too generic/ambiguous to auto-execute.
 *
 * Design doc: surface-command-resolver-design.md:569-589
 * Rule: no panel-open path should execute a structurally generic ambiguous
 * phrase unless the target is sufficiently specific and validated.
 */

import { levenshteinDistance } from './typo-suggestions'

// =============================================================================
// Filler tokens (shared across all lanes)
// =============================================================================

export const PANEL_COMMAND_FILLER = new Set([
  // Action verbs
  'show', 'open', 'list', 'view', 'display', 'get', 'close',
  // Pronouns / helpers
  'can', 'you', 'me', 'i', 'to', 'do', 'just', 'want', 'would', 'could',
  // Greetings
  'hi', 'hello', 'hey', 'there',
  // Politeness / articles
  'pls', 'please', 'the', 'my', 'a',
  // Panel-related keywords (not content nouns)
  'panel', 'widget', 'drawer',
])

// =============================================================================
// Content token extraction
// =============================================================================

/**
 * Extract content tokens from raw input (non-filler tokens).
 * These are the meaningful nouns/qualifiers the user actually typed.
 */
export function extractContentTokens(rawInput: string): string[] {
  return rawInput
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 0 && !PANEL_COMMAND_FILLER.has(t))
}

// =============================================================================
// Stem-expanded bounded candidate builder
// =============================================================================

/** Visible widget shape expected by the stem matcher */
type VisibleWidget = { id: string; title: string; type?: string }

/**
 * Expand content tokens to singular/plural stems.
 * - "entries" → ["entries", "entry"]  (ies → y)
 * - "panels"  → ["panels", "panel"]  (trailing s)
 * - "recent"  → ["recent"]           (no expansion)
 */
export function expandStems(contentTokens: string[]): string[] {
  return contentTokens.flatMap(t => {
    const stems = [t]
    if (t.endsWith('ies')) stems.push(t.slice(0, -3) + 'y')
    else if (t.endsWith('s') && t.length > 2) stems.push(t.slice(0, -1))
    return stems
  })
}

/**
 * Build a stem-bounded candidate set from visible widgets.
 *
 * Returns widgets whose title contains any expanded stem of the input.
 * If stem matching yields 0 matches, returns empty array (caller decides fallback).
 * Never falls back to all visible widgets — that is the caller's choice.
 *
 * @param rawInput  - The user's raw message (e.g., "open entries")
 * @param widgets   - Visible widgets to filter
 * @returns Stem-matched widgets (may be empty, 1, or many)
 */
export function buildStemBoundedCandidates(
  rawInput: string,
  widgets: VisibleWidget[]
): VisibleWidget[] {
  const contentTokens = extractContentTokens(rawInput)
  const stems = expandStems(contentTokens)
  if (stems.length === 0) return []
  return widgets.filter(w =>
    stems.some(stem => w.title.toLowerCase().includes(stem))
  )
}

// =============================================================================
// Shared ambiguity check
// =============================================================================

/**
 * Check if a raw input is a generic ambiguous panel phrase that should
 * NOT auto-execute a panel open.
 *
 * Returns true when the input is too generic to safely execute:
 * - ≤ 1 content token after stripping filler
 * - No explicit panel qualifier (links panel, navigator, quick links, etc.)
 * - No surface-family evidence (recent, recently, typo-near-match)
 * - No instance label (single letter badge)
 *
 * Returns false (allows execution) when any of these are true:
 * - Explicit specific target: "open entry navigator c", "open links panel cc"
 * - Surface-family evidence: "open recent", "show recent widget entries"
 * - Explicit panel qualifier: "show links panel b", "show navigator"
 */
export function isGenericAmbiguousPanelPhrase(rawInput: string): boolean {
  const lower = rawInput.toLowerCase()

  // Has explicit panel qualifier → not generic
  if (/\b(links?\s*panel|navigator|quick\s*links|widget\s*manager)\b/i.test(lower)) {
    return false
  }

  // Has surface-family evidence (recent or typo-near-match) → not generic
  if (/\brecent(ly)?\b/.test(lower)) return false
  // Typo-tolerant near-match to "recent" (Levenshtein ≤ 2)
  const words = lower.split(/\s+/)
  for (const w of words) {
    if (w.length >= 4 && levenshteinDistance(w, 'recent') <= 2) return false
  }

  // Has instance label at end (single letter like "a", "b", "c") → not generic
  // e.g., "open links panel c" → last token "c" is a badge
  const tokens = lower.trim().split(/\s+/)
  const lastToken = tokens[tokens.length - 1]
  if (lastToken && lastToken.length === 1 && /[a-z]/.test(lastToken)) {
    return false
  }

  // Check content token count
  const contentTokens = extractContentTokens(rawInput)
  return contentTokens.length <= 1
}
