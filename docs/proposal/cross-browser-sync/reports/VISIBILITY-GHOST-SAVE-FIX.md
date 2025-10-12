# Visibility Ghost Save Fix - Implementation

**Date:** 2025-10-11
**Issue:** False conflict notifications when switching browsers after opening panel
**Root Cause:** Visibility change event triggers ghost saves even when no editing occurred

---

## Problem Statement

### User Workflow That Triggers Bug

1. **Chrome:** User edits document and saves (version 1)
2. **Firefox:** User switches to Firefox and opens the same main panel (just viewing, no editing)
3. **Chrome:** User switches back to Chrome
4. **Bug:** Firefox tab becomes hidden → saves current content as version 2 (ghost save)
5. **Chrome:** User types ONE character
6. **Result:** False notification appears: "⚠️ Remote changes available"

### Timeline of Events (from debug logs)

```
17:38:00.498 - LOAD_CONTENT_SUPPRESSION_START (Firefox opens panel)
17:38:00.502 - LOAD_CONTENT_SUPPRESSION_END (suppression works!)
17:38:00.502 - LOAD_HASH_INITIALIZED (Hash: -rrhtjm)

17:38:03 - [HIDDEN] Firefox tab becomes hidden (user switches to Chrome)
17:38:03 - [DATABASE] Version 2 created (GHOST SAVE) ❌
17:38:03.577 - VISIBILITY_REFRESH (Chrome visible)
17:38:03.594 - PROVIDER_SKIP_IDENTICAL (version 1)

17:38:05.460 - USER_EDIT_FLAG_SET (Chrome user types)
17:38:05.875 - REMOTE_UPDATE_RECEIVED (version 2 detected)
17:38:05.877 - REMOTE_UPDATE_BLOCKED → FALSE NOTIFICATION ⚠️
```

---

## Root Cause Analysis

### The Visibility Save Mechanism

In `tiptap-editor-plain.tsx`, there's a visibility change handler that saves content when the tab becomes hidden:

**Before fix (lines 2148-2152):**

```typescript
const handleVisibilityChange = async () => {
  if (document.visibilityState === 'hidden') {
    saveCurrentContent(false) // async save
  } else if (document.visibilityState === 'visible' && provider) {
```

**The Problem:**

When Firefox tab becomes hidden (user switches to Chrome), this handler fires and **ALWAYS saves the current content**, even if:
- User never edited anything
- Content is identical to what was already saved
- Panel was just opened for viewing

This creates a "ghost save" that increments the version number without any actual user changes.

### Why Branch Panels Don't Have This Issue

From user's observation: "why the branch panel is not experience that"

Branch panels work correctly because users typically don't switch browsers as quickly after opening them. The issue only manifests when:
1. Panel is opened in Browser A
2. User immediately switches to Browser B (< 3 seconds)
3. Browser A's tab becomes hidden
4. Ghost save occurs

---

## The Fix

### Changes Made

**File:** `components/canvas/tiptap-editor-plain.tsx`

#### 1. Visibility Change Handler (lines 2148-2167)

```typescript
const handleVisibilityChange = async () => {
  if (document.visibilityState === 'hidden') {
    // CRITICAL: Only save if there are actual unsaved changes
    // This prevents ghost saves when just viewing (no edits)
    if (hasUnsavedChanges()) {
      debugLog({
        component: 'CrossBrowserSync',
        action: 'VISIBILITY_SAVE_TRIGGERED',
        metadata: { noteId, panelId, reason: 'unsaved_changes_exist' }
      })
      saveCurrentContent(false) // async save
    } else {
      debugLog({
        component: 'CrossBrowserSync',
        action: 'VISIBILITY_SAVE_SKIPPED',
        metadata: { noteId, panelId, reason: 'no_unsaved_changes' }
      })
    }
  } else if (document.visibilityState === 'visible' && provider) {
```

#### 2. Before Unload Handler (lines 2200-2218)

