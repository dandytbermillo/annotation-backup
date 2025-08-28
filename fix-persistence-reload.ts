// Fix for the persistence reload issue
// The main problems identified:
// 1. When docs are cached, old update handlers might still be attached
// 2. The initialLoadComplete flag might not be properly synchronized
// 3. Multiple handlers might be processing the same updates

// Solution approach:
// 1. Clear old handlers before setting up new ones
// 2. Use a more robust way to track loading state
// 3. Ensure only one persistence handler per doc

import * as Y from 'yjs';

export interface PersistenceHandler {
  handler: (update: Uint8Array, origin: any) => void;
  isActive: () => boolean;
  docKey: string;
  cacheKey: string;
  loadState: {
    initialLoadComplete: boolean;
    updateCount: number;
  };
  cleanup?: () => void;
}

// Enhanced WeakMap to track persistence handlers with cleanup
const persistenceHandlers = new WeakMap<Y.Doc, PersistenceHandler>();

// Function to clean up old persistence handlers
export function cleanupPersistenceHandler(doc: Y.Doc): void {
  const existing = persistenceHandlers.get(doc);
  if (existing) {
    console.log(`[CLEANUP] Removing old handler for ${existing.docKey}`);
    // Remove the update handler
    doc.off('update', existing.handler);
    // Call cleanup if provided
    if (existing.cleanup) {
      existing.cleanup();
    }
    // Remove from WeakMap
    persistenceHandlers.delete(doc);
  }
}

// Enhanced setup persistence handler
export function setupPersistenceHandlerFixed(
  doc: Y.Doc, 
  docKey: string, 
  cacheKey: string,
  persistence: any
): void {
  console.log(`[SETUP-FIXED] Starting setup for ${docKey}`);
  
  // Always clean up existing handlers first
  cleanupPersistenceHandler(doc);
  
  // Create fresh load state
  const loadState = {
    initialLoadComplete: false,
    updateCount: 0
  };
  
  // Create the update handler
  const updateHandler = async (update: Uint8Array, origin: any) => {
    // Always check current state, not captured value
    const handler = persistenceHandlers.get(doc);
    if (!handler || !handler.loadState.initialLoadComplete) {
      console.log(`[UPDATE-FIXED] Skipping - not ready: ${docKey}`);
      return;
    }
    
    if (origin === 'persistence') {
      console.log(`[UPDATE-FIXED] Skipping - persistence origin: ${docKey}`);
      return;
    }
    
    try {
      await persistence.persist(docKey, update);
      handler.loadState.updateCount++;
      console.log(`[UPDATE-FIXED] Persisted update ${handler.loadState.updateCount} for ${docKey}`);
    } catch (error) {
      console.error(`[UPDATE-FIXED] Failed to persist ${docKey}:`, error);
    }
  };
  
  // Register handler first (before loading)
  const handlerInfo: PersistenceHandler = {
    handler: updateHandler,
    isActive: () => loadState.initialLoadComplete,
    docKey,
    cacheKey,
    loadState,
    cleanup: () => {
      console.log(`[CLEANUP] Handler cleanup called for ${docKey}`);
    }
  };
  
  persistenceHandlers.set(doc, handlerInfo);
  
  // Add the update handler to the doc
  doc.on('update', updateHandler);
  console.log(`[SETUP-FIXED] Handler attached for ${docKey}`);
  
  // Load existing data
  persistence.load(docKey).then((data: Uint8Array | null) => {
    if (data && data.length > 0) {
      console.log(`[LOAD-FIXED] Applying loaded data for ${docKey}`);
      Y.applyUpdate(doc, data, 'persistence');
    }
    
    // Mark as ready for persistence
    const handler = persistenceHandlers.get(doc);
    if (handler) {
      handler.loadState.initialLoadComplete = true;
      console.log(`[LOAD-FIXED] Ready for updates: ${docKey}`);
    }
  }).catch((error: any) => {
    console.error(`[LOAD-FIXED] Failed to load ${docKey}:`, error);
    const handler = persistenceHandlers.get(doc);
    if (handler) {
      handler.loadState.initialLoadComplete = true;
    }
  });
}

// Function to verify persistence is working
export function verifyPersistence(doc: Y.Doc): boolean {
  const handler = persistenceHandlers.get(doc);
  if (!handler) {
    console.warn('[VERIFY] No persistence handler found');
    return false;
  }
  
  console.log('[VERIFY] Persistence status:', {
    docKey: handler.docKey,
    isActive: handler.isActive(),
    initialLoadComplete: handler.loadState.initialLoadComplete,
    updateCount: handler.loadState.updateCount
  });
  
  return handler.isActive();
}

// Export for use in the actual codebase
export default {
  setupPersistenceHandlerFixed,
  cleanupPersistenceHandler,
  verifyPersistence
};