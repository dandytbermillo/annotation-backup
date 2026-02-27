# Selection Intent Arbitration Plan (Incubation)

**Status:** Incubation Draft
**Owner:** Chat Navigation
**Last updated:** 2026-02-27
**Scope:** Planning-only. No implementation changes in this document.
**Implementation addenda:**
- `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-intent-arbitration-widget-first-fix-plan.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-intent-arbitration-scope-cues-addendum-plan.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-vs-command-arbitration-rule-plan.md`

## Implementation status snapshot (2026-02-27)
This incubation plan remains normative/planning-oriented, but key addendum items are implemented in runtime:
- Widget scope cue expansion (active/current variants, including plural forms).
- Typo scope-cue safety path (`low_typo`) with clarifier-only behavior.
- One-turn pending typo-clarifier replay with TTL + snapshot drift checks.

Primary implementation source:
- `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-intent-arbitration-scope-cues-addendum-plan.md`

Implementation records:
- `docs/proposal/chat-navigation/plan/panels/chat/meta/orchestrator/report/2026-02-26-widget-scope-cue-implementation-report.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/orchestrator/report/2026-02-26-scope-typo-clarifier-one-turn-replay-report.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/orchestrator/report/2026-02-26-scope-typo-clarifier-investigation-and-fix-report.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/orchestrator/report/2026-02-26-scope-typo-clarifier-consolidated-implementation-report.md`

## Why This Exists
Current behavior can over-clarify or bind to stale chat lists when users are clearly interacting with an open widget.
This incubation plan defines a focus-latch-first policy to reduce friction while keeping execution safe.

## Core Principles
1. Opening a widget does not imply selection intent by itself.
2. Once user engagement with a widget is confirmed, unspecific follow-ups default to that focused widget.
3. Chat and widget contexts remain separate and source-aware.
4. Clarification is a last resort, not a default.
5. Constrained LLM handles long-tail phrasing; deterministic handles strict high-confidence cases.
6. Explicit source cues are binding (`from chat`, `from active widget`, `from <panel>`).

## Normative Dependency (Mandatory)

This incubation plan inherits arbitration policy from:
- `deterministic-llm-arbitration-fallback-plan.md` (global deterministic -> LLM -> safe fallback policy)
- `deterministic-llm-ladder-enforcement-addendum-plan.md` (active-option ladder enforcement)

Required inheritance:
1. Deterministic first.
2. If unresolved/low-confidence in active-option scope, use bounded constrained LLM before unrelated downstream fallback.
3. If LLM fails/abstains/timeout/429/low-confidence, return safe clarifier (no unsafe execute).

Conflict rule:
- If this file conflicts with the ladder addendum for active-option flows, the addendum wins.

## Prerequisite 0 (Required): Active Widget ID Mapping Integrity
Focus-latch behavior depends on accurate active widget identity in turn snapshots.
This prerequisite must be completed before latch rules are implemented.

### Problem
- `setActiveWidgetId(panel.id)` stores panel UUID from dashboard events.
- Widget snapshots are keyed by `widgetId` slug.
- If `activeSnapshotWidgetId` is populated from raw active id without mapping, latch can target wrong/no widget.

### Required Fix
1. Extend snapshot schema to carry panel linkage:
- Add `panelId?: string` to widget snapshot registration contract.
2. Ensure widgets register `panelId` with snapshot updates.
3. Resolve active widget in snapshot builder:
- First try direct `activeId === widgetId`.
- If no direct match, resolve by `snapshot.panelId === activeId` and return that `snapshot.widgetId`.
4. Use resolved `activeSnapshotWidgetId` for focus-latch and focused list selection.

### Blocker Tests for Prerequisite 0
- Opening a panel by UUID sets `activeSnapshotWidgetId` to the correct widget slug in turn snapshot.
- Reordering/scoping by active widget uses resolved slug (not raw UUID).
- If mapping fails, latch is not applied and system falls back safely (no wrong execution).

## Focus Latch Model
### Focus latch definition
- Focus latch is the most recently engaged widget context.
- While latched, unspecific selection-like follow-ups resolve against the focused widget first.

