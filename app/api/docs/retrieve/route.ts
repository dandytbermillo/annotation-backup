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
    const { query, mode, phase, docSlug } = body

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

    // Mode: 'explain' returns just a short explanation string
    // Mode: 'full' returns full retrieval results with scores
    // Mode: 'chunks' returns chunk-level results (Phase 2 only)
    if (mode === 'explain') {
      // Try cache first (Tier 1)
      const cached = getCachedExplanation(query)
      if (cached) {
        return NextResponse.json({
          success: true,
          source: 'cache',
          phase: 0,
          explanation: cached,
        })
      }

      // Fall back to smart retrieval (Phase 2 → Phase 1)
      const explanation = await getSmartExplanation(query)
      return NextResponse.json({
        success: true,
        source: 'database',
        phase: 2,
        explanation: explanation || 'Which part would you like me to explain?',
      })
    }

    // Explicit chunk retrieval mode
    if (mode === 'chunks') {
      const result = await retrieveChunks(query)
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
    const result = await smartRetrieve(query)

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