```typescript
const handleBeforeUnload = () => {
  // CRITICAL: Only save if there are actual unsaved changes
  // This prevents ghost saves when just viewing (no edits)
  if (hasUnsavedChanges()) {
    debugLog({
      component: 'CrossBrowserSync',
      action: 'BEFOREUNLOAD_SAVE_TRIGGERED',
      metadata: { noteId, panelId, reason: 'unsaved_changes_exist' }
    })
    saveCurrentContent(true) // sync localStorage save
  } else {
    debugLog({
      component: 'CrossBrowserSync',
      action: 'BEFOREUNLOAD_SAVE_SKIPPED',
      metadata: { noteId, panelId, reason: 'no_unsaved_changes' }
    })
  }
}
```

#### 3. Updated Dependency Array (line 2227)

```typescript
}, [editor, provider, noteId, panelId, hasUnsavedChanges])
```

Added `hasUnsavedChanges` to the dependency array since it's now used in the effect.

---

## How It Works

### The `hasUnsavedChanges()` Function

This function compares the current editor content with the last saved content using content hashing:

```typescript
const hasUnsavedChanges = useCallback((): boolean => {
  if (!editor) return false

  const currentDoc = editor.getJSON()
  const currentCanonized = canonizeDoc(currentDoc, editor)
  if (!currentCanonized) return false

  const currentHash = hashContent(currentCanonized)
  const savedHash = lastSavedHashRef.current

  // If tracking not initialized, check if user has actually typed
  if (!savedHash || savedHash === '') {
    if (hasUserEditedRef.current) {
      return true  // User typed before tracking initialized - PROTECT their work
    }
    return false  // No tracking and no edits = no unsaved changes
  }

  const hasChanges = currentHash !== savedHash

  debugLog({
    component: 'CrossBrowserSync',
    action: 'HAS_UNSAVED_CHECK',
    metadata: {
      noteId,
      panelId,
      hasUserEdited: hasUserEditedRef.current,
      currentHash: currentHash.slice(0, 7),
      savedHash: savedHash.slice(0, 7),
      hasChanges
    }
  })

  return hasChanges
}, [editor, noteId, panelId])
```

### Detection Logic

The fix uses TWO safety checks:

1. **Content Hash Comparison:** Compares current content hash with last saved hash
2. **User Edit Flag:** Checks if `hasUserEditedRef.current` is true

**Result:**
- ✅ If user edited → `hasUnsavedChanges()` returns `true` → Save happens
- ✅ If just viewing → `hasUnsavedChanges()` returns `false` → Save skipped
- ✅ If user typed before tracking initialized → Save happens (protects user work)

---

## Debug Logging

### New Debug Events

1. **VISIBILITY_SAVE_TRIGGERED**
   - Logged when visibility save proceeds
   - Metadata: `{ noteId, panelId, reason: 'unsaved_changes_exist' }`

2. **VISIBILITY_SAVE_SKIPPED**
   - Logged when visibility save is skipped
   - Metadata: `{ noteId, panelId, reason: 'no_unsaved_changes' }`

3. **BEFOREUNLOAD_SAVE_TRIGGERED**
   - Logged when beforeunload save proceeds
   - Metadata: `{ noteId, panelId, reason: 'unsaved_changes_exist' }`

4. **BEFOREUNLOAD_SAVE_SKIPPED**
   - Logged when beforeunload save is skipped
   - Metadata: `{ noteId, panelId, reason: 'no_unsaved_changes' }`

---

## Verification

### Script: `scripts/verify-visibility-fix.js`

Run this script to verify the fix is working:

```bash
node scripts/verify-visibility-fix.js
```

**Checks:**

1. ✅ Finds last panel load event
2. ✅ Checks for `VISIBILITY_SAVE_TRIGGERED` or `VISIBILITY_SAVE_SKIPPED` events
3. ✅ Verifies no ghost saves (database saves without corresponding debug events)
4. ✅ Checks for false notifications after panel load

### Expected Output (After Fix)

