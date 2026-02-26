# Selection Intent Arbitration - Scope Cues and LLM Fallback Addendum

**Status:** Addendum Draft  
**Owner:** Chat Navigation  
**Last updated:** 2026-02-27  
**Parent plan:** `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-intent-arbitration-incubation-plan.md`  
**Companion implementation plan:** `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-intent-arbitration-widget-first-fix-plan.md`

## Why this addendum exists
Current latch behavior handles many ordinal cases, but explicit user scope phrases are still missed:
- `in chat`, `from chat`
- `from the active widget`, `from current widget`, `from this widget`, `from the widget`
- `from links panel d` (named widget scope)

When scope cues are missed, routing can apply latch/default selection incorrectly. This addendum defines a strict, hybrid scope policy:
- Deterministic normalization for explicit scope cues.
- Constrained LLM fallback for long-tail phrasing when deterministic scope is unresolved.
- Safe clarifier only after deterministic and constrained LLM both fail.

## Required rules
1. **Explicit scope wins**
- If explicit scope cue is detected, it has higher priority than latch default routing.
- Scope cue handling happens before selection-like latch application.

2. **Deterministic first**
- Normalize and classify explicit scope cues deterministically.
- Do not call LLM when deterministic scope resolution is confident.

3. **Constrained LLM second**
- If scope remains unresolved and input is selection-like, call constrained LLM over allowed source candidates only.
- LLM output must be structured and validated before execution.

4. **Safe fallback last**
- If LLM abstains/fails/returns low confidence, ask a grounded clarifier with explicit source choices.

5. **No free-form execution**
- LLM never emits direct actions.
- App executes only validated candidate ids/sources.

6. **Scope cue outranks semantic lane**
- If semantic-question detection and explicit scope cue both match the same input, scope-cue routing wins.
- Do not bypass to semantic answer lane for scoped commands (for example: `can you open sample1 from active widget`).

## Required safety gates (must)
1. **Routing-order lock**
- This addendum must remain compatible with `routing-order-priority-plan.md`.
- Scope-cue arbitration runs inside Tier 3 flow, never above Tier 0/1/2 stop-return-interrupt handling.
- Required effective order:
  - Tier 0 stop/cancel
  - Tier 1 return/resume
  - Tier 2 explicit command and known-noun interrupt (only for active-list interrupt use case)
  - Tier 3 scope-cue arbitration and selection handling
  - Tier 4 known-noun global/default routing
  - Tier 5 docs/informational

2. **No-swallow rule**
- Pending-latch null behavior (`pending + no activeSnapshotWidgetId`) may return handled early only for selection-like inputs.
- Commands/questions must fall through to normal routing tiers.

3. **Hard stale-chat invariant**
- If latch is active (`resolved` or `pending`), all stale Tier 3a chat-selection paths remain blocked.
- Explicit scope-cue override can switch source, but no stale-chat path may capture ordinals implicitly.

4. **Snapshot hygiene**
- Panel-drawer selection must not write ordinal-capturable stale snapshot state.
- Pre-existing stale clarification snapshot must be cleared when latch is set from panel-drawer flow.

5. **Explicit-cue precedence over latch defaults**
- `in chat` / `from chat` and explicit widget cues must override latch default source binding.
- Latch default applies only when scope cue is absent or unresolved.

6. **LLM outage/non-blocking rule**
- LLM failure (including timeout/429/network) must never degrade routing safety.
- On LLM failure, immediately use deterministic grounded clarifier template for the same validated candidate set.
- No silent reroute and no execution may occur from failed LLM output.

7. **Constrained LLM output contract freeze**
- Freeze one output contract before implementation and use it consistently across prompt, client parser, and API route.
- Current baseline contract in runtime is:
  - `select(choiceId)`
  - `need_more_info`
- If source selection is needed, encode source via candidate ids or add an explicit versioned contract update.
- Do not mix `select(choiceId)` with `select_source/select_item` in the same rollout.

## Scope normalization contract
Classifier output:
- `scope = 'chat' | 'widget' | 'none'`
- `cueText: string | null`
- `confidence: 'high' | 'none'`
- `namedWidgetHint?: string`
- `hasConflict?: boolean`

Deterministic cue families:
- Chat cues:
  - `back to options`
  - `from earlier options`
  - `from chat options`
  - `from chat`
  - `in chat`
- Widget generic cues:
  - `from active widget`
  - `from current widget`
  - `from this widget`
  - `from the widget`
  - `in this widget`
  - `in this panel`
- Widget named cues:
  - `from <widget label>`
  - `in <widget label>`
  - Example: `from links panel d`

## Implementation steps

### Step A: Add scope-cue classifier
File:
- `lib/chat/input-classifiers.ts` or `lib/chat/scope-cue-classifier.ts`

Add a reusable classifier:
- Normalize input text.
- Detect explicit chat/widget cue families.
- Resolve named widget cues against current `turnSnapshot.openWidgets`.
- Return structured scope contract.

### Step B: Apply scope-cue stage before latch selection
Files:
- `lib/chat/chat-routing-clarification-intercept.ts`
- `lib/chat/chat-routing-scope-cue-handler.ts`
- `lib/chat/routing-dispatcher.ts`

