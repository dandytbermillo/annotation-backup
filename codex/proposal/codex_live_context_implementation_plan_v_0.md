# Codex Live Context — Comprehensive Implementation Plan (Guide‑Free)

**Goal**  
Give any LLM/Codex instance a shared, always‑current understanding of the repository **without** adopting a heavy documentation framework. Do this by maintaining three tiny, repo‑local files that reflect reality in near‑real‑time:

- `.codex/state.json` — the current focus (feature/branch/status)
- `.codex/journal.ndjson` — append‑only event log of what actually happened
- `.codex/summary.md` — a fast, human/LLM‑readable digest
- *(Optional)* `.codex/lock` — cooperative write lock for multi‑agent safety

This plan defines **what to build**, **how agents should behave**, **acceptance criteria**, and **risk controls**.

---

## 0) Scope & Non‑Goals

**In scope**
- Minimal shared memory for agents via `.codex/*`
- Deterministic event capture around commits, tests, and notable changes
- Lightweight summarization for quick context loading
- Multi‑agent safety via a simple lock convention
- CI/PR integration that surfaces the summary (read‑only)

**Out of scope**
- Full documentation process (feature folders, severity directories)
- Secrets management or PII redaction beyond basic filters
- Full telemetry or analytics pipeline

---

## 1) Deliverables

1. **Repo structure**: `.codex/` folder with schemas and housekeeping rules
2. **Agent behavior contract**: start‑up, read/write, and conflict rules
3. **Event sources**: commit activity, test summaries, notable issues/fixes
4. **Summarization rules**: content, size budgets, rotation
5. **Multi‑agent lock**: read/write etiquette and back‑off
6. **CI/PR surfacing**: surface `.codex/summary.md` in PRs (read‑only)
7. **Validation suite**: scenarios+checks to prove the system works

---

## 2) Architecture Overview (text only)

**Data flow**
- Actions in the repo (commits/tests/problems/fixes) ⟶ **events** (append line to `journal.ndjson`)
- Recent events ⟶ **summary** (condensed digest in `summary.md`)
- Human intent ⟶ **state** (current feature/branch/status in `state.json`)

**Agent roles**
- **Reader** (default): Loads `state+summary+journal tail` and operates context‑aware
- **Recorder**: Appends one‑line, factual events; updates summary
- **Summarizer**: Recomputes `summary.md` from the last *N* events

---

## 3) Data Contracts

### 3.1 `.codex/state.json` (authoritative hints)
A small JSON object agents **read at start** and may update intentionally.

**Required keys**
- `current_feature`: short slug or area being worked on (e.g., `branching_ui`)
- `current_branch`: VCS branch name
- `status`: one of `in_progress | testing | complete | blocked`
- `last_updated`: ISO8601 timestamp
- `notes` (optional): one‑line human hint (≤120 chars)

**Constraints**
- Single file, overwritten atomically
- Size budget: ≤ 2 KB

### 3.2 `.codex/journal.ndjson` (append‑only truth)
Each line is a standalone JSON object; no edits in place.

**Event required fields**
- `ts` (ISO8601)
- `type` (one of: `commit | test | issue | fix | note | ci | perf | build`)

**Type‑specific minimal fields**
- `commit`: `sha`, `files_changed` (int), `message` (≤120 chars)
- `test`: `result` (`pass|fail|mixed`), `count` (int), `focus` (optional tag)
- `issue`: `desc` (≤120 chars), `area` (tag), `severity` (optional free‑form)
- `fix`: `desc` (≤120 chars), `area` (tag), `links` (optional array)
- `perf`: `metric` (e.g., `p95_ms`), `delta_pct` (number), `env` (`dev|stg|prod`)
- `note`: `text` (≤120 chars)

**Constraints**
- Append‑only; never rewrite history
- Max line length: ≤ 2 KB; truncate with `…` if needed
- Retention: keep last ~10,000 lines (rotation allowed)

### 3.3 `.codex/summary.md` (fast orientation)
Plain‑language, bounded file designed for humans & LLMs to load quickly.

**Sections (all optional but recommended)**
- **Current Work**: feature, branch, status, last updated
- **Recent Activity**: last ~5–10 commits/issues/fixes with bullets
- **Health Snapshot**: tests (pass/fail/mixed), any notable perf change
- **Open Questions / Next Steps**: 3–5 bullets max

