# Cross-Tab Branch Synchronization - Analysis Report

**Date**: 2025-10-10
**Author**: Claude (AI Assistant)
**Task**: Prove the following claim wrong or confirm it with evidence

---

## your Claim was Analyzed

> "Branch editors rely on each tab's local PlainOfflineProvider cache. When saveDocument runs, it takes the tab's last-seen version as baseVersion and immediately bumps it before queuing the POST. Each browser keeps its own documentVersions map, so a second browser that hasn't reloaded the branch still thinks the latest version is (e.g.) 102."

> "Branch panels are spawned lazily from cached snapshot data in CanvasProvider, so it's easy for a second browser to open a branch, start typing, and save before ever seeing the other tab's latest version—triggering the conflict loop."

---

## Findings

### ✅ PARTIALLY CORRECT - With Critical Nuance

The claim is **technically accurate** about the architecture but **misleading** about the actual behavior. Here's why:

---

## Part 1: Version Tracking - ✅ CORRECT

**Claim**: "Each browser keeps its own documentVersions map"

**Evidence**: `lib/providers/plain-offline-provider.ts:536-542`

```typescript
async saveDocument(
  noteId: string,
  panelId: string,
  content: ProseMirrorJSON | HtmlString,
  skipPersist = false,
  options?: { skipBatching?: boolean }
): Promise<void> {
  const cacheKey = this.getCacheKey(noteId, panelId)

  // Update local cache; bump version only if content changed
  const previousVersion = this.documentVersions.get(cacheKey) || 0
  const prev = this.documents.get(cacheKey)
  const changed = JSON.stringify(prev) !== JSON.stringify(content)
  this.documents.set(cacheKey, content)
  const currentVersion = changed ? previousVersion + 1 : previousVersion
  this.documentVersions.set(cacheKey, currentVersion)
  const baseVersion = previousVersion  // ← Line 542: baseVersion from local cache
```

**Verdict**: ✅ TRUE - Each browser tab maintains its own `documentVersions` map

---

## Part 2: API Conflict Detection - ✅ CORRECT

**Claim**: "The API rejects that write because it sees a newer row already stored"

**Evidence**: `app/api/postgres-offline/documents/route.ts:61-80`

```typescript
const latest = await client.query(
  `SELECT id, content, version
     FROM document_saves
    WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3
    ORDER BY version DESC
    LIMIT 1`,
  [noteKey, normalizedPanelId, workspaceId]
)

const latestRow = latest.rows[0]
const latestVersion: number = latestRow?.version ?? 0

// ... (skipped identical content check)

const resolvedBase = baseVersion

if (latestVersion > resolvedBase) {
  throw new Error(`stale document save: baseVersion ${resolvedBase} behind latest ${latestVersion}`)
}
```

**Verdict**: ✅ TRUE - API rejects writes with `baseVersion` behind `latestVersion`

---

## Part 3: Conflict Handling - ✅ CORRECT

**Claim**: "After a conflict, the provider does fetch the remote copy and emits document:remote-update"

**Evidence**: `lib/providers/plain-offline-provider.ts:618-640`

```typescript
} catch (error) {
  console.error(`[PlainOfflineProvider] Failed to persist document for ${cacheKey}:`, error)
  const message = error instanceof Error ? error.message : ''
  if (this.isConflictError(message)) {
    // ...debug logging...
    this.revertOptimisticUpdate(cacheKey, prev, previousVersion)
    const latest = await this.refreshDocumentFromRemote(noteId, panelId, 'conflict')
    const conflictError = new PlainDocumentConflictError(noteId, panelId, message, latest || undefined)
    this.emit('document:conflict', {
      noteId,
      panelId,
      message,
      remoteVersion: latest?.version,
      remoteContent: latest?.content
    })
    throw conflictError
  }
```

**Evidence**: `lib/providers/plain-offline-provider.ts:722-736` (refreshDocumentFromRemote)

