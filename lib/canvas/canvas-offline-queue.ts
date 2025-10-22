/**
 * Canvas Offline Queue - IndexedDB-based Persistence Queue
 *
 * Queues failed canvas state persistence operations for offline replay
 * - Uses IndexedDB for better storage capacity than localStorage
 * - Implements conflict resolution: delete > timestamp > user
 * - Preserves causality with timestamps
 * - Auto-retries on network reconnection
 *
 * @see docs/proposal/canvas_state_persistence/implementation.md lines 130-220
 */

import { v4 as uuidv4 } from 'uuid'
import { debugLog } from '@/lib/utils/debug-logger'

export interface CanvasOperation {
  id: string
  type: 'panel_update' | 'panel_create' | 'panel_delete' | 'camera_update'
  noteId: string
  workspaceVersion?: number | null
  timestamp: number
  retryCount: number
  status: 'pending' | 'processing' | 'failed'
  errorMessage?: string
  data: any
}

export interface ConflictResolution {
  winner: CanvasOperation
  reason: 'delete' | 'timestamp' | 'user_preference'
}

const DB_NAME = 'canvas_offline_queue'
const DB_VERSION = 1
const STORE_NAME = 'operations'
const MAX_RETRIES = 3
const RETRY_DELAYS = [1000, 5000, 15000] // Exponential backoff
const WORKSPACE_VERSION_CACHE_KEY = 'canvas_workspace_versions'

/**
 * Canvas Offline Queue Manager
 */
export class CanvasOfflineQueue {
  private db: IDBDatabase | null = null
  private isProcessing = false
  private processInterval: number | null = null
  private workspaceVersionCache: Map<string, number> | null = null

