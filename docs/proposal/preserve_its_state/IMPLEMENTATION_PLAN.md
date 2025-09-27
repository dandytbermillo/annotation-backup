# Preserve Popup Overlay State — Implementation Plan (Option A Plain Mode)

## Summary
Option A users report that open hover popups on the popup overlay vanish whenever they press `Tab` to switch layers. Today, an effect in `components/notes-explorer-phase1.tsx:1409` calls `closeAllPopovers()` whenever the active layer leaves `'popups'`, wiping `hoverPopovers`. This plan covers **two incremental scopes**:

1. **Phase 1 – In-session resilience:** stop erasing popups during layer toggles so users can tab between layers without losing context.
2. **Phase 2 – Cross-session persistence:** save the overlay layout to Postgres (plain/offline mode only) and reload it when the app opens, so popups/inspectors survive full reloads.

No Yjs collaboration flows are in scope; all work targets Option A (plain/offline mode).

## Goals
- Phase 1: Keep all existing hover popovers (including nested stacks) when the active layer switches away from `'popups'` and then back; preserve positions and dragging state.
- Phase 2: Persist overlay layout (popups, hierarchy, positions, inspector visibility) per workspace + user so reopening the app restores the same overlay state.
- Maintain current manual dismissal behavior (`closeAllPopovers()` when explicitly invoked or when the explorer unmounts).
- Ensure compatibility with plain/offline mode and respect `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md` (no provider/consumer contract drift without shims).

## Non-Goals
- Implementing collaborative (multi-user) overlay sync; Option B parity is future work.
- Persisting additional canvas elements beyond popups/inspector metadata.
- Refactoring the layer provider, keyboard shortcut hook, or hover data flow beyond scoped changes.

## Current Behavior Overview
- `useLayerKeyboardShortcuts` maps `Tab` to `toggleLayer()` so the active layer flips between `'notes'` and `'popups'` (`lib/hooks/use-layer-keyboard-shortcuts.ts:42-61`).
- `NotesExplorerContent` stores open popovers in `hoverPopovers`; `closeAllPopovers()` clears the map (`components/notes-explorer-phase1.tsx:1390`).
- An effect at `components/notes-explorer-phase1.tsx:1409` tracks the previous and current layer and calls `closeAllPopovers()` whenever the layer exits `'popups'`.
- `PopupOverlay` disables pointer/touch events when inactive (`components/canvas/popup-overlay.tsx:1187-1194`), so retaining the map doesn’t block notes-layer interaction.
- There is no persistence: reloading or opening another session starts with an empty overlay.

## Phase 1 – In-Session Fix
1. **Stop auto-clearing on layer change**
   - Remove the `closeAllPopovers()` call from the layer-tracking effect. Keep `prevActiveLayerRef` only for diagnostics.
   - Add an effect cleanup (`return () => closeAllPopovers()`) so popovers clear if the explorer fully unmounts.

2. **Document intentional clear paths**
   - Audit remaining uses of `closeAllPopovers()` (`components/notes-explorer-phase1.tsx:3249`, `:3258`) and inline-comment near the effect to explain why automatic clearing was removed (avoids future regressions).

3. **Debug instrumentation**
   - Use the Postgres logger (`codex/how_to/debug_logs.md`) to emit `debugLog('PopupOverlayLayer', 'layer_visibility_changed', { prevLayer, nextLayer, popupCount })` whenever the layer changes. Logs confirm toggles preserve popups.

4. **Docs touch-up**
   - Update any overlay-focused documentation to note that popups persist through layer toggles while respecting manual dismissals.

### Phase 1 Testing
- Manual Option A test: open multiple popups, drag them, toggle layers, confirm persistence; close the explorer (if it unmounts) to ensure popups still clear.
- Regression check: notes canvas regains pointer interaction when overlay inactive; explicit dismiss actions still work.

## Phase 2 – Cross-Session Persistence (Postgres)
> Execute only after Phase 1 ships and is validated.

### Data Model
Create `migrations/XXX_overlay_layouts.up.sql` / `.down.sql`:
- Table `overlay_layouts` with columns:
  - `id` uuid primary key
  - `workspace_id` uuid (indexed, references workspaces)
  - `user_id` uuid (optional; scoped per user)
  - `layout` jsonb (stores layout metadata)
  - `version` text (schema version string)
  - `updated_at` timestamptz default now
- Unique index on `(workspace_id, user_id)` to prevent cross-user leakage.
- Optional: `updated_by`, `session_id` if long-term history needed.

