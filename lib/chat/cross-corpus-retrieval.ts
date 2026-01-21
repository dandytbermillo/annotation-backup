/**
 * Cross-Corpus Retrieval Module
 * Part of: Prereq 4 (Cross-Corpus Ambiguity UX)
 *
 * Handles querying both docs and notes corpora, comparing results,
 * and determining whether to show cross-corpus disambiguation pills.
 */

import { detectCorpusIntent, CorpusIntent } from './query-patterns'

// =============================================================================
// Types
// =============================================================================

export interface CorpusResult {
  corpus: 'docs' | 'notes'
  status: 'found' | 'ambiguous' | 'weak' | 'no_match'
  topScore: number
  topTitle: string
  topResourceId: string
  confidence: number
}

export interface CrossCorpusDecision {
  // What to show
  showPills: boolean
  singleCorpus?: 'docs' | 'notes'  // If showPills=false, which corpus to use

  // Results for each corpus (if queried)
  docsResult?: CorpusResult
  notesResult?: CorpusResult

  // Decision metadata
  scoreGap?: number
  intent: CorpusIntent
  reason: CrossCorpusReason
}

export type CrossCorpusReason =
  | 'explicit_notes_intent'      // User said "my notes" etc
  | 'explicit_docs_intent'       // User said "in the docs" etc or matched known terms
  | 'both_viable_close_scores'   // Both corpora have results within MIN_GAP
  | 'both_viable_both_intents'   // Query has both corpus signals
  | 'docs_only_match'            // Only docs had results
  | 'notes_only_match'           // Only notes had results
  | 'neither_match'              // Neither corpus had results
  | 'notes_not_indexed'          // Notes index unavailable (fallback)

// Score gap threshold for showing cross-corpus pills
// Reuses the same MIN_GAP concept from docs retrieval
const MIN_GAP = 2

// =============================================================================
// Decision Logic
// =============================================================================

/**
 * Determine cross-corpus retrieval decision based on intent and results.
 *
 * Decision flow:
 * 1. If explicit notes intent and no docs intent → notes only
 * 2. If explicit docs intent (not just term-based) and no notes intent → docs only
 * 3. Query both corpora
 * 4. If both viable and close scores → show pills
 * 5. If only one has results → use that one
 * 6. If neither has results → fallback
 *
 * @param query - Raw user query
 * @param docsResult - Result from docs corpus (optional)
 * @param notesResult - Result from notes corpus (optional)
 * @param knownTerms - Known doc terms for intent detection
 * @param options - Additional options for decision making
 */
export function decideCrossCorpus(
  query: string,
  docsResult: CorpusResult | null,
  notesResult: CorpusResult | null,
  knownTerms?: Set<string> | null,
  options?: {
    /** True if docs intent comes from explicit phrases, not just term matching */
    isExplicitDocsIntent?: boolean
  }
): CrossCorpusDecision {
  const intent = detectCorpusIntent(query, knownTerms)
  const { isExplicitDocsIntent = false } = options || {}

  // Check viable status (not no_match)
  const docsViable = docsResult && docsResult.status !== 'no_match'
  const notesViable = notesResult && notesResult.status !== 'no_match'

  // Case 1: Explicit notes intent only
  if (intent === 'notes') {
    if (notesViable) {
      return {
        showPills: false,
        singleCorpus: 'notes',
        docsResult: docsResult || undefined,
        notesResult: notesResult || undefined,
        intent,
        reason: 'explicit_notes_intent',
      }
    }
    // Notes intent but no results → fall through to check docs
  }

  // Case 2: Explicit docs intent (phrases, not just term matching) without notes intent
  // For term-only docs intent, fall through to score comparison
  if (intent === 'docs' && isExplicitDocsIntent) {
    if (docsViable) {
      return {
        showPills: false,
        singleCorpus: 'docs',
        docsResult: docsResult || undefined,
        notesResult: notesResult || undefined,
        intent,
        reason: 'explicit_docs_intent',
      }
    }
    // Docs intent but no results → fall through to check notes
  }

  // Case 3: Both intents present
  if (intent === 'both') {
    if (docsViable && notesViable) {
      const scoreGap = Math.abs(docsResult!.topScore - notesResult!.topScore)
      return {
        showPills: true,
        docsResult: docsResult || undefined,
        notesResult: notesResult || undefined,
        scoreGap,
        intent,
        reason: 'both_viable_both_intents',
      }
    }
  }

  // Case 4: Both viable with close scores
  if (docsViable && notesViable) {
    const scoreGap = Math.abs(docsResult!.topScore - notesResult!.topScore)
    if (scoreGap < MIN_GAP) {
      return {
        showPills: true,
        docsResult: docsResult || undefined,
        notesResult: notesResult || undefined,
        scoreGap,
        intent,
        reason: 'both_viable_close_scores',
      }
    }
    // Scores not close → use higher scoring one
    const winner = docsResult!.topScore >= notesResult!.topScore ? 'docs' : 'notes'
    return {
      showPills: false,
      singleCorpus: winner,
      docsResult: docsResult || undefined,
      notesResult: notesResult || undefined,
      scoreGap,
      intent,
      reason: winner === 'docs' ? 'explicit_docs_intent' : 'explicit_notes_intent',
    }
  }

  // Case 5: Only docs has results
  if (docsViable && !notesViable) {
    return {
      showPills: false,
      singleCorpus: 'docs',
      docsResult: docsResult || undefined,
      notesResult: notesResult || undefined,
      intent,
      reason: 'docs_only_match',
    }
  }

  // Case 6: Only notes has results
  if (!docsViable && notesViable) {
    return {
      showPills: false,
      singleCorpus: 'notes',
      docsResult: docsResult || undefined,
      notesResult: notesResult || undefined,
      intent,
      reason: 'notes_only_match',
    }
  }

  // Case 7: Neither has results
  return {
    showPills: false,
    docsResult: docsResult || undefined,
    notesResult: notesResult || undefined,
    intent,
    reason: 'neither_match',
  }
}

