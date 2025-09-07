# Writer Policy — Live Context

- Scope: Assistant may write within `.context-memory/` without additional approval. Writes to `codex/` still require explicit approval.
- Logging: Append a `note` to `.context-memory/live/journal.ndjson` for significant actions (commands run, file edits, state updates). Say “log everything” to increase verbosity.
- Refresh: After notable updates, run `.context-memory/scripts/summarize.js` to refresh `summary.md`.
- Safety: Never include secrets/PII. Follow file budgets noted in `.context-memory/live/README.md`. Use `live/lock` if long multi-step writes are needed.

This policy records the user-approved change allowing assistant writes within `.context-memory/` only.

Automation
- Auto Chat Logging: Enabled. User and assistant messages are recorded as `chat` events in `journal.ndjson` with timestamps.
- Auto Refresh: Enabled. `summary.md` is refreshed after notable updates and chat events.
