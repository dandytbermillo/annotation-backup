# Quick Links (TipTap) Panel & Dashboard Breadcrumb Fixes

**Date:** 2025-12-08
**Components:** `LinksNotePanelTiptap.tsx`, `DashboardBreadcrumb.tsx`, API routes
**Related Files:**
- `components/dashboard/panels/LinksNotePanelTiptap.tsx`
- `components/dashboard/DashboardBreadcrumb.tsx`
- `app/api/dashboard/panels/route.ts`
- `app/api/entries/create-for-workspace/route.ts`
- `app/api/entries/[entryId]/seed-dashboard/route.ts`

---

## Overview

This document covers five fixes implemented for the Quick Links (TipTap) panel and Dashboard breadcrumb:

1. **Badge functionality** - Adding single-letter badges (A, B, C...) to Quick Links (TipTap) panels
2. **Restore link empty entry bug** - Fix for extra empty entry appearing when restoring deleted links
3. **Navigation race condition** - Fix for external links navigating to wrong workspace instead of Dashboard
4. **Breadcrumb redundancy** - Fix for redundant `🏠 > 🏠 Home` display in breadcrumb
5. **Ancestor click not navigating** - Fix for clicking ancestor entries in breadcrumb not navigating to that entry's Dashboard

---

## Fix 1: Badge Functionality for Quick Links (TipTap)

### Problem

The original Quick Links panel (`LinksNotePanel`) displayed single-letter badges (A, B, C...) in the panel header to distinguish multiple instances. The TipTap version (`LinksNotePanelTiptap`) was missing this functionality.

### Root Cause

The API endpoints that handle panel creation only assigned badges to `links_note` panel type, not `links_note_tiptap`.

### Files Modified

1. **`app/api/dashboard/panels/route.ts`** (lines 160-168)
   ```typescript
   // Before: Only links_note got badges
   if (panelType === 'links_note') {
     // badge logic
   }

   // After: Both panel types get badges
   if (panelType === 'links_note' || panelType === 'links_note_tiptap') {
     // badge logic - query updated to search both panel types
   }
   ```

2. **`app/api/entries/create-for-workspace/route.ts`** (lines 216-221)
   ```typescript
   // Before
   if (panel.panelType === 'links_note') {

   // After
   if (panel.panelType === 'links_note' || panel.panelType === 'links_note_tiptap') {
   ```

3. **`app/api/entries/[entryId]/seed-dashboard/route.ts`** (lines 98-129)
   - Added badge assignment that was previously missing entirely
   - Now assigns badges for both panel types during dashboard seeding

### Verification

- Type check passes
- New Quick Links (TipTap) panels receive badges automatically
- Existing panels can be updated via SQL if needed

---

## Fix 2: Restore Link Creating Empty Entry

### Problem

When restoring a deleted link from the trash in Quick Links (TipTap), an extra empty bordered box appeared alongside the restored link. The empty box had the hover icon but no visible text.

### Symptoms

- User deletes a link (e.g., "summary3")
- User clicks "Restore" in the trash popover
- Link is restored, but an extra empty entry appears
- The empty entry shows hover icon when moused over

### Root Cause

The `handleRestoreLink` function used **two separate TipTap chains**:

```typescript
// BUGGY CODE - Two separate chains
editor
  .chain()
  .focus()
  .command(({ tr, state }) => {
    const endPos = state.doc.content.size
    tr.insertText(' ', endPos)  // Insert space
    return true
  })
  .run()  // First chain completes

insertQuickLink(editor, { ...link })  // Second chain - separate operation
```

**What happened:**
1. First chain inserted a space at end of document
2. Between chains, selection state was unpredictable
3. Second chain's `insertQuickLink` might apply the mark incorrectly
4. Result: Both the space AND the link text got the `quickLinksLink` mark
5. The marked space rendered as: `<span class="quick-link"> </span>`
6. CSS padding (`2px 8px`) made the empty span visible as a bordered box

**Evidence from database:**
```html
<p><span class="quick-link">summary3</span></p>
<p><span class="quick-link"> </span></p>  <!-- The bug! -->
```

### Solution

Combine both operations into a **single atomic TipTap chain** using `insertContent` with an array:

