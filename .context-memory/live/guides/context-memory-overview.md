# Context Memory — Comprehensive Guide

Purpose
- Persistent, local memory for humans and agents to stay aligned across sessions.
- Stores facts and events as append-only logs; produces a concise, human-friendly summary.
- Lives in `.context-memory/` and is intentionally separate from deployable app code.

Design Principles
- Facts first: write raw, traceable events to `journal.ndjson`.
- Summarize second: generate `summary.md` deterministically from recent events + `state.json`.
- Local-first: files live on disk; no network or external service required.
- Safe by default: never store secrets/PII; redact in summaries; small, bounded files.
- Cooperative: simple lock file to coordinate writes; atomic renames for durability.

Directory Layout
- `.context-memory/` — top-level docs and scripts
  - `README-LIVE-CONTEXT.md` — quick intro and script list
  - `scripts/` — Node utilities; no external deps required
  - `live/` — the active local store

- `.context-memory/live/` — live store
  - `state.json` — current feature, branch, status, preferences
  - `journal.ndjson` — append-only log of events (one JSON object per line)
  - `summary.md` — digest of state + recent events, including a Recent Chat section
  - `lock` — presence indicates an in-progress write (ephemeral)
  - `guides/` — human-facing guides (this file lives here)

Core Files and Schemas
- `state.json`
  - Fields:
    - `current_feature`: string (e.g., "initial_live_context")
    - `current_branch`: string (e.g., "feat/live-context") or empty
    - `status`: enum-like string (e.g., `planning|in_progress|blocked|review|done`)
    - `last_updated`: ISO timestamp
    - `notes`: short freeform summary
    - `auto_chat_logging`: boolean — if true, chat messages log to journal
    - `auto_refresh_summary`: boolean — if true, summary refreshes after notable updates
  - Guidance:
    - Keep short but informative. Treat as authoritative hints for orientation.

- `journal.ndjson`
  - One JSON object per line; each event has at least `ts` (ISO) and `type`.
  - Event types (built-in): `commit`, `test`, `issue`, `fix`, `note`, `chat`.
  - Example lines:
    - Commit: `{ "ts": "2025-09-05T05:08:44.500Z", "type": "commit", "sha": "a64f700", "files_changed": 4, "message": "ci: update live context" }`
    - Test: `{ "ts": "2025-09-05T04:45:39.807Z", "type": "test", "result": "pass", "count": 7 }`
    - Note: `{ "ts": "2025-09-06T05:37:22Z", "type": "note", "text": "Enabled timestamps in summary bullets via summarize.js." }`
    - Chat: `{ "ts": "2025-09-06T05:47:05.522Z", "type": "chat", "role": "assistant", "text": "Yes — chat logging is enabled..." }`
  - Budgets: ≤ 2 KB per line. Scripts auto-truncate overly long fields before writing.
  - Rotation: Use `rotate.js` when journal approaches ~5 MB; archives to `live/archive/`.

- `summary.md`
  - Deterministic rendering from `state.json` + recent events.
  - Sections: Current Work, Recent Activity (commits/issues/fixes/tests/notes), Recent Chat, Health Snapshot.
  - Includes simple redaction to avoid secrets in output.

Event Model and CLI Usage
- All event logging uses `log-event.js`:
  - Base: `node .context-memory/scripts/log-event.js <type> [--k=v ...]`
  - Types and fields:
    - `commit`: `--sha=<sha> --files_changed=<n> --message="..."`
    - `test`: `--result=pass|fail|mixed --count=<n> [--focus="label"]`
    - `issue`: `--desc="..." [--area="general|docs|build|..."] [--severity=low|med|high]`
    - `fix`: `--desc="..." [--area="..."]`
    - `note`: `--text="..."`
    - `chat`: `--role=user|assistant --text="..."`
  - Examples:
    - `node .context-memory/scripts/log-event.js note --text="Investigating editor persistence regression"`
    - `node .context-memory/scripts/log-event.js test --result=pass --count=128`

Summarization Pipeline
- `summarize.js` regenerates `summary.md` using:
  - Tail of the last ~200 lines of the journal (recent events bias)
  - `state.json` for Current Work
  - Redaction rules:
    - Mask `sk-...` style tokens
    - Mask long hex/base64-like strings
    - Mask `password=|token=|secret=` values
  - Output size guard warns if summary exceeds ~10KB
  - Recent Chat: last 6 `chat` events are shown

Automation and Preferences
- Preferences live in `state.json`:
  - `auto_chat_logging=true`: subsequent user/assistant messages are appended as `chat` events
  - `auto_refresh_summary=true`: run `summarize.js` after notable updates
