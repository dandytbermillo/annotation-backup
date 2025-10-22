Update Ghost Panel Remedy Plan Based on Implementation Audit
Canvas Workspace – Architectural Hardening Plan (Revised)
This plan is updated to reflect the current implementation audit findings. It retains Phases 1–3, noting which parts are already in place and highlighting gaps to address.
Phase 0 – Preconditions
Confirm the current close path writes state='closed' to panels and sets canvas_workspace_notes.is_open to false. (Completed in code via separate calls: handlePanelClose updates panel state, closeNote updates workspace note; not yet done in one transaction or with any versioning.)
Ensure tests cover closing the main panel and verifying the DB row reflects a closed state. (Existing logic marks panels as closed and removes the note from the workspace.)
Phase 1 – Versioned Workspace Metadata
Goal: Introduce a version field to track each note’s workspace state, and use it to invalidate stale caches. Currently, no version field or logic exists in the DB, API, or client.
1.1 Schema Updates
Add a version INTEGER NOT NULL DEFAULT 0 column to canvas_workspace_notes. (No such field exists yet.) Optionally, add a similar version field to panels for completeness (though note-level version may suffice).
Ensure version monotonicity per note: Add or update the unique index on canvas_workspace_notes.note_id (one row per note) and create a DB trigger that prevents decreasing the version. This guarantees the version only ever increments for a given note.
1.2 Write Path (Closing and Reopening Notes)
Unify panel close actions in a single transaction. Currently, closing a note triggers two separate updates (mark panel closed, then mark note as not open) with no version bump. Replace this with one atomic operation that updates both the panel and the workspace note together and increments the note’s version. For example:
BEGIN;
UPDATE panels 
  SET state = 'closed', updated_at = NOW(), 
      revision_token = (revision_token::int + 1)::text 
  WHERE note_id = $1 AND panel_id = $2;
UPDATE canvas_workspace_notes 
  SET is_open = FALSE, version = version + 1 
  WHERE note_id = $1;
