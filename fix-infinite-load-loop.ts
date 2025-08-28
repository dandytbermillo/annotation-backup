// Fix for infinite load loop in canvas-panel.tsx

// The issue: getEditorYDoc is called on every render, which triggers setupPersistenceHandler
// which then triggers a load from the database, causing infinite requests

// Solution 1: Memoize the Y.Doc in the component
// In canvas-panel.tsx, wrap getEditorYDoc in useMemo:

/*
import { useMemo } from 'react'

// Replace this line:
const ydoc = getEditorYDoc(panelId, currentNoteId)

// With this:
const ydoc = useMemo(() => getEditorYDoc(panelId, currentNoteId), [panelId, currentNoteId])
*/

// Solution 2: Add a flag to prevent multiple loads
// In lib/yjs-provider.ts, track which docs have already loaded:

/*
const docsLoadingInitiated = new Set<string>()

function setupPersistenceHandler(doc: Y.Doc, docKey: string, cacheKey: string): void {
  // Check if we've already initiated loading for this doc
  if (docsLoadingInitiated.has(cacheKey)) {
    console.log(`[SETUP] Loading already initiated for ${cacheKey}, skipping`)
    return
  }
  
  // ... existing handler setup code ...
  
  // Mark that we've initiated loading
  docsLoadingInitiated.add(cacheKey)
  
  // When cleaning up, remove from set
  // In the cleanup function:
  docsLoadingInitiated.delete(cacheKey)
}
*/

// Solution 3: Check if persistence handler is truly needed
// Only call setupPersistenceHandler if no handler exists:

/*
// In getEditorYDoc, before calling setupPersistenceHandler:
if (!docsWithPersistenceHandlers.has(existingDoc)) {
  setupPersistenceHandler(existingDoc, docKey, cacheKey)
}
*/