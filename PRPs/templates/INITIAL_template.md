# Feature Request: <SHORT FEATURE TITLE>
<!-- e.g. PostgreSQL Persistence for Notes & Metadata -->

## Metadata
- **author:** <your-name-or-agent>
- **created_at:** YYYY-MM-DDTHH:MM:SSZ
- **status:** draft / in-progress / blocked / done
- **priority:** low / medium / high
- **target_branch:** feat/<short-name>
- **estimated_risk:** low / medium / high
- **related_prs:** (leave blank — agents add PR links)
- **iteration_count:** 0
- **targets**: [web, electron]        # or [web] or [electron]
- **db_schema_changes**: false        # true if schema/migrations involved
- **requires_reversible_migrations**: false  # true to force .down.sql
- **security_sensitive**: false       # true to add stronger security gates
- **performance_sensitive**: false    # true to add perf budgets/gates
- **complexity_hint**: low|medium|high  # optional hint for the LLM

---

## SUMMARY
A one-paragraph summary of the feature and expected user-visible behavior.

Example:
Migrate document persistence from IndexedDB to PostgreSQL so that notes, annotations, panels, snapshots, and metadata are stored in Postgres while keeping YJS as the live CRDT state and retaining IndexedDB as an offline fallback.

---

## MOTIVATION / WHY
- Business value and user impact (short bullets).
- Why this is needed now and how it integrates with the Infinite Canvas OS roadmap.
- Any non-functional goals (scalability, backups, cross-device sync).

---
## SCOPE (WHAT)
Clear scope: what will be changed and what will not. Replace examples with specifics for **this** feature.

**In scope (examples — replace)**
- Implement feature modules/components
- Wire into platform(s) selected in `targets`
- Data persistence changes (only if `db_schema_changes: true`)

**Out of scope (examples — replace)**
- Unrelated UI polish
- Unrelated features not listed in this scope
 
 

---
 ## ACCEPTANCE CRITERIA
- [ ] Functional behavior matches **SUMMARY** and **SCOPE**
- [ ] Unit + integration + e2e tests pass
- [ ] If `targets` includes both `web` and `electron`: parity validated
- [ ] If `db_schema_changes: true`: data persisted and retrieved as specified
- [ ] Offline behavior preserved (if applicable to this feature)

---

## DOCUMENTATION & REFERENCES
List every authoritative doc / file / external URL an agent must load.

- docs/annotation_workflow.md
- docs/enhanced-architecture-migration-guide.md
- docs/yjs-annotation-architecture.md  ← **authoritative architecture doc**
- PRP template: PRPs/templates/prp_base.md
- Generate/execute commands: .claude/commands/generate-prp.md, .claude/commands/execute-prp.md
- Example adapter (if available): lib/adapters/indexeddb-adapter.ts
- (External) Postgres client docs: https://node-postgres.com/ (agent: include specific link)

NOTE: `yjs-annotation-architecture.md` is required reading.  
If **db_schema_changes: true**, follow the persistence rules relevant to the chosen backend (e.g., IndexedDB, Postgres). All other architecture rules remain mandatory.

---

## EXAMPLES & SAMPLE FLOWS
Short, concrete user flows to use as tests and UX-checks. Replace with this feature’s flows.

**Generic examples (replace):**
1. Create annotation → appears in UI; state syncs across clients via Yjs.
2. Move panel → position/state consistently updates across sessions.
3. Snapshot → serialized Yjs update is created and restorable.
4. Offline edit → changes persist locally; on reconnect they merge without data loss.

**DB example (use only if `db_schema_changes: true`):**
• Create annotation → new row in `annotations` and Yjs doc update  
• Move panel → `panels.position` updated  
• Snapshot → `snapshots` row written with Yjs payload

---

## DATA MODEL SKELETON (suggested; use only if `db_schema_changes: true`)
Minimal suggested table names and fields (agents may propose refinements).

- notes (id uuid, title text, created_at timestamptz, updated_at timestamptz, metadata jsonb)
- annotations (id uuid, note_id uuid, type text, anchors bytea/jsonb, metadata jsonb, version int)
- panels (id uuid, note_id uuid, position jsonb, dimensions jsonb, state text, last_accessed timestamptz)
- snapshots (id uuid, note_id uuid, snapshot bytea, created_at timestamptz)

