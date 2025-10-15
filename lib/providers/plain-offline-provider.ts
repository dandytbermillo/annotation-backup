/**
 * PlainOfflineProvider - Non-Yjs state management for Option A (offline, single-user mode)
 * 
 * This provider manages document and branch state without using Yjs CRDTs.
 * It implements all 10 critical fixes from the Yjs implementation while
 * maintaining compatibility with future Yjs integration.
 * 
 * @module lib/providers/plain-offline-provider
 */

import { EventEmitter } from 'events'
import { PlainBatchManager, BatchOperation } from '../batching/plain-batch-manager'
import { PlainOfflineQueue } from '../batching/plain-offline-queue'
import { getPlainBatchConfig, mergeConfig } from '../batching/plain-batch-config'
import type { PlainBatchConfig } from '../batching/plain-batch-config'

const AUTOSAVE_DEBUG = ['true', '1', 'on', 'yes'].includes((process.env.NEXT_PUBLIC_DEBUG_AUTOSAVE ?? '').toLowerCase())
const providerAutosaveDebug = (...args: any[]) => {
  if (!AUTOSAVE_DEBUG) return
  console.debug('[PlainAutosave][Provider]', ...args)
}

// Types for plain mode - compatible with future Yjs structures
export interface ProseMirrorJSON {
  type: string
  content?: any[]
  attrs?: Record<string, any>
}

export type HtmlString = string

export interface Branch {
  id: string
  noteId: string
  parentId: string
  type: 'note' | 'explore' | 'promote'
  title?: string
  originalText: string
  metadata?: {
    annotationType?: string
    color?: string
    typeHistory?: Array<{
      type: 'note' | 'explore' | 'promote'
      changedAt: string
      reason: 'initial' | 'user_change'
    }>
    preview?: string
    displayId?: string
    position?: { x: number; y: number }
    dimensions?: { width: number; height: number }
    [key: string]: any
  }
  anchors?: {
    start: number
    end: number
    context?: string
  }
  createdAt: Date
  updatedAt: Date
}

export interface Note {
  id: string
  title: string
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

export interface Panel {
  id: string
  noteId: string
  position: { x: number; y: number }
  dimensions: { width: number; height: number }
  state: 'active' | 'minimized' | 'hidden'
  lastAccessed: Date
}

export interface QueueOp {
  operation: 'create' | 'update' | 'delete'
  entityType: 'note' | 'branch' | 'panel' | 'document'
  entityId: string
  payload: any
}

/**
 * PlainCrudAdapter interface - matches the specification in INITIAL.md
 * with the fix for noteId parameters in saveDocument/loadDocument
 */
export interface PlainCrudAdapter {
  // Note operations
  createNote(input: Partial<Note>): Promise<Note>
  updateNote(id: string, patch: Partial<Note> & { version: number }): Promise<Note>
  getNote(id: string): Promise<Note | null>

  // Branch operations
  createBranch(input: Partial<Branch>): Promise<Branch>
  updateBranch(id: string, patch: Partial<Branch> & { version: number }): Promise<Branch>
  listBranches(noteId: string): Promise<Branch[]>

  // Document operations (fixed to include noteId)
  saveDocument(noteId: string, panelId: string, content: ProseMirrorJSON | HtmlString, version: number, baseVersion: number): Promise<void>
  loadDocument(noteId: string, panelId: string): Promise<{ content: ProseMirrorJSON | HtmlString; version: number } | null>

  // Offline queue operations
  enqueueOffline(op: QueueOp): Promise<void>
  flushQueue(): Promise<{ processed: number; failed: number }>
}

/**
 * Options for PlainOfflineProvider
 */
export class PlainDocumentConflictError extends Error {
  noteId: string
  panelId: string
  remoteVersion?: number
  remoteContent?: ProseMirrorJSON | HtmlString

  constructor(
    noteId: string,
    panelId: string,
    message: string,
    remote?: { version: number; content: ProseMirrorJSON | HtmlString }
  ) {
    super(message)
    this.name = 'PlainDocumentConflictError'
    this.noteId = noteId
    this.panelId = panelId
    if (remote) {
      this.remoteVersion = remote.version
      this.remoteContent = remote.content
    }
  }
}

export interface PlainOfflineProviderOptions {
  enableBatching?: boolean
  batchConfig?: Partial<PlainBatchConfig>
}

/**
 * PlainOfflineProvider - Manages state without Yjs
 * Implements all 10 critical fixes from the Yjs implementation
 */
export class PlainOfflineProvider extends EventEmitter {
  private static instanceCounter = 0
  private instanceId: number

  public readonly isEmptyContent = this._isEmptyContent.bind(this)

  // Fix #2 & #5: Composite key storage
  private documents = new Map<string, ProseMirrorJSON | HtmlString>()
  private documentVersions = new Map<string, number>()
  private branches = new Map<string, Branch>()
  private notes = new Map<string, Note>()
  private panels = new Map<string, Panel>()
  
  // Fix #3 & #10: Async loading state tracking
  private loadingStates = new Map<string, Promise<void>>()
  
  // Fix #7-9: Object-based state to avoid closure issues
  private persistenceState = {
    initialized: false,
    lastSave: Date.now(),
    pendingOps: 0,
    updateCount: 0
  }