### Latch-on signals (required)
Set focus latch only on real engagement:
- User clicks/selects an item in widget UI.
- Selection is successfully resolved to a widget item (ordinal/label).
- User provides explicit widget scope cue (`in Links Panel D`, `in this panel`).

### Latch-off signals (required)
Clear or switch focus latch on:
- Focused widget closes.
- Explicit switch command targets another widget/panel.
- Explicit stop/start-over.
- Optional TTL expiry (if product enables TTL).

## Required Rules (Must)
All rules in this section are required for implementation and release.

1. Deterministic-first
- Exact/unique deterministic matches execute immediately.
- Do not call LLM before deterministic checks are exhausted.

2. Focus-latch precedence
- If focus latch is active and input is unspecific selection-like, resolve against focused widget first.
- Do not route unspecific selection-like input to chat list by default while latch is active.
- Pre-latch ambiguity handling must not override an active focus latch.

3. Chat re-anchor only
- Chat list resolution while latch is active requires explicit chat cue:
  - `back to options`
  - `from earlier options`
  - `from chat options`
- Re-anchor succeeds only when a recoverable chat option list exists.
- If no recoverable chat options exist, respond clearly (for example: `No earlier options available.`) and keep current latch scope.

4. Command and question bypass
- Known commands (`open recent`, `open links panel d`, `home`, etc.) may bypass latch-based selection binding only when active-option ambiguity is not unresolved.
- If command-like input collides with active option context and deterministic resolution is unresolved, follow bounded LLM ladder before unrelated downstream fallback.
- Question-intent input (`what`, `why`, `how`, `explain`) must route to normal answer paths, not selection execution.
- Classifier order is required: evaluate question-intent before selection-like classification.
- Use shared utilities for question/command intent classification (no local regex drift).

5. Label-like behavior while latched
- Label-like input (`summary155`, `panel d`) resolves directly when uniquely matched in focused widget.
- If multiple matches exist inside focused widget, ask focused-widget clarifier.

6. Ordinal behavior while latched
- Unspecific ordinals (`first`, `second`, `2`) resolve to focused widget items by default.
- Do not ask chat-vs-widget clarifier while latch is active unless user explicitly re-anchors to chat.

7. Focused-widget miss fallback ladder
If focused-widget resolution fails:
- Step A: check explicit chat re-anchor and resolve chat if present.
- Step B: constrained LLM over safe candidates (`focused widget + any explicitly scoped candidates`).
- Step C: if unresolved, ask one grounded clarifier (safe fallback).
- Phase C policy note: LLM auto-execute is allowed only when all addendum gates pass; otherwise clarifier-only.
- Step C clarifier should include targeted chat hint when applicable:
  - If focused widget has zero matches and chat has a unique match, offer it as an `or` option without auto-switching scope.
  - Example: `I don't see that in Links Panel D. Did you mean summary155 in chat options, or something in Links Panel D?`

8. Clarifier text ownership
- App decides clarification type and allowed choices; LLM generates final question wording.
- LLM clarifier output must be constrained (`question`, `choices[]`) and mapped to app-provided ids/labels only.
- If LLM clarification generation fails/timeout, app uses deterministic template wording.

9. Safety
- Never execute without validated candidate id.
- Never allow free-form command generation from LLM picker.
- LLM picker output is constrained to `select(choiceId)` or `need_more_info`.

10. No clarifier loops
- Same candidate set + repeated unresolved input must not repeat the same vague clarifier.
- Must execute (if unique), ask targeted clarifier, or provide a concrete next-step prompt.

11. Loop-guard continuity
- Use one loop-guard identity contract for unresolved cycles: `normalizedInput + sortedCandidateIds + optionSetId/messageId`.
- Within the same unresolved cycle, suppress repeated LLM calls but preserve prior suggestion ordering.
- Reset guard on cycle boundary (input/candidate-set/set-id change, successful resolution, context clear/reset).

12. Intercept wiring
- `handleClarificationIntercept` must apply the same focus-latch policy or fall through to shared dispatcher resolver.
- Generic `unclear` handling before latch/arbitration is not allowed.

