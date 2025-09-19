# Plain-Mode Autosave Conflict Research Plan

## Objective
Eliminate recurring `stale document save: baseVersion … behind latest …` errors for single-tab plain-mode users who switch notes rapidly, without regressing annotation behaviour or introducing cross-tab drift.

## Current Architecture
- **Client**
  - `components/canvas/tiptap-editor-plain.tsx`: 300 ms debounced autosaves call `PlainOfflineProvider.saveDocument`.
  - `lib/providers/plain-offline-provider.ts`: caches optimistic writes, increments versions, emits events.
  - `lib/adapters/web-postgres-offline-adapter.ts`: POSTs to `/api/postgres-offline/documents` with `version` and `baseVersion`.
- **Server**
  - `app/api/postgres-offline/documents/route.ts:77-81`: enforces version monotonicity; throws 409 when `baseVersion` < latest.
  - `migrations/022_document_saves_workspace_scope.up.sql`: `document_saves` table constraint `document_saves_note_panel_ws_version_unique` (`note_id`, `panel_id`, `workspace_id`, `version`), plus supporting index, mirrors server guard.
- **Data Layer**
  - `lib/workspace/workspace-store.ts`: wraps transactions per workspace.

## Why Conflicts Appear in a Single Tab
1. **In-Flight Overlap**: Provider dispatches save B before save A finishes; both share `baseVersion = latest`, but save A lands first and increments server version.
2. **Note Switching Drift**: Rapid note switches can reload the last known version (from cache) while previous saves still post, so the next save reuses stale `baseVersion`.
3. **Remote Refresh Latency**: After a 409, the provider’s `refreshDocumentFromRemote` may not complete before the editor retries, so we hit 409 again.
4. **Batch Queue Interaction**: If batching is enabled, the queue flush may replay outdated payloads, violating the unique index.

## Research Tasks

### 1. Instrumentation (Client)
- Guarded by `NEXT_PUBLIC_DEBUG_AUTOSAVE` (env variable).
- Add logs in `tiptap-editor-plain.tsx` around debounce start/end and payload hash.
- Patch `PlainOfflineProvider.saveDocument` to log `cacheKey`, `baseVersion`, `currentVersion`, and a per-cache in-flight counter.
- Log location: `console.debug('[PlainSave]', { cacheKey, action, baseVersion, version, ts })`.

### 2. Adapter-Level Tracking
- In `web-postgres-offline-adapter.ts`, wrap fetch with timing + in-flight map:
  ```ts
  const key = `${noteId}:${panelId}`
  this.pendingSaves.set(key, (this.pendingSaves.get(key) || 0) + 1)
  try { await fetch(...) }
  finally { this.pendingSaves.set(key, this.pendingSaves.get(key)! - 1) }
  ```
- Log when concurrent writes occur.

### 3. Server Diagnostics
- Temporary logging in `app/api/postgres-offline/documents/route.ts` to show `baseVersion`, `version`, previous version, and request duration.
- Use `EXPLAIN ANALYZE` or `pg_stat_statements` to measure latency; confirm whether slow queries contribute.
- Note the schema constraint from `migrations/022_document_saves_workspace_scope.up.sql:20-23`, ensuring any solution respects the unique index.

### 4. Automated Repro
- Create Playwright scenario: type in note A, switch to note B, type, switch back, with artificial network delay (use `page.route` to slow POSTs).
- Expected to surface 409s reproducibly.

## Candidate Solutions

### A. Client-Side Sequential Save Queue *(Primary)*
- Maintain per-`cacheKey` promise chain in `PlainOfflineProvider`:
  ```ts
  private saveQueues = new Map<string, Promise<void>>()

  private enqueueSave(key: string, task: () => Promise<void>) {
    const chain = (this.saveQueues.get(key) || Promise.resolve()).then(task)
    this.saveQueues.set(key, chain.finally(() => this.saveQueues.delete(key)))
    return chain
  }
  ```
- `saveDocument` enqueues adapter writes to ensure no overlapping POSTs.
- Update `tiptap-editor-plain.tsx` to await queue (optional) or at least avoid scheduling new saves while queue length > 0.

### B. Refresh Acknowledgement Barrier
- Add provider event `document:refresh-complete` fired after `refreshDocumentFromRemote` 8 version update.
- Editor defers next autosave until `refresh-complete` arrives; ensures `documentVersions` matches server before resubmitting.

### C. Adaptive Debounce/Backoff
- If `PlainOfflineProvider` detects in-flight save, extend debounce delay (e.g., 300 ms → 600 ms → 900 ms until queue clears).
- Reset delay once save resolves.

### D. Server Idempotency Improvements
- Already partially implemented: skip insert when content + version unchanged. Confirm HTML vs JSON equality to reduce spurious 409s.
- Optional: add server-side `ON CONFLICT DO NOTHING` fallback for duplicate payloads (needs to keep unique constraint intact; requires verifying effect on revision history).

## Validation Strategy
1. **Unit Tests**
   - Expand `__tests__/plain-mode/plain-provider-conflict.test.ts` with sequential queue assertions.
   - Add tests ensuring `document:refresh-complete` triggers.
2. **Integration / Playwright**
   - Run new note-switch scenario under network throttle; expect zero 409s post-fix.
3. **Manual QA**
   - Rapid note switching + annotation interaction; confirm annotations remain functional.
4. **Performance**
   - Measure average save latency (Chrome Performance panel). Ensure queueing doesn’t exceed UX tolerance (< 1 s).

## Risks & Mitigations
- **Queue Deadlock**: long-running save stalls subsequent writes. Mitigate with timeout + warning UI.
- **Increased Latency**: sequential saves delay persistence. Consider UI feedback (spinners) or immediate optimistic UI updates (already in place).
- **Annotation Coupling**: ensure plugin registration untouched; isolate conflict handling in provider layer.

## Dependencies
- Any fix must respect `migrations/022_document_saves_workspace_scope.up.sql` constraint—no schema changes planned but note that the unique index enforces strict version increments.
- Ensure batch manager (`PlainBatchManager`) logic is compatible with new queue.

## Next Steps
1. Land instrumentation (Tasks 1–3) and gather logs from single-tab repro.
2. Prototype Solution A (queue) behind feature flag `enableSequentialSaves`.
3. Update tests & Playwright scenario.
4. Iterate based on telemetry; if conflicts persist, layer Solution B or C.
