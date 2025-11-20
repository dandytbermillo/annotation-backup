# Consistent Note/Panel Deletion Plan

Goal:  ensure deleting a note (or non-main panel) cannot reappear after reload across all modes (plain/Yjs, online/offline). Applies soft-delete by default with consistent filtering.

Applicability of isolation/reactivity anti-patterns: not applicable here; we are designing API/persistence flows, not changing provider/consumer contracts or reactive hooks.

Scope
- Canonical delete path for notes and panels (Phase 1 APIs, plain/Yjs parity).
- Persistence: items, notes, panels, document_saves, offline_queue/Yjs updates.
- Reads: search/tree/recent/canvas/panels endpoints respect deleted_at.

Out of scope
- Hard-delete migration of historical data (can be optional cleanup).
- UI redesign; only wiring to the canonical delete endpoint/flag.

Plan
1) Decide delete semantics
   - Choose soft delete by default (set deleted_at on items, notes, panels, document_saves rows tied to the note/panel). Allow optional hard delete for test/cleanup.
   - Define a single API surface: DELETE /api/notes/:id (note-level) plus DELETE /api/canvas/panels/:panelId (panel-level) or a consolidated “delete panel(s)” body on the note endpoint.
2) Schema/state audit
   - Confirm deleted_at columns exist on items/notes/panels/document_saves; if missing, add migrations.
   - For Yjs/offline: specify a tombstone marker in the Yjs metadata and ensure offline_queue entries for the note/panels are purged/marked deleted.
3) API updates (server)
   - Implement note delete (soft) that, in one transaction:
     - Marks items row deleted_at.
     - Marks notes row deleted_at.
     - Marks panels for that note deleted_at (or deletes rows).
     - Marks document_saves for that note (and panels) deleted_at or deletes rows.
   - Panel delete: mark panel deleted_at (and optionally related saves) when deleting a non-main panel.
   - Workspace scoping: honor x-overlay-workspace-id and app.current_workspace_id; return 404 if workspace mismatch.
4) Read filtering
   - Ensure all note/panel/item fetchers filter deleted_at IS NULL: tree/search/recent, canvas/panel loaders, overlay endpoints, versions/history reads if applicable.
   - For Yjs/plain load paths, guard against resurrecting soft-deleted docs (skip hydration if tombstoned).
5) UI wiring
   - Route active UI to the canonical delete endpoint(s); remove/guard deprecated delete flows (Phase1 explorer, floating widget, etc.).
   - When deleting a non-main panel, call the panel delete API or include panel IDs in the note delete payload.
6) Offline/Yjs parity
   - On delete, enqueue a delete/tombstone entry so offline replay does not recreate the doc/panel.
   - Have the provider drop subdocs and cache entries when tombstoned; skip sending updates for deleted docs.
7) Verification
   - Add regression test: create note + panel, delete via API, reload data (items/notes/panels fetchers) -> empty; no document_saves rows returned.
   - If offline: simulate queue replay to confirm tombstones prevent recreation.
   - Manual: delete note/panel, hard refresh, verify absent in tree/search/recent and canvas.

Follow-through checklist (post-implementation)
- Read-path audit: verify deleted_at filtering on all loaders (tree/search/recent, canvas/panel endpoints, overlay fetchers, search endpoints).
- UI entry points: ensure every delete trigger (toolbar, context menus, legacy explorers/widgets) calls the canonical delete; remove/guard partial/local-only paths.
- Panel-only delete: if direct panel deletes are exposed, add API usage and a regression test to confirm panels stay deleted and don’t hydrate.
- Offline/Yjs: propagate deletes as tombstones/offline-queue removals so replay cannot resurrect deleted docs/panels.

Risks/mitigations
- Partial deletes across tables: wrap in one transaction and roll back on any failure.
- Workspace leakage: enforce workspace_id in all delete/read queries.
- Offline replay resurrecting data: tombstone in Yjs/offline_queue and skip hydration for tombstoned docs.
