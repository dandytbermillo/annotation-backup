# Enhanced Claude-Native Implementation Plan

Status: READY TO EXECUTE
Date: 2025-09-07
Reference: context-os/CLAUDE_NATIVE_AGENT_PROPOSAL.md

## Objectives
- Treat Claude Code as the orchestrator; use Context-OS .js/.ts as deterministic tools.
- Consolidate user workflows into slash commands with safety rails and structured outputs.
- Deliver in 4 phases with reversible, low-risk increments and clear telemetry.

## Scope
- Commands: `/context-execute`, `/context-fix`, `/context-validate`, `/context-status`, `/context-analyze` (+ short aliases without `context-`).
- Agents: `.claude/agents/{feature-implementer,bug-fixer,validator}.md` remain the source of role/decision logic.
- Tools: reuse existing CLIs and core tools; add thin wrappers only to standardize JSON and routing.

## Guiding Principles
- Claude orchestrates; Context-OS executes deterministic operations.
- Prefer wrapping existing validators/templates over re-implementation.
- Standard JSON envelopes from CLIs; stderr reserved for logs/help.
- Dry-run by default for write operations; require explicit `--apply`.
- Concurrency: default 2 with soft enforcement; configurable up to 5 to match proposal guidance.
- Telemetry for every operation (command, route, duration, exitStatus, artifacts, token estimates when available).
- Retry/backoff: transient failures use bounded retries with exponential backoff (see Phase 4 deliverable).
- “Planned vs Implemented” is explicitly marked to avoid overpromising.

## Baseline Reality Check (Today)
- Agents and command definitions exist and are correctly cross-referenced.
- Router/Bridge: support core commands; do not yet accept `context-` prefixes.
- CLIs (`execute-cli.js`, `fix-cli.js`, `validate-cli.js`) emit JSON; agents themselves do not take `--json`.
- Validation: `scripts/validate-doc-structure.sh` + CLI wrapper exist (no Node JSON validator tool yet).
- Bridge telemetry exists; defaults favor safety (dry-run suggested for writes).

## Phase 1 (Week 1): Foundations + Safety + JSON

1) Command Aliases (router + bridge)
- Normalize optional `context-` prefix across commands.
- Router: accept `^/(?:context-)?(execute|fix|validate|status|analyze)`.
- Bridge: mirror patterns and retain route metadata (claude-only/context-only/hybrid).

1b) Single-Command Flow (auto-detection)
- Implement explicit auto-detection in `/context-execute`:
  - If `docs/proposal/<slug>/` does not exist → initialize structure (create-feature) then continue.
  - If it exists → skip initialization and proceed to implementation/validation.
  - When `--from` is provided → preserve original filename (e.g., user-profile-feature.md)
  - When `--from` is omitted → create minimal plan and enter interactive mode
- Document this "Single Command Philosophy" in BRIDGE.md and SLASH_COMMANDS.md per proposal.
- No fallback to generic filenames like "implementation.md" - emphasize descriptive names.

2) JSON Contracts (CLIs as the boundary)
- Keep CLIs as the JSON interface and standardize envelopes:
  `{ ok, command, result|error, artifacts?, logs? }`.
- Document result shapes in `SLASH_COMMANDS.md` and BRIDGE.md.

3) Validator Wrapper (no rule duplication)
- Add `context-os/process-guide-validator.js` that invokes the existing validator
  (shell script or CLI) and emits structured JSON: per-feature `errors`, `warnings`,
  `passed`, and `strict` elevation.

4) Classifier Reuse
- Export a pure classification function from `context-os/agents/classifier-agent.js` to
  enable programmatic use while keeping current CLI behavior intact.
- Optional (feature-flagged): apply environment multipliers during classification; default off.

5) Fix CLI Ergonomics
- If `--severity` is provided, optionally honor as an override (log as override and validate)
  or keep it “PLANNED” until implemented.

6) Safety + Telemetry
- Ensure bridge writes telemetry JSONL consistently with fields:
  `command`, `route`, `duration`, `exitStatus`, `artifacts`.
- Confirm dry-run default for write operations and patch generation on `--apply`.

7) Concurrency Controls (soft)
- Expose `maxParallelCalls` configuration (default 2, configurable up to 5) across router/bridge.
- Document that enforcement is soft (helper-level), consistent with proposal guidance.

8) Scaffolder Parity (no duplication)
- Provide a deterministic structure-creation path exposed via CLI:
  - Preferred: add `--structure-only` flag to `context-os/create-feature.js` (as referenced in the proposal), returning JSON describing created directories/files; or
  - Alternative: add a tiny CLI shim that calls the existing Scaffolder class (no re-implementation).
