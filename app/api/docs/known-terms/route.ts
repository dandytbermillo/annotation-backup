/**
 * Known Terms API Route
 * Part of: general-doc-retrieval-routing-plan.md (v4)
 *
 * Returns the set of known terms for the app relevance gate.
 * This runs server-side where pg/database access is available.
 */

import { NextResponse } from 'next/server'
import { buildKnownTerms } from '@/lib/docs/keyword-retrieval'

export async function GET() {
  try {
    const knownTerms = await buildKnownTerms()

    // Convert Set to Array for JSON serialization
    const termsArray = Array.from(knownTerms)

    return NextResponse.json({
      terms: termsArray,
      count: termsArray.length,
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error('[KnownTerms API] Error building known terms:', error)
    return NextResponse.json(
      { error: 'Failed to build known terms', terms: [] },
      { status: 500 }
    )
  }
}
