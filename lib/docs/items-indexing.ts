/**
 * Items (Notes/Files) Indexing Service
 * Part of: unified-retrieval-prereq-plan.md (Prerequisite 1: Indexing Strategy)
 *
 * Indexes notes from the items table into items_knowledge_chunks for unified retrieval.
 * Parallel implementation to seed-docs.ts but for user-generated content.
 *
 * Key differences from docs indexing:
 * - Source: items table (TipTap JSON) instead of markdown files
 * - Uses user_id for access control scoping
 * - Content extracted via extractFullText from TipTap JSON
 */

import { serverPool } from '@/lib/db/pool'
import { extractFullText } from '@/lib/utils/branch-preview'
import * as crypto from 'crypto'
import type { PoolClient } from 'pg'

// =============================================================================
// Configuration
// =============================================================================

// Target chunk size in tokens (approximate: 1 token ≈ 4 chars)
const TARGET_CHUNK_TOKENS = 400
const MAX_CHUNK_TOKENS = 500
const CHARS_PER_TOKEN = 4

// Stopwords to exclude from auto-extracted keywords
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'and', 'or', 'but', 'if', 'so', 'than', 'that', 'this', 'it',
  'you', 'your', 'can', 'when', 'where', 'how', 'what', 'which',
  'i', 'me', 'my', 'we', 'our', 'they', 'their',
])

// =============================================================================
// Types
// =============================================================================

interface ItemToIndex {
  id: string
  name: string
  path: string
  content: unknown  // TipTap JSON
  userId?: string
  workspaceId?: string
}

interface ItemChunk {
  itemId: string
  userId?: string
  workspaceId?: string
  itemName: string
  itemPath: string
  headerPath: string
  chunkIndex: number
  content: string
  keywords: string[]
  chunkHash: string
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Compute MD5 hash of content for change detection
 */
function computeHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex')
}

/**
 * Estimate token count (approximate: 1 token ≈ 4 chars)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Extract keywords from text content
 */
function extractKeywords(title: string, content: string): string[] {
  const keywords: Set<string> = new Set()

  // Add title words
  const titleWords = title.toLowerCase().split(/\s+/)
  for (const word of titleWords) {
    const clean = word.replace(/[^a-z0-9]/g, '')
    if (clean.length > 2 && !STOPWORDS.has(clean)) {
      keywords.add(clean)
    }
  }

  // Extract significant words from content (first 1000 chars for efficiency)
  const contentSample = content.slice(0, 1000).toLowerCase()
  const contentWords = contentSample.split(/\s+/)
  for (const word of contentWords) {
    const clean = word.replace(/[^a-z0-9]/g, '')
    if (clean.length > 3 && !STOPWORDS.has(clean)) {
      keywords.add(clean)
    }
  }

  return Array.from(keywords).slice(0, 20) // Limit to top 20 keywords
}

/**
 * Parse plain text into sections by detecting heading patterns
 * Supports: lines that are ALLCAPS, lines followed by === or ---, or short lines
 */
interface TextSection {
  header: string
  level: number
  content: string
}

