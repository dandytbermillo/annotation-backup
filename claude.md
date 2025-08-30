
# Project Conventions – Dual-Mode Annotation System (Authoritative CLAUDE.md)

> Purpose: definitive rules and guardrails for AI agents (Claude / Agent-OS) and human contributors.  
> Agents MUST load this file as top-priority context before generating PRPs or applying changes.
>
> Modes: The project supports two modes. Current focus is Option A (offline, single-user, no Yjs). Option B (multi-user/live collaboration with Yjs) is a future phase. Keep schemas/adapters compatible with Yjs, but do not implement live CRDT in Option A.

---

## CODE STYLE
- Language: TypeScript + React + Next.js 15
- Editor: TipTap
- Collaboration: Yjs (Option B only; out-of-scope for current Option A; do not add Yjs runtime or CRDT logic in Option A)
- Styling: Tailwind CSS + Radix UI
- Animations: Framer Motion
- Persistence: **PostgreSQL-only** (remote primary, local failover supported for Electron). No IndexedDB fallback. Schema must remain compatible with future Yjs real-time collaboration. For local development, use database `annotation_dev`.

### Conventions
- Follow existing adapter/provider patterns in `lib/adapters/*` and `lib/sync/*`.
- Use strict TypeScript, `npx tsc --noEmit` or `npm run type-check` as a gate.
- Keep changes small and incremental; prefer adapters over architectural rewrites.

---

## UX PRINCIPLES
- Canvas-based interaction: draggable, zoomable panels.
- Branch-based annotation model: `note`, `explore`, `promote`.
- Real-time awareness: cursors, selections, and viewports (Option B only; out-of-scope for Option A).
- ❌ **Minimap is out-of-scope** for this repo — handled later by Infinite Canvas OS.

---

## TESTING & VALIDATION (MANDATORY)
Agents must run and pass these gates before claiming "done".
Dev flow: Iterate in Web dev mode with npm run dev for fast feedback; once working,
validate and wire into Electron via npm run electron:dev.

**Local validation sequence (must be included in PRPs and CI):**
1. `npm run lint` (or `pnpm lint`) — no new lint errors
2. `npm run type-check` (or `npx tsc --noEmit`)
3. `npm run test` — unit tests
4. `docker compose up -d postgres` (CI step for integration)
5. `npm run test:integration` — integration tests that require Postgres
6. `./scripts/test-plain-mode.sh` — Option A end-to-end verification (Web/API)
7. `npm run test:e2e` — Playwright or designated E2E suite (multi-client flows)

Migration hygiene:
- Ensure every DB migration has reversible scripts: `.up.sql` and `.down.sql`.
- Validate forward/backward application in CI (apply latest up → verify → apply down → re-apply up).

> PRPs must include exact commands required to reproduce these gates in CI and local dev.

---

## DATA MODEL (Postgres) — authoritative examples (but PRPs may propose refinements)
- `notes`: id, title, content, metadata, created_at, updated_at
- `annotations`: id, note_id, type, anchors (jsonb/plain for Option A), anchors_fallback (jsonb), metadata, order, version
- `panels`: id, note_id, position (jsonb), dimensions (jsonb), state, last_accessed
- `document_saves` (Option A): panel_id, content (json/jsonb or text for HTML), version, updated_at
- `snapshots` (Option B): id, note_id, snapshot (bytea), created_at
- `presence` (Option B): **NOT persisted** (awareness is ephemeral)

---

## DOCUMENTATION (MUST READ)
Current phase (Option A — offline, no Yjs):
- `INITIAL.md` — authoritative feature scope and implementation plan for Option A (single source of truth)
- `docs/offline-first-implementation.md` — architecture for non‑Yjs offline mode
- `docs/annotation_workflow.md` — primary UX flow

 ## Feature Workspace Structure (Required)

- Feature slug: Define a single, lowercase slug for the active plan/feature
(e.g., adding_batch_save). Use this slug for all related docs.
- Root folder: Place all feature artifacts under docs/proposal/
<FEATURE_SLUG>/. Do not scatter files elsewhere.
- Subfolders (create only as needed, to reduce clutter):
    - docs/proposal/<FEATURE_SLUG>/fixing_doc: Implementation reports,
validation reports, decisions, post‑mortems.
    - docs/proposal/<FEATURE_SLUG>/test_page: Manual test pages (HTML/
Markdown), screenshots or assets for visual checks.
    - docs/proposal/<FEATURE_SLUG>/test_script: Helper scripts, SQL
snippets, shell commands for local/integration checks.
    - docs/proposal/<FEATURE_SLUG>/supporting_files: Reference code/
diagrams/fixtures (non‑runtime).
- Filenames: Use dated, descriptive names: YYYY‑MM‑DD-<short-title>.md
(e.g., 2025-08-30-implementation-report.md).
- Slug source of truth: The folder name under docs/proposal/ is the
canonical slug. Also include the slug in the first heading of the feature’s
IMPLEMENTATION_PLAN.md (or a README.md) inside that folder.
- Runtime vs docs: Runtime code lives in app/, lib/, components/, etc.
Documentation and reference‑only code remain under the feature folder.
- Cross‑linking: Implementation reports must link to files changed in
runtime code and any test pages/scripts created in this feature workspace.

### Folder Creation Rule

