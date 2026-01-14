/**
 * API: Retrieve Documentation
 * POST /api/docs/retrieve
 *
 * Retrieves relevant documentation for a query using keyword matching.
 * Phase 1: Whole-doc retrieval
 * Phase 2: Chunk-level retrieval with header_path context
 *
 * Part of: cursor-style-doc-retrieval-plan.md (Phase 1 + Phase 2)
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getCachedExplanation,
  getSmartExplanation,
  smartRetrieve,
  retrieveChunks,
  retrieveDocs,
  retrieveByDocSlug,
} from '@/lib/docs/keyword-retrieval'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { query, mode, phase, docSlug, excludeChunkIds, scopeDocSlug } = body

    // DocSlug mode: retrieve specific doc by slug (disambiguation follow-up)
    // Per general-doc-retrieval-routing-plan.md
    if (docSlug && typeof docSlug === 'string') {
      const result = await retrieveByDocSlug(docSlug)
      return NextResponse.json({
        success: true,
        ...result,
      })
    }

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      )
    }

    // V5: Parse excludeChunkIds for follow-up expansion (HS2)
    const excludeIds: string[] = Array.isArray(excludeChunkIds) ? excludeChunkIds : []

    // Mode: 'explain' returns just a short explanation string
    // Mode: 'full' returns full retrieval results with scores
    // Mode: 'chunks' returns chunk-level results (Phase 2 only)
    if (mode === 'explain') {
      // V5: Use getSmartExplanation which returns metadata for follow-up tracking
      const result = await getSmartExplanation(query)

      return NextResponse.json({
        success: true,
        source: result.fromCache ? 'cache' : 'database',
        phase: result.fromCache ? 0 : 2,
        explanation: result.explanation || 'Which part would you like me to explain?',
        docSlug: result.docSlug,   // V5: Actual doc slug for follow-ups
        chunkId: result.chunkId,   // V5: Chunk ID for HS2 tracking
        status: result.status,     // V5: 'ambiguous' triggers pills in UI
        options: result.options,   // V5: Doc options for pills
      })
    }

    // Explicit chunk retrieval mode (V5: supports excludeChunkIds)
    if (mode === 'chunks') {
      const result = await retrieveChunks(query, {
        excludeChunkIds: excludeIds,
        docSlug: scopeDocSlug,
      })
      return NextResponse.json({
        success: true,
        ...result,
      })
    }

    // Full retrieval mode - use specified phase or smart default
    if (phase === 1) {
      const result = await retrieveDocs(query)
      return NextResponse.json({
        success: true,
        phase: 1,
        ...result,
      })
    }

    // Default: smart retrieval (Phase 2 with Phase 1 fallback)
    // V5: Pass excludeChunkIds for follow-up expansion
    const result = await smartRetrieve(query, { excludeChunkIds: excludeIds, docSlug: scopeDocSlug })

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