```typescript
// FIXED CODE - Single atomic chain
const handleRestoreLink = useCallback((link: DeletedLink) => {
  if (!editor) return

  // Guard: Don't restore if no text content
  const linkText = (link.text || link.workspaceName || '').trim()
  if (!linkText) return

  // Single atomic operation: insert space + link with mark
  // Using array ensures space (no marks) and link (with mark) are distinct nodes
  editor
    .chain()
    .focus('end')
    .insertContent([
      { type: 'text', text: ' ' },  // Plain space, no marks
      {
        type: 'text',
        text: linkText,
        marks: [
          {
            type: 'quickLinksLink',
            attrs: {
              workspaceId: link.workspaceId,
              workspaceName: link.workspaceName,
              entryId: link.entryId,
              entryName: link.entryName,
              dashboardId: link.dashboardId,
            },
          },
        ],
      },
    ])
    .run()

  // Remove from deleted links
  const updatedDeleted = deletedLinks.filter(d => d.workspaceId !== link.workspaceId)
  onConfigChange?.({ content: editor.getHTML(), deletedLinks: updatedDeleted })
}, [editor, deletedLinks, onConfigChange])
```

### Why This Works

| Aspect | Benefit |
|--------|---------|
| **Single `insertContent`** | One operation = one transaction = no state inconsistency |
| **Array format** | Explicitly defines content structure - space and link are distinct nodes |
| **No mark on space** | First array element has no `marks` property = plain text |
| **`.focus('end')`** | Standard TipTap API, predictable cursor positioning |
| **Guard clause** | Prevents empty span creation if link text is empty |

### ProseMirror Guarantee

ProseMirror only merges adjacent text nodes with **identical marks**. Since the space has no marks and the link has `quickLinksLink` mark, they remain separate nodes.

---

## Fix 3: External Link Navigation Race Condition

### Problem

When clicking the hover popup button on an external link (link to a different entry), the app navigated to the wrong workspace instead of the entry's Dashboard.

### Symptoms

- User hovers over external link (e.g., "summary3" pointing to "summary3 C" entry)
- User clicks the navigate button
- App navigates to "summary3" workspace instead of "summary3 C" entry's Dashboard
- After page reload, navigation works correctly

### Root Cause

Race condition between entry context and workspace context:

```typescript
// BUGGY CODE in handleExternalLinkClick
const handleExternalLinkClick = useCallback(async (
  entryId: string,
  workspaceId: string,
  dashboardId: string | null
) => {
  // ...
  setActiveEntryContext(entryId)  // ← PROBLEM: Called immediately
  if (onNavigateRef.current) {
    onNavigateRef.current(entryId, targetId)  // ← But navigation is async
  }
}, [])
```

**The race condition:**

1. `setActiveEntryContext(entryId)` is called immediately
2. This triggers React effects that use `getActiveWorkspaceContext()`
3. `getActiveWorkspaceContext()` returns the **OLD** workspace context (e.g., "summary3" workspace from previous interaction)
4. System starts loading the wrong workspace
5. Meanwhile, `handleDashboardNavigate` (the navigation handler) is async - it does a `fetch()` first
6. By the time Dashboard is detected, the wrong workspace is already loading

**Why it worked after reload:**
- After first navigation, `last_workspace_id` was updated to Dashboard
- `activeWorkspaceContext` was set to Dashboard
- On reload, everything starts fresh with correct values
- Subsequent navigations work because Dashboard is now the "current" workspace

### Solution

Remove `setActiveEntryContext(entryId)` from `handleExternalLinkClick`:

```typescript
// FIXED CODE
const handleExternalLinkClick = useCallback(async (
  entryId: string,
  workspaceId: string,
  dashboardId: string | null
) => {
  debugLog({
    component: 'LinksNotePanelTiptap',
    action: 'external_link_clicked',
    metadata: { entryId, workspaceId, dashboardId },
  })

  // If no dashboard ID, look it up
  let targetId = dashboardId || workspaceId
  if (!dashboardId) {
    try {
      const response = await fetch(`/api/entries/${entryId}/workspaces`)
      if (response.ok) {
        const data = await response.json()
        const dashboardWorkspace = data.workspaces?.find(
          (ws: { name: string; id: string }) => ws.name === 'Dashboard'
        )
        if (dashboardWorkspace) {
          targetId = dashboardWorkspace.id
        }
      }
    } catch (err) {
      console.error('[LinksNotePanelTiptap] Failed to lookup dashboard:', err)
    }
  }

  // Note: Entry context is set by handleDashboardNavigate (the navigation handler)
  // after it determines the correct workspace. Setting it here would cause a race
  // condition where stale workspace context is used before navigation completes.
  if (onNavigateRef.current) {
    onNavigateRef.current(entryId, targetId)
  }
}, [])
```