```
✅ Fix is working! Visibility events after load:
  ✅ [VISIBILITY_SAVE_SKIPPED]
     Time: +3000ms after load
     Reason: no_unsaved_changes

✅ NO GHOST SAVES: No database saves within 10 seconds of load

✅ No notifications after this load
```

---

## Testing Instructions

### Manual Test

1. **Chrome:** Open a note and type "test document"
2. **Chrome:** Wait for auto-save (300ms)
3. **Firefox:** Open Firefox and navigate to the same note
4. **Firefox:** Open the main panel (same note_id)
5. **Chrome:** Immediately switch back to Chrome (< 3 seconds)
6. **Chrome:** Type ONE character
7. **Expected:** ✅ NO notification should appear

### Debug Log Verification

After reproducing the workflow:

```bash
node scripts/verify-visibility-fix.js
```

**Expected sequence:**

```
LOAD_CONTENT_SUPPRESSION_START
LOAD_CONTENT_SUPPRESSION_END
LOAD_HASH_INITIALIZED
  ↓ (User switches browsers)
VISIBILITY_SAVE_SKIPPED (NEW!) ✅
  ↓ (No save to database)
VISIBILITY_REFRESH (Chrome visible)
PROVIDER_SKIP_IDENTICAL (no version change)
  ↓ (User types)
USER_EDIT_FLAG_SET
  ↓ (Normal save from user edit)
SAVE_HASH_UPDATED
```

**Before fix (incorrect):**

```
LOAD_CONTENT_SUPPRESSION_START
LOAD_CONTENT_SUPPRESSION_END
  ↓ (User switches browsers)
[DATABASE] Ghost save creates version 2 ❌
VISIBILITY_REFRESH
PROVIDER_EMIT_REMOTE_UPDATE (detects version bump)
USER_EDIT_FLAG_SET (user types)
REMOTE_UPDATE_BLOCKED → NOTIFICATION ⚠️
```

---

## Impact

### Before Fix

- **Problem:** Every browser switch after opening panel created ghost saves
- **Result:** False "Remote changes available" notifications
- **User Experience:** Confusing and disruptive

### After Fix

- **Problem:** Eliminated ghost saves from visibility changes
- **Result:** No false notifications when just viewing content
- **User Experience:** Smooth cross-browser editing
- **Data Safety:** User edits are still protected (if `hasUserEditedRef.current` is true, save happens)

### Real Conflicts Still Detected

- If Firefox user ACTUALLY EDITS the content → save happens → version bump
- Chrome detects real conflict → notification shown ✅
- This is correct behavior

---

## Related Fixes

This fix builds upon:

1. **RAF Suppression Fix:** `docs/proposal/cross-browser-sync/reports/GHOST-SAVE-FIX-FINAL.md`
   - Fixed ghost saves during initial panel load
   - This fix addresses ghost saves during visibility changes

2. **Version-Based Sync:** `lib/providers/plain-offline-provider.ts:780-850`
   - Uses version numbers instead of content comparison
   - Ensures cache consistency across browsers

---

## Rollback Plan

If issues occur:

```typescript
// Remove the hasUnsavedChanges() check, restore immediate save
const handleVisibilityChange = async () => {
  if (document.visibilityState === 'hidden') {
    saveCurrentContent(false) // Immediate save without check
  } else if (document.visibilityState === 'visible' && provider) {
```

**Risk:** Ghost saves return, false notifications resume

---

## Monitoring

### Key Metrics (from debug_logs)

1. **VISIBILITY_SAVE_SKIPPED count** - Should increase after fix
2. **VISIBILITY_SAVE_TRIGGERED count** - Should only occur when user actually edited
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

## Conclusion

✅ **Root cause identified and fixed**
✅ **Debug logging in place for verification**
✅ **Verification script created**
✅ **Ready for testing**

The fix addresses ghost saves that occur when tabs become hidden by only saving if there are actual unsaved changes. This prevents false notifications while preserving data safety for real edits.