function parseTextSections(text: string): TextSection[] {
  const sections: TextSection[] = []
  const lines = text.split('\n')

  let currentHeader = ''
  let currentLevel = 0
  let currentContent: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const nextLine = lines[i + 1] || ''
    const trimmed = line.trim()

    // Detect heading patterns:
    // 1. Markdown-style # headers (may survive TipTap extraction)
    // 2. Lines followed by === (H1) or --- (H2)
    // 3. Short ALL-CAPS lines (likely titles)
    const isMarkdownHeader = /^#{1,6}\s+/.test(trimmed)
    const isUnderlinedH1 = nextLine.trim().match(/^=+$/) && trimmed.length > 0
    const isUnderlinedH2 = nextLine.trim().match(/^-+$/) && trimmed.length > 0
    const isAllCapsTitle = trimmed.length > 0 && trimmed.length < 50 &&
                          trimmed === trimmed.toUpperCase() &&
                          /^[A-Z0-9\s]+$/.test(trimmed)

    if (isMarkdownHeader || isUnderlinedH1 || isUnderlinedH2 || isAllCapsTitle) {
      // Save previous section
      if (currentContent.length > 0 || currentHeader) {
        sections.push({
          header: currentHeader,
          level: currentLevel,
          content: currentContent.join('\n').trim(),
        })
      }

      // Parse new header
      if (isMarkdownHeader) {
        const match = trimmed.match(/^(#{1,6})\s+(.+)$/)
        currentHeader = match ? match[2] : trimmed
        currentLevel = match ? match[1].length : 1
      } else if (isUnderlinedH1) {
        currentHeader = trimmed
        currentLevel = 1
        i++ // Skip the === line
      } else if (isUnderlinedH2) {
        currentHeader = trimmed
        currentLevel = 2
        i++ // Skip the --- line
      } else {
        currentHeader = trimmed
        currentLevel = 1
      }
      currentContent = []
    } else {
      currentContent.push(line)
    }
  }

  // Save final section
  if (currentContent.length > 0 || currentHeader) {
    sections.push({
      header: currentHeader,
      level: currentLevel,
      content: currentContent.join('\n').trim(),
    })
  }

  return sections
}

/**
 * Build header path from section hierarchy
 */
function buildHeaderPath(itemName: string, sections: TextSection[], currentIndex: number): string {
  const path: string[] = [itemName]
  const currentSection = sections[currentIndex]

  if (!currentSection || !currentSection.header) {
    return itemName
  }

  // Walk backwards to find parent headers
  const parentStack: string[] = []
  let targetLevel = currentSection.level

  for (let i = currentIndex; i >= 0; i--) {
    const section = sections[i]
    if (section.header && section.level < targetLevel) {
      parentStack.unshift(section.header)
      targetLevel = section.level
    }
  }

  path.push(...parentStack, currentSection.header)
  return path.join(' > ')
}

// =============================================================================
// Chunking Pipeline
// =============================================================================

/**
 * Chunk an item into smaller pieces for indexing
 */
export function chunkItem(item: ItemToIndex): ItemChunk[] {
  const chunks: ItemChunk[] = []

  // Extract plain text from TipTap JSON
  const plainText = extractFullText(item.content)

  if (!plainText || plainText.trim().length === 0) {
    return chunks // No content to index
  }

  // Parse into sections
  const sections = parseTextSections(plainText)

  // If no sections found, treat entire content as one section
  if (sections.length === 0) {
    sections.push({
      header: '',
      level: 0,
      content: plainText,
    })
  }

  const keywords = extractKeywords(item.name, plainText)
  let chunkIndex = 0

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]
    const headerPath = buildHeaderPath(item.name, sections, i)

    // Skip empty sections
    if (!section.content.trim() && !section.header) {
      continue
    }

    const sectionContent = section.header
      ? `${section.header}\n${section.content}`
      : section.content

    const tokens = estimateTokens(sectionContent)

    if (tokens <= MAX_CHUNK_TOKENS) {
      // Section fits in one chunk
      chunks.push({
        itemId: item.id,
        userId: item.userId,
        workspaceId: item.workspaceId,
        itemName: item.name,
        itemPath: item.path,
        headerPath,
        chunkIndex,
        content: sectionContent.trim(),
        keywords,
        chunkHash: computeHash(sectionContent),
      })
      chunkIndex++
    } else {
      // Section too large, split by paragraphs (double newlines)
      const paragraphs = sectionContent.split(/\n\n+/)
      let currentChunk: string[] = []
      let currentTokens = 0

      for (const para of paragraphs) {
        const paraTokens = estimateTokens(para)

        if (currentTokens + paraTokens > TARGET_CHUNK_TOKENS && currentChunk.length > 0) {
          // Save current chunk
          const chunkContent = currentChunk.join('\n\n')
          chunks.push({
            itemId: item.id,
            userId: item.userId,
            workspaceId: item.workspaceId,
            itemName: item.name,
            itemPath: item.path,
            headerPath,
            chunkIndex,
            content: chunkContent.trim(),
            keywords,
            chunkHash: computeHash(chunkContent),
          })
          chunkIndex++
          currentChunk = [para]
          currentTokens = paraTokens
        } else {
          currentChunk.push(para)
          currentTokens += paraTokens
        }
      }

      // Save remaining content
      if (currentChunk.length > 0) {
        const chunkContent = currentChunk.join('\n\n')
        chunks.push({
          itemId: item.id,
          userId: item.userId,
          workspaceId: item.workspaceId,
          itemName: item.name,
          itemPath: item.path,
          headerPath,
          chunkIndex,
          content: chunkContent.trim(),
          keywords,
          chunkHash: computeHash(chunkContent),
        })
        chunkIndex++
      }
    }
  }

  return chunks
}

// =============================================================================
// Database Operations
// =============================================================================

/**
 * Index a single item (note) into items_knowledge_chunks
 * Upserts chunks by (item_id, chunk_index), only updates if hash differs
 */
