/**
 * Canvas Storage Module
 * 
 * Handles per-note canvas state persistence in localStorage.
 * Part of Option A (offline mode) - no Yjs or CRDT operations.
 * 
 * @module canvas-storage
 */

import type { CanvasItem } from "@/types/canvas-items"

const STORAGE_PREFIX = "annotation-canvas-state"
const STATE_VERSION = "1.1.0"
const LEGACY_KEY = STORAGE_PREFIX
const AUTO_SAVE_DEBOUNCE = 800 // Increased from 450ms for better performance

interface PersistedViewport {
  zoom: number
  translateX: number
  translateY: number
  showConnections: boolean
}

interface PersistedCanvasItem {
  id: string
  itemType: CanvasItem["itemType"]
  position: CanvasItem["position"]
  panelId?: string
  panelType?: CanvasItem["panelType"]
  componentType?: CanvasItem["componentType"]
  dimensions?: CanvasItem["dimensions"]
  minimized?: boolean
  title?: string
}

export interface PersistedCanvasState {
  noteId: string
  viewport: PersistedViewport
  items: PersistedCanvasItem[]
  savedAt: number
  version: string
}

/**
 * Check if we're in a browser environment with localStorage support
 */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

/**
 * Generate storage key for a specific note
 */
function storageKey(noteId: string): string {
  return `${STORAGE_PREFIX}:${noteId}`
}

/**
 * Check if localStorage has enough space
 * Returns available bytes or -1 if cannot determine
 */
function getAvailableStorageSpace(): number {
  if (!isBrowser()) return -1
  
  try {
    // Try to estimate available space (this is a rough estimate)
    const testKey = '__storage_test__'
    const testData = new Array(1024).join('a') // 1KB of data
    let size = 0
    
    // Remove test key if it exists
    localStorage.removeItem(testKey)
    
    // Try progressively larger sizes until we hit the limit
    while (size < 5 * 1024 * 1024) { // Stop at 5MB
      try {
        localStorage.setItem(testKey, new Array(size + 1024).join('a'))
        size += 1024
      } catch (e) {
        break
      }
    }
    
    localStorage.removeItem(testKey)
    return size
  } catch {
    return -1
  }
}

/**
 * Load canvas state from storage for a specific note
 * 
 * @param noteId - The ID of the note to load state for
 * @returns The persisted state or null if not found/invalid
 */
export function loadStateFromStorage(noteId: string): PersistedCanvasState | null {
  if (!isBrowser()) return null

  const candidates = [storageKey(noteId), LEGACY_KEY]

  for (const key of candidates) {
    const serialized = window.localStorage.getItem(key)
    if (!serialized) continue

    try {
      const parsed = JSON.parse(serialized) as PersistedCanvasState
      
      // Validate structure
      if (!parsed || typeof parsed !== "object") continue
      if (!parsed.viewport || typeof parsed.viewport.zoom !== "number") continue
      if (!Array.isArray(parsed.items)) continue
      
      // Check note ID match (skip for legacy key)
      if (parsed.noteId && parsed.noteId !== noteId && key !== LEGACY_KEY) continue
      
      // Check version compatibility
      if (parsed.version && parsed.version !== STATE_VERSION) {
        console.warn("[canvas-storage] Version mismatch", { 
          stored: parsed.version, 
          current: STATE_VERSION 
        })
        // In future, add migration logic here
      }

      return {
        noteId,
        viewport: {
          zoom: parsed.viewport.zoom,
          translateX: parsed.viewport.translateX,
          translateY: parsed.viewport.translateY,
          showConnections: parsed.viewport.showConnections ?? true,
        },
        items: parsed.items,
        savedAt: parsed.savedAt || Date.now(),
        version: parsed.version || STATE_VERSION,
      }
    } catch (error) {
      console.warn("[canvas-storage] Failed to parse snapshot", { key, error })
    }
  }

  return null
}

/**
 * Save canvas state to storage for a specific note
 * 
 * @param noteId - The ID of the note to save state for
 * @param snapshot - The viewport and items to persist
 * @returns true if save was successful, false otherwise
 */
