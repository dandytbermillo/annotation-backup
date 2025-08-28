
# Feature Request: PostgreSQL-Only Persistence  
*(Electron Failover + Web API Mode)*

> Focus: Ship Option A (offline, single‑user, no Yjs). Keep schema/adapters Yjs‑compatible for a future collaboration phase; see initial_with_yjs.md for that plan.

## Metadata
- **author:** Dandy Bermillo  
- **created_at:** 2025-08-26T00:00:00Z  
- **status:** draft  
- **priority:** high  
- **target_branch:** feat/postgres-only-persistence  
- **estimated_risk:** medium  
- **related_prs:**  
- **iteration_count:** 0  
- **execution_hint:** "Ship Option A (plain offline) first; Web dev mode optional; enable Yjs later"
- **future_compatibility:** "Design must remain Yjs‑compatible (snapshots/updates) for future collaboration phase"
 - **future_compatibility:** "Remain Yjs‑compatible; Option B will add snapshots/updates later"

---

## PROJECT OVERVIEW
Migrate the annotation system from IndexedDB to a **Postgres-only persistence model** focused on a single product mode for this phase:

- **Option A: Offline, single‑user, no Yjs** — Use PostgreSQL as persistence with an offline queue and sync on reconnect. Single‑writer semantics; no CRDT.

Platform targets remain the same:
- **Electron (desktop):** Connect directly to Postgres. Prefer **remote Postgres**, and if unavailable, fall back to **local Postgres**. On reconnect, sync local → remote with an oplog.  
- **Web (browser/Next.js):** Always connect to **remote Postgres via API routes**. No client fallback (Notion-style).  

---

## SUMMARY
Unify persistence across platforms into PostgreSQL, delivering Offline Plain mode first:  

- Plain offline mode (no Yjs). CRUD + editor content stored as structured rows (e.g., ProseMirror JSON/HTML) with an `offline_queue` and batch sync.
- **Electron:** Direct SQL access for performance, with transparent failover (remote → local) and resync.  
- **Web:** Remote-only via API routes, optimized for hot reload and fast iteration.  
- **Development:** Start with **web dev mode** (`npm run dev`) for rapid iteration, then validate in **Electron** (`npm run electron:dev`) for native behavior.  

---

## CORE OBJECTIVES
1. Implement plain offline mode (no Yjs): single‑user semantics, robust queue + sync.
2. Postgres as Primary Storage — Replace IndexedDB entirely.  
3. Electron Failover — Use remote DB when available, fallback to local DB otherwise.  
4. Web Development Mode — Use API routes for Postgres access, enabling hot reload & browser DevTools.  
5. Resync Logic — Oplog/offline_queue reconciliation from local → remote on reconnect.  
6. Future compatibility — Keep schema/adapters Yjs‑ready for a later collaboration phase (see initial_with_yjs.md).

---

## TECHNICAL APPROACH

### Architecture Overview
Modes and flows:

**Option A (plain, Phase 1)**
- Web: Browser → Next.js API Routes → Remote Postgres
- Electron: Renderer → **IPC only** → Main Process → Postgres (Direct Connection).
- The renderer must not import `pg` or open DB connections directly.
### Persistence Layer Design
```ts
// Option A (plain): Entity CRUD + offline queue (no Yjs)
interface PlainCrudAdapter {
  createNote(input: NoteInput): Promise<Note>
  updateNote(id: string, patch: Partial<Note> & { version: number }): Promise<Note>
  getNote(id: string): Promise<Note | null>

  createBranch(input: BranchInput): Promise<Branch>
  updateBranch(id: string, patch: Partial<Branch> & { version: number }): Promise<Branch>
  listBranches(noteId: string): Promise<Branch[]>

  saveDocument(noteId: string, panelId: string, content: ProseMirrorJSON | HtmlString, version: number): Promise<void>
  loadDocument(noteId: string, panelId: string): Promise<{ content: ProseMirrorJSON | HtmlString, version: number } | null>

  enqueueOffline(op: QueueOp): Promise<void>
  flushQueue(): Promise<{ processed: number; failed: number }>
}

class PostgresOfflineAdapter implements PlainCrudAdapter { /* CRUD + offline_queue + batch sync */ }
class PlainOfflineProvider { /* in-memory store; single-writer semantics */ }
```

For the collaboration phase design, refer to initial_with_yjs.md.

