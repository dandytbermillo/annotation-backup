/**
 * Known Terms API Route
 * Part of: general-doc-retrieval-routing-plan.md (v4)
 *
 * Returns the set of known terms for the app relevance gate.
 * This runs server-side where pg/database access is available.
 */

import { NextResponse } from 'next/server'
import { buildKnownTerms } from '@/lib/docs/keyword-retrieval'
import { createHash } from 'crypto'

/**
 * Generate a version hash from the terms array.
 * This allows clients to detect when terms have changed.
 */
function generateVersion(terms: string[]): string {
  const sorted = [...terms].sort().join(',')
  const hash = createHash('sha256').update(sorted).digest('hex').slice(0, 12)
  return `v1:${hash}`
}

export async function GET() {
  try {
    const knownTerms = await buildKnownTerms()

    // Convert Set to Array for JSON serialization
    const termsArray = Array.from(knownTerms)
    const version = generateVersion(termsArray)

    return NextResponse.json({
      terms: termsArray,
      count: termsArray.length,
      version,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[KnownTerms API] Error building known terms:', error)
    return NextResponse.json(
      { error: 'Failed to build known terms', terms: [], version: null, generatedAt: null },
      { status: 500 }
    )
  }
}
