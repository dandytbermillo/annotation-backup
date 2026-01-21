/**
 * Unified Retrieval API
 * POST /api/retrieve
 *
 * Part of: Unified Retrieval Prerequisites (Prereq 3)
 *
 * Routes retrieval requests to the appropriate corpus:
 * - corpus='docs': Documentation chunks (docs_knowledge_chunks)
 * - corpus='notes': User notes (items_knowledge_chunks)
 *
 * Future (Prereq 4): corpus='auto' will merge results from both corpora.
 *
 * Key design decisions:
 * - workspaceId is server-derived (not client input) for security
 * - Notes corpus requires workspace scoping for Option A isolation
 * - Docs corpus is workspace-agnostic (shared knowledge base)
 */

import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { withWorkspaceClient } from '@/lib/workspace/workspace-store'
import {
  retrieveChunks,
  retrieveByDocSlug,
  ChunkRetrievalResponse,
} from '@/lib/docs/keyword-retrieval'
import {
  retrieveItemChunks,
  retrieveByItemId,
  ItemChunkRetrievalResponse,
} from '@/lib/docs/items-retrieval'

// =============================================================================
// Types
// =============================================================================

type Corpus = 'docs' | 'notes'

interface UnifiedRetrieveRequest {
  corpus: Corpus
  query?: string
  // For direct lookup by ID
  resourceId?: string  // docSlug for docs, itemId for notes
  // V5 options
  excludeChunkIds?: string[]
  topK?: number
  fullContent?: boolean  // For "Show more" feature
  // Note: mode ('search' | 'explain') is intentionally omitted.
  // Use /api/docs/retrieve with mode='explain' for explanation-style responses.
  // This endpoint focuses on chunk retrieval (search mode).
}

// Unified result that includes corpus identifier
interface UnifiedResult {
  corpus: Corpus
  resourceId: string  // docSlug or itemId (canonical)
  docSlug?: string    // convenience alias when corpus='docs'
  itemId?: string     // convenience alias when corpus='notes'
  chunkId: string
  title: string       // doc title or item name
  path?: string       // item path (notes only)
  headerPath: string
  snippet: string
  score: number
  confidence?: number
  isHeadingOnly?: boolean
  bodyCharCount?: number
  nextChunkId?: string
  matchedTerms: string[]
}

interface UnifiedRetrieveResponse {
  success: boolean
  corpus: Corpus
  status: 'found' | 'ambiguous' | 'weak' | 'no_match'
  results: UnifiedResult[]
  clarification?: string
  confidence: number
  metrics?: {
    totalChunks: number
    matchedChunks: number
    dedupedChunks: number
    retrievalTimeMs: number
  }
}

// =============================================================================
// Adapters: Convert corpus-specific results to unified format
// =============================================================================

function adaptDocsResult(result: ChunkRetrievalResponse): UnifiedRetrieveResponse {
  return {
    success: true,
    corpus: 'docs',
    status: result.status,
    results: result.results.map(r => ({
      corpus: 'docs' as const,
      resourceId: r.doc_slug,
      docSlug: r.doc_slug,  // convenience alias for docs consumers
      chunkId: r.chunkId,
      title: r.title,
      headerPath: r.header_path,
      snippet: r.snippet,
      score: r.score,
      confidence: r.confidence,
      isHeadingOnly: r.isHeadingOnly,
      bodyCharCount: r.bodyCharCount,
      nextChunkId: r.nextChunkId,
      matchedTerms: r.matched_terms,
    })),
    clarification: result.clarification,
    confidence: result.confidence,
    metrics: result.metrics,
  }
}

function adaptNotesResult(result: ItemChunkRetrievalResponse): UnifiedRetrieveResponse {
  return {
    success: true,
    corpus: 'notes',
    status: result.status,
    results: result.results.map(r => ({
      corpus: 'notes' as const,
      resourceId: r.itemId,
      itemId: r.itemId,  // convenience alias for notes consumers
      chunkId: r.chunkId,
      title: r.itemName,
      path: r.itemPath,
      headerPath: r.headerPath,
      snippet: r.snippet,
      score: r.score,
      confidence: r.confidence,
      isHeadingOnly: r.isHeadingOnly,
      bodyCharCount: r.bodyCharCount,
      nextChunkId: r.nextChunkId,
      matchedTerms: r.matchedTerms,
    })),
    clarification: result.clarification,
    confidence: result.confidence,
    metrics: result.metrics,
  }
}

// =============================================================================
// Main Handler
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const body: UnifiedRetrieveRequest = await request.json()
    const {
      corpus,
      query,
      resourceId,
      excludeChunkIds = [],
      topK,
      fullContent,
    } = body

    // Validate corpus
    if (!corpus || !['docs', 'notes'].includes(corpus)) {
      return NextResponse.json(
        { error: 'corpus is required and must be "docs" or "notes"' },
        { status: 400 }
      )
    }

    // ==========================================================================
    // Docs corpus (workspace-agnostic)
    // ==========================================================================
    if (corpus === 'docs') {
      // Direct lookup by docSlug
      if (resourceId && typeof resourceId === 'string') {
        const result = await retrieveByDocSlug(resourceId, { fullContent: !!fullContent })
        return NextResponse.json(adaptDocsResult(result))
      }

      // Query-based retrieval
      if (!query || typeof query !== 'string') {
        return NextResponse.json(
          { error: 'query is required for search' },
          { status: 400 }
        )
      }

      const result = await retrieveChunks(query, {
        excludeChunkIds,
        topK,
      })
      return NextResponse.json(adaptDocsResult(result))
    }

    // ==========================================================================
    // Notes corpus (workspace-scoped)
    // ==========================================================================
    if (corpus === 'notes') {
      // Use withWorkspaceClient for server-derived workspaceId
      return await withWorkspaceClient(serverPool, async (client, workspaceId) => {
        // Direct lookup by itemId
        if (resourceId && typeof resourceId === 'string') {
          const result = await retrieveByItemId(resourceId, workspaceId, {
            fullContent: !!fullContent,
            client,
            excludeChunkIds, // Phase 2: Support follow-up expansion
          })
          return NextResponse.json(adaptNotesResult(result))
        }

        // Query-based retrieval
        if (!query || typeof query !== 'string') {
          return NextResponse.json(
            { error: 'query is required for search' },
            { status: 400 }
          )
        }

        const result = await retrieveItemChunks(query, {
          workspaceId,
          excludeChunkIds,
          topK,
          client,
        })
        return NextResponse.json(adaptNotesResult(result))
      })
    }

    // Should not reach here
    return NextResponse.json(
      { error: 'Invalid corpus' },
      { status: 400 }
    )
  } catch (error) {
    console.error('[API] Unified retrieve error:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve content' },
      { status: 500 }
    )
  }
}
