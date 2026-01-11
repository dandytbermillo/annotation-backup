/**
 * Documentation Seeding Service
 * Part of: cursor-style-doc-retrieval-plan.md (Phase 0 + Phase 2)
 *
 * Seeds documentation from the meta/documentation folder into the docs_knowledge table.
 * Phase 2: Also chunks documents into docs_knowledge_chunks for finer-grained retrieval.
 * Idempotent: safe to run multiple times, only updates if content changes.
 */

import { serverPool } from '@/lib/db/pool'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

// Documentation source path (relative to project root)
const DOCS_PATH = 'docs/proposal/chat-navigation/plan/panels/chat/meta/documentation'

// Target chunk size in tokens (approximate: 1 token ≈ 4 chars)
const TARGET_CHUNK_TOKENS = 400
const MAX_CHUNK_TOKENS = 500
const CHARS_PER_TOKEN = 4

interface DocMetadata {
  title: string
  keywords: string[]
}

interface DocEntry {
  slug: string
  category: string
  title: string
  content: string
  keywords: string[]
  contentHash: string
}

interface ChunkEntry {
  docSlug: string
  category: string
  title: string
  headerPath: string
  chunkIndex: number
  content: string
  keywords: string[]
  chunkHash: string
}

// Stopwords to exclude from auto-extracted keywords
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'and', 'or', 'but', 'if', 'so', 'than', 'that', 'this', 'it',
  'you', 'your', 'can', 'when', 'where', 'how', 'what', 'which',
  'overview', 'key', 'behaviors', 'example', 'questions', 'related',
  'concepts', 'appears', 'first', 'main', 'see', 'also',
])

/**
 * Auto-extract keywords from title and content
 */