13. Pre-latch ordinal default
- If no latch is active, exactly one fresh visible widget list exists, and no active chat option set exists, ordinals default to that visible widget list without clarifying.
- If active chat options also exist, treat as real ambiguity and follow required ambiguity handling (pure ordinal -> grounded clarifier).
- “Exactly one fresh visible widget list” means exactly one visible list-segment candidate group.
- If multiple list segments exist (within one widget or across widgets), pre-latch ordinal default must not trigger; use ambiguity handling.

14. Source-cue precedence
- Explicit scope cues override latch defaults:
  - Chat cues: `from chat`, `in chat`, `from earlier options`, `back to options`.
  - Active-widget cues: `from active widget`, `from current widget`, `from this widget`, `from the widget`, `in this panel`.
  - Named cues: `from links panel d`, `from panel d`.
- If input contains conflicting source cues, do not execute; return one source clarifier.
- Explicit vs contextual widget cues are distinct:
  - `from active widget` / `from current widget` must use `activeSnapshotWidgetId` (UI-focused widget).
  - `from this widget` / `from the widget` should prefer latch context, then fall back to `activeSnapshotWidgetId`.

15. Scoped candidate isolation for non-exact input
- For non-exact inputs with explicit scope cue, bounded LLM receives candidates from that scope only.
- Do not mix unrelated candidate domains in the same turn.
- If scoped source has zero viable candidates, return scoped safe clarifier first; do not silently widen scope.

16. Post-clarifier source continuity
- After app shows source-specific options, immediate follow-up selection-like input stays in that source until user explicitly switches.
- Noisy variants (`pls`, `now`, punctuation) must not change source routing outcome.

17. Semantic-lane suppression under explicit scope cue
- If semantic-question heuristics fire but explicit scope cue is present (`chat` or `widget`), suppress semantic-lane bypass and keep scope-cue arbitration active.
- Scope cue is a stronger routing signal than generic question phrasing (for example: `can you open ... from active widget`).

## Input Classification Gate
### Selection-like input
Examples:
- `first option`
- `the second one`
- `open this`
- `summary155`

### Non-selection input
Examples:
- `what does summary144 mean?`
- `open links panel d`
- `show recent activity`

Rule:
- If input is non-selection, bypass selection arbitration and continue normal routing.
- Exception: if active-option ambiguity is unresolved in current scope, do not bypass the bounded LLM ladder solely due to strict selection-like gating.

## Context Model
### Widget context
- Source: widget registry snapshots (`openWidgets`, focused widget id, visible list items).
- Focused widget is authoritative for unspecific selection-like follow-ups while latch is active.

### Chat context
- Source: chat-created clarifiers/options.
- Chat list is available but not default while widget focus latch is active.
- Chat list becomes default only with explicit chat re-anchor cues.

## Focused Widget Definition
A widget is considered focused/visible when all are true:
1. It appears in the current turn snapshot as a list segment with items.
2. Snapshot is fresh (`capturedAtMs` within freshness threshold).
3. It matches `activeSnapshotWidgetId` when an active widget id exists.

`uiSnapshotId` is for traceability/correlation, not focus decision.

## Deterministic vs LLM Split
### Deterministic-first (strict)
- Core ordinals: `first`, `second`, numeric ordinals, badge letters.
- Exact label matches.

### LLM fallback (long tail)
- Messy selection-like phrasing not matched deterministically:
  - `pls open the initial choice now`
  - `can you pick the one after that`

Rule:
- Do not aggressively expand synonym dictionaries as primary strategy.
- Prefer constrained LLM for long-tail phrasing.

## Explicit Command Escape
When input is known command and not explicit chat re-anchor:
- Do not trap it in selection retry logic when active-option ambiguity is not unresolved.
- If unresolved active-option ambiguity exists, run bounded LLM ladder first; command escape applies only after non-colliding resolution.
- Route to known-noun/command execution tiers only after the above checks.

## Grounded Clarifier Format
When clarification is required:
- Ask one short targeted clarifier with wording generated by constrained LLM.
- App provides choices/ids; LLM may only phrase question text.
- Prefer source-specific clarifier over generic unclear prompts.

