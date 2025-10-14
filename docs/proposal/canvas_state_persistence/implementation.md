# Canvas State Persistence — Implementation Plan

## Objectives
- Preserve every panel’s position, dimensions, and metadata when a note loads, reloads, or resumes after offline work.
- Ensure drag-and-drop interactions continue to feel instantaneous while the authoritative canvas layout is durably stored.
- Support collaboration modes (plain/Yjs) without breaking existing consumers of `dataStore`, `branchesMap`, or `LayerManager`.

## Current Behaviour
- Drag finalization already writes the latest `{ x, y }` into in-memory stores (`components/canvas/canvas-panel.tsx:1872-1913`), but nothing persists beyond the runtime session.
- Camera pans are tracked through `useCanvasCamera` (`lib/hooks/use-canvas-camera.ts:33-79`), yet those translated coordinates are not flushed to the backend.
- On note open, panels hydrate from defaults or embedded note payloads; if the session had been customized, the layout resets because no persisted source exists.

## Requirements
1. **Single Source of Truth:** The backend (or synced storage layer) must hold canonical panel records per note and revision.
2. **Granular Updates:** Persist at drag end (and on metadata edits) without blocking the UI. Batch updates when many fields change together.
3. **Offline Tolerance:** Queue mutations locally when offline, replay once connectivity restores, and avoid duplicate writes.
4. **Deterministic Hydration:** Canvas should render only after persisted panel data is loaded (or explicitly sit in a guarded “layout loading” state to avoid a flash of defaults).
5. **Backwards Compatibility:** Existing notes without layout records should continue to center panels via current defaults.
6. **Coordinate Consistency:** Persist world-space values (independent of zoom/viewport) with a defined coordinate system so reloads render identically.

## Data Model (Backend)
| Column             | Type     | Notes                                                                 |
|--------------------|----------|-----------------------------------------------------------------------|
| `id`               | UUID     | Stable panel identifier                                               |
| `note_id`          | UUID     | Foreign key to note                                                   |
| `position_x_world` | numeric  | World-space px (camera-adjusted canvas coordinate, zoom-invariant)    |
| `position_y_world` | numeric  | Same units as `position_x_world`                                      |
| `width_world` / `height_world` | numeric | **Required** — dimensions in world units (`screen / zoom`; defaults by panel type) |
| `z_index`          | integer  | For ordering; default to created order                                |
| `panel_type`       | text     | ENUM-like string stored in the existing `panels.type` column (`editor`, `branch`, `context`, …); use `CHECK (panel_type = ANY('{editor,branch,context,toolbar}'::text[]))` |
| `metadata`         | JSONB    | Extra fields (collapsed, color, tags, etc.)                           |
| `updated_at`       | timestamp| Optimistic concurrency / conflict detection                           |
| `updated_by`       | UUID     | For audit trails                                                      |
| `revision_token`   | text     | Monotonic version used for causality/conflict resolution              |
| `schema_version`   | integer  | Layout schema version (default 1). Required for future migrations.    |

*If multi-user editing is live, store revision hashes to detect merge conflicts.*
*`width_world` / `height_world` are NOT NULL with panel-type defaults (main: 600×800, branch: 400×300, annotation: 350×250); migrate legacy rows by backfilling defaults before enabling persistence writes.*

### Camera State (per note / per user)
| Column        | Type     | Notes                                                         |
|---------------|----------|---------------------------------------------------------------|
| `note_id`     | UUID     | Foreign key to note                                           |
| `user_id`     | UUID     | Null for shared camera, or user-specific for personal viewport|
| `camera_x`    | numeric  | Canvas translateX at save time (screen px; the value applied to CSS transform) |
| `camera_y`    | numeric  | Canvas translateY at save time                                |
| `zoom_level`  | numeric  | Zoom factor (>=0.5, default 1.0)                              |
| `updated_at`  | timestamp| For merge ordering / auditing                                 |
| `schema_version` | integer | Camera schema version (default 1)                          |

