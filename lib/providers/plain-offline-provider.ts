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
  originalText: string
  metadata?: Record<string, any>
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
  saveDocument(noteId: string, panelId: string, content: ProseMirrorJSON | HtmlString, version: number): Promise<void>
  loadDocument(noteId: string, panelId: string): Promise<{ content: ProseMirrorJSON | HtmlString; version: number } | null>

  // Offline queue operations
  enqueueOffline(op: QueueOp): Promise<void>
  flushQueue(): Promise<{ processed: number; failed: number }>
}

/**
 * PlainOfflineProvider - Manages state without Yjs
 * Implements all 10 critical fixes from the Yjs implementation
 */
export class PlainOfflineProvider extends EventEmitter {
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
  
  // Track last access for cache management (from note switching fix)
  private lastAccess = new Map<string, number>()
  private readonly MAX_CACHE_SIZE = 50
  private readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutes
  
  private adapter: PlainCrudAdapter

  constructor(adapter: PlainCrudAdapter) {
    super()
    this.adapter = adapter
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
   * Fix #2: Composite key pattern for note-panel isolation
   */
  private getCacheKey(noteId: string, panelId: string): string {
    return noteId ? `${noteId}-${panelId}` : panelId
  }

  /**
   * Fix #1: Check for empty content before initialization
   */
  private isEmptyContent(content: any): boolean {
    if (!content) return true
    if (typeof content === 'string') {
      return content === '<p></p>' || content.trim() === ''
    }
    if (content.type === 'doc' && (!content.content || content.content.length === 0)) {
      return true
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
    
    // Fix #10: Check if already loading
    if (this.loadingStates.has(cacheKey)) {
      console.log(`[PlainOfflineProvider] Already loading ${cacheKey}, waiting...`)
      await this.loadingStates.get(cacheKey)
      const cachedContent = this.documents.get(cacheKey)
      console.log(`[PlainOfflineProvider] After loading wait, cached content:`, cachedContent)
      return cachedContent || null
    }
    
    // Check cache first
    if (this.documents.has(cacheKey)) {
      const cachedContent = this.documents.get(cacheKey)
      console.log(`[PlainOfflineProvider] Found cached document for ${cacheKey}:`, cachedContent)
      this.updateLastAccess(cacheKey)
      return cachedContent || null
    }
    
    // Create loading promise
    const loadPromise = this.adapter.loadDocument(noteId, panelId)
      .then(result => {
        if (result) {
          console.log(`[PlainOfflineProvider] Loaded document for ${cacheKey}, version: ${result.version}, content:`, result.content)
          
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
          }
        } else {
          console.log(`[PlainOfflineProvider] No document found for ${cacheKey}`)
        }
      })
      .catch(error => {
        console.error(`[PlainOfflineProvider] Failed to load document for ${cacheKey}:`, error)
        throw error
      })
      .finally(() => {
        // Clear loading state
        this.loadingStates.delete(cacheKey)
      })
    
    this.loadingStates.set(cacheKey, loadPromise)
    
    try {
      await loadPromise
      return this.documents.get(cacheKey) || null
    } catch (error) {
      return null
    }
  }

  /**
   * Save document with version tracking
   */
  async saveDocument(noteId: string, panelId: string, content: ProseMirrorJSON | HtmlString, skipPersist = false): Promise<void> {
    const cacheKey = this.getCacheKey(noteId, panelId)
    
    console.log(`[PlainOfflineProvider] Saving document for noteId: ${noteId}, panelId: ${panelId}, cacheKey: ${cacheKey}, content:`, content)
    
    // Update local cache
    this.documents.set(cacheKey, content)
    const currentVersion = (this.documentVersions.get(cacheKey) || 0) + 1
    this.documentVersions.set(cacheKey, currentVersion)
    this.updateLastAccess(cacheKey)
    
    // Fix #7-9: Update object state
    this.persistenceState.updateCount++
    this.persistenceState.lastSave = Date.now()
    
    // Persist to adapter unless skipped (for initial loads)
    if (!skipPersist) {
      try {
        await this.adapter.saveDocument(noteId, panelId, content, currentVersion)
        console.log(`[PlainOfflineProvider] Persisted document for ${cacheKey}, version: ${currentVersion}`)
        
        // Auto-cleanup if update count is high
        if (this.persistenceState.updateCount > 50) {
          console.log(`[PlainOfflineProvider] Auto-cleanup after ${this.persistenceState.updateCount} updates`)
          this.cleanupCache()
          this.persistenceState.updateCount = 0
        }
      } catch (error) {
        console.error(`[PlainOfflineProvider] Failed to persist document for ${cacheKey}:`, error)
        // Queue for offline sync
        await this.adapter.enqueueOffline({
          operation: 'update',
          entityType: 'document',
          entityId: cacheKey,
          payload: { noteId, panelId, content, version: currentVersion }
        })
      }
    }
    
    this.emit('document:saved', { noteId, panelId, version: currentVersion })
  }

  /**
   * Branch operations
   */
  async createBranch(branch: Partial<Branch>): Promise<Branch> {
    const newBranch: Branch = {
      id: branch.id || this.generateId(),
      noteId: branch.noteId || '',
      parentId: branch.parentId || '',
      type: branch.type || 'note',
      originalText: branch.originalText || '',
      metadata: branch.metadata || {},
      anchors: branch.anchors,
      createdAt: new Date(),
      updatedAt: new Date()
    }
    
    this.branches.set(newBranch.id, newBranch)
    
    try {
      const created = await this.adapter.createBranch(newBranch)
      this.branches.set(created.id, created)
      this.emit('branch:created', created)
      return created
    } catch (error) {
      console.error('[PlainOfflineProvider] Failed to create branch:', error)
      await this.adapter.enqueueOffline({
        operation: 'create',
        entityType: 'branch',
        entityId: newBranch.id,
        payload: newBranch
      })
      return newBranch
    }
  }

  async updateBranch(id: string, updates: Partial<Branch>): Promise<Branch | null> {
    const branch = this.branches.get(id)
    if (!branch) return null
    
    const updated = { ...branch, ...updates, updatedAt: new Date() }
    this.branches.set(id, updated)
    
    try {
      const result = await this.adapter.updateBranch(id, { ...updates, version: 1 })
      this.branches.set(id, result)
      this.emit('branch:updated', result)
      return result
    } catch (error) {
      console.error('[PlainOfflineProvider] Failed to update branch:', error)
      await this.adapter.enqueueOffline({
        operation: 'update',
        entityType: 'branch',
        entityId: id,
        payload: updated
      })
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
    return this.documents.get(cacheKey) || null
  }

  /**
   * Get document version
   */
  getDocumentVersion(noteId: string, panelId: string): number {
    const cacheKey = this.getCacheKey(noteId, panelId)
    return this.documentVersions.get(cacheKey) || 0
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
}