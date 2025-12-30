# Quick Links: Entry vs Workspace Links

This document defines how Quick Links on an entry dashboard represent
either an entry (dashboard) or a specific workspace, and how navigation
should resolve each case.

## Context

- Each entry has a Dashboard workspace plus one or more regular workspaces.
- The Quick Links panel lives on an entry's Dashboard workspace.
- Quick Links are stored as TipTap marks (annotation-style) with
  `quickLinksLink` attributes.

## Link Types

### Entry Link (open entry dashboard)

Use when the link should open the target entry's Dashboard workspace.

Required fields:
- `entryId`
- `dashboardId` (the target entry's dashboard workspace id)

Optional fields:
- `workspaceId` (may equal `dashboardId`, but not required)

### Workspace Link (open specific workspace)

Use when the link should open a specific workspace inside an entry.

Required fields:
- `entryId`
- `workspaceId` (the target workspace id)

Optional fields:
- `dashboardId` (not needed for workspace links)

## Data Model (Quick Links Mark)

Quick Links marks store the following attributes:

- `entryId`
- `entryName`
- `workspaceId`
- `workspaceName`
- `dashboardId` (optional)

For entry links, the link text should match the entry name so the
Quick Links list displays the entry label the user expects.

## Display Rules

- Entry link label: entry name
- Entry link sublabel: "Dashboard"
- Workspace link label: workspace name
- Workspace link sublabel: entry name

## Navigation Rules

When a Quick Link item is clicked:

1) If `dashboardId` exists, treat as an entry link:
   - Navigate to the entry's dashboard workspace.
2) Else if `workspaceId` exists, treat as a workspace link:
   - Navigate directly to that workspace.
3) Else:
   - No-op and log a warning (invalid link data).

These rules apply both to:
- Quick Links panel clicks on the dashboard, and
- Chat preview item clicks (inline or view panel).

## Examples

| Link Text | entryId | dashboardId | workspaceId | Type | Expected Navigation |
|----------|---------|-------------|-------------|------|---------------------|
| Work     | e1      | w_dash_1    | (optional)  | Entry | Open Work dashboard |
| Email    | e1      | (none)      | w_email_1   | Workspace | Open Email workspace |
| Research | e2      | w_dash_2    | (optional)  | Entry | Open Research dashboard |
| Banking  | e3      | (none)      | w_bank_3    | Workspace | Open Banking workspace |

## Illustration: Multiple Quick Links Panels

```text
Knowledge Base (Root Entry)
└─ Personal (Entry)
   ├─ Dashboard (Workspace)
   │  ├─ Quick Links A (Panel)
   │  │  ├─ Work (Entry link → Work/Dashboard)
   │  │  └─ Email (Workspace link → Work/Email)
   │  ├─ Quick Links B (Panel)
   │  │  ├─ Research (Entry link → Research/Dashboard)
   │  │  └─ Web Browsing (Workspace link → Research/Web Browsing)
   │  └─ Quick Links C (Panel)
   │     ├─ Banking (Workspace link → Personal/Banking)
   │     └─ Todo (Workspace link → Personal/Todo)
   ├─ Todo (Workspace)
   └─ Banking (Workspace)
```

## Illustration: Entry Links vs Workspace Links (Side by Side)

```text
Entry Links (open dashboards)        Workspace Links (open specific workspaces)
---------------------------------    ------------------------------------------
Quick Links Panel                    Quick Links Panel
├─ Work       → Work/Dashboard        ├─ Email     → Work/Email
├─ Research   → Research/Dashboard    ├─ Banking   → Personal/Banking
└─ Personal   → Personal/Dashboard    └─ Todo      → Personal/Todo
```

## Edge Cases

- If `dashboardId` is missing for an entry link, treat it as a workspace
  link only if `workspaceId` exists. Otherwise, show a warning.
- If the target entry has no dashboard workspace, fall back to
  `workspaceId` or show a "Dashboard not found" error.

## Non-Goals

- Auto-creating dashboards during navigation.
- Resolving ambiguous links without IDs.
