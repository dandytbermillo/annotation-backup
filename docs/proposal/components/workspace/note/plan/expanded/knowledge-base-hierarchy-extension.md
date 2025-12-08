# Knowledge Base Hierarchy Extension Plan

> Builds on `merge_dashboard_workspace/IMPLEMENTATION_PLAN.md`. That plan delivered the unified dashboard/workspace shell. This document extends it with Knowledge Base categorization (root entry, category entries, navigator, Quick Links awareness).

## Objectives
1. Introduce a **Knowledge Base root entry** that contains category entries (Personal, Work, Business, Projects, etc.).
2. Ensure every entry has:
   - A dashboard workspace (with seeded panels).
   - Multiple note workspaces under the entry.
   - Navigation & Quick Links that know the entry hierarchy.
3. Update dashboard UI to include an **entry navigator sidebar** and breadcrumb showing `Knowledge Base / Category / Workspace`.
4. Make Quick Links/Recent panels entry-aware (context switching, external link identification).
5. Integrate new categories with existing entry/workspace APIs, persistence, and link creation flows.

## Deliverables
- Schema updates for item grouping (Knowledge Base root, categories, custom entries).
- Dashboard initializer capable of loading entries, grouping, and default dashboards.
- Navigator panel and Quick Links panel aware of entry hierarchy.
- Backend routes supporting `GET /api/entries/:entryId/workspaces`, `GET /api/entries/root`, `POST /api/entries/:entryId/workspaces` (scoped by entry).
- Migration scripts & seed data for Knowledge Base.

## Phases

### Phase 1 – Schema & Data Layer
1. **Items table**: ensure `parent_id`, `path`, `type`, `metadata` support the root + categories.
2. **New fields**: add `group` or `category_type` to differentiate root, Knowledge Base categories, and custom entries.
3. **Migration**:
   - Seed `Knowledge Base` root under existing item tree.
   - Seed example categories (Personal, Work, Business, Projects).
   - Create dashboards & default workspaces for each seeded entry.
4. **API updates**: extend `/api/entries` routes to fetch entries grouped by root/category.

### Phase 2 – Dashboard UI & Navigation
1. **Entry navigator sidebar** (similar to demo) pulling data from API.
2. **Breadcrumb** updated to show `Knowledge Base / {Category} / {Workspace}`.
3. **Workspace dropdown** filters workspaces scoped to current entry.
4. **DashboardView** accepts entry metadata (id, name, group) and renders entry-specific panels.
5. **Navigator panel** (inside dashboard) reuses the same entry data (or uses context to avoid duplication).

### Phase 3 – Quick Links, Recent & Continue Panels
1. **Quick Links panel** enhancements:
   - Base on `LinksNotePanelTiptap`: ensure entry context is passed, external links styled with `↗` arrow.
   - Link picker filters “Current Entry” vs “All Entries”.
   - On link creation: auto-create entry/workspace if linking to new category.
2. **Recent panel** shows entry + workspace badges; clicking switches entry context before opening workspace.
3. **Continue panel** reads last workspace per entry (persisted per entry ID).

### Phase 4 – Backend & Persistence
1. **Entry-aware persistence**: ensure `note_workspaces.item_id` is set to category entry; enforce unique default per entry.
2. **Workspace creation**: require `item_id` (entry) and default to current entry from context.
3. **Dirty tracking & autosave**: leverage existing per-workspace runtime ledger (per `merge_dashboard_workspace/IMPLEMENTATION_PLAN.md`).
4. **Link creation**: API endpoint to create entry+dashboard when linking to new category (same flow as Quick Links demo `createEntryForWorkspace`).

### Phase 5 – Testing & Rollout
1. **Feature flag**: `KNOWLEDGE_BASE_HIERARCHY` to toggle new UI.
2. **Unit tests**:
   - Entry service (creation, grouping, dashboard seeding).
   - Quick Links extension for external link classification.
3. **Integration tests**:
   - Creating a link to new entry -> dashboard seeded -> navigation works.
   - Sidebar selection -> workspace context switches.
4. **Docs & Demo**: update `/docs/proposal/.../dashboard-v4-unified-canvas.html` to match shipped behavior.

## Dependencies
- `merge_dashboard_workspace/IMPLEMENTATION_PLAN.md` – provides unified dashboard/workspace embed and view mode infrastructure.
- Entry context utilities (`lib/entry/entry-context.ts`), workspace runtime ledger, Quick Links TipTap extension.

## Open Questions
- Should category list be user-editable (rename, reorder) or seeded only?
- Do we need per-category permissions/visibility?
- How to handle migrating existing “Legacy Workspaces” into Knowledge Base categories?

## Next Steps
1. Sign off on schema additions and migration order.
2. Implement Phase 1 and Phase 2 in parallel (schema + UI scaffolding).
3. Integrate Quick Links/Recent/Continue (Phase 3) once entry context flows through runtime.
4. Coordinate testing + rollout under feature flag.
