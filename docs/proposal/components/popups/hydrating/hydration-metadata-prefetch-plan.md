# Popup Hydration Metadata Prefetch – Implementation Plan

## Objective
Collapse the per-popup fetch waterfall during workspace hydration by delivering the necessary folder metadata (name, resolved color, children snapshot) inside the layout payload returned by `/api/overlay/layout`. This removes 3–12 network round trips per popup and shortens the perceived "hydrating" window to a single backend request.

## Scope
- Backend: extend the overlay layout adapter/route to embed folder metadata in the layout response.
- Frontend: consume the enriched payload and skip the existing decoration fetch loop in `components/annotation-app.tsx`.
- Maintain compatibility with older payloads (graceful fallback) until both sides deploy.

## Work Breakdown

### 1. Backend Enhancements
1. **Schema & Types**
   - Update `lib/types/overlay-layout.ts` (or server-side equivalent) to add optional `resolvedFolder` metadata to each popup descriptor (e.g., `{ name, color, path, children: [...] }`).
   - Ensure the schema version (`OVERLAY_LAYOUT_SCHEMA_VERSION`) bumps to reflect the new structure.

2. **Data Projection**
   - In the server handler that fulfills `GET /api/overlay/layout/:workspaceKey`, join against the folders table (or existing service) to fetch:
     - Folder display name and path.
     - Resolved color (folded from ancestor if blank); perform this server-side to avoid multiple client fetches.
     - First-level children (id, name, type, color, path, createdAt, updatedAt, parentId).
   - Package the data into the enriched payload structure. Emit empty arrays if children are not requested (consider a cap if a folder is huge).

3. **Versioning & Backwards Compatibility**
   - Gate the enriched metadata behind a schema version check. When the client sends `Accept-Version: 2.1` (or similar), respond with the new format; otherwise continue returning the legacy payload.
   - Add integration tests (or endpoint fixtures) to cover both formats.

4. **Performance Considerations**
   - Batch database lookups per workspace load to avoid N+1 queries (e.g., single query for all folder IDs, plus child lookup with `WHERE parent_id IN (...)`).
   - Cache ancestor color resolution if used elsewhere.

### 2. Frontend Updates
1. **Types & Guards**
   - Update the TypeScript definitions in `lib/types/overlay-layout.ts` and `lib/adapters/overlay-layout-adapter.ts` to acknowledge `resolvedFolder` metadata.
   - Extend `buildHydratedOverlayLayout` to populate popups directly from the embedded metadata.

2. **Hydration Loop Simplification**
   - In `components/annotation-app.tsx (applyOverlayLayout)`, detect the presence of pre-resolved metadata and skip the current decoration loop. Instead, set:
     ```ts
     folderName = metadata?.name ?? popup.folderName
     folder = metadata ?? existing
     children = metadata?.children ?? []
     isLoading = false
     ```
   - Retain the legacy path (with existing fetch loop) for older payloads so the app remains compatible during rollout.

3. **Runtime Flag & Telemetry**
   - Optional: add a temporary env flag (`NEXT_PUBLIC_POPUP_LAYOUT_PREFETCH`) to toggle the new path while validating.
   - Update logging to note which path was used (`prefetched` vs `legacy`).

### 3. Testing & Verification
- **Unit Tests**
  - Add coverage for `buildHydratedOverlayLayout` to ensure popups pick up prefetched metadata.
  - Test the fallback path still functions when metadata is missing.
- **Integration / E2E**
  - Run workspace switch scenarios ensuring no additional network calls fire from the client during hydration.
  - Verify large workspaces (many popups) hydrate without regression.

### 4. Rollout Plan
1. Deploy backend change with schema version bump and dual-format support.
2. Release frontend with detection logic and telemetry, still accepting legacy payloads.
3. Monitor debug logs (`workspace_hydration_*`) for duration improvements and confirm no legacy clients break.
4. Once confidence is high, phase out the fallback fetch loop and remove the feature flag.

## Risks & Mitigations
- **Large Payload Size**: Embedding children arrays could bloat the response. Mitigate with a size cap or lazy loading for very large folders.
- **Schema Drift**: Ensure both frontend and backend share versioned types; consider JSON schema validation in tests.
- **Stale Metadata**: If children lists change rapidly, confirm persistence logic still reflects edits (the prefetched data is only for hydration, not canonical state).

## Success Criteria
- Hydration emits a single `workspace_hydration_started/finished` pair per workspace switch, with durations consistently <1s in typical scenarios.
- Network tab shows no per-popup `/api/items*` calls during hydration when the feature flag is enabled.
- User feedback: overlay remains interactive immediately after switch, without prolonged "Loading…" states on popup content.
