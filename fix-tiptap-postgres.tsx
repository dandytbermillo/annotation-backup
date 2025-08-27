// Fix for TipTap editor persistence to PostgreSQL

// OPTION 1: Quick Fix - Add persistence handler to existing editor docs
export function addPersistenceToEditorDoc(panelId: string, ydoc: Y.Doc) {
  // Get the persistence adapter from enhanced provider
  const provider = EnhancedCollaborationProvider.getInstance()
  const persistence = (provider as any).persistence
  
  if (!persistence) {
    console.error('No persistence adapter found!')
    return
  }
  
  // Add update handler to save to PostgreSQL
  ydoc.on('update', async (update: Uint8Array, origin: any) => {
    try {
      console.log(`Persisting update for panel ${panelId} to PostgreSQL`)
      await persistence.persist(`panel-${panelId}`, update)
    } catch (error) {
      console.error(`Failed to persist panel ${panelId}:`, error)
    }
  })
}

// OPTION 2: Proper Fix - Use enhanced provider's subdocs
export function useEnhancedProviderSubdoc(panelId: string) {
  const provider = EnhancedCollaborationProvider.getInstance()
  
  // Get or create subdoc with built-in persistence
  const subdoc = provider.getEditorDoc(panelId)
  
  return {
    ydoc: subdoc,
    provider: provider
  }
}

// OPTION 3: Replace in canvas-panel.tsx (around line 43)
// REPLACE:
//   const ydoc = getEditorYDoc(panelId)
// WITH:
//   const enhancedProvider = EnhancedCollaborationProvider.getInstance()
//   const ydoc = enhancedProvider.getEditorDoc(panelId)

// Test function to verify persistence is working
export async function testTipTapPersistence() {
  // Monitor PostgreSQL calls
  const originalPersist = WebPostgresAdapter.prototype.persist
  let callCount = 0
  
  WebPostgresAdapter.prototype.persist = async function(docName: string, update: Uint8Array) {
    callCount++
    console.log(`🔥 PostgreSQL persist called! Doc: ${docName}, Update size: ${update.length}`)
    return originalPersist.call(this, docName, update)
  }
  
  console.log('Monitoring PostgreSQL persistence calls...')
  console.log('Make some edits in TipTap editor')
  
  // Check after 5 seconds
  setTimeout(() => {
    console.log(`\nTotal persist calls: ${callCount}`)
    if (callCount === 0) {
      console.error('❌ No persistence calls detected! TipTap is not saving to PostgreSQL')
    } else {
      console.log('✅ TipTap changes are being persisted to PostgreSQL')
    }
  }, 5000)
}