/**
 * Query Patterns Module
 * Part of: TD-3 (Consolidate Pattern Matching)
 *
 * Single source of truth for all routing patterns and query normalization.
 * DO NOT duplicate these patterns elsewhere - import from this module.
 */

import { levenshteinDistance } from './typo-suggestions'

// =============================================================================
// Pattern Constants
// =============================================================================

/**
 * Affirmation patterns for yes/confirm responses.
 */
export const AFFIRMATION_PATTERN = /^(yes|yeah|yep|yup|sure|ok|okay|k|ya|ye|yea|mhm|uh\s*huh|go ahead|do it|proceed|correct|right|exactly|confirm|confirmed)(\s+please)?$/

/**
 * Rejection patterns for no/cancel responses.
 */
export const REJECTION_PATTERN = /^(no|nope|nah|negative|cancel|stop|abort|never\s*mind|forget it|don't|not now|skip|pass|wrong|incorrect|not that)$/

/**
 * Question start words for detecting new questions.
 */
export const QUESTION_START_PATTERN = /^(what|which|where|when|how|why|who|is|are|do|does|did|can|could|should|would)\b/i

/**
 * Command start words for detecting action intents.
 */
export const COMMAND_START_PATTERN = /^(open|show|go|list|create|close|delete|rename|back|home)\b/i

/**
 * Question intent detection (broader than QUESTION_START).
 */
export const QUESTION_INTENT_PATTERN = /^(what|how|where|when|why|who|which|can|could|would|should|tell|explain|help|is|are|do|does)\b/i

/**
 * Action verbs for command detection.
 */
export const ACTION_VERB_PATTERN = /\b(open|close|show|list|go|create|rename|delete|remove|add|navigate|edit|modify|change|update)\b/i

/**
 * Doc instruction cues (these should route to docs even with action verbs).
 */
export const DOC_INSTRUCTION_PATTERN = /\b(how to|how do i|tell me how|show me how|walk me through)\b/i

/**
 * Index-like references (e.g., "workspace 6", "note 2").
 */
export const INDEX_REFERENCE_PATTERN = /\b(workspace|note|page|entry)\s+\d+\b/i

/**
 * Meta-explain patterns (what is X, explain X).
 */
export const META_EXPLAIN_PATTERNS = {
  whatIs: /^what is\b/i,
  whatAre: /^what are\b/i,
  explain: /^explain\b/i,
  howDoesItWork: /^how does (it|that|this) work/i,
}

/**
 * Conversational prefixes to strip for core question extraction.
 */
export const CONVERSATIONAL_PREFIXES = [
  /^(can|could|would|will) you (please |pls )?(tell me|explain|help me understand) /i,
  /^(please |pls )?(tell me|explain) /i,
  /^i('d| would) (like to|want to) (know|understand) /i,
  /^(do you know|can you help me understand) /i,
]

/**
 * Polite command prefixes.
 */
export const POLITE_COMMAND_PREFIXES = [
  'can you',
  'could you',
  'would you',
  'will you',
  'please',
  'pls',
]

/**
 * Action nouns that bypass doc retrieval.
 */
export const ACTION_NOUNS = new Set<string>([
  'recent',
  'recents',
  'quick links',
  'quicklinks',
  'navigator',
  'continue',
  'demo',
  'links overview',
  'quick capture',
])

/**
 * Doc-related verbs that indicate doc-style queries.
 */
export const DOC_VERBS = new Set<string>([
  'explain',
  'describe',
  'define',
  'clarify',
  'tell',
  'about',
])

/**
 * Correction phrases that trigger re-retrieval.
 */
export const CORRECTION_PHRASES = [
  'no',
  'nope',
  'not that',
  'not what i meant',
  'not what i asked',
  "that's wrong",
  'thats wrong',
  'wrong',
  'incorrect',
  'different',
  'something else',
  'try again',
]

/**
 * Follow-up phrases for pronoun-based continuation.
 */
export const FOLLOWUP_PHRASES = [
  'tell me more',
  'more details',
  'explain more',
  'more',
  'how does it work',
  'how does that work',
  'what else',
  'continue',
  'go on',
  'expand',
  'elaborate',
]

/**
 * Meta patterns for clarification requests.
 */
export const META_PATTERNS = [
  /^what(\s+do\s+you)?\s+mean\??$/,
  /^explain(\s+that)?(\s+please)?$/,
  /^help(\s+me)?(\s+understand)?$/,
  /^what\s+are\s+(my\s+)?options\??$/,
  /^what('s|s|\s+is)\s+the\s+difference\??$/,
  /^huh\??$/,
  /^\?+$/,
  /^what\??$/,
  /^(i('m|m)?\s+)?not\s+sure$/,
  /^i\s+don('t|t)\s+know$/,
  /^(can\s+you\s+)?tell\s+me\s+more\??$/,
  /^what\s+is\s+that\??$/,
  /^i('m|m)?\s+not\s+sure\s+what\s+that\s+(does|means)\??$/,
  /^clarify(\s+please)?$/,
  /^options\??$/,
]

/**
 * Reshow options phrases.
 */
export const RESHOW_PATTERNS = [
  /^show\s*(me\s*)?(the\s*)?options$/,
  /^(what\s*were\s*those|what\s*were\s*they)\??$/,
  /^i'?m\s*confused\??$/,
  /^(can\s*you\s*)?show\s*(me\s*)?(again|them)\??$/,
  /^remind\s*me\??$/,
  /^options\??$/,
]

/**
 * Bare meta-explain phrases (handled specially).
 */
export const BARE_META_PHRASES = [
  'explain',
  'what do you mean',
  'explain that',
  'help me understand',
  'what is that',
  'tell me more',
]

/**
 * TD-7: High-ambiguity terms - common English words that also have app meanings.
 * These require clarification when no explicit intent cue is present.
 * Start small and expand based on telemetry.
 * See: td7-stricter-app-relevance-plan.md
 */
export const HIGH_AMBIGUITY_TERMS = new Set<string>([
  'home',
  'notes',
  'note',
  'action',
  'actions',
])

// =============================================================================
// Normalization Functions
// =============================================================================

/**
 * Normalize input for routing: lowercase, trim, replace separators, extract tokens.
 * Matches the component implementation for consistent routing behavior.
 */
export function normalizeInputForRouting(input: string): {
  normalized: string
  tokens: string[]
} {
  const normalized = input
    .toLowerCase()
    .trim()
    .replace(/[-_/,:;]+/g, ' ')
    .replace(/[?!.]+$/, '')
    .replace(/\s+/g, ' ')

  // NOTE: In real impl apply synonyms + conservative stemming + typo fix BEFORE tokenization.
  const tokens = normalized.split(/\s+/).filter(Boolean)
  return { normalized, tokens }
}

/**
 * Strip conversational prefixes to extract the core question.
 * e.g., "can you tell me what are the workspaces actions?" → "what are the workspaces actions"
 */
export function stripConversationalPrefix(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/[?!.]+$/, '')

  let result = normalized
  for (const prefix of CONVERSATIONAL_PREFIXES) {
    result = result.replace(prefix, '')
  }

  return result
}

/**
 * Normalize common typos in input.
 */
export function normalizeTypos(input: string): string {
  return input
    .replace(/shwo|shw/g, 'show')
    .replace(/optins|optons|optiosn/g, 'options')
    .replace(/teh/g, 'the')
}

/**
 * Normalize a widget/doc title for comparison.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[-_/,:;]+/g, ' ')
    .replace(/[?!.]+$/, '')
    .replace(/\s+/g, ' ')
}

/**
 * Check if string starts with any of the given prefixes.
 */
export function startsWithAnyPrefix(normalized: string, prefixes: string[]): boolean {
  return prefixes.some(p => normalized === p || normalized.startsWith(p + ' '))
}

// =============================================================================
// Detection Functions
// =============================================================================

/**
 * Check if input is an affirmation phrase (yes, ok, etc.).
 */
export function isAffirmationPhrase(input: string): boolean {
  const normalized = input.toLowerCase().trim()
  return AFFIRMATION_PATTERN.test(normalized)
}

/**
 * Check if input is a rejection phrase (no, cancel, etc.).
 */
export function isRejectionPhrase(input: string): boolean {
  const normalized = input.toLowerCase().trim()
  return REJECTION_PATTERN.test(normalized)
}

/**
 * Check if input is a correction phrase (no, not that, wrong, etc.).
 */
export function isCorrectionPhrase(input: string): boolean {
  const normalized = input.trim().toLowerCase()
  return CORRECTION_PHRASES.some(p => normalized === p || normalized.startsWith(p + ' '))
}

/**
 * Check if input is a pronoun follow-up phrase (tell me more, etc.).
 */
export function isPronounFollowUp(input: string): boolean {
  const normalized = input.trim().toLowerCase()
  return FOLLOWUP_PHRASES.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.startsWith(p))
}

/**
 * Check if input has question intent.
 */
export function hasQuestionIntent(input: string): boolean {
  const normalized = input.toLowerCase().trim()
  return QUESTION_INTENT_PATTERN.test(normalized) || normalized.endsWith('?')
}

/**
 * Check if input contains action verbs.
 */
export function hasActionVerb(input: string): boolean {
  return ACTION_VERB_PATTERN.test(input)
}

/**
 * Check if input contains doc instruction cues.
 */
export function containsDocInstructionCue(input: string): boolean {
  return DOC_INSTRUCTION_PATTERN.test(input)
}

/**
 * Check if input looks like an index reference.
 */
export function looksIndexLikeReference(input: string): boolean {
  return INDEX_REFERENCE_PATTERN.test(input)
}

/**
 * Check if input is a meta phrase (request for explanation).
 */
export function isMetaPhrase(input: string): boolean {
  const normalized = input.toLowerCase().trim()
  return META_PATTERNS.some(pattern => pattern.test(normalized))
}

/**
 * Check if input matches reshow options phrases.
 */
export function matchesReshowPhrases(input: string): boolean {
  const normalized = normalizeTypos(input.toLowerCase().trim())
  return RESHOW_PATTERNS.some(pattern => pattern.test(normalized))
}

/**
 * Check if input is a new question or command (for follow-up guard).
 */
export function isNewQuestionOrCommand(input: string): boolean {
  const trimmed = input.trim()
  return (
    QUESTION_START_PATTERN.test(trimmed) ||
    COMMAND_START_PATTERN.test(trimmed) ||
    /^(tell|explain|describe)\b/i.test(trimmed)
  )
}

/**
 * Check if input is a meta-explain query outside clarification mode.
 */
export function isMetaExplainOutsideClarification(input: string): boolean {
  const normalized = input.trim().toLowerCase().replace(/[?!.]+$/, '')

  // Direct meta phrases
  if (BARE_META_PHRASES.includes(normalized)) {
    return true
  }

  // "explain <concept>" pattern
  if (normalized.startsWith('explain ')) {
    return true
  }

  // "what is/are <concept>" pattern
  if (normalized.startsWith('what is ') || normalized.startsWith('what are ')) {
    return true
  }

  // Stripped conversational prefix check
  const stripped = stripConversationalPrefix(normalized)
  if (stripped !== normalized) {
    if (stripped.startsWith('what is ') || stripped.startsWith('what are ')) {
      return true
    }
  }

  return false
}

/**
 * Check if input is command-like (should route to action).
 */
export function isCommandLike(input: string): boolean {
  const normalized = input.toLowerCase().trim()

  // Index-like selection should be action
  if (looksIndexLikeReference(normalized)) return true

  // Imperative: action verb without question intent
  if (hasActionVerb(normalized) && !hasQuestionIntent(normalized)) return true

  // Polite command: prefix + action verb, unless it's doc instruction
  const hasPolitePrefix = POLITE_COMMAND_PREFIXES.some(p => normalized.startsWith(p))
  if (hasPolitePrefix && hasActionVerb(normalized) && !containsDocInstructionCue(normalized)) {
    return true
  }

  return false
}

/**
 * TD-7: Check if query only matches high-ambiguity terms (no specific terms).
 * Returns the matched high-ambiguity term if true, null otherwise.
 * Used to trigger clarification instead of direct routing.
 */
export function getHighAmbiguityOnlyMatch(
  tokens: string[],
  normalized: string,
  knownTerms?: Set<string>
): string | null {
  if (!knownTerms || knownTerms.size === 0) return null

  // Find all matched terms (token matches + normalized match)
  const matchedTokens = tokens.filter(t => knownTerms.has(t))
  const normalizedMatches = knownTerms.has(normalized) ? [normalized] : []
  const allMatches = [...new Set([...matchedTokens, ...normalizedMatches])]

  if (allMatches.length === 0) return null

  // Check if ALL matches are high-ambiguity
  const allHighAmbiguity = allMatches.every(t => HIGH_AMBIGUITY_TERMS.has(t))
  if (!allHighAmbiguity) return null

  // Return the first high-ambiguity term found (for telemetry)
  return allMatches[0]
}

/**
 * TD-7: Check if input has explicit intent cues that bypass ambiguity clarification.
 * Intent cues include: question patterns, doc instruction cues, action verbs.
 */
export function hasExplicitIntentCue(input: string): boolean {
  const normalized = input.toLowerCase().trim()

  // Question intent (what is, how do, etc.)
  if (hasQuestionIntent(normalized)) return true

  // Doc instruction cue (how to, tell me how, etc.)
  if (containsDocInstructionCue(normalized)) return true

  // Action verb (open, show, go to, etc.)
  if (hasActionVerb(normalized)) return true

  return false
}

// =============================================================================
// Extraction Functions
// =============================================================================

/**
 * Extract the concept from a meta-explain query.
 * e.g., "what is workspace" → "workspace"
 */
export function extractMetaExplainConcept(input: string): string | null {
  const normalized = input.trim().toLowerCase().replace(/[?!.]+$/, '')

  // Check original text first, then stripped version
  // (stripConversationalPrefix may strip "explain" so we need to check original first)
  const stripped = stripConversationalPrefix(normalized)
  const texts = [normalized]
  if (stripped !== normalized) {
    texts.push(stripped)
  }

  for (const text of texts) {
    // "explain <concept>"
    if (text.startsWith('explain ')) {
      const concept = text.replace(/^explain\s+/, '').trim()
      if (concept && concept !== 'that') return concept
    }

    // "what is <concept>"
    if (text.startsWith('what is ')) {
      const concept = text.replace(/^what is\s+(a\s+|an\s+|the\s+)?/, '').trim()
      if (concept) return concept
    }

    // "what are <concepts>"
    if (text.startsWith('what are ')) {
      const concept = text.replace(/^what are\s+(the\s+)?/, '').trim()
      if (concept) return concept
    }
  }

  return null
}

/**
 * Extract the query term from a doc-style query.
 * e.g., "how do I add a widget" → "add widget"
 */
export function extractDocQueryTerm(input: string): string {
  const { normalized } = normalizeInputForRouting(input)

  // Remove common prefixes
  let term = normalized
    .replace(/^what (is|are)\s+(a\s+|an\s+|the\s+)?/i, '')
    .replace(/^how (do i|to|can i)\s+/i, '')
    .replace(/^tell me (about\s+)?(a\s+|an\s+|the\s+)?/i, '')
    .replace(/^tell me how (to\s+)?/i, '')
    .replace(/^explain\s+(a\s+|an\s+|the\s+)?/i, '')
    .replace(/^what does\s+(a\s+|an\s+|the\s+)?/i, '')
    .replace(/^where can i\s+(find\s+|see\s+)?/i, '')
    .replace(/^how can i\s+/i, '')
    .replace(/^show me how (to\s+)?/i, '')
    .replace(/^walk me through\s+(how to\s+)?/i, '')
    .replace(/^describe\s+(the\s+|a\s+|an\s+)?/i, '')
    .replace(/^clarify\s+(the\s+|a\s+|an\s+)?/i, '')
    .replace(/^define\s+(the\s+|a\s+|an\s+)?/i, '')
    .trim()

  return term || normalized
}

// =============================================================================
// Response Style
// =============================================================================

/**
 * Determine response style based on input.
 */
export function getResponseStyle(input: string): 'short' | 'medium' | 'detailed' {
  const normalized = input.trim().toLowerCase()

  // Detailed: "walk me through", "step by step", "how do i"
  if (/\b(walk me through|step by step|steps to|how do i|how to)\b/.test(normalized)) {
    return 'detailed'
  }

  // Medium: "explain", "describe", "tell me about"
  if (/\b(explain|describe|tell me about|clarify)\b/.test(normalized)) {
    return 'medium'
  }

  // Short: "what is", short queries
  return 'short'
}

// =============================================================================
// Query Classification (Main API)
// =============================================================================

export type QueryIntent =
  | 'explain'      // What is X, explain X
  | 'action'       // Open X, show X
  | 'navigate'     // Go to X
  | 'followup'     // Tell me more
  | 'correction'   // No, not that
  | 'affirmation'  // Yes, ok
  | 'rejection'    // No, cancel
  | 'meta'         // What do you mean?
  | 'unknown'

/**
 * Classify query intent.
 * Returns the primary intent detected from the input.
 */
export function classifyQueryIntent(input: string): QueryIntent {
  const normalized = input.trim().toLowerCase()

  // Check affirmation/rejection first (short responses)
  if (isAffirmationPhrase(input)) return 'affirmation'
  if (isRejectionPhrase(input)) return 'rejection'
  if (isCorrectionPhrase(input)) return 'correction'

  // Check follow-up
  if (isPronounFollowUp(input)) return 'followup'

  // Check meta (clarification requests)
  if (isMetaPhrase(input)) return 'meta'

  // Check command/action
  if (isCommandLike(normalized)) return 'action'

  // Check explain (meta-explain patterns)
  if (isMetaExplainOutsideClarification(input)) return 'explain'

  // Check navigation
  if (/^(go|navigate|back|home)\b/i.test(normalized)) return 'navigate'

  return 'unknown'
}

/**
 * Normalize and classify a query.
 * Main entry point for query analysis.
 */
export function normalizeQuery(input: string): {
  original: string
  normalized: string
  stripped: string  // Conversational prefix removed
  tokens: string[]
  intent: QueryIntent
  isQuestion: boolean
  isCommand: boolean
  extractedTopic: string | null
} {
  const { normalized, tokens } = normalizeInputForRouting(input)
  const stripped = stripConversationalPrefix(normalized)
  const intent = classifyQueryIntent(input)
  const isQuestion = hasQuestionIntent(normalized)
  const isCommand = isCommandLike(normalized)
  const extractedTopic = extractMetaExplainConcept(input) || extractDocQueryTerm(input)

  return {
    original: input,
    normalized,
    stripped,
    tokens,
    intent,
    isQuestion,
    isCommand,
    extractedTopic,
  }
}

// =============================================================================
// TD-2: Gated Fuzzy Matching
// =============================================================================

/**
 * Minimum token length for fuzzy matching.
 * Shorter tokens have too many false positives (e.g., "note" matching "mode").
 */
const FUZZY_MIN_TOKEN_LENGTH = 5

/**
 * Maximum Levenshtein distance for fuzzy match.
 * Distance of 2 allows common typos like "workspac" → "workspace".
 */
const FUZZY_MAX_DISTANCE = 2

export interface FuzzyMatchResult {
  /** The matched term from knownTerms */
  matchedTerm: string
  /** Original input token that was fuzzy-matched */
  inputToken: string
  /** Levenshtein distance between input and match */
  distance: number
}

/**
 * Find a fuzzy match for a token against knownTerms.
 *
 * TD-2 Guardrails:
 * - Only matches if token length >= 5
 * - Only matches if Levenshtein distance <= 2
 * - Returns the best (lowest distance) match
 *
 * @param token - The input token to fuzzy match
 * @param knownTerms - Set of known terms from the database
 * @returns The best fuzzy match, or null if no match within guardrails
 */
export function findFuzzyMatch(
  token: string,
  knownTerms: Set<string>
): FuzzyMatchResult | null {
  // Guard: token must be at least 5 characters
  if (token.length < FUZZY_MIN_TOKEN_LENGTH) {
    return null
  }

  const tokenLower = token.toLowerCase()
  let bestMatch: FuzzyMatchResult | null = null

  for (const term of knownTerms) {
    const termLower = term.toLowerCase()

    // Skip if exact match (not a fuzzy case)
    if (tokenLower === termLower) {
      continue
    }

    // Skip terms that are too different in length (optimization)
    const lengthDiff = Math.abs(tokenLower.length - termLower.length)
    if (lengthDiff > FUZZY_MAX_DISTANCE) {
      continue
    }

    const distance = levenshteinDistance(tokenLower, termLower)

    // Guard: distance must be <= 2
    if (distance > FUZZY_MAX_DISTANCE) {
      continue
    }

    // Track best match (lowest distance)
    if (!bestMatch || distance < bestMatch.distance) {
      bestMatch = {
        matchedTerm: term,
        inputToken: token,
        distance,
      }
    }
  }

  return bestMatch
}

/**
 * Find fuzzy matches for all tokens in a query.
 * Returns all tokens that fuzzy-matched, for telemetry.
 *
 * @param tokens - Array of tokens from normalizeInputForRouting
 * @param knownTerms - Set of known terms from the database
 * @returns Array of fuzzy match results (may be empty)
 */
export function findAllFuzzyMatches(
  tokens: string[],
  knownTerms: Set<string>
): FuzzyMatchResult[] {
  const matches: FuzzyMatchResult[] = []

  for (const token of tokens) {
    const match = findFuzzyMatch(token, knownTerms)
    if (match) {
      matches.push(match)
    }
  }

  return matches
}

/**
 * Check if any token fuzzy-matches a known term.
 * Returns true if at least one fuzzy match is found.
 *
 * @param tokens - Array of tokens from normalizeInputForRouting
 * @param knownTerms - Set of known terms from the database
 * @returns true if any fuzzy match found within guardrails
 */
export function hasFuzzyMatch(
  tokens: string[],
  knownTerms: Set<string>
): boolean {
  return tokens.some(token => findFuzzyMatch(token, knownTerms) !== null)
}
