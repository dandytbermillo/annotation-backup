# Resume Here

- Operating Mode: Read-only advisory. Writes allowed only in `codex/` with explicit approval.
 - README Summary: fresh

- Latest summaries:
  - Executive: codex/previous-sessions/2025-09-01-exec-summary.md
  - Session: codex/previous-sessions/2025-09-01-session-summary.md

- Next steps:
 - If desired, approve implementing the above API and adapter hardening patches.
 - Generate Phase 3 report/test scaffolding under `docs/proposal/unified_offline_foundation/` (as previews in `codex/` for review).
 - Use `codex/scripts/bench-api.sh` to baseline API timings pre/post changes.

- Recent patches added:
 - codex/patches/0001-api-queue-flush-parity.patch
 - codex/patches/0001b-api-queue-flush-dual-mode.patch
 - codex/patches/0002-import-response-skipped.patch
 - codex/patches/0003-search-fuzzy-threshold.patch
 - codex/patches/0004-annotation-canvas-plain-mode-fix.patch
 - codex/patches/0005-connectivity-badge-flag-gating.patch
 - codex/patches/0006-telemetry-throttle.patch
 - codex/patches/0007-phase3-uuid-coercion-and-params-fix.patch
 - codex/patches/0008-context-versions-params-type-fix-not-applied.patch
 - codex/patches/0008-versions-params-type-fix-not-applied.patch
 - codex/patches/0009-next15-params-promise-consistency.patch
 - codex/patches/0010-phase3-test-compare-seed.patch
 - codex/patches/0010b-phase3-test-compare-robust.patch
 - codex/patches/0011-notes-explicit-id-insert.patch
 - codex/patches/0011b-notes-explicit-id-hardened.patch
 - codex/patches/0011c-notes-location-header.patch

- Tips:
  - Run `codex/scripts/bench-api.sh` to baseline key endpoints.
  - Say “Refresh readme.md” to update README with today’s summary.

Updated by `codex/scripts/refresh-resume.sh`.
