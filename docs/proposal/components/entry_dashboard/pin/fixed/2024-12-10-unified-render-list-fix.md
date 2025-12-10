# Fix: Dashboard Panel Refresh on Pin/Unpin

**Date:** 2024-12-10
**Status:** Implemented
**File Modified:** `components/dashboard/DashboardInitializer.tsx`

---

## Problem

When clicking the pin/unpin button on the dashboard:
1. Dashboard panels would refresh (refetch from API)
2. View mode would reset to 'dashboard' even if user was in workspace view
3. All component state was lost (scroll position, expanded sections, etc.)

## Root Cause

The `DashboardInitializer` component had **two separate rendering paths** for the active entry:

```tsx
// Path A: When active entry IS pinned
{pinnedEntries.map((pinnedEntry) => (
  <div key={`pinned-${pinnedEntry.entryId}`}>
    <DashboardView ... />
  </div>
))}

// Path B: When active entry is NOT pinned
{!isActiveEntryPinned && (
  <div>
    <DashboardView key={entryId} ... />
  </div>
)}
```

When pin status changed, the entry moved between paths:
- Different keys (`pinned-${id}` vs `${id}`)
- Different positions in React tree

This caused React to **unmount the old DashboardView and mount a new one**, resetting all state.

## Solution

Implemented a **Unified Render List** approach:

1. Build a single array containing all entries to render (pinned + active)
2. Render through one `.map()` with consistent keys (`entry-${entryId}`)
3. When pin status changes, the entry stays in the same map with the same key

```tsx
// Build unified render list
const entriesToRender: RenderEntry[] = []

// Add all pinned entries
for (const pinnedEntry of pinnedEntries) {
  entriesToRender.push({ ...pinnedEntry, isPinned: true })
}

// Add active entry if not already pinned
if (!isActiveEntryPinned && activeEntryId) {
  entriesToRender.push({
    entryId: activeEntryId,
    dashboardWorkspaceId: currentDashboardWorkspaceId,
    isPinned: false,
  })
}

// Single map with consistent keys
{entriesToRender.map((entry) => (
  <div key={`entry-${entry.entryId}`}>
    <DashboardView ... />
  </div>
))}
```

## Key Changes

| Aspect | Before | After |
|--------|--------|-------|
| Render paths | 2 separate paths | 1 unified map |
| Key format | `pinned-${id}` / `${id}` | `entry-${id}` (consistent) |
| On pin/unpin | Component remounts | Component stays mounted |

## Benefits

1. **Panels don't refresh** - no state reset, no refetch
2. **View mode preserved** - stays in workspace view if that's where user was
3. **All state preserved** - scroll position, expanded sections, etc.
4. **State preserved when switching between pinned entries**

## Verification

- [x] TypeScript compilation passes (`npm run type-check`)
- [ ] Manual testing: Pin/unpin in dashboard view
- [ ] Manual testing: Pin/unpin in workspace view
- [ ] Manual testing: Switch between pinned entries

## Related Files

- `components/dashboard/DashboardInitializer.tsx` - Main fix location
- `components/dashboard/DashboardView.tsx` - Component that was remounting
- `lib/navigation/pinned-entry-manager.ts` - Pin state management
- `docs/proposal/components/entry_dashboard/pin/IMPLEMENTATION_PLAN.md` - Full plan
