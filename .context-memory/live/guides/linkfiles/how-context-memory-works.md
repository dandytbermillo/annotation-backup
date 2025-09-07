# How context-memory “remembers” work and stays aligned

Here’s how context-memory “remembers” work and keeps me aligned when you reopen me.

- What gets stored: Append-only events in `.context-memory/live/journal.ndjson`
  - Notes: you log decisions/next-steps via `log-event.js note`
  - Commits: the post-commit hook (or manual `post-commit.js`) logs `sha`, `files_changed`, `message`
  - Tests: `log-event.js test` records pass/fail and count
  - State: `.context-memory/live/state.json` tracks feature/branch/status
  - State: `.context-memory/live/state.json` tracks feature/branch/status

- How it becomes “memory”: Summarizer compiles a digest into `.context-memory/live/summary.md`
  - `summarize.js` renders Current Work, Recent Activity, and Health Snapshot from the last ~N events + state
  - This file + journal are durable local files — they persist across sessions/windows

- Startup rehydrate (read-only): On open, I load the live context
  - Read `state.json` → current focus/status
  - Tail last ~100 lines of `journal.ndjson` → what actually happened
  - Skim `summary.md` → fast orientation
  - Result: I can answer “what did we leave off?” from recent events and summary

- Code changes captured: via commit events
  - Each commit event includes `sha`, `files_changed`, `message` (not diffs)
  - Uncommitted changes aren’t logged until you commit or add a note

- Cross-window vs cross-machine
  - Same machine: works immediately — files live on disk and are reloaded on startup
  - Across machines: `.context-memory/live/*` is ignored by Git (by design), so PRs surface the summary via a CI comment/job summary (that’s your “shared” memory)

- Safety and concurrency
  - Writes use a `.context-memory/live/lock` + atomic rename to avoid corruption
  - CI is strictly read-only; a guard fails if CI tries to write

- Limitations (and an easy habit)
  - Journal tracks events/notes, not full chat transcripts
  - For a reliable “last conversation” recap, log a short wrap-up note at session end and run `summarize.js`
  - If you want literal message history, we can add a `conversations.ndjson` (optional) and a tiny logger/tailer script

- Advanced (optional)
  - Externalize the store with `CONTEXT_MEMORY_LIVE_DIR=/path/to/live` if you want the memory outside the repo folder
  - The PR “Live Context Summary” comment gives teammates the same context in code review without storing live files in Git

