import type { PlainCrudAdapter, Note, Branch, QueueOp, ProseMirrorJSON, HtmlString } from '../providers/plain-offline-provider'

/**
 * In-memory test adapter for unit testing
 */
export class TestAdapter implements PlainCrudAdapter {
  private notes = new Map<string, Note>()
  private branches = new Map<string, Branch>()
  private documents = new Map<string, { content: ProseMirrorJSON | HtmlString; version: number }>()
  private queue: QueueOp[] = []
  
  async createNote(input: Partial<Note>): Promise<Note> {
    const note: Note = {
      id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: input.title || 'Untitled',
      metadata: input.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date()
    }
    this.notes.set(note.id, note)
    return note
  }
  
  async updateNote(id: string, patch: Partial<Note> & { version: number }): Promise<Note> {
    const note = this.notes.get(id)
    if (!note) throw new Error(`Note ${id} not found`)
    
    const updated = {
      ...note,
      ...patch,
      id: note.id, // Preserve ID
      createdAt: note.createdAt, // Preserve creation date
      updatedAt: new Date()
    }
    this.notes.set(id, updated as Note)
    return updated as Note
  }
  
  async getNote(id: string): Promise<Note | null> {
    return this.notes.get(id) || null
  }
  
  async listNotes(): Promise<Note[]> {
    return Array.from(this.notes.values())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }
  
  async createBranch(input: Partial<Branch>): Promise<Branch> {
    const branch: Branch = {
      id: `branch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      noteId: input.noteId || '',
      parentId: input.parentId || '',
      type: input.type || 'note',
      originalText: input.originalText || '',
      metadata: input.metadata || {},
      anchors: input.anchors,
      createdAt: new Date(),
      updatedAt: new Date()
    }
    this.branches.set(branch.id, branch)
    return branch
  }
  
  async updateBranch(id: string, patch: Partial<Branch> & { version: number }): Promise<Branch> {
    const branch = this.branches.get(id)
    if (!branch) throw new Error(`Branch ${id} not found`)
    
    const updated = {
      ...branch,
      ...patch,
      id: branch.id,
      createdAt: branch.createdAt,
      updatedAt: new Date()
    }
    this.branches.set(id, updated as Branch)
    return updated as Branch
  }
  
  async listBranches(noteId: string): Promise<Branch[]> {
    return Array.from(this.branches.values())
      .filter(b => b.noteId === noteId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }
  
  async saveDocument(noteId: string, panelId: string, content: ProseMirrorJSON | HtmlString, version: number): Promise<void> {
    const key = `${noteId}-${panelId}`
    this.documents.set(key, { content, version })
  }
  
  async loadDocument(noteId: string, panelId: string): Promise<{ content: ProseMirrorJSON | HtmlString; version: number } | null> {
    const key = `${noteId}-${panelId}`
    return this.documents.get(key) || null
  }
  
  async enqueueOffline(op: QueueOp): Promise<void> {
    this.queue.push(op)
  }
  
  async flushQueue(): Promise<{ processed: number; failed: number }> {
    const processed = this.queue.length
    this.queue = []
    return { processed, failed: 0 }
  }
  
  // Test helpers
  clear(): void {
    this.notes.clear()
    this.branches.clear()
    this.documents.clear()
    this.queue = []
  }
  
  getQueueSize(): number {
    return this.queue.length
  }
}