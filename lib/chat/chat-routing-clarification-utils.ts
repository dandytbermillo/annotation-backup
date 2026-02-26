/**
 * Chat Routing — Clarification Utilities (Pure)
 *
 * Pure helper functions and constants extracted from
 * chat-routing-clarification-intercept.ts (PR3a).
 * No state dependencies — every export is a pure function or constant.
 *
 * @internal — Do not import directly outside lib/chat/.
 */

import type { SelectionOption, WorkspaceMatch, NoteMatch } from '@/lib/chat'
import type { ClarificationOption, PanelDrawerData, DocData } from '@/lib/chat/chat-navigation-context'
import type { EntryMatch } from '@/lib/chat/resolution-types'

// =============================================================================
// Snapshot Reconstruction
// =============================================================================

/**
 * Reconstruct the `data` payload for a ClarificationOption when selecting from
 * a snapshot (post-action ordinal/repair window). ClarificationOption doesn't
 * store data, so we build minimal-valid data from id/label/type.
 * Per plan §131-147 (Selection Persistence).
 */
export function reconstructSnapshotData(option: ClarificationOption): SelectionOption['data'] {
  switch (option.type) {
    case 'panel_drawer':
      return {
        panelId: option.id,
        panelTitle: option.label,
        panelType: 'default',
      } as PanelDrawerData
    case 'doc':
      return { docSlug: option.id } as DocData
    case 'note':
      return {
        id: option.id,
        title: option.label,
        noteId: option.id,
      } as NoteMatch
    case 'workspace':
      return {
        id: option.id,
        name: option.label,
        entryId: option.id,
        entryName: option.label,
        isDefault: false,
      } as WorkspaceMatch
    case 'entry':
      return {
        id: option.id,
        name: option.label,
        isSystem: false,
      } as EntryMatch
    default:
      // Fallback: use id-based doc data
      return { docSlug: option.id } as DocData
  }
}

// =============================================================================
// Label / Token Matching
// =============================================================================

/**
 * Check if label matches in input with word boundary.
 * e.g., "workspace 2" in "workspace 2 please" → true (followed by space)
 * e.g., "workspace 2" in "workspace 22" → false (followed by digit, not word boundary)
 */
export function matchesWithWordBoundary(input: string, label: string): boolean {
  if (!input.includes(label)) return false
  const index = input.indexOf(label)
  const endIndex = index + label.length
  // Label must end at word boundary (end of string or followed by space/punctuation)
  if (endIndex === input.length) return true
  const charAfter = input[endIndex]
  return /[\s,!?.]/.test(charAfter)
}

/**
 * Canonical token mapping for singular/plural normalization.
 * e.g., "links panels d" → tokens {links, panel, d} matches "Links Panel D" → {links, panel, d}
 * e.g., "link panels d" → tokens {links, panel, d} matches "Links Panel D"
 */
export const canonicalTokens: Record<string, string> = {
  panel: 'panel', panels: 'panel',
  widget: 'widget', widgets: 'widget',
  link: 'links', links: 'links',
}

/**
 * Tokenize + canonicalize a string for label matching.
 *
 * NOTE: This intentionally differs from the `toCanonicalTokens` in
 * clarification-offmenu which has different semantics (stopwords + micro-alias).
 * This version uses panel/widget singular-plural normalization for label matching.
 */
export function toCanonicalTokens(s: string): Set<string> {
  const tokens = s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean)
  return new Set(tokens.map(t => canonicalTokens[t] ?? t))
}

/**
 * Exact token-set match: all label tokens in input AND all input tokens in label.
 */
export function tokensMatch(inputTokens: Set<string>, labelTokens: Set<string>): boolean {
  if (inputTokens.size !== labelTokens.size) return false
  for (const t of inputTokens) {
    if (!labelTokens.has(t)) return false
  }
  return true
}