## API Surface
1. `GET /api/notes/:noteId/canvas` → Returns `{ panels: PanelRecord[], globalRevision }`. Panels include their own `revisionToken`.
2. `PATCH /api/notes/:noteId/canvas` → Accepts partial updates, e.g. `{ panelId, position, metadata, expectedRevision }`; rejects stale per-panel revisions while optionally returning updated global revision.
3. `POST /api/notes/:noteId/canvas/batch` → Optional bulk endpoint for simultaneous moves/reorders. Each entry supplies its own `expectedRevision`, and the response reports per-panel success/conflict.
4. `DELETE /api/notes/:noteId/canvas/:panelId` → Soft-delete a panel record when removed so hydration doesn’t resurrect stale panels.
5. `GET /api/notes/:noteId/canvas/camera` → Returns `{ camera_x, camera_y, zoom_level, schemaVersion, source }` for the requester (user-specific if available, else shared, else `{ camera_x: 0, camera_y: 0, zoom_level: 1, schemaVersion: 1, source: 'default' }`). Always 200 OK.
6. `PATCH /api/notes/:noteId/canvas/camera` → Updates the caller’s camera state with optimistic concurrency on `updated_at` / `schemaVersion`. Missing records are auto-created.

All endpoints should validate IDs, coerce numbers, and ensure users have access to the target note.

## Client Flow

### Coordinate System
- World position is the panel’s intrinsic canvas coordinate (the value currently written to `style.left/top`). The canvas container renders panels via `transform: translate3d(translateX, translateY, 0) scale(zoom)`; because translation precedes scaling in the transform list, screen coordinates follow `(world + translate) * zoom`. Camera state persists those translation values directly: `camera_x = translateX`, `camera_y = translateY` (pixels in screen space).
- Conversion helpers:
  ```ts
  function screenToWorld(screen: XY, camera: XY, zoom: number): XY {
    return {
      x: screen.x / zoom - camera.x,
      y: screen.y / zoom - camera.y
    }
  }
  function worldToScreen(world: XY, camera: XY, zoom: number): XY {
    return {
      x: (world.x + camera.x) * zoom,
      y: (world.y + camera.y) * zoom
    }
  }
  function sizeScreenToWorld(size: XY, zoom: number): XY {
    return { x: size.x / zoom, y: size.y / zoom }
  }
  function sizeWorldToScreen(size: XY, zoom: number): XY {
    return { x: size.x * zoom, y: size.y * zoom }
  }
  ```
- All client stores (`dataStore`, `branchesMap`, `LayerManager`) hold world-space position/size values. Rendering converts to screen space with the helpers above.
- Camera state (`camera_x`, `camera_y`, `zoom_level`) is persisted alongside the layout so world ↔ screen conversions faithfully restore both layout and viewport during hydration.

### Hydration
1. When `annotation-canvas-modern` mounts (or note switches), cancel any in-flight hydration request via `AbortController`, record the target `noteId`, enter a `layoutLoading` state, and fetch layout + camera state in parallel with a 10 s timeout. Render a skeleton/loader instead of default panels until the payload arrives (or timeout fires).
2. After the fetch resolves, verify the active `noteId` still matches the requested note to avoid seeding stale data. Seed `dataStore`, `branchesMap`, and `LayerManager` directly with the world-space coordinates/dimensions returned by the API.
3. If the payload is empty, fall back to current defaults **once**, mark the note as needing persistence setup, and immediately enqueue a baseline persistence write so future loads have data.
4. Validate incoming data (finite numbers, reasonable bounds, positive dimensions). If dimensions are ≤0, substitute panel-type defaults (main: 600×800, branch: 400×300, annotation: 350×250) and log a warning. Legacy records that are null should be upgraded on write.
5. Timeout handling: on timeout, check cached layout **and camera**. If both are cached (<7 days) hydrate from cache (`layoutSource: 'cache-stale'`) and continue the fetch in the background to refresh layout + camera. If only layout is cached, hydrate the layout but fall back to default camera (logging a warning). If nothing is cached, load defaults (`layoutSource: 'defaults'`) and log telemetry. When the background fetch completes and the returned `globalRevision` differs from the cached version, update the cache and surface a toast prompting the user to refresh; defer automatic re-render to avoid snapping mid-interaction.