### Why This Is Safe

`handleDashboardNavigate` (in `DashboardInitializer.tsx`) handles entry context in **both** code paths:

| Path | Entry Context Set? | Workspace Set First? |
|------|-------------------|---------------------|
| Dashboard workspace (lines 189-236) | ✅ After workspace determined | ✅ Yes |
| Regular workspace (lines 242-320) | ✅ After workspace set | ✅ Yes |
| Fetch error | ✅ Falls through to regular path | ✅ Yes |

Both paths call `setActiveEntryContext(entryId)` **after** the correct workspace is determined/set, eliminating the race condition.

---

## Fix 4: Breadcrumb Redundancy (🏠 > 🏠 Home)

### Problem

When viewing the main Dashboard (Home entry), the breadcrumb showed redundant navigation:
```
🏠 > 🏠 Home > Dashboard
```

The Home icon shortcut and the "🏠 Home" entry segment were duplicates.

### Root Cause

The `ancestorsToShow` filter only skipped ancestors based on `isSystemEntry`, but "Home" entry was still appearing because:
1. The filter was only checking `!ancestor.isSystemEntry`
2. The current entry segment was also rendering for system entries

### Solution

**File:** `components/dashboard/DashboardBreadcrumb.tsx`

1. **Filter ALL system entries from ancestors** (lines 131-143):
```typescript
const ancestorsToShow = useMemo(() => {
  if (!breadcrumbInfo?.ancestors) return []
  // All ancestors except the last one (which is the current entry)
  const withoutCurrent = breadcrumbInfo.ancestors.slice(0, -1)
  // When showing the home icon shortcut, filter out all system entries
  // (Knowledge Base, Home) since the shortcut handles navigation to them
  if (showHomeIcon) {
    return withoutCurrent.filter(
      (ancestor) => !ancestor.isSystemEntry && ancestor.entryName !== 'Knowledge Base'
    )
  }
  return withoutCurrent
}, [breadcrumbInfo?.ancestors, showHomeIcon])
```

2. **Skip current entry segment when it's a system entry** (lines 230-253):
```typescript
{/* Current entry segment - skip if it's a system entry and we show home shortcut (redundant) */}
{!(showHomeIcon && currentEntry.isSystemEntry) && (
  <>
    <button onClick={() => onEntryClick?.(currentEntry.entryId)} ...>
      {/* ... */}
    </button>
    <ChevronRight size={14} className="text-muted-foreground/50" />
  </>
)}
```

### Result

| Before | After |
|--------|-------|
| `🏠 > 🏠 Home > Dashboard` | `🏠 > Dashboard` |
| `🏠 > 🏠 Home > 📝 summary3 C > Dashboard` | `🏠 > 📝 summary3 C > Dashboard` |

---

## Fix 5: Ancestor Click Not Navigating

### Problem

When clicking an ancestor entry in the breadcrumb (e.g., "📝 summary3 C" when viewing a nested entry), clicking did nothing - it did not navigate to that entry's Dashboard.

### Root Cause

The `handleAncestorClick` function was using `onWorkspaceClick` when the ancestor had a `dashboardWorkspaceId`:

```typescript
// BUGGY CODE
const handleAncestorClick = (ancestor: AncestorEntry) => {
  if (ancestor.dashboardWorkspaceId && onWorkspaceClick) {
    onWorkspaceClick(ancestor.dashboardWorkspaceId)  // ← Only handles within-entry navigation!
  } else if (onEntryClick) {
    onEntryClick(ancestor.entryId)
  }
}
```

**The issue:**
- `onWorkspaceClick` only switches workspaces within the **current** entry
- It just updates local state, doesn't trigger cross-entry navigation
- For ancestor entries (different entries), we need `onEntryClick` which properly navigates to the target entry's Dashboard

### Solution

Two changes were required:

**1. Update callback signature** (`components/dashboard/DashboardBreadcrumb.tsx` lines 41-42):

```typescript
// Before: Only passed entryId
onEntryClick?: (entryId: string) => void

// After: Also passes dashboardWorkspaceId
onEntryClick?: (entryId: string, dashboardWorkspaceId?: string | null) => void
```

**2. Pass dashboardWorkspaceId in handler** (lines 182-186):

```typescript
// FIXED CODE
const handleAncestorClick = (ancestor: AncestorEntry) => {
  if (onEntryClick) {
    onEntryClick(ancestor.entryId, ancestor.dashboardWorkspaceId)
  }
}
```

**3. Update DashboardView.tsx to use the dashboardWorkspaceId** (lines 1206-1211):

```typescript
// Before: Passed empty string as workspace ID (caused the error!)
onEntryClick={(clickedEntryId) => {
  if (onNavigate) {
    onNavigate(clickedEntryId, '')  // ← Empty string!
  }
}}

// After: Uses the dashboardWorkspaceId from ancestor data
onEntryClick={(clickedEntryId, dashboardWorkspaceId) => {
  if (onNavigate && dashboardWorkspaceId) {
    onNavigate(clickedEntryId, dashboardWorkspaceId)
  }
}}
```

### Why This Works

| Handler | Purpose | Data Flow |
|---------|---------|-----------|
| `onWorkspaceClick` | Switch workspace within current entry | Local state only |
| `onEntryClick` | Navigate to different entry's Dashboard | Uses `dashboardWorkspaceId` from ancestor data |

The `dashboardWorkspaceId` is already available in the ancestor data (fetched by the breadcrumb API using a subquery to find each entry's Dashboard workspace). Now we properly pass it through to `onNavigate`.

---

## Testing

### Badge Functionality
1. Create a new Quick Links (TipTap) panel
2. Verify it receives a badge (A, B, C...)
3. Create multiple panels and verify sequential badges

### Restore Link
1. Add a link to Quick Links (TipTap) panel
2. Delete the link (select and delete)
3. Click trash icon, restore the link
4. Verify no empty bordered box appears
5. Verify the restored link is functional

### External Link Navigation
1. Navigate to any entry's Dashboard
2. Add an external link (link to a different entry)
3. Hover over the link and click the navigate button
4. Verify navigation goes to the target entry's **Dashboard** (not a workspace)
5. Verify this works on first click (not just after reload)

### Breadcrumb Redundancy
1. Navigate to the main Dashboard (Home entry)
2. Verify breadcrumb shows `🏠 > Dashboard` (not `🏠 > 🏠 Home > Dashboard`)
3. Navigate to a nested entry's Dashboard
4. Verify no "🏠 Home" segment appears after the Home icon

### Ancestor Click Navigation
1. Navigate to a nested entry (e.g., "summary3" under "summary3 C")
2. Verify breadcrumb shows ancestor entries (e.g., `🏠 > 📝 summary3 C > Dashboard`)
3. Click on the ancestor entry segment ("📝 summary3 C")
4. Verify navigation goes to that entry's Dashboard

---

## Debug Logs

Relevant debug log actions for troubleshooting:

| Component | Action | Description |
|-----------|--------|-------------|
| `LinksNotePanelTiptap` | `hover_navigate_clicked` | Hover button clicked |
| `LinksNotePanelTiptap` | `external_link_clicked` | External link handler called |
| `DashboardInitializer` | `navigate_workspace_check` | Checking if target is Dashboard |
| `NoteWorkspace` | `entry_switch` | Entry context changing |
| `WorkspaceState` | `get_active_workspace_context` | Getting current workspace |

---

## Summary

| Fix | Root Cause | Solution |
|-----|------------|----------|
| Badge functionality | API only handled `links_note` | Add `links_note_tiptap` to badge logic |
| Restore empty entry | Two separate TipTap chains | Single atomic chain with array |
| Navigation race | Premature `setActiveEntryContext` | Remove call, let navigation handler set it |
| Breadcrumb redundancy | System entries not fully filtered | Filter all system entries when showing Home icon |
| Ancestor click | Empty workspace ID passed to `onNavigate` | Pass `dashboardWorkspaceId` through callback |

All fixes verified with TypeScript type check passing.
