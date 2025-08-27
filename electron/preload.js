const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
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