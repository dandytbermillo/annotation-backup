# Entry Dashboard and Workspace Flow

## Overview
An Entry is the top-level container. Each Entry has:
- Entry Dashboard (panels such as Recent, Quick Links, etc.)
- Entry Workspaces (one or more workspaces under the entry)

The chatbox is global and visible in both the Entry Dashboard and Entry Workspaces.

## Key Concepts
- Entry Dashboard: the home view for an entry.
- Entry Workspace: the working area within an entry.
- Quick Links: a panel that can include direct links to entries.
- Global Chatbox: a single chat session shared across dashboard and workspace views.

## Simple Structure Diagram

```
Entry
├─ Entry Dashboard
│  ├─ Panels (Recent, Quick Links, etc.)
│  └─ Chatbox (global)
└─ Entry Workspaces
   ├─ Workspace A
   ├─ Workspace B
   └─ Workspace C
```

## Quick Links Behavior
The Quick Links panel can include links to entries and workspaces. Navigation behavior depends on the link type:

### External Links (Different Entry)
- If the link has a `dashboardId`: Opens the target entry's Dashboard
- If no `dashboardId` (fallback): Opens the linked workspace directly

### Internal Links (Same Entry)
- Opens the workspace directly via workspace switcher (no entry navigation needed)

```
Quick Links Panel
├─ Entry: Project Alpha     -> opens Entry Dashboard (external, has dashboardId)
├─ Workspace: Sprint 5      -> opens Workspace directly (internal link)
├─ Entry: Research Hub      -> opens Entry Dashboard (external, has dashboardId)
└─ Workspace: Legacy Data   -> opens Workspace directly (external, no dashboardId)
```

### Link Data Structure
Quick Links store the following attributes:
- `workspaceId`: The target workspace ID
- `workspaceName`: Display name of the workspace
- `entryId`: The parent entry ID
- `entryName`: Display name of the entry
- `dashboardId`: (Optional) The entry's dashboard workspace ID for external navigation

## Navigation Flow (Within One Entry)

```
Entry Dashboard  <---- go_to_dashboard ----  Entry Workspace
      |                                       |
      | open workspace by name                | list/rename/delete workspace
      +---------------------------------------+
```

## Global Chatbox Visibility
- The chatbox is shared across Entry Dashboard and Entry Workspace views.
- The same conversation continues when switching between these views.
- Chat history is cleared only when the app reloads.

## Pinning Behavior (When Pinned Entries Feature is Enabled)
- Entry dashboards can be pinned to stay mounted.
- Workspaces inside an entry can also be pinned.
- Pinned items remain mounted even when switching entries.

```
Pinned Entries (mounted)
├─ Entry: Project Alpha
│  ├─ Dashboard (pinned)
│  └─ Workspace A (pinned)
├─ Entry: Research Hub
│  └─ Dashboard (pinned)
└─ Entry: Client X
   └─ Workspace B (pinned)
```

## Notes
- This document describes the current intended flow.
- Behavior depends on feature flags for pinned entries.

## Pinned Entries Lifecycle

### 1) User Pins an Entry or Workspace
- User pins an entry dashboard or a specific workspace.
- The system records it in the pinned entries state.
- Pinned items are marked for keep-alive.

```
User action: Pin
Entry: Project Alpha
Workspace: Sprint 5

Pinned State
- Entry: Project Alpha (pinned)
- Workspace: Sprint 5 (pinned)
```

### 2) Navigation Away
- User navigates to another entry or workspace.
- Pinned items remain mounted in memory.
- Unpinned items may be unmounted.

```
Active View: Entry: Research Hub
Pinned (kept mounted):
- Entry: Project Alpha (dashboard)
- Workspace: Sprint 5
Unpinned (eligible to unmount):
- Other dashboards/workspaces
```

### 3) Returning to a Pinned Entry
- Navigation back is faster because pinned items are already mounted.
- State is preserved (scroll position, layout, open panels).

```
User action: Open pinned entry
Result: Immediate render with preserved state
```

### 4) Unpinning
- User unpins an entry or workspace.
- It becomes eligible for unmounting during future navigation.

```
User action: Unpin
Entry: Project Alpha
Workspace: Sprint 5

Pinned State
- Entry: Project Alpha (dashboard only)
```

### 5) App Reload
- All mounted state is cleared.
- Pin configuration is reloaded from saved state (if enabled).

```
Reload
- Mounted state cleared
- Pinned config restored
```

## Code References

Key implementation files for this flow:

| Component | File | Description |
|-----------|------|-------------|
| Entry/Dashboard/Workspace View | `components/dashboard/DashboardView.tsx` | Main view component managing dashboard/workspace mode switching |
| Dashboard Initializer | `components/dashboard/DashboardInitializer.tsx` | Handles cold start, pinned entries, and navigation |
| Quick Links Navigation | `components/dashboard/panels/LinksNotePanelTiptap.tsx` | Quick Links panel with internal/external link handling |
| Quick Links Hover | `lib/extensions/quick-links/quick-links-hover.ts` | Hover icon for Quick Link navigation |
| Global Chatbox | `components/chat/chat-navigation-root.tsx` | App-level chat panel instance |
| Chat Navigation Hook | `lib/chat/use-chat-navigation.ts` | Navigation actions (goToDashboard, etc.) |
| Pinned Entry Manager | `lib/navigation/pinned-entry-manager.ts` | Pinned entries state management |

Last verified: 2025-12-27
