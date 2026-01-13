/**
 * Known Terms Client-Safe Module
 * Part of: general-doc-retrieval-routing-plan.md (v4)
 *
 * This module is safe to import in client components.
 * It only contains the cache and sync getter - no server-side imports.
 *
 * The cache is populated via:
 * 1. API call to /api/docs/known-terms
 * 2. Direct call to setKnownTermsFromArray()
 */

// =============================================================================
// Client-Safe Cache (no pg/server imports)
// =============================================================================

/**
 * Cache for known terms
 */
let knownTermsCache: Set<string> | null = null
let knownTermsCacheTimestamp: number = 0
const KNOWN_TERMS_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Get known terms synchronously (from cache only).
 * Returns null if cache is empty or expired.
 * Call fetchKnownTerms() or setKnownTermsFromArray() to populate the cache.
 */
export function getKnownTermsSync(): Set<string> | null {
  if (knownTermsCache && (Date.now() - knownTermsCacheTimestamp) < KNOWN_TERMS_CACHE_TTL_MS) {
    return knownTermsCache
  }
  return null
}

/**
 * Set the known terms cache from an array of terms.
 * Used to populate the cache from API response.
 */
export function setKnownTermsFromArray(terms: string[]): Set<string> {
  knownTermsCache = new Set(terms)
  knownTermsCacheTimestamp = Date.now()
  return knownTermsCache
}

/**
 * Clear the known terms cache.
 */
export function clearKnownTermsCache(): void {
  knownTermsCache = null
  knownTermsCacheTimestamp = 0
}

/**
 * Check if the cache is valid (not expired).
 */
export function isKnownTermsCacheValid(): boolean {
  return knownTermsCache !== null && (Date.now() - knownTermsCacheTimestamp) < KNOWN_TERMS_CACHE_TTL_MS
}

/**
 * Fetch known terms from the API and populate the cache.
 * This is safe to call from client components.
 */
export async function fetchKnownTerms(): Promise<Set<string>> {
  try {
    const response = await fetch('/api/docs/known-terms')
    if (response.ok) {
      const data = await response.json()
      if (Array.isArray(data.terms)) {
        return setKnownTermsFromArray(data.terms)
      }
    }
  } catch (error) {
    console.error('[KnownTerms] Error fetching known terms:', error)
  }
  return knownTermsCache || new Set()
}
