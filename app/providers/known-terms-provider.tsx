'use client'

/**
 * KnownTermsProvider
 * Part of: knownterms-ssr-snapshot-plan.md
 *
 * Receives the SSR snapshot and initializes the knownTerms cache on mount.
 * This ensures knownTerms is available before any routing decisions.
 */

import { useEffect, useRef } from 'react'
import {
  initFromSnapshot,
  fetchKnownTerms,
  type KnownTermsSnapshot,
} from '@/lib/docs/known-terms-client'

interface KnownTermsProviderProps {
  snapshot: KnownTermsSnapshot | null
  children: React.ReactNode
}

export function KnownTermsProvider({ snapshot, children }: KnownTermsProviderProps) {
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    // Try to initialize from snapshot
    const snapshotUsed = initFromSnapshot(snapshot)

    // If snapshot wasn't used (invalid/expired), fetch from API
    // Also do background refresh even if snapshot was used (to get latest)
    if (!snapshotUsed) {
      console.log('[KnownTermsProvider] Snapshot not used, fetching from API')
      fetchKnownTerms()
    } else {
      // Background refresh to check for updates (non-blocking)
      console.log('[KnownTermsProvider] Snapshot used, scheduling background refresh')
      setTimeout(() => {
        fetchKnownTerms().then(() => {
          console.log('[KnownTermsProvider] Background refresh complete')
        })
      }, 1000) // Small delay to not compete with initial render
    }
  }, [snapshot])

  return <>{children}</>
}
