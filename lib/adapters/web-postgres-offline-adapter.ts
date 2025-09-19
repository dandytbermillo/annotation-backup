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

const AUTOSAVE_DEBUG = ['true', '1', 'on', 'yes'].includes((process.env.NEXT_PUBLIC_DEBUG_AUTOSAVE ?? '').toLowerCase())

/**
 * WebPostgresOfflineAdapter - Communicates with PostgreSQL via API routes only
 * No server-side imports allowed
 */
export class WebPostgresOfflineAdapter implements PlainCrudAdapter {
  private apiBase = '/api/postgres-offline'
  private pendingSaves = new Map<string, number>()
  
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
  async saveDocument(noteId: string, panelId: string, content: ProseMirrorJSON | HtmlString, version: number, baseVersion: number): Promise<void> {
    const key = `${noteId}:${panelId}`
    let startTime = 0
    let pendingCount = 0
    let success = false

    if (AUTOSAVE_DEBUG) {
      startTime = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
      pendingCount = (this.pendingSaves.get(key) || 0) + 1
      this.pendingSaves.set(key, pendingCount)
      console.debug('[PlainAutosave][Adapter]', 'save:start', {
        key,
        version,
        baseVersion,
        pending: pendingCount
      })
    }

    try {
      const response = await fetch(`${this.apiBase}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId,
          panelId,
          content,
          version,
          baseVersion
        })
      })
      
      if (!response.ok) {
        let message = `Failed to save document: ${response.status} ${response.statusText}`
        let payload: any = null
        try {
          payload = await response.json()
          if (payload && typeof payload.error === 'string') {
            message = payload.error
          }
        } catch (error) {
          // ignore parse errors; fall back to default message
        }

        const err = new Error(message)
        ;(err as any).status = response.status
        if (payload) {
          ;(err as any).payload = payload
        }
        if (AUTOSAVE_DEBUG) {
          console.debug('[PlainAutosave][Adapter]', 'save:error-response', {
            key,
            version,
            baseVersion,
            status: response.status,
            message
          })
        }
        throw err
      }

      success = true
    } finally {
      if (AUTOSAVE_DEBUG) {
        const endTime = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
        const current = (this.pendingSaves.get(key) || 1) - 1
        if (current > 0) {
          this.pendingSaves.set(key, current)
        } else {
          this.pendingSaves.delete(key)
        }
        console.debug('[PlainAutosave][Adapter]', success ? 'save:success' : 'save:failure', {
          key,
          version,
          baseVersion,
          durationMs: Math.round(endTime - startTime),
          pendingAfter: Math.max(current, 0)
        })
      } else if (this.pendingSaves.has(key)) {
        const current = (this.pendingSaves.get(key) || 1) - 1
        if (current > 0) {
          this.pendingSaves.set(key, current)
        } else {
          this.pendingSaves.delete(key)
        }
      }
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
