import * as Y from 'yjs'

// Mock IndexedDB persistence for browser compatibility
// In a real implementation, you would use: import { IndexeddbPersistence } from 'y-indexeddb'
interface PersistenceProvider {
  synced: boolean
  on(event: string, callback: () => void): void
  destroy(): void
}

class MockIndexeddbPersistence implements PersistenceProvider {
  synced: boolean = false
  private doc: Y.Doc
  private docName: string
  private eventListeners: Map<string, (() => void)[]> = new Map()

  constructor(docName: string, doc: Y.Doc) {
    this.doc = doc
    this.docName = docName
    this.setupPersistence()
  }

  private async setupPersistence() {
    // Load existing state from localStorage as Y.js update
    const savedState = localStorage.getItem(`yjs-doc-${this.docName}`)
    if (savedState) {
      try {
        // Parse the saved state and apply to document
        const updates = JSON.parse(savedState)
        if (updates.documentState) {
          // Apply saved updates to the document
          const uint8Array = new Uint8Array(Object.values(updates.documentState))
          Y.applyUpdate(this.doc, uint8Array)
        }
      } catch (error) {
        console.warn('Failed to restore YJS state from localStorage:', error)
      }
    }

    // Listen for document changes and persist them
    this.doc.on('update', (update: Uint8Array) => {
      this.persistUpdate(update)
    })

    this.synced = true
    this.emit('synced')
  }

  private persistUpdate(update: Uint8Array) {
    // Convert Y.js state to persistable format
    const state = Y.encodeStateAsUpdate(this.doc)
    const persistableState = {
      documentState: Array.from(state),
      timestamp: Date.now()
    }
    localStorage.setItem(`yjs-doc-${this.docName}`, JSON.stringify(persistableState))
  }

  on(event: string, callback: () => void) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, [])
    }
    this.eventListeners.get(event)!.push(callback)
  }

  private emit(event: string) {
    const listeners = this.eventListeners.get(event) || []
    listeners.forEach(callback => callback())
  }

  destroy() {
    this.eventListeners.clear()
  }
}

// Store for editor Y.Docs indexed by note ID + panel ID
const editorDocs = new Map<string, Y.Doc>()

// Track last access time for cache management
const editorDocsLastAccess = new Map<string, number>()

// Maximum number of editor docs to keep in cache
const MAX_EDITOR_DOCS = 50

// Time to keep unused docs in cache (5 minutes)
const EDITOR_DOC_TTL = 5 * 60 * 1000

// Clear editor docs for a specific note when switching
// This is now deprecated - we use smart cache management instead
export function clearEditorDocsForNote(noteId: string): void {
  // No longer aggressively clear docs
  // The smart cache management in cleanupEditorDocsCache handles memory
  // and the composite key system prevents content leakage between notes
  
  // Optional: Mark docs from this note as older to prioritize cleanup
  const now = Date.now()
  editorDocsLastAccess.forEach((lastAccess, key) => {
    if (key.startsWith(`${noteId}-`)) {
      // Age the entry by 1 minute to prioritize it for cleanup if needed
      editorDocsLastAccess.set(key, lastAccess - 60000)
    }
  })
}

// Track which docs have persistence handlers set up
const docsWithPersistence = new Set<string>()

// WeakMap to track which Y.Doc instances have persistence handlers
// This stores the handler function so we can properly manage it
const docsWithPersistenceHandlers = new WeakMap<Y.Doc, any>()

// Track which docs are currently loading to prevent multiple concurrent loads
const docsCurrentlyLoading = new Set<string>()

