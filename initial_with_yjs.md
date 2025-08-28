# Feature Request: PostgreSQL-Only Persistence  
*(Electron Failover + Web API Mode)*

## Metadata
- **author:** Dandy Bermillo  
- **created_at:** 2025-08-26T00:00:00Z  
- **status:** draft  
- **priority:** high  
- **target_branch:** feat/postgres-only-persistence  
- **estimated_risk:** medium  
- **related_prs:**  
- **iteration_count:** 0  
- **execution_hint:** "Prioritize Electron PRP first, Web version optional later"
- **future_compatibility:** "Migration must support adding Yjs collaboration in future phases"

---

## PROJECT OVERVIEW
Migrate the annotation system from IndexedDB to a **Postgres-only persistence model**.  

- **Electron (desktop):** Connect directly to Postgres. Prefer **remote Postgres**, and if unavailable, fall back to **local Postgres**. On reconnect, sync local → remote with an oplog.  
- **Web (browser/Next.js):** Always connect to **remote Postgres via API routes**. No client fallback (Notion-style).  

---

## SUMMARY
Unify persistence across platforms into PostgreSQL:  

- **Electron:** Direct SQL access for performance, with transparent failover (remote → local) and resync.  
- **Web:** Remote-only via API routes, optimized for hot reload and fast iteration.  
- **Development:** Start with **web dev mode** (`npm run dev`) for rapid iteration, then validate in **Electron** (`npm run electron:dev`) for native behavior.  

---

## CORE OBJECTIVES
1. **Postgres as Primary Storage** — Replace IndexedDB entirely.  
2. **Electron Failover** — Use remote DB when available, fallback to local DB otherwise.  
3. **Web Development Mode** — Use API routes for Postgres access, enabling hot reload & browser DevTools.  
4. **Yjs Compatibility** — Persist snapshots/updates as binary data for CRDT support.  
5. **Resync Logic** — Oplog-based reconciliation from local → remote on reconnect.  
6. **Execution Priority** — This PRP must implement the **Electron database adapter first**. Web API mode is lower priority and can be postponed.  
7. **Future Compatibility** — Ensure schema + persistence design remain compatible with future **Yjs collaboration integration**.  

---

## TECHNICAL APPROACH

### Architecture Overview
**Web (dev):**  
Browser → Next.js API Routes → Remote Postgres


**Electron (prod):**  
Renderer → IPC → Main Process → Postgres (Direct Connection)


### Persistence Layer Design
```ts
interface PersistenceAdapter {
  persist(docName: string, update: Uint8Array): Promise<void>
  load(docName: string): Promise<Uint8Array | null>
  getAllUpdates(docName: string): Promise<Uint8Array[]>
  compact(docName: string): Promise<void>
}

// Web: API-based
class WebPostgresAdapter implements PersistenceAdapter { ... }

// Electron: Direct SQL
class ElectronPostgresAdapter implements PersistenceAdapter { ... }
```

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
-- TODO: panels, snapshots, oplog tables

--- -- TODO: panels, snapshots, oplog tables
CREATE TABLE panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  position JSONB NOT NULL DEFAULT '{"x": 0, "y": 0}',
  dimensions JSONB NOT NULL DEFAULT '{"width": 400, "height": 300}',
  state TEXT CHECK (state IN ('active', 'minimized', 'hidden')),
  last_accessed TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  snapshot BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
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
### Phase 1: Web Development (Week 1–2)
- Run npm run dev for hot reload.
- Implement API routes for Postgres persistence.
- Validate CRUD + snapshots via browser DevTools.

### Phase 2: Electron Integration (Week 3)
- Add IPC handlers in Electron main.
- Implement remote→local fallback logic.
- Add oplog-based resync worker.
- Test offline/online transitions.

### Phase 3: Advanced Features (Week 4+)
 - Snapshot compaction.
 - Backup/restore tooling.
 - Query optimization & monitoring.
 - Prepare schema for future Yjs real-time sync 
  (LISTEN/NOTIFY).
   
  - **Note**: Full implementation timeline ~3-4 
  weeks for production-ready failover and oplog 
  sync.

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
```
**Electron (.env.electron)**
```env
DATABASE_URL_REMOTE=postgres://user:pass@remote:5432/annotation
DATABASE_URL_LOCAL=postgres://postgres:postgres@localhost:5432/annotation_dev
PERSISTENCE_MODE=direct
PG_CONN_TIMEOUT_MS=2000
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
- docs/yjs-annotation-architecture.md ← **authoritative architecture doc.** All implementations must comply.  
  **Exception:** persistence layer must use PostgreSQL instead of IndexedDB.
- PRP template: PRPs/templates/prp_base.md
- Generate/execute commands: .claude/commands/generate-prp.md, .claude/commands/execute-prp.md
 
- Example adapter (pattern only): lib/adapters/indexeddb-adapter.ts 
  (use as structural reference, not persistence backend).
- External reference: https://node-postgres.com/ (pg client docs)

## NOTES / COMMENTS
- Agents and developers must read `docs/yjs-annotation-architecture.md` first.  
Preserve YJS design principles (single provider, subdocs, RelativePosition anchors). Replace only the persistence implementation to use Postgres while keeping YJS as the runtime CRDT.

## SCOPE (WHAT) 
 
- Implement `lib/adapters/postgres-adapter.ts` 
  (Postgres persistence adapter).
- Wire Postgres adapter into provider selection 
  for Electron + Web.
- Persist notes, annotations, branches, panels, 
  and snapshots to Postgres.
- Provide DB migration scripts (SQL schema only, 
  no data migration from IndexedDB).

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
- [ ] Notes, annotations, branches, panels, and snapshots persist correctly to Postgres.
- [ ] Electron fallback to local Postgres works when remote is unavailable.
- [ ] Oplog resync successfully pushes local changes to remote after reconnection.
- [ ] Integration tests pass for both Web (API routes) and Electron (direct SQL).

 
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