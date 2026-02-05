# Selection Intent Arbitration Plan (Incubation)

**Status:** Incubation Draft
**Owner:** Chat Navigation
**Last updated:** 2026-02-05
**Scope:** Planning-only. No implementation changes in this document.

## Why This Exists
Current behavior can misbind follow-up ordinals when both chat options and widget lists are plausible.
This incubation plan defines a safer arbitration model before merging into the main `universal-selection-resolver-plan.md`.

## Core Principles
1. Opening a widget does not imply selection intent.
2. Selection resolution runs only for selection-like input.
3. Chat and widget contexts remain separate and source-aware.
4. If both contexts are plausible, do not silently guess.
5. Constrained LLM handles long-tail phrasing; deterministic handles strict high-confidence cases.

## Input Classification Gate
### Selection-like input
Examples:
- `first option`
- `the second one`
- `panel d`
- `open the second option`

### Non-selection input
Examples:
- `what does summary144 mean?`
- `open links panel d`
- `show recent activity`

Rule:
- If input is non-selection, bypass selection arbitration and continue normal routing.

## Context Model
### Chat selection context
- Source: chat-created clarifiers/options.
- Includes execution refs for chat options.

### Widget selection context
- Source: widget list clarifiers/registry-backed widget options.
- Includes `{ widgetId, segmentId, itemId }` execution refs.

### Context lifecycle
- Contexts are not cleared on unrelated commands by default.
- Contexts are replaced only by explicit list replacement, stop/cancel, start-over, or TTL expiry.
- A context may be suspended when another interaction starts, then re-anchored explicitly.

### Post-Execution Demotion Rule
- After a chat option is executed (user picked from the chat list), that chat list is demoted from "active" to "recoverable."
- Demoted lists stop auto-binding ordinals. Future ordinals do not resolve against a demoted list.
- The demoted list remains available only via explicit chat scope cues (`back to options`, `from earlier options`, `from that list`).
- Rationale: once the user has already acted on a chat list, that list should not silently hijack future ordinals that likely target a different surface (e.g., a newly opened widget).

## Arbitration Rules (Selection-like Only)
1. Build candidate groups by source:
- `chatCandidates` from active/recoverable chat context.
- `widgetCandidates` from active widget selection context or focused visible widget list.
2. Apply explicit scope cues first:
- Chat cues: `back to options`, `from that list`, `from earlier options`.
- Widget cues: `in this panel`, `in links panel d`, `here in recent`.
3. If exactly one source has candidates, resolve against that source.
4. If both sources have candidates and no scope cue:
- **Label-like input** (`panel d`, `links panel e`, `summary144`): if the label matches exactly one candidate across the combined candidate pool (chat + widget), resolve that candidate directly. If multiple candidates match across both sources, do not guess.
- **Pure ordinal** (`first`, `second`, `2`, `a`): ask the dual-source clarifier immediately — the system already knows "pick item N" but not from which list. LLM adds no value here.
- **Messy long-tail phrasing** (`pls open the initial choice now`): run constrained LLM with source-tagged candidates. If LLM returns `select(choiceId)` with valid id, execute. If `need_more_info`, ask one grounded clarifier naming both sources.

### Recoverable Chat Tightening
- Active chat list (visible pills) can compete with widget list candidates.
- If a focused/visible widget list and chat list are both plausible: generic ordinals must use dual-source clarification (no LLM in this branch), while label-like input should resolve directly only when there is exactly one match across both sources.
- Recoverable chat list (not currently visible) does not compete when a focused visible widget list exists.
- Exception: recoverable chat can re-enter competition when user provides explicit chat scope cue:
  - `back to options`
  - `from earlier options`
  - `from that list`
- Goal: prevent stale list competition while preserving intentional re-anchor to prior chat list.

### Focused Visible Widget List Definition
- A widget list is considered focused/visible only when all are true:
  1) It appears in the current turn snapshot as a list segment with items.
  2) Its snapshot is fresh (`capturedAtMs` within the freshness TTL/threshold).
  3) It matches `activeSnapshotWidgetId` when an active widget id exists.
- `uiSnapshotId` is used for traceability and correlation only, not as the focus decision signal.

## Deterministic vs LLM Split
### Deterministic-first (strict)
- Core ordinals: `first`, `second`, numeric ordinals, badge letters.
- Exact label matches.

### LLM fallback (long tail)
- Messy phrasing not matched deterministically:
  - `pls open the initial choice now`
  - `can you pick the one after that`

Rule:
- Do not aggressively expand synonym dictionaries as primary strategy.
- Prefer constrained LLM for long-tail phrasing.

## Safety Contract
1. LLM receives only explicit candidate lists.
2. Allowed outputs:
- `select(choiceId)`
- `need_more_info`
3. Never execute without a validated `choiceId`.
4. Never invent labels, options, or commands.

## Model Tiering (Constrained Picker)
- Default: use small fast model for constrained candidate picking.
- Escalate to larger model only when:
  - small model returns `need_more_info`,
  - confidence is below threshold,
  - or input is unusually long/noisy.
- Keep the same constrained output contract at all model sizes.

## Integration Wiring Requirement (Must)
- `handleClarificationIntercept` in `chat-routing.ts` runs before dispatcher arbitration.
- This is a merge gate: selection-intent arbitration must be wired so one of these is always true:
  1) `handleClarificationIntercept` invokes the shared arbitration helper directly, or
  2) `handleClarificationIntercept` returns unhandled for selection-like dual-source cases so dispatcher arbitration executes.
- Deterministic failure inside intercept (Tier 1b.3 / 1b.3a) must not terminate in generic `unclear` handling before arbitration is attempted.
- Any fallback classifier in intercept that lacks selection-source arbitration is not a valid substitute for this requirement.

## Explicit Command Escape
When input is a known command (for example `open links panel d`) and not a source-scoped selection reference:
- Do not trap it in selection retry logic.
- Route to known-noun/command execution tiers.

## Grounded Clarifier Format (Dual-source)
When both contexts are plausible and unresolved:
- Ask one short source clarifier:
  - `Do you mean the 2nd item in Links Panel D, or the 2nd choice from earlier options?`
- Present source-specific pills where available.

## Observability Requirements
Add logs for:
- `selection_input_classified`
- `selection_context_candidates_built`
- `selection_scope_cue_applied`
- `selection_dual_source_llm_attempt`
- `selection_dual_source_llm_result`
- `selection_grounded_source_clarifier`
- `selection_command_escape`

## Acceptance Tests
1. Chat list active -> open widget command -> ordinal follow-up can still target chat list with explicit re-anchor.
2. Widget list active -> unrelated question -> later ordinal still resolves widget list if still in TTL.
3. Both contexts plausible + pure ordinal -> dual-source clarifier immediately (no LLM), never silent wrong action.
4. Explicit command with active contexts (`open links panel d`) executes command, not selection retry.
5. Long-tail phrasing (`pls open the initial choice now`) resolves via constrained LLM when deterministic misses.
6. Non-selection question never triggers selection execution.

## Rollout Plan
1. Keep this as separate incubation plan until behavior is stable in QA.
2. Implement behind feature flag:
- `SELECTION_INTENT_ARBITRATION_V1=true`
3. Validate with scripted chat scenarios and manual panel/widget mixed flows.
4. Merge into `universal-selection-resolver-plan.md` only after acceptance tests pass.

## Pre-Read Compliance
- `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md` reviewed.
- Applicability: not directly applicable (no new provider/hooks proposed here).
- Compliance: this plan avoids provider/consumer contract expansion and focuses on routing policy and source arbitration.