/**
 * Convert unified retrieval response to CorpusResult.
 * Helper for extracting what we need from the full response.
 */
export function extractCorpusResult(
  response: {
    corpus: 'docs' | 'notes'
    status: 'found' | 'ambiguous' | 'weak' | 'no_match'
    results: Array<{
      resourceId: string
      title: string
      score: number
      confidence?: number
    }>
    confidence: number
  }
): CorpusResult | null {
  if (response.status === 'no_match' || response.results.length === 0) {
    return {
      corpus: response.corpus,
      status: response.status,
      topScore: 0,
      topTitle: '',
      topResourceId: '',
      confidence: 0,
    }
  }

  const top = response.results[0]
  return {
    corpus: response.corpus,
    status: response.status,
    topScore: top.score,
    topTitle: top.title,
    topResourceId: top.resourceId,
    confidence: top.confidence ?? response.confidence,
  }
}

// =============================================================================
// Client-side fetcher (for use in React components)
// =============================================================================

/**
 * Fetch retrieval results from a corpus.
 * Client-side helper for calling the unified /api/retrieve endpoint.
 */
export async function fetchCorpusResults(
  corpus: 'docs' | 'notes',
  query: string,
  options?: {
    excludeChunkIds?: string[]
    topK?: number
  }
): Promise<CorpusResult | null> {
  try {
    const response = await fetch('/api/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        corpus,
        query,
        ...options,
      }),
    })

    if (!response.ok) {
      console.error(`[CrossCorpus] ${corpus} fetch failed:`, response.status)
      return null
    }

    const data = await response.json()
    return extractCorpusResult(data)
  } catch (error) {
    console.error(`[CrossCorpus] ${corpus} fetch error:`, error)
    return null
  }
}

/**
 * Query both corpora in parallel and make a decision.
 * Main entry point for cross-corpus retrieval in the UI.
 */
export async function queryCrossCorpus(
  query: string,
  knownTerms?: Set<string> | null,
  options?: {
    excludeChunkIds?: string[]
    topK?: number
    skipNotes?: boolean  // For safety fallback if notes index unavailable
    isExplicitDocsIntent?: boolean  // True if docs intent is from explicit phrases
  }
): Promise<CrossCorpusDecision> {
  const { skipNotes = false, isExplicitDocsIntent = false } = options || {}

  // Fetch both corpora in parallel
  const [docsResult, notesResult] = await Promise.all([
    fetchCorpusResults('docs', query, options),
    skipNotes ? Promise.resolve(null) : fetchCorpusResults('notes', query, options),
  ])

  // Handle notes index unavailable
  if (!skipNotes && notesResult === null && docsResult) {
    return {
      showPills: false,
      singleCorpus: 'docs',
      docsResult: docsResult,
      intent: detectCorpusIntent(query, knownTerms),
      reason: 'notes_not_indexed',
    }
  }

  return decideCrossCorpus(query, docsResult, notesResult, knownTerms, { isExplicitDocsIntent })
}
