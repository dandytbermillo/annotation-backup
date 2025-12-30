# Chat Entry Navigation Implementation Plan

**Feature Slug:** `chat-navigation`
**Date:** 2025-12-30
**Status:** Implemented

---

## Problem Statement

When clicking on Quick Links preview items (like "summary14") in the chatbox, nothing happens. The items appear clickable (hover states, cursor-pointer) but do not navigate to the target entry.

### Root Cause Analysis

The current implementation incorrectly uses `chat-navigate-note` event for Quick Links items:

1. **Wrong event type**: `chat-navigate-note` is designed for opening **notes** (documents) within a **workspace**
2. **Quick Links are workspace links with entry context**: Items like "summary14" are links to workspaces (dashboard or specific) within entries, not notes within the current workspace
3. **Different navigation concepts**:
   - `noteId` = a canvas note/document being edited in a workspace
   - `entryId` + `workspaceId/dashboardId` = target workspace within an entry

---

## Link Types Mental Model

> **Reference:** See `docs/flow/entry/quick-links-entry-links.md` for the authoritative specification.

Quick Links can represent two types of navigation targets:

### 1. Entry Link
- **Purpose:** Navigate to an entry's Dashboard view
- **Data:** `entryId` + `dashboardId`
- **Example:** Link to "summary14" entry → opens summary14's Dashboard

### 2. Workspace Link
- **Purpose:** Navigate to a specific workspace within an entry
- **Data:** `entryId` + `workspaceId` (no `dashboardId`)
- **Example:** Link to "Notes" workspace in summary14 → opens that workspace directly

### Navigation Rule

```typescript
// Simple priority: dashboardId wins if present
const targetWorkspaceId = item.dashboardId || item.workspaceId
```

| Condition | Link Type | Target |
|-----------|-----------|--------|
| `dashboardId` exists | Entry link | Entry's Dashboard view |
| Only `workspaceId` | Workspace link | Specific workspace |
| Neither exists | Invalid | No-op (log warning) |

### Data Requirements

- **Entry links must save `dashboardId` at creation time.** If a Quick Link is created without `dashboardId`, it will be treated as a workspace link (fallback to `workspaceId`).
- **All Quick Links should have `entryId`.** Links without `entryId` are ignored.

---

## Current Flow (Broken)

```
User clicks "summary14" in Quick Links preview
  → PreviewItem dispatches 'chat-navigate-note' event
    → DashboardView listener receives event
      → Tries to open noteId as a canvas note
        → noteId doesn't match any notes in current workspace
          → Nothing happens
```

## Expected Flow (Fixed)

```
User clicks "summary14" in Quick Links preview
  → PreviewItem dispatches 'chat-navigate-entry' event
    → DashboardInitializer listener receives event
      → Determines targetWorkspaceId = dashboardId || workspaceId
      → Calls handleDashboardNavigate(entryId, targetWorkspaceId)
        → Navigates to target (dashboard or workspace)
          → User sees the correct view
```

---

## Files to Modify

### 1. `components/dashboard/DashboardInitializer.tsx`

**Purpose:** Add listener for new `chat-navigate-entry` event

**Changes:**
- Add `useEffect` hook to listen for `chat-navigate-entry` custom event
- Event handler extracts `entryId`, `workspaceId`, `dashboardId` from event detail
- Apply simple rule: `targetWorkspaceId = dashboardId || workspaceId`
- Call existing `handleDashboardNavigate(entryId, targetWorkspaceId)`

**Location:** After line 438 (after `handleShowDashboard` effect)

**Code to add:**
```typescript
// Chat Navigation: Listen for chat-navigate-entry events
// Handles Quick Links navigation (both entry links and workspace links)
useEffect(() => {
  const handleChatNavigateEntry = (event: CustomEvent<{
    entryId: string
    workspaceId?: string
    dashboardId?: string
  }>) => {
    const { entryId, workspaceId, dashboardId } = event.detail

    void debugLog({
      component: "DashboardInitializer",
      action: "chat_navigate_entry_received",
      metadata: {
        entryId,
        workspaceId,
        dashboardId,
        linkType: dashboardId ? 'entry' : 'workspace'
      },
    })

    if (!entryId) return

    // Simple rule: dashboardId (entry link) takes priority over workspaceId (workspace link)
    const targetWorkspaceId = dashboardId || workspaceId

    if (targetWorkspaceId) {
      handleDashboardNavigate(entryId, targetWorkspaceId)
    } else {
      // Neither dashboardId nor workspaceId - invalid link, log and no-op
      console.warn("[DashboardInitializer] chat-navigate-entry: no target workspace", { entryId })
    }
  }

  window.addEventListener('chat-navigate-entry', handleChatNavigateEntry as EventListener)
  return () => {
    window.removeEventListener('chat-navigate-entry', handleChatNavigateEntry as EventListener)
  }
}, [handleDashboardNavigate])
```

### 2. `components/chat/message-result-preview.tsx`

**Purpose:** Update PreviewItem to dispatch correct event type for Quick Links navigation

**Changes:**
- Change event from `chat-navigate-note` to `chat-navigate-entry`
- Pass all navigation data: `entryId`, `workspaceId`, `dashboardId`
- Let the listener decide: entry link (dashboardId) vs workspace link (workspaceId)

