# Centralized Action Recording with ActionTrace

## Goal

Stop stale semantic responses (`"explain what just happened"`, `"why did I do that?"`) by moving action recording from scattered chat request paths to execution commit points.

## Related Plan Addendum and Reports

- Main plan addendum (Phase B/C updates): `docs/proposal/chat-navigation/plan/panels/chat/meta/orchestrator/report/2026-02-21-main-plan-addendum-phase-bc.md`
- Phase A implementation report: `docs/proposal/chat-navigation/plan/panels/chat/meta/orchestrator/report/2026-02-20-phase-a-actiontrace-foundation-implementation-report.md`
- Phase B commit wiring report: `docs/proposal/chat-navigation/plan/panels/chat/meta/orchestrator/report/2026-02-20-phase-b-actiontrace-commit-wiring-report.md`
- Phase B semantic fallback guard report: `docs/proposal/chat-navigation/plan/panels/chat/meta/orchestrator/report/2026-02-21-phase-b-semantic-fallback-guard-report.md`

## Problem

- `setLastAction` is currently written in many chat-layer branches, which is brittle and easy to miss when new routing paths are added.
- Some real executions (especially widget/grounding/disambiguation flows) are not consistently reflected in `lastAction` and `actionHistory`.
- Non-selection semantic questions need richer provenance than `lastAction` alone.

## Selection vs Non-Selection Impact

- **Non-selection:** ActionTrace is the primary fix for stale `"what happened"` / `"why"` responses because those answers must reference executed state, not request-path intent.
- **Selection:** ActionTrace does not replace selection resolution (`activeOptionSetId`, focus latch, bounded candidates). It complements it by making follow-ups deterministic and explainable (`"again"`, `"before that"`, `"why that one"`).
- Design rule: keep selection resolution and execution recording separate; selection decides, commit points record.

## Anti-Pattern Pre-Read Compliance

Reference: `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md`

Applicability: **Applicable** (provider/consumer contract expansion and multi-surface wiring risk).

Compliance decisions:
- Introduce ActionTrace as additive/backward-compatible first (no immediate consumer hard cutover).
- Avoid coupling broad behavior changes in one patch.
- Use staged rollout and parity checks before removing legacy writes.

## Scope

### In Scope
- Add bounded `ActionTrace` model and centralized recorder.
- Record actions at commit points:
  - entry switch commit
  - panel drawer open commit
  - workspace navigation commit
- Mirror ActionTrace head to legacy `lastAction` and `actionHistory` for compatibility.
- Fix semantic resolver ordering bug for newest-first history.

### Out of Scope (Follow-Up)
- Full removal of all legacy `setLastAction` calls in one pass.
- Rich semantic evidence builder work beyond bounded ActionTrace.

## Ladder Rule Boundary (Deterministic->LLM Addendum Compliance)

Reference authority:
- `docs/proposal/chat-navigation/plan/panels/chat/meta/deterministic-llm-ladder-enforcement-addendum-plan.md`

This plan is constrained to post-execution recording and semantic-history correctness. It must not alter active-option arbitration policy.

### MUST NOT change in this plan
- Tier 1b.3 / Phase 2b arbitration decisions.
- Pre-gate escape behavior and unresolved routing behavior.
- LLM invocation topology (no new LLM call sites; no parallel unresolved hooks).
- Candidate-pool construction, scope binding, or cross-scope mixing rules.
- Loop-guard semantics and safe-fallback behavior.

### Allowed in this plan
- Commit-point `recordExecutedAction(...)` calls after execution commits.
- Trace persistence, dedupe, and compatibility mirroring to legacy fields.
- Semantic resolver read-order fixes (`newest-first`) for explanation answers.

## Architecture

### Source of truth
- `sessionState.actionTrace` (new, bounded, newest-first).
- Recorder ownership: **session-level execution recorder**, not chat-only context.
  - Chat context consumes/exposes trace for routing and semantic lane.
  - Commit-point producers (dashboard/workspace/panel execution paths) write to the same recorder API.