- Operational guide: `.context-memory/live/writer-policy.md` documents write scope and automation.

Git Integration and CI
- `.context-memory/live/*` is ignored by Git to avoid noisy diffs; treat as logs/cache.
- CI behavior:
  - Read-only guard: checks that CI never writes to live store
  - PR comment: `generate-pr-summary.js` posts a single auto-updating "Live Context Summary" comment derived from `summary.md`
  - Validation: `validate-live-context.js` ensures the store is well-formed

Scripts Reference
- `log-event.js` — append events (commit, test, issue, fix, note, chat)
- `summarize.js` — regenerate `summary.md`
- `post-commit.js` — log latest commit; invoked by the optional Git hook
- `install-post-commit-hook.sh` — install a hook that runs `post-commit.js` then `summarize.js`
- `rotate.js` — archive journal when large
- `hydrate.js` — utility to read/print current state and last N events
- `backfill-ts.js` — backfill missing timestamps if needed
- `check-ci-readonly.js` — enforce CI read-only policy
- `generate-pr-summary.js` — produce PR-ready snippet from `summary.md`
- `validate-live-context.js` — lint/validate the live context (schema, sizes)

Daily Workflows
- Start session (rehydrate)
  - Read `summary.md` for immediate orientation
  - Check `state.json` for feature/branch/status
  - Tail last ~100 lines of `journal.ndjson` for recent facts

- During work
  - Log decisions: `note` events as you go
  - Record test outcomes: `test` events (include counts/focus if helpful)
  - Commits automatically logged via `post-commit.js` (or run manually)
  - With auto chat logging enabled, important chat turns appear in Recent Chat

- End session
  - Add a short wrap-up `note` with next steps
  - Run `summarize.js` to refresh the digest
  - Optional: `generate-pr-summary.js` to update the PR comment

Safety, Privacy, and Budgets
- Never include secrets, tokens, or PII in events; prefer paraphrasing.
- Summarizer redacts common secret patterns, but prevention is better than cure.
- Budgets:
  - `journal.ndjson`: rotate near 5 MB
  - `summary.md`: aim ≤ 2,000 words (warns near 10 KB)
  - Event lines are truncated to keep ≤ 2 KB per line

Concurrency and Durability
- Cooperative write lock: create `live/lock` during multi-step writes; remove on completion.
- Atomic renames: write to `*.tmp`, then `rename` to avoid partial writes (used by `summarize.js`).

Extending Context Memory
- New event types: add a case in `log-event.js` and extend `summarize.js` if you want them surfaced.
- Customize summarization: adjust ordering, counts, and sections in `summarize.js`.
- Dedicated chat transcripts: current design logs chats into `journal.ndjson`; if you want full transcripts, add `conversations.ndjson` and a tailer.
- Externalize store: set `CONTEXT_MEMORY_LIVE_DIR=/path/to/live` to keep the live store outside the repo.

Troubleshooting
- Summary not updating:
  - Run: `node .context-memory/scripts/summarize.js`
  - Check `state.json` validity and journal tail for malformed JSON
- Stuck lock file:
  - Confirm no writer is active, then remove `live/lock`
- Journal too big:
  - Run: `node .context-memory/scripts/rotate.js`
- CI tried to write:
  - Ensure read-only guard is enabled; inspect CI logs for `check-ci-readonly.js`
- Missing commit entries:
  - Install the post-commit hook: `bash .context-memory/scripts/install-post-commit-hook.sh`

Command Quick Reference
- Log a note: `node .context-memory/scripts/log-event.js note --text="..."`
- Log tests: `node .context-memory/scripts/log-event.js test --result=pass --count=42`
- Log a commit: `node .context-memory/scripts/post-commit.js`
- Refresh summary: `node .context-memory/scripts/summarize.js`
- Validate store: `node .context-memory/scripts/validate-live-context.js`
- Generate PR snippet: `node .context-memory/scripts/generate-pr-summary.js`

FAQ
- Does this sync across machines automatically?
  - No. The live store is intentionally local and ignored by Git; PR comments provide a shared view derived from `summary.md`.
- Can I store full transcripts?
  - Yes, but optional. Add a dedicated transcript file if needed; otherwise, rely on `chat` events and the Recent Chat section in the summary.
- How do I keep secrets out?
  - Don’t paste them. The summarizer redacts common patterns, but always avoid logging sensitive data.

Glossary
- Live Store: the set of files under `.context-memory/live/` used as the persistent local memory.
- Event: a single JSON object representing a fact (commit/test/note/etc.).
- Summary: generated `summary.md` digest used for fast orientation and PR context.
- Rehydrate: the startup process of reading state, tailing the journal, and skimming the summary.

