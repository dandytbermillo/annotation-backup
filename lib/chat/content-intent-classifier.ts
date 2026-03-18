/**
 * Content-Intent Classifier (Stage 6x.3, Step 3)
 *
 * Pure function classifier that detects whether user input is asking
 * about note content (summary, question, find-text). Requires a
 * pre-resolved note anchor — no DB access, no side effects.
 *
 * Used by the dispatcher to decide WHEN to enter the content-aware
 * Stage 6 loop path with escalationReason: 'content_intent'.
 *
 * In Slice 1, activeNoteItemId is non-null only when the active widget
 * is a note-capable surface. The 'resolved_reference' anchor source
 * exists for forward compatibility but is not produced yet.
 *
 * Design: stage6-content-retrieval-and-explanation-design.md §9.2
 */

import { isExplicitCommand } from '@/lib/chat/input-classifiers'

// ============================================================================
// Types
// ============================================================================

export interface NoteAnchorContext {
  activeNoteItemId: string | null
  activeNoteTitle: string | null
}

export interface ContentIntentResult {
  isContentIntent: boolean
  intentType: 'summary' | 'question' | 'find_text' | null
  noteAnchor: {
    itemId: string
    title: string
    source: 'active_widget' | 'resolved_reference'
  } | null
}

// ============================================================================
// Internal patterns
// ============================================================================

/** Selection inputs that must never trigger content intent. */
const SELECTION_PATTERN = /^([1-9]|[a-e]|first|second|third|fourth|fifth|last)$/i

/** Semantic-session phrases — belong to the semantic lane, not content. */
const SEMANTIC_SESSION_PATTERN =
  /\b(my\s+session|my\s+activity|my\s+history|what\s+have\s+i\s+been\s+doing|what\s+did\s+we\s+do|why\s+did\s+i)\b/i

/** Standalone greetings — excluded from deterministic classifier but NOT from arbiter.
 *  Arbiter handles these correctly (returns ambiguous for standalone, content for prefixed). */
const GREETING_PATTERN = /^(hello|hi|hey)\s*[.!?]?$/i

/** True meta/help phrases — excluded from both classifier AND arbiter.
 * Note: "what panel(s) is/are open" removed — Phase 4 handles this as panel_widget:state_info. */
const META_ONLY_PATTERN =
  /^(help|what\s+can\s+you\s+do|how\s+do\s+i)\b/i

/**
 * Non-note surface references — if the input explicitly targets
 * a dashboard, panel, or workspace, it is not a note content query
 * even when a note anchor is present.
 */
const NON_NOTE_SCOPE_PATTERN =
  /\b(the\s+dashboard|this\s+panel|the\s+panel|links\s+panel|the\s+workspace|this\s+workspace|the\s+sidebar)\b/i

/**
 * Non-read capability verbs (6x.7 Phase A).
 * These must not enter the read-intent resolver even when a note anchor is present.
 * They fall through to existing routing or future capability slices (6x.8+).
 * NOTE: NOT included in isArbiterHardExcluded — the arbiter can classify mutate verbs.
 */
const NOTE_NON_READ_PATTERN = /^(create|rename|delete|remove|edit|add|annotate|highlight|mark|tag|move|copy)\b/i

// ============================================================================
// Shared hard-guard helpers
// ============================================================================

/**
 * 6x.7 legacy: Check whether an input is hard-excluded from the anchored-note intent resolver.
 * Requires activeNoteItemId. Used by the deterministic classifier path.
 */
export function isAnchoredNoteResolverHardExcluded(input: string, anchor: NoteAnchorContext): boolean {
  if (!anchor.activeNoteItemId) return true
  const trimmed = input.trim()
  if (!trimmed) return true
  const lower = trimmed.toLowerCase()
  if (SELECTION_PATTERN.test(lower)) return true
  if (META_ONLY_PATTERN.test(lower)) return true
  if (SEMANTIC_SESSION_PATTERN.test(lower)) return true
  if (NON_NOTE_SCOPE_PATTERN.test(lower)) return true
  if (NOTE_NON_READ_PATTERN.test(lower)) return true
  return false
}

/**
 * 6x.8 Phase 4: Check whether an input is hard-excluded from the cross-surface arbiter.
 * Does NOT require activeNoteItemId — supports note-reference-detected turns.
 * Does NOT include NOTE_NON_READ_PATTERN — arbiter can classify mutate verbs.
 * Does NOT include NON_NOTE_SCOPE_PATTERN — Phase 4 allows non-note surface queries to reach arbiter.
 */
