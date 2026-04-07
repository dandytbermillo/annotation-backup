# Selection-vs-Command Arbitration Rule Plan

## Purpose

Define one deterministic, implementer-safe rule for ambiguous inputs when an option list is active and the same text can be interpreted as either:

1. a follow-up selection in the active option set, or
2. a new command/known noun.

This plan is a **separate guardrail plan** to prevent repeated regressions during future fixes.

## Scope

In scope:
- Clarification mode arbitration in `lib/chat/chat-routing.ts`.
- Panel/known-noun routing interaction with clarification paths.
- Deterministic precedence and tie handling.
- Test and observability requirements.

Out of scope:
- Rewriting broad routing architecture.
- Replacing deterministic routing with LLM-first arbitration.
- Isolation/minimap provider behavior.

## Current Failure Pattern (Observed)

When active clarification options exist, command-like inputs such as `open links panel` can be consumed by clarification selection paths before command routing.

Observed paths:
- Tier 1b.3 label matching can handle the input (`lib/chat/chat-routing.ts:3165` onward).
- Multi-match branch re-shows clarification (`lib/chat/chat-routing.ts:3452`).
- This returns `handled: true` before Tier 2c panel disambiguation.
- Tier 1b.4 guard (`lib/chat/chat-routing.ts:4164`) cannot help when 1b.3 already handled.

## Governing Rule (Single Source of Truth)

**Rule:** When an option set is active, selection wins **only** for selection-like inputs. Command-like inputs must not be consumed by clarification selection handlers unless there is explicit scope cue to stay in that option set.

### Deterministic Arbitration Order

1. **Explicit scope cue wins** (`from chat`, `in chat`, `from widget`, etc.).
2. **Selection-like gate**:
   - If input is selection-like, allow active-context selection path.
   - If input is not selection-like and is command-like, bypass selection handlers.
3. **Active context check**:
   - Active option set and unique selection -> execute selection.
   - Active option set and ambiguous selection -> contextual clarifier.
4. **Command path**:
   - Run panel/known-noun deterministic routing.
5. **LLM fallback (last resort only)**:
   - Only for unresolved ambiguity after deterministic checks.
   - LLM may phrase clarifier, not override deterministic source arbitration by default.

## Reuse Contract (No Parallel Matchers)

Implementers must reuse existing authoritative classifiers/utilities. Do not introduce parallel matching logic in this plan's implementation path.

- `isSelectionLike(...)` is authoritative for selection-like gating.
- `isExplicitCommand(...)` is authoritative for explicit command intent.
- Existing scope-cue resolver (`resolveScopeCue(...)`) is authoritative for explicit scope cues.
- Existing panel evidence matcher (`matchVisiblePanelCommand(...)`) remains authoritative for visible-panel evidence.

If a behavior gap exists, update these shared utilities and their tests; do not add local one-off regexes in routing handlers.

## Definitions (Must Be Reused, Not Re-invented)

- **Selection-like**: ordinal (`first`, `second`, `2`), badge/short label (`d`, `panel d`), exact/near-exact option-label match.
- **Command-like**: explicit verb or known command intent (`open`, `show`, `go to`, etc.).
- **Active option set**: `lastClarification.options` and/or soft-active recoverable list currently valid.
- **Tie across sources**: top deterministic candidates from different sources with no clear winner.

## Required Behavior Matrix

1. Active options + `the second one` -> selection.
2. Active options + `open links panel`:
   - if exact normalized active-option label match exists -> selection (no loop re-show).
   - else command path (Tier 2c/Tier 4), not stale-options re-show.
3. Active options + `panel d`:
   - if selection-like unique inside active options -> selection.
   - else command path.
4. Active options + truly ambiguous selection-like match -> ask clarifier in current context.
5. No active options + command-like -> command path.

## Addendum - Intra-Selection Precedence (Exact-First)

This addendum removes re-clarify loops when selection flow is already active.

When routing is already in selection flow, apply this deterministic order:

1. Exact normalized label match (including singular/plural normalization).
2. Unique badge/ordinal match.
3. Broad token/substring match.
4. Clarifier only if still multi-match.