### Layout Schema (JSONB)
Keep payload tight to avoid coordinate drift and bloat:
```json
{
  "schemaVersion": "1.0.0",
  "popups": [
    {
      "id": "popup-id",
      "folderId": "source-folder",
      "parentId": "parent-popup-id|null",
      "canvasPosition": { "x": 0, "y": 0 },
      "level": 1,
      "height": 320
    }
  ],
  "inspectors": [
    {
      "type": "branch",
      "visible": true,
      "pane": "right"
    }
  ],
  "lastSavedAt": "2025-09-27T00:00:00.000Z"
}
```
- Persist **canvas coordinates only** (`canvasPosition`); drop screen coordinates to stay transform-agnostic.
- Do **not** persist preview text/content—layout metadata only.
- Enforce max payload size (e.g., reject >128 KB) in the API to prevent runaway saves.

### Adapter Changes
- Extend `PopupStateAdapter` (or create `OverlayLayoutAdapter`) with:
  - `loadLayout({ workspaceId, userId }): Promise<OverlayLayout | null>`
  - `saveLayout({ payload, expectedRevision }): Promise<{ revision: string }>`
- Implement optimistic locking: include `revision` (UUID or `updated_at` value) in responses; client supplies `expectedRevision` on save. If mismatch, reject with 409.
- Provide fallback: on adapter failure, log via debug logger and fall back to in-memory behavior.

### API Surface (Next.js)
Create `app/api/overlay/layout/[workspaceId]/route.ts` handling:
- `GET` → adapter `loadLayout`; return 404 if none.
- `PUT` → validate payload (schema version, popup IDs, payload size), enforce auth (workspace + user), and optimistic locking.
- Responses include new `revision` so the client can track successive saves.
- Return detailed errors for 400 (validation), 401/403 (auth), 409 (version mismatch).

### Client Wiring
- On mount after workspace/user resolved:
  - Fetch layout via adapter; merge into `hoverPopovers` (retain in-session popups). Filter out invalid entries (missing folders, etc.) before merging.
  - Restore inspector state if returned.
- On meaningful changes (open/close, drag, inspector toggles):
  - Serialize to schema; drop screen coordinates.
  - Debounce saves (2–3 s leading + trailing); skip if deep-equal to last payload to avoid no-op writes.
  - Allow only one in-flight save; drop intermediate updates while pending.
  - Handle 409 by refetching layout, merging differences, and retrying once with backoff.

### Validation & Recovery
- On load, validate `schemaVersion`; if unknown, log `debugLog('PopupOverlayLayer','layout_version_mismatch', ...)`, clear server state, and resave a minimal layout.
- Filter out popups referencing deleted folders/notes; log and continue.
- Provide a manual “Reset overlay layout” action (optional) to clear saved state by calling `DELETE` (future route) or overwriting with empty payload.

### Phase 2 Testing
- **Unit tests:**
  - Adapter serialization/deserialization; coordinate round-trip; revision handling.
  - Client serializer ensures screen coords omitted.
- **Integration tests:**
  - API `GET/PUT` with optimistic locking, auth, payload size enforcement.
  - Migration forward/backward with sample payload.
- **Manual QA (plain mode):**
  - Open popups/inspectors, reload app → state restored.
  - Open second tab, modify layout → ensure conflict handling (409 + retry) works and logs emitted.
  - Inject malformed payload in DB to confirm loader clears it and overlay still boots.

## Deployment / Rollout
- Phase 1: client-only change; standard review + QA.
- Phase 2: migrate DB first, then deploy the API + adapter. Monitor debug logs (`layout_saved`, `layout_conflict`, `layout_validation_error`) and database write volume during rollout.

## Risks & Mitigations
- **Lingering popups (Phase 1):** Document UX; users still have manual dismiss.
- **Coordinate drift:** Persist only `canvasPosition`; drop screen-space data.
- **Layer toggle auto-clear:** Ensure Phase 1 change lands before persistence; otherwise saved layouts will immediately wipe.
- **Write amplification:** Debounce saves, deep-compare payloads, allow single in-flight request.
- **Multi-tab conflicts:** Use optimistic locking; client merges on 409.
- **Corrupt/obsolete payloads:** Include `schemaVersion`, validate IDs, clear on mismatch, resave minimal layout.
- **Security/tenancy:** Unique `(workspace_id,user_id)` constraint + server auth guard on both routes.
- **Payload bloat:** enforce size limit; persist metadata only.
- **Option A/B divergence:** Keep adapter API consistent; Option B doesn’t enable persistence until parity plan exists.

## Open Questions
- Scope persistence per user vs shared workspace? (Plan assumes per user.)
- Need UI for “Reset overlay layout”? (Decide before Phase 2.)
- Maximum popup count we’re comfortable persisting? (UX/product input.)

## References
- `components/notes-explorer-phase1.tsx:1390-1420`
- `components/canvas/popup-overlay.tsx:1187-1194`
- `lib/hooks/use-layer-keyboard-shortcuts.ts:42-61`
- `codex/how_to/debug_logs.md`
- `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md`
