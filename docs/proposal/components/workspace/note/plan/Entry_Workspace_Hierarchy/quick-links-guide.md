# Quick Links → Entry Dashboard Workspaces (Implementation Guide)

Use this guide when wiring the dashboard’s Quick Links panel into the entry/workspace hierarchy so every link opens a dedicated entry with its own dashboard and workspace set.

---

## 1. State Management

1. **Track active entry**
   - Add `activeEntryId` in the shared workspace state module (`lib/note-workspaces/state.ts`).
   - Provide setters/getters: `setActiveEntryContext(entryId)` and `getActiveEntryContext()`.
   - Expose `currentEntryId` from `useNoteWorkspaces`.
2. **Entry-aware switching**
   - Before switching workspaces, call `setActiveEntryContext(entryId)`.
   - When leaving an entry, flush/persist dirty workspaces in the previous entry using the existing scheduler (just scoped by entry).

---

## 2. Data Model & APIs

1. **Entry association**
   - Ensure every workspace row has `item_id` populated (migration already in place).
   - Quick Links must store both `workspaceId` and `entryId`.
2. **API contracts**
   - `/api/note-workspaces` (POST) → require `itemId` (entry) in the payload.
   - Workspace queries (`/api/dashboard/workspaces/search`, recent, quick capture destination) must accept `entryId` filter.
   - Add an endpoint to list workspaces for a given entry (`GET /api/entries/{entryId}/workspaces`).
3. **Quick Links creation**
   - When a user creates a link via Cmd+K, ensure the link metadata includes the entryId.
   - Legacy workspaces without an entry: on first click, create a new entry in `items`, set `item_id`, and seed its dashboard.

---

## 3. Quick Links Click Flow

1. Resolve the link’s `entryId` and `workspaceId`.
2. If `entryId` is missing:
   - Create a new entry (`items` row) named after the workspace.
   - Update the workspace’s `item_id` to the new entry.
   - Seed dashboard panels for that entry.
3. Call `setActiveEntryContext(entryId)` and load the entry’s dashboard workspace first.
4. After the dashboard renders, allow users to switch to the target workspace via the entry’s tab bar.

---

## 4. UI Changes

1. **Entry navigator (sidebar/tree)**
   - Highlight the active entry.
   - Clicking another entry switches `activeEntryId` and refreshes workspace tabs.
2. **Workspace tabs**
   - Filter tabs to `workspaces.filter(ws => ws.itemId === currentEntryId)`.
   - Ensure each entry has at least two tabs: “Dashboard” + existing “Default”.
   - Provide “+ Workspace” within the entry to add more canvases.
3. **Breadcrumb & routing**
   - Route format: `/entries/{entryId}/workspaces/{workspaceId}`.
   - Breadcrumb shows `Entry Name / Workspace Name`.
4. **Workspace picker (Cmd+K)**
   - Only list workspaces for `currentEntryId` unless user toggles “All entries”.
5. **LinksNotePanel / Quick Links component**
   - When creating a link, save both IDs in the markup.
   - On click, switch entry before workspace.

---

## 5. Dashboard Seeding per Entry

1. When an entry is created (manually or via Quick Links auto-creation), seed a dashboard workspace:
   - Panels: Navigator, Continue, Recent, Quick Capture, Links Note.
   - Layout coordinates can reuse the Home dashboard defaults.
2. Provide “Reset dashboard” per entry (calls the existing reset endpoint but scoped to entry).

---

## 6. Testing Checklist

- **Unit**
  - `setActiveEntryContext` updates state and notifies listeners.
  - API endpoints reject workspace creation without `itemId`.
- **Integration**
  - Click Quick Link → entry dashboard shows → tabs limited to entry.
  - Legacy workspace (no entry) → click Quick Link → entry auto-created → dashboard seeded.
  - Add new workspace under entry, ensure Quick Links still point into that entry.
- **Live-state**
  - Switching entries flushes dirty workspaces in previous entry.
  - LRU eviction still works across entries; pre-eviction persistence logs entry metadata.

---

## Deliverables Recap

- State: `activeEntryId` tracking.
- APIs: workspace creation/listing filtered by entry; Quick Links store entryId.
- UI: entry navigator highlighting, per-entry tabs, breadcrumb/routing updates, filtered workspace picker.
- Dashboard seeding/reset per entry.
- Tests verifying Quick Links now open per-entry dashboards and allow adding new workspaces under that entry.

Use this guide to implement the full Quick Links → entry dashboard experience consistently with the live-state system.***
