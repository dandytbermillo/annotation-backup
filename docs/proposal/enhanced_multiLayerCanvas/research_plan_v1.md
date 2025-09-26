# Multi-Layer Canvas Flag Alignment – Research Plan (v1)

## Context
Alignment work is underway to ensure the LayerManager-powered canvas only activates when the `ui.multiLayerCanvas` / `ui.layerModel` flags are explicitly enabled. The current implementation plan adds migration, telemetry, and guardrails, but we still lack empirical evidence that the approach addresses historic drift, survives runtime toggles, and remains maintainable as canvas functionality grows.

## Objectives
- Validate the assumptions behind the alignment plan and uncover gaps before implementation.
- Quantify the current mismatch between environment variables, stored flags, and in-memory LayerManager state.
- Define test matrices, telemetry dashboards, and migration scripts that guarantee safe rollout and future retirement of legacy mode.
- Produce decision points for collapsing or sunsetting legacy paths once confidence thresholds are met.

## Hypotheses & Key Questions
1. **Flag Drift Root Cause**: Missing defaults and environment overrides are the primary reasons the LayerManager stays active in “legacy” mode. Are there additional entry points (feature toggles, tests) that bypass the combined flag check?
2. **Runtime Toggle Stability**: Can the app reliably detach from the LayerManager without reloads when the flag flips to `false`, or is a controlled refresh mandatory to avoid stale subscriptions?
3. **Telemetry Coverage**: Do we already emit events that distinguish legacy vs layered canvases, or must new analytics/log streams be created? How will we monitor adoption and error rates across both modes?
4. **Legacy Retirement Criteria**: What objective metrics (usage %, bug volume, performance deltas) must be collected to justify removing single-layer support?
5. **Future Feature Hooks**: Which upcoming canvas initiatives (pan mode, panel resizing, popup refactors) depend on the same flag, and how can we enforce guardrails so they do not reintroduce drift?

## Required References
- `docs/proposal/enhanced_multiLayerCanvas/feature_flag_alignment_plan.md`
- `claude.md` (authoritative operating policy)

- Existing canvas docs: `components/canvas/*.tsx`, `lib/hooks/use-layer-manager.ts`, `lib/offline/feature-flags.ts`
- Historic incident reports involving canvas layering (if present in `docs/proposal` or `codex/`)

## Environment & Instrumentation Plan
- **Flag scenarios**: exercise three states – stored localStorage disabled, env override (`NEXT_PUBLIC_LAYER_MODEL`), and default enabled.
- **Debug logging**: follow `codex/how_to/debug_logs.md` to capture LayerManager enable/disable transitions; ensure new log categories are defined before implementation.
- **Database queries**: inspect any persisted feature toggles (if stored server-side) to confirm default/backfill logic.
- **Telemetry hooks**: identify analytics destinations (Segment, internal logging) to receive the proposed `isLayerModelEnabled` events; note schema requirements.

## Investigation Workstreams
1. **Current-State Audit**
   - Map every code path that reads the LayerManager flag or environment variable.
   - Trace initialization order in `components/canvas/canvas-panel.tsx` and related hooks to spot implicit dependencies on LayerManager APIs.
   - Record discrepancies between flag values and runtime behaviour using debug logs.

2. **Migration Feasibility Study**
   - Prototype the one-time backfill against actual persisted data (localStorage snapshot + any server flags).
   - Enumerate failure modes (corrupt JSON, partial writes) and define guard clauses.
   - Validate that logging the migration event does not expose sensitive data.

3. **Runtime Toggle Experiment**
   - Simulate flag flips (on → off → on) in-session, capturing logs and UI behaviour.
   - Determine whether automatic re-registration is viable or if a forced reload is less error prone.
   - Document required cleanup hooks to detach panels, popups, and keyboard shortcuts.

4. **Telemetry & Monitoring Design**
   - Draft event schemas for enable-state transitions and error counters.
   - Align with existing dashboards or propose new visualizations (e.g., share with analytics/ops).
   - Identify alert thresholds for hybrid state regressions.

5. **Legacy Sunset & Forward Compatibility**
   - Work with product/QA to agree on retirement metrics and timeline checkpoints.
   - Recommend CODEOWNERS or lint rules enforcing guard clauses for new canvas features.
   - Capture risks if multi-layer becomes mandatory (performance, accessibility) and required mitigations.

## Data to Collect
- Debug log entries for LayerManager registration/deregistration attempts.
- LocalStorage snapshots before/after migration utility runs.
- Telemetry samples verifying event payloads and propagation latency.
- QA feedback from the validation matrix across devices/zoom levels.

## Success Criteria
- Comprehensive map of all flag touchpoints with confirmed remediation steps.
- Sign-off on migration approach and telemetry schema from engineering + analytics stakeholders.
- Documented decision framework for exiting legacy mode, including quantitative triggers.
- Updated implementation plan capturing any adjustments surfaced by research.

## Deliverables
- Research findings memo (append to `docs/proposal/enhanced_multiLayerCanvas/` alongside the alignment plan).
- Updated validation matrix and telemetry specifications ready for implementation tickets.
- Risk log detailing open questions, blockers, and follow-up experiments.

## Timeline & Checkpoints
- **Week 1**: Complete current-state audit, draft migration prototype, share preliminary findings.
- **Week 2**: Run runtime toggle experiments, finalize telemetry schemas, review with QA/ops.
- **Week 3**: Produce final research memo, update plan, and secure stakeholder approval to proceed with implementation.

## Risks & Mitigations
- **Incomplete data on stored flags**: Coordinate with backend owners early to access representative datasets; fallback to anonymized exports if direct DB access is restricted.
- **Telemetry overload**: Collaborate with analytics to reuse existing pipelines and avoid duplicative streams.
- **Mid-refactor coupling**: Enforce staged delivery so panel height or zoom work does not block flag alignment; document dependencies explicitly.
- **Policy compliance**: Re-read `claude.md` and debug-log SOP before each investigative run to prevent regressions in logging discipline.