### Database Schema
```sql
-- (Optional) enable pgcrypto for gen_random_uuid
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  anchors JSONB NOT NULL,
  version INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- TODO: panels, document_saves, oplog tables

--- -- TODO: panels, document_saves, oplog tables
CREATE TABLE panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  position JSONB NOT NULL DEFAULT '{"x": 0, "y": 0}',
  dimensions JSONB NOT NULL DEFAULT '{"width": 400, "height": 300}',
  state TEXT CHECK (state IN ('active', 'minimized', 'hidden')),
  last_accessed TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE document_saves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  panel_id UUID,
  content JSONB NOT NULL,         -- ProseMirror JSON or structured HTML-as-JSON
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (note_id, panel_id, version)
);

CREATE TABLE oplog (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('create', 'update', 'delete')),
  payload JSONB,
  ts TIMESTAMPTZ DEFAULT NOW(),
  origin TEXT NOT NULL,
  applied BOOLEAN DEFAULT FALSE
);
```




## DEVELOPMENT STRATEGY
### Phase 1: Option A — Plain Offline Mode (Week 1–2)
- Implement `PlainOfflineProvider` and `PostgresOfflineAdapter`.
- Use `offline_queue` for offline ops; batch sync on reconnect.
- Web API routes for CRUD; Electron IPC for direct PG.
- Store editor content as ProseMirror JSON (or HTML) and annotations/branches as normalized rows.

### Phase 2: Electron Integration + Failover Hardening (Week 3)
- Remote→local failover, oplog/opqueue resync, and IPC validation.
- Test offline/online transitions.

<!-- Collaboration phase is intentionally out of scope in this document. See initial_with_yjs.md for details. -->

### Development Commands
```bash
# 1) Start Postgres
docker compose up -d postgres
# 2) Run migrations
npm run db:migrate
# 3) Development
npm run dev          # Web mode (hot reload, API routes)
npm run electron:dev # Electron mode (direct Postgres)
```


### Environment Variables
**Web (.env.local)**
```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/annotation_dev
NEXT_PUBLIC_PERSISTENCE_MODE=api
NEXT_PUBLIC_COLLAB_MODE=plain  # plain
```
**Electron (.env.electron)**
```env
DATABASE_URL_REMOTE=postgres://user:pass@remote:5432/annotation
DATABASE_URL_LOCAL=postgres://postgres:postgres@localhost:5432/annotation_dev
PERSISTENCE_MODE=direct
PG_CONN_TIMEOUT_MS=2000
COLLAB_MODE=plain  # plain
```

## TESTING STRATEGY
### Web (dev)
- API route testing with Thunder Client/Postman
- Offline simulation via browser tools
### Electron
- Remote-down → fallback to local DB
- Remote-up → oplog resync succeeds
- IPC validation between renderer & main
### Test Scripts
```bash
npm run test
npm run test:integration
npm run test:e2e
./validate-persistence.sh
./test-sync.sh
```

## ENVIRONMENT NOTES
- Postgres is already provisioned in `docker-compose.yml` at the repo root.
- Service name: `postgres`
- Default credentials: `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=postgres`, `POSTGRES_DB=annotation_system`
- Agents should **reuse this service** instead of creating a new Postgres container.
 

## DOCUMENTATION & REFERENCES
- docs/annotation_workflow.md
- docs/enhanced-architecture-migration-guide.md
- docs/yjs-annotation-architecture.md — Authoritative for the future collaboration phase.  
  Keep schemas/adapters compatible; implementation deferred to a separate doc (see initial_with_yjs.md).
- initial_with_yjs.md — Future Option B plan (multi‑user/live collaboration with Yjs).
- PRP template: PRPs/templates/prp_base.md
- Generate/execute commands: .claude/commands/generate-prp.md, .claude/commands/execute-prp.md
 
- Pattern reference adapters: 
  - lib/adapters/web-adapter-enhanced.ts (web adapter patterns)
  - lib/adapters/electron-adapter.ts (electron adapter patterns)
- External reference: https://node-postgres.com/ (pg client docs)

## NOTES / COMMENTS
- Option A runs without Yjs. Keep the database schema and adapter boundaries compatible with Yjs so Option B can be introduced later without churn.

## SCOPE (WHAT) 
 
- Implement `lib/adapters/postgres-offline-adapter.ts` 
  (Option A Postgres adapter for plain CRUD + offline_queue).
- Wire Postgres adapter into provider selection 
  for Electron + Web.
- Persist notes, annotations, branches, panels, 
  and document saves (non‑Yjs editor content) to Postgres.
