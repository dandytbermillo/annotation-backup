# Project Conventions – YJS-Based Collaborative Annotation System (Authoritative CLAUDE.md)

> Purpose: definitive rules and guardrails for AI agents (Claude / Agent-OS) and human contributors.  
> Agents MUST load this file as top-priority context before generating PRPs or applying changes.

---

## CODE STYLE
- Language: TypeScript + React + Next.js 15
- Collaboration: YJS (CRDT), TipTap Editor
- Styling: Tailwind CSS + Radix UI
- Animations: Framer Motion
- Persistence: **PostgreSQL-only** (remote primary, local failover supported for Electron). No IndexedDB fallback. Schema must remain compatible with future YJS real-time collaboration (not implemented yet).

### Conventions
- Follow existing adapter/provider patterns in `lib/adapters/*` and `lib/sync/*`.
- Use strict TypeScript, `npx tsc --noEmit` or `npm run type-check` as a gate.
- Keep changes small and incremental; prefer adapters over architectural rewrites.

---

## UX PRINCIPLES
- Canvas-based interaction: draggable, zoomable panels.
- Branch-based annotation model: `note`, `explore`, `promote`.
- Real-time awareness: cursors, selections, and viewports.
- ❌ **Minimap is out-of-scope** for this repo — handled later by Infinite Canvas OS.

---

## TESTING & VALIDATION (MANDATORY)
Agents must run and pass these gates before claiming "done".

**Local validation sequence (must be included in PRPs and CI):**
1. `npm run lint` (or `pnpm lint`) — no new lint errors
2. `npm run type-check` (or `npx tsc --noEmit`)
3. `npm run test` — unit tests
4. `docker compose up -d postgres` (CI step for integration)
5. `npm run test:integration` — integration tests that require Postgres
6. `npm run test:e2e` — Playwright or designated E2E suite (multi-client flows)

> PRPs must include exact commands required to reproduce these gates in CI and local dev.

---

## DATA MODEL (Postgres) — authoritative examples (but PRPs may propose refinements)
- `notes`: id, title, content, metadata, created_at, updated_at
- `annotations`: id, note_id, type, anchors (bytea), anchors_fallback (jsonb), metadata, order, version
- `panels`: id, note_id, position (jsonb), dimensions (jsonb), state, last_accessed
- `snapshots`: id, note_id, snapshot (bytea), created_at
- `presence`: **NOT persisted** (awareness is ephemeral)

---

## DOCUMENTATION (MUST READ)
- `docs/yjs-annotation-architecture.md` → **Authoritative architecture doc**. All implementations must comply unless explicitly noted here.
  - **Exception:** swap IndexedDB persistence for PostgreSQL; keep all other YJS principles intact (single provider, subdocs, RelativePosition anchors).
- `docs/annotation_workflow.md` → primary UX flow
- `docs/enhanced-architecture-migration-guide.md` → migration patterns & provider design
- PRP template: `PRPs/templates/prp_base.md`
- Generate/execute command prompts: `.claude/commands/generate-prp.md`, `.claude/commands/execute-prp.md`

Agents must cite these files in PRPs and reference exact paths/line ranges when making code changes.

---

## PRP PROCESS (How agents must operate)
1. **Read `INITIAL.md`** (the feature request) fully; if missing information, append clarification to `INITIAL.md` before generating PRP.
2. **Run `/generate-prp <INITIAL.md>`** (or follow the `generate-prp` command) to output `PRPs/{feature}.md` using `PRPs/templates/prp_base.md`.
   - **IMPORTANT**: If a PRP already exists for this feature (check PRPs/ directory), UPDATE the existing file instead of creating a new one
   - Use consistent naming: for `initial.md` about postgres, use `PRPs/postgres-persistence.md`
   - Add version tracking: increment `version: N` at the top of the PRP when updating
3. **PRP content must include**:
   - Clear goal, acceptance criteria, data models, exact files to modify (with paths), ordered tasks, validation gates, and rollback steps.
   - External references and any required dev setup commands.
4. **Run `/execute-prp PRPs/{feature}.md`** to implement. The executor must:
   - Create a feature branch `feat/{short-name}`
   - Make small commits per task
   - Run validation gates after each major task and fix failing tests
   - Update `INITIAL.md` with concise error entries if failures occur