## Observability Requirements
Add logs for:
- `focus_latch_set`
- `focus_latch_cleared`
- `focus_latch_applied`
- `focus_latch_bypassed_command`
- `focus_latch_bypassed_question_intent`
- `selection_input_classified`
- `selection_context_candidates_built`
- `selection_dual_source_llm_attempt`
- `selection_dual_source_llm_result`
- `selection_clarifier_llm_generated`
- `selection_clarifier_llm_fallback_template`

## Acceptance Tests (Required Blockers)
0. Prerequisite mapping: panel UUID focus maps to correct `activeSnapshotWidgetId` widget slug before latch behavior is enabled.
1. Open widget -> engage widget -> `second one` resolves to focused widget item without chat-vs-widget clarifier.
2. Open widget -> engage widget -> `summary155` resolves directly when unique in focused widget.
3. While latched, `back to options` switches resolution to chat list.
3a. While latched, if no recoverable chat options exist, `back to options` returns `No earlier options available.` and does not switch scope.
4. While latched, explicit command (`open recent`) executes command, not widget item selection.
4a. While latched, command-like input that remains unresolved against active options must attempt bounded LLM before unrelated downstream fallback.
5. While latched, question-intent (`what does summary144 mean?`) routes to normal answer path.
6. Focused-widget miss uses fallback ladder (re-anchor check -> constrained LLM -> targeted clarifier).
7. No repeated vague clarifier loop for unchanged candidate set.
8. Clarifier wording generated by LLM; fallback template used on LLM failure with same choices.
9. If latch is active, `second one` resolves to latched widget even when multiple list-segment groups are visible; no pre-latch dual-source clarifier is shown.
10. Active-option unresolved compliance: if deterministic cannot resolve uniquely, bounded LLM is attempted before unrelated downstream fallback.
11. Safe-fallback compliance: timeout/429/error/abstain/low-confidence returns grounded safe clarifier and does not execute.
12. Phase C gate compliance: LLM `select` executes only when addendum gates pass; otherwise clarifier-only behavior.
13. `open the summary144 from active widget` must never resolve chat candidates in that turn.
14. `open panel e pls` with active widget + chat options must not return unrelated widget-list summary candidates.
15. `open the panel d from chat` resolves only in chat scope (or clarifies in chat scope), not active-widget scope.
16. Conflicting cues (`from chat` + `from active widget`) return source clarifier and do not execute.
17. Repeated noisy variants (`open panel e pls`, `open panel e pls??`) remain source-stable.
18. `from active widget` resolves against UI-active widget even when latch still points to a previously engaged widget.
19. `from this widget` resolves against latch first, then falls back to UI-active widget.
20. `can you open <item> from active widget` must not enter semantic answer lane; it must route through scope-cue arbitration.

## Rollout Plan
1. Keep this as separate incubation plan until behavior is stable in QA.
2. Implement behind feature flag:
- `SELECTION_INTENT_ARBITRATION_V1=true`
3. For implementation sequencing and race-condition fixes, follow addenda:
- `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-intent-arbitration-widget-first-fix-plan.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-intent-arbitration-scope-cues-addendum-plan.md`
 - `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-vs-command-arbitration-rule-plan.md`
4. Validate with scripted mixed flows (chat list -> widget engagement -> unspecific follow-ups).
5. Merge into `universal-selection-resolver-plan.md` only after blocker tests pass.

## Plan Alignment
- Widget snapshot/registry contract remains defined by `widget-ui-snapshot-plan.md`.
- Universal selection resolver integration remains tracked in `universal-selection-resolver-plan.md`.
- For selection routing behavior, this incubation plan is source of truth until merged.
- For concrete implementation details, use addenda:
  - `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-intent-arbitration-widget-first-fix-plan.md`
  - `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-intent-arbitration-scope-cues-addendum-plan.md`
  - `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-vs-command-arbitration-rule-plan.md`.

## Pre-Read Compliance
- `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md` reviewed.
- Applicability: not directly applicable (no new provider/hooks proposed here).
- Compliance: this plan avoids provider/consumer contract expansion and focuses on routing policy and source arbitration.
