# Plan: Entry/Dashboard/Workspace Hierarchy Restructuring

**Feature slug:** `entry_dashboard_workspace_restructuring`
**Date:** 2026-03-16

## Context

Currently, all entries (including Home) are treated identically -- each can have a Dashboard workspace plus additional workspaces. The goal is to enforce a clear separation:

- **Main Entry (Home):** Dashboard only, no workspaces
- **Non-Main Entries:** Workspaces only, no dashboard

This creates a cleaner mental model: Home is a pure hub/overview, and actual work happens in entry workspaces.

---

## Phase 1: `isHomeEntry` Utility (Foundation)

**Create** `lib/entry/entry-utils.ts`:
- `isHomeEntry(entry: { isSystem: boolean; name: string }): boolean`
- Pure function: `return entry.isSystem && entry.name === 'Home'`

**Why:** Home detection is currently scattered across SQL queries and UI conditionals. A single utility prevents drift.

---

## Phase 2: API Guard — Block Workspace Creation for Home

**Modify** `app/api/note-workspaces/route.ts` (POST handler):
- After extracting `itemId`, query items table to check if it's a Home entry
- If Home, return `400: "Cannot create workspaces for Home entry"`

This is the single server-side enforcement point.

---

## Phase 3: UI — Hide Workspace UI on Home Dashboard

**Modify** `components/dashboard/DashboardDock.tsx`:
- Add `hideWorkspaceButton?: boolean` prop
- When true, don't render workspace toggle button

**Modify** `components/dashboard/DashboardView.tsx`:
- Derive `isHome = entryId === homeEntryId`
- Pass `hideWorkspaceButton={isHome}` to DashboardDock
- Guard `handleCreateWorkspace`: early return if `isHome`
- Skip workspace fetch or filter to Dashboard-only when `isHome`

**Modify** `components/annotation-app-shell.tsx`:
- For non-Home entries, filter out "Dashboard" workspace from `workspacesForCurrentEntry`

---

## Phase 4: Remove Dashboard from Non-Home Entry Creation

**Modify** `app/api/entries/create-for-workspace/route.ts`:
- Remove dashboard workspace creation + panel seeding for non-Home entries (lines ~189-239)
- The adopted workspace becomes the default workspace directly

**Modify** `app/api/entries/[entryId]/seed-dashboard/route.ts`:
- Add guard: only allow seeding for Home entry, reject otherwise

**Existing data:** Filter "Dashboard" workspaces out of non-Home entries in UI (safe, no data loss). Follow-up migration can clean up later.

---

## Phase 5: Database Migration (`074_enforce_home_dashboard_only`)

**`074_enforce_home_dashboard_only.up.sql`:**
1. Move any non-Dashboard workspaces under Home to Legacy Workspaces folder
2. Add trigger `trg_check_home_workspace_limit` to prevent non-Dashboard workspace creation under Home

**`074_enforce_home_dashboard_only.down.sql`:**
- Drop trigger and function

---

## Phase 6: Chat Navigation Updates

**Modify** `app/api/chat/navigate/route.ts`:
- "go to dashboard" from non-Home entry → navigate to Home dashboard
- "create workspace" on Home → return message explaining workspaces live in entries
- "open workspace" targeting Home → redirect to Dashboard

**Modify** seeded documentation concepts:
- Update `entry.md`, `dashboard.md`, `workspace.md`, `home.md` to reflect the new hierarchy

---

## Phase 7: Tests

- `__tests__/unit/entry/entry-utils.test.ts` — `isHomeEntry` utility
- `__tests__/integration/api/workspace-home-guard.test.ts` — POST rejection for Home
- Update existing tests that assume workspace creation under Home

---

## Execution Order

| # | Phase | Risk | Effort |
|---|-------|------|--------|
| 1 | `isHomeEntry` utility | Low | Small |
| 2 | API guard | Low | Small |
| 3 | UI changes (DashboardView, Dock, AppShell) | Medium | Medium |
| 4 | Remove dashboard from non-Home entry creation | High | Medium |
| 5 | DB migration | Medium | Small |
| 6 | Chat navigation | Medium | Medium |
| 7 | Tests | Low | Medium |

---

## Critical Files

- `components/dashboard/DashboardView.tsx` — Core UI, ~2300 lines
- `components/dashboard/DashboardDock.tsx` — Dock with workspace toggle
- `components/annotation-app-shell.tsx` — Workspace sidebar
- `app/api/note-workspaces/route.ts` — Workspace CRUD
- `app/api/entries/create-for-workspace/route.ts` — Entry creation
- `components/dashboard/DashboardInitializer.tsx` — Pinned entry logic
- `lib/entry/entry-types.ts` — Type definitions

---

## Verification

1. `npm run type-check` — no type errors
2. `npm run test` — all unit tests pass
3. Manual: Open Home dashboard → confirm no workspace toggle/creation UI
4. Manual: Create a new entry → confirm no Dashboard workspace is created
5. Manual: Try `POST /api/note-workspaces` with Home itemId → confirm 400 error
6. Manual: Chat "create workspace" on Home → confirm rejection message
