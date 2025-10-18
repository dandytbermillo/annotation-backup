
# Project Conventions – Dual-Mode Annotation System (Authoritative CLAUDE.md)

> Purpose: definitive rules and guardrails for AI agents (Claude / Agent-OS) and human contributors.  
> Agents MUST load this file as top-priority context before proposing or applying changes.
>
> Modes: The project supports two modes. Current focus is Option A (offline, single-user, no Yjs). Option B (multi-user/live collaboration with Yjs) is a future phase. Keep schemas/adapters compatible with Yjs, but do not implement live CRDT in Option A.

---

## MANDATORY HONESTY AND ACCURACY REQUIREMENTS

**CRITICAL: Agents (Claude) MUST maintain absolute honesty and accuracy at all times.**

### Truth Requirements:
- **NEVER claim something works without actually testing it** - Show real command output or state "not tested"
- **NEVER mark features as complete without verification** - Run actual tests and show results
- **NEVER fabricate test results or success claims** - If something fails, report the failure honestly
- **ALWAYS distinguish between**:
  - What is implemented vs what is planned
  - What actually works vs what theoretically should work
  - What was tested vs what was assumed
  - What can be done vs what cannot be done

### When Testing:
- **ALWAYS show actual command output** - Don't summarize or claim success without evidence
- **ALWAYS run the actual commands** - Don't simulate or pretend to run them
- **ALWAYS report errors and failures** - Don't hide or gloss over problems
- **ALWAYS verify claims before making them** - Test first, report second

### When Implementing:
- **State "I will create"** not "this exists" when building new features
- **State "I'm attempting"** not "this works" before verification
- **State "This should"** not "this does" for untested functionality
- **State limitations clearly** - If something cannot be done, say so immediately

### No Assumptions Policy:
- **NEVER assume you understand anything without reading the required sources**
- **ALWAYS read referenced files completely before acting** - If any instruction references a file, read it first
- **ALWAYS verify your understanding against authoritative sources** - Don't assume based on patterns, experience, or partial information
- **ALWAYS read command specifications, documentation, and requirements fully** - No shortcuts or assumptions
- **ALWAYS start with the source of truth** - Don't rely on summaries, inline snippets, or your assumptions

### Investigation and Analysis Policy:
- **ALWAYS read the codebase thoroughly** - When investigating issues, read all relevant files completely, not just snippets
- **NEVER draw conclusions without using tools** - Use SQL queries, run scripts, examine logs, and verify with actual data
- **NEVER lie or fabricate understanding** - If you don't know or don't understand something, explicitly state so
- **When unsure, iterate until certain** - Keep investigating and verifying until you have complete confidence in your findings
- **ALWAYS verify database state with actual queries** - Don't assume what's in the database; run SQL queries to check
- **ALWAYS trace execution paths completely** - Follow the code flow from start to finish, reading every file involved
- **ALWAYS test your conclusions** - After forming a hypothesis, verify it with concrete evidence (queries, logs, tool output)
- **Document your investigation process** - Show the tools used, commands run, and actual output received

### Agreement and Understanding Policy:
- **NEVER agree with the user without understanding** - Don't say "you're right" or "absolutely correct" unless you have:
  1. Read and analyzed the relevant code/data
  2. Verified the user's statement against evidence
  3. Understood the full context of the issue
- **NEVER give empty affirmations** - Phrases like "you're absolutely right" without substantiation are prohibited
- **When the user provides feedback or corrections**:
  1. First analyze what they're saying
  2. Check it against the actual code/data
  3. Only then acknowledge if they are correct, with specific reference to what you verified
- **If unsure, say so** - "Let me verify that" is better than false agreement

### Accountability:
- If caught in an error or false claim, immediately:
  1. Acknowledge the mistake
  2. Correct the false information
  3. Show what actually happens
  4. Explain why the error occurred
  5. Prevent similar errors going forward

**Violation of these honesty requirements is the most serious breach of project conventions.**

---

## MANDATORY VERIFICATION CHECKPOINTS

**CRITICAL: Before making ANY claim about code status, implementation, or testing, agents MUST complete these verification steps.**

### Before Claiming Code Works:

**REQUIRED STEPS (All must be completed):**

1. **Read Current File State**
   ```
   ✓ Use Read tool to read the ENTIRE current file
   ✓ Verify the exact lines you claim exist
   ✓ Copy the actual line numbers and code snippet
   ✓ State: "I verified lines X-Y in [file] contain: [snippet]"
   ```

2. **Verify Implementation Origin**
   ```
   ✓ If you wrote it: Cite the specific message/tool call where you wrote it
   ✓ If user wrote it: State "User modified [file] with [changes]"
   ✓ If unknown: State "I cannot determine who implemented this code"
   ✓ NEVER claim "YOU implemented..." unless explicitly stated in system reminder
   ```

