# Dashboard Implementation Plan (Entry + Workspace Hierarchy)

This plan extends the live-state architecture with a “Home” entry and a dashboard workspace that uses the existing canvas system. The dashboard is just another workspace pre-populated with navigation panels (Entry Navigator, Continue, Recent, Quick Capture, Links Note, etc.).

Terminology note: the existing `items` table already stores hierarchical entries. We will reuse that table and add an `is_system` flag (or `type = 'system-entry'`) instead of introducing a new table.

## Goals

1. Reuse the single workspace canvas for both dashboard and project workspaces.
2. Provide a first-run landing view (“Home” entry → “Dashboard” workspace) with navigation panels.
3. Allow users to customize the dashboard using the same panel system (add/remove/rearrange).
4. Keep the entry/workspace hierarchy consistent: dashboard is simply the default workspace of a system entry.

## Phase 1 – Schema & Migration (Week 1)

### 1.1 Items table updates
- Add `is_system BOOLEAN DEFAULT false` to `items`.
- Create migration to backfill a “Home” item for each user who lacks one:
  ```sql
  INSERT INTO items (id, user_id, name, type, path, is_system, parent_id, created_at, updated_at)
  SELECT gen_random_uuid(), u.id, 'Home', 'system-entry', '/home-' || u.id::text, true, NULL, NOW(), NOW()
  FROM users u
  WHERE NOT EXISTS (
    SELECT 1 FROM items i WHERE i.user_id = u.id AND i.is_system = true
  );
  ```

### 1.2 Workspace association
- Add `item_id UUID` to `note_workspaces` (nullable initially).
- Backfill `item_id`:
  - Dashboard workspace → the system Home item.
  - Existing workspaces → the entry/item they currently belong to (if not tracked, assign to a default “Legacy” entry per user).
- After backfill, enforce `item_id NOT NULL` and add FK `REFERENCES items(id) ON DELETE CASCADE`.

### 1.3 Default workspace constraint
- Drop existing index `note_workspaces_unique_default_per_user`.
- Add new index `CREATE UNIQUE INDEX note_workspaces_unique_default_per_entry ON note_workspaces(user_id, item_id) WHERE is_default;`

### 1.4 Panels table schema
- Create (or reuse) `workspace_panels` table:
  ```sql
  CREATE TABLE workspace_panels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES note_workspaces(id) ON DELETE CASCADE,
    panel_type TEXT NOT NULL, -- 'note', 'navigator', 'recent', 'continue', 'quick_capture'
    position_x INT NOT NULL,
    position_y INT NOT NULL,
    width INT NOT NULL,
    height INT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```

### 1.5 Dashboard seeding
- For each user:
  - Ensure a Home item and Dashboard workspace exist (workspace name “Dashboard”, `is_default = true`, `item_id = home_item_id`).
  - Insert default panel rows using coordinates tuned for 1280x800 viewport:
    | Panel        | Panel Type   | X  | Y   | W   | H   |
    |--------------|--------------|----|-----|-----|-----|
    | Continue     | continue     | 40 | 40  | 320 | 140 |
    | Navigator    | navigator    | 40 | 200 | 280 | 320 |
    | Recent       | recent       | 380| 40  | 280 | 220 |
    | QuickCapture | quick_capture| 380| 280 | 280 | 180 |
    | Links Note   | note         | 700| 40  | 320 | 320 |
- Migration up/down scripts must support rollback (delete seeded rows, drop new columns/indexes).

### 1.6 Quick capture destination + continue state
- Add `user_preferences` table (if not present) or reuse existing settings:
  - Columns: `user_id`, `last_workspace_id`, `quick_capture_entry_id`, timestamps.
- Default quick-capture destination: auto-create an “Ideas Inbox” item per user (child of Home) unless user configures another entry.
- Persist `last_workspace_id` whenever user switches to a non-Home workspace.

## Phase 2 – Panel Types & UI Components (Week 2)

### 2.1 Panel registry
- Introduce a panel type registry so dashboard panels are first-class citizens.
- Each panel type defines: render component, default size, config schema, persistence behavior.

### 2.2 Implementations
- **EntryNavigatorPanel**: tree view of `items`; virtualized list for large trees; click -> switch entry/workspace.
- **ContinuePanel**: shows `last_workspace_id` (fallback to most recent workspace); button to resume.
- **RecentPanel**: list of last N workspaces from telemetry or `note_workspaces.last_accessed_at`.
- **QuickCapturePanel**: textarea + submit; creates note in `quick_capture_entry_id`; show success toast linking to note.
- **LinksNotePanel**: standard note panel with support for:
  - `[[workspace]]` syntax
  - Highlight-to-link UI (select text -> Cmd/Ctrl+K -> choose workspace)

