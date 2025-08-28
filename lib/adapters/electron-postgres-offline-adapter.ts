/**
 * ElectronPostgresOfflineAdapter - Electron-specific implementation of PostgresOfflineAdapter
 * 
 * Uses IPC to communicate with the main process for database operations.
 * The renderer process must not import pg or create direct database connections.
 * 
 * @module lib/adapters/electron-postgres-offline-adapter
 */

import { PostgresOfflineAdapter } from './postgres-offline-adapter'
import type { Pool } from 'pg'

// IPC communication interface
interface IPCResult<T = any> {
  success: boolean
  data?: T
  error?: string
}

/**
 * ElectronPostgresOfflineAdapter - Communicates with PostgreSQL via IPC
 */
export class ElectronPostgresOfflineAdapter extends PostgresOfflineAdapter {
  protected getPool(): Pool {
    // Electron adapter doesn't use direct pool connection
    // All operations go through IPC to main process
    throw new Error('ElectronPostgresOfflineAdapter should not access pool directly from renderer')
  }
  
  /**
   * Helper to invoke IPC operations
   */
  private async invokeIPC<T>(channel: string, ...args: any[]): Promise<T> {
    if (typeof window === 'undefined' || !window.electronAPI) {
      throw new Error('Electron API not available')
    }
    
    const result: IPCResult<T> = await window.electronAPI.invoke(channel, ...args)
    
    if (!result.success) {
      throw new Error(result.error || 'IPC operation failed')
    }
    
    return result.data!
  }
  
  /**
   * Override all methods to use IPC instead of direct DB access
   */
  
  async createNote(input: Partial<any>): Promise<any> {
    return this.invokeIPC('postgres-offline:createNote', input)
  }
  
  async updateNote(id: string, patch: any): Promise<any> {
    return this.invokeIPC('postgres-offline:updateNote', id, patch)
  }
  
  async getNote(id: string): Promise<any> {
    return this.invokeIPC('postgres-offline:getNote', id)
  }
  
  async createBranch(input: Partial<any>): Promise<any> {
    return this.invokeIPC('postgres-offline:createBranch', input)
  }
  
  async updateBranch(id: string, patch: any): Promise<any> {
    return this.invokeIPC('postgres-offline:updateBranch', id, patch)
  }
  
  async listBranches(noteId: string): Promise<any[]> {
    return this.invokeIPC('postgres-offline:listBranches', noteId)
  }
  
  async saveDocument(noteId: string, panelId: string, content: any, version: number): Promise<void> {
    await this.invokeIPC('postgres-offline:saveDocument', noteId, panelId, content, version)
  }
  
  async loadDocument(noteId: string, panelId: string): Promise<any> {
    return this.invokeIPC('postgres-offline:loadDocument', noteId, panelId)
  }
  
  async enqueueOffline(op: any): Promise<void> {
    await this.invokeIPC('postgres-offline:enqueueOffline', op)
  }
  
  async flushQueue(): Promise<{ processed: number; failed: number }> {
    return this.invokeIPC('postgres-offline:flushQueue')
  }
}

// Type declaration moved to types/global.d.ts to avoid duplication