3. **Run Actual Tests**
   ```
   ✓ Use Bash tool to run: npm run type-check
   ✓ Show the complete output
   ✓ If errors exist: Report them, don't claim "fixed"
   ✓ If tests pass: Show the passing output
   ✓ State: "Type-check output: [actual output]"
   ```

4. **Check File Timestamps/Status**
   ```
   ✓ Use Bash tool: ls -la [file] or git status
   ✓ Show the output
   ✓ Verify file was actually modified
   ✓ State: "File last modified: [timestamp]"
   ```

### Before Writing Implementation Reports:

**REQUIRED EVIDENCE (All must be included):**

1. **Code Verification Section**
   ```markdown
   ## Code Verification

   Files modified: [list]

   Verification performed:
   - [ ] Read complete files with Read tool
   - [ ] Verified lines X-Y contain expected code
   - [ ] Ran type-check: [PASS/FAIL + output]
   - [ ] Ran tests: [PASS/FAIL + output]
   - [ ] Checked git status: [output]

   Evidence:
   [Paste actual tool outputs here]
   ```

2. **Implementation vs Proposal Distinction**
   ```markdown
   ## Status Declaration

   - Proposed approach: [description]
   - Current codebase state: [what actually exists in files]
   - Implementation status: [NOT STARTED / IN PROGRESS / COMPLETED / UNKNOWN]
   - Verification date: [timestamp]
   - Verified by: [Read tool line numbers + outputs]
   ```

3. **Test Results Section**
   ```markdown
   ## Test Results

   Type-check:
   ```bash
   $ npm run type-check
   [actual output]
   ```

   Unit tests:
   ```bash
   $ npm run test
   [actual output]
   ```

   Status: [All passing / X failures / Not run]
   ```

### Before Marking Acceptance Criteria Complete:

**REQUIRED FOR EACH CHECKBOX:**

```markdown
- [x] Feature X works
  - Verified: [date/time]
  - Evidence: [tool output / line numbers / test results]
  - Method: [how it was verified]
  - Status: [confirmed working / assumed working / not verified]
```

**FORBIDDEN:**
- Checking boxes without evidence
- Marking complete based on "should work" logic
- Assuming tests pass without running them
- Claiming verification without showing proof

### Mandatory Uncertainty Language:

**When you CANNOT verify something, you MUST use these exact phrases:**

- "I cannot verify this claim"
- "I do not know who implemented this code"
- "I cannot determine from available information"
- "I have not tested this functionality"
- "I assumed X but cannot confirm"
- "This may or may not be implemented"

**ABSOLUTELY FORBIDDEN phrases when uncertain:**

- ❌ "This is complete"
- ❌ "I confirmed this works"
- ❌ "YOU implemented..."
- ❌ "Tests pass" (without showing output)
- ❌ "Fixed" (without verification)
- ❌ "Verified" (without evidence)
- ❌ Checking [x] boxes without proof

### Red-Team Self-Check Triggers:

**STOP and warn the user if ANY of these occur:**

1. **About to mark something complete** → Have you run the verification checklist?
2. **About to claim "fixed"** → Do you have test output proving it?
3. **System reminder contradicts your claim** → Acknowledge the contradiction immediately
4. **Cannot trace implementation to specific message** → State "I cannot determine origin"
5. **No tool output to back up claim** → Don't make the claim
6. **About to write implementation report** → Have you completed all required evidence sections?

### Enforcement Protocol:

**When caught violating verification requirements:**

1. **Immediate acknowledgment:**
   ```
   "I violated verification requirements by claiming [X] without evidence.
   I do not have proof that [X] is true.
   The actual state is: [unknown / contradicts my claim / unverified]."
   ```

2. **Corrective action:**
   - Use Read tool to check current file state
   - Use Bash tool to run actual tests
   - Show all outputs
   - Revise claims to match evidence only

3. **Documentation correction:**
   - Mark any reports as "UNVERIFIED" if lacking evidence
   - Remove any checked acceptance criteria lacking proof
   - Add "Verification Status: FAILED" to affected documents

**Remember: No amount of rules guarantees compliance. User must verify all claims regardless.**

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
 

---

## TESTING & VALIDATION (MANDATORY)
Agents must run and pass these gates before claiming "done".
Dev flow: Iterate in Web dev mode with npm run dev for fast feedback; once working,
validate and wire into Electron via npm run electron:dev.

**Local validation sequence (must be included in PRs/Implementation Reports and CI):**
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

> PRs and Implementation Reports must include exact commands required to reproduce these gates in CI and local dev.