  // Phase 1: sequential save queue
  private saveQueues = new Map<string, Promise<void>>()
  private saveQueueDepth = new Map<string, number>()
  private readonly SAVE_QUEUE_TIMEOUT_MS = 7000
  
  // Track last access for cache management (from note switching fix)
  private lastAccess = new Map<string, number>()
  private readonly MAX_CACHE_SIZE = 50
  private readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutes
  
  private adapter: PlainCrudAdapter
  
  // Batching components
  private batchManager?: PlainBatchManager
  private offlineQueue?: PlainOfflineQueue
  private batchingEnabled: boolean

  constructor(adapter: PlainCrudAdapter, options?: PlainOfflineProviderOptions) {
    super()
    this.instanceId = ++PlainOfflineProvider.instanceCounter
    console.log(`[PlainOfflineProvider] Creating instance #${this.instanceId}`)
    this.adapter = adapter

    // Initialize batching if enabled
    this.batchingEnabled = options?.enableBatching ?? false
    
    if (this.batchingEnabled) {
      const config = mergeConfig(options?.batchConfig)
      this.batchManager = new PlainBatchManager(this, config)
      this.offlineQueue = new PlainOfflineQueue(config)
      
      this.setupBatchingListeners()
    }
    
    this.initialize()
  }

  /**
   * Initialize the provider
   */
  private async initialize() {
    console.log('[PlainOfflineProvider] Initializing...')
    this.persistenceState.initialized = true
    this.emit('initialized')
  }
  
  /**
   * Setup batching event listeners
   */
  private setupBatchingListeners(): void {
    if (!this.batchManager || !this.offlineQueue) return
    
    // Set execute operation for offline queue
    this.offlineQueue.setExecuteOperation(async (operation: BatchOperation) => {
      await this.batchExecute(operation.entityType, [operation])
    })
    
    // Forward offline events
    this.offlineQueue.on('offline', () => {
      console.log('[PlainOfflineProvider] Switching to offline mode')
      this.emit('offline')
    })
    
    this.offlineQueue.on('online', () => {
      console.log('[PlainOfflineProvider] Back online, processing queue')
      this.emit('online')
    })
    
    // Monitor batch operations
    if (this.batchManager) {
      this.batchManager.on('batch-flushed', ({ queueKey, count, originalCount, duration }) => {
        console.debug(`[Batch] Flushed ${count} operations (from ${originalCount}) for ${queueKey} in ${duration}ms`)
      })
      
      this.batchManager.on('batch-error', ({ operations, error }) => {
        console.error('[Batch] Error processing batch:', error)
        // Queue failed operations for retry
        operations.forEach((op: BatchOperation) => {
          this.offlineQueue?.enqueue(op).catch(err => 
            console.error('[Batch] Failed to queue operation:', err)
          )
        })
      })
    }
  }

  /**
   * Fix #2: Composite key pattern for note-panel isolation
   */
  private getCacheKey(noteId: string, panelId: string): string {
    return noteId ? `${noteId}-${panelId}` : panelId
  }

  private getQueueDepth(cacheKey: string): number {
    return this.saveQueueDepth.get(cacheKey) || 0
  }

  public getPendingSaveDepth(noteId: string, panelId: string): number {
    return this.getQueueDepth(this.getCacheKey(noteId, panelId))
  }

