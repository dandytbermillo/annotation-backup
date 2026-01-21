/**
 * Items (Notes) Retrieval Service
 * Part of: Unified Retrieval Prerequisites (Prereq 3)
 *
 * Provides keyword-based retrieval for user notes stored in items_knowledge_chunks.
 * Mirrors the docs retrieval pattern in keyword-retrieval.ts.
 *
 * Key differences from docs retrieval:
 * - Queries items_knowledge_chunks table (not docs_knowledge_chunks)
 * - Filters by workspace_id (required for Option A scoping)
 * - Returns itemId instead of docSlug
 * - corpus field is always 'notes'
 */

import { serverPool } from '@/lib/db/pool'
import { PoolClient } from 'pg'

// =============================================================================
// Configuration (mirrors keyword-retrieval.ts)
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

// De-dupe config
const MAX_CHUNKS_PER_ITEM = 2
const DEFAULT_TOP_K = 5

// V5 thresholds
const HEADING_ONLY_MAX_CHARS = 50

// =============================================================================
// Types
// =============================================================================

interface ItemChunkRow {
  item_id: string
  item_name: string
  item_path: string
  header_path: string
  chunk_index: number
  content: string
  keywords: string[]
  chunk_hash: string
  workspace_id: string
}

export interface ItemChunkRetrievalResult {
  itemId: string
  itemName: string
  itemPath: string
  chunkIndex: number
  headerPath: string
  snippet: string
  score: number
  rawScore: number
  chunkHash: string
  matchedTerms: string[]
  source: 'keyword'
  matchExplain?: string[]
  confidence?: number
  // V5 fields
  chunkId: string
  isHeadingOnly?: boolean
  bodyCharCount?: number
  nextChunkId?: string
  // Corpus identifier
  corpus: 'notes'
}

export interface ItemChunkRetrievalResponse {
  status: 'found' | 'ambiguous' | 'weak' | 'no_match'
  results: ItemChunkRetrievalResult[]
  clarification?: string
  confidence: number
  corpus: 'notes'
  metrics?: {
    totalChunks: number
    matchedChunks: number
    dedupedChunks: number
    retrievalTimeMs: number
  }
}

export interface RetrieveItemChunksOptions {
  workspaceId: string  // Required for Option A scoping
  topK?: number
  excludeChunkIds?: string[]
  itemId?: string  // Scope to specific item
  client?: PoolClient  // Optional: use existing connection
}

// =============================================================================
// Query Normalization (shared with keyword-retrieval.ts)
// =============================================================================

