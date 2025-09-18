# Workspace Data Divergence Research Plan

## Objective
Identify why, after enabling workspace-scoped routes and running migration `022_document_saves_workspace_scope.up.sql`, different browsers still overwrite each other’s note content when using plain mode (no Yjs). The most recent observation: a browser initially loaded the other browser’s change, then immediately replaced it with its own cached content.

## Key Questions
1. **Workspace resolution**
   - Does every server entry point resolve the same workspace UUID for all browsers?
   - Do queue processors (API, adapter, Electron) ever run without `app.current_workspace_id` configured?
2. **Offline queue behaviour**
   - Are stale operations lingering in `offline_queue`? What data exists post-migration?
   - Is the queue replaying entries already superseded by new versions?
3. **Document consistency**
   - For a target `note_id` + `panel_id`, what sequence of document versions exists in `document_saves` during the overwrite?
   - Which actor (API, queue, adapter, Electron) inserts the version that reverts the change?
4. **Client caches**
   - Are any browsers sending local backups or cached payloads immediately after load?
   - Do the adapters send a `version` or `content` mismatch compared to current DB state?

## Data Collection
1. **Database snapshots**
   - `SELECT * FROM workspaces;`
   - `SELECT note_id, panel_id, version, workspace_id, created_at FROM document_saves ORDER BY created_at DESC LIMIT 20;`
   - `SELECT id, type, table_name, entity_id, data, status, retry_count FROM offline_queue ORDER BY created_at DESC LIMIT 50;`
   - `SELECT * FROM offline_dead_letter ORDER BY created_at DESC LIMIT 20;`
   - `SELECT note_id, workspace_id, updated_at FROM notes ORDER BY updated_at DESC LIMIT 20;`
2. **Client/platform logs**
   - Browser console logs from both browsers during a reproduction session.
   - Electron (if used) log output, especially from `postgres-offline:saveDocument`, `flushQueue`, etc.
3. **Network traces**
   - Capture `POST /api/postgres-offline/documents`, `/documents/batch`, `/queue/flush`, and `/queue` requests from both browsers.
   - Capture any adapter or Electron IPC calls (if available).
4. **Queue instrumentation**
   - Create temporary logging around queue enqueue/flush to emit:
     - workspace_id, note_id, panel_id, version, content hash, created_at.
     - Whether the queue handler skipped or inserted.

## Experiment Matrix
1. **Baseline (no queue)**
   - Disable offline queue processing temporarily (comment out enqueues or flush calls) and perform edits in both browsers. Observe if overwrites still happen.
2. **Queue flush disabled**
   - Allow enqueueing but disable manual flush. Verify whether DB stays consistent until flush runs, indicating queue replay is the culprit.
3. **Single browser**
   - Run edits in one browser only to confirm versions increase monotonically with consistent content.
4. **Mixed clients (browser + Electron)**
   - Repeat tests with Electron client (if applicable) working alongside a browser to isolate client-specific behaviour.
5. **Version-diff logging**
   - Add temporary log: when queue or adapter saves a doc, log previous/next version + content hash to identify which step reverts the data.

## Hypotheses to Validate
1. **Stale queue entries**: Pre-fix operations remain in `offline_queue` and get replayed with older content.
2. **Race between load & local autosave**: After load, the local client schedules an autosave using cached content without comparing the latest DB version.
3. **Workspace mismatch**: `WorkspaceStore` still resolves different workspace IDs under certain conditions (e.g., when `workspaces` table empty on first load).
4. **Adapter default**: The plain-mode adapter may supply `version` values that always reset (e.g., no base version sent), so conflict skips never trigger.
5. **Batch endpoint**: `POST /api/postgres-offline/documents/batch` might process operations without respecting workspace or version safeguards.

## Proposed Investigation Steps
1. **Clear queue state**
   - `TRUNCATE offline_queue, offline_dead_letter;` (after backing up) and repeat the two-browser test. Note if divergence persists.
2. **Instrument queue processing**
   - Temporarily log `note_id`, `panel_id`, `workspace_id`, `content hash`, `baseVersion`, `nextVersion`, and actor (`update`/`create`) before insertion.
3. **Add debug endpoint**
   - Build a read-only API (or SQL script) that surfaces the last N operations for a note across `document_saves` + queue entries, including actor metadata.
4. **Check adapter payloads**
   - Inspect the plain adapter’s saved payload (both network inspector and offline queue data) to ensure it includes `version` and matches DB content.
5. **Simulate version conflict**
   - Manually insert a higher version in DB, then trigger queue flush for the same doc. Confirm the new guardrails skip the stale operation; if not, capture `SELECT` output to see why.
6. **Workspace adoption**
   - Add logging in `WorkspaceStore.getDefaultWorkspaceId` to confirm the resolved workspace per request. Ensure logs show identical IDs across both browsers.
7. **Client-side autosave timing**
   - Instrument the frontend (temporary console logs) to see when it posts to `/documents` after loading and what content/version it sends.

## Deliverables
- **Investigation Log**: Chronicle each experiment, queries run, and observed behaviour.
- **Timeline of operations**: For a single reproduction session, produce a step-by-step timeline (browser A vs browser B) with DB state snapshots.
- **Root cause report**: Summarize findings, confirm whether queue replay, workspace mismatch, or client autosave is responsible, and outline fix options.
- **Fix proposal**: Depending on results, draft changes (e.g., stronger optimistic concurrency in queue, ensure clients send base version, or enforce workspace adoption earlier).

## Coordination
- Needed access: database logs, ability to run SQL, ability to modify frontend instrumentation temporarily.
- Stakeholders: persistence/queue maintainers, frontend team for autosave logic, infra for migration confirmation.

## Success Criteria
- Reproduce divergence in a controlled test and capture precise source (queue entry, API save, adapter save).
- Demonstrate a test run where guardrails prevent the overwrite (either via code change or configuration) and both browsers converge on the same content.
- Document final remediation steps and tests for regression coverage (unit/integration).