- Commit coverage rule: define a canonical list of **user-meaningful execution commits** and map each commit to exactly one `recordExecutedAction` call. Avoid ad-hoc point additions.

### Compatibility
- Derive `lastAction` and `actionHistory` from new trace entries during transition.
- Existing resolver paths remain functional while migrating.

### Dedup
- Deterministic, scope-aware dedupe key:
  - `actionType`
  - `targetRef.kind + targetRef.id`
  - `scopeKind + scopeInstanceId`
  - optional `deltaHint.kind`
- Apply short time window as second-layer guard (300-500ms).
- Optional enhancer: include `requestId`/`uiEventId` when available.

### Retention vs LLM payload
- Store up to 50 entries in session state for traceability/debugging.
- Feed only last 3-5 `isUserMeaningful=true` entries into semantic prompt context by default.

## Data Model (Summary)

Create `ActionTraceEntry` with:
- identity/order: `traceId`, `tsMs`, `seq`
- action: `actionType`, `target`, optional `deltaHint`
- provenance: `source`, `resolverPath`, `reasonCode`
- scope: `scopeKind`, `scopeInstanceId`, optional active ids
- linking/dedup: `dedupeKey`, optional `parentTraceId`
- optional trigger metadata (`intentTag`, fingerprints/hashes)
- `isUserMeaningful`
- `outcome` (`success` | `failed`)

First-class supporting types (explicit and shared):
- `TargetRef` (entry/panel/workspace/widget_item/none)
- `ScopeBinding` (`scopeKind`, optional instance and active ids)
- Stable enums (single source of truth):
  - `ActionType`
  - `ReasonCode`
  - `ResolverPath`

### `isUserMeaningful` rule
- Mark `isUserMeaningful=true` when the action changes user-visible task state (for example: entry/workspace/panel/doc/item opened, navigated, or committed).
- Mark `isUserMeaningful=false` for UI plumbing/transient internal steps that do not represent user task progress.
- Semantic answer lane should prefer recent meaningful entries by default.

Deterministic rubric (apply uniformly):
- **Meaningful (`true`)**: entry/workspace/doc/item open or navigation, panel opens that change available user actions, explicit user-initiated task commits.
- **Not meaningful (`false`)**: loading toggles, intermediate UI transitions, temporary focus changes, internal retries/rebinds without task-state change.

### Chained commit rule (`parentTraceId`)
- For multi-step executions in one user flow, record all committed steps with a shared chain:
  - first commit: `parentTraceId` unset
  - subsequent commits: `parentTraceId` = prior committed step `traceId`
- When presenting semantic summaries, prefer the most recent `isUserMeaningful=true` commit in the chain as the primary explanation target.

### Outcome semantics
- `outcome='success'` only when a state change actually committed.
- `outcome='failed'` only when failure is authoritative at commit layer (not speculative request-layer failure).
- Failed entries are trace events (for explainability), but must not be treated as completed actions in semantic "what happened" summaries.
- Dedupe applies to failed entries using the same deterministic key + time-window policy.
- Default semantic summaries exclude failed entries unless the user explicitly asks about failures/errors.

## Staged Rollout

## Phase A (Additive Foundation)

### Files
- `lib/chat/action-trace.ts` (new)
- `lib/session/session-action-recorder.ts` (new)
- `lib/chat/intent-prompt.ts`
- `lib/chat/chat-navigation-context.tsx`

### Changes
1. Add ActionTrace types and helpers (`computeDedupeKey`, constants).
2. Add `actionTrace?: ActionTraceEntry[]` to `SessionState`.
3. Add `recordExecutedAction(...)` in a session-level recorder module/context:
   - monotonic `seq`
   - bounded window (e.g., 50)
   - dedupe guard (e.g., 300-500ms)