### Rendering & Zoom Changes
- Components treat store values as world-space. On render they read the current camera/zoom from context and compute `const screenPos = worldToScreen(panel.positionWorld, camera, zoom)` (and the same for size) before applying CSS. This keeps store values zoom-invariant.
- Zoom/camera updates propagate through context, triggering React re-renders. No store mutation is required; components recompute screen-space values on the next render. If a store consumer needs derived screen coordinates outside render, use memoized selectors that recompute when camera/zoom state changes.

### Camera Persistence Timing
- Debounce camera persistence: subscribe to changes in `canvasState.translateX/translateY/zoom`, and schedule a PATCH after 500 ms of inactivity. Flush immediately when a drag/zoom gesture ends and when the note unmounts.
- Skip redundant writes by comparing against the last persisted `{ camera_x, camera_y, zoom_level }`. If the delta is <0.5 px or <0.01 zoom units, drop the update.
- Offline fallback mirrors the panel queue: enqueue camera updates in IndexedDB with the latest value and replay on reconnect (last-write-wins per note/user).
- The camera PATCH endpoint auto-creates missing rows so the first write succeeds without extra reads.

### Drag & Metadata Updates
1. **Drag end path:** Extend the existing `drag_end` handler (`components/canvas/canvas-panel.tsx:1872-1913`) to capture final world-space values (the DOM `style.left/top` that already exclude camera transforms). Wrap subsequent store mutations in a `StateTransaction`. The transaction applies updates to `LayerManager`, `dataStore`, and `branchesMap` atomically, invokes the persistence enqueue, and only rolls back on hard failures (e.g., server rejects payload). For network/offline timeouts, keep the optimistic state and enqueue the edit for later replay.
   ```ts
   const txn = new StateTransaction()
   txn.add('layerManager', panelId, { position: finalWorld, size: finalWorldSize })
   txn.add('dataStore', panelId, { position: finalWorld, size: finalWorldSize })
   txn.add('branchesMap', panelId, { position: finalWorld, size: finalWorldSize })
   await txn.commit(() =>
     enqueuePersistence({
       panelId,
       positionWorld: finalWorld,
       sizeWorld: finalWorldSize,
       expectedRevision
     })
   )
   ```
   Use `screenToWorld` / `sizeScreenToWorld` helpers when deriving coordinates from pointer deltas (screen space). When reading from `panel.style.left/top`, the values are already world-space and can be used directly.
2. **Batching:** Use a requestAnimationFrame or microtask batcher to combine multiple panel updates (e.g., while auto-scroll pans everything). Cap batch size (e.g., 20 panels) so payloads stay manageable, and record per-panel revision tokens.
3. **API call & rate limiting:** Route persistence through a rate-limited queue (e.g., ≤3 concurrent requests, ≥100 ms spacing) to avoid spamming the backend. Retry transient failures with exponential backoff; if the retry window expires, mark the edit offline and leave the optimistic state in place.
4. **Offline queue:** Persist failed/queued mutations in IndexedDB (`canvas-persistence-queue`). Deduplicate by panel (keep latest intent) and enforce queue limits (e.g., 1 000 entries or 5 MB). Store `{ queuedAt, expectedRevision, action }`.
5. **Replay:** Before replaying, fetch latest server state (layout + camera). Drop queued edits older than the server’s `updated_at`, retain only the latest per panel, and apply in delete → create → update order so deletes win.
6. **Conflict handling:** If a PATCH response reports conflicts, refetch conflicted panels, reconcile via policy (delete > newest timestamp > current user if timestamps close), gently nudge overlaps, update local stores via a transaction, and requeue remaining edits with fresh revisions.
7. **Confirmation:** On success, update local revision tokens/`updated_at` to match server responses.

