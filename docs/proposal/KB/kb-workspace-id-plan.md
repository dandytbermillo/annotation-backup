# Knowledge Base Workspace ID Alignment Plan

## Why This Plan?
Recent overlay refactors started sending the **overlay layout workspace ID** with data‑layer requests (create/move/delete). The bulk-move API scopes queries to that ID, so it now fails with “Target folder not found” even though the folders exist in the global Knowledge Base. We need to separate **layout workspace IDs** from the **Knowledge Base workspace ID** and make sure every data mutation uses the correct scope before we introduce multiple KBs or per-tenant isolation.

## Goals
1. Capture and persist the canonical Knowledge Base workspace ID in the client.
2. Ensure every data mutation (create folder, rename, delete, move, note operations) uses that KB ID, not the overlay layout ID.
3. Maintain backward compatibility with the existing single-KB deployments while unblocking future multi-KB or tenant-scoped data.

## Non-Goals
- No changes to the overlay layout schema or persistence format.
- No server-side workspace redesign beyond accepting the proper KB ID.
- No UI/UX changes beyond the fixed drag/drop behavior.

## Constraints & Risks
- The KB workspace ID must be available before any mutation occurs; we need a safe fallback if the sidebar hasn’t hydrated yet.
- Some helper utilities (`fetchWithWorkspace`) currently auto-attach the overlay ID. We must avoid breaking overlay layout APIs that actually need that header.
- Tests and docs must reflect the distinction to prevent future regressions.

## Implementation Steps
1. **Surface the KB Workspace ID**
   - During organization sidebar hydration (where we already fetch `/api/items?parentId=null`), read the workspace ID returned by the API or from a dedicated header.
   - Store it in state (`kbWorkspaceId`) and expose a hook/helper to retrieve it anywhere we trigger Knowledge Base mutations.
   - Fallback: if the value is missing, block the mutation with a descriptive toast rather than guessing.
2. **Split Request Helpers**
   - Keep `fetchWithWorkspace` for overlay-layout calls.
   - Introduce `fetchWithKnowledgeBase` (or similar) that injects the KB workspace ID header/body field and reuse it across data operations.
3. **Update Mutations**
   - Folder creation, rename, delete, bulk move, note creation, and any other `/api/items` writes must send the KB ID.
   - When an overlay action writes to both layout and data (e.g., create folder then add popup), ensure each call uses the right helper.
4. **Cache & State Adjustments**
   - When the KB workspace changes (e.g., future switcher), clear `folderCacheRef` and rehydrate with the new scope so cached children align with the new KB.
5. **Validation & Tests**
   - Manual: drag/drop between folders, create/rename/delete from multiple overlay workspaces; confirm no “Target folder not found” errors.
   - Automated: add a regression test (unit or integration) that mocks the API and asserts the correct workspace ID is sent.
6. **Documentation**
   - Update `docs/current_status/popup-overlay-refactor-status.md` with a summary of the KB workspace separation.
   - Note the distinction in `docs/Workspace/overlay-architecture.md` so future refactors don’t reintroduce the bug.

## Open Questions
1. Does the backend already emit the KB workspace ID in API responses/headers, or do we need an explicit endpoint?
2. Should the KB workspace selector eventually appear in the UI, or remain implicit for now?
3. Are there other modules (e.g., sidebar-only actions, context menus) that post to `/api/items` and also need the KB ID?
