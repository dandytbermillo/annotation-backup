# Implementation Plan: Fix Dashboard Panel Refresh on Pin/Unpin

**Feature Slug:** `entry_dashboard_pin_fix`
**Created:** 2024-12-10
**Status:** Planning

---

## 1. Problem Statement

### Symptoms
When a user clicks the pin/unpin button on the dashboard:
1. **Dashboard panels refresh/reload** instead of maintaining their current state
2. **View mode resets to 'dashboard'** even if the user was in workspace view
3. Any unsaved panel state (scroll position, expanded sections, etc.) is lost

### User Impact
- Poor user experience - feels like the app is "resetting"
- Loss of context when user was working in a workspace
- Unnecessary network requests to reload panel data
- Breaks the mental model of "pinning preserves state"

---

## 2. Root Cause Analysis

### The Rendering Architecture Problem

In `DashboardInitializer.tsx`, there are **two separate rendering paths** for the active entry:

```tsx
// Path A: When active entry IS pinned
{pinnedEntries.map((pinnedEntry) => {
  const isActive = pinnedEntry.entryId === activeEntryId
  return (
    <div key={`pinned-${pinnedEntry.entryId}`}>
      <DashboardView ... />
    </div>
  )
})}

// Path B: When active entry is NOT pinned
{!isActiveEntryPinned && (
  <div>
    <DashboardView key={currentEntryInfo?.entryId} ... />
  </div>
)}
```

### What Happens on Pin/Unpin

| Action | Before | After | React Behavior |
|--------|--------|-------|----------------|
| **Pin** | Entry in Path B | Entry in Path A | Different tree position → **UNMOUNT + REMOUNT** |
| **Unpin** | Entry in Path A | Entry in Path B | Different tree position → **UNMOUNT + REMOUNT** |

### Why Remount Causes Issues

When `DashboardView` remounts:
1. `useState` initializes fresh → `panels = []`, `viewMode = 'dashboard'`
2. `useEffect` runs → `fetchPanels()` triggers API call
3. All component state is lost (scroll position, expanded items, etc.)

```tsx
// DashboardView.tsx
const [panels, setPanels] = useState<WorkspacePanel[]>([])  // Resets to empty
const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode)  // Resets to 'dashboard'

useEffect(() => {
  fetchPanels()  // Refetches on mount
}, [fetchPanels])
```

---

## 3. Proposed Solution: Unified Render List

### Core Concept

Instead of two separate rendering paths, build a **single unified array** of entries to render, then map over it once. This ensures:
- Consistent React keys (`entry-${entryId}`)
- Same position in React tree regardless of pin status
- No unmount/remount when pin status changes

### Architecture Diagram

```
BEFORE (Two Paths):
┌─────────────────────────────────────────────────────┐
│  pinnedEntries.map()                                │
│  ┌─────────┐  ┌─────────┐                           │
│  │ Entry B │  │ Entry C │  (pinned, hidden)         │
│  └─────────┘  └─────────┘                           │
├─────────────────────────────────────────────────────┤
│  {!isActiveEntryPinned && ...}                      │
│  ┌─────────────────────┐                            │
│  │      Entry A        │  (active, not pinned)      │
│  └─────────────────────┘                            │
└─────────────────────────────────────────────────────┘
         ↓ When Entry A gets pinned, it MOVES ↓

AFTER (Unified List):
┌─────────────────────────────────────────────────────┐
│  entriesToRender.map()                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐              │
│  │ Entry A │  │ Entry B │  │ Entry C │              │
│  │(visible)│  │(hidden) │  │(hidden) │              │
│  │ active  │  │ pinned  │  │ pinned  │              │
│  └─────────┘  └─────────┘  └─────────┘              │
└─────────────────────────────────────────────────────┘
         ↓ When Entry A gets pinned, it STAYS ↓
         (only isPinned flag changes, no move)
```

### Benefits