Required outcomes with active options `[Links Panels, Links Panel D, Links Panel E]`:
- `open links panel` -> select `Links Panels` (no re-show loop).
- `open links panel d` -> select `Links Panel D`.
- `open links` -> clarifier (ambiguous).

Normalization contract:
- Canonicalize both input and option labels before exact comparison.
- Reuse existing shared canonicalization/matching utilities; do not introduce parallel one-off matchers.
- Do not auto-switch scope as part of this precedence.

## Implementation Plan

### Step A - Add pre-gate before Tier 1b.3 label matching

Target: `lib/chat/chat-routing.ts` before/at Tier 1b.3 entry (`~3165`).

Add deterministic bypass condition:
- if `isNewQuestionOrCommandDetected` OR `isExplicitCommand(trimmedInput)`
- and input is **not** selection-like for current options
- then skip Tier 1b.3/Tier 1b.3a label+ordinal capture and fall through.

This is the core fix for the current failure.

Routing-order guard (required):
- This pre-gate must not bypass Tier 3.5/3.6 shared resolver flow.
- Command-like inputs must remain able to escape clarification handling and reach Tier 2c/Tier 4 deterministic routing.
- Selection-like inputs must still be eligible for current-context selection handling.

### Step B - Keep Tier 1b.4 guard as secondary protection

Retain existing panel-intent skip at Tier 1b.4 (`~4164`) but treat it as backup only.

### Step C - Enforce deterministic panel routing

Ensure Tier 2c receives command-like panel inputs with active options present.
Use existing question-intent override with panel evidence in dispatcher.

### Step D - LLM policy

LLM is not primary source arbiter.
- Use LLM only when deterministic tie remains unresolved.
- LLM output should be constrained to clarifier generation or candidate ranking, not direct source override.
- LLM failures are non-blocking: timeout, 429, transport error, or abstain must immediately fall back to deterministic grounded clarifier template.
- LLM failure must not alter routing safety or execution permissions.

## Observability Requirements

Add/verify logs:
- `clarification_selection_bypassed_command_intent`
- `clarification_selection_allowed_selection_like`
- `panel_command_routed_from_active_options`
- `selection_tie_requires_clarifier`

Each log should include:
- `input`
- `activeOptionsCount`
- `isSelectionLike`
- `isExplicitCommand`
- `handledByTier`

## Test Plan (Ship Blockers)

### Unit

1. Active options + `open links panel`:
   - with exact normalized label winner -> selected in selection flow.
   - with no active-option winner -> Tier 1b.3 skipped, command path.
2. Active options + `the second one` -> Tier 1b.3a ordinal selection still works.
3. Active options + `panel d` unique label -> selection allowed.
4. Active options + non-selection command-like phrase -> command path.
5. Active options + `open links` -> clarifier (multi-match), not command escape.

### Integration

1. Repro from screenshot:
   - active stale options (`sample2 F`, `sample2`, `Workspace 4`)
   - input `can you open links panel pls`
   - expected: panel disambiguation (`Links Panels`, `Links Panel D`, `Links Panel E`), no stale-options re-show.
2. Active options (`Links Panels`, `Links Panel D`, `Links Panel E`) + `open links panel`:
   - expected: select `Links Panels` (no repeated re-show loop).
3. Safety:
   - `the second one` with same active options still selects second option.
4. Explicit scope cue:
   - `open the first one from chat` resolves in the same turn (same routing call), not next-turn restore.

## Regression Guardrails for Future Implementers

Before changing routing/clarification code, verify all three:

1. **No early consume of command-like input** inside clarification handlers.
2. **Selection-like gate exists before any active-option auto-match.**
3. **Command path remains reachable from active-option state.**

If any change violates one of these, stop and add/update tests first.

## Anti-Pattern Compliance Check

Reference: `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md`

Applicability: **Not applicable** to isolation provider/minimap API drift.

Reason:
- This plan changes chat routing arbitration, not isolation context contracts.
- No new `useSyncExternalStore` hooks.
- No provider/consumer API drift in isolation subsystem.

## Deliverables

- This plan file.
- Follow-up implementation report after code changes.
- Linked tests proving screenshot regression is fixed and selection behavior is preserved.
