# Overlay Hydration – Workspace Alignment Plan

## Goals
- Ensure newly created folders inherit the active overlay workspace ID so layout popups always reference local items.
- Prevent hydration from stalling when older layouts contain cross-workspace folder references.

## Work Breakdown

### 1. Propagate Active Workspace ID on Folder Writes
1. **Surface the active overlay workspace in the client**
   - Expose the current overlay workspace ID through the canvas context (if not already available).
   - Thread this ID into folder create/rename/move actions.
2. **Extend folder APIs**
   - Update `/api/items` POST/PUT handlers to accept an optional `workspaceId` (or infer it via request headers/cookies).
   - Persist that ID in the `items` table (add column if missing) or validate it against existing workspace constraints.
   - Add request validation: reject cross-workspace moves unless explicitly allowed.
3. **Update overlay popup creation**
   - When the eye icon opens a popup (floating toolbar or overlay child row), ensure the new popup descriptor uses the folder’s workspace ID.

### 2. Harden Hydration Against Stale Entries
1. **Adjust `buildEnvelopeWithMetadata`** (`app/api/overlay/layout/shared.ts`)
   - When resolving folders, record the workspace each folder belongs to.
   - If a folder’s workspace differs from the requested overlay workspace, mark it as mismatched in the payload metadata.
2. **Client-side cleanup** (`components/annotation-app.tsx`)
   - In `applyOverlayLayout`, drop or quarantine popups whose folders are missing or flagged as mismatched.
   - Log the mismatch via `debugLog` (new action: `overlay_popup_workspace_mismatch`) so telemetry captures the cleanup.
3. **User feedback (optional)**
   - Show a toast or banner when hydration filters out one or more popups so users know a workspace repair is needed.

### 3. Migration & Data Fix
1. **Schema migration**
   - Backfill existing `items` records by associating them with an overlay workspace (if not already tracked) or flagging unknown entries.
   - Add constraints to prevent creating folders without a workspace ID.
2. **Repair existing layouts**
   - Write a one-off script to scan `overlay_layouts` for folder IDs that resolve to different workspaces and either reroute them or drop them.

## Testing Strategy
- Unit tests for `buildEnvelopeWithMetadata` and `applyOverlayLayout` covering mismatched/missing folders.
- Integration test: create a folder while Workspace 1 is active, confirm the saved layout hydrates instantly and the folder record shows the correct workspace ID.
- Regression test: attempt to create a folder with no workspace ID and ensure the API rejects it.

## Risks & Mitigations
- **Cross-workspace content sharing:** Some teams may intentionally reuse folders across workspaces. Document the new constraint or add an opt-in override.
- **Migration edge cases:** Legacy data without a workspace ID may need manual intervention; plan a dry run before enforcing constraints.
- **Client performance:** Dropping popups during hydration could surprise users; pair cleanup with visible messaging and telemetry.

## Deliverables
- Updated backend routes and migrations to persist/validate workspace IDs.
- Frontend cleanup logic with instrumentation (`overlay_popup_workspace_mismatch`).
- Migration script/report summarizing repaired popups/folders.
