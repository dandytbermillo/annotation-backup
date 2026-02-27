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
  const normalized = input.toLowerCase().trim()

  // Phase 2b: Ordinal/number language bypass
  const hasOrdinal = /\b(first|second|third|fourth|fifth|last|[1-9])\b/i.test(normalized)
  if (hasOrdinal) {
    return false
  }

  // Verb-initial imperative form only (per raw-strict-exact plan Phase 3):
  // Matches "open ...", "show ...", "please open ...", "can you open ...", etc.
  // Does NOT match verbs appearing mid-sentence ("what did you open?", "should I show this?")
  // This prevents question-form inputs from being misclassified as commands.
  // "you open ..." is a directed imperative ("you, open that") — recognized as command
  // to prevent the widget-reference branch (grounding-set.ts:750) from hijacking panel commands.
  const IMPERATIVE_VERB_INITIAL = /^(?:(?:hey\s+)?(?:can|could|would)\s+you\s+(?:please\s+|pls\s+)?|you\s+(?:please\s+|pls\s+)?|(?:please|pls)\s+)?(open|show|list|view|go|back|home|create|rename|delete|remove)\b/i

  return IMPERATIVE_VERB_INITIAL.test(normalized)
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
  confidence: 'high' | 'low_typo' | 'scope_uncertain' | 'none'
  /** For named widget cues like "from links panel d", the extracted panel label suffix */
  namedWidgetHint?: string
  /** True when BOTH chat + widget cues detected in the same input (Rule 14 conflict) */
  hasConflict?: boolean
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
  // Collapse internal whitespace so "from  links panel d" matches same as "from links panel d"
  const normalized = input.toLowerCase().trim().replace(/\s+/g, ' ')

  // --- Chat cues (highest precedence) — longest match first ---
  const CHAT_CUE_PATTERN = /\b(back to options|from earlier options|from chat options?|from the chat|from chat|in chat)\b/i
  const chatMatch = normalized.match(CHAT_CUE_PATTERN)

  // --- Widget cues (expanded per incubation-plan Rule 14) ---
  const WIDGET_CUE_PATTERN = /\b(from links panel\s+\S+|from panel\s+\S+|from links panel|from recent|from active widgets?|from current widgets?|from active panels?|from current panels?|from this widget|from the widget|in active widgets?|in current widgets?|in active panels?|in current panels?|in this widget|in this panel|from active(?!\s+(?:widgets?|panels?|dashboard|workspace))|from current(?!\s+(?:widgets?|panels?|dashboard|workspace)))\b/i
  const widgetMatch = normalized.match(WIDGET_CUE_PATTERN)

  // --- Conflict detection (Rule 14): both chat + widget cues in same input ---
  if (chatMatch && widgetMatch) {
    // Primary scope = chat (higher precedence), flag conflict
    return { scope: 'chat', cueText: chatMatch[0], confidence: 'high', hasConflict: true }
  }

  if (chatMatch) {
    return { scope: 'chat', cueText: chatMatch[0], confidence: 'high' }
  }

  if (widgetMatch) {
    // Normalize cue text: strip trailing punctuation, collapse whitespace
    const rawCueText = widgetMatch[0]
    const normalizedCueText = rawCueText.replace(/[?!.,;:]+$/, '').replace(/\s+/g, ' ').trim()

    // Extract named widget hint for "from links panel d", "from panel delta", etc.
    // Captures everything after "from/in" + optional "links" — supports multi-word suffixes
    let namedWidgetHint: string | undefined
    const namedMatch = normalizedCueText.match(/(?:from|in)\s+((?:links\s+)?panel\s+\S+)/i)
    if (namedMatch) {
      namedWidgetHint = namedMatch[1].trim()
    }

    return { scope: 'widget', cueText: normalizedCueText, confidence: 'high', namedWidgetHint }
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

  // --- Typo detection fallback (deterministic, no LLM) ---
  // Runs only when all exact patterns fail. Returns low_typo → always safe clarifier, never executable.
  const typoResult = detectScopeCueTypo(normalized)
  if (typoResult.scope !== 'none') return typoResult

  // --- Last-resort: scope trigger + unresolved scope-like text → scope_uncertain ---
  // Catches further typos (distance ≤ 2) that exceed the typo detector's threshold.
  // Returns scope_uncertain → always safe clarifier, never executable.
  const unresolvedResult = detectScopeTriggerUnresolved(normalized)
  if (unresolvedResult.scope !== 'none') return unresolvedResult

  return { scope: 'none', cueText: null, confidence: 'none' }
}