**Constraints**
- Size budget: ≤ 2,000 words (prefer ≤ 500)
- Must be derivable from `journal.ndjson` + `state.json`

### 3.4 `.codex/lock` (cooperative lock)
- Zero‑byte (or small) file whose presence signals **write lock held**
- Writers **must** create+remove atomically; readers ignore

---

## 4) Agent Behavior Contract

### 4.1 Start‑up sequence (for every LLM/Codex instance)
1. Read `.codex/state.json` → cache
2. Tail last **50–200** lines of `.codex/journal.ndjson`
3. Read `.codex/summary.md` (if present)
4. Derive a working context (current focus, recent activity, risks)

### 4.2 Read vs Write modes
- Default **Read‑Only** unless explicitly asked to record
- To write, agent must:
  1) Check for `.codex/lock`; if exists → **do not write**
  2) Create `.codex/lock` (atomic)
  3) Perform **one** of: append event, update state, regenerate summary
  4) Remove `.codex/lock`

### 4.3 Event recording rules
- Record **facts, not aspirations** ("tests failed", not "tests will pass")
- Prefer one event per concept (don’t bundle unrelated details)
- Use short tags in `area` (e.g., `auth`, `editor`, `sync`)
- Never exceed size budgets; truncate safely

### 4.4 Summarization rules
- Summaries must be **traceable** to specific recent events
- No secrets, tokens, or user PII
- Prefer **deltas** (“+35% p95” over “slow”)
- Keep **Next Steps** actionable & bounded (≤5 items)

### 4.5 Human‑in‑the‑loop policy
- Any *structural* change (renaming keys, moving files, rotations) → propose as a patch (do not apply automatically)
- Content writes (new event lines, status bump, summary refresh) → allowed with lock

---

## 5) Phased Implementation Plan (LLM/Codex Executable)

### Phase A — Initialize & Safeguards
**Objective**: Establish `.codex/` with schemas, lock etiquette, and size budgets.

**Tasks**
- Create `.codex/` directory if missing
- Create initial `state.json` with placeholders
- Create empty `journal.ndjson` (or rotate existing)
- Create initial `summary.md` from `state.json`
- Document lock etiquette in a one‑line `.codex/README` (optional)

**Acceptance Criteria**
- `.codex/` exists with all three files
- Files validate against the contracts above
- Repo can be cloned on a clean machine and agents still load context

---

### Phase B — Event Sources (Minimal)
**Objective**: Ensure key events are captured with minimal overhead.

**Tasks**
- On commit completion, record a `commit` event (sha, files_changed, message)
- When tests are run intentionally, record a `test` event (pass/fail/mixed, count)
- Allow a manual “issue” and “fix” event recording flow (prompt‑driven)

**Acceptance Criteria**
- After 3 commits and 1 test run, `journal.ndjson` shows 4 valid lines
- Lines are ≤2 KB each and parse as JSON
- No duplicate or bundled events for unrelated concepts

---

### Phase C — Summary Generation
**Objective**: Produce a concise `summary.md` from the last N events.

**Tasks**
- Compute **Current Work** from `state.json`
- Render **Recent Activity** from last 5–10 events (priority: commits, issues, fixes)
- Render **Health Snapshot** from last test/perf events
- Render **Next Steps** if present in `state.json.notes` or inferred from recent issues

**Acceptance Criteria**
- `summary.md` ≤ 500 words after typical day of work
- Every bullet in Recent Activity maps to a real event in `journal.ndjson`
- Contains no secrets or stack traces longer than 1 line

---

### Phase D — Concurrency & Locking
**Objective**: Guarantee safe writes when multiple agents are active.

**Tasks**
- Enforce lock check before any write
- Acquire lock, perform **one atomic write**, release lock
- Back‑off + retry guideline (e.g., 50–250 ms jitter, max 5 attempts)

**Acceptance Criteria**
- Simulated 2‑agent write attempts never corrupt files
- No partial lines in `journal.ndjson`
- Lock is always removed after failures (or escalated with a human notice)

---

### Phase E — CI & PR Surfacing (Read‑Only)
**Objective**: Make the digest visible in code review without new process.

**Tasks**
- Expose `.codex/summary.md` in PR descriptions (quoted or linked)
- Treat CI as a **reader** only (never writes to `.codex/`)

**Acceptance Criteria**
- New PR displays a short summary block referencing `.codex/summary.md`
- Reviewers can orient themselves in ≤ 30 seconds

