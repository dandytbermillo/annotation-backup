# .context-memory/live — Live Context Storage

Files
- `state.json` — authoritative hints: current feature, branch, status, notes
- `journal.ndjson` — append-only event log (JSON per line)
- `summary.md` — human/LLM digest derived from recent events + state
- `lock` — presence indicates a writer is active (remove after write)

Budgets
- per-line ≤ 2 KB; summary ≤ 2,000 words (prefer ≤ 500)
- rotate journal at ~5 MB to `live/archive/`

Never include secrets, tokens, or PII.
