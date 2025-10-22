/**
 * Canvas Storage Module
 * 
 * Handles per-note canvas state persistence in localStorage.
 * Part of Option A (offline mode) - no Yjs or CRDT operations.
 * 
 * @module canvas-storage
 */

import type { CanvasItem } from "@/types/canvas-items"
import { CanvasNode } from "@/lib/canvas/canvas-node"
import { getLayerManager } from "@/lib/canvas/layer-manager"
import { debugLog } from "@/lib/utils/debug-logger"

const STORAGE_PREFIX = "annotation-canvas-state"
const STATE_VERSION = "1.2.0"
const LEGACY_KEY = STORAGE_PREFIX
const AUTO_SAVE_DEBOUNCE = 800 // Increased from 450ms for better performance
const STORAGE_BUDGET_BYTES = 2.5 * 1024 * 1024 // ~2.5MB budget for canvas snapshots
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000
let lastQuotaWarningAt = 0

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
  workspaceVersion?: number
  /** Layer management data (optional for backwards compatibility) */
  layerNodes?: {
    schemaVersion: number
    nodes: CanvasNode[]
    maxZ: number
  }
}

interface StoredCanvasSnapshotV2 {
  version?: string
  savedAt?: number
  panels?: {
    workspaceVersion?: number
    viewport?: PersistedViewport
    items?: PersistedCanvasItem[]
    layerNodes?: {
      schemaVersion: number
      nodes: CanvasNode[]
      maxZ: number
    }
  }
}

type StoredCanvasSnapshotLegacy = Partial<PersistedCanvasState> & Record<string, any>