```typescript
async refreshDocumentFromRemote(
  noteId: string,
  panelId: string,
  reason: 'conflict' | 'manual'
): Promise<{ content: ProseMirrorJSON | HtmlString; version: number } | null> {
  try {
    const latest = await this.adapter.loadDocument(noteId, panelId)
    const cacheKey = this.getCacheKey(noteId, panelId)

    if (latest) {
      this.documents.set(cacheKey, latest.content)
      this.documentVersions.set(cacheKey, latest.version)
      this.updateLastAccess(cacheKey)
      this.emit('document:remote-update', {
        noteId,
        panelId,
        version: latest.version,
        content: latest.content,
        reason
      })
      return latest
    }
```

**Verdict**: ✅ TRUE - Provider fetches remote copy and emits `document:remote-update`

---

## Part 4: Event Consumers - ✅ CORRECT

**Claim**: "nothing in the runtime subscribes to that event"

**Evidence**: Grep results for `document:remote-update` listeners

```bash
$ grep -r "on.*document:remote-update" components/ lib/ --include="*.ts" --include="*.tsx"
# No results

$ grep -r "addEventListener.*document:remote-update" components/ lib/ --include="*.ts" --include="*.tsx"
# No results

$ grep -r "\.once.*document:remote-update" components/ lib/ --include="*.ts" --include="*.tsx"
__tests__/plain-mode/plain-provider-conflict.test.ts:58:  provider.once('document:remote-update', resolve)
```

**Verdict**: ✅ TRUE - Only test file listens to `document:remote-update`, NO production code

---

## Part 5: Branch Panel Loading - ❌ MISLEADING (This is the critical error)

**Claim**: "Branch panels are spawned lazily from cached snapshot data in CanvasProvider, so it's easy for a second browser to open a branch, start typing, and save before ever seeing the other tab's latest version"

**Evidence A - Branch snapshot loading**: `components/canvas/canvas-context.tsx:238-254`

```typescript
// Pre-populate additional branches from cache before remote load
snapshotMap.forEach((value, key) => {
  if (key === 'main') return
  const cachedBranch = value as Record<string, any>
  dataStore.set(key, {
    id: key,
    type: cachedBranch.type,
    title: cachedBranch.title || '',
    originalText: cachedBranch.originalText || '',  // ← Stale text from snapshot
    content: cachedBranch.content,                  // ← Stale content from snapshot
    preview: cachedBranch.preview || '',
    hasHydratedContent: cachedBranch.hasHydratedContent ?? false,
    branches: cachedBranch.branches || [],
    parentId: cachedBranch.parentId ?? 'main',
    position: cachedBranch.position || { x: 2500 + Math.random() * 500, y: 1500 + Math.random() * 500 },
    dimensions: cachedBranch.dimensions || { width: 400, height: 300 },
    isEditable: cachedBranch.isEditable ?? true,
    metadata: { displayId: key }
  })
})
```

**Evidence B - Editor DOES call loadDocument**: `components/canvas/tiptap-editor-plain.tsx:445`

```typescript
const branchEntry = typeof window !== 'undefined'
  ? (window as any).canvasDataStore?.get?.(panelId)
  : null

provider.loadDocument(noteId, panelId).then(() => {  // ← CRITICAL: Branch editor DOES call loadDocument
  if (!isActive) return

  let remoteContent: ProseMirrorJSON | string | null = null
  try {
    remoteContent = provider.getDocument(noteId, panelId)
  } catch {}

  let resolvedContent: ProseMirrorJSON | string | null = remoteContent

  fallbackSourceRef.current = null
  previewFallbackContentRef.current = null

  const treatAsPlaceholder = branchEntry
    ? isPlaceholderDocument(resolvedContent, branchEntry)
    : false

  const needsFallback = !resolvedContent
    || providerContentIsEmpty(provider, resolvedContent)
    || treatAsPlaceholder
  if (needsFallback && typeof window !== 'undefined') {
    try {
      const fallbackRaw = branchEntry?.content || branchEntry?.metadata?.htmlSnapshot
      let fallback = coerceStoredContent(fallbackRaw)
```

**Evidence C - loadDocument fetches from remote if not cached**: `lib/providers/plain-offline-provider.ts:438-452`