### StateTransaction Contract
```typescript
interface StateTransaction {
  /**
   * Record an atomic update. Captures the previous store value so a rollback can restore it.
   */
  add(store: 'dataStore' | 'branchesMap' | 'layerManager', id: string, update: Partial<PanelState>): void

  /**
   * Applies all queued updates, then invokes persistFn.
   * - Hard failures (HTTP 4xx/5xx except timeouts) trigger rollback and rethrow.
   * - Soft failures (network timeout, offline) keep optimistic state; the caller queues an offline edit.
   */
  commit(persistFn: () => Promise<void>): Promise<void>

  /**
   * Restores all stores to their captured pre-transaction values. Normally called internally on hard failure.
   */
  rollback(): void
}
```
Implementation sketch:
```typescript
class StateTransactionImpl implements StateTransaction {
  private updates: Array<{ store: StoreAPI; id: string; oldValue: any; newValue: any; applied: boolean }> = []

  add(storeName, id, update) {
    const store = resolveStore(storeName)
    const oldValue = store.get(id)
    this.updates.push({ store, id, oldValue, newValue: update, applied: false })
  }

  async commit(persistFn) {
    for (const update of this.updates) {
      update.store.set(update.id, { ...update.oldValue, ...update.newValue })
      update.applied = true
    }
    try {
      await persistFn()
    } catch (error) {
      if (isHardFailure(error)) {
        this.rollback()
        throw error
      }
      // Soft failure: optimistic state stays; caller enqueues offline edit.
    }
  }

  rollback() {
    for (const update of [...this.updates].reverse()) {
      if (update.applied) {
        update.store.set(update.id, update.oldValue)
      }
    }
  }
}
```
Store helper wiring:
```ts
type StoreAdapter = { get(id: string): any; set(id: string, value: any): void }

const storeAdapters: Record<'dataStore' | 'branchesMap' | 'layerManager', StoreAdapter> = {
  dataStore: {
    get: id => dataStore.get(id),
    set: (id, value) => dataStore.set(id, value)
  },
  branchesMap: {
    get: id => branchesMap.get(id),
    set: (id, value) => branchesMap.set(id, value)
  },
  layerManager: {
    get: id => layerManager.getNode(id),
    set: (id, value) => layerManager.updateNode(id, value)
  }
}

function resolveStore(storeName: 'dataStore' | 'branchesMap' | 'layerManager'): StoreAdapter {
  return storeAdapters[storeName]
}

function isHardFailure(error: unknown): boolean {
  if (error instanceof Response) {
    return error.status >= 400 && error.status !== 408 && error.status !== 429
  }
  if (error instanceof Error && 'status' in error) {
    const status = Number((error as any).status)
    return Number.isFinite(status) && status >= 400 && status !== 408 && status !== 429
  }
  return false
}
```
`resolveStore` and `isHardFailure` must be defined in the same module that instantiates the transaction so the adapters have access to the live store singletons.

### Note Creation & Reopen
- Creating a note should provision an empty canvas set; the first panel insert persists immediately, preventing future loads from defaulting to empty layouts. Initialize camera state to `{ camera_x: 0, camera_y: 0, zoom_level: 1 }`.
- Reopening a note hydrates from both the saved layout and camera state; ensure the code path never wipes `dataStore` before the fetch resolves (gated by `layoutLoading`). If a user opens while offline, hydrate from the most recent cached dataset (layout + camera) and flag mismatches once connectivity returns.
- In multi-user scenarios, default to a shared camera if no per-user record exists; otherwise persist per-user camera to keep viewport personal.

