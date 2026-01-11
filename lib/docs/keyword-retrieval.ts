/**
 * Keyword Retrieval Service
 * Part of: cursor-style-doc-retrieval-plan.md (Phase 1 + Phase 2)
 *
 * Phase 1: Whole-document retrieval with keyword scoring
 * Phase 2: Chunk-level retrieval with header_path context and de-dupe
 *
 * Provides keyword-based document retrieval with scoring and confidence.
 * No embeddings required - uses term matching with weighted scoring.
 */

import { serverPool } from '@/lib/db/pool'

// =============================================================================
// Configuration
// =============================================================================

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'what', 'how', 'why', 'when', 'where', 'which', 'who', 'whom',
  'my', 'your', 'our', 'their', 'its', 'do', 'does', 'did', 'can', 'could',
  'will', 'would', 'should', 'may', 'might', 'must', 'shall',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'and', 'or', 'but', 'if', 'then', 'so', 'than', 'that', 'this',
  'i', 'me', 'you', 'he', 'she', 'it', 'we', 'they',
  'have', 'has', 'had', 'get', 'got', 'go', 'going', 'went',
  'tell', 'about', 'please', 'just', 'like', 'know',
])

const SYNONYMS: Record<string, string> = {
  shortcuts: 'quick links',
  homepage: 'home',
  main: 'home',
  docs: 'notes',
  documents: 'notes',
  files: 'notes',
  folder: 'navigator',
  folders: 'navigator',
  tree: 'navigator',
  history: 'recent',
  bookmarks: 'quick links',
  favorites: 'quick links',
  navigate: 'navigation',
}

// Scoring weights
const SCORE_TITLE_EXACT = 5
const SCORE_TITLE_TOKEN = 3
const SCORE_KEYWORD = 2
const SCORE_CONTENT = 1

// Confidence thresholds
const MIN_SCORE = 3
const MIN_CONFIDENCE = 0.3
const MIN_GAP = 2
const MIN_MATCHED_TERMS = 1

// =============================================================================
// Types
// =============================================================================

export interface RetrievalResult {
  doc_slug: string
  title: string
  category: string
  snippet: string
  score: number
  content_hash: string
  matched_terms: string[]
  source: 'keyword' | 'hybrid' | 'embedding'
  match_explain?: string[]
  confidence?: number
}

export interface RetrievalResponse {
  status: 'found' | 'ambiguous' | 'weak' | 'no_match'
  results: RetrievalResult[]
  clarification?: string
  confidence: number
}

// =============================================================================
// Query Normalization
// =============================================================================

/**
 * Normalize query: lowercase, strip punctuation, remove stopwords
 */
export function normalizeQuery(query: string): string[] {
  // Apply phrase synonyms first
  let normalized = query.toLowerCase()
  for (const [from, to] of Object.entries(SYNONYMS)) {
    if (from.includes(' ')) {
      normalized = normalized.replace(new RegExp(from, 'g'), to)
    }
  }

  // Tokenize
  const tokens = normalized
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0)

  // Apply single-word synonyms and filter stopwords
  const result: string[] = []
  for (const token of tokens) {
    if (STOPWORDS.has(token)) continue
    const mapped = SYNONYMS[token] || token
    // Handle multi-word synonym results
    if (mapped.includes(' ')) {
      result.push(...mapped.split(' '))
    } else {
      result.push(mapped)
    }
  }

  // Conservative stemming: only strip common suffixes from longer words
  return result.map(t => {
    if (t.length < 4) return t
    if (t.endsWith('ies')) return t.slice(0, -3) + 'y'
    // Only strip 'es' for proper suffixes (ches, shes, xes, zes, oes)
    // This avoids "notes" → "not" (should be "note" via the 's' rule)
    if (t.length > 4 && (
      t.endsWith('ches') || t.endsWith('shes') ||
      t.endsWith('xes') || t.endsWith('zes') || t.endsWith('oes')
    )) {
      return t.slice(0, -2)
    }
    if (t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1)
    return t
  })
}

/**
 * Extract first N words from content as snippet
 */