| Scenario | Behavior | State Preserved |
|----------|----------|-----------------|
| Pin active entry | Entry stays in map, key unchanged | ✅ Yes |
| Unpin active entry | Entry stays in map, key unchanged | ✅ Yes |
| Switch to pinned entry | Toggle visibility only | ✅ Yes |
| Switch to unpinned entry | New entry added to map | N/A (new entry) |

---

## 4. Implementation Steps

### Step 1: Define RenderEntry Type

Add a type to represent entries in the unified render list:

```tsx
// In DashboardInitializer.tsx
type RenderEntry = {
  entryId: string
  entryName: string
  dashboardWorkspaceId: string
  pinnedWorkspaceIds: string[]
  isPinned: boolean  // Track pin status for potential UI indicators
}
```

### Step 2: Build Unified Render List

Replace the two-path rendering with a single list:

```tsx
// Build unified render list
const entriesToRender: RenderEntry[] = []

// Add all pinned entries
for (const pinnedEntry of pinnedEntries) {
  entriesToRender.push({
    entryId: pinnedEntry.entryId,
    entryName: pinnedEntry.entryName,
    dashboardWorkspaceId: pinnedEntry.dashboardWorkspaceId,
    pinnedWorkspaceIds: pinnedEntry.pinnedWorkspaceIds,
    isPinned: true,
  })
}

// Add active entry if not already in list (unpinned active entry)
const isActiveEntryInList = entriesToRender.some(e => e.entryId === activeEntryId)
if (!isActiveEntryInList && activeEntryId && currentDashboardWorkspaceId) {
  entriesToRender.push({
    entryId: activeEntryId,
    entryName: currentEntryInfo?.entryName ?? '',
    dashboardWorkspaceId: currentDashboardWorkspaceId,
    pinnedWorkspaceIds: [],
    isPinned: false,
  })
}
```

### Step 3: Single Map Rendering

Replace both rendering paths with a single map:

```tsx
return (
  <div className="relative w-screen h-screen">
    {entriesToRender.map((entry) => {
      const isActive = entry.entryId === activeEntryId

      return (
        <div
          key={`entry-${entry.entryId}`}  // Consistent key format
          className="absolute inset-0"
          style={{
            visibility: isActive ? 'visible' : 'hidden',
            pointerEvents: isActive ? 'auto' : 'none',
            zIndex: isActive ? 10 : 0,
          }}
          aria-hidden={!isActive}
        >
          <DashboardView
            workspaceId={entry.dashboardWorkspaceId}
            onNavigate={handleDashboardNavigate}
            entryId={entry.entryId}
            entryName={entry.entryName}
            homeEntryId={dashboardInfo?.homeEntryId}
            className="w-full h-full"
            onViewModeChange={handleViewModeChange}
            initialViewMode={isActive ? initialViewMode : 'dashboard'}
            initialActiveWorkspaceId={isActive ? initialActiveWorkspaceId : undefined}
            pinnedWorkspaceIds={entry.pinnedWorkspaceIds}
            isEntryActive={isActive}
          />
        </div>
      )
    })}
  </div>
)
```

### Step 4: Remove Old Rendering Path

Delete the `{!isActiveEntryPinned && (...)}` block entirely - it's no longer needed.

### Step 5: Update Debug Logging

Update debug logs to reflect the new architecture:

```tsx
void debugLog({
  component: "DashboardInitializer",
  action: "render_unified_list",
  metadata: {
    activeEntryId,
    entriesToRenderCount: entriesToRender.length,
    pinnedCount: pinnedEntries.length,
    isActiveEntryPinned,
    renderIds: entriesToRender.map(e => e.entryId),
  },
})
```

---

## 5. Files to Modify

| File | Changes |
|------|---------|
| `components/dashboard/DashboardInitializer.tsx` | Main fix - unified render list |

### Lines of Interest in DashboardInitializer.tsx