  /**
   * Initialize IndexedDB
   */
  async init(): Promise<void> {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      debugLog({
        component: 'CanvasOfflineQueue',
        action: 'indexeddb_unavailable',
        metadata: { reason: 'window or indexedDB undefined' }
      })
      return
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => {
        debugLog({
          component: 'CanvasOfflineQueue',
          action: 'indexeddb_open_failed',
          metadata: { error: request.error?.toString() }
        })
        reject(request.error)
      }

      request.onsuccess = () => {
        this.db = request.result
        debugLog({
          component: 'CanvasOfflineQueue',
          action: 'indexeddb_initialized',
          metadata: { dbName: DB_NAME, version: DB_VERSION }
        })
        this.startQueueProcessor()
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Create operations store
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('timestamp', 'timestamp', { unique: false })
          store.createIndex('status', 'status', { unique: false })
          store.createIndex('noteId', 'noteId', { unique: false })
          debugLog({
            component: 'CanvasOfflineQueue',
            action: 'object_store_created',
            metadata: { storeName: STORE_NAME }
          })
        }
      }
    })
  }

  /**
   * Enqueue an operation for later replay
   */
  async enqueue(operation: Omit<CanvasOperation, 'id' | 'timestamp' | 'retryCount' | 'status'>): Promise<void> {
    if (!this.db) {
      console.warn('[Canvas Offline Queue] Database not initialized')
      return
    }

    const fullOperation: CanvasOperation = {
      ...operation,
      workspaceVersion: operation.workspaceVersion ?? null,
      id: uuidv4(),
      timestamp: Date.now(),
      retryCount: 0,
      status: 'pending'
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.add(fullOperation)

      request.onsuccess = () => {
        console.log('[Canvas Offline Queue] Enqueued operation:', fullOperation.type)
        resolve()
      }

      request.onerror = () => {
        console.error('[Canvas Offline Queue] Failed to enqueue:', request.error)
        reject(request.error)
      }
    })
  }

  /**
   * Get all pending operations
   */
  async getPendingOperations(): Promise<CanvasOperation[]> {
    if (!this.db) return []

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('status')
      const request = index.getAll('pending')

      request.onsuccess = () => {
        const operations = request.result as CanvasOperation[]
        // Sort by timestamp to preserve causality
        operations.sort((a, b) => a.timestamp - b.timestamp)
        resolve(operations)
      }

      request.onerror = () => {
        console.error('[Canvas Offline Queue] Failed to get pending operations:', request.error)
        reject(request.error)
      }
    })
  }

  /**
   * Resolve conflicts between operations
   *
   * Conflict resolution order:
   * 1. Delete always wins
   * 2. Latest timestamp wins
   * 3. User-specific operations win over shared
   */
  resolveConflicts(operations: CanvasOperation[]): CanvasOperation[] {
    const byEntity = new Map<string, CanvasOperation[]>()

    // Group operations by entity (panel ID or camera key)
    for (const op of operations) {
      const key = this.getEntityKey(op)
      if (!byEntity.has(key)) {
        byEntity.set(key, [])
      }
      byEntity.get(key)!.push(op)
    }

    const resolved: CanvasOperation[] = []

    // Resolve conflicts for each entity
    for (const [key, ops] of byEntity) {
      if (ops.length === 1) {
        resolved.push(ops[0])
        continue
      }

      // Find delete operation (delete wins)
      const deleteOp = ops.find(op => op.type === 'panel_delete')
      if (deleteOp) {
        resolved.push(deleteOp)
        continue
      }

      // Sort by timestamp (latest wins)
      ops.sort((a, b) => b.timestamp - a.timestamp)

      // If timestamps are very close (<100ms), prefer user-specific operations
      const latest = ops[0]
      const almostLatest = ops.filter(op => latest.timestamp - op.timestamp < 100)

      if (almostLatest.length > 1) {
        const userOp = almostLatest.find(op => op.data.userId !== undefined)
        resolved.push(userOp || latest)
      } else {
        resolved.push(latest)
      }
    }

    return resolved
  }

  private loadWorkspaceVersionCache(): Map<string, number> | null {
    if (typeof window === 'undefined') {
      return null
    }

    if (!this.workspaceVersionCache) {
      this.workspaceVersionCache = new Map()
      try {
        const raw = window.localStorage.getItem(WORKSPACE_VERSION_CACHE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)

          if (Array.isArray(parsed)) {
            parsed.forEach(entry => {
              if (Array.isArray(entry) && entry.length >= 2) {
                const [noteId, value] = entry
                if (typeof noteId === 'string') {
                  const numericVersion = Number(value)
                  if (Number.isFinite(numericVersion)) {
                    this.workspaceVersionCache!.set(noteId, numericVersion)
                  }
                }
              } else if (entry && typeof entry === 'object' && typeof entry.noteId === 'string') {
                const numericVersion = Number((entry as any).version)
                if (Number.isFinite(numericVersion)) {
                  this.workspaceVersionCache!.set(entry.noteId, numericVersion)
                }
              }
            })
          } else if (parsed && typeof parsed === 'object') {
            Object.entries(parsed as Record<string, unknown>).forEach(([noteId, value]) => {
              const numericVersion = Number(value)
              if (typeof noteId === 'string' && Number.isFinite(numericVersion)) {
                this.workspaceVersionCache!.set(noteId, numericVersion)
              }
            })
          }
        }
      } catch (error) {
        console.warn('[Canvas Offline Queue] Failed to parse workspace version cache', error)
        this.workspaceVersionCache = new Map()
      }
    }

    return this.workspaceVersionCache
  }

  private getCurrentWorkspaceVersion(noteId: string): number | null {
    const cache = this.loadWorkspaceVersionCache()
    if (!cache) return null
    const value = cache.get(noteId)
    return typeof value === 'number' ? value : null
  }

  private isWorkspaceVersionValid(operation: CanvasOperation): boolean {
    if (operation.workspaceVersion === undefined || operation.workspaceVersion === null) {
      return true
    }

    const currentVersion = this.getCurrentWorkspaceVersion(operation.noteId)
    if (currentVersion === null) {
      return true
    }

    const matches = currentVersion === operation.workspaceVersion

    if (!matches) {
      void debugLog({
        component: 'CanvasOfflineQueue',
        action: 'workspace_version_mismatch',
        metadata: {
          noteId: operation.noteId,
          storedVersion: operation.workspaceVersion,
          currentVersion
        }
      })
    }

    return matches
  }

  /**
   * Get entity key for conflict resolution
   */
  private getEntityKey(operation: CanvasOperation): string {
    switch (operation.type) {
      case 'panel_update':
      case 'panel_delete':
        return `panel:${operation.data.panelId || operation.data.id}`
      case 'camera_update':
        return `camera:${operation.noteId}:${operation.data.userId || 'shared'}`
      case 'panel_create':
        return `panel:${operation.data.id}`
      default:
        return `unknown:${operation.id}`
    }
  }

  /**
   * Process the queue - replay all pending operations
   */
  async flush(): Promise<void> {
    if (!this.db || this.isProcessing) {
      return
    }

    if (!navigator.onLine) {
      console.log('[Canvas Offline Queue] Offline, skipping flush')
      return
    }

    this.workspaceVersionCache = null
    this.isProcessing = true

    try {
      const operations = await this.getPendingOperations()

      if (operations.length === 0) {
        return
      }

      console.log(`[Canvas Offline Queue] Processing ${operations.length} operations`)

      // Resolve conflicts before processing
      const resolved = this.resolveConflicts(operations)

      console.log(`[Canvas Offline Queue] After conflict resolution: ${resolved.length} operations`)

      for (const operation of resolved) {
        await this.processOperation(operation)
      }

      console.log('[Canvas Offline Queue] Queue flushed successfully')
    } catch (error) {
      console.error('[Canvas Offline Queue] Flush failed:', error)
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Process a single operation
   */
  private async processOperation(operation: CanvasOperation): Promise<void> {
    try {
      await this.updateOperationStatus(operation.id, 'processing')

      if (!this.isWorkspaceVersionValid(operation)) {
        console.warn('[Canvas Offline Queue] Skipping operation due to workspace version mismatch', {
          noteId: operation.noteId,
          queuedVersion: operation.workspaceVersion
        })
        await this.removeOperation(operation.id)
        return
      }

      switch (operation.type) {
        case 'panel_update':
          await this.processPanelUpdate(operation)
          break
        case 'panel_create':
          await this.processPanelCreate(operation)
          break
        case 'panel_delete':
          await this.processPanelDelete(operation)
          break
        case 'camera_update':
          await this.processCameraUpdate(operation)
          break
        default:
          throw new Error(`Unknown operation type: ${operation.type}`)
      }

      // Remove from queue after successful processing
      await this.removeOperation(operation.id)
      console.log(`[Canvas Offline Queue] Successfully processed: ${operation.type}`)
    } catch (error) {
      console.error(`[Canvas Offline Queue] Failed to process ${operation.type}:`, error)

      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // Update retry count and schedule retry
      if (operation.retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[operation.retryCount] || RETRY_DELAYS[RETRY_DELAYS.length - 1]
        await this.updateOperationStatus(operation.id, 'pending', errorMessage)
        await this.incrementRetryCount(operation.id)

        setTimeout(() => {
          this.flush().catch(err => console.error('[Canvas Offline Queue] Retry flush failed:', err))
        }, delay)
      } else {
        // Max retries exceeded, mark as failed
        await this.updateOperationStatus(operation.id, 'failed', errorMessage)
        console.error(`[Canvas Offline Queue] Max retries exceeded for operation ${operation.id}`)
      }
    }
  }

  /**
   * Process panel update operation
   */
  private async processPanelUpdate(operation: CanvasOperation): Promise<void> {
    const response = await fetch(`/api/canvas/layout/${operation.noteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: [operation.data]
      })
    })

    if (!response.ok) {
      throw new Error(`Panel update failed: ${response.statusText}`)
    }
  }

  /**
   * Process panel create operation
   */
  private async processPanelCreate(operation: CanvasOperation): Promise<void> {
    const response = await fetch('/api/canvas/panels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(operation.data)
    })

    if (!response.ok) {
      throw new Error(`Panel create failed: ${response.statusText}`)
    }
  }

  /**
   * Process panel delete operation
   */
  private async processPanelDelete(operation: CanvasOperation): Promise<void> {
    const panelId = operation.data.panelId || operation.data.id
    const noteId = operation.data.noteId || operation.noteId

    // Pass noteId as query parameter for composite key lookup
    const url = noteId
      ? `/api/canvas/panels/${panelId}?noteId=${noteId}`
      : `/api/canvas/panels/${panelId}`

    const response = await fetch(url, {
      method: 'DELETE'
    })

    if (!response.ok && response.status !== 404) {
      throw new Error(`Panel delete failed: ${response.statusText}`)
    }
  }

  /**
   * Process camera update operation
   */
  private async processCameraUpdate(operation: CanvasOperation): Promise<void> {
    const response = await fetch(`/api/canvas/camera/${operation.noteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(operation.data)
    })

    if (!response.ok) {
      throw new Error(`Camera update failed: ${response.statusText}`)
    }
  }

  /**
   * Update operation status
   */
  private async updateOperationStatus(
    id: string,
    status: 'pending' | 'processing' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    if (!this.db) return

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(id)

      request.onsuccess = () => {
        const operation = request.result as CanvasOperation
        if (operation) {
          operation.status = status
          if (errorMessage) {
            operation.errorMessage = errorMessage
          }
          store.put(operation)
        }
        resolve()
      }

      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Increment retry count
   */
  private async incrementRetryCount(id: string): Promise<void> {
    if (!this.db) return

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(id)

      request.onsuccess = () => {
        const operation = request.result as CanvasOperation
        if (operation) {
          operation.retryCount++
          store.put(operation)
        }
        resolve()
      }

      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Remove operation from queue
   */
  private async removeOperation(id: string): Promise<void> {
    if (!this.db) return

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Start background queue processor
   */
  private startQueueProcessor(): void {
    if (this.processInterval !== null) return

    // Process queue every 30 seconds when online
    this.processInterval = window.setInterval(() => {
      if (navigator.onLine && !this.isProcessing) {
        this.flush().catch(err => {
          console.error('[Canvas Offline Queue] Background flush failed:', err)
        })
      }
    }, 30000)

    // Also flush on online event
    window.addEventListener('online', () => {
      console.log('[Canvas Offline Queue] Network reconnected, flushing queue')
      this.flush().catch(err => {
        console.error('[Canvas Offline Queue] Online flush failed:', err)
      })
    })
  }

  /**
   * Stop background queue processor
   */
  stopQueueProcessor(): void {
    if (this.processInterval !== null) {
      clearInterval(this.processInterval)
      this.processInterval = null
    }
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{ pending: number; processing: number; failed: number }> {
    if (!this.db) return { pending: 0, processing: 0, failed: 0 }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => {
        const operations = request.result as CanvasOperation[]
        const stats = {
          pending: operations.filter(op => op.status === 'pending').length,
          processing: operations.filter(op => op.status === 'processing').length,
          failed: operations.filter(op => op.status === 'failed').length
        }
        resolve(stats)
      }

      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Clear all operations (use with caution)
   */
  async clear(): Promise<void> {
    if (!this.db) return

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.clear()

      request.onsuccess = () => {
        console.log('[Canvas Offline Queue] Queue cleared')
        resolve()
      }

      request.onerror = () => reject(request.error)
    })
  }
}

// Export singleton instance
export const canvasOfflineQueue = new CanvasOfflineQueue()
