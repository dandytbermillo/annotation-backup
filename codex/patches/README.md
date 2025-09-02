Proposed patches to remove risky interval timers and improve lifecycle handling. These are advisory previews only; apply via a PR if approved.

Summary
- Remove top-level `setInterval` timers from batch API routes and use lazy, request-scoped cleanup with a per-process singleton store to avoid HMR duplication and serverless pitfalls.
- Ensure `HybridSyncManager` clears its monitoring interval on `disconnect()` to prevent leaks.

Included diffs
- api-documents-batch-no-interval.patch
- api-branches-batch-no-interval.patch
- api-panels-batch-no-interval.patch
- hybrid-sync-manager-clear-interval.patch

Notes
- These diffs assume Node runtime for the affected API routes. If deploying to serverless, prefer DB/Redis idempotency storage with TTL/cron cleanup instead of in-memory maps.
