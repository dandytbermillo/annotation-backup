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