---

## DATA MODEL (Postgres) — authoritative examples (but proposals may propose refinements)
- `notes`: id, title, content, metadata, created_at, updated_at
- `annotations`: id, note_id, type, anchors (jsonb/plain for Option A), anchors_fallback (jsonb), metadata, order, version
- `panels`: id, note_id, position (jsonb), dimensions (jsonb), state, last_accessed
- `document_saves` (Option A): note_id, panel_id, content (json/jsonb or text for HTML), version, created_at
- `snapshots` (Option B): id, note_id, snapshot (bytea), created_at
- `presence` (Option B): **NOT persisted** (awareness is ephemeral)
- `items`: id, type (folder/note), parent_id, path, name, slug, position, content, metadata, icon, color, last_accessed_at, created_at, updated_at, deleted_at

### Items Table - Organization Tree Constraint (MANDATORY)
**CRITICAL**: In the organization section panel (accessed via floating toolbar's org button), the "Knowledge Base" folder (`/knowledge-base`) MUST be the **ONLY** root directory displayed.

**Enforcement rules**:
1. **Database-level**: "Knowledge Base" folder (`path = '/knowledge-base'`, `parent_id IS NULL`) is the canonical root.
2. **Application-level**: All new notes and folders created by users MUST be placed under `/knowledge-base` or its descendants. The application MUST NOT create items with `parent_id IS NULL` except for system folders.
3. **UI-level**: The organization tree view MUST filter to show only items where `path` starts with `/knowledge-base` or `path = '/knowledge-base'`.
4. **Migration requirement**: Any existing items at root level (except Knowledge Base) should be migrated to `/knowledge-base/uncategorized` or appropriate subdirectories.

**Notes**:
- The "Recent" folder was removed in migration 013 because recent notes are shown in a dedicated RECENT section (separate from the organization tree).
- Recent notes may exist at various paths but are displayed separately from the organization tree view.
- Path uniqueness enforced by: `UNIQUE INDEX ux_items_path ON items(path) WHERE deleted_at IS NULL`

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
    - docs/proposal/<FEATURE_SLUG>/test_pages: Manual test pages (HTML/
Markdown), screenshots or assets for visual checks.
    - docs/proposal/<FEATURE_SLUG>/test_scripts: Helper scripts, SQL
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
fixing_doc, test_pages, test_scripts, supporting_files,reports) does not exist, create
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
3. Add subfolders only as needed: fixing_doc, test_pages, test_scripts,
supporting_files,reports.
4. Save implementation/validation reports in fixing_doc with dated
filenames.
5. Link these docs from PR descriptions and cross‑reference changed runtime
files.

### Examples

- adding_batch_save → docs/proposal/adding_batch_save/…
    - fixing_doc/2025-08-30-implementation-report.md
    - test_pages/editor-batching-demo.html
    - test_scripts/sql-verify-document_saves.js
    - supporting_files/ADDING_BATCH_SAVE_IMPLEMENTATION_SUMMARY.md
    - reports/README_VERIFICATION_REPORT.md


Future phase (Option B — Yjs collaboration):
- `initial_with_yjs.md` — collaboration plan
- `docs/yjs-annotation-architecture.md` — Future collaboration reference only (Option B). For Option A, do not implement Yjs runtime or CRDT storage; maintain schema compatibility so Option B can be added later.
- `docs/enhanced-architecture-migration-guide.md` — migration patterns & provider design

Agents must cite relevant files for the active phase and reference exact paths/line ranges when making code changes.

---

## IMPLEMENTATION PLAN PROCESS (How agents must operate)
1. Read `INITIAL.md` (feature request) fully. Treat `INITIAL.md` as the living plan; append clarifications directly if information is missing. Optionally add `Implementation-Plan.md` in the same feature folder if you want a separate plan file.
2. Create the feature workspace under `docs/proposal/<FEATURE_SLUG>/` and keep all feature artifacts there (`reports/`, `implementation-details/`, `post-implementation-fixes/`, `test_pages/`, `test_scripts/`, `supporting_files/`).
3. Implement on a feature branch `feat/{short-name}` with small, focused commits. Run the validation gates after each major task and fix failures promptly.
4. Record issues in `INITIAL.md` under an `ERRORS` section (root cause + reproduction + fix) and maintain an `ATTEMPT HISTORY` as you iterate.
5. Produce a main Implementation Report under `docs/proposal/<FEATURE_SLUG>/reports/` summarizing scope, changes, validation results, and acceptance criteria status. Link it from PR descriptions.

---