**Location:** Lines 75-88 (handleClick function)

**Current code:**
```typescript
const handleClick = () => {
  if (isNote) return

  if (item.entryId || item.workspaceId) {
    window.dispatchEvent(new CustomEvent('chat-navigate-note', {
      detail: {
        noteId: item.entryId || item.id,
        workspaceId: item.workspaceId,
        entryId: item.entryId,
      }
    }))
  }
}
```

**Replace with:**
```typescript
const handleClick = () => {
  // Don't navigate for plain text notes (type === 'note')
  if (isNote) return

  // Navigate using chat-navigate-entry event
  // - Entry links have dashboardId → opens entry's dashboard
  // - Workspace links have only workspaceId → opens specific workspace
  if (item.entryId) {
    window.dispatchEvent(new CustomEvent('chat-navigate-entry', {
      detail: {
        entryId: item.entryId,
        workspaceId: item.workspaceId,
        dashboardId: item.dashboardId,
      }
    }))
  }
}
```

---

## Data Flow

### ViewListItem Structure (from Quick Links)

```typescript
interface ViewListItem {
  id: string
  name: string              // "summary14" or "Notes"
  type: 'link' | 'note' | 'entry' | 'workspace' | 'file'
  entryId?: string          // Target entry ID (always present for links)
  workspaceId?: string      // The linked workspace ID (always present for links)
  dashboardId?: string      // Entry's dashboard ID (present for entry links)
}
```

### Link Type Detection

```typescript
// Entry link: has dashboardId → user linked to an entry
// Workspace link: no dashboardId → user linked to specific workspace

const isEntryLink = !!item.dashboardId
const isWorkspaceLink = !item.dashboardId && !!item.workspaceId
```

### Event Detail Structure

```typescript
interface ChatNavigateEntryDetail {
  entryId: string           // Required: which entry to navigate to
  workspaceId?: string      // For workspace links: specific workspace to open
  dashboardId?: string      // For entry links: entry's dashboard to open
}
```

### Navigation Logic

```typescript
// Single rule: dashboardId takes priority
const targetWorkspaceId = item.dashboardId || item.workspaceId

// Then navigate
handleDashboardNavigate(entryId, targetWorkspaceId)
```

---

## Existing Navigation Events (Reference)

| Event | Purpose | Handler Location |
|-------|---------|------------------|
| `chat-navigate-note` | Open a note in canvas | DashboardView:1290 |
| `chat-navigate-dashboard` | Return to dashboard view | DashboardView:1331 |
| `chat-navigate-workspace` | Open specific workspace | DashboardView:1353 |
| `chat-navigate-entry` | **NEW** Navigate to different entry | DashboardInitializer |

---

## Testing Plan

### Manual Testing

1. **Entry Link Navigation (has dashboardId)**
   - Open chat panel
   - Type "show quick links" to display Quick Links
   - Click on an entry link (e.g., "summary14" with dashboardId)
   - **Expected:** Navigate to summary14's Dashboard view

2. **Workspace Link Navigation (only workspaceId)**
   - Create a Quick Link pointing to a specific workspace (e.g., "Notes" workspace)
   - Click on that workspace link
   - **Expected:** Navigate directly to that workspace (not dashboard)

3. **Preview Item Click (Inline in Chat)**
   - In the chat message result preview area
   - Click on a link item before opening the view panel
   - **Expected:** Navigate to correct target (dashboard or workspace)

4. **Plain Text Notes (No Navigation)**
   - Click on a "note" type item (plain text, no link)
   - **Expected:** Nothing happens (cursor stays default, no navigation)

### Link Type Verification Table

| Test Case | Has dashboardId | Has workspaceId | Expected Target |
|-----------|-----------------|-----------------|-----------------|
| Entry link | ✓ | ✓ | Dashboard |
| Workspace link | ✗ | ✓ | Specific workspace |
| Plain text note | ✗ | ✗ | No navigation |

### Edge Cases

1. **Missing entryId** → Early return, no navigation
2. **Missing both dashboardId and workspaceId** → Log warning, no navigation
3. **Both dashboardId and workspaceId present** → dashboardId wins (entry link behavior)
4. **Invalid entryId** → handleDashboardNavigate handles gracefully

---

## Acceptance Criteria

- [x] Entry links (with dashboardId) navigate to entry's Dashboard
- [x] Workspace links (with only workspaceId) navigate to specific workspace
- [x] Plain text "note" items remain non-clickable
- [x] Debug logs capture navigation events with link type
- [x] No TypeScript errors
- [ ] No console errors during navigation (requires manual testing)

---

## Dependencies

- `handleDashboardNavigate` function in DashboardInitializer (existing)
- ViewListItem with `entryId`, `workspaceId`, `dashboardId` fields (existing)
- Quick Links parser populates these fields correctly (existing)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Event not captured | Verify DashboardInitializer is mounted when event fires |
| Missing data in Quick Link | Quick Links parser already extracts dashboardId from mark attrs |
| Race condition | handleDashboardNavigate already handles async operations |

---

## Implementation Order

1. Add `chat-navigate-entry` listener to DashboardInitializer
2. Update PreviewItem to dispatch `chat-navigate-entry`
3. Run type-check and fix any errors
4. Manual testing per test plan
