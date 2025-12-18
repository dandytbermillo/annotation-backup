# Implementation Plan: Offline Durable Queue (Workspaces)

**Date:** 2025-12-18  
**Scope:** Workspace state machine → make workspace writes durable offline (and readable offline) so hard-safe eviction does not block normal work.  
**Related systems:** Hard-safe 4-cap eviction, degraded mode, workspace persistence, Unified Offline Foundation (service worker + network service).  

## Policy / Guardrails

- **No silent data loss:** if we cannot make a change durable locally, we must not pretend it is saved.
- **Durable means “survives reload”:** offline durability requires storage beyond in-memory (use IndexedDB).
- **Preserve state, not behavior:** restore component/note state; do not auto-resume running operations after reload.
- **Avoid isolation/provider anti-patterns:** keep changes incremental, behind flags; avoid adding new cross-tree provider contracts without compatibility shims.

## Problem Statement

Today, when the browser is offline (or the API is unreachable), workspace “save” operations fail. Hard-safe eviction correctly blocks eviction when a dirty workspace cannot be saved, which can:

- Prevent cold opens and trigger degraded mode while offline.
- Cause “empty workspace” experiences on cold open because hydration fetch fails.

We need an offline-first durability layer so:

1. Workspace writes become **locally durable** even when offline.
2. Cold-open reads can fall back to locally durable snapshots.
3. When connectivity returns, changes replay to the server safely (with optimistic concurrency).

## High-Level Approach (Recommended)

Use a **Service Worker (SW) + IndexedDB durable queue** as the authoritative local “durability layer”, with:

- Write interception for workspace endpoints (PATCH/POST/DELETE as phased scope).
- Durable queue persisted in IndexedDB (not in-memory).
- Local “last durable snapshot” store per workspace for offline GET fallback.
- Cached workspace list fallback for offline startup (minimal: last known list).
- Replay engine with conflict detection (409/412) and safe stop-on-conflict behavior.

This is compatible with:

- Local DB via localhost API (DevTools offline still breaks fetch).
- Future cloud DB/API (intermittent network, background replay).

## Phase 0 — Confirm Integration Targets (1–2 hrs)

**Goal:** List the exact endpoints and payloads we must support.

- Identify workspace write endpoints to support first:
  - `PATCH /api/note-workspaces/:id` (save payload + revision via `If-Match`)
  - Optional later: `POST /api/note-workspaces` (create), `DELETE /api/note-workspaces/:id` (delete), rename.
- Identify workspace read endpoints for offline fallback:
  - `GET /api/note-workspaces/:id`
  - `GET /api/note-workspaces` (list) (**required for “reload while offline”**; otherwise the app cannot discover workspaces)

**Deliverable:** A short table (endpoint → method → request body → response shape → headers required).

## Phase 0.5 — Reality Check: Current Repo State (30–60 min)

**Goal:** Avoid surprise regressions when enabling `offline.swCaching`.

This repo already includes:
- A service worker at `public/service-worker.js` that can queue write requests **in memory** (`writeQueue`).
- A manager at `lib/offline/service-worker-manager.ts` gated by `offline.swCaching` (default OFF).

Important implications:
- The existing SW write-queue is **not durable** across reloads (in-memory only).
- The existing optimistic queued response is **generic** (does not return a `workspace` record), so enabling it for
  `/api/note-workspaces/**` without adjusting response shape can break adapter expectations.
- The SW currently intercepts **all same-origin write requests** (unless blocklisted), so v1 must explicitly scope
  interception to workspace endpoints to avoid unintended queuing across the app.

**Deliverable:** A short “ready-to-enable” checklist:
- SW interception scoped to `/api/note-workspaces/**`
- IDB queue enabled
- response compatibility for `NoteWorkspaceAdapter`

## Phase 1 — Define Durable Stores (IndexedDB) (0.5–1 day)

**Goal:** Persist both queued operations and the latest locally durable workspace snapshot.

Create an IndexedDB database (e.g., `annotation-offline-queue-v1`) with object stores:

1. `ops`
   - Key: `opId` (UUID)
   - Fields:
     - `url`, `method`, `headers`, `body`
     - `workspaceId` (derived from URL)
     - `createdAt`, `updatedAt`
     - `retries`, `lastError`
     - `baseServerRevision` (the `If-Match` revision the op is based on)
     - `status`: `queued | replaying | failed | conflict`

2. `workspaceSnapshots`
   - Key: `workspaceId`
   - Fields:
     - `payload` (the most recent locally durable payload)
     - `serverRevision` (last known good server revision; may be unchanged while offline)
     - `updatedAt`
     - `syncState`: `synced | pending | conflict`
     - `pendingOpIds` (optional index/denormalized list)

3. `workspaceIndex`
   - Key: `entryId` or a constant (e.g., `"last"`) depending on whether you want per-entry lists.
   - Fields:
     - `workspaces` (last known list response)
     - `updatedAt`

3. `meta`
  - SW versioning, schema version, last replay time, last successful sync time.

**Acceptance:**
- Queue and snapshots survive page reload and SW restart.
- Storage errors are surfaced (quota/IDB failure) and treated as “not durable”.

## Phase 2 — Service Worker: Durable Queue + Replay (1–2 days)

**Goal:** Make SW queuing durable and compatible with existing adapter expectations.

### 2.1 Interception Scope (Start Narrow)

Only intercept workspace endpoints initially:

- Intercept writes for `/api/note-workspaces/**`.
- Do not intercept unrelated writes until workspace flow is proven stable.

### 2.2 Write Handling Contract (Critical)

When offline/unreachable (network failure or fetch throws):

- Enqueue the operation in IndexedDB (must succeed before responding).
- Update `workspaceSnapshots` for the target workspace using the request payload.
- Return a **successful response** that is compatible with the existing client adapter parsing.

Compatibility requirement:
- The client adapter expects a `workspace` record on successful save. The SW response must include a `workspace` object even when queued.

Suggested offline response shape:
- Status `202 Accepted`
- JSON: `{ workspace: { id, revision, payload, updatedAt, ... }, offline: { queued: true, opId } }`

Notes:
- `revision` should remain the last known **server** revision (do not fabricate a server revision that would break future `If-Match` semantics).
- Treat both `409` and `412` as conflict responses during replay (different servers/frameworks use either).

### 2.3 Coalescing (V1 Required)

Autosave can generate many writes quickly. V1 should not enqueue every PATCH verbatim.

Recommended V1 rule:
- Maintain at most **one pending save** per workspace (latest-wins).
- Each new offline save:
  - overwrites `workspaceSnapshots[workspaceId].payload` (and updates `updatedAt`)
  - updates a single `ops` record for that workspace (same `opId`, bump `updatedAt`, reset retry metadata)

This keeps queue size bounded and reduces conflict surface area.

### 2.4 Read Fallback While Offline

When offline, for `GET /api/note-workspaces/:id`:

- If `workspaceSnapshots[workspaceId]` exists, return it (status `200`) from IndexedDB.
- If it does not exist, return a clear “offline and no cached data” response.

This prevents “workspace opens empty” when the workspace was previously loaded and has a locally durable snapshot.

Also support offline startup/discovery:

- For `GET /api/note-workspaces` while offline:
  - If `workspaceIndex` exists, return the last known list response (status `200`) with a marker like `{ offline: true }`.
  - If absent, return “offline and no cached list”.

### 2.5 Replay Engine

On reconnect (or manual sync):

- Process queued ops FIFO per workspace (or coalesced to latest per workspace).
- Send the original request to the server with the stored `If-Match` header.
- On success:
  - Remove op(s) from `ops`
  - Update `workspaceSnapshots.serverRevision` from the server response
  - Mark `syncState = synced` when no pending ops remain
  - Notify clients: `write-completed`
- On transient errors (network, 5xx, 429):
  - Retry with exponential backoff; keep queued
  - Notify clients: `write-failed` with retry metadata (optional)
- On conflict (409/412):
  - Mark `syncState = conflict` for the workspace
  - Stop replay for that workspace until resolved
  - Notify clients: `write-conflict` with details

**Acceptance:**
- Offline saves are queued durably and later replayed automatically when online.
- Conflicts never auto-overwrite; the system stops and asks for resolution.

