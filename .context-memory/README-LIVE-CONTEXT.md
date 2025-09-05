# Live Context for context-os (scoped to .context-memory)

This adds a lightweight, file-based shared context for agents and humans.

Contents
- `live/state.json` — current feature/branch/status/notes
- `live/journal.ndjson` — append-only event log (one JSON object per line)
- `live/summary.md` — short digest derived from recent events + state
- `live/lock` — cooperative write lock (ephemeral)

Rules
- Facts only in the journal; keep lines ≤ 2 KB (auto-truncated when logged).
- No secrets/PII; summaries should be concise and traceable to events.
- Writers must use the lock + atomic writes (scripts do this for you).

Scripts (no external deps; use Node only)
- `node .context-memory/scripts/log-event.js <type> [--k=v ...]`
  - Types: `commit|test|issue|fix|note`
  - Examples:
    - `node .context-memory/scripts/log-event.js note --text="Investigating flake in editor tests"`
    - `node .context-memory/scripts/log-event.js test --result=pass --count=128`
- `node .context-memory/scripts/post-commit.js` — logs the latest commit (sha, files changed, message)
- `node .context-memory/scripts/summarize.js` — regenerates `live/summary.md`
- `node .context-memory/scripts/rotate.js` — rotates the journal if > 5 MB

Optional git hook
- Create `.git/hooks/post-commit` manually to call `post-commit.js` then `summarize.js`.