export function saveStateToStorage(
  noteId: string,
  snapshot: { viewport: PersistedViewport; items: CanvasItem[] }
): boolean {
  if (!isBrowser()) return false

  try {
    const payload: PersistedCanvasState = {
      noteId,
      savedAt: Date.now(),
      version: STATE_VERSION,
      viewport: snapshot.viewport,
      items: snapshot.items.map((item) => ({
        id: item.id,
        itemType: item.itemType,
        position: item.position,
        panelId: item.panelId,
        panelType: item.panelType,
        componentType: item.componentType,
        dimensions: item.dimensions,
        minimized: item.minimized,
        title: item.title,
      })),
    }

    const serialized = JSON.stringify(payload)
    const key = storageKey(noteId)
    
    // Try to save with quota handling
    try {
      window.localStorage.setItem(key, serialized)
    } catch (e) {
      // Handle quota exceeded error
      if (e instanceof DOMException && (
        e.code === 22 || // Legacy code
        e.code === 1014 || // Firefox
        e.name === 'QuotaExceededError' || // Standard
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED' // Firefox
      )) {
        console.error("[canvas-storage] Storage quota exceeded", {
          noteId,
          dataSize: serialized.length,
          availableSpace: getAvailableStorageSpace()
        })
        
        // Try to clean up old data and retry once
        try {
          cleanupOldSnapshots(noteId)
          window.localStorage.setItem(key, serialized)
          console.log("[canvas-storage] Saved after cleanup")
        } catch {
          return false
        }
      } else {
        throw e
      }
    }
    
    // Migrate from legacy key after successful save (with grace period)
    if (noteId && window.localStorage.getItem(LEGACY_KEY)) {
      // Mark legacy for deletion after 7 days
      const legacyMeta = window.localStorage.getItem(`${LEGACY_KEY}:meta`)
      if (!legacyMeta) {
        window.localStorage.setItem(`${LEGACY_KEY}:meta`, JSON.stringify({
          markedForDeletion: Date.now(),
          migratedTo: noteId
        }))
      } else {
        try {
          const meta = JSON.parse(legacyMeta)
          // Delete if older than 7 days
          if (Date.now() - meta.markedForDeletion > 7 * 24 * 60 * 60 * 1000) {
            window.localStorage.removeItem(LEGACY_KEY)
            window.localStorage.removeItem(`${LEGACY_KEY}:meta`)
          }
        } catch {
          // Invalid meta, just ignore
        }
      }
    }

    console.table([
      {
        Action: "State Saved",
        NoteId: noteId,
        Items: payload.items.length,
        Size: `${(serialized.length / 1024).toFixed(1)}KB`,
        SavedAt: new Date(payload.savedAt).toLocaleTimeString(),
      },
    ])
    return true
  } catch (error) {
    console.error("[canvas-storage] Failed to save snapshot", error)
    return false
  }
}

/**
 * Clear canvas state for a specific note
 * 
 * @param noteId - The ID of the note to clear state for
 */
export function clearStateFromStorage(noteId: string): void {
  if (!isBrowser()) return
  window.localStorage.removeItem(storageKey(noteId))
  console.log("[canvas-storage] Cleared state for note:", noteId)
}

/**
 * Clean up old snapshots to free storage space
 * Keeps only the most recent N snapshots
 * 
 * @param currentNoteId - The current note ID to preserve
 */
function cleanupOldSnapshots(currentNoteId: string, keepCount: number = 10): void {
  if (!isBrowser()) return
  
  try {
    const snapshots: Array<{ key: string; savedAt: number }> = []
    
    // Find all canvas state keys
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue
      if (key === storageKey(currentNoteId)) continue // Don't delete current
      
      try {
        const data = window.localStorage.getItem(key)
        if (!data) continue
        
        const parsed = JSON.parse(data) as PersistedCanvasState
        snapshots.push({ key, savedAt: parsed.savedAt || 0 })
      } catch {
        // Invalid data, mark for deletion
        snapshots.push({ key, savedAt: 0 })
      }
    }
    
    // Sort by saved time (oldest first)
    snapshots.sort((a, b) => a.savedAt - b.savedAt)
    
    // Remove oldest snapshots if we exceed the limit
    const toDelete = Math.max(0, snapshots.length - keepCount)
    for (let i = 0; i < toDelete; i++) {
      window.localStorage.removeItem(snapshots[i].key)
      console.log("[canvas-storage] Cleaned up old snapshot:", snapshots[i].key)
    }
  } catch (error) {
    console.error("[canvas-storage] Cleanup failed", error)
  }
}

/**
 * Get storage statistics
 * Useful for debugging and monitoring
 */
export function getStorageStats(): {
  totalSnapshots: number
  totalSize: number
  availableSpace: number
} {
  if (!isBrowser()) return { totalSnapshots: 0, totalSize: 0, availableSpace: -1 }
  
  let totalSnapshots = 0
  let totalSize = 0
  
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue
    
    const value = window.localStorage.getItem(key)
    if (value) {
      totalSnapshots++
      totalSize += key.length + value.length
    }
  }
  
  return {
    totalSnapshots,
    totalSize,
    availableSpace: getAvailableStorageSpace()
  }
}

// Export debounce timing for use in components
export const CANVAS_STORAGE_DEBOUNCE = AUTO_SAVE_DEBOUNCE