// Set up persistence handler for a Y.Doc
function setupPersistenceHandler(doc: Y.Doc, docKey: string, cacheKey: string): void {
  console.log(`[SETUP] Starting setupPersistenceHandler for docKey: ${docKey}, cacheKey: ${cacheKey}`)
  
  // Check if this specific doc instance already has handlers set up
  const existingHandler = docsWithPersistenceHandlers.get(doc)
  if (existingHandler) {
    console.log(`[SETUP] Found existing handler for doc instance: ${docKey}`)
    console.log(`[SETUP] Existing handler info:`, {
      docKey: existingHandler.docKey,
      cacheKey: existingHandler.cacheKey,
      isActive: existingHandler.isActive ? existingHandler.isActive() : 'no isActive function'
    })
    
    // IMPORTANT: Always remove the old handler to avoid duplicate handlers
    console.log(`[SETUP] Removing old handler for ${docKey} to ensure clean setup`)
    doc.off('update', existingHandler.handler)
    docsWithPersistenceHandlers.delete(doc)
    
    // Continue with new setup below
  }
  
  // Mark as having persistence to avoid duplicate handlers
  docsWithPersistence.add(cacheKey)
  
  // Track if initial content has been loaded - use an object to avoid closure issues
  const loadState = {
    initialLoadComplete: false,
    updateCount: 0
  }
  
  console.log(`[SETUP] Current doc observers:`, Object.keys(doc._observers || {}))
  
  // Try to get enhanced provider for persistence
  try {
    const { EnhancedCollaborationProvider } = require('./enhanced-yjs-provider')
    const enhancedProvider = EnhancedCollaborationProvider.getInstance()
    
    if (enhancedProvider.persistence) {
      console.log(`[SETUP] Setting up persistence for ${docKey} with adapter:`, enhancedProvider.persistence.constructor.name)
      // Create a unique handler function so we can track it
      const updateHandler = async (update: Uint8Array, origin: any) => {
        console.log(`[UPDATE] Update triggered for ${docKey}, initialLoadComplete: ${loadState.initialLoadComplete}, origin: ${origin}`)
        // Skip if initial load not complete or if this is a persistence update
        if (!loadState.initialLoadComplete || origin === 'persistence') {
          console.log(`[UPDATE] Skipping update for ${docKey} - initialLoadComplete: ${loadState.initialLoadComplete}, origin: ${origin}`)
          return
        }
        
        // Persist the update
        try {
          await enhancedProvider.persistence.persist(docKey, update)
          loadState.updateCount++
          console.log(`[UPDATE] Persisted update ${loadState.updateCount} for ${docKey}`)
          
          // Auto-compact after 50 updates to prevent accumulation
          if (loadState.updateCount > 50) {
            console.log(`[UPDATE] Auto-compacting ${docKey} after ${loadState.updateCount} updates`)
            await enhancedProvider.persistence.compact(docKey)
            loadState.updateCount = 0
          }
        } catch (error) {
          console.error(`[UPDATE] Failed to persist ${docKey}:`, error)
        }
      }
      
      // Add update handler
      doc.on('update', updateHandler)
      console.log(`[SETUP] Added update handler to doc for ${docKey}`)
      
      // Store the handler info in the WeakMap
      docsWithPersistenceHandlers.set(doc, {
        handler: updateHandler,
        isActive: () => loadState.initialLoadComplete,
        docKey,
        cacheKey,
        loadState // Store reference to the loadState object
      })
      
      // Store reference to handler on the doc for debugging
      ;(doc as any)._persistenceHandler = updateHandler
      ;(doc as any)._persistenceDocKey = docKey
      ;(doc as any)._persistenceLoadState = loadState
      
      // Load existing updates immediately (but only if not already loading)
      if (docsCurrentlyLoading.has(cacheKey)) {
        console.log(`[SETUP] Already loading ${cacheKey}, skipping duplicate load`)
        return
      }
      
      // Mark as loading
      docsCurrentlyLoading.add(cacheKey)
      
      const { docLoadingStates } = require('./yjs-utils')
      
      const loadPromise = enhancedProvider.persistence.load(docKey).then((data: Uint8Array | null) => {
        console.log(`[LOAD] Loading data for ${docKey}, data size: ${data ? data.length : 0}`)
        if (data && data.length > 0) {
          // Apply the loaded state with 'persistence' origin to skip re-persisting
          Y.applyUpdate(doc, data, 'persistence')
          console.log(`[LOAD] Applied loaded content for ${docKey}, size: ${data.length} bytes`)
          
          // Check for fragment field migration
          const defaultFragment = doc.getXmlFragment('default')
          const prosemirrorFragment = doc.getXmlFragment('prosemirror')
          
          if (defaultFragment.length > 0 && prosemirrorFragment.length === 0) {
            console.log(`[LOAD] Found content in 'default' fragment for ${docKey}`)
            doc.getMap('_meta').set('fragmentField', 'default')
          } else if (prosemirrorFragment.length > 0) {
            console.log(`[LOAD] Found content in 'prosemirror' fragment for ${docKey}`)
            doc.getMap('_meta').set('fragmentField', 'prosemirror')
          }
        } else {
          console.log(`[LOAD] No data to load for ${docKey}`)
        }
        // Set flag after loading to ensure future updates are persisted
        loadState.initialLoadComplete = true
        console.log(`[LOAD] Set initialLoadComplete=true for ${docKey}`)
        // Clear loading state
        docLoadingStates.delete(cacheKey)
        docsCurrentlyLoading.delete(cacheKey)
      }).catch((error: any) => {
        console.error(`[LOAD] Failed to load ${docKey}:`, error)
        loadState.initialLoadComplete = true
        console.log(`[LOAD] Set initialLoadComplete=true for ${docKey} after error`)
        // Clear loading state even on error
        docLoadingStates.delete(cacheKey)
        docsCurrentlyLoading.delete(cacheKey)
      })
      
      // Store the loading promise so components can wait for it
      docLoadingStates.set(cacheKey, loadPromise)
    } else {
      // No persistence available
      console.log(`[SETUP] No persistence available for ${docKey}`)
      loadState.initialLoadComplete = true
    }
  } catch (error) {
    console.warn(`[SETUP] Enhanced provider not available for persistence setup for ${docKey}:`, error)
    loadState.initialLoadComplete = true
  }
}

