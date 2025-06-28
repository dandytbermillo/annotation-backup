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

// Store for editor Y.Docs indexed by panel ID
const editorDocs = new Map<string, Y.Doc>()

// Get or create Y.Doc for a specific panel's editor
export function getEditorYDoc(panelId: string): Y.Doc {
  if (!editorDocs.has(panelId)) {
    const doc = new Y.Doc()
    editorDocs.set(panelId, doc)
  }
  return editorDocs.get(panelId)!
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
    
    // Clean up editor docs for this note
    const keysToDelete: string[] = []
    editorDocs.forEach((doc, key) => {
      if (key.startsWith(`${noteId}-`) || key === noteId) {
        doc.destroy()
        keysToDelete.push(key)
      }
    })
    keysToDelete.forEach(key => editorDocs.delete(key))
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
    
    this.currentNoteId = null
  }
} 