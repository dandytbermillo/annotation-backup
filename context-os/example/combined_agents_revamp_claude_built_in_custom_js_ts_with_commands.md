# Combined Agents Revamp
**Claude Built‑in Agent + Your Custom JS/TS Agents (with `/commands`)**

**Version:** 1.0 • **Owner:** Docs/Platform • **Scope:** Developer workflow + documentation pipeline

---

## 0) Purpose & Outcomes
**Goal:** Provide a single, developer‑friendly workflow where teammates (or you) can type a simple `/command`, and Claude’s built‑in agent orchestrates powerful, deterministic tasks implemented in your **custom JS/TS agents**.

**You get:**
- Native UX: short `/commands` inside Claude Code
- Power: Node/TypeScript agents performing the real work
- Safety: reviewable JSON + diffs + patches
- Repeatability: CI validation + strict mode

---

## 1) High‑Level Architecture
```
User ➜ /command
        │
        ▼
Claude Built‑in Agent (router/orchestrator)
        │   exec npm scripts / run CLI with JSON
        ▼
Custom JS/TS Agents (CLI)
  ├─ orchestrator.ts
  ├─ plan-filler.ts
  ├─ verifier.ts
  └─ classifier-agent.js
        │   JSON stdout, non‑zero exit on error
        ▼
Artifacts / Patches / Reports
```

**Design rules:**
- **JSON in/out** only for custom agents (stdout = JSON, logs → stderr)
- **Exit codes:** `0` success, non‑zero failure
- **Idempotent**: same input → same output
- **Repo‑relative paths**
- **Dry‑run first** for write actions; apply behind approval

---

## 2) Core `/commands`
Two minimal commands cover most workflows. Add more later if needed.

### `/execute "<feature>" [--plan "text"] [--init-only]`
**Intent:** Initialize + scaffold + validate a feature docs workspace.

**Built‑in agent does:**
1. Calls `npm run orchestrate -- ./io/in/orchestrate.json > ./io/out/orchestrate.json`
2. Optionally fills plan via `npm run plan:fill` when `--plan` is present
3. Runs validator: `npm run doc:validate` (or `:strict` in CI)
4. Renders summary (created files, status, validation result)

**What users see:** a concise status card and links to generated docs.

### `/fix --feature "<feature>" [--dry-run] [--apply] [--strict]`
**Intent:** Auto‑remediate validator findings safely.

**Built‑in agent does:**
1. Runs custom fixer (Node/TS) that:
   - Adds missing dirs/files (Rule 1)
   - Inserts `---` + fixes link (Rule 2)
   - Moves inline code → `implementation-details/artifacts/` (Rule 4)
   - Normalizes Status (Rule 7)
   - Checks `patches/` naming + index (Rule 8)
2. Re‑runs validator; returns a **patch/diff** for review
3. Applies only if `--apply` or user approves

---

## 3) Contracts & Conventions (Claude ⇄ Agents)
**Standard contract for all agents:**
- **Input:** JSON via `stdin` or `file path arg`
- **Output:** JSON to `stdout` (no extra prints)
- **Errors:** human‑readable logs to `stderr`; exit non‑zero

**Folder conventions:**
- Inputs under `./io/in/…`
- Outputs under `./io/out/…`
- Temporary files in `./.tmp/` (git‑ignored)

**Status vocabulary:** `🚧 IN PROGRESS`, `✅ COMPLETE`, `❌ BLOCKED`

---

## 4) NPM Scripts (Glue Layer)
Add these to `package.json` (TypeScript via `tsx`; swap for `ts-node` or build step if preferred):

```json
{
  "scripts": {
    "orchestrate": "tsx orchestrator.ts",
    "plan:fill": "tsx plan-filler.ts",
    "verify": "tsx verifier.ts",
    "classify": "node classifier-agent.js",

    "doc:validate": "bash scripts/validate-doc-structure.sh",
    "doc:validate:strict": "bash scripts/validate-doc-structure.sh --strict",

    "docfix": "tsx scripts/docfix.ts"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.6.0"
  }
}
```

---

## 5) Minimal CLI Wrappers (Patterns)
### 5.1 `orchestrator.ts` (library + CLI)
```ts
export interface OrchestratorInput { goal: string; feature?: string; context?: any }
export interface OrchestratorOutput { plan: any; steps: any[]; created: string[]; notes?: string[] }

export async function run(input: OrchestratorInput): Promise<OrchestratorOutput> {
  // TODO: scaffold feature dirs per Rule 1, write plan/report stubs, etc.
  return { plan: { title: input.goal }, steps: [], created: [] };
}

if (require.main === module) {
  (async () => {
    const fs = await import('node:fs/promises');
    const arg = process.argv[2] || '-';
    const raw = arg === '-' ? await new Promise<string>(res => {
      const chunks: Buffer[] = [];
      process.stdin.on('data', c => chunks.push(c));
      process.stdin.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
    }) : await fs.readFile(arg, 'utf8');
    const input: OrchestratorInput = raw ? JSON.parse(raw) : { goal: '' };
    const out = await run(input);
    console.log(JSON.stringify({ ok: true, result: out }));
  })().catch(err => { console.error('[orchestrator] error:', err?.stack || String(err)); process.exit(1); });
}
```