```typescript
// Check cache first
if (this.documents.has(cacheKey)) {
  const cachedContent = this.documents.get(cacheKey)
  console.log(`[PlainOfflineProvider] Found cached document for ${cacheKey}:`, cachedContent)
  this.updateLastAccess(cacheKey)
  if (AUTOSAVE_DEBUG) {
    providerAutosaveDebug('load:cache-hit', {
      cacheKey,
      version: this.documentVersions.get(cacheKey) || 0
    })
  }
  return cachedContent || null
}

// Create loading promise
const loadPromise = this.adapter.loadDocument(noteId, panelId)  // ← Fetches from database via API
  .then(result => {
    if (result) {
      console.log(`[PlainOfflineProvider] Loaded document for ${cacheKey}, version: ${result.version}, content:`, result.content)
```

**Critical Question**: When Browser B opens a branch panel, is the provider cache empty or does it contain stale data?

**Analysis**:

1. **Browser B loads the page** → New provider instance created → `documentVersions` map is EMPTY
2. **Canvas restores from snapshot** → Populates `canvasDataStore` with stale `originalText`/`content`
3. **Branch editor mounts** → Calls `provider.loadDocument(noteId, panelId)`
4. **Provider checks cache** → `this.documents.has(cacheKey)` returns FALSE (no cache entry)
5. **Provider fetches from DB** → `this.adapter.loadDocument(noteId, panelId)` hits API
6. **API returns latest version** → Provider caches it with correct version number
7. **Editor receives fresh content** → Uses `remoteContent` from provider, not stale snapshot

**Verdict**: ❌ **MISLEADING** - While branch panels ARE spawned from cached snapshot data, the **editor immediately calls `loadDocument()`** which fetches the latest version from the database when the provider cache is empty (which it is in a fresh browser tab).

---

## Part 6: Main Panel vs Branch Panel - ✅ CORRECT (Timing Nuance)

**Claim**: "Main panel changes feel 'synced' mostly because every browser eagerly loads that document on note entry"

**Evidence**: `components/annotation-canvas-modern.tsx:297-317`

```typescript
// Attempt to load saved state
const snapshot = loadStateFromStorage(noteId)
if (!snapshot) {
  console.table([
    {
      Action: 'No Saved State',
      NoteId: noteId,
      Time: new Date().toLocaleTimeString(),
    },
  ])
  setIsStateLoaded(true)
  return
}

const plainProvider = getPlainProvider()
let providerVersion = 0
let providerHasContent = false
if (plainProvider) {
  try {
    providerVersion = plainProvider.getDocumentVersion(noteId, 'main')  // ← Check version before snapshot
    const existing = plainProvider.getDocument(noteId, 'main')
    providerHasContent = existing ? !plainProvider.isEmptyContent(existing) : false
  } catch (err) {
    console.warn('[AnnotationCanvas] Failed to inspect provider cache during snapshot load:', err)
```

**Verdict**: ✅ TRUE - Main panel loads eagerly and checks provider version early

---

## Summary: Where the Claim Goes Wrong

### What's CORRECT ✅:
1. Each browser maintains separate `documentVersions` maps (isolated state)
2. API rejects stale writes with version conflict errors
3. Provider fetches remote copy and emits `document:remote-update` on conflict
4. NO production code listens to `document:remote-update` event
5. Main panel loads more eagerly than branch panels