// Get or create Y.Doc for a specific panel's editor
export function getEditorYDoc(panelId: string, noteId?: string): Y.Doc {
  // Create a composite key that includes both note ID and panel ID
  const cacheKey = noteId ? `${noteId}-${panelId}` : panelId
  const docKey = `${noteId || 'default'}-panel-${panelId}`
  
  console.log(`[getEditorYDoc] Getting doc for panelId: ${panelId}, noteId: ${noteId}, cacheKey: ${cacheKey}, docKey: ${docKey}`)
  
  // Check if we already have a cached doc for this note+panel combination
  if (editorDocs.has(cacheKey)) {
    console.log(`[getEditorYDoc] Found cached doc for ${cacheKey}`)
    // Update last access time
    editorDocsLastAccess.set(cacheKey, Date.now())
    
    // Clear any loading state since we have a cached doc
    try {
      const { docLoadingStates } = require('./yjs-utils')
      docLoadingStates.delete(cacheKey)
    } catch (e) {
      // Ignore if module not available
    }
    
    const cachedDoc = editorDocs.get(cacheKey)!
    console.log(`[getEditorYDoc] Cached doc has ${Object.keys(cachedDoc._observers || {}).length} observers`)
    
    // Only set up persistence handler if not already loading or set up
    if (!docsCurrentlyLoading.has(cacheKey) && !docsWithPersistenceHandlers.has(cachedDoc)) {
      console.log(`[getEditorYDoc] Setting up persistence for cached doc ${cacheKey}`)
      setupPersistenceHandler(cachedDoc, docKey, cacheKey)
    } else {
      console.log(`[getEditorYDoc] Skipping persistence setup for cached ${cacheKey} - already set up or loading`)
    }
    
    return cachedDoc
  }

  // Try to get from enhanced provider first for PostgreSQL persistence
  try {
    const { EnhancedCollaborationProvider } = require('./enhanced-yjs-provider')
    const enhancedProvider = EnhancedCollaborationProvider.getInstance()
    
    // Get the subdoc synchronously - create if it doesn't exist
    if (enhancedProvider.mainDoc) {
      const editors = enhancedProvider.mainDoc.getMap('editors')
      if (!editors.has(cacheKey)) {
        console.log(`[getEditorYDoc] Creating new subdoc for ${cacheKey}`)
        // Create subdoc with composite guid including note ID
        const subdocGuid = noteId ? `editor-${noteId}-${panelId}` : `editor-${panelId}`
        const subdoc = new Y.Doc({ guid: subdocGuid })
        
        // Initialize prosemirror fragment for TipTap
        subdoc.getXmlFragment('prosemirror')
        
        // Store in cache first to prevent duplicates with composite key
        editorDocs.set(cacheKey, subdoc)
        editorDocsLastAccess.set(cacheKey, Date.now())
        
        // Clean up old entries if cache is getting too large
        cleanupEditorDocsCache()
        
        // Then store in main doc with composite key
        enhancedProvider.mainDoc.getMap('editors').set(cacheKey, subdoc)
        
        console.log(`[getEditorYDoc] Created new subdoc, setting up persistence handler`)
        // Set up persistence handler
        setupPersistenceHandler(subdoc, docKey, cacheKey)
        
        return subdoc
      }
      
      // Doc exists in main doc, get it and cache it with composite key
      const existingDoc = editors.get(cacheKey) as Y.Doc
      editorDocs.set(cacheKey, existingDoc)
      editorDocsLastAccess.set(cacheKey, Date.now())
      cleanupEditorDocsCache()
      
      // Only set up persistence handler if not already loading or set up
      if (!docsCurrentlyLoading.has(cacheKey) && !docsWithPersistenceHandlers.has(existingDoc)) {
        console.log(`[getEditorYDoc] Setting up persistence for existing doc ${cacheKey}`)
        setupPersistenceHandler(existingDoc, docKey, cacheKey)
      } else {
        console.log(`[getEditorYDoc] Skipping persistence setup for ${cacheKey} - already set up or loading`)
      }
      
      return existingDoc
    }
  } catch (error) {
    console.warn('Enhanced provider not available, falling back to standalone doc')
  }
  
  // Fallback to standalone doc with composite guid
  const docGuid = noteId ? `editor-${noteId}-${panelId}` : `editor-${panelId}`
  const doc = new Y.Doc({ guid: docGuid })
  
  // Initialize prosemirror fragment for TipTap
  doc.getXmlFragment('prosemirror')
  
  editorDocs.set(cacheKey, doc)
  editorDocsLastAccess.set(cacheKey, Date.now())
  cleanupEditorDocsCache()
  return doc
}

