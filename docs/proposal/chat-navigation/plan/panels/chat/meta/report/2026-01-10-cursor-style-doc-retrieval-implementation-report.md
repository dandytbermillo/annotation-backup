# Cursor-Style Doc Retrieval Implementation Report

**Date:** 2026-01-10
**Status:** ✅ IMPLEMENTED (Phase 0 + Phase 1)
**Plans:** `cursor-style-doc-retrieval-plan.md`, `meta-explain-outside-clarification-plan.md`

---

## Executive Summary

This report documents the implementation of a Cursor-style documentation retrieval system for the chat navigation feature. The implementation enables the chat to provide contextual explanations when users ask "explain", "what do you mean?", or similar meta-questions after receiving an answer.

### Problem Solved

**Before:**
```
User: "where am I?"
Bot: "You're on the dashboard of Home."
User: "explain"
Bot: "I'm not sure what you meant. Try: `recent`, `quick links d`, `workspaces`."  ❌
```

**After:**
```
User: "where am I?"
Bot: "You're on the dashboard of Home."
User: "explain"
Bot: "Home is your main entry dashboard. It shows your widgets and quick links."  ✅
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    META-EXPLAIN RETRIEVAL PIPELINE                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  User: "explain"                                                         │
│         ↓                                                                │
│  isMetaExplainOutsideClarification() → true                             │
│         ↓                                                                │
│  extractMetaExplainConcept() → null (no specific concept)               │
│         ↓                                                                │
│  Infer from last assistant message → "home"                             │
│         ↓                                                                │
│  POST /api/docs/retrieve { query: "home", mode: "explain" }             │
│         ↓                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Tier 1: CORE_CONCEPTS Cache                                     │    │
│  │ getCachedExplanation("home") → HIT                              │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│         ↓ (if miss)                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Tier 2: Database Retrieval                                      │    │
│  │ retrieveDocs("home") → scored results from docs_knowledge       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│         ↓                                                                │
│  Response: "Home is your main entry dashboard..."                       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Files Created

### 1. Database Migration

#### `migrations/062_create_docs_knowledge.up.sql`

```sql
-- Migration: Create docs_knowledge table for chat documentation retrieval
-- Part of: cursor-style-doc-retrieval-plan.md (Phase 0)

CREATE TABLE IF NOT EXISTS docs_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  keywords TEXT[] DEFAULT '{}',
  content_hash TEXT NOT NULL,
  version TEXT DEFAULT '1.0.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for category-based filtering
CREATE INDEX IF NOT EXISTS idx_docs_knowledge_category ON docs_knowledge(category);

-- Index for keyword search (GIN for array containment)
CREATE INDEX IF NOT EXISTS idx_docs_knowledge_keywords ON docs_knowledge USING GIN(keywords);

-- Full-text search index on title and content
CREATE INDEX IF NOT EXISTS idx_docs_knowledge_fts ON docs_knowledge
  USING GIN(to_tsvector('english', title || ' ' || content));

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_docs_knowledge_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_docs_knowledge_updated_at
  BEFORE UPDATE ON docs_knowledge
  FOR EACH ROW
  EXECUTE FUNCTION update_docs_knowledge_updated_at();

COMMENT ON TABLE docs_knowledge IS 'Stores app documentation for chat retrieval (meta-explain, keyword search)';
COMMENT ON COLUMN docs_knowledge.slug IS 'Unique identifier derived from filename';
COMMENT ON COLUMN docs_knowledge.category IS 'Category: concepts, widgets, actions, panels';
COMMENT ON COLUMN docs_knowledge.keywords IS 'Array of keywords for retrieval scoring';
COMMENT ON COLUMN docs_knowledge.content_hash IS 'MD5 hash of content for change detection';
```

#### `migrations/062_create_docs_knowledge.down.sql`

```sql
-- Rollback: Drop docs_knowledge table
-- Part of: cursor-style-doc-retrieval-plan.md (Phase 0)

