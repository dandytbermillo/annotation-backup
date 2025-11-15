# Note Canvas Workspaces Implementation Plan

Goal: extend the existing workspace concept to the note canvas so users can snapshot/restore sets of open notes, panel positions, and canvas transforms independently from the overlay popups.

---

## 0. Pre-flight & Constraints

- Read `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md` before touching shared context/store hooks.
- Keep the new functionality behind `NEXT_PUBLIC_NOTE_WORKSPACES` until soak testing completes.
- The note workspace system does **not** need to stay in sync with overlay workspaces; they are independent.
- We must not regress the current single-workspace experience—if the flag is `disabled`, the app should behave exactly as today.

---

## 1. Data Model & API

### 1.1 Schema & Ownership
- **Owner:** Backend Platform team (same owners as overlay layout storage). Coordinate via ticket `BE-Workspace-Notes-001` and ensure migrations land before FE merges.
- Add `note_workspaces` table with columns:
  - `id` UUID primary key (generated in DB)
  - `user_id` UUID (foreign key to users/account table)
  - `name` TEXT NOT NULL DEFAULT 'Workspace'
  - `payload` JSONB NOT NULL (see payload shape below)
  - `revision` TEXT NOT NULL (for optimistic concurrency, e.g., ULID)
  - `created_at`, `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()
  - `is_default` BOOLEAN NOT NULL DEFAULT false
- Migration requirements:
  - Add unique `(user_id, is_default=true)` constraint so only one default per user.
  - Seed a default workspace per user lazily when first requested (via API).
  - Ensure payload column uses `jsonb` with GIN index on `payload->'openNotes'` for future analytics (optional).
- Payload shape (mirrors current client state):
  ```ts
  type NoteWorkspacePayload = {
    schemaVersion: '1.0.0'
    openNotes: Array<{
      noteId: string
      position: { x: number; y: number }
      size: { width: number; height: number }
      zIndex: number
    }>
    activeNoteId: string | null
    camera: { x: number; y: number; scale: number }
    toolbarOrder: string[] // optional, for pinned/main panel ordering
  }
  ```

### 1.2 API Endpoints & Contracts
- All routes scoped to authenticated user; reuse the same auth middleware as overlay endpoints.
- Clients send/receive `revision` headers (`If-Match` on save, `ETag` on fetch) to prevent clobber.
- Endpoints:
  - `GET /api/note-workspaces`: returns `{ workspaces: Array<{ id, name, isDefault, updatedAt, noteCount, revision }> }`.
  - `POST /api/note-workspaces`: body `{ name?: string, payload: NoteWorkspacePayload }`, returns created workspace summary + revision.
  - `GET /api/note-workspaces/:id`: returns `{ workspace: { id, name, payload, revision } }`. 404 if not found or not owned by user.
  - `PATCH /api/note-workspaces/:id`: headers `If-Match: <revision>`, body `{ payload, name? }`, returns `{ workspace: { ... , revision: newRevision } }`. Respond 409 on revision mismatch, 404 on missing.
  - `DELETE /api/note-workspaces/:id`: returns 204 on success; force 422 if deleting default workspace.
- Error payloads mirror overlay adapter (`{ error: string, reason?: string }`).

### 1.3 Adapter Layer (Client)
- Add `lib/adapters/note-workspace-adapter.ts` exporting methods:
  - `listWorkspaces(): Promise<WorkspaceSummary[]>`
  - `loadWorkspace(id): Promise<{ payload, revision }>`
  - `saveWorkspace({ id, payload, revision }): Promise<{ revision }>`
  - `createWorkspace({ name, payload })`
  - `deleteWorkspace(id)`
- Adapter is responsible for attaching auth headers, `If-Match`, and mapping HTTP errors to typed errors (e.g., `NoteWorkspaceConflictError`).

---

## 2. Client Persistence

### 2.1 Hooks & State
- Add `useNoteWorkspacePersistenceRefs` mirroring overlay (adapter ref, layoutLoadedRef, revisionRef, lastSavedPayloadHashRef, pendingPayloadRef, saveTimeoutRef, dirtyRef, loadStartedAtRef).
- Build `useNoteWorkspacePersistence` hook with the following contract:
  - Inputs: feature flag, current `noteLayoutState` (see serialization below), `layerContext`, `toast`, `debugLog`.
  - Outputs: `{ loadWorkspace(id), currentWorkspaceId, setCurrentWorkspaceId, createWorkspace(), deleteWorkspace(), scheduleWorkspaceSave(opts) }`.
  - `loadWorkspace(id)`: fetch payload via adapter, set refs, hydrate layout via callbacks (see 2.2), log `note_workspace_load_start/finish`.
  - `scheduleWorkspaceSave({ immediate?: boolean })`: serialize payload, compare hash vs. last saved; if changed, enqueue save (debounced 2.5s, immediate on create/delete), send to adapter with revision; update refs upon success, handle conflict by reloading payload.
  - Hook listens to note layout change events and marks `dirtyRef` to trigger saves after interactions.

### 2.2 Serialization & Hydration Details
- Define `serializeNoteLayoutState(state)` inside hook:
  ```ts
  type SerializedNoteState = {
    schemaVersion: '1.0.0'
    openNotes: Array<{
      noteId: string
      position: { x: number; y: number }
      size: { width: number; height: number }
      zIndex: number
      isPinned: boolean
    }>
    activeNoteId: string | null
    camera: { x: number; y: number; scale: number }
    selection: string[] // optional multi-select
  }
  ```
- `useWorkspacePanelPositions` exposes callbacks `onPanelsHydrated(serializedState.openNotes)` and `onPanelStateChange(nextState)` to/from persistence.
- `useWorkspaceCanvasState` exposes `applyWorkspaceCamera(camera)` and `subscribeToCameraChanges(cb)` so persistence can track `overlayCameraFromUserRef` analog for notes.
- Toolbar state (`useWorkspaceToolbarProps`) consumes `openNotes` order from persistence; when notes are opened/closed, it notifies the hook so payload updates.
- Autosave/throttling: reuse overlay pattern (2.5 s debounce, immediate save on add/remove note). Hook clears pending saves when dragging/resizing to avoid churn.

### 2.3 Flag-off Behavior
- If `NEXT_PUBLIC_NOTE_WORKSPACES` is `disabled` or API unavailable, hook short-circuits: returns stubbed API (workspace list = single default), `scheduleWorkspaceSave` no-ops, and existing state hooks operate as they do today.

---

## 3. UI/UX

### 3.1 Toggle / Menu
- **Placement:** top-left of the note canvas header, immediately left of the existing note toolbar. Overlay toggle stays in the center/top of the overlay layer, so the two do not overlap.
- Extend `WorkspaceToggleMenu` with `variant="note"` to adjust copy: prefix label "Note Workspace" and use an icon (e.g., 📝) to differentiate.
- States to support:
  - Closed pill: shows `workspaceName`, dropdown chevron, `+` button.
  - Open menu: list of workspaces with rename inline (text input) and delete button.
  - Disabled state: when API unavailable or flag off, the pill is hidden entirely.

### 3.2 Workspace List UX
- Each row: name, open-note count, last updated (relative), active indicator.
- Buttons: rename (pencil icon, inline edit), delete (trash, disabled for default), duplicate (optional later).
- New workspace modal: prompts for name (default “Workspace N”), optional description.
- QA spec: document all states (empty list, list with >5 items, deleting while saving).

### 3.3 Status/Feedback
- Under the toggle, show status chip: “Hydrating note workspace…”, “Note workspace synced at HH:MM”, “Saving…”. Use same typography as overlay status chip.
- When autosave in flight, show spinner icon within chip. When error occurs, chip turns red with “Sync failed – retry”.

---

## 4. Feature Flag & Rollout
- Flag: `NEXT_PUBLIC_NOTE_WORKSPACES` (default `disabled`). When `enabled`, mount the new hook + UI; when `disabled`, do not render the toggle and skip API calls.
- Rollout plan:
  1. Ship behind flag → enable locally/staging → QA manual flows (create, switch, delete, autosave).
  2. After QA, enable for canary users, monitor telemetry (load/save success, payload size, autosave latencies).
  3. Kill switch / fallback: client checks flag **and** API health. If `listWorkspaces` fails (network/404/500), log warning, hide the note workspace toggle, and fall back to a single in-memory workspace (current behavior). Display toast “Note workspaces unavailable; saving disabled” once per session.

---

## 5. Telemetry
- Events to log via `debugLog` (structure mirrors overlay telemetry):
  - `note_workspace_load_start` `{ workspaceId, requestedAt, trigger: 'app_load' | 'user_switch' }`
  - `note_workspace_load_finish` `{ workspaceId, durationMs, noteCount, cameraApplied: boolean, error?: string }`
  - `note_workspace_save_start` / `finish` `{ workspaceId, dirtyFields: string[], durationMs, payloadBytes }`
  - `note_workspace_user_switch` `{ fromWorkspaceId, toWorkspaceId, noteCountBefore, noteCountAfter }`
- Emit Grafana metrics for API latency (`note_workspace_api_latency_ms`) and error counts. Ensure no PII (workspace names hashed client-side if needed).

---

## 6. Testing Plan

### Unit
- `useNoteWorkspacePersistence` tests: hydrate no state, hydrate with payload, skip apply on stale revision, mark dirty when open notes change.
- Adapter tests with mocked fetch to ensure revision headers handled.

### Integration / Playwright
- Add `playwright/note-workspace.spec.ts` with deterministic flows:
  1. **Hydration parity:** stub `/api/note-workspaces/:id` to return two different payloads (A/B). Open app, switch from default (A) to workspace B; assert that the set of `.note-panel` elements matches payload B (IDs, positions within ±2px, zoom). Switch back to A and re-assert.
  2. **Autosave:** stub `PATCH /api/note-workspaces/:id` and intercept requests. Drag a note, wait for debounce; verify request payload contains updated coordinates and fires within 3 s of drag end.
  3. **Delete fallback:** create a workspace via API, delete it from menu, assert list count decreases and default workspace becomes active (chip shows “Default”).

### Manual QA
- Short checklist: create, rename, delete workspace; autosave on layout change; ensure flag-off build behaves exactly like before.

---

## 7. Dependencies & Risks
- Requires backend work (schema + API). Coordinate with BE to ensure migrations run before feature flag is turned on.
- Payload size risk: large numbers of open notes could lead to large JSON; consider trimming unused fields or compressing.
- Interaction risk: ensure note workspace switching doesn’t conflict with overlay workspace auto-switch logic (e.g., layerContext gestures). Keep the two toggles visually distinct to avoid confusion.

---

## 8. Follow-ups / Nice-to-haves
- Eventually allow linking note + overlay workspaces (toggle to "Sync overlay to note workspace"), but out of scope for the initial milestone.
- Provide optional "duplicate workspace" action to fork layouts.
- Consider server-side validation to cap number of saved workspaces per user.
