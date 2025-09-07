# Linkfiles Index — Context Memory References

Purpose
- Convenience copies for offline browsing; originals remain the source of truth.
- Each entry lists a quick description and the authoritative source path.

Docs
- `context-memory-overview.md`: Comprehensive Context Memory guide
  - Source: `.context-memory/live/guides/context-memory-overview.md`
- `how-context-memory-works.md`: High-level explainer on how memory aligns sessions
  - Source: `.context-memory/live/guides/how-context-memory-works.md`
- `README-LIVE-CONTEXT.md`: Quick intro to Live Context and script usage
  - Source: `.context-memory/README-LIVE-CONTEXT.md`
- `README.md`: Live store layout, budgets, and safety
  - Source: `.context-memory/live/README.md`
- `writer-policy.md`: Write scope, logging rules, and automation
  - Source: `.context-memory/live/writer-policy.md`

Scripts
- `scripts/log-event.js`: Append events (`commit|test|issue|fix|note|chat`) to the journal
  - Source: `.context-memory/scripts/log-event.js`
- `scripts/summarize.js`: Regenerate `summary.md` from `state.json` + recent events
  - Source: `.context-memory/scripts/summarize.js`
- `scripts/post-commit.js`: Log the latest commit (sha, files_changed, message)
  - Source: `.context-memory/scripts/post-commit.js`
- `scripts/install-post-commit-hook.sh`: Install a Git hook to run post-commit and summarize
  - Source: `.context-memory/scripts/install-post-commit-hook.sh`
- `scripts/rotate.js`: Rotate/archive the journal near 5 MB
  - Source: `.context-memory/scripts/rotate.js`
- `scripts/hydrate.js`: Print current state and last N events
  - Source: `.context-memory/scripts/hydrate.js`
- `scripts/backfill-ts.js`: Backfill missing timestamps in the journal
  - Source: `.context-memory/scripts/backfill-ts.js`
- `scripts/check-ci-readonly.js`: Enforce CI read-only policy for live store
  - Source: `.context-memory/scripts/check-ci-readonly.js`
- `scripts/generate-pr-summary.js`: Generate PR-ready summary snippet
  - Source: `.context-memory/scripts/generate-pr-summary.js`
- `scripts/validate-live-context.js`: Validate live store files and sizes
  - Source: `.context-memory/scripts/validate-live-context.js`
- `scripts/utils.js`: Shared helpers for log/summarize utilities
  - Source: `.context-memory/scripts/utils.js`

Excluded From Linkfiles
- Live log/state artifacts and write locks are not copied:
  - `journal.ndjson`, `summary.md`, `state.json`, `lock`, `archive/`

Note
- Edit authoritative files at their source paths above; regenerate copies here if needed.

