[] `.context-memory/live/` present with `state.json`, `journal.ndjson`, `summary.md`
[] Writers honor lock before writes; no partial lines in journal
[] Journal events valid JSON and ≤2KB per line
[] Summary concise, factual, traceable to events
[] CI/PR surfaces summary (read-only)
[] Rotation keeps sizes within budgets
[] No secrets/PII in any live context content