export function isArbiterHardExcluded(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return true
  const lower = trimmed.toLowerCase()
  if (SELECTION_PATTERN.test(lower)) return true
  if (META_ONLY_PATTERN.test(lower)) return true
  if (SEMANTIC_SESSION_PATTERN.test(lower)) return true
  return false
}

/** Navigate command pattern — deferred to existing /api/chat/navigate, must not enter arbiter. */
const NAVIGATE_COMMAND_PATTERN = /^(?:(?:please|pls)\s+)?(?:open|go\s+to|switch\s+to|navigate\s+to)\s+/i

/**
 * 6x.8 Phase 4: Check whether an input is a likely navigate command targeting a non-note surface.
 * These are deferred to existing routing and must not enter the cross-surface arbiter.
 */
export function isLikelyNavigateCommand(input: string): boolean {
  return NAVIGATE_COMMAND_PATTERN.test(input.trim())
}

// --- Intent detection patterns (ordered by specificity) ---

// find_text: most specific
const FIND_TEXT_PATTERNS = [
  /\b(find|search\s+for|look\s+for)\b.+\b(in|inside|within)\b/i,
  /\b(find|search\s+for|look\s+for)\b/i,
  /\bwhere\s+does\s+it\s+(say|mention|talk\s+about)\b/i,
  /\bdoes\s+(it|this|the\s+note)\s+(contain|include)\b/i,
]

// summary: moderately specific
const SUMMARY_PATTERNS = [
  /\b(summarize|summary\s+of|overview\s+of)\b/i,
  /\bgive\s+me\s+a\s+summary\b/i,
  /\bwhat('s|s|\s+is)\s+in\s+(this|the|my)\s+(note|document|page)\b/i,
  /\bwhat\s+does\s+(this|the|my)\s+(note|document|page)\s+say\b(?!\s+about)/i,
]

// question: broadest — checked last
const QUESTION_PATTERNS = [
  /\bwhat\s+does\s+(it|this|this\s+note|the\s+note|my\s+note)\s+(say|mention|talk)\s+about\b/i,
  /\b(explain|tell\s+me\s+about)\s+what('s|s|\s+is)\s+(in\s+here|in\s+this|in\s+the\s+note)\b/i,
  /\bexplain\s+(this|the)\s+(note|document|page|content)\b/i,
  /\bdoes\s+(this|it)\s+mention\b/i,
  /\bwhat\s+does\s+it\s+say\b/i,
]

// ============================================================================
// Classifier
// ============================================================================

const FALSE_RESULT: ContentIntentResult = {
  isContentIntent: false,
  intentType: null,
  noteAnchor: null,
}

function makeResult(
  intentType: 'summary' | 'question' | 'find_text',
  anchor: NoteAnchorContext,
): ContentIntentResult {
  return {
    isContentIntent: true,
    intentType,
    noteAnchor: {
      itemId: anchor.activeNoteItemId!,
      title: anchor.activeNoteTitle ?? '',
      source: 'active_widget',
    },
  }
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text))
}

/**
 * Classify whether user input is a content-intent query about a note.
 *
 * Pure function: no store access, no DB, no side effects.
 * The dispatcher pre-resolves the anchor from active widget state.
 */
export function classifyContentIntent(
  input: string,
  anchor: NoteAnchorContext,
): ContentIntentResult {
  // 1-6. Shared hard guards (reused by resolver eligibility check)
  if (isAnchoredNoteResolverHardExcluded(input, anchor)) {
    return FALSE_RESULT
  }

  const trimmed = input.trim()
  const lower = trimmed.toLowerCase()

  // Classifier-only guard: explicit navigation commands (open, show, go to).
  // The resolver/arbiter keeps these eligible — they may be note-referential read imperatives.
  if (isExplicitCommand(trimmed)) {
    return FALSE_RESULT
  }

  // Classifier-only guard: standalone greetings (hello, hi, hey without content request).
  // Not excluded from arbiter — arbiter correctly returns ambiguous for these.
  if (GREETING_PATTERN.test(lower)) {
    return FALSE_RESULT
  }

  // 7. Intent detection (ordered: find_text → summary → question)
  if (matchesAny(lower, FIND_TEXT_PATTERNS)) {
    return makeResult('find_text', anchor)
  }

  if (matchesAny(lower, SUMMARY_PATTERNS)) {
    return makeResult('summary', anchor)
  }

  if (matchesAny(lower, QUESTION_PATTERNS)) {
    return makeResult('question', anchor)
  }

  // 8. No match
  return FALSE_RESULT
}
