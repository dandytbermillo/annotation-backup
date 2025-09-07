# Writer Policy — Live Context

- Scope: Assistant may write within `.context-memory/` without additional approval. Writes to `codex/` still require explicit approval.
- Logging: Append a `note` to `.context-memory/live/journal.ndjson` for significant actions (commands run, file edits, state updates). Say “log everything” to increase verbosity.
- Refresh: After notable updates, run `.context-memory/scripts/summarize.js` to refresh `summary.md`.
- Safety: Never include secrets/PII. Follow file budgets noted in `.context-memory/live/README.md`. Use `live/lock` if long multi-step writes are needed.

This policy records the user-approved change allowing assistant writes within `.context-memory/` only.

Automation
- Auto Chat Logging: Enabled. User and assistant messages are recorded as `chat` events in `journal.ndjson` with timestamps.
- Auto Refresh: Enabled. `summary.md` is refreshed after notable updates and chat events.

Output Styling Preferences (User-Requested)
- Emphasis: Use underlined text for important notices in CLI/terminal outputs (ANSI underline `\x1b[4m...\x1b[0m`). Avoid background colors.
- Docs/Markdown: Prefer clear headings and bold. Underline using `<u>...</u>` only when necessary and readable in the target renderer.
- Consistency: Do not introduce background color blocks in examples or logs. Preserve emojis/icons for quick scanning.

Clarification & Approval Protocol (User-Requested)
- Always Ask: If a user request is ambiguous or scope is unclear, ask for clarification before making changes.
- Restricted Areas: Never modify `context-os/` (or other protected folders) without explicit user approval. Default write area is `.context-memory/` only.
- Scope Confirmation: Confirm target files, commands, and expected outputs prior to edits outside `.context-memory/`.
- Change Log: Log significant intent (what/where/why) in `journal.ndjson` before and after approved changes.
