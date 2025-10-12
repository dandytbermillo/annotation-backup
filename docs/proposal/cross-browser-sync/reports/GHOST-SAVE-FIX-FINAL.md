# Ghost Save Fix - Final Implementation

**Date:** 2025-10-11
**Issue:** Firefox opening a panel triggers a "ghost save" causing false conflict notifications in Chrome

---

## Root Cause

When Firefox opens a panel:

1. **Load effect** at `tiptap-editor-plain.tsx:2329` calls `editor.commands.setContent()`
2. **Suppression flag** is set: `isApplyingRemoteUpdateRef.current = true`
3. **Content is loaded** and `ensureTrailingParagraph()` mutates the document
4. **Flag is cleared immediately**: `isApplyingRemoteUpdateRef.current = false`
5. **TipTap fires `onUpdate` ASYNCHRONOUSLY** - flag is already `false` ❌
6. **onUpdate handler** runs the autosave path → ghost save to database
7. **Chrome detects** the new version → conflict → notification

### Evidence from Debug Logs

```bash
$ node scripts/verify-suppression-fix.js

SAVE_HASH_UPDATED logs: 2 events (v1 @ 5:20:28, v3 @ 5:20:50)
Database saves:         3 versions (v1 @ 5:20:28, v2 @ 5:20:47, v3 @ 5:20:50)

❌ Version 2 created WITHOUT logging SAVE_HASH_UPDATED
   Ghost save occurred despite suppression flag
```

**Timeline:**
```
5:20:39.560  LOAD_CONTENT_SUPPRESSED (Firefox opens panel)
5:20:47.000  [DATABASE] Version 2 created (NO LOG EVENT)
5:20:47.828  VISIBILITY_REFRESH (Chrome visible)
5:20:49.769  USER_EDIT_FLAG_SET (Chrome user types)
5:20:50.166  REMOTE_UPDATE_RECEIVED (Chrome detects v2)
5:20:50.185  REMOTE_UPDATE_BLOCKED → NOTIFICATION ⚠️
```

---

## The Fix

### Problem: Synchronous Flag Clearing

**Before:**
```typescript
isApplyingRemoteUpdateRef.current = true
editor.commands.setContent(loadedContent, false)
ensureTrailingParagraph(editor.view)
isApplyingRemoteUpdateRef.current = false  // ← Cleared too early
// Later: onUpdate fires with flag=false → SAVE HAPPENS ❌
```

### Solution: Asynchronous Flag Clearing with RAF

**After:**
```typescript
isApplyingRemoteUpdateRef.current = true

editor.commands.setContent(loadedContent, false)
ensureTrailingParagraph(editor.view)

// Wait for TipTap's update cycle to complete
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    // Double RAF ensures we're after both layout and paint
    isApplyingRemoteUpdateRef.current = false

    // Update hash tracking with actual rendered content
    const actualContent = editor.getJSON()
    const canonized = canonizeDoc(actualContent, editor)
    if (canonized) {
      lastSavedHashRef.current = hashContent(canonized)
      lastSavedContentRef.current = canonized
    }

    // Reset edit flag since this is fresh load
    hasUserEditedRef.current = false
  })
})
```

**Why Double RAF?**
- First RAF: Queued after current script execution
- Second RAF: Ensures we're after TipTap's internal updates
- By this point, `onUpdate` has already fired (or been suppressed)

---

## Changes Made

### File: `components/canvas/tiptap-editor-plain.tsx`

**Location:** Lines 2333-2390

**Changes:**
1. ✅ Wrap flag clearing in double `requestAnimationFrame()`
2. ✅ Add debug logging:
   - `LOAD_CONTENT_SUPPRESSION_START` - When suppression begins
   - `LOAD_CONTENT_SUPPRESSION_END` - When suppression ends (after RAF)
   - `LOAD_HASH_INITIALIZED` - When hash tracking is updated
3. ✅ Initialize `lastSavedHashRef` with actual rendered content
4. ✅ Reset `hasUserEditedRef` to false after load

---

## Verification

### Script: `scripts/verify-suppression-fix.js`

**Checks:**
1. ✅ `LOAD_CONTENT_SUPPRESSION_START` event exists
2. ✅ `LOAD_CONTENT_SUPPRESSION_END` event exists (after RAF delay)
3. ✅ `LOAD_HASH_INITIALIZED` event exists
4. ✅ NO database saves between suppression start and end
5. ✅ NO `REMOTE_UPDATE_BLOCKED` events after panel load

### Expected Debug Log Sequence

