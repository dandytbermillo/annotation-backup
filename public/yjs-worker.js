// Web Worker for heavy YJS operations
importScripts('https://unpkg.com/yjs@13.6.10/dist/yjs.js')
importScripts('https://unpkg.com/lib0@0.2.89/dist/lib0.js')

self.addEventListener('message', async (event) => {
  const { id, operation, data } = event.data
  
  try {
    let result
    
    switch (operation) {
      case 'encodeState':
        result = Y.encodeStateAsUpdate(data.doc)
        break
        
      case 'applyUpdate':
        Y.applyUpdate(data.doc, data.update)
        result = 'success'
        break
        
      case 'mergeUpdates':
        result = Y.mergeUpdates(data.updates)
        break
        
      case 'compressUpdate':
        result = lib0.encoding.compress(data.update)
        break
        
      case 'decompressUpdate':
        result = lib0.encoding.decompress(data.update)
        break
        
      case 'diffUpdate':
        result = Y.diffUpdate(data.update1, data.update2)
        break
        
      case 'encodeStateVector':
        result = Y.encodeStateVector(data.doc)
        break
        
      case 'calculateDelta':
        const doc1 = new Y.Doc()
        const doc2 = new Y.Doc()
        Y.applyUpdate(doc1, data.state1)
        Y.applyUpdate(doc2, data.state2)
        const sv1 = Y.encodeStateVector(doc1)
        result = Y.encodeStateAsUpdate(doc2, sv1)
        break
        
      default:
        throw new Error(`Unknown operation: ${operation}`)
    }
    
    self.postMessage({ id, result })
  } catch (error) {
    self.postMessage({ id, error: error.message })
  }
}) 