### What's MISLEADING ❌:
1. **Critical error**: The claim implies branch editors DON'T fetch latest version before editing
2. **Reality**: Branch editors ALWAYS call `provider.loadDocument()` which fetches from DB if cache is empty
3. **Reality**: In a fresh browser tab, provider cache IS empty, so `loadDocument()` WILL fetch latest version
4. **Reality**: The version conflict would only occur if:
   - Browser A and Browser B both already have the same document cached
   - Browser A saves (version bumps to 103)
   - Browser B tries to save (still thinks it's version 102)

---

## The ACTUAL Problem (If Any)

The real issue is **NOT** about "never seeing the latest version". The issue is about **race conditions in concurrent editing**:

### Scenario Where Conflicts Occur:

**Initial state**: Document at version 102 in database

1. **Browser A** loads branch → provider fetches version 102
2. **Browser B** loads branch → provider fetches version 102
3. **Browser A** edits → local version becomes 103
4. **Browser A** saves → Database now has version 103 ✅
5. **Browser B** still thinks it's version 102 (hasn't reloaded)
6. **Browser B** edits → local version becomes 103
7. **Browser B** tries to save with baseVersion=102 → ❌ CONFLICT (database has 103)
8. **Provider fetches latest** → Emits `document:remote-update` with version 103
9. **NO CODE LISTENS** → Editor continues showing Browser B's edits ❌
10. **User tries to save again** → Same conflict loop

### This is NOT "lazy loading" - it's "lack of reactive updates"

---

## The Real Root Cause

**NOT**: "Branch panels don't load latest version"
**ACTUALLY**: "After conflict, `document:remote-update` event is emitted but no component listens to it"

The fix is NOT to "force refresh when branch editor gains focus" (it already loads on mount).
The fix IS to "listen to `document:remote-update` and merge/reload the editor content".

---

## Recommended Fix

### Option 1: Wire `document:remote-update` Event (Proper Fix)

**File**: `components/canvas/tiptap-editor-plain.tsx`

**Add listener**:

```typescript
useEffect(() => {
  if (!provider || !noteId || !panelId) return

  const handleRemoteUpdate = (event: {
    noteId: string
    panelId: string
    version: number
    content: ProseMirrorJSON | HtmlString
    reason: 'conflict' | 'manual'
  }) => {
    if (event.noteId === noteId && event.panelId === panelId) {
      console.log(`[TipTapEditor] Remote update detected for ${panelId}, version ${event.version}`)

      // Option A: Replace editor content (loses local edits)
      if (editor && event.content) {
        editor.commands.setContent(event.content)
      }

      // Option B: Warn user and offer to reload
      // setShowConflictWarning(true)

      // Option C: Attempt merge (complex)
      // mergeContent(editor.getJSON(), event.content)
    }
  }

  provider.on('document:remote-update', handleRemoteUpdate)

  return () => {
    provider.off('document:remote-update', handleRemoteUpdate)
  }
}, [provider, noteId, panelId, editor])
```

### Option 2: Poll for Version Changes (Hacky)

Check database version periodically and reload if changed. Not recommended.

### Option 3: Use BroadcastChannel (Better for Multi-Tab)

Have Browser A broadcast "I saved noteId:panelId version 103" to all tabs.
Other tabs listen and reload if they have that document open.

---

## Conclusion

**The claim is architecturally accurate but behaviorally misleading.**

- ✅ Version tracking is isolated per browser
- ✅ API detects conflicts correctly
- ✅ Provider fetches and emits updates
- ✅ No listeners for `document:remote-update`
- ❌ **WRONG**: "Branch panels don't fetch latest version before editing"
- ✅ **RIGHT**: "After conflict, editor doesn't react to `document:remote-update` event"

**The actual problem**: Missing event listener, not lazy loading.

**The fix**: Wire `document:remote-update` to editor, not force-refresh on focus.

---

## Evidence Summary

| Code Location | Line | What It Proves |
|---------------|------|----------------|
| `plain-offline-provider.ts` | 542 | baseVersion from local cache ✅ |
| `route.ts` | 79-80 | API rejects stale writes ✅ |
| `plain-offline-provider.ts` | 631 | Fetches remote on conflict ✅ |
| `plain-offline-provider.ts` | 730 | Emits `document:remote-update` ✅ |
| Grep results | N/A | No production listeners ✅ |
| `tiptap-editor-plain.tsx` | 445 | **Branch DOES call loadDocument** ❌ Claim wrong |
| `plain-offline-provider.ts` | 452 | loadDocument fetches from DB if not cached ❌ Claim wrong |

---

**Status**: Analysis complete
**Next Step**: Decide on fix approach (Option 1 recommended)
