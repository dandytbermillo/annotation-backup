# Fix: Revision Recovery on Entry Switch

**Date:** 2025-12-17
**Status:** Implemented and verified
**Related Files:**
- `lib/hooks/annotation/use-note-workspaces.ts:619-655`
- `lib/adapters/note-workspace-adapter.ts:74-91` (If-Match header handling)

---

## Problem

When switching entries (annotation -> home -> annotation), workspace persist operations failed with HTTP 412 (Precondition Failed).

**Symptoms:**
- "Workspace save failed" toast appearing after entry switching
- HTTP 412 errors in network tab
- Eviction blocked, potentially leading to degraded mode

**Root Cause:**
1. Entry switch causes component unmount/remount (depends on pinned entries feature - hidden vs remounted)
2. React refs (including `workspaceRevisionRef`) reset to empty Maps on remount
3. Dirty state can exist even when revision ref is empty (store-backed state may survive, ref-backed state resets)
4. When eviction triggers and calls `persistWorkspaceSnapshot`:
   - `workspaceRevisionRef.current.get(workspaceId)` returns `undefined` -> empty string `""`
   - `saveWorkspace` sends empty `If-Match` header
   - Server returns 412 Precondition Failed (revision mismatch)
5. Persist fails -> eviction blocked -> toast appears

**Note:** Whether dirty state persists across entry switches depends on whether the entry is truly remounted vs hidden (pinned entries feature) and whether state is store-backed vs ref-backed.

---

## Solution

When revision is unknown (empty string), load it from the workspace record before attempting to save.

```typescript
// lib/hooks/annotation/use-note-workspaces.ts:619-655
if (revisionToUse === "") {
  try {
    const currentRecord = await adapterRef.current.loadWorkspace(workspaceId)
    revisionToUse = currentRecord.revision ?? ""
    workspaceRevisionRef.current.set(workspaceId, revisionToUse)
    // ... logging
  } catch (loadError) {
    const errorMessage = loadError instanceof Error ? loadError.message : String(loadError)

    // Handle 404 - workspace doesn't exist in DB
    if (errorMessage.includes("404")) {
      // Safe to skip persist - nothing to persist
      return true
    }

    // Other errors - block eviction (network issue, etc.)
    return false
  }
}
```

**Key behaviors:**
| Scenario | Action | Result |
|----------|--------|--------|
| Revision unknown, load succeeds, local has data | Use loaded revision | Save proceeds normally |
| Revision unknown, load succeeds, local emptier than DB | Skip save, return `true` | Eviction proceeds, DB preserved |
| Revision unknown, workspace 404 | Skip persist, return `true` | Eviction proceeds (nothing to persist) |
| Revision unknown, load fails (network) | Return `false` | Eviction blocked (safe) |

---

## Data Loss Prevention Guard (Added 2025-12-17)

**Problem discovered during testing:** When we load workspace to get revision, our local snapshot might be stale/empty (due to remount). Saving empty local data with valid revision would **overwrite** the good DB data.

**Solution:** Compare local payload with DB payload before saving:

```typescript
// If local snapshot is emptier than DB, skip save (stale data after remount)
const localIsEmptier = (
  (localPanelCount === 0 && dbPanelCount > 0) ||
  (localOpenNotesCount === 0 && dbOpenNotesCount > 0) ||
  (localComponentCount === 0 && dbComponentCount > 0)
)

if (localIsEmptier) {
  // Return true - DB has better data, skip save, safe to evict
  return true
}
```

**Debug event:** `save_skip_local_emptier_than_db`

**Limitations of this guard:**
- Only catches **zero vs non-zero** cases (e.g., local panels=0, DB panels>0)
- Does NOT catch partial staleness (e.g., local has 2 panels, DB has 5 panels)
- Does NOT catch content differences (local has different data but same count)
- This is a guardrail for the **remount-empty** case, not a complete "no stale overwrite" solution

---

## Why This Is Safe

1. **Loading revision adds a round-trip but ensures correctness** - We get the actual current revision from DB before attempting optimistic concurrency update.

2. **404 handling is safe** - If workspace doesn't exist in DB (placeholder, deleted), there's nothing to persist. Returning `true` allows eviction.

3. **Network errors block eviction** - If we can't load the workspace due to network issues, we can't safely proceed. Returning `false` blocks eviction and protects data.

4. **Revision is cached** - After loading, we cache it in `workspaceRevisionRef` for future saves in this session.

---

## Evidence of Fix

**Before fix:**
```
revisionIsEmpty: true
allKnownRevisions: []
Error: "Failed to save workspace: 412"
```

**After fix:**
```
revisionIsEmpty: false
revisionToUse: "3645abbd-3c2a-433d-beb1-6be0aa94aa..."
allKnownRevisions: (6) [...]
// No 412 error
```

---

## Alternative Approaches Considered

1. **Skip persist when revision unknown, return `true`** - REJECTED: Could cause silent data loss if user made real changes before hydration completed.

2. **Block eviction with "revision unknown" reason** - Valid alternative, but adds another toast message. Loading revision is cleaner.

3. **Store revision in component store (persists across remounts)** - Larger refactor, not necessary for this fix.

4. **Clear dirty flag after hydration** - Doesn't address the real issue (revision needed for save).

---

## Test Verification

1. Start timer in default workspace
2. Switch entries multiple times (annotation -> home -> annotation)
3. Continue switching workspaces
4. **Expected:** No "Workspace save failed" toast, no degraded mode banner
5. **Observed:** Timer state preserved, workspace switching works correctly

The "Workspace has running operations" toast may still appear - this is expected behavior for workspaces with active timers being protected from eviction.