// =============================================================================
// Scope-Cue Typo Detection (deterministic, closed vocabulary)
// Per plan: strictly advisory — low_typo confidence NEVER leads to execution.
// =============================================================================

/** Closed vocabulary of scope-relevant tokens for fuzzy matching */
const SCOPE_VOCAB = ['active', 'current', 'widget', 'widgets', 'panel', 'panels', 'chat', 'links', 'recent', 'dashboard', 'workspace'] as const

/** Exact scope tokens that override fuzzy widget classification */
const EXACT_SCOPE_TOKENS = new Set(['workspace', 'dashboard', 'chat'])

/**
 * Detect likely scope-cue typos using Levenshtein distance against closed vocabulary.
 * Returns low_typo confidence — always ends in safe clarifier, never executable.
 *
 * Algorithm:
 * 1. Scan for exact "from"/"in" trigger tokens
 * 2. Check 1–2 following tokens against SCOPE_VOCAB (distance ≤ 1, length ≥ 4)
 * 3. Guard: if any exact scope token (workspace/dashboard/chat) appears nearby, don't map to widget
 * 4. Return best-guess scope with low_typo confidence
 */
function detectScopeCueTypo(normalizedInput: string): ScopeCueResult {
  const tokens = normalizedInput.split(/\s+/).map(t => t.replace(/[?!.,;:]+$/, '').toLowerCase())

  for (let i = 0; i < tokens.length - 1; i++) {
    const trigger = tokens[i]
    if (trigger !== 'from' && trigger !== 'in') continue

    // Check the 1–2 tokens after the trigger
    const followingTokens = tokens.slice(i + 1, i + 3)

    // Guard: if any exact scope token is present in the following tokens, skip widget fuzzy mapping.
    // This prevents "from activ workspace" from being classified as widget scope.
    const hasExactScopeToken = followingTokens.some(t => EXACT_SCOPE_TOKENS.has(t))

    for (const token of followingTokens) {
      if (token.length < 4) continue

      // Find best fuzzy match in closed vocabulary
      let bestMatch: string | null = null
      let bestDistance = Infinity
      for (const vocab of SCOPE_VOCAB) {
        const dist = levenshteinDistance(token, vocab)
        if (dist <= 1 && dist > 0 && dist < bestDistance) {
          bestMatch = vocab
          bestDistance = dist
        }
      }

      if (!bestMatch) continue

      // Determine scope from fuzzy-matched token
      let detectedScope: ScopeCueResult['scope'] = 'none'
      if (bestMatch === 'chat') {
        detectedScope = 'chat'
      } else if (bestMatch === 'dashboard') {
        detectedScope = 'dashboard'
      } else if (bestMatch === 'workspace') {
        detectedScope = 'workspace'
      } else if (bestMatch === 'active' || bestMatch === 'current' || bestMatch === 'widget' || bestMatch === 'widgets' || bestMatch === 'panel' || bestMatch === 'panels') {
        // Guard: don't map to widget if exact scope token is present
        if (hasExactScopeToken) continue
        detectedScope = 'widget'
      }

      if (detectedScope !== 'none') {
        const cueSpan = [trigger, ...followingTokens].join(' ')
        return { scope: detectedScope, cueText: cueSpan, confidence: 'low_typo' }
      }
    }
  }

  return { scope: 'none', cueText: null, confidence: 'none' }
}

// =============================================================================
// Scope-Trigger Unresolved Detection (last-resort safety net)
// Per policy: uncertain scope → safe clarifier, never silent fallback to grounding.
// scope_uncertain confidence NEVER leads to execution — same invariant as low_typo.
// =============================================================================

/** Common non-scope words that follow "from"/"in" in normal English */
const SCOPE_TRIGGER_STOP_WORDS = new Set([
  'the', 'a', 'an', 'my', 'your', 'our', 'their', 'this', 'that', 'it',
  'here', 'there', 'now', 'then', 'today', 'yesterday', 'above', 'below',
])

