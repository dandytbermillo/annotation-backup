// Core offline-first store with PostgreSQL persistence
import { v4 as uuidv4 } from 'uuid'
import { 
  OfflineStore as IOfflineStore, 
  Branch, 
  Note, 
  Panel, 
  OfflineOperation, 
  Change, 
  ChangeLog,
  ChangeType 
} from './types'
import { PostgresOfflineAdapter } from '../adapters/postgres-offline-adapter'
import { LocalSyncQueue } from './local-sync-queue'

export class OfflineStore implements IOfflineStore {
  // Collections
  branches = new Map<string, Branch>()
  notes = new Map<string, Note>()
  panels = new Map<string, Panel>()
  
  // Change tracking
  changes: ChangeLog[] = []
  private changeListeners: Set<(changes: Change[]) => void> = new Set()
  
  // Persistence
  private postgresAdapter: PostgresOfflineAdapter
  private syncQueue: LocalSyncQueue
  
  // State
  isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
  offlineQueue: OfflineOperation[] = []
  
  constructor() {
    this.postgresAdapter = new PostgresOfflineAdapter()
    this.syncQueue = new LocalSyncQueue(this.postgresAdapter)
    
    // Set up online/offline listeners
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnline())
      window.addEventListener('offline', () => this.handleOffline())
    }
  }
  
  // Online/offline handling
  setOnlineStatus(online: boolean): void {
    this.isOnline = online
    if (online) {
      this.handleOnline()
    } else {
      this.handleOffline()
    }
  }
  
  private handleOnline(): void {
    console.log('Going online, flushing queue...')
    this.isOnline = true
    this.flushQueue().catch(err => {
      console.error('Failed to flush queue:', err)
    })
  }
  
  private handleOffline(): void {
    console.log('Going offline, operations will be queued')
    this.isOnline = false
  }
  
  // Change tracking
  onChanged(callback: (changes: Change[]) => void): () => void {
    this.changeListeners.add(callback)
    return () => {
      this.changeListeners.delete(callback)
    }
  }
  
  private emitChange(type: ChangeType, table: 'notes' | 'branches' | 'panels', entity: any): void {
    const change: Change = {
      type,
      table,
      entity: type !== 'delete' ? entity : undefined,
      entityId: typeof entity === 'string' ? entity : entity.id,
      timestamp: new Date()
    }
    
    // Emit to listeners
    this.changeListeners.forEach(listener => listener([change]))
    
    // Add to change log
    const changeLog: ChangeLog = {
      id: uuidv4(),
      changes: [change],
      timestamp: new Date()
    }
    this.changes.push(changeLog)
    
    // Trigger async persistence
    this.persistAsync()
  }
  
  // Persistence methods
  async persist(): Promise<void> {
    const operations: OfflineOperation[] = []
    
    // Batch all entities for persistence
    this.branches.forEach(branch => {
      operations.push({
        id: uuidv4(),
        type: 'update',
        table: 'branches',
        entityId: branch.id,
        data: branch,
        timestamp: new Date(),
        retryCount: 0,
        status: 'pending'
      })
    })
    
    this.notes.forEach(note => {
      operations.push({
        id: uuidv4(),
        type: 'update',
        table: 'notes',
        entityId: note.id,
        data: note,
        timestamp: new Date(),
        retryCount: 0,
        status: 'pending'
      })
    })
    
    this.panels.forEach(panel => {
      operations.push({
        id: uuidv4(),
        type: 'update',
        table: 'panels',
        entityId: panel.id,
        data: panel,
        timestamp: new Date(),
        retryCount: 0,
        status: 'pending'
      })
    })
    
    if (this.isOnline) {
      // Direct PostgreSQL save
      try {
        await this.postgresAdapter.batchPersist(operations)
      } catch (error) {
        console.error('Persist failed, queuing operations:', error)
        await this.syncQueue.enqueue(operations)
      }
    } else {
      // Queue for later
      await this.syncQueue.enqueue(operations)
    }
  }
  
  private persistAsync(): void {
    // Don't block UI - persist in background
    setTimeout(() => {
      this.persist().catch(err => {
        console.error('Background persist failed:', err)
      })
    }, 100)
  }
  
  async restore(): Promise<void> {
    // Skip restore on server side
    if (typeof window === 'undefined') {
      console.log('Skipping restore on server side')
      return
    }
    
    try {
      // Load from PostgreSQL
      const [notesData, branchesData, panelsData] = await Promise.all([
        this.postgresAdapter.loadNotes(),
        this.postgresAdapter.loadBranches(),
        this.postgresAdapter.loadPanels()
      ])
      
      // Populate maps
      notesData.forEach(note => {
        this.notes.set(note.id, note)
      })
      
      branchesData.forEach(branch => {
        this.branches.set(branch.id, branch)
      })
      
      panelsData.forEach(panel => {
        this.panels.set(panel.id, panel)
      })
      
      // Load offline queue
      this.offlineQueue = await this.syncQueue.getQueuedOperations()
      
      console.log('Restored from PostgreSQL:', {
        notes: this.notes.size,
        branches: this.branches.size,
        panels: this.panels.size,
        queuedOperations: this.offlineQueue.length
      })
    } catch (error) {
      console.error('Failed to restore from PostgreSQL:', error)
    }
  }
  
  async flushQueue(): Promise<void> {
    if (!this.isOnline) {
      console.warn('Cannot flush queue while offline')
      return
    }
    
    try {
      await this.syncQueue.flush()
      this.offlineQueue = []
    } catch (error) {
      console.error('Failed to flush queue:', error)
      throw error
    }
  }
  
  // Branch operations
  createBranch(branch: Partial<Branch>): Branch {
    const newBranch: Branch = {
      id: uuidv4(),
      noteId: branch.noteId || '',
      type: branch.type || 'note',
      originalText: branch.originalText || '',
      modifiedText: branch.modifiedText || branch.originalText || '',
      anchors: branch.anchors || { start: 0, end: 0 },
      metadata: branch.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 0,
      localVersion: 1,
      ...branch
    }
    
    this.branches.set(newBranch.id, newBranch)
    this.emitChange('create', 'branches', newBranch)
    
    return newBranch
  }
  
  updateBranch(id: string, updates: Partial<Branch>): Branch | null {
    const branch = this.branches.get(id)
    if (!branch) return null
    
    const updatedBranch: Branch = {
      ...branch,
      ...updates,
      updatedAt: new Date(),
      localVersion: branch.localVersion + 1
    }
    
    this.branches.set(id, updatedBranch)
    this.emitChange('update', 'branches', updatedBranch)
    
    return updatedBranch
  }
  
  deleteBranch(id: string): boolean {
    const exists = this.branches.has(id)
    if (!exists) return false
    
    this.branches.delete(id)
    this.emitChange('delete', 'branches', id)
    
    return true
  }
  
  // Note operations
  createNote(note: Partial<Note>): Note {
    const newNote: Note = {
      id: uuidv4(),
      title: note.title || 'Untitled',
      content: note.content || '',
      metadata: note.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 0,
      localVersion: 1,
      ...note
    }
    
    this.notes.set(newNote.id, newNote)
    this.emitChange('create', 'notes', newNote)
    
    return newNote
  }
  
  updateNote(id: string, updates: Partial<Note>): Note | null {
    const note = this.notes.get(id)
    if (!note) return null
    
    const updatedNote: Note = {
      ...note,
      ...updates,
      updatedAt: new Date(),
      localVersion: note.localVersion + 1
    }
    
    this.notes.set(id, updatedNote)
    this.emitChange('update', 'notes', updatedNote)
    
    return updatedNote
  }
  
  deleteNote(id: string): boolean {
    const exists = this.notes.has(id)
    if (!exists) return false
    
    this.notes.delete(id)
    this.emitChange('delete', 'notes', id)
    
    return true
  }
  
  // Panel operations
  createPanel(panel: Partial<Panel>): Panel {
    const newPanel: Panel = {
      id: uuidv4(),
      noteId: panel.noteId || '',
      position: panel.position || { x: 0, y: 0 },
      dimensions: panel.dimensions || { width: 400, height: 300 },
      state: panel.state || 'expanded',
      lastAccessed: new Date(),
      ...panel
    }
    
    this.panels.set(newPanel.id, newPanel)
    this.emitChange('create', 'panels', newPanel)
    
    return newPanel
  }
  
  updatePanel(id: string, updates: Partial<Panel>): Panel | null {
    const panel = this.panels.get(id)
    if (!panel) return null
    
    const updatedPanel: Panel = {
      ...panel,
      ...updates,
      lastAccessed: new Date()
    }
    
    this.panels.set(id, updatedPanel)
    this.emitChange('update', 'panels', updatedPanel)
    
    return updatedPanel
  }
  
  deletePanel(id: string): boolean {
    const exists = this.panels.has(id)
    if (!exists) return false
    
    this.panels.delete(id)
    this.emitChange('delete', 'panels', id)
    
    return true
  }
}

// Export singleton instance
export const offlineStore = new OfflineStore()