// Smart cleanup that keeps recently used docs
function cleanupEditorDocsCache(): void {
  // Only cleanup if we exceed the max cache size
  if (editorDocs.size <= MAX_EDITOR_DOCS) {
    return
  }
  
  const now = Date.now()
  const entries = Array.from(editorDocsLastAccess.entries())
  
  // Sort by last access time (oldest first)
  entries.sort((a, b) => a[1] - b[1])
  
  // Remove oldest entries until we're under the limit
  const toRemove = editorDocs.size - MAX_EDITOR_DOCS + 5 // Remove 5 extra for headroom
  
  for (let i = 0; i < toRemove && i < entries.length; i++) {
    const [key, lastAccess] = entries[i]
    
    // Only remove if it hasn't been accessed recently
    if (now - lastAccess > EDITOR_DOC_TTL) {
      const doc = editorDocs.get(key)
      if (doc && (!doc._observers || Object.keys(doc._observers).length === 0)) {
        // Doc is not actively being used, safe to remove
        editorDocs.delete(key)
        editorDocsLastAccess.delete(key)
        docsWithPersistence.delete(key)
        // Also remove from WeakMap (will happen automatically when doc is GC'd)
        // but we can be explicit about it
        docsWithPersistenceHandlers.delete(doc)
      }
    }
  }
}

// YJS Native Types Implementation for Collaborative Document Structure
class CollaborativeDocumentStructure {
  private doc: Y.Doc
  
  constructor(doc: Y.Doc) {
    this.doc = doc
  }
  
  // Store panel data in Y.Map
  getPanelData(panelId: string): Y.Map<any> {
    const panels = this.doc.getMap('panels')
    if (!panels.has(panelId)) {
      panels.set(panelId, new Y.Map())
    }
    return panels.get(panelId) as Y.Map<any>
  }
  
  // Store branches as Y.Array for each panel
  getBranchesArray(panelId: string): Y.Array<string> {
    const panelData = this.getPanelData(panelId)
    if (!panelData.has('branches')) {
      panelData.set('branches', new Y.Array())
    }
    return panelData.get('branches') as Y.Array<string>
  }
  
  // Add branch - automatically handles conflicts
  addBranch(parentId: string, branchId: string): void {
    const branches = this.getBranchesArray(parentId)
    
    // Check if already exists to avoid duplicates
    const existingBranches = branches.toArray()
    if (!existingBranches.includes(branchId)) {
      branches.push([branchId])
    }
  }
  
  // Remove branch
  removeBranch(parentId: string, branchId: string): void {
    const branches = this.getBranchesArray(parentId)
    const existingBranches = branches.toArray()
    const index = existingBranches.indexOf(branchId)
    if (index !== -1) {
      branches.delete(index, 1)
    }
  }
  
  // Get all branches for a panel as regular array
  getBranches(panelId: string): string[] {
    const branches = this.getBranchesArray(panelId)
    return branches.toArray()
  }
  
  // Set panel data (for initial setup)
  setPanelData(panelId: string, data: any): void {
    const panelData = this.getPanelData(panelId)
    
    // Set all properties except branches (use addBranch for those)
    Object.entries(data).forEach(([key, value]) => {
      if (key === 'branches') {
        // Handle branches specially using Y.Array
        if (Array.isArray(value)) {
          value.forEach(branchId => this.addBranch(panelId, branchId))
        }
      } else {
        panelData.set(key, value)
      }
    })
  }
  