function normalizeQuery(query: string): string[] {
  let normalized = query.toLowerCase()

  // Strip trailing "work" pattern
  const howDoesWorkMatch = normalized.match(/^how does\s+(the\s+|a\s+|an\s+)?(.+?)\s+work$/)
  if (howDoesWorkMatch) {
    normalized = howDoesWorkMatch[2].trim()
  }

  // Tokenize
  const tokens = normalized
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0)

  // Filter stopwords
  const result: string[] = []
  for (const token of tokens) {
    if (STOPWORDS.has(token)) continue
    result.push(token)
  }

  // Conservative stemming
  return result.map(t => {
    if (t.length < 4) return t
    if (t.endsWith('ies')) return t.slice(0, -3) + 'y'
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

// =============================================================================
// Helpers
// =============================================================================

function extractSnippet(content: string, maxChars: number = 400): string {
  const trimmed = content.trim()
  if (trimmed.length <= maxChars) return trimmed

  let endIdx = maxChars
  const wordEnd = trimmed.lastIndexOf(' ', maxChars)
  if (wordEnd > maxChars * 0.7) {
    endIdx = wordEnd
  }

  let snippet = trimmed.slice(0, endIdx).trim()

  // Ensure body content if possible
  if (snippet.startsWith('#')) {
    const lines = snippet.split('\n')
    const hasBodyLine = lines.some(line => {
      const t = line.trim()
      return t.length > 0 && !t.startsWith('#')
    })

    if (!hasBodyLine) {
      const fullLines = trimmed.split('\n')
      let extendedSnippet = ''
      for (const line of fullLines) {
        extendedSnippet += (extendedSnippet ? '\n' : '') + line
        const t = line.trim()
        if (t.length > 0 && !t.startsWith('#')) {
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

function generateChunkId(itemId: string, chunkIndex: number): string {
  return `${itemId}#chunk-${chunkIndex}`
}

function stripMarkdownHeaders(text: string): string {
  return text
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .join('\n')
    .trim()
}

function calculateBodyCharCount(snippet: string): number {
  return stripMarkdownHeaders(snippet).length
}

function detectIsHeadingOnly(snippet: string): boolean {
  const trimmed = snippet.trim()
  if (!trimmed.startsWith('#')) return false
  const bodyChars = calculateBodyCharCount(snippet)
  return bodyChars < HEADING_ONLY_MAX_CHARS
}

// =============================================================================
// Scoring
// =============================================================================

function scoreChunk(chunk: ItemChunkRow, queryTokens: string[]): {
  score: number
  matchedTerms: string[]
  explain: string[]
} {
  let score = 0
  const matchedTerms: string[] = []
  const explain: string[] = []

  const nameLower = chunk.item_name.toLowerCase()
  const headerPathLower = chunk.header_path.toLowerCase()
  const contentLower = chunk.content.toLowerCase()
  const keywordsLower = chunk.keywords.map(k => k.toLowerCase())

  // Exact phrase match in name or header_path
  const queryPhrase = queryTokens.join(' ')
  if ((nameLower.includes(queryPhrase) || headerPathLower.includes(queryPhrase)) && queryTokens.length > 1) {
    score += SCORE_TITLE_EXACT
    matchedTerms.push(...queryTokens)
    explain.push(`Exact phrase "${queryPhrase}" in name/header: +${SCORE_TITLE_EXACT}`)
  }

  for (const token of queryTokens) {
    if (matchedTerms.includes(token)) continue

    // Name token match (equivalent to title)
    if (nameLower.includes(token)) {
      score += SCORE_TITLE_TOKEN
      matchedTerms.push(token)
      explain.push(`Token "${token}" in name: +${SCORE_TITLE_TOKEN}`)
      continue
    }

    // Header path match
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

  // Normalize by content length
  const contentTokenCount = contentLower.split(/\s+/).length
  let normalizedScore = score / Math.sqrt(Math.max(contentTokenCount / 50, 1))

  // Penalize header-only chunks
  const bodyText = stripMarkdownHeaders(chunk.content)
  if (bodyText.length < HEADING_ONLY_MAX_CHARS) {
    normalizedScore = normalizedScore * 0.1
    explain.push(`Header-only penalty: score * 0.1`)
  }

  return {
    score: Math.round(normalizedScore * 100) / 100,
    matchedTerms: [...new Set(matchedTerms)],
    explain,
  }
}

// =============================================================================
// De-duplication
// =============================================================================

function dedupeChunks(chunks: ItemChunkRetrievalResult[]): {
  results: ItemChunkRetrievalResult[]
  dedupedCount: number
} {
  const itemCounts: Record<string, number> = {}
  const results: ItemChunkRetrievalResult[] = []
  let dedupedCount = 0

  for (const chunk of chunks) {
    const count = itemCounts[chunk.itemId] || 0
    if (count < MAX_CHUNKS_PER_ITEM) {
      results.push(chunk)
      itemCounts[chunk.itemId] = count + 1
    } else {
      dedupedCount++
    }
  }

  return { results, dedupedCount }
}

// =============================================================================
// Main Retrieval Function
// =============================================================================

export async function retrieveItemChunks(
  query: string,
  options: RetrieveItemChunksOptions
): Promise<ItemChunkRetrievalResponse> {
  const { workspaceId, topK = DEFAULT_TOP_K, excludeChunkIds = [], itemId, client } = options
  const startTime = Date.now()
  const queryTokens = normalizeQuery(query)

  if (queryTokens.length === 0) {
    return {
      status: 'no_match',
      results: [],
      clarification: 'Which note would you like to search?',
      confidence: 0,
      corpus: 'notes',
    }
  }

  const excludeSet = new Set(excludeChunkIds)

  // Build query
  let dbQuery = `
    SELECT item_id, item_name, item_path, header_path, chunk_index, content, keywords, chunk_hash, workspace_id
    FROM items_knowledge_chunks
    WHERE workspace_id = $1
  `
  const queryParams: (string | null)[] = [workspaceId]

  if (itemId) {
    dbQuery += ` AND item_id = $2`
    queryParams.push(itemId)
  }

  // Use provided client or serverPool
  const db = client || serverPool
  const result = await db.query(dbQuery, queryParams)

  const chunks: ItemChunkRow[] = result.rows
  const totalChunks = chunks.length

  // Build max chunk index map for nextChunkId
  const maxChunkIndexByItem = new Map<string, number>()
  for (const chunk of chunks) {
    const current = maxChunkIndexByItem.get(chunk.item_id) ?? -1
    if (chunk.chunk_index > current) {
      maxChunkIndexByItem.set(chunk.item_id, chunk.chunk_index)
    }
  }

  // Score all chunks
  const scored: ItemChunkRetrievalResult[] = []

  for (const chunk of chunks) {
    const chunkId = generateChunkId(chunk.item_id, chunk.chunk_index)
    if (excludeSet.has(chunkId)) continue

    const { score, matchedTerms, explain } = scoreChunk(chunk, queryTokens)

    if (score > 0) {
      const snippet = extractSnippet(chunk.content)
      const maxIndex = maxChunkIndexByItem.get(chunk.item_id) ?? chunk.chunk_index

      scored.push({
        itemId: chunk.item_id,
        itemName: chunk.item_name,
        itemPath: chunk.item_path,
        chunkIndex: chunk.chunk_index,
        headerPath: chunk.header_path,
        snippet,
        score,
        rawScore: score,
        chunkHash: chunk.chunk_hash,
        matchedTerms,
        source: 'keyword',
        matchExplain: explain,
        chunkId,
        isHeadingOnly: detectIsHeadingOnly(snippet),
        bodyCharCount: calculateBodyCharCount(snippet),
        nextChunkId: chunk.chunk_index < maxIndex
          ? generateChunkId(chunk.item_id, chunk.chunk_index + 1)
          : undefined,
        corpus: 'notes',
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
    console.log(`[ItemsRetrieval] query="${query}" status=no_match latency=${noMatchMetrics.retrievalTimeMs}ms`)
    return {
      status: 'no_match',
      results: [],
      clarification: 'No matching notes found.',
      confidence: 0,
      corpus: 'notes',
      metrics: noMatchMetrics,
    }
  }

  // De-dupe and limit
  const { results: dedupedResults, dedupedCount } = dedupeChunks(scored)
  const topResults = dedupedResults.slice(0, topK)

  const topResult = topResults[0]
  const secondScore = topResults.length > 1 ? topResults[1].score : 0

  // Calculate confidence
  const confidence = secondScore > 0
    ? (topResult.score - secondScore) / topResult.score
    : 1

  topResult.confidence = confidence

  const metrics = {
    totalChunks,
    matchedChunks: scored.length,
    dedupedChunks: dedupedCount,
    retrievalTimeMs: Date.now() - startTime,
  }

  // Confidence rules
  const hasNameOrKeywordHit = topResult.matchExplain?.some(e =>
    e.includes('name') || e.includes('keywords') || e.includes('header_path')
  )

  if (topResult.matchedTerms.length < MIN_MATCHED_TERMS) {
    return {
      status: 'weak',
      results: topResults.slice(0, 3),
      clarification: `I'm not sure which note you mean. Are you asking about "${topResult.itemName}"?`,
      confidence,
      corpus: 'notes',
      metrics,
    }
  }

  if (!hasNameOrKeywordHit) {
    return {
      status: 'weak',
      results: topResults.slice(0, 3),
      clarification: `I found a possible match in "${topResult.itemName}". Is that what you're asking about?`,
      confidence,
      corpus: 'notes',
      metrics,
    }
  }

  if (topResult.score < MIN_SCORE) {
    return {
      status: 'weak',
      results: topResults.slice(0, 3),
      clarification: `I think you mean "${topResult.itemName}". Is that right?`,
      confidence,
      corpus: 'notes',
      metrics,
    }
  }

  // Same-item tie collapse
  if (topResults.length > 1 &&
      topResults[0].itemId === topResults[1].itemId &&
      (topResult.score - secondScore) < MIN_GAP) {

    // Cross-item ambiguity check
    const topItemId = topResults[0].itemId
    const topScore = topResults[0].score
    const crossItemCandidates = topResults.filter(r =>
      r.itemId !== topItemId &&
      (topScore - r.score) < MIN_GAP
    )
    const crossItemCandidate = crossItemCandidates.length > 0
      ? crossItemCandidates.reduce((best, curr) => curr.score > best.score ? curr : best)
      : null

    if (crossItemCandidate) {
      return {
        status: 'ambiguous',
        results: [topResults[0], crossItemCandidate],
        clarification: `Do you mean "${topResults[0].itemName}" or "${crossItemCandidate.itemName}"?`,
        confidence,
        corpus: 'notes',
        metrics,
      }
    }

    return {
      status: 'weak',
      results: [topResult],
      clarification: `I found info in "${topResult.itemName}". Is that what you meant?`,
      confidence,
      corpus: 'notes',
      metrics,
    }
  }

  // Cross-item ambiguity
  if (topResults.length > 1 && (topResult.score - secondScore) < MIN_GAP) {
    return {
      status: 'ambiguous',
      results: topResults.slice(0, 2),
      clarification: `Do you mean "${topResult.itemName}" or "${topResults[1].itemName}"?`,
      confidence,
      corpus: 'notes',
      metrics,
    }
  }

  if (confidence < MIN_CONFIDENCE) {
    return {
      status: 'ambiguous',
      results: topResults.slice(0, 2),
      clarification: `Do you mean "${topResult.itemName}" or "${topResults[1].itemName}"?`,
      confidence,
      corpus: 'notes',
      metrics,
    }
  }

  // Strong match
  console.log(`[ItemsRetrieval] query="${query}" status=found ` +
    `topScore=${topResult.score} confidence=${confidence.toFixed(2)} ` +
    `matched=${metrics.matchedChunks}/${metrics.totalChunks} deduped=${metrics.dedupedChunks} ` +
    `latency=${metrics.retrievalTimeMs}ms`)

  return {
    status: 'found',
    results: topResults,
    confidence,
    corpus: 'notes',
    metrics,
  }
}

/**
 * Retrieve chunks from a specific item by ID.
 * Used for disambiguation follow-up.
 */
export async function retrieveByItemId(
  itemId: string,
  workspaceId: string,
  options?: { fullContent?: boolean; client?: PoolClient; excludeChunkIds?: string[] }
): Promise<ItemChunkRetrievalResponse> {
  const startTime = Date.now()
  const { fullContent = false, client, excludeChunkIds = [] } = options || {}

  const db = client || serverPool

  // Build query with optional excludeChunkIds filter
  let query = `SELECT item_id, item_name, item_path, header_path, chunk_index, content, keywords, chunk_hash, workspace_id
     FROM items_knowledge_chunks
     WHERE item_id = $1 AND workspace_id = $2`
  const params: (string | string[])[] = [itemId, workspaceId]

  // Phase 2: Support excludeChunkIds for follow-up expansion
  if (excludeChunkIds.length > 0) {
    // Generate chunk IDs to exclude (format: itemId#chunk-chunkIndex)
    const excludeIndices = excludeChunkIds
      .filter(id => id.startsWith(itemId + '#chunk-'))
      .map(id => parseInt(id.split('#chunk-')[1], 10))
      .filter(idx => !isNaN(idx))

    if (excludeIndices.length > 0) {
      query += ` AND chunk_index NOT IN (${excludeIndices.map((_, i) => `$${i + 3}`).join(', ')})`
      params.push(...excludeIndices.map(String))
    }
  }

  query += ` ORDER BY chunk_index ASC`

  const result = await db.query(query, params)

  const chunks: ItemChunkRow[] = result.rows
  const totalChunks = chunks.length

  if (chunks.length === 0) {
    return {
      status: 'no_match',
      results: [],
      clarification: 'Note not found.',
      confidence: 0,
      corpus: 'notes',
      metrics: {
        totalChunks: 0,
        matchedChunks: 0,
        dedupedChunks: 0,
        retrievalTimeMs: Date.now() - startTime,
      },
    }
  }

  // Full content mode
  if (fullContent) {
    const combinedContent = chunks
      .map(c => c.content.trim())
      .join('\n\n')

    const firstChunk = chunks[0]
    const retrievalTimeMs = Date.now() - startTime

    const fullResult: ItemChunkRetrievalResult = {
      itemId: firstChunk.item_id,
      itemName: firstChunk.item_name,
      itemPath: firstChunk.item_path,
      chunkIndex: 0,
      headerPath: firstChunk.header_path,
      snippet: combinedContent,
      score: 10,
      rawScore: 10,
      chunkHash: firstChunk.chunk_hash,
      matchedTerms: ['full_item_lookup'],
      source: 'keyword',
      matchExplain: ['Full item lookup by ID'],
      chunkId: generateChunkId(firstChunk.item_id, 0),
      isHeadingOnly: false,
      bodyCharCount: combinedContent.length,
      nextChunkId: undefined,
      corpus: 'notes',
    }

    return {
      status: 'found',
      results: [fullResult],
      confidence: 1,
      corpus: 'notes',
      metrics: {
        totalChunks,
        matchedChunks: totalChunks,
        dedupedChunks: totalChunks,
        retrievalTimeMs,
      },
    }
  }

  // Standard mode: best single chunk
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

  const topResult: ItemChunkRetrievalResult = {
    itemId: bestChunk.item_id,
    itemName: bestChunk.item_name,
    itemPath: bestChunk.item_path,
    chunkIndex: bestChunk.chunk_index,
    headerPath: bestChunk.header_path,
    snippet,
    score: 10,
    rawScore: 10,
    chunkHash: bestChunk.chunk_hash,
    matchedTerms: ['direct_lookup'],
    source: 'keyword',
    matchExplain: ['Direct item lookup by ID'],
    chunkId: generateChunkId(bestChunk.item_id, bestChunk.chunk_index),
    isHeadingOnly: detectIsHeadingOnly(snippet),
    bodyCharCount: calculateBodyCharCount(snippet),
    nextChunkId: bestChunk.chunk_index < maxChunkIndex
      ? generateChunkId(bestChunk.item_id, bestChunk.chunk_index + 1)
      : undefined,
    corpus: 'notes',
  }

  return {
    status: 'found',
    results: [topResult],
    confidence: 1,
    corpus: 'notes',
    metrics: {
      totalChunks,
      matchedChunks: totalChunks,
      dedupedChunks: 1,
      retrievalTimeMs,
    },
  }
}