- If docs/proposal/<FEATURE_SLUG>/ does not exist, agents MUST create it
before adding any feature artifacts.
- Create subfolders only as needed; if a required subfolder (e.g.,
fixing_doc, test_page, test_script, supporting_files) does not exist, create
it before writing files into it.
- Do not write feature artifacts outside docs/proposal/<FEATURE_SLUG>/. If
creation is blocked (permissions/CI), stop and report instead of scattering
files.

### When To Apply

- Feature kickoff: When starting new feature work and creating docs/
proposal/<FEATURE_SLUG>/.
- Multi‑file fixes: When the work spans multiple runtime files or produces
any docs/tests/tools (i.e., more than a trivial edit).
- Ongoing iterations: Reuse the same <FEATURE_SLUG> for follow‑ups; do not
create new roots for sub‑phases.
- Trivial changes: If a change is one‑file/one‑commit with no docs/tests,
this structure is optional.

### How To Use (Quick Steps)

1. Choose a <FEATURE_SLUG> and create docs/proposal/<FEATURE_SLUG>/.
2. Add IMPLEMENTATION_PLAN.md (or a README.md) inside the folder; start with
the slug and a short description.
3. Add subfolders only as needed: fixing_doc, test_page, test_script,
supporting_files.
4. Save implementation/validation reports in fixing_doc with dated
filenames.
5. Link these docs from PR descriptions and cross‑reference changed runtime
files.

### Examples

- adding_batch_save → docs/proposal/adding_batch_save/…
    - fixing_doc/2025-08-30-implementation-report.md
    - test_page/editor-batching-demo.html
    - test_script/sql-verify-document_saves.js
    - supporting_files/ADDING_BATCH_SAVE_IMPLEMENTATION_SUMMARY.md


Future phase (Option B — Yjs collaboration):
- `initial_with_yjs.md` — collaboration plan
- `docs/yjs-annotation-architecture.md` — Future collaboration reference only (Option B). For Option A, do not implement Yjs runtime or CRDT storage; maintain schema compatibility so Option B can be added later.
- `docs/enhanced-architecture-migration-guide.md` — migration patterns & provider design

Common:
- PRP template: `PRPs/templates/prp_base.md`
- Generate/execute command prompts: `.claude/commands/generate-prp.md`, `.claude/commands/execute-prp.md`

Agents must cite relevant files for the active phase and reference exact paths/line ranges when making code changes.

---

## PRP PROCESS (How agents must operate)
1. **Read `INITIAL.md`** (the feature request) fully; for Option A, treat `INITIAL.md` as the PRP (do not create a separate PRP file). If information is missing, append clarification directly to `INITIAL.md`.
2. If and only if a team explicitly opts into the PRP workflow, **run `/generate-prp <INITIAL.md>`** to output `PRPs/{feature}.md` using `PRPs/templates/prp_base.md`. Otherwise, skip this step and continue with `INITIAL.md` as the single source.
   - **IMPORTANT**: If a PRP already exists for this feature (check PRPs/ directory), UPDATE the existing file instead of creating a new one
   - Use consistent naming: for `initial.md` about postgres, use `PRPs/postgres-persistence.md`
   - Add version tracking: increment `version: N` at the top of the PRP when updating
   - If working on collaboration features (Option B), read `initial_with_yjs.md` and ensure the PRP clearly states Option B scope.
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

## IMPLEMENTATION REPORTS (MANDATORY)
- After each task or meaningful milestone, write a concise implementation report and save it to `fixes_doc/option_A/YYYY-MM-DD-<short-title>.md`.
- Each report must include:
  - Summary: what was implemented/fixed and why
  - Changes: files/paths modified and key diffs
  - Migrations/Scripts/CI: added or updated items
  - Commands: how to run, validate, and reproduce
  - Tests: unit/integration/CI results and logs location
  - Errors encountered: the error(s)observed, root cause analysis, and the solution implemented (include file paths/lines,reproduction commands, and how the fix was validated)
  - Risks/limitations: known issues
  - Next steps/TODOs: follow-ups
- Keep reports clear and actionable; link to relevant PRs, CI runs, or logs rather than pasting long outputs.

---

## ANTI-HALLUCINATION RULES (must be enforced by agents)
- **File verification**: Before referencing any file, run `git ls-files | rg "<pattern>"` or `test -f` and include the output. If file not found, state `NOT FOUND` and propose a stub file under `lib/stubs/`.
- **Cite exact code**: When suggesting edits, include the file path and a 3–6 line excerpt showing relevant code context.
- **Small diffs only**: Propose minimal, reversible changes. Large refactors must include a rollback plan and run in feature flags.
- **No invented endpoints**: Do not invent server routes or APIs without adding a matching test and server-side handler.
- **Respect YJS runtime**: Never replace YJS with Postgres for live CRDT operations (Option B). Option A does not implement live CRDT — do not introduce ad‑hoc merge logic.

### Plain Mode Guardrails
- No Yjs imports in plain-mode files (e.g., `lib/providers/plain-offline-provider.ts`, `lib/adapters/*-offline-adapter.ts`, `components/canvas/tiptap-editor-plain.tsx`). CI may enforce via a simple grep step.
- Renderer must not import `pg` or hold DB connections. All database access from renderer goes through Electron IPC to the main process.

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
- Real-time collaboration (awareness, peer sync) is introduced only in Option B.

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
- [ ] Reversible migrations: each change includes both `.up.sql` and `.down.sql`, tested forward/backward.
- [ ] `INITIAL.md` is updated with attempt history and any error summaries.
- [ ] Implementation report saved under `fixes_doc/option_A/YYYY-MM-DD-<short-title>.md`.

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

 