4. Chat navigation context consumes recorder and exposes trace to chat flows.
5. Add converter bridge: trace entry -> legacy `lastAction` and `actionHistory`.
6. Persist `actionTrace`, `lastAction`, `actionHistory` together.
7. Add bridge freshness guard:
   - legacy writers must not overwrite bridge-derived state when `actionTrace[0].tsMs` is newer than the legacy write timestamp.

### Notes
- Keep converter logic in a neutral/shared location to avoid circular imports.
- No behavior removal in this phase.

## Phase B (Commit-Point Wiring + Resolver Fix)

### Files
- `components/dashboard/DashboardView.tsx`
- `components/dashboard/DashboardInitializer.tsx`
- `lib/chat/use-chat-navigation.ts`
- `lib/chat/intent-resolver.ts`

### Changes
1. Wire `recordExecutedAction(...)` at execution commits:
   - workspace selection commit (`handleWorkspaceSelectById`)
   - panel drawer open commit (`open-panel-drawer` handler and direct UI panel open)
   - entry-switch finalized commit (`DashboardInitializer` paths)
2. Build and verify commit coverage matrix before removing legacy writes:
   - `open_entry`
   - `open_panel`
   - `open_workspace`
   - widget item execution commit (`execute_widget_item` / note/doc/link opens) if outside the three commits above
   - any additional user-meaningful execute paths found in integration tests
   - Explicit decision gate: either (A) add widget item execution as a first-class commit point now, or (B) temporarily narrow integration expectations until parity exists.
3. Propagate source metadata through navigation events where needed:
   - `chat-navigate-entry` originates in `lib/chat/use-chat-navigation.ts`
4. Fix newest-first ordering in semantic explanation:
   - preceding action should use index `1` (not `length - 2`).
5. Keep legacy chat-path writes during parity window, but guard against stale overwrite if trace head is newer.
6. Record `outcome: failed` only where failure is authoritative at commit layer (not speculative request-layer failures).

## Phase C (Follow-Up Cleanup)

### Files
- `components/chat/chat-navigation-panel.tsx` (targeted removals only)

### Changes
1. Remove legacy `setLastAction` writes only for action types confirmed to have commit-point parity.
2. Keep rename/create/delete legacy writes until those action types are also commit-point recorded.

## Test Plan

### Unit
- recorder dedupe behavior
- monotonic sequence + bounded trace window
- deterministic dedupe key composition (`target + scope`)
- converter correctness (trace -> lastAction/actionHistory)
- semantic resolver ordering (`current = [0]`, `before that = [1]`)

### Integration
- chat disambiguation -> panel open -> widget item execute -> semantic explain
- direct UI panel open -> semantic explain
- workspace navigate -> semantic explain
- mixed chat/UI flow does not double-record
- semantic prompt pack uses only recent meaningful entries (3-5), not full trace
- commit coverage matrix asserts each user-meaningful execution has exactly one recorder write

### Manual
1. Open panel (chat and UI), then ask `"explain what just happened"` -> latest panel action.
2. Do two actions, then ask follow-up -> previous action is immediate predecessor.
3. Rapid repeated clicks -> single trace entry due to dedupe.

## Acceptance Criteria

- Semantic answers consistently reference the latest real commit action.
- Semantic "why/what happened" uses meaningful recent trace entries with correct ordering.
- No whack-a-mole dependency on individual chat routing branches.
- Legacy behavior remains stable during migration.
- No new provider/consumer runtime drift.

## Risks and Mitigations

- Risk: duplicate writes during migration.
  - Mitigation: dedupe + trace-head freshness guard.
- Risk: source misattribution on event-driven paths.
  - Mitigation: explicit event metadata propagation.
- Risk: wide-scope regression from mass removal.
  - Mitigation: defer removals to Phase C after parity evidence.

## Verification Commands

- `npx tsc --noEmit -p tsconfig.type-check.json`
- `npm test -- --testPathPattern="semantic-answer-lane|semantic-lane-routing-bypass|panel-disambiguation-tier-ordering|selection-intent-arbitration-dispatcher"`
