/**
 * Known Terms Snapshot (Server-Side)
 * Part of: knownterms-ssr-snapshot-plan.md
 *
 * This module builds the snapshot for SSR injection.
 * Only import this in server components or API routes.
 */

import { buildKnownTerms } from '@/lib/docs/keyword-retrieval'
import { createHash } from 'crypto'
import type { KnownTermsSnapshot } from './known-terms-client'

/**
 * Generate a version hash from the terms array.
 */
function generateVersion(terms: string[]): string {
  const sorted = [...terms].sort().join(',')
  const hash = createHash('sha256').update(sorted).digest('hex').slice(0, 12)
  return `v1:${hash}`
}

/**
 * Build the known terms snapshot for SSR injection.
 * Call this from server components to get the snapshot data.
 */
export async function buildKnownTermsSnapshot(): Promise<KnownTermsSnapshot | null> {
  try {
    const knownTerms = await buildKnownTerms()
    const termsArray = Array.from(knownTerms)

    if (termsArray.length === 0) {
      console.warn('[KnownTermsSnapshot] No terms found')
      return null
    }

    return {
      terms: termsArray,
      version: generateVersion(termsArray),
      generatedAt: new Date().toISOString(),
    }
  } catch (error) {
    console.error('[KnownTermsSnapshot] Error building snapshot:', error)
    return null
  }
}
