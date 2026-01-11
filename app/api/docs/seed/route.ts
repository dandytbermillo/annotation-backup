/**
 * API: Seed Documentation
 * POST /api/docs/seed
 *
 * Seeds documentation from docs/knowledge into the database.
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