function extractSnippet(content: string, maxWords: number = 30): string {
  const words = content.split(/\s+/).slice(0, maxWords)
  return words.join(' ') + (words.length >= maxWords ? '...' : '')
}

// =============================================================================
// Scoring
// =============================================================================

interface DocRow {
  slug: string
  category: string
  title: string
  content: string
  keywords: string[]
  content_hash: string
}

/**
 * Score a document against query tokens
 */
function scoreDocument(doc: DocRow, queryTokens: string[]): { score: number; matchedTerms: string[]; explain: string[] } {
  let score = 0
  const matchedTerms: string[] = []
  const explain: string[] = []

  const titleLower = doc.title.toLowerCase()
  const contentLower = doc.content.toLowerCase()
  const keywordsLower = doc.keywords.map(k => k.toLowerCase())

  // Check for exact phrase match in title
  const queryPhrase = queryTokens.join(' ')
  if (titleLower.includes(queryPhrase) && queryTokens.length > 1) {
    score += SCORE_TITLE_EXACT
    matchedTerms.push(...queryTokens)
    explain.push(`Exact phrase "${queryPhrase}" in title: +${SCORE_TITLE_EXACT}`)
  }

  for (const token of queryTokens) {
    if (matchedTerms.includes(token)) continue // Already matched in phrase

    // Title token match
    if (titleLower.includes(token)) {
      score += SCORE_TITLE_TOKEN
      matchedTerms.push(token)
      explain.push(`Token "${token}" in title: +${SCORE_TITLE_TOKEN}`)
      continue
    }

    // Keyword match
    if (keywordsLower.some(k => k.includes(token) || token.includes(k))) {
      score += SCORE_KEYWORD
      matchedTerms.push(token)
      explain.push(`Token "${token}" in keywords: +${SCORE_KEYWORD}`)
      continue
    }

    // Content match
    if (contentLower.includes(token)) {
      score += SCORE_CONTENT
      matchedTerms.push(token)
      explain.push(`Token "${token}" in content: +${SCORE_CONTENT}`)
    }
  }

  // Normalize by content length (sqrt to reduce penalty)
  const contentTokenCount = contentLower.split(/\s+/).length
  const normalizedScore = score / Math.sqrt(Math.max(contentTokenCount / 100, 1))

  return {
    score: Math.round(normalizedScore * 100) / 100,
    matchedTerms: [...new Set(matchedTerms)],
    explain,
  }
}

// =============================================================================
// Main Retrieval Function
// =============================================================================

/**
 * Retrieve relevant documents for a query
 */
