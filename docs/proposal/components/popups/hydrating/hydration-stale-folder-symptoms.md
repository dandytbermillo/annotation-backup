# Workspace Hydration — Stale Folder Symptoms

## Observable Behaviour
- Switching between Workspace 1 and any other workspace repeatedly shows the “Workspace hydrating…” banner for several seconds.
- While the banner is visible the popup canvas is locked (cursor shows `wait`) and panning or dragging is sluggish.
- Terminal output / Next dev server logs spam `POST /api/overlay/layout …` followed by `workspace_hydration_started`/`finished` rows, indicating repeated hydration attempts.
- Hydration loops continue even when no popups are being created or moved—simply switching away from Workspace 1 is enough to trigger it.

## Debug Telemetry
- `debug_logs` entries under `component = 'PopupOverlayEye'` show `hover_no_popup_found` for `childId = 24b8fb8e-0889-47b1-be1a-0bfa050bb777` (folder “folder 3”) whenever the eye icon is hovered before the popup is reopened.
- After reopening the folder, logs switch to `hover_existing_popup`, confirming the popup now exists in the in-memory map, but the stale ID remains persisted in the layout.
- `overlay_layouts` table stores Workspace 1’s layout (`workspace_id = 49dc0b28-e165-4382-9cdf-a6bacb4f9a30`) with a popup descriptor whose `folderId = 24b8fb8e-0889-47b1-be1a-0bfa050bb777` (folder 3).
- The `items` table shows that folder ID belongs to the default workspace (`workspace_id = 13716608-6f27-4e54-b246-5e9ca7b61064`), not Workspace 1.

## Impacted Workspace States
- Workspace 1 (id `49dc0b28-e165-4382-9cdf-a6bacb4f9a30`) contains popups for:
  - `personal info` (level 0)
  - `testing` (level 1)
  - `folder 3` (level 2) with the mismatched `folderId` referenced above
- Default workspace remains unaffected; its popups hydrate quickly because all folder IDs resolve locally.

## Reproduction Steps
1. Switch to Workspace 1 (layout with `personal info → testing → folder 3`).
2. Switch away to the default workspace (or any other workspace).
3. Observe prolonged “Workspace hydrating…” banner and sluggish interaction while hydration retries.
4. Query `debug_logs` for `PopupOverlayEye` entries to see repeated `hover_no_popup_found` events for folder 3.

## Root Cause Summary
- `folder 3` was created while the default workspace was active, so its record in `items` belongs to the default workspace.
- Workspace 1’s overlay layout saves a popup reference to that folder ID, but hydration expects folders to belong to the same workspace.
- When hydration can’t resolve the folder, it falls back to the legacy client-side fetch loop, keeping the loader active and blocking interaction.
- Reopening “folder 3” creates a new popup instance, but the persisted layout still references the mismatched folder ID until it is deleted or recreated within Workspace 1.