  private enqueueSave(
    cacheKey: string,
    meta: { noteId: string; panelId: string; version: number; baseVersion: number },
    task: () => Promise<void>
  ): Promise<void> {
    const depth = this.getQueueDepth(cacheKey) + 1
    this.saveQueueDepth.set(cacheKey, depth)
    if (AUTOSAVE_DEBUG) {
      providerAutosaveDebug('queue:enqueue', { cacheKey, depth, ...meta })
    }

    const previous = this.saveQueues.get(cacheKey) || Promise.resolve()

    const runTask = previous
      .catch(() => undefined)
      .then(async () => {
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null
        let timedOut = false
        if (AUTOSAVE_DEBUG) {
          providerAutosaveDebug('queue:start', { cacheKey, ...meta })
        }
        if (this.SAVE_QUEUE_TIMEOUT_MS > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true
            if (AUTOSAVE_DEBUG) {
              providerAutosaveDebug('queue:timeout', {
                cacheKey,
                timeoutMs: this.SAVE_QUEUE_TIMEOUT_MS,
                ...meta
              })
            } else {
              console.warn(`[PlainOfflineProvider] Save queue timeout (${this.SAVE_QUEUE_TIMEOUT_MS}ms) for ${cacheKey}`)
            }
          }, this.SAVE_QUEUE_TIMEOUT_MS)
        }
        try {
          await task()
          if (AUTOSAVE_DEBUG) {
            providerAutosaveDebug('queue:task-success', { cacheKey, timedOut, ...meta })
          }
        } catch (error) {
          if (AUTOSAVE_DEBUG) {
            providerAutosaveDebug('queue:task-error', {
              cacheKey,
              error: error instanceof Error ? error.message : error,
              ...meta
            })
          }
          throw error
        } finally {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle)
          }
        }
      })

    const queued = runTask.finally(() => {
      const remaining = this.getQueueDepth(cacheKey) - 1
      if (remaining > 0) {
        this.saveQueueDepth.set(cacheKey, remaining)
      } else {
        this.saveQueueDepth.delete(cacheKey)
      }
      if (this.saveQueues.get(cacheKey) === queued) {
        this.saveQueues.delete(cacheKey)
      }
      if (AUTOSAVE_DEBUG) {
        providerAutosaveDebug('queue:complete', {
          cacheKey,
          remaining: Math.max(remaining, 0),
          ...meta
        })
      }
    })

    this.saveQueues.set(cacheKey, queued)
    return queued
  }

  /**
   * Fix #1: Check for empty content before initialization
   */
  private _isEmptyContent(content: any): boolean {
    if (!content) return true

    if (typeof content === 'string') {
      const trimmed = content.trim()
      return trimmed.length === 0 || trimmed === '<p></p>'
    }

    if (typeof content === 'object') {
      try {
        const normalized = JSON.parse(JSON.stringify(content))
        const doc = normalized?.type === 'doc' ? normalized : { type: 'doc', content: [normalized] }

        if (!Array.isArray(doc.content) || doc.content.length === 0) {
          return true
        }

        const queue = [...doc.content]
        while (queue.length > 0) {
          const node = queue.shift()
          if (!node) continue

          if (typeof node === 'string') {
            const trimmed = node.trim()
            if (trimmed.length > 0) return false
            continue
          }

          if (typeof node.text === 'string') {
            const trimmed = node.text.trim()
            if (trimmed.length > 0) return false
          }

          if (Array.isArray(node.content)) {
            queue.push(...node.content)
          }
        }

        return true
      } catch {
        // If parsing fails, fall through to stringification heuristic
      }

      try {
        const stringified = JSON.stringify(content)
        return stringified === '{}' || stringified === '[]'
      } catch {
        return false
      }
    }

    return false
  }

  /**
   * Fix #3: Async loading with state tracking
   * Fix #10: Prevent duplicate loads
   */
  async loadDocument(noteId: string, panelId: string): Promise<ProseMirrorJSON | HtmlString | null> {
    const cacheKey = this.getCacheKey(noteId, panelId)
    
    console.log(`[PlainOfflineProvider] Loading document for noteId: ${noteId}, panelId: ${panelId}, cacheKey: ${cacheKey}`)
    if (AUTOSAVE_DEBUG) {
      providerAutosaveDebug('load:start', {
        cacheKey,
        noteId,
        panelId,
        hasCache: this.documents.has(cacheKey),
        pendingLoad: this.loadingStates.has(cacheKey)
      })
    }
    
    // Fix #10: Check if already loading
    if (this.loadingStates.has(cacheKey)) {
      console.log(`[PlainOfflineProvider] Already loading ${cacheKey}, waiting...`)
      await this.loadingStates.get(cacheKey)
      const cachedContent = this.documents.get(cacheKey)
      console.log(`[PlainOfflineProvider] After loading wait, cached content:`, cachedContent)
      if (AUTOSAVE_DEBUG) {
        providerAutosaveDebug('load:await-existing', {
          cacheKey,
          hasContent: !!cachedContent,
          version: this.documentVersions.get(cacheKey) || 0
        })
      }
      return cachedContent || null
    }
    
    // Check cache first
    const hadCachedContent = this.documents.has(cacheKey)
    const previousVersion = this.documentVersions.get(cacheKey) || 0

    if (hadCachedContent) {
      const cachedContent = this.documents.get(cacheKey)
      console.log(`[PlainOfflineProvider] Found cached document for ${cacheKey}:`, cachedContent)
      this.updateLastAccess(cacheKey)
      if (AUTOSAVE_DEBUG) {
        providerAutosaveDebug('load:cache-hit', {
          cacheKey,
          version: previousVersion
        })
      }
      return cachedContent || null
    }

    // Create loading promise
    const loadPromise = this.adapter.loadDocument(noteId, panelId)
      .then(result => {
        if (result) {
          console.log(`[PlainOfflineProvider] Loaded document for ${cacheKey}, version: ${result.version}, content:`, result.content)
          if (AUTOSAVE_DEBUG) {
            providerAutosaveDebug('load:adapter-success', {
              cacheKey,
              version: result.version,
              isEmpty: this.isEmptyContent(result.content)
            })
          }

          // Fix #1: Clear empty content
          if (this.isEmptyContent(result.content)) {
            console.log(`[PlainOfflineProvider] Content is empty, using empty doc for ${cacheKey}`)
            const emptyDoc = { type: 'doc', content: [] }
            this.documents.set(cacheKey, emptyDoc)
            this.documentVersions.set(cacheKey, result.version)
            this.updateLastAccess(cacheKey)
          } else {
            this.documents.set(cacheKey, result.content)
            this.documentVersions.set(cacheKey, result.version)
            this.updateLastAccess(cacheKey)

            // Emit remote-update event if this is a refresh (cache was populated before)
            // Don't emit on first load to avoid interfering with normal content loading
            if (hadCachedContent && result.version > previousVersion) {
              console.log(`[PlainOfflineProvider] Emitting remote-update: ${cacheKey} refreshed from v${previousVersion} to v${result.version}`)
              this.emit('document:remote-update', {
                noteId,
                panelId,
                version: result.version,
                content: result.content,
                reason: 'refresh'
              })
            }
          }
        } else {
          console.log(`[PlainOfflineProvider] No document found for ${cacheKey}`)
          if (AUTOSAVE_DEBUG) {
            providerAutosaveDebug('load:adapter-empty', { cacheKey })
          }
        }
      })
      .catch(error => {
        console.error(`[PlainOfflineProvider] Failed to load document for ${cacheKey}:`, error)
        if (AUTOSAVE_DEBUG) {
          providerAutosaveDebug('load:error', {
            cacheKey,
            error: error instanceof Error ? error.message : error
          })
        }
        throw error
      })
      .finally(() => {
        // Clear loading state
        this.loadingStates.delete(cacheKey)
      })
    
    this.loadingStates.set(cacheKey, loadPromise)
    
    try {
      await loadPromise
      if (AUTOSAVE_DEBUG) {
        providerAutosaveDebug('load:complete', {
          cacheKey,
          hasContent: this.documents.has(cacheKey),
          version: this.documentVersions.get(cacheKey) || 0
        })
      }

      // DEBUG: Cross-browser sync investigation
      const loadedContent = this.documents.get(cacheKey) || null
      console.log(`[🔍 SYNC-DEBUG] loadDocument complete for ${cacheKey}`, {
        hasContent: !!loadedContent,
        version: this.documentVersions.get(cacheKey),
        contentPreview: loadedContent ? JSON.stringify(loadedContent).substring(0, 100) : 'NULL',
        cacheSize: this.documents.size
      })

      return loadedContent
    } catch (error) {
      if (AUTOSAVE_DEBUG) {
        providerAutosaveDebug('load:complete-error', {
          cacheKey,
          error: error instanceof Error ? error.message : error
        })
      }
      return null
    }
  }

  /**
   * Save document with version tracking
   */
  async saveDocument(
    noteId: string, 
    panelId: string, 
    content: ProseMirrorJSON | HtmlString, 
    skipPersist = false,
    options?: { skipBatching?: boolean }
  ): Promise<void> {
    const cacheKey = this.getCacheKey(noteId, panelId)

    console.log(`[PlainOfflineProvider] Saving document for noteId: ${noteId}, panelId: ${panelId}, cacheKey: ${cacheKey}, content:`, content)

    // Update local cache; bump version only if content changed
    const previousVersion = this.documentVersions.get(cacheKey) || 0
    const prev = this.documents.get(cacheKey)
    const changed = JSON.stringify(prev) !== JSON.stringify(content)
    this.documents.set(cacheKey, content)
    const currentVersion = changed ? previousVersion + 1 : previousVersion
    this.documentVersions.set(cacheKey, currentVersion)
    const baseVersion = previousVersion
    this.updateLastAccess(cacheKey)
    if (AUTOSAVE_DEBUG) {
      providerAutosaveDebug('save:start', {
        cacheKey,
        noteId,
        panelId,
        baseVersion,
        nextVersion: currentVersion,
        changed,
        skipPersist,
        batching: this.batchingEnabled && !options?.skipBatching
      })
    }
    if (!changed) {
      if (AUTOSAVE_DEBUG) {
        providerAutosaveDebug('save:skip-unchanged', { cacheKey, version: currentVersion })
      }
      return
    }
    
    // Fix #7-9: Update object state
    this.persistenceState.updateCount++
    this.persistenceState.lastSave = Date.now()
    
    // Persist to adapter unless skipped (for initial loads)
    if (!skipPersist) {
      const meta = { noteId, panelId, version: currentVersion, baseVersion }
      const persistTask = async () => {
        const latestKnownVersion = this.documentVersions.get(cacheKey) || 0
        if (latestKnownVersion > currentVersion) {
          if (AUTOSAVE_DEBUG) {
            providerAutosaveDebug('save:skip-stale-version', {
              cacheKey,
              queuedVersion: currentVersion,
              knownVersion: latestKnownVersion
            })
          }
          return
        }

        // Use batching if enabled and not explicitly skipped
        if (this.batchingEnabled && !options?.skipBatching && this.batchManager) {
          await this.batchManager.enqueue({
            entityType: 'document',
            entityId: `${noteId}:${panelId}`,
            operation: 'update',
            data: { noteId, panelId, content, version: currentVersion, baseVersion }
          })
          console.log(`[PlainOfflineProvider] Document queued for batching: ${cacheKey}`)
          if (AUTOSAVE_DEBUG) {
            providerAutosaveDebug('save:queued-for-batch', {
              cacheKey,
              version: currentVersion
            })
          }
          return
        }

        // Direct save without batching
        try {
          await this.adapter.saveDocument(noteId, panelId, content, currentVersion, baseVersion)
          console.log(`[PlainOfflineProvider] Persisted document for ${cacheKey}, version: ${currentVersion}`)
          if (AUTOSAVE_DEBUG) {
            providerAutosaveDebug('save:adapter-success', {
              cacheKey,
              version: currentVersion
            })
          }
          
          // Auto-cleanup if update count is high
          if (this.persistenceState.updateCount > 50) {
            console.log(`[PlainOfflineProvider] Auto-cleanup after ${this.persistenceState.updateCount} updates`)
            this.cleanupCache()
            this.persistenceState.updateCount = 0
          }
        } catch (error) {
          console.error(`[PlainOfflineProvider] Failed to persist document for ${cacheKey}:`, error)
          const message = error instanceof Error ? error.message : ''
          if (this.isConflictError(message)) {
            if (AUTOSAVE_DEBUG) {
              providerAutosaveDebug('save:conflict', {
                cacheKey,
                baseVersion,
                nextVersion: currentVersion,
                message
              })
            }
            this.revertOptimisticUpdate(cacheKey, prev, previousVersion)

            // CRITICAL: Check content BEFORE refreshing to decide if we should emit events
            // Load latest from DB without emitting events yet
            const latest = await this.adapter.loadDocument(noteId, panelId)

            if (!latest) {
              throw new PlainDocumentConflictError(noteId, panelId, message, undefined)
            }

            // Compare content - if identical, this is just a version bump (silent catchup)
            const contentDiffers = JSON.stringify(content) !== JSON.stringify(latest.content)

            // Update cache with latest version
            this.documents.set(cacheKey, latest.content)
            this.documentVersions.set(cacheKey, latest.version)
            this.updateLastAccess(cacheKey)

            if (contentDiffers) {
              // Real conflict - content actually differs
              console.log(`[🔍 PROVIDER-CONFLICT] Instance #${this.instanceId} real conflict detected (content differs)`, {
                noteId,
                panelId,
                baseVersion,
                remoteVersion: latest.version,
                instanceId: this.instanceId
              })

              // Log to debug system
              import('@/lib/utils/debug-logger').then(({ debugLog }) => {
                debugLog({
                  component: 'CrossBrowserSync',
                  action: 'CONFLICT_CONTENT_DIFFERS',
                  metadata: {
                    noteId,
                    panelId,
                    baseVersion,
                    remoteVersion: latest.version,
                    instanceId: this.instanceId
                  }
                })
              }).catch(() => {})

              // Emit remote-update event (will trigger notification)
              this.emit('document:remote-update', {
                noteId,
                panelId,
                version: latest.version,
                content: latest.content,
                reason: 'conflict'
              })

              // Emit conflict event
              const listenerCount = this.listenerCount('document:conflict')
              this.emit('document:conflict', {
                noteId,
                panelId,
                message,
                remoteVersion: latest.version,
                remoteContent: latest.content
              })

              console.log(`[🔍 PROVIDER-CONFLICT] Instance #${this.instanceId} conflict events emitted, listener count:`, listenerCount)

              const conflictError = new PlainDocumentConflictError(noteId, panelId, message, latest)
              throw conflictError
            } else {
              // Silent catchup - content is identical, just version bumped
              console.log(`[🔍 PROVIDER-CONFLICT] Instance #${this.instanceId} silent catchup (content identical)`, {
                noteId,
                panelId,
                baseVersion,
                remoteVersion: latest.version,
                message: 'Version conflict but content identical - silent catchup, no events'
              })

              // Log silent conflict resolution to debug system
              import('@/lib/utils/debug-logger').then(({ debugLog }) => {
                debugLog({
                  component: 'CrossBrowserSync',
                  action: 'CONFLICT_SILENT_CATCHUP',
                  metadata: {
                    noteId,
                    panelId,
                    baseVersion,
                    remoteVersion: latest.version,
                    message: 'Version conflict but content identical - silent catchup, no events'
                  }
                })
              }).catch(() => {})

              // Don't emit any events - just silently caught up to latest version
              // Return normally without throwing
              return
            }
          }
          if (
            message.includes('must be a number') ||
            message.includes('baseVersion')
          ) {
            this.revertOptimisticUpdate(cacheKey, prev, previousVersion)
            throw error
          }
          // Queue for offline sync
          if (this.offlineQueue) {
            await this.offlineQueue.enqueue({
              id: this.generateId(),
              entityType: 'document',
              entityId: cacheKey,
              operation: 'update',
              data: { noteId, panelId, content, version: currentVersion, baseVersion },
              timestamp: Date.now()
            })
            if (AUTOSAVE_DEBUG) {
              providerAutosaveDebug('save:queued-offline', {
                cacheKey,
                version: currentVersion
              })
            }
          } else {
            await this.adapter.enqueueOffline({
              operation: 'update',
              entityType: 'document',
              entityId: cacheKey,
              payload: { noteId, panelId, content, version: currentVersion, baseVersion }
            })
            if (AUTOSAVE_DEBUG) {
              providerAutosaveDebug('save:enqueue-offline-adapter', {
                cacheKey,
                version: currentVersion
              })
            }
          }
        }
      }

      await this.enqueueSave(cacheKey, meta, persistTask)
    }

    this.emit('document:saved', { noteId, panelId, version: currentVersion })
    if (AUTOSAVE_DEBUG) {
      providerAutosaveDebug('save:emitted', {
        cacheKey,
        version: currentVersion
      })
    }
  }

  private isConflictError(message: string): boolean {
    return (
      !!message &&
      (message.includes('stale document save') || message.includes('non-incrementing version'))
    )
  }

  private revertOptimisticUpdate(
    cacheKey: string,
    previousContent: ProseMirrorJSON | HtmlString | undefined,
    previousVersion: number
  ) {
    if (previousContent !== undefined) {
      this.documents.set(cacheKey, previousContent)
    } else {
      this.documents.delete(cacheKey)
    }
    this.documentVersions.set(cacheKey, previousVersion)
    if (this.persistenceState.updateCount > 0) {
      this.persistenceState.updateCount--
    }
  }

  /**
   * Public method to force refresh from database and emit update events
   * Use this when you want to check for remote changes (e.g., on visibility change)
   */
  async checkForRemoteUpdates(noteId: string, panelId: string): Promise<void> {
    await this.refreshDocumentFromRemote(noteId, panelId, 'manual')
  }

  private async refreshDocumentFromRemote(
    noteId: string,
    panelId: string,
    reason: 'conflict' | 'manual' | 'visibility'
  ): Promise<{ content: ProseMirrorJSON | HtmlString; version: number } | null> {
    try {
      const latest = await this.adapter.loadDocument(noteId, panelId)
      const cacheKey = this.getCacheKey(noteId, panelId)

      if (latest) {
        // Compare with cached VERSION before emitting event
        const cached = this.documents.get(cacheKey)
        const cachedVersion = this.documentVersions.get(cacheKey) || 0

        // CRITICAL: For cross-browser sync, use VERSION comparison, not content comparison
        // Content comparison fails because each browser has its own stale cache
        // Version numbers are monotonically increasing and reliable
        const versionChanged = latest.version > cachedVersion

        // Emit if: no cache yet OR version increased
        const shouldEmit = !cached || versionChanged

        // Update cache
        this.documents.set(cacheKey, latest.content)
        this.documentVersions.set(cacheKey, latest.version)
        this.updateLastAccess(cacheKey)

        // Emit event if version changed or this is a visibility refresh with different version
        if (shouldEmit) {
          console.log(`[PlainOfflineProvider] Version changed (${cachedVersion} → ${latest.version}), emitting remote-update event for ${cacheKey}`)
          // Use dynamic import to avoid circular dependency
          import('@/lib/utils/debug-logger').then(({ debugLog }) => {
            debugLog({
              component: 'CrossBrowserSync',
              action: 'PROVIDER_EMIT_REMOTE_UPDATE',
              metadata: {
                noteId,
                panelId,
                version: latest.version,
                cachedVersion,
                versionChanged,
                reason,
                cacheKey,
                hadCached: !!cached
              }
            })
          }).catch(() => {})

          this.emit('document:remote-update', {
            noteId,
            panelId,
            version: latest.version,
            content: latest.content,
            reason
          })
        } else {
          console.log(`[PlainOfflineProvider] Version unchanged (${cachedVersion}), skipping remote-update event for ${cacheKey}`)
          // Use dynamic import to avoid circular dependency
          import('@/lib/utils/debug-logger').then(({ debugLog }) => {
            debugLog({
              component: 'CrossBrowserSync',
              action: 'PROVIDER_SKIP_IDENTICAL',
              metadata: {
                noteId,
                panelId,
                version: latest.version,
                cachedVersion,
                versionChanged: false,
                reason,
                cacheKey
              }
            })
          }).catch(() => {})
        }

        return latest
      }

      // If remote has no document, ensure cache clears so future loads hit server
      this.documents.delete(cacheKey)
      this.documentVersions.set(cacheKey, 0)
      return null
    } catch (loadError) {
      console.error('[PlainOfflineProvider] Failed to refresh document from remote:', loadError)
      // Use dynamic import to avoid circular dependency
      import('@/lib/utils/debug-logger').then(({ debugLog }) => {
        debugLog({
          component: 'CrossBrowserSync',
          action: 'PROVIDER_REFRESH_ERROR',
          metadata: {
            noteId,
            panelId,
            reason,
            error: loadError instanceof Error ? loadError.message : String(loadError)
          }
        })
      }).catch(() => {})
      return null
    }
  }

  /**
   * Branch operations
   */
  async createBranch(branch: Partial<Branch>, options?: { skipBatching?: boolean }): Promise<Branch> {
    const newBranch: Branch = {
      id: branch.id || this.generateId(),
      noteId: branch.noteId || '',
      parentId: branch.parentId || '',
      type: branch.type || 'note',
      title: branch.title, // Preserve title for database persistence
      originalText: branch.originalText || '',
      metadata: branch.metadata || {},
      anchors: branch.anchors,
      createdAt: new Date(),
      updatedAt: new Date()
    }
    
    this.branches.set(newBranch.id, newBranch)
    
    if (this.batchingEnabled && !options?.skipBatching && this.batchManager) {
      await this.batchManager.enqueue({
        entityType: 'branch',
        entityId: newBranch.id,
        operation: 'create',
        data: newBranch
      })
      this.emit('branch:created', newBranch)
      return newBranch
    }
    
    try {
      const created = await this.adapter.createBranch(newBranch)
      this.branches.set(created.id, created)
      this.emit('branch:created', created)
      return created
    } catch (error) {
      console.error('[PlainOfflineProvider] Failed to create branch:', error)
      if (this.offlineQueue) {
        await this.offlineQueue.enqueue({
          id: this.generateId(),
          entityType: 'branch',
          entityId: newBranch.id,
          operation: 'create',
          data: newBranch,
          timestamp: Date.now()
        })
      } else {
        await this.adapter.enqueueOffline({
          operation: 'create',
          entityType: 'branch',
          entityId: newBranch.id,
          payload: newBranch
        })
      }
      return newBranch
    }
  }

  async updateBranch(id: string, updates: Partial<Branch>, options?: { skipBatching?: boolean }): Promise<Branch | null> {
    const branch = this.branches.get(id)
    if (!branch) return null
    
    const updated = { ...branch, ...updates, updatedAt: new Date() }
    this.branches.set(id, updated)
    
    if (this.batchingEnabled && !options?.skipBatching && this.batchManager) {
      await this.batchManager.enqueue({
        entityType: 'branch',
        entityId: id,
        operation: 'update',
        data: updated
      })
      this.emit('branch:updated', updated)
      return updated
    }
    
    try {
      const result = await this.adapter.updateBranch(id, { ...updates, version: 1 })
      this.branches.set(id, result)
      this.emit('branch:updated', result)
      return result
    } catch (error) {
      console.error('[PlainOfflineProvider] Failed to update branch:', error)
      if (this.offlineQueue) {
        await this.offlineQueue.enqueue({
          id: this.generateId(),
          entityType: 'branch',
          entityId: id,
          operation: 'update',
          data: updated,
          timestamp: Date.now()
        })
      } else {
        await this.adapter.enqueueOffline({
          operation: 'update',
          entityType: 'branch',
          entityId: id,
          payload: updated
        })
      }
      return updated
    }
  }

  getBranch(id: string): Branch | undefined {
    return this.branches.get(id)
  }

  getBranchesForNote(noteId: string): Branch[] {
    return Array.from(this.branches.values()).filter(b => b.noteId === noteId)
  }

  /**
   * Change the type of an existing branch and track history
   */
  async changeBranchType(
    branchId: string,
    newType: 'note' | 'explore' | 'promote'
  ): Promise<void> {
    // Don't check in-memory cache - branches may be loaded directly via adapter
    // Just call API directly
    try {
      const response = await fetch(`/api/postgres-offline/branches/${branchId}/change-type`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newType })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to change branch type: ${response.statusText}`)
      }

      const result = await response.json()

      // Update in-memory cache if branch exists there
      if (this.branches.has(branchId)) {
        this.branches.set(branchId, result)
      }

      // Emit event for UI to react
      this.emit('branch:updated', result)

      console.log(`✓ Changed branch ${branchId} type to ${newType}`)

      return result
    } catch (error) {
      console.error('[PlainOfflineProvider] Failed to change branch type:', error)
      throw error
    }
  }

  /**
   * Fix #6: Metadata handling for fragment field detection
   */
  getFieldType(metadata: any): string {
    return metadata?.fieldType || 'prosemirror'
  }

  /**
   * Fix #4: No deletion on unmount - preserve cache
   */
  destroy() {
    console.log('[PlainOfflineProvider] Destroying provider - preserving cache')
    // Do NOT clear documents/branches
    // Only clear loading states and mark as uninitialized
    this.loadingStates.clear()
    this.persistenceState.initialized = false
    this.removeAllListeners()
  }

  /**
   * Update last access time for cache management
   */
  private updateLastAccess(cacheKey: string) {
    this.lastAccess.set(cacheKey, Date.now())
  }

  /**
   * Smart cache cleanup - keeps recently used items
   */
  private cleanupCache() {
    if (this.documents.size <= this.MAX_CACHE_SIZE) {
      return
    }
    
    const now = Date.now()
    const entries = Array.from(this.lastAccess.entries())
    
    // Sort by last access time (oldest first)
    entries.sort((a, b) => a[1] - b[1])
    
    // Remove oldest entries
    const toRemove = this.documents.size - this.MAX_CACHE_SIZE + 5
    
    for (let i = 0; i < toRemove && i < entries.length; i++) {
      const [key, lastAccess] = entries[i]
      
      // Only remove if hasn't been accessed recently
      if (now - lastAccess > this.CACHE_TTL) {
        this.documents.delete(key)
        this.documentVersions.delete(key)
        this.lastAccess.delete(key)
        console.log(`[PlainOfflineProvider] Evicted old cache entry: ${key}`)
      }
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Get document from cache
   */
  getDocument(noteId: string, panelId: string): ProseMirrorJSON | HtmlString | null {
    const cacheKey = this.getCacheKey(noteId, panelId)
    const doc = this.documents.get(cacheKey) || null
    console.log(`[PlainOfflineProvider] getDocument(${cacheKey}): found=${!!doc}, cacheSize=${this.documents.size}`)
    return doc
  }

  /**
   * Get document version
   */
  getDocumentVersion(noteId: string, panelId: string): number {
    const cacheKey = this.getCacheKey(noteId, panelId)
    const version = this.documentVersions.get(cacheKey) || 0
    console.log(`[PlainOfflineProvider] getDocumentVersion(${cacheKey}): version=${version}`)
    return version
  }

  /**
   * Sync offline queue
   */
  async syncOfflineQueue(): Promise<{ processed: number; failed: number }> {
    console.log('[PlainOfflineProvider] Syncing offline queue...')
    try {
      const result = await this.adapter.flushQueue()
      console.log(`[PlainOfflineProvider] Queue sync complete:`, result)
      this.emit('queue:synced', result)
      return result
    } catch (error) {
      console.error('[PlainOfflineProvider] Queue sync failed:', error)
      return { processed: 0, failed: 0 }
    }
  }

  /**
   * Check if provider is initialized
   */
  isInitialized(): boolean {
    return this.persistenceState.initialized
  }

  /**
   * Get persistence state for debugging
   */
  getPersistenceState() {
    return { ...this.persistenceState }
  }
  
  /**
   * Batch execution method for batched operations
   */
  async batchExecute(entityType: string, operations: BatchOperation[]): Promise<void> {
    // Group operations by type
    const creates = operations.filter(op => op.operation === 'create')
    const updates = operations.filter(op => op.operation === 'update')
    const deletes = operations.filter(op => op.operation === 'delete')
    
    try {
      // Execute creates
      if (creates.length > 0) {
        await this.batchCreate(entityType, creates)
      }
      
      // Execute updates
      if (updates.length > 0) {
        await this.batchUpdate(entityType, updates)
      }
      
      // Execute deletes
      if (deletes.length > 0) {
        await this.batchDelete(entityType, deletes)
      }
    } catch (error) {
      console.error(`[PlainOfflineProvider] Batch execute failed for ${entityType}:`, error)
      throw error
    }
  }
  
  private async batchCreate(entityType: string, operations: BatchOperation[]): Promise<void> {
    const endpoint = this.getEndpoint(entityType)
    
    const response = await fetch(`${endpoint}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: operations.map(op => ({
          ...op.data,
          idempotencyKey: op.idempotencyKey
        }))
      })
    })
    
    if (!response.ok) {
      throw new Error(`Batch create failed: ${response.statusText}`)
    }
    
    const result = await response.json()
    console.debug(`[PlainOfflineProvider] Batch created ${operations.length} ${entityType}s`)
  }
  
  private async batchUpdate(entityType: string, operations: BatchOperation[]): Promise<void> {
    const endpoint = this.getEndpoint(entityType)
    
    const response = await fetch(`${endpoint}/batch`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: operations.map(op => ({
          id: op.entityId,
          data: op.data,
          idempotencyKey: op.idempotencyKey
        }))
      })
    })
    
    if (!response.ok) {
      throw new Error(`Batch update failed: ${response.statusText}`)
    }
    
    const result = await response.json()
    console.debug(`[PlainOfflineProvider] Batch updated ${operations.length} ${entityType}s`)
  }
  
  private async batchDelete(entityType: string, operations: BatchOperation[]): Promise<void> {
    const endpoint = this.getEndpoint(entityType)
    
    const response = await fetch(`${endpoint}/batch`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: operations.map(op => op.entityId)
      })
    })
    
    if (!response.ok) {
      throw new Error(`Batch delete failed: ${response.statusText}`)
    }
    
    console.debug(`[PlainOfflineProvider] Batch deleted ${operations.length} ${entityType}s`)
  }
  
  private getEndpoint(entityType: string): string {
    const base = '/api/postgres-offline'
    
    switch (entityType) {
      case 'document':
        return `${base}/documents`
      case 'branch':
        return `${base}/branches`
      case 'panel':
        return `${base}/panels`
      default:
        throw new Error(`Unknown entity type: ${entityType}`)
    }
  }
  
  /**
   * Panel operations with batching support
   */
  async savePanel(panel: Partial<Panel>, options?: { skipBatching?: boolean }): Promise<void> {
    if (!panel.id) {
      throw new Error('Panel ID is required')
    }
    
    const fullPanel: Panel = {
      id: panel.id,
      noteId: panel.noteId || '',
      position: panel.position || { x: 0, y: 0 },
      dimensions: panel.dimensions || { width: 400, height: 300 },
      state: panel.state || 'active',
      lastAccessed: new Date()
    }
    
    this.panels.set(fullPanel.id, fullPanel)
    
    if (this.batchingEnabled && !options?.skipBatching && this.batchManager) {
      await this.batchManager.enqueue({
        entityType: 'panel',
        entityId: fullPanel.id,
        operation: 'update',
        data: fullPanel
      })
      this.emit('panel:saved', fullPanel)
      return
    }
    
    // Direct save without batching
    this.emit('panel:saved', fullPanel)
  }
  
  /**
   * Batching control methods
   */
  setBatchingEnabled(enabled: boolean): void {
    this.batchingEnabled = enabled
    if (this.batchManager) {
      this.batchManager.setEnabled(enabled)
    }
    console.log(`[PlainOfflineProvider] Batching ${enabled ? 'enabled' : 'disabled'}`)
  }
  
  isBatchingEnabled(): boolean {
    return this.batchingEnabled
  }
  
  getBatchManager(): PlainBatchManager | undefined {
    return this.batchManager
  }
  
  getOfflineQueue(): PlainOfflineQueue | undefined {
    return this.offlineQueue
  }
  
  async flushBatches(): Promise<void> {
    if (this.batchManager) {
      await this.batchManager.flushAll()
    }
  }
  
  updateBatchConfig(config: Partial<PlainBatchConfig>): void {
    if (this.batchManager) {
      this.batchManager.updateConfig(config)
    }
  }
}
