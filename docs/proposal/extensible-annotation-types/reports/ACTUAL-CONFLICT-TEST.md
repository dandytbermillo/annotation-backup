# Actual Conflict Reproduction Test - Phase 2

**Date**: 2025-10-10
**Status**: Testing dataStore update mechanism
**New Finding**: Branch panel title editing works across browsers, but content doesn't

---

## What We Know Now

### Working ✅
1. Main panel content syncs across browsers
2. Branch panel **title** editing syncs across browsers
3. Conflict detection works (409 errors appear)
4. Conflict listener fires and handler is called
5. Fresh content is fetched from database
6. onContentLoaded callback is called

### Not Working ❌
1. Branch panel **content** doesn't sync across browsers after conflicts
2. Editor visual update is inconsistent

---

## New Hypothesis: DataStore Update Not Persisting

Since title editing works but content editing doesn't, the issue might be:

1. Title updates go through a different path that properly updates localStorage
2. Content updates through conflict resolution might:
   - Update the dataStore in memory
   - But not trigger localStorage persistence
   - So when the other browser loads, it gets stale content from localStorage

---

## Test Procedure: Verify DataStore Update

### Step 1: Chrome - Create Conflict
1. Open Chrome, open a branch panel
2. Edit the content, type "Chrome edit 1"
3. Wait for autosave (watch for version increment in console)
4. Note the version number

### Step 2: Firefox - Create Conflict
1. Open Firefox, open the SAME branch panel
2. Edit immediately, type "Firefox edit 1"
3. You should see the conflict error
4. **Check console for these logs in sequence**:
   ```
   [🔍 PROVIDER-CONFLICT] Emitting document:conflict event
   [🔍 CONFLICT-RESOLUTION] *** HANDLER CALLED ***
   [🔍 CONFLICT-RESOLUTION] Handling conflict for {panelId}
   [🔍 CONFLICT-RESOLUTION] Updating editor with fresh content
   [🔍 CONFLICT-RESOLUTION] Calling onContentLoaded to update dataStore
   [🔍 DATASTORE-UPDATE] handleEditorContentLoaded called for {panelId}
   [🔍 DATASTORE-UPDATE] Updating dataStore for {panelId}
   ```

### Step 3: Verify Visual Update
1. **In Firefox**: Does the editor now show "Chrome edit 1"?
2. **In Firefox Console**: Check if all the above logs appeared
3. **In Firefox Console**: Run this command to check dataStore:
   ```javascript
   window.canvasDataStore.get('{panelId}').content
   ```
4. Does the dataStore content match what you see in the editor?

### Step 4: Check Persistence
1. **In Firefox**: Reload the page
2. Does the branch panel still show "Chrome edit 1"?
3. Or does it revert to "Firefox edit 1"?

---

## What to Share

Please share screenshots showing:

1. **Firefox console after conflict** - showing the full log sequence from `[🔍 PROVIDER-CONFLICT]` to `[🔍 DATASTORE-UPDATE]`
2. **Firefox editor content** - what you see in the editor after conflict
3. **Firefox console** - result of running `window.canvasDataStore.get('{panelId}').content`
4. **Firefox after reload** - what content shows after reloading the page

Replace `{panelId}` with the actual panel ID (like `branch_123`).

---

## Expected Behavior

If dataStore update is working:
- All logs should appear in sequence
- Editor should show "Chrome edit 1"
- dataStore should contain "Chrome edit 1"
- After reload, should still show "Chrome edit 1"

If dataStore update is NOT working:
- Logs might be missing (tells us where it breaks)
- Editor might show "Chrome edit 1" but dataStore shows "Firefox edit 1"
- After reload, reverts to "Firefox edit 1"

---

## Title vs Content Sync Difference

**Key Question**: Why does title sync work but content doesn't?

Title editing likely:
1. Updates dataStore directly via a setState or update call
2. Triggers localStorage persistence immediately
3. No conflict resolution needed (titles are simple strings)

Content editing with conflicts:
1. Goes through conflict resolution
2. Calls onContentLoaded → handleEditorContentLoaded → dataStore.update
3. Might not trigger localStorage persistence
4. Next page load reads stale localStorage

**Next Step After Testing**: If this hypothesis is confirmed, we need to ensure conflict resolution triggers localStorage persistence.