- Document which path is canonical to avoid two sources of truth.

9) Orchestrator Naming Clarification (tool vs orchestrator)
- Clarify in docs that `orchestrator.ts` is a Context-OS workflow tool, not an agent orchestrator; rename optional.
- If low-churn, consider renaming to `workflow-manager.ts` with alias/back-compat notes; otherwise, add a prominent doc note.

10) Agent JSON Flags (optional)
- If agents will be called directly (not only via CLIs), add `--json` support to key agents (classifier, verifier, orchestrator) with the same envelope as CLIs.
- Otherwise, keep CLIs as the single JSON boundary and document this clearly.

Deliverables (Phase 1)
- Router/Bridge alias support for `/context-*` and short forms.
- Standard JSON envelopes across CLIs + docs updated.
- `process-guide-validator.js` wrapper returning structured JSON.
- Exported classifier function (no behavior change unless flag enabled).
- Telemetry verified for core flows.
- Concurrency configuration surface (default 2, configurable ≤5) documented and exercised in examples.
- Single-command init→implement flow implemented and documented; skip-on-exist verified.
- Scaffolder parity path available (`--structure-only` or CLI shim) and documented as canonical.
- Orchestrator tool role clarified in docs (rename optional with alias/back-compat if done).
- Agent `--json` flags addressed per chosen boundary strategy (implemented or explicitly deferred).

## Phase 2 (Week 2): Commands + Agent UX

1) Slash Commands: complete and refine
- Add `.claude/commands/context-status.md` and `.claude/commands/context-analyze.md` with exact CLI invocations and decision trees.
- Ensure `.claude/commands/context-help.md` is wired and exposed in docs; add a simple “list/discover” command (`/context-features`) for feature discovery (maps to existing show/scan scripts).
- Update existing `.claude/commands/*` to mirror the “Tool Selection Matrix” from the proposal.
 - OPTIONAL (advanced): add `.claude/commands/context-review.md` and `.claude/commands/context-migrate.md` as proposal-aligned advanced flows; wire as “Planned” if out of 4-week scope.

2) Router/Bridge UX
- Improve error messages and exit codes for human + machine consumption.
- Ensure degraded fallbacks are surfaced consistently across hybrid flows.
- Document safety flags and budgets/timeouts in BRIDGE.md.

3) Failure Priority Tiers (3-tier handling)
- Implement proposal’s tool-failure priority levels: CRITICAL (abort or rollback), IMPORTANT (retry with backoff or work around), OPTIONAL (skip and proceed).
- Map common failure classes to tiers and document the action matrix in BRIDGE.md.

4) Task Tool & Subagent Integration
- Document the hierarchy explicitly: `Claude → Task → Subagent → Tools` using the `.claude/agents/*.md` roles.
- Add examples of subagent prompts referencing the agent role docs.
- Plan and stub a real Task invocation path (environment-gated) for Phase 4 smoke tests.

5) Docs Parity
- Update `SLASH_COMMANDS.md` to show `/context-*` (preferred) and short aliases.
- Cross-link `.claude/agents` roles from command docs and BRIDGE.md.

Deliverables (Phase 2)
- New `.claude/commands/{context-status,context-analyze}.md`.
- Enhanced help/error UX in router/bridge; documented safety/budgets.
- Updated SLASH_COMMANDS.md and BRIDGE.md snippets that copy/paste cleanly.
- Failure-priority handling documented and exercised (abort/retry/skip paths) with examples.
- OPTIONAL (advanced): review/migrate command definitions added as “Planned” or implemented if capacity allows.
- Task Tool hierarchy documented with examples; Phase 4 smoke test plan included.

## Phase 3 (Week 3): Templates + Scaffolds

1) INITIAL Template Enhancements
- Extend `context-os/templates/initial.md.hbs` with:
  - Proposal-required sections
  - Validation checklist
  - Example placeholders
  - Conditional sections based on feature type
- Reuse `render-initial.js` as the generator; add helpers if needed.

2) Example Templates
- Add `context-os/templates/examples/`:
  - `postgres-persistence.md`
  - `dark-mode.md`
  - `bug-fix.md`

3) Process Docs
- Tighten BRIDGE.md and HOW_CONTEXT_EXECUTE_WORKS.md with real outputs/telemetry.
- Explicitly mark planned items: TTL cache (~15 min), exponential backoff, hard concurrency >2.

