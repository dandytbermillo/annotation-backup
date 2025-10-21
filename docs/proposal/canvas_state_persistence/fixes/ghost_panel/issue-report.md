# Ghost Panel Issue Report

**Status:** _Unresolved (baseline documented)_  
**Last Update:** 2025‑10‑21

---

## Symptom
After closing a branch panel (or an entire note) and reloading the app, the panel reappears on the canvas—even though the user never re-opened it. The panel often re-centres to its previous position with no user interaction, earning the “ghost panel” nickname.

Example case:
- Panel ID: `branch-7223e7fc-7922-440e-9b43-e6360c5039d8`
- Note ID:  `5cf5f2a4-4b57-4184-8414-c06ebf516bc0`
- Reappears on every reload when the workspace cache/local snapshot is empty.

---

## Root Causes
1. **Database panel rows never transition to a closed state**
   - Table: `panels`
   - Branch panels retain `state='active'` even after the UI “closes” them.
   - Hydration consumes the `panels` table directly (option A path and API), so every reload restores any row marked `active`.

2. **Workspace persistence reopens notes automatically**
   - Table: `canvas_workspace_notes`
   - Even if a note is manually closed (`is_open = FALSE`), the workspace sync effect re-creates the panel and re-flips `is_open` to `TRUE` the next time it sees a panel on canvas.
   - Result: manual DB clean-up doesn’t hold; the workspace layer rehydrates the ghost on the next reload.

3. **Plain-mode localStorage snapshot replays stale panels**
   - Key pattern: `note-data-${noteId}`
   - Snapshot contains the branch panel with `state='active'` and no lifecycle filter, so every replay recreates the ghost panel when cached data exists.

Because all three layers (DB, workspace cache, localStorage) insert the panel independently, the user sees it return regardless of which cache is active.

---

## Evidence (Query Logs)
Example `debug_logs` rows when the ghost panel rehydrated:
```json
{
  "component": "AnnotationCanvas",
  "action": "noteIds_sync_creating_new_panel",
  "metadata": {
    "noteId": "5cf5f2a4-4b57-4184-8414-c06ebf516bc0",
    "source": "workspace",
    "targetPosition": { "x": 2827, "y": 954 }
  }
}

{
  "component": "CanvasHydration",
  "action": "loaded_panels",
  "metadata": { "count": 1 }
}

{
  "component": "CanvasProvider",
  "action": "SNAPSHOT_RESTORE_DETAILS",
  "metadata": {
    "totalItems": 1,
    "mainPanelPosition": { "x": 2827, "y": 954 }
  }
}
```

Database inspection confirms the persistence layer still marks the panel row as active:
```sql
SELECT panel_id, note_id, state
FROM panels
WHERE panel_id = 'branch-7223e7fc-7922-440e-9b43-e6360c5039d8';
-- state = 'active'
```

Workspace cache shows the note as open:
```sql
SELECT note_id, is_open, main_position_x, main_position_y
FROM canvas_workspace_notes
WHERE note_id = '5cf5f2a4-4b57-4184-8414-c06ebf516bc0';
-- is_open = TRUE, position cached
```

---

## Recommended Fix Plan
1. **Persist closed state**
   - Update panel close handler to write `state='closed'` (or delete the row).
   - Ensure the `panels` API/hydrator filters out `state != 'active'`.

2. **Update workspace persistence**
   - When a panel is closed, persist that state in `canvas_workspace_notes` so the sync effect does not recreate it.
   - Add state filtering when seeding the shared `dataStore` from workspace caches.

3. **Invalidate or rewrite localStorage snapshots**
   - On close, remove the branch entry (or mark it closed) before the next snapshot flush.
   - Optionally add a tombstone or timestamp to detect stale entries and ignore them during replay.

Until those steps are implemented, ghost panels can still reappear after reloads despite manual cleanup.

---

## Outstanding Work
- Implement the lifecycle persistence changes above (no code merged yet).
- Backfill existing `panels` rows to mark closed panels appropriately.
- Add integration tests covering close → reload → panel remains hidden.
- Re-validate once the changes land: confirm `debug_logs` no longer emit workspace or hydration recreations for closed panels.
