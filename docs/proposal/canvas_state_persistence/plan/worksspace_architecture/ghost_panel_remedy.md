# Canvas Workspace – Architectural Hardening Plan

This supersedes the previous “Ghost Panel Confirmation” plan. Goal: eliminate ghost panels **and** simplify the architecture by enforcing a single source of truth with version handshakes and clear fallbacks.

---

## Phase 0 – Preconditions
- Confirm current close path writes `state='closed'` to `panels` and `canvas_workspace_notes`. (Completed in code: `handlePanelClose`, `closeNote`).
- Ensure tests cover closing the main panel, verifying DB row is `closed`.

---

## Phase 1 – Versioned Workspace Metadata
### 1.1 Schema Updates
- Add `version INTEGER NOT NULL DEFAULT 0` to `canvas_workspace_notes` (and optionally `panels`).
- Create per-note unique index (`UNIQUE (note_id)` already exists) and trigger to maintain version monotonicity.

### 1.2 Write Path
- Wrap panel close actions in a transaction:
  ```sql
  BEGIN;
  UPDATE panels SET state='closed', updated_at=NOW(), revision_token = revision_token::int + 1
    WHERE note_id=$1 AND panel_id=$2;
  UPDATE canvas_workspace_notes SET is_open=false, version = version + 1
    WHERE note_id=$1;
  COMMIT;
  ```
- On success, remove `localStorage.note-data-$noteId` (invalidate cache).
- On reopen, increment version and re-save snapshot after fetching fresh server state.

### 1.3 Read Path
- Extend `GET /api/canvas/workspace` and hydration payloads to include `version`.
- When hydrating plain mode:
  1. Load `localStorage` entry (if exists) → check embedded `version`.
  2. Fetch workspace version from server.
  3. If `snapshot.version === server.version`, use cache; else discard cache and load server panels.
- Memoize version per note in memory to avoid repeated checks during the session.

### Deliverables
- DB migration scripts (up/down).
- Unit tests for version increment on close/reopen.
- Integration test: close panel → verify `version` increments → reload with stale snapshot → cache ignored.

---

## Phase 2 – Cache Simplification
### 2.1 Evaluate Local Snapshot Necessity
- Measure cold load time from server (without snapshot). If acceptable, plan to drop localStorage entirely.
- If snapshot retained, enforce:
  - Stored as `{ version, panels, savedAt }` (no other data).
  - Global TTL (e.g., 24 hours) to auto-expire old caches.

### 2.2 IndexedDB Queue Review
- Audit `canvasOfflineQueue` usage for panel persistence.
- Ensure replays respect the new `version` (include it in payload) to avoid stale writes.
- Consider eliminating offline queue if product requirements allow; otherwise align it with versioned writes (queue should read latest version before patching).
- Evaluation summary (metrics + decision): `phase2-evaluation.md`.

### Deliverables
- Performance metrics (with and without snapshot).
- Decision: keep or remove snapshot + queue. Document rationale.
- Adjusted code with TTL / version enforcement if snapshot remains.

---

## Phase 3 – Automated Reconciliation (No User Prompt)
Assuming versions are in place:

- Hydration flow:
  1. Fetch server state (panels + version).
  2. If snapshot.version matches, hydrate from snapshot; else use server state.
  3. Apply server state to dataStore and re-save snapshot with new version.
- Remove the previously proposed banner; users are not forced to decide between caches.
- Log telemetry when cache is invalidated (helps monitor frequency).

### Deliverables
- Updated `CanvasProvider` flow (no banner).
- Telemetry events: `canvas.cache_mismatch`, `canvas.cache_used`, `canvas.cache_discarded` (implemented in `lib/canvas/canvas-storage.ts`).
- Automated test: stale snapshot silently replaced by server; ghost panel cannot reappear after reload.

---

## Phase 4 – Optional: CRDT Migration (Long-term)
If the product roadmap still targets collaborative editing: migrate canvas state to Yjs (Option B). Benefits: conflict-free replication, no manual version checks, real-time multi-user sync.
- Develop plan for migrating existing Postgres layout to Yjs documents.
- Run dual-write (Postgres + Yjs) during transition.

---

## Phase 5 – Monitoring & Ops
- Dashboard for version drift: alert if server sees repeated stale snapshots (indicates clients not respecting version checks).
- Error logging for version mismatches, cache discards, queue replay failures.
- Document recovery procedures (e.g., manual version reset, forced cache invalidation script).

---

## Summary Timeline
1. **Phase 1** – Add versions, transactional close, invalidate cache (critical path).
2. **Phase 2** – Decide snapshot/IndexedDB retention; enforce TTLs.
3. **Phase 3** – Simplify reconciliation (no end-user prompts).
4. **Phase 4** – Explore CRDT migration (optional).
5. **Phase 5** – Instrument & monitor.

This path removes the triple-cache anti-pattern, makes the server the enforced source of truth, and ensures ghost panels can’t resurrect—even before a CRDT migration.