- **Lines 461-562**: Current two-path rendering logic (to be replaced)
- **Line 466**: `isActiveEntryPinned` check
- **Lines 494-540**: `pinnedEntries.map()` block
- **Lines 544-558**: `{!isActiveEntryPinned && ...}` block (to be removed)

---

## 6. Testing Plan

### Manual Testing Checklist

#### Test Case 1: Pin Active Entry (Dashboard View)
- [ ] Navigate to an entry's dashboard
- [ ] Verify panels are loaded
- [ ] Click pin button
- [ ] **Expected**: Panels remain, no loading spinner, no refetch

#### Test Case 2: Pin Active Entry (Workspace View)
- [ ] Navigate to an entry's workspace (click a workspace in dropdown)
- [ ] Verify you're in workspace view (not dashboard)
- [ ] Click pin button
- [ ] **Expected**: Stay in workspace view, panels don't refresh

#### Test Case 3: Unpin Active Entry (Dashboard View)
- [ ] Pin an entry first
- [ ] Verify panels are loaded
- [ ] Click unpin button
- [ ] **Expected**: Panels remain, no loading spinner, no refetch

#### Test Case 4: Unpin Active Entry (Workspace View)
- [ ] Pin an entry, then navigate to a workspace
- [ ] Click unpin button
- [ ] **Expected**: Stay in workspace view, panels don't refresh

#### Test Case 5: Switch Between Pinned Entries
- [ ] Pin Entry A and Entry B
- [ ] View Entry A
- [ ] Switch to Entry B
- [ ] **Expected**: Entry B's state is preserved (if previously loaded)
- [ ] Switch back to Entry A
- [ ] **Expected**: Entry A's state is preserved

#### Test Case 6: Panel Interactions Preserved
- [ ] Load dashboard with panels
- [ ] Interact with a panel (expand a section, scroll, etc.)
- [ ] Pin/unpin the entry
- [ ] **Expected**: Panel interaction state preserved

### Debug Log Verification

Query debug logs to verify no panel refetch on pin/unpin:

```sql
SELECT component, action, metadata, created_at
FROM debug_logs
WHERE component IN ('DashboardView', 'DashboardInitializer', 'PinnedEntryManager')
  AND created_at > NOW() - INTERVAL '5 minutes'
ORDER BY created_at DESC
LIMIT 50;
```

**Expected**: No `panels_loaded` action immediately after `entry_pinned` or `entry_unpinned`.

---

## 7. Acceptance Criteria

- [ ] Clicking pin/unpin does NOT cause dashboard panels to refresh
- [ ] Clicking pin/unpin does NOT reset view mode (workspace → dashboard)
- [ ] Switching between pinned entries preserves each entry's state
- [ ] TypeScript compilation passes (`npm run type-check`)
- [ ] No console errors related to React keys or unmounting
- [ ] Debug logs show unified render list behavior

---

## 8. Rollback Plan

If issues arise, revert the changes to `DashboardInitializer.tsx`:

```bash
git checkout HEAD~1 -- components/dashboard/DashboardInitializer.tsx
```

The original two-path rendering will be restored.

---

## 9. Future Considerations

### Potential Optimizations

1. **Lazy mounting**: Only mount DashboardView when entry is first visited
2. **Unload stale entries**: Remove unpinned entries from render list after timeout
3. **Memory management**: Monitor memory usage with many pinned entries

### Related Issues

- The floating toolbar fix (completed) used a similar pattern for `CanvasAwareFloatingToolbar`
- Consider applying unified render list pattern to other components with similar issues

---

## 10. References

- `components/dashboard/DashboardInitializer.tsx` - Main file to modify
- `components/dashboard/DashboardView.tsx` - Component being remounted
- `lib/navigation/pinned-entry-manager.ts` - Pin state management
- `lib/navigation/use-pinned-entries.ts` - React hooks for pin state
- `docs/proposal/components/workspace/dashboard/fixed/2024-12-09-floating-toolbar-note-button-fix.md` - Similar fix pattern