Deliverables (Phase 3)
- Updated INITIAL template + example templates.
- Up-to-date process docs with implemented vs planned clearly labeled.
 
4) Philosophy Documentation
- Create `context-os/PHILOSOPHY.md` explaining: “Claude IS the agent; Context‑OS are tools.”
- Clarify: files under `context-os/agents/` are deterministic tools invoked by Claude (not custom agents).
- Link from BRIDGE.md and SLASH_COMMANDS.md for new contributors.

## Phase 4 (Week 4): E2E + Quality

1) E2E Workflows (mock Task mode)
- Execute: `/context-execute "Feature" --from drafts/feature.md` → structure created, preserves original filename, validation PASS, artifacts listed.
- Execute (no draft): `/context-execute "Feature"` → creates minimal plan, prompts interactively for missing fields.
- Fix: `/context-fix --feature slug --issue "desc" --perf 30` → severity/type, fix doc path, index updated.
- Validate: `/context-validate slug --strict` → 8 rules with structured JSON output.
- Analyze: `/context-analyze slug` → findings + recommendations (mock).
- Status: `/context-status [slug]` → status table or single status.

2) Bench + Telemetry
- Capture durations and exitStatus; confirm degraded paths are rare and logged.
- Validate consistent fields across telemetry entries.

3) Backoff & Retry
- Add bounded exponential backoff for transient failures (e.g., 100ms → 250ms → 500ms) in bridge/adapters for Claude calls and tool invocations where safe.
- Document retry policies and integrate with 3-tier priority handling (IMPORTANT → retry; CRITICAL → abort/rollback; OPTIONAL → skip).

4) Task Tool Smoke Test (real invocation where available)
- Trigger a real Task invocation (when the environment allows) that loads `.claude/agents/*.md` and returns findings.
- Record telemetry and confirm subagent role usage traces; fall back to mock with a clear “degraded” note if not available.

5) Docs + Help
- Verify `--help` text for each CLI and ensure examples are copy/paste-ready.

Deliverables (Phase 4)
- E2E verification logs and sample telemetry.
- Finalized docs/help with accurate, minimal friction examples.
- Minimal backoff policy implemented and documented; verified in tests.
 - Real Task smoke test executed and documented (or mock fallback rationale recorded).

## Acceptance Criteria
- `/context-*` and short aliases operate equivalently (router + bridge).
- All CLIs return documented JSON envelopes; stderr reserved for logs/help.
- Validator JSON includes per-feature `errors`, `warnings`, `passed`, and strict mode elevation.
- Fix flow creates severity-correct document and updates the index; recommendations included.
- Telemetry entries contain `command`, `route`, `duration`, `exitStatus`, `artifacts`, and token estimates when available.
- Concurrency configuration present (default 2; configurable ≤5) and exercised in examples.
- Failure-priority handling applied (CRITICAL/IMPORTANT/OPTIONAL) with clear actions.
- Minimal backoff policy present and verified for transient failures.
- Documentation clearly separates implemented from planned capabilities.
- Single-command init→implement behavior verified: missing feature initializes; existing feature skips init.
 - Scaffolder parity validated: canonical structure-only path is available and documented.
 - Task tool hierarchy documented; real Task smoke test executed (or mock fallback documented) with telemetry.
 - PHILOSOPHY.md present and linked from BRIDGE/SLASH_COMMANDS.

## Non-Goals (Planned, not in this 4-week scope)
- TTL cache across tools (~15 minutes) for selected responses.
- Full OS-level resource limits (512MB/tool, 1 core CPU) — treated as guidance; implemented guards are budgets/timeouts.
- Global enforced concurrency beyond 5; we keep default 2, configurable up to 5 with soft enforcement.

## Risks & Mitigations
- Alias ambiguity → Normalize `context-` prefix early; add tests.
- Drift between agents/commands and tools → Single JSON boundary via CLIs; agents reference CLIs.
- Validator drift → Wrap existing rules; avoid duplication.
- User confusion → Clear help text and copy/paste examples; mark planned vs implemented.

## Rollback Plan
1) `git checkout main`
2) Restore `.claude/commands` from backup if needed.
3) Retain original non-JSON agent behaviors; keep CLIs as interface.
4) Document lessons learned and scope adjustments.

## Next Steps
- Implement Phase 1 tasks: aliases, JSON envelope docs, validator wrapper, classifier export, telemetry checks.
- Open a short PR with Phase 1 changes + docs updates; include telemetry samples.