### 2.3 Panel catalog / add flow
- Update “Add panel” menu to list new panel types (with tooltips explaining usage).
- Ensure panels can be added outside the dashboard (e.g., Navigator panel inside a project workspace).

## Phase 3 – Routing & Navigation (Week 3)

### 3.1 Default selection & keyboard shortcuts
- On cold start, if user has `last_workspace_id`, load it; otherwise load Home/Dashboard.
- Add keyboard shortcut `Cmd+Shift+H` (guarded so it doesn’t fire inside inputs) to jump to Home.
- Clicking the logo also returns to Home.

### 3.2 Breadcrumbs & tabs
- Breadcrumb format: `Entry Name / Workspace Name` (Home shows `Home / Dashboard`).
- For Home entry, show a single “Dashboard” tab (keep tab UI to avoid inconsistent layout).
- When users create additional workspaces under Home, tabs behave as usual.

### 3.3 Workspace links
- Maintain `[[workspace:Name]]` syntax.
- Add highlight-to-link UI to all note panels (select text -> `Cmd/Ctrl+K` -> choose workspace).
- When link targets the current workspace, pulse the active tab instead of navigating.

## Phase 4 – Integration & Polish (Week 4)

### 4.1 Continue + quick capture wiring
- Continue panel pulls `last_workspace_id` and shows fallback states (“No recent workspaces”).
- Quick capture panel writes notes to `quick_capture_entry_id`; provide success toast with link to new note/workspace.

### 4.2 Layout + customization
- Dashboard panels are standard canvas panels: drag, resize, delete, add.
- Provide “Reset layout” action to reseed default panel positions if dashboard becomes cluttered.

### 4.3 Error handling
- Home entry/workspace creation failure: retry with exponential backoff; surface toast with “Retry” button; log to monitoring.
- Panel seeding failure: dashboard loads empty; show “Seed defaults” CTA; log panel type + error.
- Continue panel missing data: show neutral state with instructions to visit a workspace.
- Quick capture failure: show error toast and keep user input intact.

### 4.4 Performance considerations
- Navigator panel uses virtual scroll and caches entry tree (invalidate on CRUD changes).
- Recent panel limited to top 10; fetch in background after workspace load.
- Panel metadata (type, position) loads immediately; panel content lazy-loads and shows skeleton states to avoid blocking.

## Phase 5 – Testing & Rollout (Week 5)

### 5.1 Automated tests
- Unit tests per panel type (rendering, interactions, persisting config).
- Integration tests for migrations (ensure Home entry/workspace seeded once).
- E2E tests:
  - First run shows Dashboard.
  - Continue panel resumes workspace.
  - Quick capture adds note and shows toast.
  - Navigator opens entry/workspace.

### 5.2 Feature flag & rollout
- Gate behind `NOTE_HOME_DASHBOARD`.
- Dogfood internally, then cohort rollout with telemetry monitoring:
  - Dashboard load errors
  - Panel type usage
  - Quick capture success rate
  - Continue panel click-throughs

### 5.3 User education
- Tooltip on first visit explaining dashboard customization.
- Release notes + short video showing how to rearrange panels.

### 5.4 Monitoring
- Debug logs for seeding, quick capture failures, navigator errors.
- Metrics for time-to-load dashboard, panel render durations.

## Future Enhancements (Post Launch)

- Allow users to create additional “Home-like” workspaces (e.g., custom dashboards per entry).
- Support layout presets (minimal, navigation-heavy, analytics, etc.)
- Add analytics widgets (e.g., tasks due, meeting notes) as additional panel types.
- Introduce a “workspace templates” feature to clone the dashboard layout into other entries.

---

## Future Enhancements (Post Launch)
- Allow multiple dashboards per entry (templates).
- Provide layout presets (navigation heavy, analytics, minimal).
- Add analytics/task widgets as new panel types.
- Snapshot cache warming for evicted workspaces to make returning instant.

By keeping the dashboard as a normal workspace (just seeded with different panels), we avoid duplicating the canvas logic, get customization “for free,” and ensure a consistent UX across the app. The home entry is just the system entry that happens to be the default landing context. EOF