---

### Phase F — Rotation & Size Control
**Objective**: Keep files small and performant over time.

**Tasks**
- If `journal.ndjson` > 5 MB or > 10,000 lines → rotate (archive to `.codex/archive/`)
- Ensure `summary.md` never exceeds the size budget
- Ensure `state.json` remains compact and current

**Acceptance Criteria**
- After synthetic heavy use, files stay within budgets
- Archive folder contains previous segments without breaking start‑up

---

## 6) Test Plan (Agent‑Runnable Scenarios)

**T1 — Cold Start**
- Given a fresh clone with `.codex/` present
- When agent starts
- Then it derives current feature/branch/status and lists 5 recent activities

**T2 — Commit & Test**
- After 2 commits and a test run
- Then journal has 3 valid lines and summary reflects them

**T3 — Concurrent Writers**
- Two agents attempt to append
- Only one acquires lock and writes; the other retries and succeeds later

**T4 — Redaction & Budgets**
- Inject a long error message as an `issue` description
- Summary truncates/filters to keep within budget; no secrets leak

**T5 — Rotation**
- Simulate 10,001 events
- Journal rotates; cold start still loads last segment + summary

**T6 — Human‑in‑the‑Loop**
- An agent proposes schema change (e.g., new event type)
- Output is a patch proposal; no direct edits; requires approval

---

## 7) Governance & Controls

- **Truth‑first**: Journal records *what happened*, never plans
- **Minimal keys**: Keep data model tiny and stable
- **Privacy**: Never include secrets, tokens, or user PII
- **Human review**: Structural changes only via patch proposals
- **Crash safety**: Atomic writes (temp file → move) recommended for writers

---

## 8) Risk Register & Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| Agents overwrite each other | High | Lock file + atomic writes + retry |
| Journal grows too large | Med | Rotation policy + budgets |
| Vague events | Med | Contract with required keys + size limits |
| Secret leakage | High | Redaction filters + ban stack traces in summary |
| CI writes to `.codex/` | Low | CI policy: read‑only; fail builds if write detected |
| Schema drift | Med | Patch‑only changes + version field if needed |

---

## 9) Operational Playbooks

**Update current focus**
- Edit `state.json` → set `current_feature`, `current_branch`, `status`, update `last_updated`, optionally add `notes`.

**Record a notable issue/fix**
- Append one line to `journal.ndjson` with `type=issue|fix` and short `desc`.
- Regenerate `summary.md`.

**Investigate a regression**
- Search recent `perf` or `issue` events filtered by `area`.
- Add a `note` event for findings; keep under 120 chars.

**Rotate journal**
- Move old journal to `.codex/archive/journal-<ISO>.ndjson`; keep last segment live.

---

## 10) Adoption Tracks (Good → Better → Best)

- **Good (Manual)**: Human updates journal & summary at commit time/day‑end
- **Better (Semi‑Auto)**: Agent records commits/tests; human adds issues/fixes
- **Best (Auto)**: Agent also summarizes after each commit batch and manages rotation

---

## 11) Acceptance Checklist (Go/No‑Go)

- [ ] `.codex/` folder present with `state.json`, `journal.ndjson`, `summary.md`
- [ ] Agents honor lock before writes; concurrency tests pass
- [ ] Journal contains valid, parseable, bounded events
- [ ] Summary is concise, factual, and traceable to events
- [ ] CI/PR surfaces the summary; CI does not write to `.codex/`
- [ ] Rotation keeps sizes within budgets
- [ ] No secrets/PII in any `.codex/*` content

---

## 12) Future Enhancements (Optional)

- **Topic lenses**: Per‑area mini‑summaries (e.g., `/areas/editor.md`)
- **Embeddings**: Vectorize `summary.md` + commit messages for Q&A
- **Graph view**: Render journal event dependencies for visualization
- **Patch queue**: Store `.patch` files under `.codex/patches/` for review‑first workflows

---

### One‑Page TL;DR for Agents

- **Read**: `state.json` → who/what/where. Tail last 100 `journal.ndjson` lines. Skim `summary.md`.
- **Write** *(only if asked)*: Check `.codex/lock`. Append **one** event OR update `state` OR refresh `summary`. Release lock.
- **Respect budgets**: short lines, no secrets, keep summary lean.
- **Propose structure changes as patches** — never direct‑edit schema.

