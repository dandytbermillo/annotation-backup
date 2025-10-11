# Root Cause Investigation: Cross-Browser Branch Sync

**Date**: 2025-10-10
**Status**: Investigation in progress - instrumentation needed

---

## What We Know For Certain

### ✅ Verified Facts

1. **Server Has Conflict Protection**
   - `app/api/postgres-offline/documents/route.ts:79-80`
   - Rejects stale writes with 409 error
   - Database cannot be silently overwritten

2. **Provider Loads Fresh Content**
   - `lib/providers/plain-offline-provider.ts:452-509`
   - `loadDocument()` fetches from database
   - Populates cache with latest version
   - Returns fresh content

3. **Editor Calls loadDocument**
   - `components/canvas/tiptap-editor-plain.tsx:445`
   - Both main and branch panels use same code path
   - Fresh content should be available after `.then()` callback

4. **Snapshot Provides Offline Fallback**
   - `components/canvas/canvas-context.tsx:238-256`
   - Pre-populates dataStore with localStorage content
   - Used for instant rendering and offline mode

---

## What We DON'T Know

### ❓ Unverified Assumptions

1. **Does the editor actually DISPLAY stale content?**
   - User reports seeing stale content
   - But is this during initial load (expected) or persistent (bug)?
   - Does editor update when fresh content arrives?

2. **When does the stale content get saved?**
   - Line 498 saves fallback content
   - But when does `needsFallback` evaluate to `true`?
   - If DB has content, why would fallback be needed?

3. **Is this a race condition?**
   - User types before fresh content loads?
   - Editor saves edited snapshot before DB fetch completes?
   - If so, why doesn't conflict protection catch it?

---

## Proposed Scenarios

### Scenario A: UI Doesn't Refresh

**Hypothesis**: Editor loads stale snapshot, fresh content arrives, but editor doesn't re-render

**Evidence for**:
- User says content "stays" stale (not just briefly)
- `setLoadedContent()` might not trigger re-render in all cases

**Evidence against**:
- `setLoadedContent` is a React useState setter
- Should trigger re-render automatically

**To verify**: Add logging to confirm `setLoadedContent` is called with fresh content

---

### Scenario B: Fresh Content Never Loads

**Hypothesis**: Database fetch fails or returns null for some branches

**Evidence for**:
- Line 309-311: Returns null if no rows found
- New branches might not be in DB yet

**Evidence against**:
- User says same-browser sync works
- If branch was saved in Chrome, it should be in DB

**To verify**: Log database query results for branch panels

---

### Scenario C: Snapshot Fallback Used Instead of DB

**Hypothesis**: `needsFallback` incorrectly evaluates to true even when DB has fresh content

**Evidence for**:
- Line 462-464: Three conditions can trigger fallback
- `isPlaceholderDocument` might incorrectly classify fresh content
- `providerContentIsEmpty` might have edge cases

**Evidence against**:
- Main panel works correctly with same logic

**To verify**: Log `remoteContent`, `needsFallback`, and fallback conditions

---

### Scenario D: Race Condition on First Edit

**Hypothesis**: User types before fresh content loads, creating conflict loop

**Evidence for**:
- User mentions conflict errors sometimes
- Fast typers might edit during 300-500ms load window

**Evidence against**:
- Conflict protection should prevent data loss
- Same-browser tabs would have same issue

**To verify**: Log timing of user edits vs content load completion

---

## Instrumentation Plan

### Step 1: Add Logging to Provider

**File**: `lib/providers/plain-offline-provider.ts`

**Add after line 509**:
```typescript
console.log(`[DEBUG] loadDocument complete for ${cacheKey}`, {
  hasContent: !!this.documents.get(cacheKey),
  version: this.documentVersions.get(cacheKey),
  contentPreview: JSON.stringify(this.documents.get(cacheKey)).substring(0, 100)
})
```

---

### Step 2: Add Logging to Editor

**File**: `components/canvas/tiptap-editor-plain.tsx`

**Add after line 450**:
```typescript
console.log(`[DEBUG] Editor loadDocument callback for ${panelId}`, {
  remoteContent: remoteContent ? 'HAS_CONTENT' : 'NULL',
  remoteContentPreview: JSON.stringify(remoteContent).substring(0, 100),
  branchEntryContent: branchEntry?.content ? 'HAS_SNAPSHOT' : 'NO_SNAPSHOT',
  providerVersion: provider.getDocumentVersion(noteId, panelId)
})
```

**Add after line 462**:
```typescript
console.log(`[DEBUG] Fallback check for ${panelId}`, {
  needsFallback,
  reasons: {
    noContent: !resolvedContent,
    isEmpty: providerContentIsEmpty(provider, resolvedContent),
    isPlaceholder: treatAsPlaceholder
  }
})
```

**Add after line 593**:
```typescript
console.log(`[DEBUG] Setting editor content for ${panelId}`, {
  contentSource: fallbackSourceRef.current || 'remote',
  contentPreview: JSON.stringify(resolvedContent).substring(0, 100),
  version: remoteVersion
})
```

---

### Step 3: Reproduction Test

**Test procedure**:
1. Open Chrome
2. Create note with branch annotation
3. Edit branch: "Chrome edit v1"
4. Wait 5 seconds (ensure autosave completes)
5. Open Firefox
6. Check console logs
7. Observe what content is displayed
8. If stale: Check logs to see why
9. Try editing in Firefox
10. Check for conflicts

**Expected logs** (if working correctly):
```
[DEBUG] loadDocument complete for note-branch: version=1, hasContent=true
[DEBUG] Editor loadDocument callback: remoteContent=HAS_CONTENT
[DEBUG] Fallback check: needsFallback=false
[DEBUG] Setting editor content: contentSource=remote
```

**Expected logs** (if bug exists):
```
[DEBUG] loadDocument complete for note-branch: version=1, hasContent=true
[DEBUG] Editor loadDocument callback: remoteContent=??? ← CHECK THIS
[DEBUG] Fallback check: needsFallback=true ← WHY?
[DEBUG] Setting editor content: contentSource=content ← Uses snapshot!
```

---

## Next Steps

1. ✅ Add instrumentation (3 logging points)
2. ⏳ Run reproduction test in Chrome → Firefox
3. ⏳ Analyze logs to determine which scenario is occurring
4. ⏳ Design targeted fix based on evidence
5. ⏳ Create new implementation plan
6. ⏳ Implement and verify fix

---

## Hypotheses to Test

| Hypothesis | How to verify | If true, fix is |
|------------|---------------|-----------------|
| UI doesn't refresh | Check if `setLoadedContent` called with fresh content | Force re-render after load |
| Fresh content never loads | Check database query results | Fix query or data flow |
| Snapshot used incorrectly | Check `needsFallback` conditions | Fix fallback logic |
| Race condition | Check timing of edits vs load | Add loading state, block edits |

---

**Status**: Awaiting instrumentation results
**Blocker**: Need actual browser console logs to proceed
**Recommendation**: Do NOT implement any fix until root cause is confirmed with evidence