/**
 * Shared label matcher: checks if a candidate string matches ANY active option.
 * Used by scope-cue Phase 2b, the pre-gate (candidate-aware exception),
 * and Tier 1b.3 label matching. Single definition prevents semantic drift.
 *
 * Returns matching options (empty array = no match).
 */
export function findMatchingOptions(
  candidate: string,
  options: ClarificationOption[],
): ClarificationOption[] {
  const normalizedCandidate = candidate.toLowerCase().trim()
  if (!normalizedCandidate) return []
  return options.filter(opt => {
    const label = opt.label.toLowerCase().trim()
    // 1. Exact / substring / word-boundary match
    if (label === normalizedCandidate ||
        label.includes(normalizedCandidate) ||
        matchesWithWordBoundary(normalizedCandidate, label)) {
      return true
    }
    // 2. Canonical token matching (handles singular/plural)
    const inputTokens = toCanonicalTokens(normalizedCandidate)
    const labelTokens = toCanonicalTokens(label)
    return tokensMatch(inputTokens, labelTokens)
  })
}

/**
 * Exact-normalized matcher: finds options whose canonical tokens match the
 * candidate EXACTLY (same token set, no superset/subset).
 *
 * Per intra-selection precedence (exact-first) rule:
 * "open links panel" → {links, panel} matches "Links Panels" → {links, panel} exactly,
 * but NOT "Links Panel D" → {links, panel, d} (superset).
 *
 * Reuses toCanonicalTokens + tokensMatch — no new matching logic.
 */
export function findExactNormalizedMatches(
  candidate: string,
  options: ClarificationOption[],
): ClarificationOption[] {
  const normalizedCandidate = candidate.toLowerCase().trim()
  if (!normalizedCandidate) return []
  const inputTokens = toCanonicalTokens(normalizedCandidate)
  if (inputTokens.size === 0) return []
  return options.filter(opt => {
    const labelTokens = toCanonicalTokens(opt.label)
    return tokensMatch(inputTokens, labelTokens)
  })
}

// =============================================================================
// Command Verb Normalization
// =============================================================================

/** Command verbs to strip from input before matching */
export const COMMAND_VERBS = new Set(['open', 'show', 'go', 'view', 'close'])

/**
 * Normalize command verb typos in input.
 */
export function normalizeCommandVerbs(input: string): { normalized: string, hadVerb: boolean, originalVerb: string | null } {
  const tokens = input.toLowerCase().split(/\s+/)
  let hadVerb = false
  let originalVerb: string | null = null

  const normalizedTokens = tokens.map((token, index) => {
    // Only check first token for verb
    if (index === 0) {
      // Check for exact verb match
      if (COMMAND_VERBS.has(token)) {
        hadVerb = true
        originalVerb = token
        return token
      }
    }
    return token
  })

  return {
    normalized: normalizedTokens.join(' '),
    hadVerb,
    originalVerb,
  }
}

/**
 * Strip command verb from input for label matching.
 */
export function stripCommandVerb(input: string): string {
  const tokens = input.toLowerCase().split(/\s+/)
  if (tokens.length > 1 && COMMAND_VERBS.has(tokens[0])) {
    return tokens.slice(1).join(' ')
  }
  return input
}

/**
 * Extract badge from input (single letter or number at the end).
 * e.g., "link panel d" → badge: "d", "panel 2" → badge: "2"
 */
export function extractBadge(input: string): { badge: string | null, inputWithoutBadge: string } {
  const tokens = input.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { badge: null, inputWithoutBadge: input }

  // Strip trailing punctuation (e.g., "d?" → "d", "d!" → "d")
  const lastToken = tokens[tokens.length - 1].replace(/[?!.,;:]+$/, '')
  // Badge is a single letter (a-z) or single digit (1-9)
  if (/^[a-z]$/.test(lastToken) || /^[1-9]$/.test(lastToken)) {
    return {
      badge: lastToken,
      inputWithoutBadge: tokens.slice(0, -1).join(' '),
    }
  }
  return { badge: null, inputWithoutBadge: input }
}
