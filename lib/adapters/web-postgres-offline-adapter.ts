/**
 * WebPostgresOfflineAdapter - Web-specific implementation for browser environments
 * 
 * Uses API routes to communicate with PostgreSQL.
 * Implements the PlainCrudAdapter interface for Option A (offline mode).
 * 
 * @module lib/adapters/web-postgres-offline-adapter
 */

import type { 
  PlainCrudAdapter, 
  Note, 
  Branch, 
  QueueOp, 
  ProseMirrorJSON, 
  HtmlString 
} from '../providers/plain-offline-provider'

/**
 * WebPostgresOfflineAdapter - Communicates with PostgreSQL via API routes only
 * No server-side imports allowed
 */
export class WebPostgresOfflineAdapter implements PlainCrudAdapter {
  private apiBase = '/api/postgres-offline'
  
  /**
   * Note operations
   */
  async createNote(input: Partial<Note>): Promise<Note> {
    const response = await fetch(`${this.apiBase}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    })
    
    if (!response.ok) {
      throw new Error(`Failed to create note: ${response.statusText}`)
    }
    
    return response.json()
  }
  
  async updateNote(id: string, patch: Partial<Note> & { version: number }): Promise<Note> {
    const response = await fetch(`${this.apiBase}/notes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    })
    
    if (!response.ok) {
      throw new Error(`Failed to update note: ${response.statusText}`)
    }
    
    return response.json()
  }
  
  async getNote(id: string): Promise<Note | null> {
    const response = await fetch(`${this.apiBase}/notes/${id}`)
    
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get note: ${response.statusText}`)
    }
    
    return response.json()
  }
  
  /**
   * Branch operations
   */
  async createBranch(input: Partial<Branch>): Promise<Branch> {
    const response = await fetch(`${this.apiBase}/branches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    })
    
    if (!response.ok) {
      throw new Error(`Failed to create branch: ${response.statusText}`)
    }
    
    return response.json()
  }
  
  async updateBranch(id: string, patch: Partial<Branch> & { version: number }): Promise<Branch> {
    const response = await fetch(`${this.apiBase}/branches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    })
    
    if (!response.ok) {
      throw new Error(`Failed to update branch: ${response.statusText}`)
    }
    
    return response.json()
  }
  
  async listBranches(noteId: string): Promise<Branch[]> {
    const response = await fetch(`${this.apiBase}/branches?noteId=${noteId}`)
    
    if (!response.ok) {
      throw new Error(`Failed to list branches: ${response.statusText}`)
    }
    
    return response.json()
  }
  
  /**
   * Document operations
   */
  async saveDocument(noteId: string, panelId: string, content: ProseMirrorJSON | HtmlString, version: number): Promise<void> {
    const response = await fetch(`${this.apiBase}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noteId,
        panelId,
        content,
        version
      })
    })
    
    if (!response.ok) {
      throw new Error(`Failed to save document: ${response.statusText}`)
    }
  }
  
  async loadDocument(noteId: string, panelId: string): Promise<{ content: ProseMirrorJSON | HtmlString; version: number } | null> {
    const response = await fetch(`${this.apiBase}/documents/${noteId}/${panelId}`)
    
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to load document: ${response.statusText}`)
    }
    
    return response.json()
  }
  
  /**
   * Offline queue operations
   */
  async enqueueOffline(op: QueueOp): Promise<void> {
    const response = await fetch(`${this.apiBase}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(op)
    })
    
    if (!response.ok) {
      throw new Error(`Failed to enqueue operation: ${response.statusText}`)
    }
  }
  
  async flushQueue(): Promise<{ processed: number; failed: number }> {
    const response = await fetch(`${this.apiBase}/queue/flush`, {
      method: 'POST'
    })
    
    if (!response.ok) {
      throw new Error(`Failed to flush queue: ${response.statusText}`)
    }
    
    return response.json()
  }
}