export async function indexItem(item: ItemToIndex): Promise<{ inserted: number; updated: number; unchanged: number; deleted: number }> {
  const chunks = chunkItem(item)

  let inserted = 0
  let updated = 0
  let unchanged = 0

  // Get existing chunks for this item
  const existingResult = await serverPool.query(
    'SELECT chunk_index, chunk_hash FROM items_knowledge_chunks WHERE item_id = $1',
    [item.id]
  )
  const existingChunks = new Map(existingResult.rows.map(r => [r.chunk_index, r.chunk_hash]))

  // Track which chunk indices we've seen
  const seenIndices = new Set<number>()

  for (const chunk of chunks) {
    seenIndices.add(chunk.chunkIndex)
    const existingHash = existingChunks.get(chunk.chunkIndex)

    if (!existingHash) {
      // Insert new chunk
      await serverPool.query(
        `INSERT INTO items_knowledge_chunks (item_id, user_id, workspace_id, item_name, item_path, header_path, chunk_index, content, keywords, chunk_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [chunk.itemId, chunk.userId, chunk.workspaceId, chunk.itemName, chunk.itemPath, chunk.headerPath, chunk.chunkIndex, chunk.content, chunk.keywords, chunk.chunkHash]
      )
      inserted++
    } else if (existingHash !== chunk.chunkHash) {
      // Update if hash differs
      await serverPool.query(
        `UPDATE items_knowledge_chunks
         SET user_id = $2, workspace_id = $3, item_name = $4, item_path = $5, header_path = $6, content = $7, keywords = $8, chunk_hash = $9, updated_at = NOW()
         WHERE item_id = $1 AND chunk_index = $10`,
        [chunk.itemId, chunk.userId, chunk.workspaceId, chunk.itemName, chunk.itemPath, chunk.headerPath, chunk.content, chunk.keywords, chunk.chunkHash, chunk.chunkIndex]
      )
      updated++
    } else {
      unchanged++
    }
  }

  // Delete chunks that no longer exist (item content shrunk)
  const indicesToDelete = Array.from(existingChunks.keys()).filter(idx => !seenIndices.has(idx))
  let deleted = 0
  if (indicesToDelete.length > 0) {
    const result = await serverPool.query(
      'DELETE FROM items_knowledge_chunks WHERE item_id = $1 AND chunk_index = ANY($2)',
      [item.id, indicesToDelete]
    )
    deleted = result.rowCount || 0
  }

  return { inserted, updated, unchanged, deleted }
}

/**
 * Remove all chunks for an item (called when item is deleted)
 * Uses serverPool by default; pass a client for transaction safety
 */
export async function removeItemChunks(itemId: string, client?: PoolClient): Promise<number> {
  const db = client || serverPool
  const result = await db.query(
    'DELETE FROM items_knowledge_chunks WHERE item_id = $1',
    [itemId]
  )
  return result.rowCount || 0
}

/**
 * Index all notes in the items table
 * Used for initial bulk indexing or reindexing
 */
export async function indexAllItems(userId?: string): Promise<{ total: number; indexed: number; failed: number }> {
  // Query all notes (type = 'note')
  // Note: content may be in items.content OR latest document_saves row
  let query = `
    SELECT
      i.id,
      i.name,
      i.path,
      COALESCE(i.content, ds.content) as content,
      i.user_id as "userId",
      i.workspace_id as "workspaceId"
    FROM items i
    LEFT JOIN LATERAL (
      SELECT content FROM document_saves
      WHERE note_id = i.id
      ORDER BY created_at DESC
      LIMIT 1
    ) ds ON true
    WHERE i.type = 'note' AND i.deleted_at IS NULL
  `
  const params: string[] = []

  if (userId) {
    query += ` AND (i.user_id = $1 OR i.user_id IS NULL)`
    params.push(userId)
  }

  const result = await serverPool.query(query, params)
  const items: ItemToIndex[] = result.rows

  let indexed = 0
  let failed = 0

  for (const item of items) {
    try {
      // Skip items with no content
      if (!item.content) {
        continue
      }
      const stats = await indexItem(item)
      if (stats.inserted > 0 || stats.updated > 0) {
        indexed++
      }
    } catch (error) {
      console.error(`[ItemsIndexing] Error indexing item ${item.id}:`, error)
      failed++
    }
  }

  console.log(`[ItemsIndexing] Complete: ${indexed} indexed, ${failed} failed, ${items.length} total`)
  return { total: items.length, indexed, failed }
}

/**
 * Get items_knowledge_chunks count for verification
 */
export async function getChunksCount(userId?: string): Promise<number> {
  let query = 'SELECT COUNT(*) as count FROM items_knowledge_chunks'
  const params: string[] = []

  if (userId) {
    query += ' WHERE user_id = $1'
    params.push(userId)
  }

  const result = await serverPool.query(query, params)
  return parseInt(result.rows[0].count, 10)
}
