# Debug Logging Spam and Canvas Hydration Loop Fix

**Date:** 2025-12-13
**Status:** Implemented
**Related Issue:** Infinite terminal logging when pinned entry is hidden

---

## Problem Summary

After implementing the workspace component state persistence fix (025-12-12), two issues emerged:

1. **Non-stop `POST /api/debug/log` requests** flooding the terminal (~40+ requests/second)
2. **Non-stop `GET /api/canvas/layout/{noteId}` requests** when a pinned entry was hidden

These issues caused:
- Terminal becoming unresponsive due to log flood
- 2.5GB+ `logs/debug.log` file growth
- Unnecessary server load from continuous API calls
- Poor developer experience

---

## Root Cause Analysis

### Issue 1: Debug Logging Spam

**Root Cause:** The debug logger had hardcoded returns that bypassed all filtering:

```typescript
// lib/utils/debug-logger.ts (BEFORE)
export const isDebugEnabled = () => true;  // Line 63 - Always enabled!
const shouldEmitDebugLog = () => true;     // Line 69 - No filtering!
```

Combined with:
- `.env.local` had `NEXT_PUBLIC_DEBUG_LOGGING=true`
- Hot-path callers in `use-canvas-items.ts` emitting debug logs on every state change
- No rate limiting on debug log emission

### Issue 2: Canvas Layout Fetch Loop

**Root Cause:** When a pinned entry was hidden, the canvas component remained mounted but continued running hydration effects:

```typescript
// multi-workspace-canvas-container.tsx
// Hidden canvases were still calling useCanvasHydration with enabled=true
<AnnotationWorkspaceCanvas
  noteIds={runtime.openNotes.map((n) => n.noteId)}
  // No prop to indicate canvas is hidden!
/>
```

The hydration hooks (`useCanvasHydration`, `useNonMainPanelHydration`) used `enabled: hasNotes` which was always `true` for pinned workspaces with notes.

### Issue 3: All Workspaces Persisting on Entry Switch

**Root Cause:** The `handleEntryChange` function flushed ALL dirty workspaces, not just those belonging to the previous entry:

```typescript
// use-workspace-persistence.ts (BEFORE)
if (previousEntryId && workspaceDirtyRef.current.size > 0) {
  flushPendingSave("entry_switch")  // Flushes ALL dirty workspaces!
}
```

---

## Fixes Applied

### Fix 1: Debug Logger Defaults and Rate Limiting

**File:** `lib/utils/debug-logger.ts`

```typescript
// BEFORE
export const isDebugEnabled = () => true;
const shouldEmitDebugLog = () => true;

// AFTER
const DEFAULT_DEBUG_LOGGING_ENABLED = (() => {
  const envOverride = parseOverride(process.env.NEXT_PUBLIC_DEBUG_LOGGING);
  return envOverride ?? false;  // Default OFF
})();

export const isDebugEnabled = () => {
  // Check cached preference with 1s cache
  const now = Date.now();
  if (now - lastPreferenceCheck > RUNTIME_PREF_CACHE_MS) {
    cachedPreference = computeRuntimePreference();
    lastPreferenceCheck = now;
  }
  return cachedPreference;
};

const shouldEmitDebugLog = () => {
  if (typeof window === 'undefined') return false;
  if (!isDebugEnabled()) return false;

  // Rate limiting: max 40 logs/second
  const now = Date.now();
  if (now - rateWindowStart >= RATE_LIMIT_INTERVAL_MS) {
    rateWindowStart = now;
    rateWindowCount = 0;
  }
  rateWindowCount += 1;
  if (rateWindowCount > RATE_LIMIT_MAX) return false;

  return true;
};
```

### Fix 2: Debug Log File Write Guard

**File:** `app/api/debug/log/route.ts`

```typescript
const SHOULD_APPEND_DEBUG_LOG_FILE = process.env.DEBUG_LOG_TO_FILE === 'true'

// Only write to file if explicitly enabled
if (SHOULD_APPEND_DEBUG_LOG_FILE) {
  await appendFileSafe({ ... })
}
```

### Fix 3: Gate Hot-Path Debug Calls

**File:** `lib/hooks/annotation/use-canvas-items.ts`

```typescript
const setCanvasItems = useCallback((update) => {
  const debugEnabled = isDebugEnabled()  // Check once per call

  // Only compute stack trace if debug enabled
  const caller = (() => {
    if (!debugEnabled) return "unknown"
    const stack = new Error().stack
    return stack?.split("\n").slice(2, 4).join(" | ") || "unknown"
  })()

  // Gate all debug calls
  if (debugEnabled) {
    debugLog({ ... })
  }
}, [...])
```

### Fix 4: Canvas Hidden Prop for Hydration Control

**Files:**
- `components/workspace/multi-workspace-canvas-container.tsx`
- `components/workspace/annotation-workspace-canvas.tsx`
- `components/annotation-canvas-modern.tsx`

