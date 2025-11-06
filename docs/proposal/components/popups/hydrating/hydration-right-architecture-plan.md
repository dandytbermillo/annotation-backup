# Overlay Hydration Architecture Fix – Implementation Plan

## Objective
Guarantee that overlay layouts and the underlying folder records always belong to the same workspace so hydration never relies on cross-workspace data or slow fallback fetches. This plan exists because we repeatedly saw “Workspace hydrating…” lock the popup canvas whenever a layout contained stale folder IDs (for example, Workspace 1 referencing `folder 3`, which actually lives in the default workspace). Each time hydration hit that mismatch it retried, froze the overlay, and made dragging feel impossibly heavy—fixing that data drift removes the spinner and the sluggish drag behaviour.

## Guiding Principles
- A popup rendered in overlay workspace **W** must reference folders/items that also live in workspace **W**.
- Folder creation and movement must respect the active overlay workspace selection.
- Hydration should surface (not silently drop) any remaining mismatches so users can repair them.
- The Workspace Organization sidebar must expose the canonical starter folders (`Knowledge Base`, `my documents`, `personal info`, `projectsx`, `todo`, `Uncategorized`) in every workspace—existing and newly created—so users see the same entry set regardless of which workspace is active.

## Work Breakdown

### 1. Capture the Active Overlay Workspace on the Client
1. Expose the current overlay workspace ID via context (`useCanvasWorkspace`).
2. Thread this ID through the sidebar/floating toolbar actions that create or move folders.
   - Update `components/floating-toolbar.tsx` and overlay child renderers to include `workspaceId` when calling create APIs.
3. Persist the workspace ID in local state alongside popup descriptors so saves stay consistent.

### 2. Extend Folder CRUD APIs
1. **Request Contract**
   - Update `/api/items` POST/PUT routes to accept an optional `workspaceId` (default to the current session workspace when omitted).
   - Validate that `workspaceId` is present; reject requests lacking one once the client is updated.
2. **Persistence**
   - Use the provided `workspaceId` for new items; ensure the existing trigger `set_ws_from_setting()` respects overrides.
   - For moves, ensure the target parent belongs to the same workspace; reject cross-workspace moves or duplicate the item intentionally.
3. **Tests**
   - Add integration coverage to confirm a folder created while Workspace 1 is active persists with Workspace 1’s ID and hydrates without fallback.

### 3. Hydration Safeguards & Telemetry
1. In `buildEnvelopeWithMetadata`, annotate popups whose folders cannot be resolved or belong to a different workspace (metadata only; do not drop them automatically).
2. In `applyOverlayLayout`, surface an alert/toast when mismatches exist, and include the offending folder IDs in `debug_logs` (`component='PopupOverlay', action='workspace_mismatch_detected'`).
3. Provide a helper to repair mismatches (e.g., “clone folder into current workspace”), but leave that to user confirmation.

### 4. Data Migration & Backfill
1. Add a one-time script that scans `overlay_layouts` for folders whose `workspace_id` differs from the layout’s workspace.
2. For each mismatch, either clone the folder into the correct workspace or flag it for manual repair.
3. Document the findings (workspaces affected, folder IDs) and store them in `docs/proposal/components/popups/hydrating/` for future reference.

### 5. Workspace Organization Parity
1. Introduce a server-side guard (e.g., `WorkspaceStore.ensureBaselineFolders(workspaceId)`) that seeds the canonical sidebar folders when a workspace is created or activated.
2. On client boot (toolbar/sidebar load), call a lightweight “ensure parity” endpoint that verifies the baseline folders exist and rehydrates the sidebar once seeding finishes.
3. Add a backfill job that iterates through existing workspaces, creating any missing baseline folders so legacy data matches the enforced structure.
4. Extend telemetry to log whenever seeding occurs so QA can confirm parity in all environments.

### 6. UI Feedback & Repairs (Optional)
- Provide a modal listing mismatched folders with options:
  1. Clone into current workspace (creates new items with matching workspace IDs).
  2. Remove popup from workspace layout.
  3. Ignore (keeps fallback enabled, but warn about performance impact).

## Milestones & Testing
- **Milestone 1:** Client + API propagate workspace IDs for all new folder creations. Verify via automated integration test.
- **Milestone 2:** Hydration metadata surfaces mismatches without dropping popups. Verify by intentionally creating a mismatch and confirming the toast/logs appear while hydration stays responsive.
- **Milestone 3:** Migration script produces a report of legacy mismatches. Manual or automated remediation applied.

## Risks & Mitigations
- **Legacy artifact loss:** Users with existing cross-workspace folders may lose popups if we force strict alignment. Mitigate by surfacing repairs instead of silently deleting.
- **Shared folders across workspaces:** Confirm product expectations—if sharing is intentional, cloning on demand is safer than blocking outright.
- **API consumers unaware of workspace parameter:** Keep parameter optional temporarily; log warnings in the backend until all clients are updated.

## Deliverables
- Updated client components carrying `workspaceId` through creation flows.
- Enhanced `/api/items` POST/PUT handlers with workspace-aware validation.
- Hydration telemetry + UI feedback for mismatches.
- Migration/backfill script results stored in `docs/proposal/components/popups/hydrating/`.
