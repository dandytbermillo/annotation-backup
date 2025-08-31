Title: Implement {{PHASE_TITLE}} — {{PROGRAM_NAME}}

- Read: {{PROPOSAL_PATH}}/IMPLEMENTATION_PLAN.md ({{PHASE_REF}} section) and PROPOSAL.md
- Also read: CLAUDE.md → "Feature Workspace Structure (Required)" and follow it strictly for docs/reports/scripts placement

Constraints
- PostgreSQL-only; no IndexedDB/Yjs; cache only HTTP GETs; respect auth; clear caches on logout/tenant changes; follow Option A.
- Keep changes incremental and behind feature flags.

Scope ({{PHASE_TITLE}} only; assume prior phases complete)
{{TICKETS_LIST}}

Feature Flags
- Use flags as applicable for this phase (default OFF; enable in dev only after this phase’s acceptance):
  - offline.circuitBreaker
  - offline.swCaching
  - offline.conflictUI

Implementation Notes
- Reuse shared libs from Phase 0 where applicable (e.g., `lib/offline/*`).
- Keep UI integrations minimal and non-intrusive per phase goals.
- Emit telemetry via `lib/offline/telemetry` to `/api/telemetry`.

Workspace Structure (per CLAUDE.md)
- Place phase artifacts under:
  - `docs/proposal/unified_offline_foundation/reports/<date>-{{PHASE_ID}}-implementation-report.md`
  - `docs/proposal/unified_offline_foundation/test_scripts/` (phase verifiers)
  - `docs/proposal/unified_offline_foundation/supporting_files/` (if needed)
- Include links/commands to run verifiers in the report.

Testing
- Unit: write focused tests for this phase’s logic (mocks as needed).
- Integration: validate affected API endpoints and contracts.
- E2E (Playwright with SW if applicable): scripted validations for user-visible outcomes.

Verify (Acceptance)
- Meet acceptance criteria defined in `IMPLEMENTATION_PLAN.md` for {{PHASE_REF}}.
- All unit/integration/E2E tests pass for this phase.
- Telemetry for this phase’s metrics is visible.

Output ({{PHASE_TITLE}})
- Summary of changes and file paths.
- Flag default and rollout plan (dev → staging → canary → full; gates defined for this phase).
- Test commands and results (unit/integration/E2E).
- Any deviations and rationale.

Defaults (fill for Phase 1 example)
- {{PHASE_TITLE}}: Phase 1 — Connectivity Foundation (Option A)
- {{PROGRAM_NAME}}: Unified Offline Foundation (Option A)
- {{PROPOSAL_PATH}}: codex/proposal/Unified Offline Foundation
- {{PHASE_REF}}: Phase 1
- {{PHASE_ID}}: phase1
- {{TICKETS_LIST}}:
  - OFF-P1-FE-001: Reachability probe to /api/health (1–2s timeout), rolling RTT, exponential backoff
  - OFF-P1-FE-002: Circuit breaker (open 3 fails; half-open 10s; close after 2 successes; backoff 1→2→4→8s cap 30s)
  - OFF-P1-FE-003: Connectivity UI badge + queue stats (Good/Degraded/Offline; depth, last sync)
  - OFF-P1-FE-004: Telemetry hooks (RTT, breaker state, probe outcomes)
  - OFF-P1-BE-001: Health endpoint hardening (fast 200 JSON; optional HEAD)

