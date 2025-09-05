# Live Context Governance

- Truth-first: Journal records what happened (not plans or guesses).
- Minimal model: Keep keys stable and small; prefer additive changes.
- Privacy: Never record secrets, tokens, or PII. Summaries redact obvious tokens.
- Human review: Any schema or structural change must be proposed first (not auto-applied).
- Crash safety: All writes use lock + atomic rename. No partial lines in journal.
- CI policy: CI is read-only; it may read and publish summary, but must not write changes back.

## Writer Rules
- Acquire `live/lock` (atomic create), perform exactly one write, remove the lock.
- Truncate long fields safely before writing (≤ 2 KB per event line).
- Avoid bundling unrelated details into one event.

## Reader Rules
- On start, read `state.json`, tail the last 50–200 `journal.ndjson` lines, and load `summary.md`.
- Derive context (focus, recent activity, health) from those sources.

## Rotation Policy
- Rotate journal at >5MB or >10,000 lines to `live/archive/`.
- Keep the latest segment as `journal.ndjson`.