export async function retrieveDocs(query: string): Promise<RetrievalResponse> {
  const queryTokens = normalizeQuery(query)

  if (queryTokens.length === 0) {
    return {
      status: 'no_match',
      results: [],
      clarification: 'Which part would you like me to explain?',
      confidence: 0,
    }
  }

  // Fetch all docs (for Phase 1, we score in-memory; Phase 2+ will use SQL)
  const result = await serverPool.query(
    `SELECT slug, category, title, content, keywords, content_hash
     FROM docs_knowledge`
  )

  const docs: DocRow[] = result.rows

  // Score all documents
  const scored: Array<RetrievalResult & { rawScore: number }> = []

  for (const doc of docs) {
    const { score, matchedTerms, explain } = scoreDocument(doc, queryTokens)

    if (score > 0) {
      scored.push({
        doc_slug: doc.slug,
        title: doc.title,
        category: doc.category,
        snippet: extractSnippet(doc.content),
        score,
        rawScore: score,
        content_hash: doc.content_hash,
        matched_terms: matchedTerms,
        source: 'keyword',
        match_explain: explain,
      })
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  // No matches
  if (scored.length === 0) {
    return {
      status: 'no_match',
      results: [],
      clarification: 'Which part would you like me to explain?',
      confidence: 0,
    }
  }

  const topResult = scored[0]
  const secondScore = scored.length > 1 ? scored[1].score : 0

  // Calculate confidence
  const confidence = secondScore > 0
    ? (topResult.score - secondScore) / topResult.score
    : 1

  // Add confidence to top result
  topResult.confidence = confidence

  // Apply confidence rules
  const hasTitleOrKeywordHit = topResult.match_explain?.some(e =>
    e.includes('title') || e.includes('keywords')
  )

  // Rule: Not enough matched terms
  if (topResult.matched_terms.length < MIN_MATCHED_TERMS) {
    return {
      status: 'weak',
      results: scored.slice(0, 3),
      clarification: `I'm not sure which feature you mean. Are you asking about "${topResult.title}"?`,
      confidence,
    }
  }

  // Rule: No title/keyword hit (content-only match)
  if (!hasTitleOrKeywordHit) {
    return {
      status: 'weak',
      results: scored.slice(0, 3),
      clarification: `I found a possible match for "${topResult.title}". Is that what you're asking about?`,
      confidence,
    }
  }

  // Rule: Score too low
  if (topResult.score < MIN_SCORE) {
    return {
      status: 'weak',
      results: scored.slice(0, 3),
      clarification: `I think you mean "${topResult.title}". Is that right?`,
      confidence,
    }
  }

  // Rule: Ambiguous (gap too small)
  if (scored.length > 1 && (topResult.score - secondScore) < MIN_GAP) {
    return {
      status: 'ambiguous',
      results: scored.slice(0, 2),
      clarification: `Do you mean "${topResult.title}" (${topResult.category}) or "${scored[1].title}" (${scored[1].category})?`,
      confidence,
    }
  }

  // Rule: Low confidence
  if (confidence < MIN_CONFIDENCE) {
    return {
      status: 'ambiguous',
      results: scored.slice(0, 2),
      clarification: `Do you mean "${topResult.title}" or "${scored[1].title}"?`,
      confidence,
    }
  }

  // Strong match
  return {
    status: 'found',
    results: [topResult],
    confidence,
  }
}

/**
 * Get a short explanation for a concept (for meta-explain integration)
 */
export async function getExplanation(concept: string): Promise<string | null> {
  const response = await retrieveDocs(concept)

  if (response.status === 'found' && response.results.length > 0) {
    const doc = response.results[0]
    // Return first paragraph or snippet
    const firstPara = doc.snippet.split('\n\n')[0]
    return firstPara || doc.snippet
  }

  if (response.status === 'ambiguous' || response.status === 'weak') {
    return response.clarification || null
  }

  return null
}

// =============================================================================
// Core Concepts Cache (Tier 1)
// =============================================================================

/**
 * Static cache of core concept explanations for instant responses
 * Used by meta-explain before hitting the database
 */
export const CORE_CONCEPTS: Record<string, string> = {
  home: 'Home is your main entry dashboard. It shows your widgets and quick links.',
  dashboard: 'The dashboard is the main view of an entry, displaying widgets you can interact with.',
  workspace: 'A workspace is where your notes live. You can create, edit, and organize notes there.',
  notes: 'Notes are the core content units. Each note contains rich text you can edit and annotate.',
  note: 'A note is a document containing rich text. Notes live inside workspaces.',
  recent: 'Recent shows your most recently opened items in this entry.',
  widget: 'Widgets are interactive panels on the dashboard showing different types of content.',
  widgets: 'Widgets are interactive panels on the dashboard showing different types of content.',
  panel: 'A panel is a container that can display widgets or content in the drawer.',
  drawer: 'The drawer is a side panel that opens to show widget details or expanded content.',
  navigator: 'The Navigator lets you browse your folder structure and Knowledge Base hierarchy.',
  'quick links': 'Quick Links provides shortcuts to your bookmarked or frequently used items.',
  'links overview': 'Links Overview shows all your Quick Links categories at a glance.',
  continue: 'The Continue widget helps you pick up where you left off in your last session.',
  'widget manager': 'The Widget Manager lets you customize your dashboard by adding or removing widgets.',
}

/**
 * Try to get explanation from cache first (Tier 1)
 */
export function getCachedExplanation(query: string): string | null {
  const normalized = query.toLowerCase().trim()

  // Direct match
  if (CORE_CONCEPTS[normalized]) {
    return CORE_CONCEPTS[normalized]
  }

  // Try without common prefixes
  const withoutPrefix = normalized
    .replace(/^(explain|what is|what's|tell me about)\s+/i, '')
    .trim()

  if (CORE_CONCEPTS[withoutPrefix]) {
    return CORE_CONCEPTS[withoutPrefix]
  }

  // Try singular/plural variations
  const singular = withoutPrefix.replace(/s$/, '')
  if (CORE_CONCEPTS[singular]) {
    return CORE_CONCEPTS[singular]
  }

  return null
}

// =============================================================================
// Phase 2: Chunk-Level Retrieval
// =============================================================================

// Feature flag for Phase 2 (can be set via env)
const DOC_RETRIEVAL_PHASE = parseInt(process.env.DOC_RETRIEVAL_PHASE || '2', 10)

// De-dupe config: max chunks per doc
const MAX_CHUNKS_PER_DOC = 2
const DEFAULT_TOP_K = 5

interface ChunkRow {
  doc_slug: string
  category: string
  title: string
  header_path: string
  chunk_index: number
  content: string
  keywords: string[]
  chunk_hash: string
}

export interface ChunkRetrievalResult {
  doc_slug: string
  chunk_index: number
  header_path: string
  title: string
  category: string
  snippet: string
  score: number
  rawScore: number
  chunk_hash: string
  matched_terms: string[]
  source: 'keyword' | 'hybrid' | 'embedding'
  match_explain?: string[]
  confidence?: number
}

export interface ChunkRetrievalResponse {
  status: 'found' | 'ambiguous' | 'weak' | 'no_match'
  results: ChunkRetrievalResult[]
  clarification?: string
  confidence: number
  phase: number
  metrics?: {
    totalChunks: number
    matchedChunks: number
    dedupedChunks: number
    retrievalTimeMs: number
  }
}

/**
 * Score a chunk against query tokens
 */
function scoreChunk(chunk: ChunkRow, queryTokens: string[]): { score: number; matchedTerms: string[]; explain: string[] } {
  let score = 0
  const matchedTerms: string[] = []
  const explain: string[] = []

  const titleLower = chunk.title.toLowerCase()
  const headerPathLower = chunk.header_path.toLowerCase()
  const contentLower = chunk.content.toLowerCase()
  const keywordsLower = chunk.keywords.map(k => k.toLowerCase())

  // Check for exact phrase match in title or header_path
  const queryPhrase = queryTokens.join(' ')
  if ((titleLower.includes(queryPhrase) || headerPathLower.includes(queryPhrase)) && queryTokens.length > 1) {
    score += SCORE_TITLE_EXACT
    matchedTerms.push(...queryTokens)
    explain.push(`Exact phrase "${queryPhrase}" in title/header: +${SCORE_TITLE_EXACT}`)
  }

  for (const token of queryTokens) {
    if (matchedTerms.includes(token)) continue // Already matched in phrase

    // Title token match
    if (titleLower.includes(token)) {
      score += SCORE_TITLE_TOKEN
      matchedTerms.push(token)
      explain.push(`Token "${token}" in title: +${SCORE_TITLE_TOKEN}`)
      continue
    }

    // Header path match (same weight as title)
    if (headerPathLower.includes(token)) {
      score += SCORE_TITLE_TOKEN
      matchedTerms.push(token)
      explain.push(`Token "${token}" in header_path: +${SCORE_TITLE_TOKEN}`)
      continue
    }

    // Keyword match
    if (keywordsLower.some(k => k.includes(token) || token.includes(k))) {
      score += SCORE_KEYWORD
      matchedTerms.push(token)
      explain.push(`Token "${token}" in keywords: +${SCORE_KEYWORD}`)
      continue
    }

    // Content match
    if (contentLower.includes(token)) {
      score += SCORE_CONTENT
      matchedTerms.push(token)
      explain.push(`Token "${token}" in content: +${SCORE_CONTENT}`)
    }
  }

  // Normalize by content length (sqrt to reduce penalty)
  const contentTokenCount = contentLower.split(/\s+/).length
  const normalizedScore = score / Math.sqrt(Math.max(contentTokenCount / 50, 1))

  return {
    score: Math.round(normalizedScore * 100) / 100,
    matchedTerms: [...new Set(matchedTerms)],
    explain,
  }
}

/**
 * De-duplicate chunks: limit to MAX_CHUNKS_PER_DOC per document
 */
function dedupeChunks(chunks: ChunkRetrievalResult[]): { results: ChunkRetrievalResult[]; dedupedCount: number } {
  const docCounts: Record<string, number> = {}
  const results: ChunkRetrievalResult[] = []
  let dedupedCount = 0

  for (const chunk of chunks) {
    const count = docCounts[chunk.doc_slug] || 0
    if (count < MAX_CHUNKS_PER_DOC) {
      results.push(chunk)
      docCounts[chunk.doc_slug] = count + 1
    } else {
      dedupedCount++
    }
  }

  return { results, dedupedCount }
}

/**
 * Retrieve relevant chunks for a query (Phase 2)
 */
export async function retrieveChunks(query: string, topK: number = DEFAULT_TOP_K): Promise<ChunkRetrievalResponse> {
  const startTime = Date.now()
  const queryTokens = normalizeQuery(query)

  if (queryTokens.length === 0) {
    return {
      status: 'no_match',
      results: [],
      clarification: 'Which part would you like me to explain?',
      confidence: 0,
      phase: 2,
    }
  }

  // Fetch all chunks
  const result = await serverPool.query(
    `SELECT doc_slug, category, title, header_path, chunk_index, content, keywords, chunk_hash
     FROM docs_knowledge_chunks`
  )

  const chunks: ChunkRow[] = result.rows
  const totalChunks = chunks.length

  // Score all chunks
  const scored: ChunkRetrievalResult[] = []

  for (const chunk of chunks) {
    const { score, matchedTerms, explain } = scoreChunk(chunk, queryTokens)

    if (score > 0) {
      scored.push({
        doc_slug: chunk.doc_slug,
        chunk_index: chunk.chunk_index,
        header_path: chunk.header_path,
        title: chunk.title,
        category: chunk.category,
        snippet: extractSnippet(chunk.content),
        score,
        rawScore: score,
        chunk_hash: chunk.chunk_hash,
        matched_terms: matchedTerms,
        source: 'keyword',
        match_explain: explain,
      })
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  // No matches
  if (scored.length === 0) {
    const noMatchMetrics = {
      totalChunks,
      matchedChunks: 0,
      dedupedChunks: 0,
      retrievalTimeMs: Date.now() - startTime,
    }
    console.log(`[Retrieval] Phase 2: query="${query}" status=no_match latency=${noMatchMetrics.retrievalTimeMs}ms`)
    return {
      status: 'no_match',
      results: [],
      clarification: 'Which part would you like me to explain?',
      confidence: 0,
      phase: 2,
      metrics: noMatchMetrics,
    }
  }

  // De-dupe and limit to top K
  const { results: dedupedResults, dedupedCount } = dedupeChunks(scored)
  const topResults = dedupedResults.slice(0, topK)

  const topResult = topResults[0]
  const secondScore = topResults.length > 1 ? topResults[1].score : 0

  // Calculate confidence
  const confidence = secondScore > 0
    ? (topResult.score - secondScore) / topResult.score
    : 1

  // Add confidence to top result
  topResult.confidence = confidence

  const metrics = {
    totalChunks,
    matchedChunks: scored.length,
    dedupedChunks: dedupedCount,
    retrievalTimeMs: Date.now() - startTime,
  }

  // Apply confidence rules (same as Phase 1)
  const hasTitleOrKeywordHit = topResult.match_explain?.some(e =>
    e.includes('title') || e.includes('keywords') || e.includes('header_path')
  )

  if (topResult.matched_terms.length < MIN_MATCHED_TERMS) {
    return {
      status: 'weak',
      results: topResults.slice(0, 3),
      clarification: `I'm not sure which feature you mean. Are you asking about "${topResult.header_path}"?`,
      confidence,
      phase: 2,
      metrics,
    }
  }

  if (!hasTitleOrKeywordHit) {
    return {
      status: 'weak',
      results: topResults.slice(0, 3),
      clarification: `I found a possible match in "${topResult.header_path}". Is that what you're asking about?`,
      confidence,
      phase: 2,
      metrics,
    }
  }

  if (topResult.score < MIN_SCORE) {
    return {
      status: 'weak',
      results: topResults.slice(0, 3),
      clarification: `I think you mean "${topResult.header_path}". Is that right?`,
      confidence,
      phase: 2,
      metrics,
    }
  }

  // Same-doc tie collapse: if top two results are from the same doc, treat as weak
  // instead of ambiguous (avoids confusing "Home > Home" vs "Home > Overview" prompts)
  if (topResults.length > 1 &&
      topResults[0].doc_slug === topResults[1].doc_slug &&
      (topResult.score - secondScore) < MIN_GAP) {
    return {
      status: 'weak',
      results: [topResult],
      clarification: `I found info in "${topResult.header_path}". Is that what you meant?`,
      confidence,
      phase: 2,
      metrics,
    }
  }

  // Cross-doc ambiguity: different docs with close scores
  if (topResults.length > 1 && (topResult.score - secondScore) < MIN_GAP) {
    return {
      status: 'ambiguous',
      results: topResults.slice(0, 2),
      clarification: `Do you mean "${topResult.header_path}" or "${topResults[1].header_path}"?`,
      confidence,
      phase: 2,
      metrics,
    }
  }

  if (confidence < MIN_CONFIDENCE) {
    return {
      status: 'ambiguous',
      results: topResults.slice(0, 2),
      clarification: `Do you mean "${topResult.header_path}" or "${topResults[1].header_path}"?`,
      confidence,
      phase: 2,
      metrics,
    }
  }

  // Strong match
  const response: ChunkRetrievalResponse = {
    status: 'found',
    results: topResults,
    confidence,
    phase: 2,
    metrics,
  }

  // Log retrieval metrics for observability
  console.log(`[Retrieval] Phase 2: query="${query}" status=${response.status} ` +
    `topScore=${topResult.score} confidence=${confidence.toFixed(2)} ` +
    `matched=${metrics.matchedChunks}/${metrics.totalChunks} deduped=${metrics.dedupedChunks} ` +
    `latency=${metrics.retrievalTimeMs}ms`)

  return response
}

/**
 * Get a short explanation from chunks (Phase 2)
 */
export async function getChunkExplanation(concept: string): Promise<string | null> {
  const response = await retrieveChunks(concept, 1)

  if (response.status === 'found' && response.results.length > 0) {
    const chunk = response.results[0]
    // Return snippet with header context
    return `${chunk.header_path}: ${chunk.snippet}`
  }

  if (response.status === 'ambiguous' || response.status === 'weak') {
    return response.clarification || null
  }

  return null
}

/**
 * Smart retrieval: uses Phase 1 or Phase 2 based on feature flag
 * Falls back to Phase 1 if Phase 2 fails
 */
export async function smartRetrieve(query: string): Promise<RetrievalResponse | ChunkRetrievalResponse> {
  if (DOC_RETRIEVAL_PHASE >= 2) {
    try {
      return await retrieveChunks(query)
    } catch (error) {
      console.error('[Retrieval] Phase 2 failed, falling back to Phase 1:', error)
      // Fall through to Phase 1
    }
  }

  return await retrieveDocs(query)
}

/**
 * Get explanation using smart retrieval (Tier 1 cache → Phase 2 → Phase 1)
 */
export async function getSmartExplanation(concept: string): Promise<string | null> {
  // Tier 1: Check cache first
  const cached = getCachedExplanation(concept)
  if (cached) return cached

  // Tier 2: Try smart retrieval
  const response = await smartRetrieve(concept)

  if (response.status === 'found' && response.results.length > 0) {
    const result = response.results[0]
    if ('header_path' in result) {
      // Phase 2 chunk result
      return `${result.header_path}: ${result.snippet}`
    } else {
      // Phase 1 doc result
      return result.snippet.split('\n\n')[0] || result.snippet
    }
  }

  if (response.status === 'ambiguous' || response.status === 'weak') {
    return response.clarification || null
  }

  return null
}
