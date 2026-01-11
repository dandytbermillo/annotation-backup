/**
 * API: Seed Documentation
 * POST /api/docs/seed
 *
 * Seeds documentation from meta/documentation folder into the database.
 * Phase 0/1: Seeds whole docs into docs_knowledge
 * Phase 2: Also seeds chunks into docs_knowledge_chunks
 *
 * Part of: cursor-style-doc-retrieval-plan.md (Phase 0 + Phase 2)
 */

import { NextResponse } from 'next/server'
import { seedDocsAndChunks } from '@/lib/docs/seed-docs'

export async function POST() {
  try {
    const result = await seedDocsAndChunks()

    return NextResponse.json({
      success: true,
      docs: result.docs,
      chunks: result.chunks,
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