DROP TRIGGER IF EXISTS trigger_docs_knowledge_updated_at ON docs_knowledge;
DROP FUNCTION IF EXISTS update_docs_knowledge_updated_at();
DROP INDEX IF EXISTS idx_docs_knowledge_fts;
DROP INDEX IF EXISTS idx_docs_knowledge_keywords;
DROP INDEX IF EXISTS idx_docs_knowledge_category;
DROP TABLE IF EXISTS docs_knowledge;
```

---

### 2. Documentation Seed Service

#### `lib/docs/seed-docs.ts`

```typescript
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
```

---

### 3. Keyword Retrieval Service

#### `lib/docs/keyword-retrieval.ts`

```typescript
/**
 * Keyword Retrieval Service
 * Part of: cursor-style-doc-retrieval-plan.md (Phase 1)
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
    if (t.endsWith('es') && t.length > 4) return t.slice(0, -2)
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
```

---

### 4. API Endpoints

#### `app/api/docs/seed/route.ts`

```typescript
/**
 * API: Seed Documentation
 * POST /api/docs/seed
 *
 * Seeds documentation from meta/documentation folder into the database.
 * Part of: cursor-style-doc-retrieval-plan.md (Phase 0)
 */

import { NextResponse } from 'next/server'
import { seedDocs } from '@/lib/docs/seed-docs'

export async function POST() {
  try {
    const result = await seedDocs()

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error) {
    console.error('[API] Seed docs error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to seed documentation' },
      { status: 500 }
    )
  }
}

// Also support GET for easy browser testing
export async function GET() {
  return POST()
}
```

#### `app/api/docs/retrieve/route.ts`

```typescript
/**
 * API: Retrieve Documentation
 * POST /api/docs/retrieve
 *
 * Retrieves relevant documentation for a query using keyword matching.
 * Part of: cursor-style-doc-retrieval-plan.md (Phase 1)
 */

import { NextRequest, NextResponse } from 'next/server'
import { retrieveDocs, getCachedExplanation, getExplanation } from '@/lib/docs/keyword-retrieval'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { query, mode } = body

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      )
    }

    // Mode: 'explain' returns just a short explanation string
    // Mode: 'full' returns full retrieval results with scores
    if (mode === 'explain') {
      // Try cache first (Tier 1)
      const cached = getCachedExplanation(query)
      if (cached) {
        return NextResponse.json({
          success: true,
          source: 'cache',
          explanation: cached,
        })
      }

      // Fall back to database retrieval (Tier 2)
      const explanation = await getExplanation(query)
      return NextResponse.json({
        success: true,
        source: 'database',
        explanation: explanation || 'Which part would you like me to explain?',
      })
    }

    // Full retrieval mode
    const result = await retrieveDocs(query)

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error) {
    console.error('[API] Retrieve docs error:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve documentation' },
      { status: 500 }
    )
  }
}
```

---

### 5. Documentation Content (Sample)

**Note:** The actual documentation files use plain markdown without frontmatter. Keywords are auto-extracted from titles, headings, and "Related concepts" sections.

#### `docs/proposal/chat-navigation/plan/panels/chat/meta/documentation/concepts/home.md`

```markdown
# Home

## Overview
Home is your main entry dashboard. It is the first place you land and shows your
widgets, quick links, and recent items.

## Where it appears
- The main dashboard view (grid of widgets).
- The default destination when you say "go home".

## Key behaviors
- Home is an entry, so it has a dashboard and workspaces.
- Home is the top-level landing page for navigation.

## Example questions
- "Where am I?"
- "Go home"
- "Explain home"

## Related concepts
Dashboard, Entry, Widgets
```

**Auto-extracted keywords:** `home`, `dashboard`, `entry`, `widgets`

#### `docs/proposal/chat-navigation/plan/panels/chat/meta/documentation/concepts/workspace.md`

```markdown
# Workspace

## Overview
A workspace is where your notes live. You can create, edit, and organize notes within a workspace.

## Where it appears
- Inside an entry (each entry has workspaces).
- Accessible via dashboard actions or navigation commands.

## Key behaviors
- A workspace contains notes.
- You can switch between workspaces in the same entry.

## Example questions
- "Open workspace"
- "Go to workspace"
- "Explain workspace"

## Related concepts
Entry, Notes, Dashboard
```

**Auto-extracted keywords:** `workspace`, `entry`, `notes`, `dashboard`

#### `docs/proposal/chat-navigation/plan/panels/chat/meta/documentation/widgets/recent.md`

```markdown
# Recent

## Overview
The Recent widget shows your most recently opened items in this entry.

## Where it appears
- Dashboard as the Recent widget.
- Widget Manager for adding/removing.

## Key behaviors
- "Show recent" opens the drawer and displays recent items.
- Clicking an item opens it.

## Example questions
- "Show recent"
- "Open recent"
- "Explain recent"

