# Double Reload Issue - Root Cause Analysis

## Executive Summary
The double reload issue occurs when localStorage restore logic overwrites freshly loaded database content with stale backup data.

## The Problem
Users report: After editing content and staying on the page, the first reload shows old content, but the second reload shows the correct content.

## Root Cause

### The Critical Bug
The bug is in `tiptap-editor-plain.tsx` line 234:
```typescript
provider.saveDocument(noteId, panelId, pendingContent, false, { skipBatching: true })
```

This line **unconditionally saves localStorage content back to the provider**, overwriting the cache even when the provider has just loaded fresh content from the database.

### Why This Happens

1. **localStorage is updated on visibility changes** (lines 663-674), not on every save
   - When you switch tabs or minimize the window, current content is backed up
   - This backup persists until explicitly cleared

2. **The problematic sequence:**
   - User makes an edit at 10:00 AM
   - User switches tabs at 9:55 AM (creates localStorage backup with content from 9:55)
   - User returns and continues editing
   - Save completes to database (10:00 AM content)
   - User stays on page (no new visibility change, localStorage still has 9:55 content)
   - User reloads page

3. **On first reload:**
   - Provider loads fresh 10:00 AM content from database
   - Provider caches this content
   - localStorage restore checks find the 9:55 AM backup
   - **BUG**: Even though provider has content, the restore still calls `saveDocument`
   - This overwrites the cache with old 9:55 AM content
   - User sees old content

4. **On second reload:**
   - localStorage was cleared during first reload
   - Only database content loads (10:00 AM content)
   - User sees correct content

## The Flawed Logic

The localStorage restore logic (lines 206-259) has a critical flaw:

```typescript
// Line 218-219: Check provider state
const existingDoc = provider.getDocument(noteId, panelId)
const existingVersion = provider.getDocumentVersion(noteId, panelId)

// Line 230: Condition for restore
if (age < 5 * 60 * 1000 && !providerHasContent && existingVersion === 0) {
  // Line 234: ALWAYS saves to provider, overwriting cache!
  provider.saveDocument(noteId, panelId, pendingContent, false, { skipBatching: true })
}
```

The problem is that even when the provider HAS content (loaded from database), if the check passes, it still saves the localStorage content, overwriting the fresh data.

## Why The Check Can Pass When It Shouldn't

The check might pass incorrectly due to:
1. **Race condition**: The localStorage check runs in a separate useEffect that might fire before the provider cache is fully populated
2. **State synchronization**: The `isContentLoading` guard should prevent this, but there might be a timing window
3. **Cache key mismatch**: If there's any discrepancy in how the cache key is constructed

## Verification

The in-memory test at `/test-memory-reload` demonstrates this exact behavior:
1. Database has NEW content
2. localStorage has OLD backup
3. Provider loads NEW content and caches it
4. localStorage restore overwrites cache with OLD content
5. User sees OLD content on first reload

## Solution

The fix would be to:
1. **Never overwrite provider cache if it already has content**
2. **Only use localStorage for actual recovery scenarios** (when database is unavailable)
3. **Check content timestamps** before restoring to ensure localStorage is newer
4. **Clear localStorage on successful saves** instead of only on visibility changes