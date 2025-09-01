Title: Implement Phase 3 — Conflict Resolution UI (Unified Offline Foundation, Option A)

 - Read: docs/proposal/unified_offline_foundation/IMPLEMENTATION_PLAN.md (Phase 3) and docs/proposal/unified_offline_foundation/PROPOSAL.md
- Also read: CLAUDE.md → “Feature Workspace Structure (Required)” and follow it strictly for docs/reports/scripts placement

Constraints
- PostgreSQL-only; no IndexedDB/Yjs; Option A scope only.
- Respect auth; never expose sensitive content in logs/telemetry.
- Keep all changes incremental and behind feature flags; default OFF.

Scope (Phase 3 only; assume Phases 0–2 complete)
- OFF-P3-FE-001: Conflict detection integration (intercept 409; collect base/current versions) [Dep: P2]
- OFF-P3-FE-002: ConflictResolutionDialog UI (diff view, actions, force confirmation) [Dep: P3-FE-001]
- OFF-P3-FE-003: Simple three‑way merge for ProseMirror JSON (fallback to textual diff) [Dep: P3-FE-001, P3-FE-005]
- OFF-P3-FE-004: Wire “force” save (set `force: true` on version POST); post-merge save workflow [Dep: P3-FE-002]
- OFF-P3-FE-005: Diff/Merge utilities for ProseMirror JSON (helpers/adapters) [Dep: P3-FE-001]
- OFF-P3-BE-001: Ensure `/api/versions/[noteId]/[panelId]` and `/api/versions/compare` return needed metadata (hashes) [Dep: none]

Scope (out)
- Advanced semantic merges beyond the minimal first pass (can iterate later).

Feature Flags
- Use `offline.conflictUI` (default OFF; enable in dev only after Phase 3 acceptance)
- Keep `offline.circuitBreaker` and `offline.swCaching` per Phases 1–2 acceptance

Implementation Notes
- Interception:
  - Intercept 409 responses from saves/flushes; surface a conflict envelope including `base_version`/`base_hash` and server `current_version`/`current_hash`.
  - Fetch current/base via `/api/versions/[noteId]/[panelId]` and `/api/versions/compare`.
- UI/UX actions:
  - Keep Mine: submit user version as latest (with updated base); Use Latest: accept server version; Merge: attempt minimal three‑way merge; Force Save: proceed with `force: true` and explicit confirmation.
  - Show readable diff; degrade to “choose side” if content too large/complex.
- Merge:
  - Start with straightforward structural/textual merge for ProseMirror JSON; where ambiguous, prefer explicit user choice.
- Telemetry:
  - Record conflict occurrences, selected action (mine/theirs/merge/force), success/failure, and repeat conflicts; avoid logging document content.
- Safety:
  - Confirm before force save; show warnings and provide undo where feasible.

APIs/Contracts
- Existing endpoints:
  - `/api/versions/[noteId]/[panelId]` (GET/POST/DELETE)
  - `/api/versions/compare` (POST)
- Error handling:
  - Use HTTP 409 for version mismatch/content drift; responses include `current_version` and `current_hash`.
  - Client envelopes include `base_version` and `base_hash` for conflict detection and resolution.

Workspace Structure (per CLAUDE.md)
- Place Phase 3 artifacts under:
  - `docs/proposal/unified_offline_foundation/reports/<date>-phase3-implementation-report.md`
  - `docs/proposal/unified_offline_foundation/test_scripts/` (Phase 3 verifiers)
  - `docs/proposal/unified_offline_foundation/supporting_files/` (if needed)
- Include clear run commands and expected outcomes in the report

Testing
- Unit: conflict envelope handling; dialog action reducers; merge utility edge cases; force-save gating.
- Integration: simulate divergent saves leading to 409; verify resolution paths call correct endpoints and succeed.
- E2E (Playwright): user flows for Keep Mine / Use Latest / Merge / Force leading to successful save.
- Manual: large document behavior; degraded merge fallback; accessibility review of dialog interactions.

Verify (Phase 3 Acceptance)
- 409 flows open the conflict dialog reliably
- Users can Keep Mine, Use Latest, Merge, or Force; saves succeed post‑resolution
- Telemetry captures conflict actions and outcomes; repeated conflicts are surfaced
- Success gates: conflict resolution success > 95%; force‑save < 10%
- All Phase 3 tests (unit/integration/E2E) pass

Output (Phase 3)
- Summary of changes and file paths
- Flag default and rollout plan (dev → staging → canary → full; gates per plan)
- Test commands and results (unit/integration/E2E)
- Any deviations and rationale