5. **If `/execute-prp` fails**:
   - Append concise error summary to `INITIAL.md` `ERRORS` section (root cause + suggested fix + reproduction command).
   - Increment `iteration_count` in `INITIAL.md`.
   - Re-run generate → execute cycles, or escalate if iteration threshold reached (see Escalation Policy).

---

## ANTI-HALLUCINATION RULES (must be enforced by agents)
- **File verification**: Before referencing any file, run `git ls-files | rg "<pattern>"` or `test -f` and include the output. If file not found, state `NOT FOUND` and propose a stub file under `lib/stubs/`.
- **Cite exact code**: When suggesting edits, include the file path and a 3–6 line excerpt showing relevant code context.
- **Small diffs only**: Propose minimal, reversible changes. Large refactors must include a rollback plan and run in feature flags.
- **No invented endpoints**: Do not invent server routes or APIs without adding a matching test and server-side handler.
- **Respect YJS runtime**: Never replace YJS with Postgres for live CRDT operations.

---

## ERROR LOGGING & `INITIAL.md` USAGE
- `INITIAL.md` is the single living request + error log for a feature. Agents must:
  - Append concise `ERRORS` entries after each failed attempt (root cause, reproduction, hint, artifacts).
  - Append `ATTEMPT HISTORY` entries on each PR/attempt.
  - Use `iteration_count` and an `ESCALATION` rule (see below).
- Keep logs short; link to full CI logs (e.g. `ci/logs/...`) rather than pasting stack traces.

---

## PLATFORM REQUIREMENTS
- Must support **Web (Next.js)** and **Electron** builds.
- Web: Postgres via API layer (remote-only, Notion-style). No client-side fallback.
- Electron: Postgres with remote→local failover (use remote Postgres if available, otherwise local Postgres).  
    SQLite is not supported in this system.

- Feature branches must include CI configuration that demonstrates both platform test runs where applicable.

---

## ROADMAP NOTES (Authoritative for planners)
- Minimap: **DO NOT** reintroduce here. Handled by Infinite Canvas OS later.
- Next planned feature after Postgres migration: **Tagging system** (tags attachable to notes/annotations/panels; persisted in Postgres).
- PRPs should anticipate tagging schema additions (nullable fields, tags table, m2m relations) where appropriate.

---

## BRANCHING & PR RULES
- `main` = stable (protected)
- `dev` = integration
- `feat/{name}` = feature branches
- PR titles: `feat(postgres): add postgres persistence adapter` (scope + short description)
- PR description must include: `INITIAL.md` link, PRP file link, test run status, and a short changelog.

---

## ESCALATION POLICY
- If `iteration_count >= 5` and last error `resolved: false` → tag `@maintainer` and open `docs/error-log.md` with full context (attempts, logs, reproduction).
- If any failing test indicates `security` or `data-loss`, **stop** automated runs and notify a human immediately.
- For high-risk merges (DB migrations, schema changes), require one human approver plus green CI.

---

## OPERATIONAL CHECKS FOR PRPs (Quick list agents must confirm)
- [ ] PRP references `PRPs/templates/prp_base.md`.
- [ ] All file paths exist or are explicitly marked as `NOT FOUND` with proposed stubs.
- [ ] Validation gates are runnable locally and in CI.
- [ ] DB migrations are present in `migrations/` and idempotent.
- [ ] `INITIAL.md` is updated with attempt history and any error summaries.

---

## CONTACT / MAINTAINERS
- Primary maintainer: `@maintainer` (replace with GitHub handle)
- For infra/CI: `@ci-admin`  
- For architecture clarifications: `@arch-lead`

---

## NOTES
- Keep `CLAUDE.md` short and prescriptive. This file is the single-source policy the agent must obey — if a PR or change diverges from it, it must be documented and justified in the PR description and PRP.

## References / Knowledge Sources
 When fixing or extending the codebase, always consult the following sources for context:
- **annotation-backup/fixes_doc/**  
  Contains documentation of previous fixes and troubleshooting notes.  
  Agents must review this folder first before implementing new fixes to avoid repeating work or reintroducing solved issues.

## PLATFORM REQUIREMENTS
- Must run as Web app (Next.js)
- Must run as local Electron app
- Persistence layer must adapt:
  - Web → Postgres via server API
  - Electron → Postgres or SQLite directly
- Local Postgres is already provided by `docker-compose.yml` in the repo root.  
  Run with: `docker compose up -d postgres`
