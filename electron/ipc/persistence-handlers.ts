import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { ElectronPostgresAdapter } from '../../lib/adapters/electron-postgres-adapter'

// Security: Validate document names
function isValidDocName(docName: string): boolean {
  // Only allow alphanumeric, dash, colon, and UUID format
  const pattern = /^[a-zA-Z0-9\-:]+$/
  return pattern.test(docName) && docName.length <= 100
}

// Security: Validate array data
function isValidArray(data: unknown): data is number[] {
  return Array.isArray(data) && 
         data.every(item => typeof item === 'number' && item >= 0 && item <= 255)
}

export function registerPersistenceHandlers(adapter: ElectronPostgresAdapter): void {
  // Persist operation
  ipcMain.handle('persistence:persist', async (
    event: IpcMainInvokeEvent, 
    docName: string, 
    updateArray: number[]
  ): Promise<void> => {
    // Security: Validate inputs
    if (!isValidDocName(docName)) {
      throw new Error('Invalid doc name')
    }
    
    if (!isValidArray(updateArray)) {
      throw new Error('Invalid update data')
    }
    
    // Convert from IPC-safe array to Uint8Array
    const update = new Uint8Array(updateArray)
    
    try {
      await adapter.persist(docName, update)
    } catch (error) {
      console.error('Persist error:', error)
      throw new Error(`Failed to persist: ${error.message}`)
    }
  })

  // Load operation
  ipcMain.handle('persistence:load', async (
    event: IpcMainInvokeEvent, 
    docName: string
  ): Promise<number[] | null> => {
    if (!isValidDocName(docName)) {
      throw new Error('Invalid doc name')
    }
    
    try {
      const data = await adapter.load(docName)
      // Convert to IPC-safe array
      return data ? Array.from(data) : null
    } catch (error) {
      console.error('Load error:', error)
      throw new Error(`Failed to load: ${error.message}`)
    }
  })

  // Get all updates
  ipcMain.handle('persistence:getAllUpdates', async (
    event: IpcMainInvokeEvent, 
    docName: string
  ): Promise<number[][]> => {
    if (!isValidDocName(docName)) {
      throw new Error('Invalid doc name')
    }
    
    try {
      const updates = await adapter.getAllUpdates(docName)
      // Convert each update to IPC-safe array
      return updates.map(update => Array.from(update))
    } catch (error) {
      console.error('Get all updates error:', error)
      throw new Error(`Failed to get updates: ${error.message}`)
    }
  })

  // Clear updates
  ipcMain.handle('persistence:clearUpdates', async (
    event: IpcMainInvokeEvent, 
    docName: string
  ): Promise<void> => {
    if (!isValidDocName(docName)) {
      throw new Error('Invalid doc name')
    }
    
    try {
      await adapter.clearUpdates(docName)
    } catch (error) {
      console.error('Clear updates error:', error)
      throw new Error(`Failed to clear updates: ${error.message}`)
    }
  })

  // Save snapshot
  ipcMain.handle('persistence:saveSnapshot', async (
    event: IpcMainInvokeEvent, 
    docName: string, 
    snapshotArray: number[]
  ): Promise<void> => {
    if (!isValidDocName(docName)) {
      throw new Error('Invalid doc name')
    }
    
    if (!isValidArray(snapshotArray)) {
      throw new Error('Invalid snapshot data')
    }
    
    const snapshot = new Uint8Array(snapshotArray)
    
    try {
      await adapter.saveSnapshot(docName, snapshot)
    } catch (error) {
      console.error('Save snapshot error:', error)
      throw new Error(`Failed to save snapshot: ${error.message}`)
    }
  })

  // Load snapshot
  ipcMain.handle('persistence:loadSnapshot', async (
    event: IpcMainInvokeEvent, 
    docName: string
  ): Promise<number[] | null> => {
    if (!isValidDocName(docName)) {
      throw new Error('Invalid doc name')
    }
    
    try {
      const snapshot = await adapter.loadSnapshot(docName)
      return snapshot ? Array.from(snapshot) : null
    } catch (error) {
      console.error('Load snapshot error:', error)
      throw new Error(`Failed to load snapshot: ${error.message}`)
    }
  })

  // Compact operation
  ipcMain.handle('persistence:compact', async (
    event: IpcMainInvokeEvent, 
    docName: string
  ): Promise<void> => {
    if (!isValidDocName(docName)) {
      throw new Error('Invalid doc name')
    }
    
    try {
      await adapter.compact(docName)
    } catch (error) {
      console.error('Compact error:', error)
      throw new Error(`Failed to compact: ${error.message}`)
    }
  })

  // Get connection status
  ipcMain.handle('persistence:getStatus', async (): Promise<{
    mode: 'remote' | 'local'
    remoteHealthy: boolean
    localHealthy: boolean
  }> => {
    try {
      return await adapter.getConnectionStatus()
    } catch (error) {
      console.error('Get status error:', error)
      return {
        mode: 'local',
        remoteHealthy: false,
        localHealthy: false
      }
    }
  })

  // Force connection mode
  ipcMain.handle('persistence:forceMode', async (
    event: IpcMainInvokeEvent,
    mode: 'remote' | 'local'
  ): Promise<void> => {
    if (mode !== 'remote' && mode !== 'local') {
      throw new Error('Invalid mode')
    }
    
    try {
      await adapter.forceMode(mode)
    } catch (error) {
      console.error('Force mode error:', error)
      throw new Error(`Failed to force mode: ${error.message}`)
    }
  })
}

// Unregister handlers (for cleanup)
export function unregisterPersistenceHandlers(): void {
  const handlers = [
    'persistence:persist',
    'persistence:load',
    'persistence:getAllUpdates',
    'persistence:clearUpdates',
    'persistence:saveSnapshot',
    'persistence:loadSnapshot',
    'persistence:compact',
    'persistence:getStatus',
    'persistence:forceMode'
  ]
  
  handlers.forEach(channel => {
    ipcMain.removeHandler(channel)
  })
}