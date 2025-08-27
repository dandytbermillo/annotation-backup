// Fix for TipTap editor persistence issue
// This shows how to properly connect editor Y.Docs to PostgreSQL persistence

import * as Y from 'yjs'
import { EnhancedCollaborationProvider } from './lib/enhanced-yjs-provider'

// Option 1: Modify getEditorYDoc to use enhanced provider's subdocs
export async function getEditorYDocWithPersistence(panelId: string): Promise<Y.Doc> {
  const provider = EnhancedCollaborationProvider.getInstance()
  const structure = provider.getMainDoc().getMap('structure') // or use the proper structure accessor
  
  // Use the enhanced provider's subdoc system which has persistence built-in
  const editorDoc = await structure.getEditorSubdoc(panelId)
  return editorDoc
}

// Option 2: Add persistence to existing editor docs
export function addPersistenceToEditorDoc(panelId: string, doc: Y.Doc): void {
  const provider = EnhancedCollaborationProvider.getInstance()
  
  // Get persistence adapter
  const persistence = (provider as any).persistence
  
  // Add update handler to persist changes
  doc.on('update', async (update: Uint8Array) => {
    try {
      await persistence.persist(`panel-${panelId}`, update)
      console.log(`✅ Persisted editor update for panel ${panelId}`)
    } catch (error) {
      console.error(`❌ Failed to persist panel ${panelId}:`, error)
    }
  })
  
  // Load existing content
  loadExistingContent(panelId, doc, persistence)
}

async function loadExistingContent(panelId: string, doc: Y.Doc, persistence: any): Promise<void> {
  try {
    // Try to load snapshot first
    const snapshot = await persistence.loadSnapshot(`panel-${panelId}`)
    if (snapshot) {
      Y.applyUpdate(doc, snapshot)
      console.log(`✅ Loaded snapshot for panel ${panelId}`)
      return
    }
    
    // Fall back to loading all updates
    const updates = await persistence.getAllUpdates(`panel-${panelId}`)
    if (updates && updates.length > 0) {
      updates.forEach((update: Uint8Array) => {
        Y.applyUpdate(doc, update)
      })
      console.log(`✅ Loaded ${updates.length} updates for panel ${panelId}`)
    }
  } catch (error) {
    console.error(`Failed to load content for panel ${panelId}:`, error)
  }
}

// Option 3: Create a proper WebSocket provider that syncs with PostgreSQL
export function createRealProvider(noteId: string, doc: Y.Doc): any {
  // This would be a real WebSocket provider that syncs with the server
  // For now, we can create a provider that just handles persistence
  
  const provider = EnhancedCollaborationProvider.getInstance()
  const persistence = (provider as any).persistence
  
  return {
    awareness: {
      getLocalState: () => ({}),
      setLocalState: (state: any) => {},
      setLocalStateField: (field: string, value: any) => {},
      on: (event: string, handler: Function) => {},
      off: (event: string, handler: Function) => {},
      states: new Map()
    },
    on: (event: string, handler: Function) => {
      if (event === 'synced') {
        // Simulate synced event after loading
        loadExistingContent(noteId, doc, persistence).then(() => {
          handler({ synced: true })
        })
      }
    },
    off: (event: string, handler: Function) => {},
    disconnect: () => {},
    connect: () => {},
    destroy: () => {},
    doc: doc,
    // Important: This ensures the doc gets persistence
    _setupPersistence: () => addPersistenceToEditorDoc(noteId, doc)
  }
}