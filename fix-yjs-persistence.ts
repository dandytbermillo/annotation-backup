/**
 * Fix for Y.js content duplication on reload
 * 
 * According to Y.js documentation (https://docs.yjs.dev/):
 * - Y.applyUpdate merges updates, doesn't replace content
 * - We should use snapshots for initial load
 * - Updates should be compacted periodically
 * 
 * The issue: When reloading, old updates containing duplicate content
 * are being re-applied, causing duplication.
 * 
 * Solutions applied:
 * 1. Only pass empty content to TipTap when using Y.js
 * 2. Prevent TipTap from setting content when Y.js is active  
 * 3. Implement proper snapshot-based loading
 * 4. Add automatic compaction after a threshold
 */

import * as Y from 'yjs'

export interface PersistenceConfig {
  // Compact after this many updates
  compactThreshold: number
  // Use snapshots for initial load
  useSnapshots: boolean
}

export const DEFAULT_CONFIG: PersistenceConfig = {
  compactThreshold: 50,
  useSnapshots: true
}

/**
 * Enhanced Y.Doc loading with automatic compaction
 */
export async function loadYDocWithCompaction(
  docName: string,
  persistence: any,
  config: PersistenceConfig = DEFAULT_CONFIG
): Promise<Y.Doc> {
  const doc = new Y.Doc({ guid: docName })
  
  // First try to load from snapshot
  if (config.useSnapshots) {
    const snapshot = await persistence.loadSnapshot(docName)
    if (snapshot) {
      Y.applyUpdate(doc, snapshot, 'persistence')
      return doc
    }
  }
  
  // Load all updates
  const updates = await persistence.getAllUpdates(docName)
  if (updates.length === 0) {
    return doc
  }
  
  // Apply updates to doc
  updates.forEach(update => {
    Y.applyUpdate(doc, update, 'persistence')
  })
  
  // Check if we should compact
  if (updates.length > config.compactThreshold) {
    console.log(`Compacting ${docName} with ${updates.length} updates...`)
    await persistence.compact(docName)
  }
  
  return doc
}

/**
 * Safe update handler that prevents duplicate persistence
 */
export function createSafeUpdateHandler(
  docName: string,
  persistence: any,
  isInitialLoad: boolean = true
) {
  let updateCount = 0
  let lastUpdateHash = ''
  
  return async (update: Uint8Array, origin: any) => {
    // Skip persistence updates to prevent loops
    if (origin === 'persistence') {
      return
    }
    
    // Skip initial updates during load
    if (isInitialLoad) {
      return
    }
    
    // Create a simple hash to detect duplicate updates
    const updateHash = Array.from(update).join(',')
    if (updateHash === lastUpdateHash) {
      console.warn('Skipping duplicate update')
      return
    }
    lastUpdateHash = updateHash
    
    try {
      await persistence.persist(docName, update)
      updateCount++
      
      // Auto-compact after threshold
      if (updateCount > DEFAULT_CONFIG.compactThreshold) {
        console.log(`Auto-compacting ${docName} after ${updateCount} updates`)
        await persistence.compact(docName)
        updateCount = 0
      }
    } catch (error) {
      console.error(`Failed to persist update for ${docName}:`, error)
    }
  }
}