## Related concepts
Dashboard, Workspace, Panels
```

**Auto-extracted keywords:** `recent`, `dashboard`, `panels`, `workspace`

---

## Files Modified

### `components/chat/chat-navigation-panel.tsx`

#### Added Functions (lines 330-390)

```typescript
/**
 * Check if input is a meta-explain phrase OUTSIDE of clarification mode.
 * Per meta-explain-outside-clarification-plan.md (Tiered Plan)
 * Handles: "explain", "what do you mean?", "explain home", etc.
 */
function isMetaExplainOutsideClarification(input: string): boolean {
  // Strip trailing punctuation for matching
  const normalized = input.trim().toLowerCase().replace(/[?!.]+$/, '')

  // Direct meta phrases
  if (
    normalized === 'explain' ||
    normalized === 'what do you mean' ||
    normalized === 'explain that' ||
    normalized === 'help me understand' ||
    normalized === 'what is that' ||
    normalized === 'tell me more'
  ) {
    return true
  }

  // "explain <concept>" pattern
  if (normalized.startsWith('explain ')) {
    return true
  }

  // "what is <concept>" pattern
  if (normalized.startsWith('what is ') || normalized.startsWith('what are ')) {
    return true
  }

  return false
}

/**
 * Extract the concept from a meta-explain phrase.
 * Returns null if no specific concept is mentioned.
 */