  // Get panel data as regular object
  getPanelDataAsObject(panelId: string): any {
    const panelData = this.getPanelData(panelId)
    const result: any = {}
    
    panelData.forEach((value, key) => {
      if (key === 'branches' && value instanceof Y.Array) {
        result[key] = value.toArray()
      } else {
        result[key] = value
      }
    })
    
    return result
  }
  
  // Update panel property
  updatePanelProperty(panelId: string, key: string, value: any): void {
    const panelData = this.getPanelData(panelId)
    panelData.set(key, value)
  }
}

export class CollaborationProvider {
  private static instance: CollaborationProvider
  private noteDocs: Map<string, Y.Doc> = new Map()
  private documentStructures: Map<string, CollaborativeDocumentStructure> = new Map()
  private persistenceProviders: Map<string, PersistenceProvider> = new Map()
  private currentNoteId: string | null = null
  private collaborationEnabled: boolean = false

  private constructor() {}

  public static getInstance(): CollaborationProvider {
    if (!CollaborationProvider.instance) {
      CollaborationProvider.instance = new CollaborationProvider()
    }
    return CollaborationProvider.instance
  }

  private getOrCreateNoteDoc(noteId: string): Y.Doc {
    if (!this.noteDocs.has(noteId)) {
      const doc = new Y.Doc()
      this.noteDocs.set(noteId, doc)
      
      // 1. Add local persistence (IndexedDB-like storage)
      const persistence = new MockIndexeddbPersistence(noteId, doc)
      this.persistenceProviders.set(noteId, persistence)
      
      // 2. Add network sync when ready (commented out for now)
      // if (this.collaborationEnabled) {
      //   const wsProvider = new WebsocketProvider('wss://your-server.com', noteId, doc)
      //   this.networkProviders.set(noteId, wsProvider)
      // }
      
      // 3. Create collaborative document structure for this note
      this.documentStructures.set(noteId, new CollaborativeDocumentStructure(doc))
      
      // 4. Handle persistence events
      persistence.on('synced', () => {
        console.log(`Local YJS state restored from persistence for note: ${noteId}`)
        
        // After persistence is restored, ensure the document structure is ready
        const structure = this.documentStructures.get(noteId)
        if (structure) {
          // The Y.js document now has the restored state with Y.Arrays and Y.Maps intact
          console.log(`Document structure ready for note: ${noteId}`)
        }
      })
    }
    return this.noteDocs.get(noteId)!
  }

  public setCurrentNote(noteId: string): void {
    this.currentNoteId = noteId
    // Ensure document and structure exist
    this.getOrCreateNoteDoc(noteId)
  }

  // Get the collaborative document structure for current note
  public getDocumentStructure(): CollaborativeDocumentStructure {
    if (!this.currentNoteId) {
      throw new Error('No current note set')
    }
    
    // Ensure document exists
    this.getOrCreateNoteDoc(this.currentNoteId)
    return this.documentStructures.get(this.currentNoteId)!
  }

  // Legacy method - now uses YJS native types under the hood
  public getBranchesMap(): Y.Map<any> {
    if (!this.currentNoteId) {
      console.warn('getBranchesMap called without active note')
      const tempDoc = new Y.Doc()
      return tempDoc.getMap('branches')
    }
    const doc = this.getOrCreateNoteDoc(this.currentNoteId)
    return doc.getMap('branches')
  }

  // New method: Add branch using YJS native types
  public addBranch(parentId: string, branchId: string, branchData: any): void {
    const structure = this.getDocumentStructure()
    
    // Store the branch data in the legacy branches map (for backward compatibility)
    const branchesMap = this.getBranchesMap()
    branchesMap.set(branchId, branchData)
    
    // Add to parent's branches array using YJS native types
    structure.addBranch(parentId, branchId)
    
    // If parent doesn't exist in new structure, migrate it
    const parentData = branchesMap.get(parentId)
    if (parentData && !structure.getPanelData(parentId).has('title')) {
      structure.setPanelData(parentId, parentData)
    }
  }

  // New method: Get branches using YJS native types
  public getBranches(panelId: string): string[] {
    try {
      const structure = this.getDocumentStructure()
      return structure.getBranches(panelId)
    } catch {
      // Fallback to legacy method
      const branchesMap = this.getBranchesMap()
      const panelData = branchesMap.get(panelId)
      return panelData?.branches || []
    }
  }