- Provide DB migration scripts (SQL schema only, 
  no data migration from IndexedDB). Use existing `migrations/004_offline_queue.up.sql` and `.down.sql`; do not duplicate the offline_queue migration.

### Out of Scope (for this document)
- Yjs collaboration features (awareness, RelativePosition anchors, live CRDT) — see `initial_with_yjs.md`.
- Mode switching UI and provider factory — plan for Phase 2 after Option A is stable.

## ROLLBACK PLAN
 

* Switch between Postgres modes only:
  - `PERSISTENCE_MODE=remote` → Remote Postgres
   only  
  - `PERSISTENCE_MODE=local` → Local Postgres 
  only  
  - `PERSISTENCE_MODE=auto` → Failover (remote 
  → local)  
  * Can disable offline writes if resync unstable
   (`ALLOW_OFFLINE_WRITES=false`).  
  * Data export/import scripts for safety. 

## FUTURE ENHANCEMENTS
* Postgres replication for multi-device sync.
* Full-text search via Postgres FTS.
* Analytics dashboards.
* Real-time sync via Postgres LISTEN/NOTIFY.
* Cloud backup support.

 


 

 
## ACCEPTANCE CRITERIA
- [ ] Notes, annotations, branches, panels, and document saves (non‑Yjs) persist correctly to Postgres.
- [ ] Electron fallback to local Postgres works when remote is unavailable.
- [ ] Every migration includes both `.up.sql` and `.down.sql` with tested forward/backward application.
- [ ] Plain mode codepath contains no Yjs imports or Y.Doc usage.
- [ ] Oplog resync successfully pushes local changes to remote after reconnection.
- [ ] Integration tests pass for both Web (API routes) and Electron (direct SQL).
- [ ] Renderer communicates with Postgres **only via IPC** (no direct DB handles in renderer).

 
 ## NOTES / COMMENTS
  - Agents and developers must read 
  `docs/yjs-annotation-architecture.md` first.  
  - Preserve YJS design principles (single 
  provider, subdocs, RelativePosition anchors). 
  Replace only the persistence implementation to 
  use Postgres while keeping YJS as the runtime 
  CRDT.  
  - For this PRP, **focus on Electron 
  implementation first**.  
   - Ignore Web API mode until Electron 
  persistence is stable.  
  - Schema must support future YJS real-time 
  collaboration (NOT implementing collaboration 
  now, just ensuring compatibility).
  - No data migration from IndexedDB needed - 
  this is a clean Postgres-only implementation.

---

## ERRORS

### Attempt 1: PRP Execution (PRPs/postgres-persistence.md v3)
**Date:** 2025-08-27
**Status:** Partially Complete

#### Issues Found:
1. **Electron IPC Handlers Missing**
   - **Root Cause:** postgres-offline-handlers.ts was not created
   - **Evidence:** `grep -r "postgres-offline:" electron/` returned no results
   - **Fix Applied:** Created electron/ipc/postgres-offline-handlers.ts with all required IPC channels

2. **Web Adapter Invalid Imports**
   - **Root Cause:** WebPostgresOfflineAdapter incorrectly imported 'pg' package
   - **Evidence:** Client-side code cannot use pg driver
   - **Fix Applied:** Removed pg import, implemented fetch-only approach

3. **Provider Never Initialized**
   - **Root Cause:** PlainModeProvider component not wired in app layout
   - **Evidence:** plainProvider was always null in canvas-panel.tsx
   - **Fix Applied:** Created PlainModeProvider and added to app/layout.tsx

4. **Missing API Routes**
   - **Root Cause:** API routes for branches and queue operations not created
   - **Evidence:** Web adapter would get 404 errors
   - **Fix Applied:** Created all missing API routes under app/api/postgres-offline/

5. **Documentation Not Updated**
   - **Root Cause:** README and offline-first-implementation.md still referenced old architecture
   - **Evidence:** No mention of Option A vs Option B modes
   - **Fix Applied:** Updated both documents with dual-mode architecture

#### Remediation Status:
- ✅ Electron IPC handlers created
- ✅ Web adapter fixed to use fetch only  
- ✅ Provider initialization wired
- ✅ API routes created (notes, branches, documents, queue)
- ✅ Environment variables documented (.env.example)
- ✅ README updated with Option A instructions
- ✅ Architecture docs updated
- ✅ Migration validation script created
- ✅ Test adapter created
- ✅ Integration test placeholder created
- ⚠️ TypeScript errors remain (need fixing)
- ⚠️ Actual test execution pending
- ⚠️ Electron preload.js validation pending

**iteration_count:** 1