## Offline & Conflict Handling
- Persist to a local queue (`canvasPersistenceQueue`) whenever the `PATCH` fails or offline mode is detected, capturing `{ panelId, action, payload, expectedRevision, queuedAt }`.
- Replay queued jobs after fetching current server timestamps. Prune stale entries (queued before server `updated_at`) and deduplicate to the latest per panel before applying delete → create → update.
- If the server responds with a conflict (stale `expectedRevision`), refetch the affected panels, reconcile (delete wins, otherwise newest timestamp unless timestamps are nearly equal and current user should prevail), gently nudge conflicting panels if both changes must persist, and requeue unresolved edits with fresh revisions.
  - Surface a toast/UI banner when merges adjust the user’s layout so they know we reconciled changes.

## Migration Plan
1. **Schema Migration:** Add the `canvas_panels` table (or extend existing `panels` table) with world-space position fields, revision token, and schema version.
2. **Backfill (opt-in):** Do not run blind backfill. Instead:
   - Offer an explicit “Save current layout” action so users capture existing arrangements.
   - Optionally auto-capture when a note loads client-side and layout data is missing, storing it immediately.
   - Maintain a `canvas_panels_history` table (e.g., 7‑day retention) to support rollback if needed.
3. **Client Release:** Roll out hydration, camera persistence, transaction-backed updates, and collaborative locking directly (no feature flags). Monitor telemetry for API error rates, replay success, lock conflicts, and dropped batches; pause deployment if anomalies spike.
4. **Cleanup:** Once stable, remove legacy assumptions that panels start centered on load.

## Testing Strategy
- **Unit Tests:** 
  - Verify `PATCH` payload construction per panel update.
  - Ensure offline queuing stores mutations with correct data and clears after replay.
- **Integration Tests:** 
  - Simulate drag + reload to confirm layout persists without a flash of centered panels.
  - Validate conflict resolution by forcing overlapping edits and verifying the merge UI feedback.
- **E2E Smoke:** 
  - Drag multiple panels, refresh, confirm layout matches.
  - Toggle plain vs Yjs modes to ensure hydration works consistently.
- **Performance Benchmarks:** Establish guardrails (e.g., hydrate ≤50 panels <500 ms, ≤200 panels <2 s with virtualization) and rate-limit tests (≤20 updates per batch <200 ms). Replay 1 000 queued edits <10 s.

## Telemetry & Observability
- Log `canvas_layout_persisted` with panel count, elapsed time, and offline fallback usage.
- Alert on persistence failure rates above SLA thresholds.
- Track `hydration_latency_ms` to ensure the canvas appears promptly.
- Record `camera_state_restored` events to measure how often per-user viewports are restored vs falling back to defaults, and monitor lock acquisition/timeout metrics.

## Collaborative Safety
- On drag start, emit a `panel:lock` event (WebSocket or equivalent) containing `{ noteId, panelId, userId, username, timestamp }`. Other clients disable drag for that panel and display an overlay (“username is editing…”).
- Unlock on drag end or after a 30 s inactivity timeout to prevent stale locks. Retry lock emission if offline; skip persistence while locked by another user.
- Optionally broadcast intermediate positions for real-time previews; this can ship later once locking is stable.

## Open Questions
1. Should panel metadata (color, tags) share the same persistence endpoint or remain separate?
2. How should we expose collaborative locking states in the UI (toast, badge, overlay) for accessibility?
3. How should we migrate historical notes with no layout data but complex manual arrangements (auto-backfill vs user opt-in)?
4. Do we need audit logging of layout changes beyond existing telemetry, and if so, where does it live?

## Next Steps
1. Finalize schema changes with the backend team and scaffold API endpoints.
2. Implement the hydration + enqueue logic on the client, ship directly, and monitor rollout metrics closely to catch regressions early.
3. Write automated smoke tests to catch regressions before enabling the feature globally.