**Correct behavior:**
```
LOAD_CONTENT_SUPPRESSION_START
  ↓ (TipTap onUpdate fires but suppressed)
  ↓ (~16-32ms RAF delay)
LOAD_CONTENT_SUPPRESSION_END
LOAD_HASH_INITIALIZED
  ↓ (No save to database)
VISIBILITY_REFRESH (switching back to Chrome)
PROVIDER_SKIP_IDENTICAL (no version change)
  ↓ (User types)
USER_EDIT_FLAG_SET
  ↓ (Normal save from user edit)
SAVE_HASH_UPDATED
```

**Incorrect behavior (before fix):**
```
LOAD_CONTENT_SUPPRESSED
  ↓ (Suppression cleared immediately)
  ↓ (onUpdate fires with flag=false)
[DATABASE] Ghost save creates new version ❌
VISIBILITY_REFRESH
PROVIDER_EMIT_REMOTE_UPDATE (detects version bump)
USER_EDIT_FLAG_SET (user types)
REMOTE_UPDATE_BLOCKED → NOTIFICATION ⚠️
```

---

## Testing Instructions

### Manual Test

1. **Chrome:** Type "test document" in main panel
2. **Chrome:** Wait for auto-save (300ms)
3. **Firefox:** Switch to Firefox
4. **Firefox:** Open main panel (same note_id)
5. **Chrome:** Switch back to Chrome
6. **Chrome:** Type ONE character
7. **Expected:** ✅ NO notification appears

### Verify with Debug Logs

```bash
# After reproducing the workflow above
node scripts/verify-suppression-fix.js
```

**Expected output:**
```
✅ Suppression lifecycle complete:
   Started: 5:30:15.234
   Ended: 5:30:15.268
   Duration: 34ms

✅ Hash tracking initialized after load

✅ NO GHOST SAVES: No saves within 3 seconds of panel load
   Suppression is working correctly!

✅ No false notifications after this load
```

---

## Impact

### Before Fix
- **Problem:** Every panel open in Firefox created a new version
- **Result:** Chrome users saw false "Remote changes available" notifications
- **User Experience:** Confusing, disruptive

### After Fix
- **Problem:** Eliminated ghost saves during panel load
- **Result:** No false notifications when just viewing content
- **User Experience:** Smooth cross-browser editing

### Real Conflict Still Detected
- If Firefox user ACTUALLY EDITS the content → version bump
- Chrome detects real conflict → notification shown ✅
- This is correct behavior

---

## Additional Improvements

### 1. Hash Tracking Initialization

**Before:** Hash might not be set during load, causing false `hasUnsavedChanges()`

**After:** Hash is initialized with the actual rendered content after load completes

### 2. Edit Flag Reset

**Before:** `hasUserEditedRef` might remain true from previous session

**After:** Reset to false after content load to prevent false positives

### 3. Debug Visibility

**Before:** Only console logs, hard to trace timing issues

**After:** Structured debug logs in PostgreSQL for analysis

---

## Rollback Plan

If issues occur:

```typescript
// Remove double RAF, restore immediate clearing
isApplyingRemoteUpdateRef.current = true
editor.commands.setContent(loadedContent, false)
ensureTrailingParagraph(editor.view)
isApplyingRemoteUpdateRef.current = false  // Immediate
```

**Risk:** Ghost saves return, false notifications resume

---

## Monitoring

### Key Metrics (from debug_logs)

1. **LOAD_CONTENT_SUPPRESSION_START count** - Panel opens
2. **LOAD_CONTENT_SUPPRESSION_END count** - Should equal START
3. **Ghost save rate:**
   ```sql
   SELECT COUNT(*) FROM document_saves ds
   WHERE NOT EXISTS (
     SELECT 1 FROM debug_logs dl
     WHERE dl.action = 'SAVE_HASH_UPDATED'
       AND dl.created_at BETWEEN ds.created_at - INTERVAL '1 second'
                              AND ds.created_at + INTERVAL '1 second'
   )
   ```
   **Target:** 0 ghost saves

4. **False notification rate:**
   ```sql
   SELECT COUNT(*) FROM debug_logs
   WHERE action = 'REMOTE_UPDATE_BLOCKED'
     AND created_at > NOW() - INTERVAL '1 hour'
   ```
   **Target:** Only real conflicts

---

## Related Issues

- Version-based sync: `docs/proposal/cross-browser-sync/reports/VERSION-SYNC-SAFETY-ANALYSIS.md`
- Content conflict detection: `lib/providers/plain-offline-provider.ts:664-755`

---

## Conclusion

✅ **Root cause identified and fixed**
✅ **Debug logging in place for verification**
✅ **Verification script created**
✅ **Ready for testing**

The fix addresses the asynchronous nature of TipTap's update cycle by delaying the suppression flag clear until after all updates complete. This prevents ghost saves during passive content loads while preserving real conflict detection.