---

## IMPLEMENTATION HINTS (for agents/developers)
- Use `Y.encodeStateAsUpdate(doc)` to persist Yjs state (backend-agnostic payload).
- **If `db_schema_changes: true` and backend is Postgres:**
- Store Yjs payload as `bytea` (or `jsonb` when appropriate).
- Use `ON CONFLICT (id) DO UPDATE` for upserts.
- Use pooled connections (e.g., `pg.Pool`) with retry/backoff.
- Do not persist ephemeral awareness state; keep it in-memory only.

---

## VALIDATION GATES (runnable commands)
Agents must run these steps and include results in the attempt log.

**Syntax / Types**
```bash
npm run lint
npm run type-check
# or
pnpm lint && pnpm type-check
```

**Unit Tests**
```bash
npm run test
```

**Integration Tests (conditional services)**
```bash
# Start only the services this feature needs.
# Example (when `db_schema_changes: true`):
# docker compose up -d postgres
npm run test:integration

**E2E / UX (Playwright)**
```bash
npm run test:e2e
```

---

## ERRORS / KNOWN FAILURES (living log)
*(Append here after each attempt — include concise root-cause + reproduction + hint)*

Structure per entry:

```yaml
- attempt: 1
  date: 2025-08-20T10:00:00Z
  actor: "execute-prp (Claude) / Coder-Agent / human"
  branch: feat/postgres-persistence
  summary: "Integration tests failed: cannot connect to Postgres"
  reproduction_cmd: "docker compose up -d postgres && npm run test:integration"
  root_cause: "POSTGRES_URL not set in .env.local during CI; adapter assumed env var"
  logs_excerpt: |
    Error: connect ECONNREFUSED 127.0.0.1:5432
  suggested_fix: "Update docs to require .env.local and add CI docker step; add clear error if env missing"
  artifacts: ["ci/logs/integration-run-2025-08-20.txt", "pr/123"]
  resolved: false
```

**Guidelines**:
- Keep `logs_excerpt` short (1-10 lines). Link to full logs stored in `ci/` or `docs/error-log.md`.
- `root_cause` must be a single-sentence diagnosis.
- `suggested_fix` helps the next agent write code/tests.

---

## ATTEMPT HISTORY (chronological)
Agents append attempts here (auto-increment `iteration_count`).

Example entry:
```yaml
- attempt: 1
  actor: PlannerAgent
  action_summary: "Generated PRP and created feat/postgres-persistence branch"
  timestamp: 2025-08-20T10:05:00Z
  pr_link: https://github.com/your/repo/pull/123
  result: "tests failed"
  errors_ref: "Errors entry attempt:1"
- attempt: 2
  actor: CoderAgent
  action_summary: "Added pool config and .env check"
  timestamp: 2025-08-20T11:20:00Z
  pr_link: https://github.com/your/repo/pull/124
  result: "integration tests passed; e2e failing on missing minimap references"
  errors_ref: "Errors entry attempt:2"
```

---
## IMPACT MAP (tick what applies)
- [ ] UI only (copy, styles, small UI state)
- [ ] App logic (local state, services)
- [ ] API endpoints
- [ ] Database schema (tables/columns/indexes)
- [ ] Background jobs / schedulers
- [ ] Build / packaging
- [ ] Security model / permissions

## NEXT STEPS / TODO (short & actionable)
- [ ] Add any new env vars to README and `.env.example` (document defaults).
- [ ] If `db_schema_changes: true`: add migration scripts and rollback plan.
- [ ] Write a Playwright scenario exercising the core user flow for this feature.
---

## ESCALATION POLICY
- If `iteration_count >= 5` and `resolved: false` for last error → tag `@maintainer` and open `docs/error-log.md` with full context.
- If any test fails with `security` or `data-loss` category, stop automated runs and notify a human immediately.

---

## NOTES / COMMENTS
Free-form notes or links to related tickets, design docs, or Slack threads.
