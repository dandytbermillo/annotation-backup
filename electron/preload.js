const { contextBridge, ipcRenderer } = require('electron')

// Define all valid channels
const validChannels = [
  // Existing persistence channels
  'persistence:persist',
  'persistence:load',
  'persistence:getAllUpdates',
  'persistence:clearUpdates',
  'persistence:saveSnapshot',
  'persistence:loadSnapshot',
  'persistence:compact',
  'persistence:getStatus',
  'persistence:forceMode',
  // Plain mode postgres-offline channels
  'postgres-offline:createNote',
  'postgres-offline:updateNote',
  'postgres-offline:getNote',
  'postgres-offline:createBranch',
  'postgres-offline:updateBranch',
  'postgres-offline:listBranches',
  'postgres-offline:saveDocument',
  'postgres-offline:loadDocument',
  'postgres-offline:enqueueOffline',
  'postgres-offline:flushQueue'
]

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Generic invoke method for all IPC channels
  invoke: (channel, ...args) => {
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args)
    } else {
      throw new Error(`Invalid IPC channel: ${channel}`)
    }
  },
  
  // Legacy persistence API for backward compatibility
  persistence: {
    persist: (docName, updateArray) => 
      ipcRenderer.invoke('persistence:persist', docName, updateArray),
    
    load: (docName) => 
      ipcRenderer.invoke('persistence:load', docName),
    
    getAllUpdates: (docName) => 
      ipcRenderer.invoke('persistence:getAllUpdates', docName),
    
    clearUpdates: (docName) => 
      ipcRenderer.invoke('persistence:clearUpdates', docName),
    
    saveSnapshot: (docName, snapshotArray) => 
      ipcRenderer.invoke('persistence:saveSnapshot', docName, snapshotArray),
    
    loadSnapshot: (docName) => 
      ipcRenderer.invoke('persistence:loadSnapshot', docName),
    
    compact: (docName) => 
      ipcRenderer.invoke('persistence:compact', docName),
    
    getStatus: () => 
      ipcRenderer.invoke('persistence:getStatus'),
    
    forceMode: (mode) => 
      ipcRenderer.invoke('persistence:forceMode', mode),
  }
})