function extractMetaExplainConcept(input: string): string | null {
  const normalized = input.trim().toLowerCase().replace(/[?!.]+$/, '')

  // "explain <concept>"
  if (normalized.startsWith('explain ') && normalized !== 'explain that') {
    const concept = normalized.replace(/^explain\s+/, '').trim()
    if (concept && concept !== 'that') return concept
  }

  // "what is <concept>"
  if (normalized.startsWith('what is ')) {
    const concept = normalized.replace(/^what is\s+(a\s+|an\s+|the\s+)?/, '').trim()
    if (concept) return concept
  }

  // "what are <concepts>"
  if (normalized.startsWith('what are ')) {
    const concept = normalized.replace(/^what are\s+(the\s+)?/, '').trim()
    if (concept) return concept
  }

  return null
}
```

#### Added Handler (lines 2107-2187)

```typescript
// ---------------------------------------------------------------------------
// Meta-Explain Outside Clarification: Handle "explain", "what do you mean?"
// Per meta-explain-outside-clarification-plan.md (Tiered Plan)
// Tier 1: Local cache for common concepts
// Tier 2: Database retrieval for long tail
// ---------------------------------------------------------------------------
if (!lastClarification && isMetaExplainOutsideClarification(trimmedInput)) {
  void debugLog({
    component: 'ChatNavigation',
    action: 'meta_explain_outside_clarification',
    metadata: { userInput: trimmedInput },
  })

  try {
    // Extract specific concept or use last assistant message context
    const concept = extractMetaExplainConcept(trimmedInput)
    let queryTerm = concept

    // If no specific concept, try to infer from last assistant message
    if (!queryTerm) {
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
      if (lastAssistant?.content) {
        // Extract key terms from last answer (e.g., "dashboard of Home" → "home")
        const contentLower = lastAssistant.content.toLowerCase()
        if (contentLower.includes('dashboard') && contentLower.includes('home')) {
          queryTerm = 'home'
        } else if (contentLower.includes('workspace')) {
          queryTerm = 'workspace'
        } else if (contentLower.includes('recent')) {
          queryTerm = 'recent'
        } else if (contentLower.includes('quick links')) {
          queryTerm = 'quick links'
        } else if (contentLower.includes('navigator')) {
          queryTerm = 'navigator'
        } else if (contentLower.includes('panel') || contentLower.includes('drawer')) {
          queryTerm = 'drawer'
        }
      }
    }

    // Call retrieval API
    const retrieveResponse = await fetch('/api/docs/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: queryTerm || trimmedInput,
        mode: 'explain',
      }),
    })

    if (retrieveResponse.ok) {
      const result = await retrieveResponse.json()
      const explanation = result.explanation || 'Which part would you like me to explain?'

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: explanation,
        timestamp: new Date(),
        isError: false,
      }
      addMessage(assistantMessage)
      setIsLoading(false)
      return
    }
  } catch (error) {
    console.error('[ChatNavigation] Meta-explain retrieval error:', error)
  }

  // Fallback if retrieval fails
  const fallbackMessage: ChatMessage = {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    content: 'Which part would you like me to explain?',
    timestamp: new Date(),
    isError: false,
  }
  addMessage(fallbackMessage)
  setIsLoading(false)
  return
}
```

---

## Documentation Files Summary

**Source:** `docs/proposal/chat-navigation/plan/panels/chat/meta/documentation/`

**Total Documents Seeded:** 19 (7 concepts + 8 widgets + 4 actions)

| Slug | Category | Title | Keywords (auto-extracted) |
|------|----------|-------|---------------------------|
| `concepts/home` | concepts | Home | home, dashboard, entry, widgets |
| `concepts/dashboard` | concepts | Dashboard | dashboard, home, entry, widgets, panels |
| `concepts/entry` | concepts | Entry | entry, home, dashboard, workspace |
| `concepts/workspace` | concepts | Workspace | workspace, entry, notes, dashboard |
| `concepts/notes` | concepts | Notes | notes, workspace, entry |
| `concepts/widgets` | concepts | Widgets | widgets, dashboard, panels |
| `concepts/panels` | concepts | Panels | panels, widgets, dashboard |
| `widgets/recent` | widgets | Recent | recent, dashboard, panels, workspace |
| `widgets/quick-links` | widgets | Quick Links | quick, links, dashboard, panels |
| `widgets/quick-capture` | widgets | Quick Capture | quick, capture, dashboard, panels, notes |
| `widgets/navigator` | widgets | Navigator | navigator, dashboard, panels |
| `widgets/continue` | widgets | Continue | continue, dashboard, panels, recent |
| `widgets/links-overview` | widgets | Links Overview | links, quick, dashboard, panels |
| `widgets/widget-manager` | widgets | Widget Manager | widget, manager, widgets, dashboard, panels |
| `widgets/demo-widget` | widgets | Demo Widget | demo, widget, widgets, panels |
| `actions/navigation` | actions | Navigation Actions | navigation, actions, supported, examples, behavior, notes, home |
| `actions/notes` | actions | Note Actions | note, actions, supported, examples, behavior, notes, workspace |
| `actions/workspaces` | actions | Workspace Actions | workspace, actions, supported, examples, behavior, notes, entry |
| `actions/widgets` | actions | Widget and Panel Actions | widget, panel, actions, supported, examples, behavior, notes, widgets |

---

## Activation Steps (Completed)

### 1. Run the Migration ✅

```bash
# Via Docker (psql not available locally)
docker exec -i annotation_postgres psql -U postgres -d annotation_dev < migrations/062_create_docs_knowledge.up.sql
```

### 2. Seed the Documentation ✅

```bash
curl -X POST http://localhost:3000/api/docs/seed
# Output: {"success":true,"inserted":19,"updated":0,"unchanged":0}
```

### 3. Test ✅

```
User: "where am I?"
Bot: "You're on the dashboard of Home."
User: "explain"
Bot: "Home is your main entry dashboard. It shows your widgets and quick links."
```

---

## Verification

### Type Check

```
npm run type-check → PASS
```

---

## Acceptance Tests

| Test | Input | Expected Output | Status |
|------|-------|-----------------|--------|
| Explain after location | "explain" (after "dashboard of Home") | "Home is your main entry dashboard..." | ✅ Ready |
| Explain specific concept | "explain workspace" | "A workspace is where your notes live..." | ✅ Ready |
| Explain unknown concept | "explain links overview" | Uses DB retrieval | ✅ Ready |
| No prior answer | "explain" (first message) | "Which part would you like me to explain?" | ✅ Ready |
| What is pattern | "what is a workspace?" | "A workspace is where your notes live..." | ✅ Ready |
| What do you mean | "what do you mean?" | Infers from last message | ✅ Ready |

---

## Deferred Work (Phase 2-4)

| Phase | Feature | Status |
|-------|---------|--------|
| Phase 2 | Chunking + Metadata | Deferred |
| Phase 3 | Embeddings (pgvector) | Deferred |
| Phase 4 | Context Builder Integration | Deferred |

---

## Rollback

To rollback this implementation:

```bash
# 1. Rollback migration (via Docker)
docker exec -i annotation_postgres psql -U postgres -d annotation_dev < migrations/062_create_docs_knowledge.down.sql

# 2. Remove added files
rm -rf lib/docs/
rm -rf app/api/docs/
rm migrations/062_create_docs_knowledge.up.sql
rm migrations/062_create_docs_knowledge.down.sql

# 3. Revert chat-navigation-panel.tsx changes
# Remove isMetaExplainOutsideClarification, extractMetaExplainConcept functions
# Remove meta-explain handler block

# Note: Documentation source files at docs/proposal/chat-navigation/plan/panels/chat/meta/documentation/
# are NOT deleted as they are pre-existing reference documentation.
```