In `handleClarificationIntercept`:
1. Run scope-cue classifier before focus-latch selection-like bypass.
2. If `scope='chat'`:
   - Apply explicit state transition contract:
     - Suspend focus latch (`suspendFocusLatch`), do not keep active widget binding.
     - Restore recoverable chat options into active chat selection state:
       - `setPendingOptions(restoredOptions)`
       - `setPendingOptionsMessageId(restoredMessageId)`
       - `setPendingOptionsGraceCount(0)`
     - `setActiveOptionSetId(restoredMessageId)`
     - `setLastClarification(...)` with restored options
     - Clear widget-only selection context (`clearWidgetSelectionContext`) for source separation.
     - Preserve `lastOptionsShown` only if it matches restored context identity.
       - Required invariant: `lastOptionsShown.messageId === restoredMessageId`.
       - If mismatch, clear `lastOptionsShown` immediately to prevent stale soft-active hijack.
     - Do not rely on stale `clarificationSnapshot` for execution.
   - **Single-turn resolution requirement (required):**
     - If the current input also contains a selection payload (ordinal/label), execute it in the same routing turn.
     - Implementation requirement: strip/consume scope cue, resolve against restored chat options, call `handleSelectOption` (or equivalent direct execution path), and return `handled: true`.
     - Do not require a second user turn for the same input.
   - If no selection payload exists after scope cue normalization, restore chat options and return `handled: true` without execution.
3. If `scope='widget'`:
   - For explicit active references (`from active widget`, `from current widget`), use `activeSnapshotWidgetId`.
   - For contextual references (`from this widget`, `from the widget`, `in this panel`), prefer latch, then fall back to `activeSnapshotWidgetId`.
   - Emit a widget-scope signal to dispatcher with stripped input + scope source (`active` | `latch` | `named`).
   - Route selection-like input to widget resolution path.
4. If scope is unresolved:
   - Continue existing latch/default arbitration path.
   - Only invoke constrained LLM source arbitration for selection-like inputs.

### Step C: Add constrained LLM source arbitration fallback
File:
- `lib/chat/routing-dispatcher.ts` (scope-signal path before Tier 2, then Tier 4.5 grounding)

When widget-scope signal is present:
- Resolve widget target deterministically (named cue matcher + active fallback).
- Hard-filter grounding candidates to the scoped widget only (no mixed-source candidates).
- Run deterministic grounding on raw stripped input (no pre-canonicalization for deterministic execution).
- If unresolved and LLM is enabled, run bounded LLM on scoped candidates.
- On LLM failure/timeout/429/abstain:
  - Skip execution.
  - Return scoped safe clarifier.

### Step D: Clarifier fallback behavior
If constrained LLM cannot safely select:
- Ask one grounded source clarifier, for example:
  - `Do you mean from chat options or Links Panel D?`
- Keep choices explicit and source-aware.

### Step E: Observability
Add logs:
- `scope_cue_detected`
- `scope_cue_applied_chat`
- `scope_cue_applied_widget`
- `scope_cue_unresolved`
- `scope_llm_attempt`
- `scope_llm_result`
- `scope_clarifier_asked`

## Acceptance tests (blockers)
1. `open the first one in chat` resolves chat options when recoverable chat options exist.
2. `open the first one from chat` resolves chat options when recoverable chat options exist.
3. `open the second one from active widget` resolves the focused widget item.
4. `open the second one from current widget` resolves the focused widget item.
5. `open the second one from links panel d` resolves `Links Panel D` item.
6. Explicit scope cue always overrides latch default behavior.
7. When deterministic scope is unresolved but selection-like, constrained LLM attempts source arbitration.
8. LLM abstain/fail results in grounded source clarifier, not silent misrouting.
9. Feature flag off preserves existing behavior.
10. Pending-latch null path does not swallow explicit commands/questions.
11. Tier ordering remains compliant with `routing-order-priority-plan.md` (stop/return/interrupt still win).
12. Active latch + explicit command (`open links panel d`) executes command path and does not enter scope-cue or selection retry loop.
13. `scope='chat'` with combined input (example: `open the first one in chat`) resolves and executes in the same turn (no second-turn repeat required).
14. `from active widget` resolves against `activeSnapshotWidgetId` even when latch points elsewhere.
15. `from this widget` resolves against latch first, then active snapshot fallback.
16. Conflicting cues (`from chat` + widget cue) return source clarifier; no execute.
17. Scoped command phrased as a question (`can you open ... from active widget`) does not enter semantic lane.

## Dispatcher-level integration checks (must)
Add dispatcher-level tests that call `dispatchRouting()` with real routing flow and mocked externals:
1. `open the first one in chat` with active latch routes to chat source (explicit cue override).
2. `open the second one from current widget` routes to focused widget source.
3. `open the second one from links panel d` routes to named widget source.
4. Pending latch + command/question input is not swallowed by pending-null early return.
5. No-latch baseline behavior remains unchanged when feature flag is off.
6. Active latch + explicit command (`open links panel d`) bypasses cue arbitration and routes as command.
7. Scope=`chat` restore with mismatched `lastOptionsShown.messageId` clears `lastOptionsShown` and still restores active chat options safely.
8. Widget scope signal with named cue + unique partial match resolves target widget (no fallback to unrelated active widget).
9. Widget scope signal with named collision returns clarifier limited to matched widgets only.
10. Widget scope signal path preserves non-exact policy: unresolved deterministic path attempts bounded LLM before safe clarifier.

## Rollout
1. Gate addendum behavior behind `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1`.
2. Land deterministic cue support first.
3. Land constrained LLM source arbitration second.
4. Enable with logs and validate on mixed chat/widget sessions before full rollout.

## Pre-read compliance
- `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md` reviewed.
- Applicability: partially applicable.
  - Applicable principle: avoid simultaneous provider/consumer contract drift.
  - This addendum keeps scope classification in routing/classifier modules and avoids introducing new provider APIs.