### 5.2 `classifier-agent.js` (CLI)
```js
#!/usr/bin/env node
import fs from 'node:fs';

async function classify(input) {
  // TODO: your classification logic
  return { label: 'ok', reasons: [] };
}

(async () => {
  try {
    const arg = process.argv[2];
    const raw = arg && arg !== '-' ? fs.readFileSync(arg, 'utf8') : fs.readFileSync(0, 'utf8');
    const input = raw ? JSON.parse(raw) : {};
    const out = await classify(input);
    console.log(JSON.stringify({ ok: true, result: out }));
  } catch (e) {
    console.error('[classifier] error:', e?.stack || String(e));
    process.exit(1);
  }
})();
```

*(Apply the same wrapper pattern to `plan-filler.ts` and `verifier.ts`.)*

---

## 6) Claude Built‑in Agent Behavior (Routing)
**Parsing rules:**
- `/execute "<feature>" [--plan "text"] [--init-only]` → build `OrchestratorInput` and run `npm run orchestrate`
- `/fix --feature "<feature>" [--dry-run] [--apply] [--strict]` → run `npm run docfix` with flags; then `doc:validate`

**Rendering rules:**
- Parse JSON stdout; show success card with:
  - Created files, updated files
  - Validation status (errors/warnings summary)
  - Diffs/patch preview when applicable
- On non‑zero exit code: render stderr and suggest next steps

---

## 7) Auto‑Fixer (`scripts/docfix.ts`) — Scope & Safety
**What it fixes:**
- Create missing folders/files (Rule 1)
- Enforce TOC structure: add `---`, add link to `../post-implementation-fixes/README.md` (Rule 2)
- Move fenced code blocks from main report → `implementation-details/artifacts/…` (Rule 4)
- Normalize `**Status**:` to allowed values (Rule 7)
- If `patches/` exists: ensure `README.md` and `YYYY-MM-DD-*.patch` naming (Rule 8)

**Safety rails:**
- **Dry‑run by default**: print a fix plan and a unified diff preview
- **Apply mode**: write changes; always echo a patch summary
- **Backups**: store pre‑edit copies in `.docfix-backup/`
- **Scope**: default to changed paths (`git diff --name-only origin/main...HEAD`), support `--all`

---

## 8) Validation & CI/CD
- Local: `npm run doc:validate` (warnings allowed)
- CI (blocking): `npm run doc:validate:strict` (warnings → errors)
- Recommended: Run `/fix --feature <slug> --dry-run` on CI failure to produce a suggested patch for reviewers

**Artifacts:** Save validator reports under:
```
docs/documentation_process_guide/validation-reports/YYYY-MM-DD-<short>.md
```

---

## 9) Security, Privacy, and Limits
- No interactive prompts in agents; require explicit flags
- Agents must respect `.gitignore` and never commit secrets
- Avoid network calls unless required; proxy via env‑guarded configs
- Keep logs on **stderr**; stdout remains parseable JSON only

---

## 10) Troubleshooting
- **Agent prints extra text on stdout** → JSON parse fails in Claude: redirect logs to stderr
- **Multiple main reports** → `/fix` moves extras to `implementation-details/`
- **Status not recognized** → `/fix` normalizes to allowed set
- **Validator fails** → run `/fix --dry-run`; if acceptable, run with `--apply`

---

## 11) Example Workflows
### A) Initialize a new feature
1. `/execute "unified_offline_foundation" --plan "PostgreSQL‑only, Option A"`
2. Edit `Implementation-Plan.md`
3. `npm run doc:validate`

### B) Fix a non‑compliant feature
1. `npm run doc:validate:strict` → fails
2. `/fix --feature "Interval_Free_Batch_Cleanup" --dry-run` → review diff
3. `/fix --feature "Interval_Free_Batch_Cleanup" --apply` → re‑validate

### C) Generate patches safely
- Auto‑fix writes changes and emits a **git patch**; Claude shows diff; you approve merge

---

## 12) Appendix — Input/Output Samples
**`./io/in/orchestrate.json`**
```json
{ "goal": "Scaffold feature docs", "feature": "adding_batch_save" }
```

**CLI**
```bash
npm run orchestrate -- ./io/in/orchestrate.json > ./io/out/orchestrate.json
```

**`./io/out/orchestrate.json`**
```json
{ "ok": true, "result": { "plan": { "title": "Scaffold feature docs" }, "steps": [], "created": ["docs/proposal/adding_batch_save/"] } }
```

---

## 13) Adoption Checklist
- [ ] Add npm scripts and CLI wrappers
- [ ] Implement `/execute` & `/fix` routing in the built‑in agent
- [ ] Land `scripts/docfix.ts` (dry‑run + apply)
- [ ] Add CI job: `doc:validate:strict`
- [ ] Document Status values + severity mapping in templates
- [ ] Pilot on 1–2 features, then roll out

---

**End of Document**

