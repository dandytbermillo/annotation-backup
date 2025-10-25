"use client"

import { useEffect } from 'react'

const MIGRATION_KEY = 'camera-migration-2025-10-24'
const STORAGE_PREFIX = 'annotation-canvas-state'

/**
 * One-time migration to update old camera defaults from {-1000, -1200} to {0, 0}
 * in all localStorage cached canvas states.
 */
export function CameraStateMigration() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Check if migration already ran
    if (window.localStorage.getItem(MIGRATION_KEY) === 'done') {
      return
    }

    console.log('[CameraStateMigration] Running camera state migration...')

    try {
      let migratedCount = 0

      // Iterate through all localStorage keys
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i)
        if (!key || !key.startsWith(STORAGE_PREFIX)) continue

        try {
          const value = window.localStorage.getItem(key)
          if (!value) continue

          const data = JSON.parse(value)

          // Check if this has the old camera defaults
          const viewport = data?.panels?.viewport || data?.viewport
          if (!viewport) continue

          const hasOldCameraX = viewport.translateX === -1000
          const hasOldCameraY = viewport.translateY === -1200

          if (hasOldCameraX || hasOldCameraY) {
            // Update to new camera defaults
            viewport.translateX = 0
            viewport.translateY = 0

            // Save back to localStorage
            window.localStorage.setItem(key, JSON.stringify(data))
            migratedCount++
            console.log(`[CameraStateMigration] Updated ${key}`)
          }
        } catch (err) {
          console.warn(`[CameraStateMigration] Failed to migrate ${key}:`, err)
        }
      }

      console.log(`[CameraStateMigration] Migration complete. Updated ${migratedCount} cached states.`)

      // Mark migration as complete
      window.localStorage.setItem(MIGRATION_KEY, 'done')
    } catch (error) {
      console.error('[CameraStateMigration] Migration failed:', error)
    }
  }, [])

  return null
}