```typescript
// multi-workspace-canvas-container.tsx
<AnnotationWorkspaceCanvas
  isCanvasHidden={!runtime.isActive}  // NEW: Tell canvas it's hidden
  {...props}
/>

// annotation-canvas-modern.tsx
const primaryHydrationStatus = useCanvasHydration({
  noteId,
  enabled: Boolean(noteId) && !isCanvasHidden,  // Disable when hidden
  ...
})

useNonMainPanelHydration({
  enabled: hasNotes && !isCanvasHidden,  // Disable when hidden
  ...
})
```

### Fix 5: Entry-Scoped Workspace Flush

**File:** `lib/hooks/annotation/workspace/use-workspace-persistence.ts`

```typescript
// BEFORE: Flush ALL dirty workspaces
flushPendingSave("entry_switch")

// AFTER: Flush only workspaces belonging to the previous entry
const workspaceIdsForPreviousEntry = getWorkspacesForEntry(previousEntryId)
if (workspaceIdsForPreviousEntry.length > 0) {
  flushPendingSave("entry_switch", { workspaceIds: workspaceIdsForPreviousEntry })
} else {
  // Safety fallback: if tracking fails, flush all to prevent data loss
  flushPendingSave("entry_switch")
}
```

### Fix 6: Prevent Redundant Pinned Workspace Updates

**File:** `lib/workspace/runtime-manager.ts`

```typescript
export const updatePinnedWorkspaceIds = (ids: string[]): void => {
  // Early return if set unchanged
  const newSet = new Set(ids)
  if (
    newSet.size === pinnedWorkspaceIds.size &&
    ids.every((id) => pinnedWorkspaceIds.has(id))
  ) {
    return  // No change, skip update
  }
  // ... rest of function
}
```

### Fix 7: Hash Comparison for Pinned Entry Sync

**File:** `components/dashboard/DashboardInitializer.tsx`

```typescript
const pinnedHashRef = useRef<string | null>(null)

useEffect(() => {
  // ...
  const allPinnedWorkspaceIds = pinnedEntriesState.entries.flatMap(
    entry => entry.pinnedWorkspaceIds
  )

  // Hash comparison to prevent redundant updates
  const hash = allPinnedWorkspaceIds.slice().sort().join(',')
  if (pinnedHashRef.current === hash) {
    return  // No change, skip
  }
  pinnedHashRef.current = hash

  updatePinnedWorkspaceIds(allPinnedWorkspaceIds)
}, [pinnedEntriesEnabled, pinnedEntriesState])
```

### Fix 8: Environment Variable

**File:** `.env.local`

```bash
# Changed from true to false
NEXT_PUBLIC_DEBUG_LOGGING=false
```

---

## Files Modified

| File | Change Type |
|------|-------------|
| `lib/utils/debug-logger.ts` | Default OFF, rate limiting, proper checks |
| `app/api/debug/log/route.ts` | File write guard |
| `lib/hooks/annotation/use-canvas-items.ts` | Debug call gating |
| `lib/hooks/annotation/workspace/use-workspace-selection.ts` | Entry tracking on visibility |
| `lib/hooks/annotation/workspace/use-workspace-persistence.ts` | Entry-scoped flush with fallback |
| `lib/workspace/runtime-manager.ts` | Early return if unchanged |
| `components/dashboard/DashboardInitializer.tsx` | Hash comparison |
| `components/workspace/multi-workspace-canvas-container.tsx` | `isCanvasHidden` prop |
| `components/workspace/annotation-workspace-canvas.tsx` | Pass through `isCanvasHidden` |
| `components/annotation-canvas-modern.tsx` | Use `isCanvasHidden` in hydration |
| `.env.local` | `NEXT_PUBLIC_DEBUG_LOGGING=false` |

---

## Safety Analysis

### Definitely Safe (No Risk)
- Debug logger changes - only affects logging
- Debug log route file write guard - only affects file I/O
- Canvas items debug gating - only affects logging
- Runtime manager early return - pure optimization
- DashboardInitializer hash comparison - pure optimization

### Safe with Fallbacks
- **Entry-scoped flush**: Falls back to flushing ALL dirty workspaces if entry-workspace tracking returns empty, preventing data loss
- **Canvas hidden hydration**: Hydration resumes when canvas becomes visible (effect re-runs when `enabled` changes from false to true)

---

## Testing Checklist

- [ ] Pin an entry with a workspace containing a timer component
- [ ] Switch to Home or another entry
- [ ] Verify terminal is NOT flooded with `POST /api/debug/log` requests
- [ ] Verify terminal is NOT flooded with `GET /api/canvas/layout/` requests
- [ ] Switch back to the pinned entry
- [ ] Verify timer component state is preserved
- [ ] Verify workspace data is persisted correctly

---

## How to Re-Enable Debug Logging (When Needed)

Option 1: Environment variable
```bash
# In .env.local
NEXT_PUBLIC_DEBUG_LOGGING=true
```

Option 2: Browser console
```javascript
window.__ANNOTATION_DEBUG_LOGGING_OVERRIDE = true
```

Option 3: localStorage
```javascript
localStorage.setItem('annotation:debug-logging', 'true')
```

---

## Related Documents

- `025-12-12-workspace-component-state-persistence-fix.md` - Original persistence fix
- `2025-12-13-cleanup-debug-logging-and-entry-switch.patch` - Patch file with detailed diffs