## IMPLEMENTATION REPORTS (MANDATORY)
- After each task or meaningful milestone, write a concise implementation report and save it under `docs/proposal/<FEATURE_SLUG>/reports/` (e.g., `YYYY-MM-DD-implementation-report.md`).
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

## DEBUGGING AND FIXING POLICY

**CRITICAL: Take time to properly understand and fix issues. Rushing leads to broken code.**

### Analysis Before Action:
- **STOP and understand first** - Read all relevant code files completely before making any changes
- **Trace the execution flow** - Understand how components interact and where data flows
- **Identify the root cause** - Don't fix symptoms, fix the actual problem
- **Consider side effects** - Think about what else your change might affect

### Implementation Approach
- **Plan before coding** - Write out your approach before implementing
- **Create backups before editing** - Before modifying any file, create a copy in the same directory with the suffix `.backup` appended (e.g., `component.tsx` → `component.tsx.backup`). Before each subsequent edit pass, create an additional snapshot from the current working file using an incremented suffix (e.g., `component.tsx.backup.1`, `component.tsx.backup.2`, ...). Keep every backup until the fix is fully verified so you can roll back to any prior state.
- **Make incremental changes** - Small, focused changes that can be easily reverted
- **One fix at a time** - Don't combine multiple fixes in a single change
- **Test mentally first** - ultraThink through the execution path with your changes

### Failure Recovery:
- **If a fix fails once** - Re-read the relevant code and reconsider your approach
- **If a fix fails twice** - STOP. Start analysis from scratch. You likely misunderstood something fundamental
- **After repeated failures** - Document what you've tried and ask for clarification rather than trying again

### Time Management:
- **Never rush** - Better to take 10 minutes to get it right than 2 minutes to break it
- **Read error messages carefully** - They often tell you exactly what's wrong
- **Verify assumptions** - If you think something works a certain way, verify it in the code
- **Double-check before submitting** - Review your changes one more time before applying them

**Violation of this policy after being warned is considered a critical failure.**

---

## ERROR LOGGING OR ANY `INITIAL.md` USAGE
- **Required debug log reference**: Before any debugging or testing activity, agents must consult and follow `codex/how_to/debug_logs.md`, recording debug output exactly as instructed every time logs are needed.
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
- Implementation plans/reports should anticipate tagging schema additions (nullable fields, tags table, m2m relations) where appropriate.

---

## BRANCHING & PR RULES
- `main` = stable (protected)
- `dev` = integration
- `feat/{name}` = feature branches
- PR titles: `feat(postgres): add postgres persistence adapter` (scope + short description)
- PR description must include: `INITIAL.md` link, Implementation Report link, test run status, and a short changelog.

---

## ESCALATION POLICY
- If `iteration_count >= 5` and last error `resolved: false` → tag `@maintainer` and open `docs/error-log.md` with full context (attempts, logs, reproduction).
- If any failing test indicates `security` or `data-loss`, **stop** automated runs and notify a human immediately.
- For high-risk merges (DB migrations, schema changes), require one human approver plus green CI.

---

## OPERATIONAL CHECKS FOR IMPLEMENTATIONS (Quick list agents must confirm)
- [ ] All file paths exist or are explicitly marked as `NOT FOUND` with proposed stubs.
- [ ] Validation gates are runnable locally and in CI.
- [ ] DB migrations are present in `migrations/` and idempotent.
- [ ] Reversible migrations: each change includes both `.up.sql` and `.down.sql`, tested forward/backward.
- [ ] `INITIAL.md` is updated with attempt history and any error summaries.
- [ ] Implementation report saved under `docs/proposal/<FEATURE_SLUG>/reports/`.

---

## CONTACT / MAINTAINERS
- Primary maintainer: `@maintainer` (replace with GitHub handle)
- For infra/CI: `@ci-admin`  
- For architecture clarifications: `@arch-lead`

---

## NOTES
- Keep `CLAUDE.md` short and prescriptive. This file is the single-source policy the agent must obey — if a PR or change diverges from it, it must be documented and justified in the PR description and associated reports.
- Feature flags: when a temporary flag (e.g., `NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY`) has been fully implemented, tested, and confirmed stable, agents must remind the user to schedule removal of the flag or switch it off before closing out the work.

## References / Knowledge Sources
 When fixing or extending the codebase, always consult the following sources for context:
- **annotation-backup/fixes_doc/**  
  Contains documentation of previous fixes and troubleshooting notes.  
  Agents must review this folder first before implementing new fixes to avoid repeating work or reintroducing solved issues.
- **docs/proposal/<feature>/fixed/**  
  Stores canonical postmortems for resolved issues (e.g., inspector flushSync fix).  
  Check any relevant `fixed/` note before debugging similar symptoms so you reuse the established solution.

 
