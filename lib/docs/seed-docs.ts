/**
 * Documentation Seeding Service
 * Part of: cursor-style-doc-retrieval-plan.md (Phase 0)
 *
 * Seeds documentation from the meta/documentation folder into the docs_knowledge table.
 * Idempotent: safe to run multiple times, only updates if content changes.
 */

import { serverPool } from '@/lib/db/pool'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

// Documentation source path (relative to project root)
const DOCS_PATH = 'docs/proposal/chat-navigation/plan/panels/chat/meta/documentation'

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
