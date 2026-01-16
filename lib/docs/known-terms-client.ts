/**
 * Known Terms Client-Safe Module
 * Part of: general-doc-retrieval-routing-plan.md (v4)
 *
 * This module is safe to import in client components.
 * It only contains the cache and sync getter - no server-side imports.
 *
 * The cache is populated via:
 * 1. SSR snapshot (injected at render time) - preferred for cold start
 * 2. API call to /api/docs/known-terms
 * 3. Direct call to setKnownTermsFromArray()
 */

// =============================================================================
// Types
// =============================================================================

export type KnownTermsFetchStatus = 'snapshot' | 'cached' | 'fetched' | 'fetch_timeout' | 'fetch_error'

export interface KnownTermsSnapshot {
  terms: string[]
  version: string
  generatedAt: string // ISO timestamp
}

// =============================================================================
// Client-Safe Cache (no pg/server imports)
// =============================================================================

/**
 * Cache for known terms
 */
let knownTermsCache: Set<string> | null = null
let knownTermsCacheTimestamp: number = 0
let knownTermsFetchStatus: KnownTermsFetchStatus | null = null
let knownTermsVersion: string | null = null

const KNOWN_TERMS_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const KNOWN_TERMS_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

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
 * Note: Does not change fetch status - caller should set status appropriately.
 */
export function setKnownTermsFromArray(terms: string[]): Set<string> {
  knownTermsCache = new Set(terms)
  knownTermsCacheTimestamp = Date.now()
  // Only set to 'cached' if not already set (preserves snapshot/fetched status)
  if (!knownTermsFetchStatus) {
    knownTermsFetchStatus = 'cached'
  }
  return knownTermsCache
}

/**
 * Clear the known terms cache.
 */
export function clearKnownTermsCache(): void {
  knownTermsCache = null
  knownTermsCacheTimestamp = 0
  knownTermsFetchStatus = null
  knownTermsVersion = null
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
        knownTermsFetchStatus = 'fetched'
        knownTermsVersion = data.version || null
        return setKnownTermsFromArray(data.terms)
      }
    }
    knownTermsFetchStatus = 'fetch_error'
  } catch (error) {
    console.error('[KnownTerms] Error fetching known terms:', error)
    knownTermsFetchStatus = 'fetch_error'
  }
  return knownTermsCache || new Set()
}

// =============================================================================
// SSR Snapshot Support
// =============================================================================

/**
 * Initialize known terms from SSR snapshot.
 * Returns true if snapshot was valid and used, false otherwise.
 */
export function initFromSnapshot(snapshot: KnownTermsSnapshot | null | undefined): boolean {
  if (!snapshot || !Array.isArray(snapshot.terms) || snapshot.terms.length === 0) {
    console.warn('[KnownTerms] Invalid or empty snapshot, skipping')
    return false
  }

  // Check TTL (7 days)
  const generatedAt = new Date(snapshot.generatedAt).getTime()
  if (isNaN(generatedAt)) {
    console.warn('[KnownTerms] Invalid snapshot timestamp, skipping')
    return false
  }

  const age = Date.now() - generatedAt
  if (age > KNOWN_TERMS_SNAPSHOT_TTL_MS) {
    console.warn(`[KnownTerms] Snapshot expired (age: ${Math.round(age / 1000 / 60 / 60 / 24)} days), skipping`)
    return false
  }

  // Valid snapshot - use it
  knownTermsCache = new Set(snapshot.terms)
  knownTermsCacheTimestamp = Date.now()
  knownTermsFetchStatus = 'snapshot'
  knownTermsVersion = snapshot.version || null

  console.log(`[KnownTerms] Initialized from snapshot: ${snapshot.terms.length} terms, version: ${snapshot.version}`)
  return true
}

/**
 * Get the current fetch status (for telemetry).
 */
export function getKnownTermsFetchStatus(): KnownTermsFetchStatus | null {
  return knownTermsFetchStatus
}

/**
 * Get the current version (for telemetry/debugging).
 */
export function getKnownTermsVersion(): string | null {
  return knownTermsVersion
}