COMMIT;
(The above ensures the panel is tombstoned and the workspace version is bumped in one go. In current code this is not atomic — we need to implement this combined approach.)
On successful close, immediately invalidate any cached snapshot for that note. Clear the local storage entry for the note’s canvas state (panels and camera) so a “ghost” panel cannot persist in the cache. (Currently, the app does not explicitly remove the cache on close; it relies on a time-based TTL. We need to add explicit cache removal on close.)
On reopen, increment the version and refresh state. When a note is reopened in the workspace, treat it as a new session for that note: increment the canvas_workspace_notes.version and fetch the latest server state for the note’s panels. After loading the fresh state, save an updated snapshot to cache with the new version. (Currently, no version handling occurs on reopen — this will be newly implemented alongside the version field.)
1.3 Read Path (Hydration with Version Check)
Extend the GET /api/canvas/workspace response to include the workspace version for each note. The server should return the current version number for each open note. (At present, the API does not provide any version, so the client cannot detect stale data.)
Implement client-side version reconciliation during hydration:
When the app starts, attempt to load the note’s saved workspace snapshot from local storage (if it exists) and read its stored version. (Currently, the app does use a local cache but has no version field to compare.)
Fetch the latest workspace state and version from the server for that note (this can be a lightweight call if only version is needed, or part of the normal hydration fetch).
Compare the two versions: if the local snapshot’s version matches the server’s version, the cache is up-to-date – hydrate the canvas from the local snapshot (fast startup). If the versions differ, the local snapshot is stale – discard the cached data and use the fresh panel data from the server instead.
In either case, after hydrating, update the in-memory store and then save the snapshot back to local storage with the new version and data. (This ensures the cache will be correct for the next load.)
Memoize the version in memory (per note) after hydration. Once the current session has the latest version for a note, avoid repeated server checks for that note until the app reloads. (This prevents unnecessary version fetches on every minor action. Currently there is no version check at all, so this will be a new optimization.)
Deliverables (Phase 1)
Database migration scripts to add the version column to canvas_workspace_notes (plus down migration). Ensure they backfill existing rows with 0 and apply the unique index/trigger for version.
Unit tests covering version changes: e.g. closing a panel should increment the note’s version; reopening should increment it again. These tests ensure the DB writes and triggers function as expected.
Integration test simulating the ghost panel scenario: Close a note’s panel (which increments the version), then simulate a reload with a stale cached snapshot (old version) and verify that the client ignores the cache and loads from the server. The test passes if a ghost (closed) panel does not reappear when it shouldn’t.
Phase 2 – Cache Simplification
Goal: Simplify or eliminate local caching layers now that versioning provides a reliable source of truth. Some caching is already implemented (with a TTL), but we need to assess if it’s needed and align it with the version logic.
2.1 Evaluate Local Snapshot Necessity
Measure canvas load performance without using the local snapshot. Determine the cold-start time when always fetching from the server (server-first hydration). If the performance is acceptable (e.g. only marginally slower), we should consider removing localStorage caching entirely. (Currently, the app uses a localStorage cache for panel layout and camera state. We need data to decide if we can drop it.)
Decide whether to keep the local snapshot cache or remove it:
If we drop the snapshot: Simplify the code by removing localStorage reads/writes for canvas state. The app would always rely on the server (with the new version checks ensuring consistency).
If we retain the snapshot: enforce stricter cache format and freshness rules:
Store the cache entry as an object containing { version, panels, savedAt } (and similar for camera state). Currently, our cached data already stores the panel list and a timestamp; we will add the version field to each entry.
Apply a global TTL to cached snapshots to auto-expire old data. A TTL exists today (currently ~7 days); we should shorten this (e.g. 24 hours) if caching remains, to minimize how long stale data can live.
Only persist minimal necessary data. This is already the case – we cache panel positions and basic metadata, nothing more – so no major change here aside from including the version.
Update caching logic accordingly: If keeping the snapshot, update the cache read/write code to incorporate the above (use the version during reads to decide usage, and include version when saving). If dropping it, remove or disable the caching functions.
2.2 IndexedDB Offline Queue Review
Audit the usage and necessity of the canvas offline queue (canvasOfflineQueue). This queue currently stores panel operations (create/update/delete) when offline and replays them when the network restores. Confirm if offline canvas editing is a required use-case or if we can simplify by removing this layer.
Ensure offline replays respect the workspace version: If the queue remains, we must include the workspace version context with each operation and validate it on replay. Gap: Currently, queued operations do not record or check any version of the workspace. This means an offline operation could be applied on a stale state (potentially re-introducing a closed panel or overwriting newer server changes). To fix this:
Include the current version of the note’s workspace when enqueuing an offline operation.
On flush (when reconnecting), compare the stored version with the server’s latest version for that note before applying the operation. If there’s a mismatch (i.e. the workspace moved to a newer version while offline), skip or reconcile the queued operation instead of blindly applying it. (For example, if a panel was closed while offline changes were pending, those changes should be discarded or merged appropriately.)
Consider eliminating the offline queue if product requirements allow. If offline canvas edits are not critical, removing the IndexedDB queue would greatly simplify the state management. If we must keep it, align its behavior with the new versioning system as described above (and possibly also leverage panel-level revision tokens, which are already in use, to avoid conflicts).
Deliverables (Phase 2)
Performance report comparing startup with vs. without local snapshot caching. Include metrics like time to interactive canvas, data transfer sizes, etc. This will inform the decision on cache removal.
Decision document (or ADR) clearly stating whether we will keep the local snapshot and offline queue. Document the rationale (e.g. “kept snapshot due to X% slowdown without it” or “removed snapshot to prioritize consistency,” and similarly for offline support).
Code adjustments based on the above decisions:
If snapshot caching is removed, delete or disable the caching code in the hydration flow. If kept, refactor the caching module to store { version, ... } and enforce the chosen TTL (update the current 7-day TTL to the decided value, e.g. 24h).
If the offline queue is removed, eliminate the canvasOfflineQueue usage and related code paths. If kept, update the queue logic to tag each operation with a workspace version and validate against server version on replay. Add tests for offline scenario (e.g. closing a panel while offline and coming back online) to ensure stale operations are handled correctly and do not resurrect ghost panels.
Phase 3 – Automated Reconciliation (No User Prompt)
Goal: Leverage the versioning system for fully automatic cache reconciliation, so users never experience ghost panels or confusing “Which version do you want?” prompts. The current app already leans towards automatic sync (there is no user prompt implemented), so this phase will finalize the logic using the new version field.
Hydration flow with version reconciliation:
On app load, fetch the latest workspace state from the server, including the panels and the workspace version for each note.
If a local snapshot exists and its version matches the server’s version, use the local data to hydrate the canvas (skip rendering from scratch).
If no snapshot is present or the versions do not match, disregard any cached data and hydrate the canvas using the server-provided state.
After hydration, ensure the in-memory state is synced with the server data, and save an updated snapshot to local storage with the new version. (This guarantees subsequent reloads start with the correct state.)
No user intervention required: We will not present any banner or prompt to the user when a version mismatch is detected. The reconciliation is silent and automatic. (The previously considered “ghost panel conflict” banner has been abandoned and remains absent in the current code – we will keep it that way.)
Telemetry: Log events whenever the cache is used or invalidated to monitor how often mismatches occur in the wild. For example, emit a canvas.cache_mismatch event when a cached snapshot is discarded due to version skew, a canvas.cache_used when a cache is successfully used, and a canvas.cache_discarded when an outdated cache is removed. (Currently, the app logs some debug info for cache usage, but we need formal telemetry events to track this behavior in production.)
Deliverables (Phase 3)
Updated hydration logic in the Canvas provider/context to perform the above version-based checks. The implementation should seamlessly choose the correct data source (cache vs. server) based on version, without any user-facing prompts.
Telemetry instrumentation for cache usage: Implement the events canvas.cache_mismatch, canvas.cache_used, and canvas.cache_discarded (and any others deemed useful) using our logging/analytics system. Ensure they include context like noteId and version numbers for debugging.
Automated end-to-end test validating the reconciliation: e.g. simulate having a stale local cache (old version) and a newer server state – on app reload, the stale cache should be bypassed and the new server state applied, with no ghost panels showing up. Also test the case where the cache is up-to-date (versions match) to confirm the app uses the cache and still ends up with a correct state. This ensures the ghost panel issue is truly resolved under all scenarios.