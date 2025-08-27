# TipTap to PostgreSQL Persistence Flow Analysis

## Current Flow (Found Issues)

### 1. TipTap Editor Setup (`tiptap-editor.tsx`)
- Line 108-118: Creates or uses existing Y.Doc
- Line 112-118: Sets up IndexedDB persistence if no provider (fallback for local-only)
- Line 131-142: If provider exists, configures Collaboration extension with the Y.Doc
- Line 150-153: `onUpdate` callback triggers when editor content changes, calls `onUpdate?.(html)`

### 2. Canvas Panel Integration (`canvas-panel.tsx`)
- Line 43: Gets Y.Doc for editor: `const ydoc = getEditorYDoc(panelId)`
- Line 94-120: `handleUpdate` function updates local stores but NOT YJS directly
- Line 572: Passes provider to TipTap: `provider={provider.getProvider()}`

### 3. YJS Provider Issues

#### Issue 1: Mock Provider
In `lib/yjs-provider.ts` line 300-319, `getProvider()` returns a MOCK provider:
```typescript
public getProvider(): any {
  // Return a mock provider for now - this would normally be a WebSocket or WebRTC provider
  return {
    awareness: { /* mock */ },
    on: (event: string, handler: Function) => {},
    // ...
  }
}
```

#### Issue 2: Disconnected Y.Docs
- The Y.Doc created by `getEditorYDoc()` in `lib/yjs-provider.ts` is NOT connected to the enhanced provider's persistence
- These editor docs are stored separately in `editorDocs` Map and have no update handlers

#### Issue 3: Missing Persistence Hook
In `lib/enhanced-yjs-provider.ts`:
- Line 174-180: Panel subdocs have persistence handlers
- But the editor Y.Docs from `getEditorYDoc()` don't have these handlers

## Root Cause

**The TipTap editors are using Y.Docs that are not connected to the PostgreSQL persistence layer.**

### Why it's not persisting:
1. `getEditorYDoc(panelId)` creates standalone Y.Docs without persistence handlers
2. The mock provider doesn't actually sync anything
3. TipTap's Collaboration extension updates the Y.Doc, but there's no listener to persist those updates
4. The `handleUpdate` function in canvas-panel.tsx only updates local state, not YJS

## Solution

The editor Y.Docs need to be connected to the enhanced provider's persistence. Either:

1. **Option A**: Use the enhanced provider's subdocs instead of separate editor docs
2. **Option B**: Add persistence handlers to the editor Y.Docs
3. **Option C**: Make `handleUpdate` also trigger YJS persistence

## Verification Commands

1. Check if persist() is called:
   ```javascript
   // Run test-tiptap-persistence.js in browser console
   ```

2. Check PostgreSQL for updates:
   ```bash
   docker exec -it annotation-postgres psql -U annotation_user -d annotation_db -c "SELECT COUNT(*) FROM notes;"
   ```

3. Monitor network tab for `/api/persistence/persist` calls

## Expected vs Actual

**Expected**: 
- Edit in TipTap → Y.Doc update → persist() called → PostgreSQL updated

**Actual**: 
- Edit in TipTap → Y.Doc update → No persistence handler → Nothing saved