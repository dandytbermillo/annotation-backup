# Interval-Free Batch Cleanup

Goal
- Remove top-level `setInterval` timers from batch API routes to avoid HMR duplication, serverless pitfalls, and resource leaks.
- Switch to lazy, request-scoped cleanup with a per-process singleton cache for idempotency.
- Ensure sync monitoring intervals are cleared to prevent leaks.

Scope
- app/api/postgres-offline/documents/batch/route.ts
- app/api/postgres-offline/branches/batch/route.ts
- app/api/postgres-offline/panels/batch/route.ts
- lib/sync/hybrid-sync-manager.ts
- Add explicit Node runtime to the three batch routes.

Design
- Replace interval-based idempotency cleanup with lazy sweeps:
  - Define `type ProcessedEntry = { timestamp: number; result: any }`.
  - Store state on `globalThis.__batch{Documents|Branches|Panels}Store = { map: Map<string, ProcessedEntry>, lastSweep: number }` to be HMR-safe.
  - Add `cleanupProcessedKeys()` that runs at most once per hour; call at the start of each handler.
  - Replace `processedKeys` reads/writes with `store.map`.
- Add `export const runtime = 'nodejs'` to affected routes since `pg` requires Node.
- In `HybridSyncManager`, retain the monitoring interval handle and clear it in `disconnect()`.

Alternatives Considered
- Env-gated intervals (prod only): avoids dev duplication but still risky in serverless and keeps background timers.
- Singleton intervals (per-process): mitigates HMR duplication but retains long-lived timers; still not ideal.
- DB/Redis idempotency with TTL + scheduled cleanup (cron): preferred long-term solution for distributed/serverless deployments.

Risks & Mitigations
- Lazy cleanup occurs on request, so stale keys can persist until next traffic: bounded with TTL and hourly sweep cap.
- Multiple processes (serverless) have separate caches: acceptable for short-lived idempotency; future DB/Redis path recommended.
- `globalThis` namespace collisions: use unique names per route type.

Validation
- Search: `rg -n "setInterval\(" app/api/postgres-offline` returns no matches for the modified routes.
- Type check and build: `npm run type-check && npm run build`.
- Tests: `npm test` and integration tests.
- Manual: call each batch endpoint twice with the same `idempotencyKey`; confirm second call is cached and no background timers run.

Rollout Plan
- Apply the patches below in a branch, run checks, then merge.
- No env changes required; ensure Node runtime is set for these routes.

Rollback Plan
- Revert the patches. If issues persist, consider the DB/Redis idempotency approach.

Future Work
- Migrate idempotency to DB/Redis with TTL and cleanup via a cron (e.g., Vercel Cron or server-side scheduler).
- Optionally extract a small helper to DRY up the idempotency cache pattern across routes.

Included Patches
- api-documents-batch-no-interval.patch — Remove timer, add lazy sweep + global store for documents route.
- api-branches-batch-no-interval.patch — Same for branches route.
- api-panels-batch-no-interval.patch — Same for panels route.
- api-batch-runtime-node.patch — Declare Node runtime for all three routes.
- hybrid-sync-manager-clear-interval.patch — Clear monitoring interval on disconnect.

