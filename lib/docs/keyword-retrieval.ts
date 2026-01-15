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
 * Extract snippet from content preserving newlines for header detection.
 * Uses char-based extraction to maintain structure.
 * Ensures at least one body line is included if content has body after header.
 */
function extractSnippet(content: string, maxChars: number = 400): string {
  const trimmed = content.trim()
  if (trimmed.length <= maxChars) return trimmed

  // Initial char-based slice preserving newlines
  let endIdx = maxChars
  const wordEnd = trimmed.lastIndexOf(' ', maxChars)
  if (wordEnd > maxChars * 0.7) {
    endIdx = wordEnd
  }

  let snippet = trimmed.slice(0, endIdx).trim()

  // Guard: ensure snippet has body content if possible
  // If snippet only has header lines, extend to include first body line
  if (snippet.startsWith('#')) {
    const lines = snippet.split('\n')
    const hasBodyLine = lines.some(line => {
      const t = line.trim()
      return t.length > 0 && !t.startsWith('#')
    })

    if (!hasBodyLine) {
      // Find first non-header line in full content and include it
      const fullLines = trimmed.split('\n')
      let extendedSnippet = ''
      for (const line of fullLines) {
        extendedSnippet += (extendedSnippet ? '\n' : '') + line
        const t = line.trim()
        if (t.length > 0 && !t.startsWith('#')) {
          // Found body line, include it and stop
          break
        }
      }
      if (extendedSnippet.length > snippet.length) {
        snippet = extendedSnippet
      }
    }
  }

  return snippet + (snippet.length < trimmed.length ? '...' : '')
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
 * V5: Cache entry with explanation and canonical docSlug for follow-up tracking
 */
interface CoreConceptEntry {
  explanation: string
  docSlug: string  // Canonical doc slug for HS2 follow-ups
}

/**
 * Static cache of core concept explanations for instant responses
 * Used by meta-explain before hitting the database
 * V5: Each entry includes docSlug for accurate follow-up state tracking
 */
export const CORE_CONCEPTS: Record<string, CoreConceptEntry> = {
  home: {
    explanation: 'Home is your main entry dashboard. It shows your widgets and quick links.',
    docSlug: 'concepts/home',
  },
  dashboard: {
    explanation: 'The dashboard is the main view of an entry, displaying widgets you can interact with.',
    docSlug: 'concepts/dashboard',
  },
  workspace: {
    explanation: 'A workspace is where your notes live. You can create, edit, and organize notes there.',
    docSlug: 'concepts/workspace',
  },
  notes: {
    explanation: 'Notes are the core content units. Each note contains rich text you can edit and annotate.',
    docSlug: 'concepts/notes',
  },
  note: {
    explanation: 'A note is a document containing rich text. Notes live inside workspaces.',
    docSlug: 'concepts/notes',
  },
  recent: {
    explanation: 'Recent shows your most recently opened items in this entry.',
    docSlug: 'widgets/recent',
  },
  widget: {
    explanation: 'Widgets are interactive panels on the dashboard showing different types of content.',
    docSlug: 'concepts/widgets',
  },
  widgets: {
    explanation: 'Widgets are interactive panels on the dashboard showing different types of content.',
    docSlug: 'concepts/widgets',
  },
  panel: {
    explanation: 'A panel is a container that can display widgets or content in the drawer.',
    docSlug: 'concepts/panels',
  },
  drawer: {
    explanation: 'The drawer is a side panel that opens to show widget details or expanded content.',
    docSlug: 'concepts/panels',
  },
  navigator: {
    explanation: 'The Navigator lets you browse your folder structure and Knowledge Base hierarchy.',
    docSlug: 'widgets/navigator',
  },
  'quick links': {
    explanation: 'Quick Links provides shortcuts to your bookmarked or frequently used items.',
    docSlug: 'widgets/quick-links',
  },
  'links overview': {
    explanation: 'Links Overview shows all your Quick Links categories at a glance.',
    docSlug: 'widgets/links-overview',
  },
  continue: {
    explanation: 'The Continue widget helps you pick up where you left off in your last session.',
    docSlug: 'widgets/continue',
  },
  'widget manager': {
    explanation: 'The Widget Manager lets you customize your dashboard by adding or removing widgets.',
    docSlug: 'widgets/widget-manager',
  },
}

/**
 * V5: Cache result with explanation and docSlug for follow-up tracking
 */
export interface CacheResult {
  explanation: string
  docSlug: string
}

/**
 * Try to get explanation from cache first (Tier 1)
 * V5: Returns object with explanation AND docSlug for accurate follow-up state
 */
export function getCachedExplanation(query: string): CacheResult | null {
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
  // V5 Hybrid Response Selection fields
  chunkId: string              // e.g., `${doc_slug}#chunk-${chunk_index}`
  isHeadingOnly?: boolean      // true if snippet is just a markdown header
  bodyCharCount?: number       // character count excluding headers
  nextChunkId?: string         // adjacent chunk in same doc for expansion
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

// =============================================================================
// V5 Hybrid Response Selection Helpers
// =============================================================================

/** V5 configurable thresholds */
const MIN_BODY_CHARS = 80
const HEADING_ONLY_MAX_CHARS = 50

/**
 * Generate a chunkId from doc_slug and chunk_index.
 * Format: `${doc_slug}#chunk-${chunk_index}`
 */
function generateChunkId(docSlug: string, chunkIndex: number): string {
  return `${docSlug}#chunk-${chunkIndex}`
}

/**
 * Strip markdown headers from text for body char count.
 * Removes lines starting with # to get actual body content.
 */
function stripMarkdownHeaders(text: string): string {
  return text
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .join('\n')
    .trim()
}

/**
 * Calculate body character count (excluding markdown headers).
 */
function calculateBodyCharCount(snippet: string): number {
  return stripMarkdownHeaders(snippet).length
}

/**
 * Detect if a snippet is heading-only (just a markdown header with no body).
 * Per v5 plan: heading-only if starts with # and body chars < threshold.
 */
function detectIsHeadingOnly(snippet: string): boolean {
  const trimmed = snippet.trim()
  // Must start with a markdown header
  if (!trimmed.startsWith('#')) return false
  // Check body content after stripping headers
  const bodyChars = calculateBodyCharCount(snippet)
  return bodyChars < HEADING_ONLY_MAX_CHARS
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
  let normalizedScore = score / Math.sqrt(Math.max(contentTokenCount / 50, 1))

  // V5 HS1: Heavily penalize header-only chunks in scoring phase
  // This ensures chunks with actual body content rank higher than section titles
  const bodyText = stripMarkdownHeaders(chunk.content)
  if (bodyText.length < HEADING_ONLY_MAX_CHARS) {
    normalizedScore = normalizedScore * 0.1 // 90% penalty for header-only
    explain.push(`Header-only penalty: score * 0.1`)
  }

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
 * Options for chunk retrieval (V5)
 */
export interface RetrieveChunksOptions {
  topK?: number
  excludeChunkIds?: string[]  // V5: filter out already-shown chunks for follow-ups
  docSlug?: string            // V5: scope retrieval to a specific doc
}

/**
 * Retrieve relevant chunks for a query (Phase 2)
 * V5: Supports excludeChunkIds for follow-up expansion (HS2)
 */
export async function retrieveChunks(
  query: string,
  options: RetrieveChunksOptions = {}
): Promise<ChunkRetrievalResponse> {
  const { topK = DEFAULT_TOP_K, excludeChunkIds = [], docSlug } = options
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

  // Build exclude set for efficient lookup
  const excludeSet = new Set(excludeChunkIds)

  // Fetch all chunks (optionally scoped to a specific doc)
  let dbQuery = `SELECT doc_slug, category, title, header_path, chunk_index, content, keywords, chunk_hash
     FROM docs_knowledge_chunks`
  const queryParams: string[] = []

  if (docSlug) {
    dbQuery += ` WHERE doc_slug = $1`
    queryParams.push(docSlug)
  }

  const result = await serverPool.query(dbQuery, queryParams)

  const chunks: ChunkRow[] = result.rows
  const totalChunks = chunks.length

  // Build a map of max chunk_index per doc for nextChunkId calculation
  const maxChunkIndexByDoc = new Map<string, number>()
  for (const chunk of chunks) {
    const current = maxChunkIndexByDoc.get(chunk.doc_slug) ?? -1
    if (chunk.chunk_index > current) {
      maxChunkIndexByDoc.set(chunk.doc_slug, chunk.chunk_index)
    }
  }

  // Score all chunks (V5: filter out excluded chunks for follow-ups)
  const scored: ChunkRetrievalResult[] = []

  for (const chunk of chunks) {
    // V5: Skip excluded chunks (already shown in conversation)
    const chunkId = generateChunkId(chunk.doc_slug, chunk.chunk_index)
    if (excludeSet.has(chunkId)) continue

    const { score, matchedTerms, explain } = scoreChunk(chunk, queryTokens)

    if (score > 0) {
      const snippet = extractSnippet(chunk.content)
      const maxIndex = maxChunkIndexByDoc.get(chunk.doc_slug) ?? chunk.chunk_index

      scored.push({
        doc_slug: chunk.doc_slug,
        chunk_index: chunk.chunk_index,
        header_path: chunk.header_path,
        title: chunk.title,
        category: chunk.category,
        snippet,
        score,
        rawScore: score,
        chunk_hash: chunk.chunk_hash,
        matched_terms: matchedTerms,
        source: 'keyword',
        match_explain: explain,
        // V5 fields
        chunkId,
        isHeadingOnly: detectIsHeadingOnly(snippet),
        bodyCharCount: calculateBodyCharCount(snippet),
        nextChunkId: chunk.chunk_index < maxIndex
          ? generateChunkId(chunk.doc_slug, chunk.chunk_index + 1)
          : undefined,
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
    // Production typo metric: log no_match queries for Phase 3 decision
    // Filter logs with: grep "\[Retrieval:NoMatch\]" to track typo/miss rate
    console.log(`[Retrieval] Phase 2: query="${query}" status=no_match latency=${noMatchMetrics.retrievalTimeMs}ms`)
    console.log(`[Retrieval:NoMatch] query="${query}" tokens=${JSON.stringify(queryTokens)} timestamp=${new Date().toISOString()}`)
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
  // BUT: first check for cross-doc candidate within MIN_GAP (cross-doc ambiguity override)
  if (topResults.length > 1 &&
      topResults[0].doc_slug === topResults[1].doc_slug &&
      (topResult.score - secondScore) < MIN_GAP) {

    // Cross-doc ambiguity override: check if a distinct doc exists within MIN_GAP
    // This prevents hiding concept docs when action docs tie at the top
    const topDocSlug = topResults[0].doc_slug
    const topScore = topResults[0].score

    // Find ALL distinct docs within MIN_GAP, then pick highest-scoring one
    const crossDocCandidates = topResults.filter(r =>
      r.doc_slug !== topDocSlug &&
      (topScore - r.score) < MIN_GAP
    )

    // Pick the best cross-doc candidate by score (not just first match)
    const crossDocCandidate = crossDocCandidates.length > 0
      ? crossDocCandidates.reduce((best, curr) => curr.score > best.score ? curr : best)
      : null

    if (crossDocCandidate) {
      // Distinct doc within MIN_GAP exists → return ambiguous (pills)
      // Use header_path for clarification text (consistent with existing UI)
      return {
        status: 'ambiguous',
        results: [topResults[0], crossDocCandidate],
        clarification: `Do you mean "${topResults[0].header_path}" or "${crossDocCandidate.header_path}"?`,
        confidence,
        phase: 2,
        metrics,
      }
    }

    // No cross-doc candidate → proceed with same-doc weak behavior
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
 * Retrieve the best chunk from a specific doc by slug.
 * Used for disambiguation follow-up: user selects a doc, we return its best content.
 * Per general-doc-retrieval-routing-plan.md: use docSlug to scope retrieval.
 */
export async function retrieveByDocSlug(docSlug: string): Promise<ChunkRetrievalResponse> {
  const startTime = Date.now()

  // Fetch chunks for this specific doc
  const result = await serverPool.query(
    `SELECT doc_slug, category, title, header_path, chunk_index, content, keywords, chunk_hash
     FROM docs_knowledge_chunks
     WHERE doc_slug = $1
     ORDER BY chunk_index ASC`,
    [docSlug]
  )

  const chunks: ChunkRow[] = result.rows
  const totalChunks = chunks.length

  if (chunks.length === 0) {
    return {
      status: 'no_match',
      results: [],
      clarification: 'Document not found.',
      confidence: 0,
      phase: 2,
      metrics: {
        totalChunks: 0,
        matchedChunks: 0,
        dedupedChunks: 0,
        retrievalTimeMs: Date.now() - startTime,
      },
    }
  }

  // HS1 Guard: Prefer first non-heading-only chunk
  // This ensures pill clicks and direct lookups return useful content
  let bestChunk = chunks[0]
  let snippet = extractSnippet(bestChunk.content)

  if (detectIsHeadingOnly(snippet) && chunks.length > 1) {
    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i]
      const candidateSnippet = extractSnippet(chunk.content)
      if (!detectIsHeadingOnly(candidateSnippet)) {
        bestChunk = chunk
        snippet = candidateSnippet
        break
      }
    }
  }

  const retrievalTimeMs = Date.now() - startTime
  const maxChunkIndex = Math.max(...chunks.map(c => c.chunk_index))

  const topResult: ChunkRetrievalResult = {
    doc_slug: bestChunk.doc_slug,
    chunk_index: bestChunk.chunk_index,
    header_path: bestChunk.header_path,
    title: bestChunk.title,
    category: bestChunk.category,
    snippet,
    score: 10, // Fixed high score for direct lookup
    rawScore: 10,
    chunk_hash: bestChunk.chunk_hash,
    matched_terms: ['direct_lookup'],
    source: 'keyword',
    match_explain: ['Direct doc lookup by slug'],
    // V5 fields
    chunkId: generateChunkId(bestChunk.doc_slug, bestChunk.chunk_index),
    isHeadingOnly: detectIsHeadingOnly(snippet),
    bodyCharCount: calculateBodyCharCount(snippet),
    nextChunkId: bestChunk.chunk_index < maxChunkIndex
      ? generateChunkId(bestChunk.doc_slug, bestChunk.chunk_index + 1)
      : undefined,
  }

  console.log(`[Retrieval] DocSlug lookup: slug="${docSlug}" chunks=${totalChunks} latency=${retrievalTimeMs}ms`)

  return {
    status: 'found',
    results: [topResult],
    clarification: undefined,
    confidence: 1,
    phase: 2,
    metrics: {
      totalChunks,
      matchedChunks: totalChunks,
      dedupedChunks: 1,
      retrievalTimeMs,
    },
  }
}

/**
 * Get a short explanation from chunks (Phase 2)
 */
export async function getChunkExplanation(concept: string): Promise<string | null> {
  const response = await retrieveChunks(concept, { topK: 1 })

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
export async function smartRetrieve(
  query: string,
  options: RetrieveChunksOptions = {}
): Promise<RetrievalResponse | ChunkRetrievalResponse> {
  if (DOC_RETRIEVAL_PHASE >= 2) {
    try {
      return await retrieveChunks(query, options)
    } catch (error) {
      console.error('[Retrieval] Phase 2 failed, falling back to Phase 1:', error)
      // Fall through to Phase 1
    }
  }

  return await retrieveDocs(query)
}

/**
 * Result from getSmartExplanation with metadata for follow-up tracking
 * V5: Added docSlug and chunkId for HS2 follow-up state
 */
export interface ExplanationResult {
  explanation: string | null
  docSlug?: string   // Actual doc slug for follow-ups
  chunkId?: string   // Chunk ID for HS2 tracking (undefined if from cache or Phase 1)
  fromCache: boolean // True if returned from cache
  status?: 'found' | 'ambiguous' | 'weak' | 'no_match'  // For UI to show pills on ambiguous
  options?: Array<{   // Doc options for ambiguous status (pills)
    docSlug: string
    label: string     // header_path for display
    title: string
  }>
}

/** Options for getSmartExplanation */
interface SmartExplanationOptions {
  isDefinitionalQuery?: boolean  // Step 3: prefer concepts/* for "what is X" queries
}

/**
 * Get explanation using smart retrieval (DB first → cache fallback)
 * V5: Returns object with metadata for follow-up state tracking
 * Step 3: When isDefinitionalQuery=true and ambiguous, auto-select concept doc
 */
export async function getSmartExplanation(concept: string, options?: SmartExplanationOptions): Promise<ExplanationResult> {
  // DB-first: Try smart retrieval
  let response: Awaited<ReturnType<typeof smartRetrieve>> | null = null
  try {
    response = await smartRetrieve(concept)
  } catch (error) {
    console.warn('[getSmartExplanation] DB query failed, using cache fallback:', error)
    response = null
  }

  if (response?.status === 'found' && response.results.length > 0) {
    const result = response.results[0]
    let explanation: string

    if ('header_path' in result && result.header_path) {
      // Phase 2 chunk result
      explanation = `${result.header_path}: ${result.snippet}`
    } else {
      // Phase 1 doc result
      explanation = result.snippet?.split('\n\n')[0] || result.snippet || ''
    }

    return {
      explanation,
      docSlug: result.doc_slug,
      chunkId: 'chunkId' in result ? result.chunkId : undefined,
      fromCache: false,
    }
  }

  if (response?.status === 'ambiguous' && response.results?.length > 1) {
    // Step 3: For definitional queries, auto-select concept doc if available
    if (options?.isDefinitionalQuery) {
      const conceptResult = response.results.find(r => r.doc_slug.startsWith('concepts/'))
      if (conceptResult) {
        // Auto-select the concept doc without showing pills
        const explanation = 'header_path' in conceptResult && conceptResult.header_path
          ? `${conceptResult.header_path}: ${conceptResult.snippet}`
          : conceptResult.snippet?.split('\n\n')[0] || conceptResult.snippet || ''

        return {
          explanation,
          docSlug: conceptResult.doc_slug,
          chunkId: 'chunkId' in conceptResult ? conceptResult.chunkId : undefined,
          fromCache: false,
          status: 'found',  // Treat as found, not ambiguous
        }
      }
    }

    // Default: return options for pills (no definitional preference or no concept match)
    return {
      explanation: response.clarification || null,
      docSlug: response.results[0].doc_slug,
      fromCache: false,
      status: 'ambiguous',
      options: response.results.slice(0, 2).map(r => ({
        docSlug: r.doc_slug,
        label: 'header_path' in r && r.header_path ? r.header_path : r.title,
        title: r.title,
      })),
    }
  }

  if (response?.status === 'weak' && response.results?.length > 0) {
    return {
      explanation: response.clarification || null,
      docSlug: response.results[0].doc_slug,
      fromCache: false,
      status: 'weak',
    }
  }

  // Fallback to cache only on error or no_match
  const cached = getCachedExplanation(concept)
  if (cached) {
    return {
      explanation: cached.explanation,
      docSlug: cached.docSlug,
      fromCache: true,
    }
  }

  return {
    explanation: null,
    fromCache: false,
  }
}

// =============================================================================
// Known Terms Builder (for app relevance gate)
// Per general-doc-retrieval-routing-plan.md (v4)
// =============================================================================

/**
 * Cache for known terms to avoid repeated DB queries
 */
let knownTermsCache: Set<string> | null = null
let knownTermsCacheTimestamp: number = 0
const KNOWN_TERMS_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Normalize a term for the knownTerms set.
 * Uses the same normalization as routing for consistent matching.
 */
function normalizeTermForKnown(term: string): string {
  return term
    .toLowerCase()
    .trim()
    .replace(/[-_/,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
}

/**
 * Build the knownTerms set from multiple sources:
 * 1. CORE_CONCEPTS keys
 * 2. docs_knowledge titles and keywords
 * 3. Widget registry names (passed from UI context)
 *
 * Per v4 plan: knownTerms must be built once (cached) and shared.
 */
export async function buildKnownTerms(widgetTitles?: string[]): Promise<Set<string>> {
  const now = Date.now()

  // Return cached if still valid
  if (knownTermsCache && (now - knownTermsCacheTimestamp) < KNOWN_TERMS_CACHE_TTL_MS) {
    // Add widget titles to cache if provided (they may change)
    if (widgetTitles?.length) {
      const withWidgets = new Set(knownTermsCache)
      for (const title of widgetTitles) {
        withWidgets.add(normalizeTermForKnown(title))
      }
      return withWidgets
    }
    return knownTermsCache
  }

  const terms = new Set<string>()

  // Source 1: CORE_CONCEPTS keys
  for (const key of Object.keys(CORE_CONCEPTS)) {
    terms.add(normalizeTermForKnown(key))
    // Also add individual tokens for multi-word concepts
    const tokens = key.split(/\s+/)
    for (const token of tokens) {
      if (token.length > 2) {
        terms.add(normalizeTermForKnown(token))
      }
    }
  }

  // Source 2: docs_knowledge titles and keywords
  try {
    const result = await serverPool.query(
      `SELECT title, keywords FROM docs_knowledge`
    )

    for (const row of result.rows) {
      // Add title
      if (row.title) {
        terms.add(normalizeTermForKnown(row.title))
        // Add title tokens
        const titleTokens = row.title.split(/\s+/)
        for (const token of titleTokens) {
          if (token.length > 2) {
            terms.add(normalizeTermForKnown(token))
          }
        }
      }

      // Add keywords
      if (row.keywords && Array.isArray(row.keywords)) {
        for (const keyword of row.keywords) {
          terms.add(normalizeTermForKnown(keyword))
        }
      }
    }
  } catch (error) {
    console.error('[KnownTerms] Error fetching docs:', error)
    // Continue with what we have
  }

  // Source 3: Widget titles (if provided)
  if (widgetTitles?.length) {
    for (const title of widgetTitles) {
      terms.add(normalizeTermForKnown(title))
    }
  }

  // Update cache
  knownTermsCache = terms
  knownTermsCacheTimestamp = now

  console.log(`[KnownTerms] Built ${terms.size} terms from sources`)

  return terms
}

/**
 * Get known terms synchronously (from cache only).
 * Returns null if cache is empty - caller should use buildKnownTerms() first.
 */
export function getKnownTermsSync(): Set<string> | null {
  if (knownTermsCache && (Date.now() - knownTermsCacheTimestamp) < KNOWN_TERMS_CACHE_TTL_MS) {
    return knownTermsCache
  }
  return null
}

/**
 * Clear the known terms cache (for testing or after doc updates)
 */
export function clearKnownTermsCache(): void {
  knownTermsCache = null
  knownTermsCacheTimestamp = 0
}