/**
 * Last-resort safety net: detect "from"/"in" + scope-like trailing tokens
 * that failed both exact and typo detection. Returns scope_uncertain → safe clarifier.
 *
 * Catches cases like "from active widgetss" (distance 2), "from actve widgte", etc.
 * that exceed the typo detector's Levenshtein threshold of 1.
 *
 * CRITICAL: carries forward the exact-scope guard from detectScopeCueTypo —
 * "from activ workspace" must NOT be classified as widget scope.
 */
function detectScopeTriggerUnresolved(normalizedInput: string): ScopeCueResult {
  const tokens = normalizedInput.split(/\s+/).map(t => t.replace(/[?!.,;:]+$/, '').toLowerCase())

  for (let i = 0; i < tokens.length - 1; i++) {
    const trigger = tokens[i]
    if (trigger !== 'from' && trigger !== 'in') continue

    const following = tokens.slice(i + 1, i + 3)

    // Exact-scope guard (same as detectScopeCueTypo):
    // If any following token is an exact scope token (workspace/dashboard/chat),
    // don't map to widget scope.
    const hasExactScopeToken = following.some(t => EXACT_SCOPE_TOKENS.has(t))

    for (const token of following) {
      if (token.length < 4 || SCOPE_TRIGGER_STOP_WORDS.has(token)) continue

      // Relaxed Levenshtein: distance ≤ 2 (broader than typo detector's ≤ 1)
      let bestMatch: string | null = null
      let bestDistance = Infinity
      for (const vocab of SCOPE_VOCAB) {
        const dist = levenshteinDistance(token, vocab)
        if (dist > 0 && dist <= 2 && dist < bestDistance) {
          bestMatch = vocab
          bestDistance = dist
        }
      }

      if (!bestMatch) continue

      // Infer scope from matched vocab (same logic as detectScopeCueTypo)
      let detectedScope: ScopeCueResult['scope'] = 'none'
      if (bestMatch === 'chat') {
        detectedScope = 'chat'
      } else if (bestMatch === 'dashboard') {
        detectedScope = 'dashboard'
      } else if (bestMatch === 'workspace') {
        detectedScope = 'workspace'
      } else if (bestMatch === 'active' || bestMatch === 'current' || bestMatch === 'widget' || bestMatch === 'widgets' || bestMatch === 'panel' || bestMatch === 'panels') {
        // Guard: don't map to widget if exact scope token is present
        if (hasExactScopeToken) continue
        detectedScope = 'widget'
      }

      if (detectedScope !== 'none') {
        const cueSpan = [trigger, ...following].join(' ')
        return { scope: detectedScope, cueText: cueSpan, confidence: 'scope_uncertain' }
      }
    }
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
// Phase 11: Execution Meta Classifier
// =============================================================================

import type { ExecutionMeta, ReasonCode, ResolverPath } from './action-trace'

/** Evidence from the dispatch site about how the match was made. */
export interface ClassifyEvidence {
  matchKind: 'exact' | 'partial' | 'context_expand' | 'registry_exact' | 'ordinal' | 'grounding'
  candidateCount: number
  resolverPath: ResolverPath  // passthrough for tracing, not used in classification
  intentTag?: string
}

/**
 * Shared execution-meta classifier — single decision point.
 * Deterministic step of: deterministic → bounded LLM → safe clarifier.
 *
 * Takes structured match evidence. Only assigns deterministic reasonCode
 * for strict exact matches (Rule B). Non-exact returns 'unknown'.
 *
 * CRITICAL: when reasonCode === 'unknown', the dispatch site MUST NOT
 * execute. It must fall through to the unresolved hook (LLM tier).
 *
 * Server-side unresolved hook: app/api/chat/navigate/route.ts (existing
 * LLM resolver). When bounded LLM is enabled for classification, it
 * will be wired here (Rule E: one post-deterministic hook).
 *
 * See: deterministic-llm-ladder-enforcement-addendum-plan.md
 */
export function classifyExecutionMeta(evidence: ClassifyEvidence): ExecutionMeta {
  const { matchKind, candidateCount, resolverPath, intentTag } = evidence
  const reasonCode = classifyFromEvidence(matchKind, candidateCount)
  return { reasonCode, resolverPath, intentTag }
}

function classifyFromEvidence(matchKind: ClassifyEvidence['matchKind'], candidateCount: number): ReasonCode {
  switch (matchKind) {
    case 'exact':
      // Strict ^..$ name match — deterministic ONLY with unique winner
      // Multiple candidates with exact match is NOT a unique winner → unresolved
      if (candidateCount !== 1) return 'unknown'
      return 'explicit_label_match'
    case 'registry_exact':
      // Known noun registry lookup — always unique by definition (registry key → 1 panel)
      return 'explicit_label_match'
    case 'context_expand':
      // Expanding a recent preview — unique deterministic winner justified:
      // exactly 1 target (the preview being expanded), no name ambiguity,
      // user explicitly requested expansion of the specific preview shown
      return 'continuity_tiebreak'
    case 'ordinal':
      // User selected by number/position from a displayed list — unique winner
      return 'ordinal'
    case 'grounding':
      // Grounding set resolution — unique winner (grounding confirmed)
      return 'grounding_resolved'
    case 'partial':
      // NOT strict exact → must go to unresolved hook (Rule B)
      return 'unknown'
    default:
      return 'unknown'
  }
}

// =============================================================================
// Strict Exact Match (Addendum Rule B — no-stripping gate)
// =============================================================================

/**
 * Strict anchored exact match for deterministic execution gate.
 * Per addendum Rule B: no prefix/suffix filler stripping.
 * Only lowercased trim comparison — nothing else.
 *
 * Used as a pre-gate before classifyExecutionMeta({ matchKind: 'exact' }).
 * If this returns false, dispatch site MUST use matchKind: 'partial'
 * (which the classifier maps to 'unknown' → unresolved gate blocks execution).
 */
export function isStrictExactMatch(rawInput: string, candidateLabel: string): boolean {
  return rawInput.toLowerCase().trim() === candidateLabel.toLowerCase().trim()
}

// =============================================================================
// Universal Deterministic Confidence Gate
// =============================================================================

export type DeterministicOutcome = 'execute' | 'llm' | 'clarify'
export type MatchConfidence = 'high' | 'medium' | 'low' | 'none'

/** Fixed reason allowlist — telemetry and tests key on these, no free-form strings */
export type DecisionReason =
  | 'exact_label'
  | 'exact_sublabel'
  | 'exact_canonical'
  | 'soft_contains'
  | 'soft_starts_with'
  | 'soft_label_contains'
  | 'soft_multi_match'
  | 'no_match'

export interface DeterministicDecision {
  outcome: DeterministicOutcome
  confidence: MatchConfidence
  reason: DecisionReason
  match?: { id: string; label: string }
}

/**
 * Single shared gate for all option-selection paths.
 *
 * Confidence tiers:
 *   high → execute: exact label or exact sublabel (unique, normalized)
 *   medium → llm: soft single match (contains, startsWith, labelContainsInput)
 *   low → llm: soft multi-match
 *   none → llm (active_option) or clarify (command): zero matches
 *
 * mode='active_option': no_match → llm (bounded LLM can still evaluate active options)
 * mode='command': no_match → clarify (no active context to evaluate against)
 */
export function evaluateDeterministicDecision(
  input: string,
  candidates: Array<{ id: string; label: string; sublabel?: string }>,
  mode: 'active_option' | 'command'
): DeterministicDecision {
  const normalized = input.trim().toLowerCase()

  if (!normalized || candidates.length === 0) {
    return {
      outcome: mode === 'active_option' ? 'llm' : 'clarify',
      confidence: 'none',
      reason: 'no_match',
    }
  }

  // --- High confidence: exact label match ---
  const exactLabelMatches = candidates.filter(
    c => c.label.toLowerCase().trim() === normalized
  )
  if (exactLabelMatches.length === 1) {
    return {
      outcome: 'execute',
      confidence: 'high',
      reason: 'exact_label',
      match: { id: exactLabelMatches[0].id, label: exactLabelMatches[0].label },
    }
  }

  // --- High confidence: exact sublabel match ---
  const exactSublabelMatches = candidates.filter(
    c => c.sublabel && c.sublabel.toLowerCase().trim() === normalized
  )
  if (exactSublabelMatches.length === 1) {
    return {
      outcome: 'execute',
      confidence: 'high',
      reason: 'exact_sublabel',
      match: { id: exactSublabelMatches[0].id, label: exactSublabelMatches[0].label },
    }
  }

  // --- High confidence: canonical token match (bidirectional token-set equality) ---
  // Handles singular/plural normalization: "links panel" matches "Links Panels"
  // because canonical tokens {links, panel} === {links, panel}.
  const CANONICAL_TOKEN_MAP: Record<string, string> = {
    panel: 'panel', panels: 'panel',
    widget: 'widget', widgets: 'widget',
    link: 'links', links: 'links',
  }
  const toCanonicalTokenSet = (s: string): Set<string> => {
    const tokens = s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean)
    return new Set(tokens.map(t => CANONICAL_TOKEN_MAP[t] ?? t))
  }
  const inputCanonical = toCanonicalTokenSet(normalized)
  if (inputCanonical.size > 0) {
    const canonicalMatches = candidates.filter(c => {
      const labelCanonical = toCanonicalTokenSet(c.label)
      if (inputCanonical.size !== labelCanonical.size) return false
      for (const t of inputCanonical) {
        if (!labelCanonical.has(t)) return false
      }
      return true
    })
    if (canonicalMatches.length === 1) {
      // Per raw-strict-exact plan (Contract rule 2): exact_canonical is NOT raw strict exact.
      // Canonical token matching (singular/plural normalization) is advisory only — never deterministic execute.
      // Always route to bounded LLM for resolution.
      return {
        outcome: 'llm',
        confidence: 'medium',
        reason: 'exact_canonical',
        match: { id: canonicalMatches[0].id, label: canonicalMatches[0].label },
      }
    }
  }

  // --- Soft matching: collect all soft candidates ---
  type SoftMatch = { id: string; label: string; reason: DecisionReason }
  const softMatches: SoftMatch[] = []

  for (const c of candidates) {
    const label = c.label.toLowerCase().trim()

    // contains: input contains the label (e.g., "open links panels" contains "links panels")
    if (normalized.includes(label) && label.length >= 2) {
      softMatches.push({ id: c.id, label: c.label, reason: 'soft_contains' })
      continue
    }

    // starts_with: label starts with input (e.g., "Links" → "Links Panel D")
    if (label.startsWith(normalized) && normalized.length >= 2) {
      softMatches.push({ id: c.id, label: c.label, reason: 'soft_starts_with' })
      continue
    }

    // label_contains_input: label contains input (e.g., "panel" found in "Links Panel D")
    if (normalized.length >= 3 && label.includes(normalized)) {
      softMatches.push({ id: c.id, label: c.label, reason: 'soft_label_contains' })
      continue
    }
  }

  // --- Classify soft matches ---
  if (softMatches.length === 1) {
    return {
      outcome: 'llm',
      confidence: 'medium',
      reason: softMatches[0].reason,
      match: { id: softMatches[0].id, label: softMatches[0].label },
    }
  }

  if (softMatches.length > 1) {
    return {
      outcome: 'llm',
      confidence: 'low',
      reason: 'soft_multi_match',
    }
  }

  // --- No match ---
  return {
    outcome: mode === 'active_option' ? 'llm' : 'clarify',
    confidence: 'none',
    reason: 'no_match',
  }
}

// =============================================================================
// Polite-Wrapper Exact Pass
// =============================================================================

/**
 * Polite-wrapper exact pass: canonicalize input then check for strict
 * exact label match (case-insensitive) among candidates.
 *
 * Returns the matched candidate if exactly one label matches, null otherwise.
 * Guarded: returns null for verify-open questions.
 * Uses strict label equality only — no canonical token or soft matching.
 *
 * ADVISORY ONLY (per raw-strict-exact plan Contract rule 1):
 * Result is a hint for bounded LLM candidate ranking — callers MUST NOT
 * auto-execute from this match. Only raw strict exact matches (via
 * isStrictExactMatch) may produce deterministic execution.
 */
export function findPoliteWrapperExactMatch(
  input: string,
  candidates: Array<{ id: string; label: string; sublabel?: string }>
): { id: string; label: string } | null {
  if (isVerifyOpenQuestion(input)) return null

  const canonical = canonicalizeCommandInput(input)
  if (!canonical) return null

  const exactMatches = candidates.filter(
    c => c.label.toLowerCase().trim() === canonical.trim()
  )
  return exactMatches.length === 1
    ? { id: exactMatches[0].id, label: exactMatches[0].label }
    : null
}

// =============================================================================
// Strict Exact Mode Feature Flag
// =============================================================================

/**
 * Check if strict exact deterministic mode is enabled.
 * When true: not-exact → never deterministic execute.
 * Non-exact signals become LLM hints instead of execution triggers.
 * Feature flag: NEXT_PUBLIC_STRICT_EXACT_DETERMINISTIC
 */
export function isStrictExactMode(): boolean {
  return typeof process !== 'undefined'
    && process.env?.NEXT_PUBLIC_STRICT_EXACT_DETERMINISTIC === 'true'
}

// =============================================================================
// Verify-Open Question Detection
// =============================================================================

/**
 * Detect verify-open questions: "did I open X?", "have I opened X?", etc.
 * Used to bypass grounding LLM (Tier 4.5) and catch server-side LLM misclassification.
 *
 * Handles conversational prefixes like "hey assistant did i open..."
 * by matching the core pattern anywhere (non-anchored).
 *
 * Negative guard: "did I ask/tell/request (you) to open..." → NOT a verify question
 * (that's verify_request territory).
 */
const VERIFY_OPEN_CORE = /(did|have)\s+(i|we|you)\s+open(?:ed)?\b/i
const REQUEST_PHRASE_GUARD = /(did|have)\s+(i|we|you)\s+(ask|tell|request)\s+(you\s+)?to\b/i

export function isVerifyOpenQuestion(input: string): boolean {
  const trimmed = input.trim()
  if (!VERIFY_OPEN_CORE.test(trimmed)) return false
  if (REQUEST_PHRASE_GUARD.test(trimmed)) return false
  return true
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
 * Definitional patterns that meta-explain/docs should handle, not the semantic lane.
 * Includes what's/whats contractions. Applied after stripping greeting prefixes.
 */
const DEFINITIONAL_QUERY_PATTERN = /^(what\s+is\s+|what\s+are\s+|what'?s\s+|define\s+|how\s+does\s+)/i

/**
 * Detect semantic question/imperative inputs for the semantic answer lane.
 * Catches both question-form ("why did I do that?") and imperative-form ("summarize my session").
 * Excludes command-like, selection-like, and definitional inputs to avoid false positives.
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

  // Exclude definitional queries — meta-explain/docs should handle these.
  // Strip common greeting prefixes so "hi what is workspace?" is caught.
  const trimmed = input.trim().toLowerCase()
  const stripped = trimmed.replace(/^(hi|hey|hello|yo)\s+/, '')
  if (DEFINITIONAL_QUERY_PATTERN.test(stripped)) return false

  return hasQuestionIntent(input) || SEMANTIC_LANE_PATTERN.test(input)
}

// =============================================================================
// Narrow Semantic Meta-Query Detector (server-side misclassification guard)
// =============================================================================

/**
 * Detect semantic meta-queries that have known deterministic resolvers.
 * Returns the correct resolver intent or null (no override).
 *
 * STRICT: Only exact, high-confidence patterns with zero ambiguity.
 * Used server-side to catch LLM misclassification — not a client bypass.
 * Per addendum: unresolved/uncertain => LLM result stands.
 *
 * Guards run on ORIGINAL input (compound/ordinal/option rejection).
 * Pattern matching runs on CLEANED input (conversational filler stripped).
 */
export function detectLocalSemanticIntent(
  input: string
): 'last_action' | 'explain_last_action' | null {
  const n = input.toLowerCase().trim()

  // Reject anything with active-option signals (ordinals, selections)
  if (/^\d+$/.test(n)) return null
  if (/\b(option|choice|first|second|third|top|bottom)\b/i.test(n)) return null

  // Reject compound queries — guards run on ORIGINAL input
  if (/\b(and|also|then|plus)\b/i.test(n)) return null

  // Strip conversational filler (anchored prefix/suffix only — never internal words)
  let cleaned = n
  cleaned = cleaned.replace(/^(?:hey|hi|hello|assistant|please|ok|okay|um|uh)\b[,]?\s*/i, '')
  cleaned = cleaned.replace(/[,]?\s*(?:thank you|thanks|please|thx)\s*[.!?]*$/i, '')
  cleaned = cleaned.trim()

  // === HIGH-CONFIDENCE EXACT PATTERNS ONLY ===
  if (/^(?:explain\s+)?what did i do before that\??$/i.test(cleaned)) return 'explain_last_action'
  if (/^what did i (just )?do\??$/i.test(cleaned)) return 'last_action'
  if (/^what was my last action\??$/i.test(cleaned)) return 'last_action'

  return null // everything else → LLM result stands
}