function normalizeStoredSnapshot(
  raw: StoredCanvasSnapshotV2 | StoredCanvasSnapshotLegacy | null,
  noteId: string,
  storageKey: string,
): {
  viewport: PersistedViewport
  items: PersistedCanvasItem[]
  savedAt: number
  version: string
  workspaceVersion?: number
  layerNodes?: {
    schemaVersion: number
    nodes: CanvasNode[]
    maxZ: number
  }
} | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const panelsBlock = (raw as StoredCanvasSnapshotV2).panels
  let savedAt = typeof raw.savedAt === 'number' ? raw.savedAt : Date.now()
  let version = typeof raw.version === 'string' ? raw.version : STATE_VERSION
  let workspaceVersion: number | undefined
  let viewport: PersistedViewport | undefined
  let items: PersistedCanvasItem[] | undefined
  let layerNodes:
    | {
        schemaVersion: number
        nodes: CanvasNode[]
        maxZ: number
      }
    | undefined

  if (panelsBlock && typeof panelsBlock === 'object') {
    if (typeof panelsBlock.workspaceVersion === 'number') {
      workspaceVersion = panelsBlock.workspaceVersion
    } else if (typeof (raw as any).workspaceVersion === 'number') {
      workspaceVersion = (raw as any).workspaceVersion
    }

    if (panelsBlock.viewport && typeof panelsBlock.viewport === 'object') {
      viewport = panelsBlock.viewport as PersistedViewport
    }

    if (Array.isArray(panelsBlock.items)) {
      items = panelsBlock.items as PersistedCanvasItem[]
    } else if (Array.isArray((raw as any).items)) {
      // Back-compat if items were still top-level
      items = (raw as any).items as PersistedCanvasItem[]
    }

    if (panelsBlock.layerNodes) {
      layerNodes = panelsBlock.layerNodes
    }
  } else {
    const legacy = raw as StoredCanvasSnapshotLegacy
    if (legacy.noteId && legacy.noteId !== noteId && storageKey !== LEGACY_KEY) {
      return null
    }
    if (legacy.workspaceVersion && typeof legacy.workspaceVersion === 'number') {
      workspaceVersion = legacy.workspaceVersion
    }
    viewport = legacy.viewport as PersistedViewport | undefined
    items = Array.isArray(legacy.items) ? (legacy.items as PersistedCanvasItem[]) : undefined
    layerNodes = legacy.layerNodes
  }

  if (!viewport || typeof viewport.zoom !== 'number' || typeof viewport.translateX !== 'number' || typeof viewport.translateY !== 'number') {
    return null
  }

  const normalizedViewport: PersistedViewport = {
    zoom: viewport.zoom,
    translateX: viewport.translateX,
    translateY: viewport.translateY,
    showConnections: viewport.showConnections ?? true,
  }

  if (!Array.isArray(items)) {
    return null
  }

  const normalizedItems = items.map(item => ({
    id: item.id,
    itemType: item.itemType,
    position: item.position,
    panelId: item.panelId,
    panelType: item.panelType,
    componentType: item.componentType,
    dimensions: item.dimensions,
    minimized: item.minimized,
    title: item.title,
  }))

  return {
    viewport: normalizedViewport,
    items: normalizedItems,
    savedAt,
    version,
    workspaceVersion,
    layerNodes,
  }
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
export function loadStateFromStorage(noteId: string, expectedWorkspaceVersion?: number): PersistedCanvasState | null {
  if (!isBrowser()) return null

  const candidates = [storageKey(noteId), LEGACY_KEY]

  for (const key of candidates) {
    const serialized = window.localStorage.getItem(key)
    if (!serialized) continue

    const deleteSnapshot = () => {
      try {
        if (key === LEGACY_KEY) {
          window.localStorage.removeItem(LEGACY_KEY)
        } else {
          clearStateFromStorage(noteId)
        }
      } catch (err) {
        console.warn('[canvas-storage] Failed to delete snapshot key', { key, err })
      }
    }

    try {
      const parsed = JSON.parse(serialized) as StoredCanvasSnapshotV2 | StoredCanvasSnapshotLegacy
      const normalized = normalizeStoredSnapshot(parsed, noteId, key)
      if (!normalized) {
        debugLog({
          component: 'CanvasCache',
          action: 'canvas.cache_discarded',
          metadata: {
            noteId,
            reason: 'invalid_structure',
            storageKey: key
          },
        })
        deleteSnapshot()
        continue
      }

      const {
        viewport,
        items,
        savedAt,
        version,
        workspaceVersion: storedWorkspaceVersion,
        layerNodes,
      } = normalized

      const ageMs = Date.now() - savedAt
      if (ageMs > SNAPSHOT_TTL_MS) {
        debugLog({
          component: 'CanvasCache',
          action: 'canvas.cache_discarded',
          metadata: {
            noteId,
            reason: 'expired',
            ageMs
          }
        })
        deleteSnapshot()
        continue
      }

      if (expectedWorkspaceVersion !== undefined) {
        if (!Number.isFinite(expectedWorkspaceVersion)) {
          console.warn('[canvas-storage] Ignoring non-finite expected workspace version', {
            noteId,
            expectedWorkspaceVersion,
          })
        } else if (storedWorkspaceVersion !== expectedWorkspaceVersion) {
          console.warn('[canvas-storage] Discarding snapshot due to workspace version mismatch', {
            noteId,
            stored: storedWorkspaceVersion,
            expected: expectedWorkspaceVersion,
          })
          debugLog({
            component: 'CanvasCache',
            action: 'canvas.cache_mismatch',
            metadata: {
              noteId,
              storedVersion: storedWorkspaceVersion ?? null,
              expectedVersion: expectedWorkspaceVersion,
            }
          })
          debugLog({
            component: 'CanvasCache',
            action: 'canvas.cache_discarded',
            metadata: {
              noteId,
              reason: 'workspace_version_mismatch',
              storedVersion: storedWorkspaceVersion ?? null,
              expectedVersion: expectedWorkspaceVersion,
            }
          })
          deleteSnapshot()
          continue
        }
      }

      if (version && version !== STATE_VERSION) {
        console.warn("[canvas-storage] Version mismatch", {
          stored: version,
          current: STATE_VERSION,
        })
        // In future, add migration logic here
      }

      if (layerNodes) {
        try {
          const layerManager = getLayerManager()
          layerManager.deserializeNodes(layerNodes)
          console.log('[canvas-storage] Loaded layer nodes:', layerNodes.nodes.length)
        } catch (error) {
          console.warn('[canvas-storage] Failed to load layer nodes:', error)
        }
      }

      debugLog({
        component: 'CanvasCache',
        action: 'canvas.cache_used',
        metadata: {
          noteId,
          savedAt,
          ageMs,
          workspaceVersion: storedWorkspaceVersion ?? null,
          key
        }
      })

      return {
        noteId,
        viewport,
        items,
        savedAt,
        version: version || STATE_VERSION,
        workspaceVersion: storedWorkspaceVersion,
        layerNodes,
      }
    } catch (error) {
      console.warn("[canvas-storage] Failed to parse snapshot", { key, error })
      debugLog({
        component: 'CanvasCache',
        action: 'canvas.cache_discarded',
        metadata: {
          noteId,
          reason: 'parse_error',
          storageKey: key
        }
      })
      deleteSnapshot()
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
  snapshot: { viewport: PersistedViewport; items: CanvasItem[]; workspaceVersion?: number }
): boolean {
  if (!isBrowser()) return false

  try {
    // Include layer nodes (LayerManager is permanently enabled)
    let layerNodes = undefined
    try {
      const layerManager = getLayerManager()
      layerNodes = layerManager.serializeNodes()
      console.log('[canvas-storage] Saving layer nodes:', layerNodes.nodes.length)
    } catch (error) {
      console.warn('[canvas-storage] Failed to serialize layer nodes:', error)
    }

    const panelsPayload = {
      workspaceVersion: snapshot.workspaceVersion,
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
      layerNodes,
    }

    type StoredSnapshotPayload = {
      version: string
      savedAt: number
      panels: typeof panelsPayload
    }

    const payload: StoredSnapshotPayload = {
      version: STATE_VERSION,
      savedAt: Date.now(),
      panels: panelsPayload,
    }

    const key = storageKey(noteId)

    let lastSavedSize = 0

    const attemptSave = (data: StoredSnapshotPayload, logLabel: string): boolean => {
      const serialized = JSON.stringify(data)
      try {
        window.localStorage.setItem(key, serialized)
        if (logLabel) {
          console.log(`[canvas-storage] ${logLabel}`)
        }
        lastSavedSize = serialized.length
        return true
      } catch (error) {
        if (error instanceof DOMException && (
          error.code === 22 ||
          error.code === 1014 ||
          error.name === 'QuotaExceededError' ||
          error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
        )) {
          console.warn('[canvas-storage] Quota attempt failed', {
            noteId,
            dataSize: serialized.length,
            attempt: logLabel || 'initial'
          })
          return false
        }
        throw error
      }
    }

    const saveWithFallbacks = (): boolean => {
      if (attemptSave(payload, 'saved snapshot')) {
        return true
      }

      const now = Date.now()
      if (now - lastQuotaWarningAt > 60_000) {
        console.warn('[canvas-storage] Storage quota exceeded', {
          noteId,
          availableSpace: getAvailableStorageSpace()
        })
        lastQuotaWarningAt = now
      }

      cleanupOldSnapshots(noteId)
      if (attemptSave(payload, 'saved after cleanup')) {
        return true
      }

      enforceStorageBudget(noteId)
      if (attemptSave(payload, 'saved after budget enforcement')) {
        return true
      }

      if (panelsPayload.layerNodes) {
        const slimPayload: StoredSnapshotPayload = {
          ...payload,
          panels: {
            ...panelsPayload,
            layerNodes: undefined,
          },
        }
        if (attemptSave(slimPayload, 'saved without layer nodes')) {
          return true
        }
      }

      cleanupOldSnapshots(noteId, 0)
      enforceStorageBudget(noteId, STORAGE_BUDGET_BYTES * 0.9)
      const aggressivePayload: StoredSnapshotPayload = {
        ...payload,
        panels: {
          ...panelsPayload,
          layerNodes: undefined,
        },
      }
      if (attemptSave(aggressivePayload, 'saved after aggressive cleanup')) {
        return true
      }

      if (now - lastQuotaWarningAt > 5_000) {
        console.warn('[canvas-storage] Unable to persist snapshot after cleanup', {
          noteId,
          totalSnapshots: getStorageStats().totalSnapshots
        })
        lastQuotaWarningAt = now
      }

      return false
    }

    if (!saveWithFallbacks()) {
      return false
    }
    
    // Migrate from legacy key after successful save (with grace period)
    if (noteId && window.localStorage.getItem(LEGACY_KEY)) {
      // Mark legacy for deletion after 24 hours
      const legacyMeta = window.localStorage.getItem(`${LEGACY_KEY}:meta`)
      if (!legacyMeta) {
        window.localStorage.setItem(`${LEGACY_KEY}:meta`, JSON.stringify({
          markedForDeletion: Date.now(),
          migratedTo: noteId
        }))
      } else {
        try {
          const meta = JSON.parse(legacyMeta)
          // Delete if older than 24 hours
          if (Date.now() - meta.markedForDeletion > 24 * 60 * 60 * 1000) {
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
        Items: payload.panels.items.length,
        Size: `${(lastSavedSize / 1024).toFixed(1)}KB`,
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

function enforceStorageBudget(currentNoteId: string, budget: number = STORAGE_BUDGET_BYTES): boolean {
  if (!isBrowser()) return false
  if (!Number.isFinite(budget) || budget <= 0) return false

  try {
    const entries: Array<{ key: string; size: number; savedAt: number; isCurrent: boolean }> = []
    let totalSize = 0

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue

      const value = window.localStorage.getItem(key) ?? ''
      const size = key.length + value.length
      totalSize += size

      let savedAt = 0
      try {
        const parsed = JSON.parse(value) as Partial<PersistedCanvasState>
        if (parsed && typeof parsed.savedAt === 'number') {
          savedAt = parsed.savedAt
        }
      } catch {
        savedAt = 0
      }

      entries.push({
        key,
        size,
        savedAt,
        isCurrent: key === storageKey(currentNoteId),
      })
    }

    if (totalSize <= budget) {
      return false
    }

    const removable = entries.filter(entry => !entry.isCurrent)
    removable.sort((a, b) => a.savedAt - b.savedAt)

    let budgetFreed = false
    for (const entry of removable) {
      if (totalSize <= budget) {
        break
      }
      window.localStorage.removeItem(entry.key)
      totalSize -= entry.size
      budgetFreed = true
      console.log('[canvas-storage] Removed old snapshot to free space', { key: entry.key, freed: entry.size })
    }

    if (totalSize <= budget) {
      return budgetFreed
    }

    // If still over budget, remove the current entry (we will rewrite it immediately)
    const currentEntry = entries.find(entry => entry.isCurrent)
    if (currentEntry) {
      window.localStorage.removeItem(currentEntry.key)
      totalSize -= currentEntry.size
      console.log('[canvas-storage] Cleared current snapshot to free space', { key: currentEntry.key })
      budgetFreed = true
    }

    return budgetFreed
  } catch (error) {
    console.warn('[canvas-storage] enforceStorageBudget failed', error)
    return false
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