## Phase 3 — App Integration (1–2 days)

**Goal:** Ensure the main app uses the SW queue in real navigation flows.

### 3.1 Initialize the Service Worker in the Main App

Currently SW init may only run in a test page. Add app-level init behind `offline.swCaching`:

- Initialize once per session.
- Keep a visible dev toggle via localStorage flags (existing `offlineFeatureFlags`).

### 3.2 Adapter Compatibility

Update `NoteWorkspaceAdapter` behavior to treat queued responses as success:

- Accept `202` responses with a `workspace` object.
- Do not assume server revision advanced while queued.

Also ensure list/load work when offline with SW fallback:
- `listWorkspaces()` should accept cached/offline list responses.
- `loadWorkspace()` should accept cached snapshot responses.

### 3.3 Persistence Semantics in Hard-Safe Eviction

After this phase:

- Offline persist should return “success (queued)”, allowing eviction without degraded mode.
- If queueing fails (IDB blocked/quota/SW unavailable), persist must return failure, preserving today’s hard-safe behavior.

### 3.4 UI: Sync Pending / Conflict

Add a lightweight status indicator:

- States:
  - `Synced`
  - `Offline (queued)`
  - `Syncing…`
  - `Conflict`
- Provide a “Sync now” action (calls SW `SYNC_NOW`).
- Provide a “Resolve conflict” entry point (v1 can be just a link/placeholder; actual resolution UI can follow).

**Acceptance:**
- Users can keep working offline without constant “save failed” toasts.
- Users can tell whether changes are fully synced or still queued.

## Phase 4 — Coalescing + Backpressure (0.5–1 day)

**Goal:** Add hard limits and “stop accepting writes” safety if storage grows unexpectedly.

- Apply limits:
  - Max ops per workspace
  - Max total queued bytes
  - On limit hit: block further “durable saves” (do not pretend success), surface UI warning.

## Phase 5 — Testing Plan (1–2 days)

### 5.1 Manual Tests (Workspace-Focused)

- Offline write durability:
  - Go offline → edit workspace → reload while offline → workspace still shows last durable state.
- Offline list durability:
  - Go offline → reload → workspace list still renders from cached list (if previously loaded online).
- Hard-safe eviction compatibility:
  - Go offline → dirty a workspace → open cold workspace past capacity:
    - Expected: no “save failed” eviction toast if queueing works; eviction proceeds using local durability.
- Replay:
  - Go back online → verify queued writes replay and server revision updates.
- Conflict:
  - Simulate conflict (stale revision) → ensure replay stops and UI shows conflict state.

### 5.2 Automated Tests (Pragmatic)

- Service worker unit tests are hard; prioritize:
  - E2E with Playwright offline mode (reusing `e2e/offline-foundation.spec.ts` patterns).
  - Integration tests for adapter behavior on `202` queued responses (mock fetch).

## Phase 6 — Rollout Strategy (0.5 day)

- Keep `offline.swCaching = false` by default until acceptance passes.
- Provide a dev toggle instruction:
  - `localStorage.setItem('offlineFeatureFlags', JSON.stringify({'offline.swCaching': true}))`
- Add telemetry:
  - queue depth
  - replay success/failure counts
  - conflict incidence
  - “queue not durable” error counts (IDB failures)

## Open Questions (Answer Before Coding)

1. **Offline create/delete/rename:** Do we support these in v1, or only PATCH saves?
2. **Offline list:** Should `/api/note-workspaces` list be cached/fallback, or accept “list unavailable offline” initially?
3. **Conflict UX:** Minimal v1 handling (block + banner) vs full merge UI.
4. **Security:** Are workspace payloads allowed to be stored unencrypted in IndexedDB on shared machines? (Browser-local is typically acceptable, but confirm.)

## Acceptance Criteria (V1)

- While offline, saving a workspace results in “queued” durability and does not trigger hard-safe eviction toasts during normal navigation.
- After reload while offline, the workspace list and previously visited workspaces restore from local durable cache (not blank).
- When online returns, queued writes replay and server state converges without silent overwrites.
- Conflicts stop replay and are surfaced clearly; no auto-overwrite in conflict state.
