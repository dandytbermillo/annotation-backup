# Canvas State Persistence – QA Log & Playbook (Updated 2025-10-22)

This log captures what’s already been validated, why each test matters, and how to repeat it. It also lists the pending QA items we still need to cover before closing out Phase 3.

---

## Completed Tests

### 1. Cache Hit Telemetry
- **Why**: Proves snapshot reuse works and the `canvas.cache_used` event fires with the right metadata (noteId, workspaceVersion, age).
- **How**:
  1. Start `npm run dev`.
  2. Load the canvas once; wait for it to settle.
  3. Reload the page.
  4. Query logs: `node scripts/check-canvas-cache-telemetry.js --window 2`.
- **Result**: Multiple `canvas.cache_used` events logged (e.g., note 36471305… aged ~47 s).

### 2. Version Mismatch Telemetry
- **Why**: Confirms stale snapshots are detected and discarded. Prevents ghost panels from resurrecting.
- **How**: Using data from an earlier session where storedVersion was `null` and expectedVersion `0`. The loader logged `canvas.cache_mismatch` followed by `canvas.cache_discarded`.
- **Result**: Confirmed events with `reason: "workspace_version_mismatch"`.

### 3. Offline Buffer & Replay (happy path)
- **Why**: Validates the offline queue captures updates and replays them without losing data.
- **How**:
  1. Go offline (DevTools or network toggle).
  2. Move/close a panel in the canvas.
  3. Reconnect.
  4. Watch logs for `workspace_emergency_flush` → `update_main_position_persist_succeeded` → `PanelPersistence.persisted_to_api`.
- **Result**: Replay succeeded (no version conflict); snapshot and server stayed in sync.

### 4. Cache TTL Expiration
- **Why**: Ensures snapshots older than 24 h are purged automatically.
- **How**:
  1. Edit `localStorage['annotation-canvas-state:NOTE_ID']`, set `savedAt` to a very old value (e.g., 1970 timestamp).
  2. Reload the page.
  3. Query logs (same script as above).
- **Result**: `canvas.cache_discarded` with `reason: "expired"` and a subsequent `canvas.cache_used` for the fresh snapshot.

### 5. Unit Coverage (`__tests__/unit/canvas-storage.test.ts`)
- **Why**: Gives deterministic, automated checks for matching snapshots, TTL expiry, and version mismatch logging.
- **How**: `npm run test:unit` (or equivalent Jest command).
- **Result**: Tests pass; they assert the same behaviours we observed in manual QA.

---

## Pending / Next QA Scenarios

### A. Multi-client Version Conflict (`workspace_version_mismatch`)
- **Why**: The discard path is implemented but not observed in a real conflict yet. We need to confirm a stale queued write is dropped cleanly.
- **How**:
  1. Open Tab A (online). Keep it idle.
  2. Open Tab B (online); close the main panel (it hits the server, bumps version).
  3. Disconnect Tab A, move the main panel.
  4. Reconnect Tab A; the queued update should hit `workspace_version_mismatch` because the workspace version has moved.
  5. Check logs: `CanvasOfflineQueue.workspace_version_mismatch`, `canvas.cache_discarded`.
- **Goal**: Document the event payloads, confirm the queued operation was skipped, and note the UX (panel should remain closed).

### B. Dashboard/Automation Hook
- **Why**: The plan calls for surfacing cache hit/miss ratios and queue mismatches. A simple smoke test or dashboard view keeps telemetry visible.
- **How**:
  - Option 1: Wire `scripts/check-canvas-cache-telemetry.js` into a CI smoke step.
  - Option 2: Create a Grafana/Kibana chart for `CanvasCache` and `CanvasOfflineQueue` actions.
- **Goal**: Decide on the monitoring approach and note where to find it (or mark as blocked).

### C. Optional Stress/TTL Test
- **Why**: Ensures TTL logic behaves under multiple notes.
- **How**:
  1. Create snapshots for several notes.
  2. Manually age their timestamps differently.
  3. Reload and verify expiring behaviour.
- **Goal**: Confirm `canvas.cache_discarded` is note-specific and doesn’t blow away healthy snapshots.

---

## Quick Command Reference

```bash
# Summarize cache/offline queue telemetry for the past 2 hours
node scripts/check-canvas-cache-telemetry.js --window 2

# Ad-hoc SQL examples:
psql $DATABASE_URL <<'SQL'
SELECT id, component, action, created_at, metadata
FROM debug_logs
WHERE component IN ('CanvasCache', 'CanvasOfflineQueue')
  AND created_at > NOW() - INTERVAL '2 hours'
ORDER BY id DESC
LIMIT 20;
SQL
```

---

Keep this log updated after each QA pass so the next run can pick up exactly where we left off.***
