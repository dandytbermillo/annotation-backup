# Offline Sync Hardening Patches (Preview)

This folder contains patch previews and helper scripts to align the web API with the offline queue design and stabilize tests.

Scope
- Preview-only: No application changes are made here. Apply diffs manually or approve automation separately.
- All diffs target existing files outside `codex/`.

Patches
- 0001-api-queue-flush-parity.patch
  - Replace request-body processing in `app/api/postgres-offline/queue/flush/route.ts` with a DB-backed queue drain.
  - Mirrors Electron worker behavior: TTL expiry, priority ordering, dependency skip, idempotency, dead-letter after 5 retries, and deletion of processed items.
  - Benefit: Server-driven processing works when Electron isn’t the worker.

- 0001b-api-queue-flush-dual-mode.patch (recommended)
  - Dual-mode for `app/api/postgres-offline/queue/flush/route.ts`:
    - If request body contains `operations[]` and `drain_db !== true` → process provided operations (backward compatible).
    - Otherwise → drain DB `offline_queue` with reliability semantics (TTL, priority, dependencies, dead-letter).
  - Benefit: No breaking changes to existing tests/UI while enabling server-side queue draining.

- 0002-import-response-skipped.patch
  - `app/api/offline-queue/import/route.ts`: include top-level `imported` and `skipped` in response alongside `results{}`.
  - Benefit: Node test suite and external callers get consistent duplicate reporting.

- 0003-search-fuzzy-threshold.patch
  - `app/api/search/route.ts`: set `pg_trgm` similarity (`SELECT set_limit($1)`) before fuzzy search; allow override via `?similarity=`.
  - Benefit: Stabilizes fuzzy search expectations (e.g., 0.45 threshold) and exposes the threshold used.

Scripts
- scripts/bench-api.sh
  - Minimal curl-based timing harness that records status and `time_total` for key endpoints.
  - Output: JSON timing lines under `codex/benchout/` plus response bodies for quick inspection.

Apply Guidance
- Review each patch, then apply via `git apply` or your editor.
- Ensure Postgres extensions `unaccent` and `pg_trgm` are enabled.
- If you run multiple queue workers, retain `FOR UPDATE SKIP LOCKED` to avoid blocking.
- Consider adding auth and rate limits to import/export in production.

Rollback
- Changes are confined to the listed routes. Revert via `git checkout -- <file>` or `git revert` if using a commit.