function extractKeywords(title: string, content: string): string[] {
  const keywords: Set<string> = new Set()

  // Add title words (split on space, lowercase)
  const titleWords = title.toLowerCase().split(/\s+/)
  for (const word of titleWords) {
    const clean = word.replace(/[^a-z]/g, '')
    if (clean.length > 2 && !STOPWORDS.has(clean)) {
      keywords.add(clean)
    }
  }

  // Extract from ## headers
  const headers = content.match(/^##\s+(.+)$/gm) || []
  for (const header of headers) {
    const headerText = header.replace(/^##\s+/, '').toLowerCase()
    const words = headerText.split(/\s+/)
    for (const word of words) {
      const clean = word.replace(/[^a-z]/g, '')
      if (clean.length > 2 && !STOPWORDS.has(clean)) {
        keywords.add(clean)
      }
    }
  }

  // Extract from "Related concepts" line if present
  const relatedMatch = content.match(/^##\s*Related concepts?\s*\n(.+)$/im)
  if (relatedMatch) {
    const related = relatedMatch[1].split(/[,\s]+/)
    for (const term of related) {
      const clean = term.toLowerCase().replace(/[^a-z]/g, '')
      if (clean.length > 2 && !STOPWORDS.has(clean)) {
        keywords.add(clean)
      }
    }
  }

  return Array.from(keywords)
}

/**
 * Parse frontmatter from markdown content
 */
function parseFrontmatter(content: string): { metadata: DocMetadata; body: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/
  const match = content.match(frontmatterRegex)

  if (!match) {
    // No frontmatter, extract title from first heading
    const titleMatch = content.match(/^#\s+(.+)$/m)
    const title = titleMatch ? titleMatch[1] : 'Untitled'
    return {
      metadata: {
        title,
        keywords: extractKeywords(title, content), // Auto-extract
      },
      body: content,
    }
  }

  const [, frontmatter, body] = match
  const metadata: DocMetadata = { title: '', keywords: [] }

  // Parse YAML-like frontmatter
  const lines = frontmatter.split('\n')
  for (const line of lines) {
    const titleMatch = line.match(/^title:\s*(.+)$/)
    if (titleMatch) {
      metadata.title = titleMatch[1].trim()
    }

    const keywordsMatch = line.match(/^keywords:\s*\[(.+)\]$/)
    if (keywordsMatch) {
      metadata.keywords = keywordsMatch[1]
        .split(',')
        .map(k => k.trim().replace(/['"]/g, ''))
    }
  }

  // Fallback: extract title from first heading if not in frontmatter
  if (!metadata.title) {
    const titleMatch = body.match(/^#\s+(.+)$/m)
    metadata.title = titleMatch ? titleMatch[1] : 'Untitled'
  }

  // Auto-extract keywords if none in frontmatter
  if (metadata.keywords.length === 0) {
    metadata.keywords = extractKeywords(metadata.title, body)
  }

  return { metadata, body }
}

/**
 * Compute MD5 hash of content for change detection
 */
function computeHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex')
}

/**
 * Load all documentation files from the documentation directory
 */
export function loadDocsFromFilesystem(basePath: string): DocEntry[] {
  const docs: DocEntry[] = []
  const docsPath = path.join(basePath, DOCS_PATH)

  if (!fs.existsSync(docsPath)) {
    console.warn(`[SeedDocs] Documentation directory not found: ${docsPath}`)
    return docs
  }

  // Read categories (subdirectories)
  const categories = fs.readdirSync(docsPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)

  for (const category of categories) {
    const categoryPath = path.join(docsPath, category)
    const files = fs.readdirSync(categoryPath)
      .filter(f => f.endsWith('.md'))

    for (const file of files) {
      const filePath = path.join(categoryPath, file)
      const content = fs.readFileSync(filePath, 'utf-8')
      const slug = file.replace(/\.md$/, '')

      const { metadata, body } = parseFrontmatter(content)

      docs.push({
        slug: `${category}/${slug}`,
        category,
        title: metadata.title,
        content: body.trim(),
        keywords: metadata.keywords,
        contentHash: computeHash(content),
      })
    }
  }

  return docs
}

/**
 * Seed documents into the database
 * Upserts by slug, only updates if content_hash differs
 */
export async function seedDocs(basePath?: string): Promise<{ inserted: number; updated: number; unchanged: number }> {
  const projectRoot = basePath || process.cwd()
  const docs = loadDocsFromFilesystem(projectRoot)

  let inserted = 0
  let updated = 0
  let unchanged = 0

  for (const doc of docs) {
    try {
      // Check if doc exists and get its hash
      const existing = await serverPool.query(
        'SELECT id, content_hash FROM docs_knowledge WHERE slug = $1',
        [doc.slug]
      )

      if (existing.rows.length === 0) {
        // Insert new doc
        await serverPool.query(
          `INSERT INTO docs_knowledge (slug, category, title, content, keywords, content_hash)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [doc.slug, doc.category, doc.title, doc.content, doc.keywords, doc.contentHash]
        )
        inserted++
        console.log(`[SeedDocs] Inserted: ${doc.slug}`)
      } else if (existing.rows[0].content_hash !== doc.contentHash) {
        // Update if hash differs
        await serverPool.query(
          `UPDATE docs_knowledge
           SET category = $2, title = $3, content = $4, keywords = $5, content_hash = $6, updated_at = NOW()
           WHERE slug = $1`,
          [doc.slug, doc.category, doc.title, doc.content, doc.keywords, doc.contentHash]
        )
        updated++
        console.log(`[SeedDocs] Updated: ${doc.slug}`)
      } else {
        unchanged++
      }
    } catch (error) {
      console.error(`[SeedDocs] Error processing ${doc.slug}:`, error)
    }
  }

  console.log(`[SeedDocs] Complete: ${inserted} inserted, ${updated} updated, ${unchanged} unchanged`)
  return { inserted, updated, unchanged }
}

/**
 * Get all docs from database (for retrieval)
 */
export async function getAllDocs(): Promise<DocEntry[]> {
  const result = await serverPool.query(
    `SELECT slug, category, title, content, keywords, content_hash as "contentHash"
     FROM docs_knowledge
     ORDER BY category, title`
  )
  return result.rows
}

/**
 * Get doc by slug
 */
export async function getDocBySlug(slug: string): Promise<DocEntry | null> {
  const result = await serverPool.query(
    `SELECT slug, category, title, content, keywords, content_hash as "contentHash"
     FROM docs_knowledge
     WHERE slug = $1`,
    [slug]
  )
  return result.rows[0] || null
}

// =============================================================================
// Phase 2: Chunking Pipeline
// =============================================================================

interface HeaderSection {
  header: string
  level: number
  content: string
}

/**
 * Parse markdown into sections by headers
 */
function parseMarkdownSections(content: string): HeaderSection[] {
  const sections: HeaderSection[] = []
  const lines = content.split('\n')

  let currentHeader = ''
  let currentLevel = 0
  let currentContent: string[] = []

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/)

    if (headerMatch) {
      // Save previous section if exists
      if (currentContent.length > 0 || currentHeader) {
        sections.push({
          header: currentHeader,
          level: currentLevel,
          content: currentContent.join('\n').trim(),
        })
      }

      currentHeader = headerMatch[2]
      currentLevel = headerMatch[1].length
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
 * e.g., "Home > Overview" or "Widgets > Quick Links > Editing"
 */
function buildHeaderPath(docTitle: string, sections: HeaderSection[], currentIndex: number): string {
  const path: string[] = [docTitle]
  const currentSection = sections[currentIndex]

  if (!currentSection || !currentSection.header) {
    return docTitle
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

  // Add current header
  path.push(...parentStack, currentSection.header)

  return path.join(' > ')
}

/**
 * Estimate token count (approximate: 1 token ≈ 4 chars)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Chunk a document into smaller pieces
 * Strategy: Split by ## headers, then by paragraphs if still too large
 */
export function chunkDocument(doc: DocEntry): ChunkEntry[] {
  const chunks: ChunkEntry[] = []
  const sections = parseMarkdownSections(doc.content)

  let chunkIndex = 0

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]
    const headerPath = buildHeaderPath(doc.title, sections, i)

    // Skip empty sections
    if (!section.content.trim() && !section.header) {
      continue
    }

    const sectionContent = section.header
      ? `## ${section.header}\n${section.content}`
      : section.content

    const tokens = estimateTokens(sectionContent)

    if (tokens <= MAX_CHUNK_TOKENS) {
      // Section fits in one chunk
      chunks.push({
        docSlug: doc.slug,
        category: doc.category,
        title: doc.title,
        headerPath,
        chunkIndex,
        content: sectionContent.trim(),
        keywords: doc.keywords, // Inherit doc keywords
        chunkHash: computeHash(sectionContent),
      })
      chunkIndex++
    } else {
      // Section too large, split by paragraphs
      const paragraphs = sectionContent.split(/\n\n+/)
      let currentChunk: string[] = []
      let currentTokens = 0

      for (const para of paragraphs) {
        const paraTokens = estimateTokens(para)

        if (currentTokens + paraTokens > TARGET_CHUNK_TOKENS && currentChunk.length > 0) {
          // Save current chunk
          const chunkContent = currentChunk.join('\n\n')
          chunks.push({
            docSlug: doc.slug,
            category: doc.category,
            title: doc.title,
            headerPath,
            chunkIndex,
            content: chunkContent.trim(),
            keywords: doc.keywords,
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
          docSlug: doc.slug,
          category: doc.category,
          title: doc.title,
          headerPath,
          chunkIndex,
          content: chunkContent.trim(),
          keywords: doc.keywords,
          chunkHash: computeHash(chunkContent),
        })
        chunkIndex++
      }
    }
  }

  // If no chunks were created (e.g., very short doc), create one chunk for entire doc
  if (chunks.length === 0) {
    chunks.push({
      docSlug: doc.slug,
      category: doc.category,
      title: doc.title,
      headerPath: doc.title,
      chunkIndex: 0,
      content: doc.content.trim(),
      keywords: doc.keywords,
      chunkHash: computeHash(doc.content),
    })
  }

  return chunks
}

/**
 * Seed chunks into docs_knowledge_chunks table
 * Upserts by (doc_slug, chunk_index), updates if chunk_hash differs
 * Cleans up stale chunks (removed sections)
 */
export async function seedChunks(docs: DocEntry[]): Promise<{ inserted: number; updated: number; unchanged: number; deleted: number }> {
  let inserted = 0
  let updated = 0
  let unchanged = 0
  let deleted = 0

  for (const doc of docs) {
    try {
      const chunks = chunkDocument(doc)
      const maxChunkIndex = chunks.length - 1

      // Upsert each chunk
      for (const chunk of chunks) {
        const existing = await serverPool.query(
          'SELECT id, chunk_hash FROM docs_knowledge_chunks WHERE doc_slug = $1 AND chunk_index = $2',
          [chunk.docSlug, chunk.chunkIndex]
        )

        if (existing.rows.length === 0) {
          // Insert new chunk
          await serverPool.query(
            `INSERT INTO docs_knowledge_chunks
             (doc_slug, category, title, header_path, chunk_index, content, keywords, chunk_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [chunk.docSlug, chunk.category, chunk.title, chunk.headerPath,
             chunk.chunkIndex, chunk.content, chunk.keywords, chunk.chunkHash]
          )
          inserted++
        } else if (existing.rows[0].chunk_hash !== chunk.chunkHash) {
          // Update if hash differs
          await serverPool.query(
            `UPDATE docs_knowledge_chunks
             SET category = $2, title = $3, header_path = $4, content = $5,
                 keywords = $6, chunk_hash = $7, updated_at = NOW()
             WHERE doc_slug = $1 AND chunk_index = $8`,
            [chunk.docSlug, chunk.category, chunk.title, chunk.headerPath,
             chunk.content, chunk.keywords, chunk.chunkHash, chunk.chunkIndex]
          )
          updated++
        } else {
          unchanged++
        }
      }

      // Delete stale chunks (chunk_index > maxChunkIndex for this doc)
      const deleteResult = await serverPool.query(
        'DELETE FROM docs_knowledge_chunks WHERE doc_slug = $1 AND chunk_index > $2',
        [doc.slug, maxChunkIndex]
      )
      deleted += deleteResult.rowCount || 0

      if (chunks.length > 0) {
        console.log(`[SeedChunks] ${doc.slug}: ${chunks.length} chunks`)
      }
    } catch (error) {
      console.error(`[SeedChunks] Error processing ${doc.slug}:`, error)
    }
  }

  console.log(`[SeedChunks] Complete: ${inserted} inserted, ${updated} updated, ${unchanged} unchanged, ${deleted} deleted`)
  return { inserted, updated, unchanged, deleted }
}

/**
 * Seed both docs and chunks (Phase 2 combined seeding)
 */
export async function seedDocsAndChunks(basePath?: string): Promise<{
  docs: { inserted: number; updated: number; unchanged: number };
  chunks: { inserted: number; updated: number; unchanged: number; deleted: number };
}> {
  const projectRoot = basePath || process.cwd()
  const docs = loadDocsFromFilesystem(projectRoot)

  // Seed docs first (Phase 0/1)
  const docsResult = await seedDocs(basePath)

  // Seed chunks (Phase 2)
  const chunksResult = await seedChunks(docs)

  return {
    docs: docsResult,
    chunks: chunksResult,
  }
}

/**
 * Get all chunks from database (for Phase 2 retrieval)
 */
export async function getAllChunks(): Promise<ChunkEntry[]> {
  const result = await serverPool.query(
    `SELECT doc_slug as "docSlug", category, title, header_path as "headerPath",
            chunk_index as "chunkIndex", content, keywords, chunk_hash as "chunkHash"
     FROM docs_knowledge_chunks
     ORDER BY doc_slug, chunk_index`
  )
  return result.rows
}

/**
 * Get chunks by doc slug
 */
export async function getChunksByDocSlug(docSlug: string): Promise<ChunkEntry[]> {
  const result = await serverPool.query(
    `SELECT doc_slug as "docSlug", category, title, header_path as "headerPath",
            chunk_index as "chunkIndex", content, keywords, chunk_hash as "chunkHash"
     FROM docs_knowledge_chunks
     WHERE doc_slug = $1
     ORDER BY chunk_index`,
    [docSlug]
  )
  return result.rows
}