  // New method: Remove branch
  public removeBranch(parentId: string, branchId: string): void {
    const structure = this.getDocumentStructure()
    structure.removeBranch(parentId, branchId)
    
    // Also remove from legacy branches map
    const branchesMap = this.getBranchesMap()
    branchesMap.delete(branchId)
  }

  public getProvider(): any {
    // Return a mock provider for now - this would normally be a WebSocket or WebRTC provider
    return {
      awareness: {
        getLocalState: () => ({}),
        setLocalState: (state: any) => {},
        setLocalStateField: (field: string, value: any) => {
          // Mock implementation - in a real provider this would update a specific field
        },
        on: (event: string, handler: Function) => {},
        off: (event: string, handler: Function) => {},
        states: new Map()
      },
      on: (event: string, handler: Function) => {},
      off: (event: string, handler: Function) => {},
      disconnect: () => {},
      connect: () => {},
      destroy: () => {}
    }
  }

  public initializeDefaultData(noteId: string, data: Record<string, any>): void {
    this.currentNoteId = noteId
    const doc = this.getOrCreateNoteDoc(noteId)
    
    // Wait for persistence to sync before initializing
    const persistence = this.persistenceProviders.get(noteId)
    if (persistence && !persistence.synced) {
      // Wait for persistence to load, then initialize if needed
      persistence.on('synced', () => {
        this.performInitialization(noteId, data, doc)
      })
    } else {
      // Persistence already synced or doesn't exist, initialize immediately
      this.performInitialization(noteId, data, doc)
    }
  }

  private performInitialization(noteId: string, data: Record<string, any>, doc: Y.Doc): void {
    const branchesMap = doc.getMap('branches')
    const structure = this.documentStructures.get(noteId)!
    
    // Check if we have any existing data (from persistence)
    const hasExistingData = branchesMap.size > 0 || 
                          doc.getMap('panels').size > 0
    
    if (!hasExistingData) {
      // No existing data, initialize with defaults
      console.log(`Initializing default data for note: ${noteId}`)
      Object.entries(data).forEach(([key, value]) => {
        // Store in legacy branches map
        branchesMap.set(key, value)
        
        // Also store in new YJS native structure
        structure.setPanelData(key, value)
      })
    } else {
      // Existing data found from persistence, don't overwrite
      console.log(`Existing YJS data found for note: ${noteId}, skipping initialization`)
      
      // But ensure any new panels from data that don't exist are added
      Object.entries(data).forEach(([key, value]) => {
        if (!branchesMap.has(key)) {
          console.log(`Adding missing panel: ${key}`)
          branchesMap.set(key, value)
          structure.setPanelData(key, value)
        }
      })
    }
  }

  public destroyNote(noteId: string): void {
    // Clean up persistence provider first (this automatically saves current state)
    const persistence = this.persistenceProviders.get(noteId)
    if (persistence) {
      persistence.destroy()
      this.persistenceProviders.delete(noteId)
    }
    
    // Clean up the specific note's document
    const doc = this.noteDocs.get(noteId)
    if (doc) {
      doc.destroy()
      this.noteDocs.delete(noteId)
    }
    
    // Clean up document structure
    this.documentStructures.delete(noteId)
    
    // DO NOT destroy editor docs when switching notes
    // The composite key system (noteId-panelId) already isolates docs between notes
    // and the smart cache management handles memory efficiently
    // This allows content to load immediately when switching back to a note
    
    // Optional: Mark editor docs from this note as older for cleanup priority
    const now = Date.now()
    editorDocs.forEach((doc, key) => {
      if (key.startsWith(`${noteId}-`)) {
        // Age the entry by 2 minutes to prioritize it for cleanup if needed
        editorDocsLastAccess.set(key, now - (2 * 60 * 1000))
      }
    })
  }

  public destroy(): void {
    // Clean up all persistence providers first
    this.persistenceProviders.forEach(provider => provider.destroy())
    this.persistenceProviders.clear()
    
    // Clean up all documents
    this.noteDocs.forEach(doc => doc.destroy())
    this.noteDocs.clear()
    
    // Clean up all document structures
    this.documentStructures.clear()
    
    editorDocs.forEach(doc => doc.destroy())
    editorDocs.clear()
    editorDocsLastAccess.clear()
    docsWithPersistence.clear()
    
    this.currentNoteId = null
  }
} 