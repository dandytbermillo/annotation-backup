# Grounding-Set Fallback Implementation Report

**Date:** 2026-02-01
**Plan:** `docs/proposal/chat-navigation/plan/panels/chat/meta/grounding-set-fallback-plan.md`
**Checklist:** `docs/proposal/chat-navigation/plan/panels/chat/meta/grounding-set-fallback-plan_checklist_plan.md`

---

## Summary

Implements the grounding-set constrained fallback as Tier 4.5 in the unified routing dispatcher. When deterministic routing (Tiers 0–4) declines and the user input looks like a selection or referent, the grounding-set module builds a priority-ordered candidate list from local context and attempts deterministic resolution first, then defers to a constrained LLM if needed.

---

## Files Changed

### New Files (3 files, 1306 lines total)

| File | Lines | Purpose |
|------|-------|---------|
| `lib/chat/grounding-set.ts` | 813 | Core module: set builder, selection detector, deterministic matcher, multi-list guard, soft-active/paused checks, context bridge |
| `lib/chat/grounding-llm-fallback.ts` | 249 | Client-side LLM caller with safety validation (timeout, candidate ID check, confidence threshold) |
| `app/api/chat/grounding-llm/route.ts` | 244 | Server-side API route using Gemini Flash for constrained classification |

### Modified Files (3 files, +485 / -19 lines)

| File | Changes |
|------|---------|
| `lib/chat/routing-dispatcher.ts` | +390 lines — Tier 4.5 block, `RoutingDispatcherContext` fields, `buildGroundedClarifier()`, `lastOptionsShown` turn increment, referent execution path |
| `lib/chat/chat-navigation-context.tsx` | +58 lines — `LastOptionsShown` interface, `SOFT_ACTIVE_TURN_LIMIT`, state + callbacks (`saveLastOptionsShown`, `incrementLastOptionsShownTurn`, `clearLastOptionsShown`) |
| `components/chat/chat-navigation-panel.tsx` | +56/-19 lines — Destructures and passes new context fields, wires `saveLastOptionsShown` at 3 option-display sites, adds deps to `useCallback` |

---

## Checklist Compliance

### A) State & Data Contracts — DONE

- `activeOptionSetId` — pre-existing in context
- `openWidgets[]` — typed in `GroundingSetBuildContext`, defaults to `[]` (no multi-widget UI yet)
- `lastOptionsShown` — new `LastOptionsShown` interface with `options[]`, `messageId`, `timestamp`, `turnsSinceShown`
- `softActiveTTL` = 2 turns via `SOFT_ACTIVE_TURN_LIMIT` constant
- `last_action` / `last_target` — derived from `sessionState.lastAction` in `buildGroundingContext()`
- `saveLastOptionsShown()` called at all 3 option-display sites in `chat-navigation-panel.tsx` (disambiguation, re-show, post-API)

### A2) Build Order — DONE

Order in `buildGroundingSets()` (`grounding-set.ts:147–209`):
1. Active options
2. Active widget lists ← ranked before paused per §I
3. Paused snapshot options
4. Recent referents
5. Capability set

**Note:** Checklist §A2 lists paused before widget lists (steps 2/3), but plan §I says "visible widget list wins over paused snapshot". The implementation follows the plan's precedence rule, not the checklist's numbering.

### B) Selection-Like Detector — DONE

`isSelectionLike()` at `grounding-set.ts:247–267`:
- Ordinals: `first`/`second`/`third`/`1`/`2`/`3`/`last` etc.
- Shorthand keywords: `option`/`item`/`choice`
- Panel selection: `panel d`, `panel 3`
- One-phrase: `this one`, `that one`, `the other one` (short input only)
- Badge token: single letter `a–e` only when `hasBadgeLetters` option set
- Action + pronoun referent: `open it`, `fix it`, `do that again`, `delete this` etc.

### C) Candidate Size Rule — DONE

- `LIST_CANDIDATE_CAP = 12` for list-type sets
- `NON_LIST_CANDIDATE_CAP = 5` for referent/capability sets
- Enforced via `.slice(0, cap)` in `buildGroundingSets()`
- Validation helper `isValidCandidateCount()` exported

### D) Multi-List Early Guard — DONE (no-op until UI support)

`checkMultiListAmbiguity()` at `grounding-set.ts:380–420`:
- Checks `openWidgets.length >= 2` + `isSelectionLike`
- Returns `isAmbiguous: true` with widget labels for clarifier
- Currently `openWidgets` is always `[]` — documented with code comments as future work

### E) Deterministic Unique Match Before LLM — DONE

`resolveUniqueDeterministic()` at `grounding-set.ts:290–370`:
- Match methods in order: ordinal index → exact label → unique token-subset
- Only called for list-type sets when input is selection-like
- If no grounding set exists: asks for missing slot ("Fix what?")
- LLM is only called after deterministic match fails

### F) LLM Fallback (Constrained) — DONE

Client (`grounding-llm-fallback.ts`):
- Feature flag: `NEXT_PUBLIC_GROUNDING_LLM_FALLBACK=true`
- Safety: validates non-empty candidates before calling
- Safety: validates returned `choiceId` exists in candidate list
- Safety: enforces `MIN_CONFIDENCE_SELECT = 0.6`
- Timeout: 800ms with `AbortController`
- On failure/timeout: returns `success: false` (dispatcher shows grounded clarifier)

Server (`app/api/chat/grounding-llm/route.ts`):
- Feature flag: `GROUNDING_LLM_FALLBACK=true`
- Uses Gemini Flash (same pattern as existing `clarification-llm` route)
- Restricts output to `select` | `need_more_info`
- Validates `choiceId` against candidate list server-side

Dispatcher wiring (`routing-dispatcher.ts`):
- LLM `select` → find in `pendingOptions`/`clarificationSnapshot` → `handleSelectOption()`
- LLM `select` referent → surface confirmation message ("Did you mean X?")
- LLM `need_more_info` → grounded clarifier listing candidates
- LLM failure/timeout → same grounded clarifier (no silent fallthrough)

### G) Soft-Active Window — DONE

- `lastOptionsShown` state in context with `turnsSinceShown` counter
- `incrementLastOptionsShownTurn()` called at top of `dispatchRouting()` on every user message
- Auto-expires after `SOFT_ACTIVE_TURN_LIMIT` (2 turns)
- Dispatcher checks: `activeOptionSetId === null && lastOptionsShown` → treats as soft-active grounding set
- Only activates for `isSelectionLike` input

### H) Paused-List Re-Anchor — HANDLED BY TIER 0

Not duplicated in Tier 4.5. The stop-paused ordinal guard in `handleClarificationIntercept()` (`chat-routing.ts:1987–2009`) already handles re-anchor prompts for paused lists. `checkPausedReAnchor()` is exported for future use if Tier 0 logic changes.

### I) Precedence Rules — DONE

- Widget lists ranked before paused snapshot in `buildGroundingSets()` (steps 2 vs 3)
- `firstListSet = groundingSets.find(s => s.isList)` picks widget list first since it appears earlier in the array
- Multi-list ambiguity guard runs before soft-active (step 2 in `handleGroundingSetFallback`)

### J) Telemetry — DONE

All debug log events implemented:
- `grounding_set_built` — type, size per set
- `grounding_deterministic_select` — input, candidateId, resolvedBy
- `grounding_llm_called` / `grounding_llm_error` / `grounding_llm_timeout`
- `grounding_llm_select` / `grounding_llm_need_more_info`
- `grounding_llm_referent_resolve` — new, for referent disambiguation
- `multi_list_ambiguity_prompt_shown`
- `grounding_deterministic_select_no_executable`
- `grounding_missing_slot`

### K) Manual QA Readiness

| # | Scenario | Expected Path | Status |
|---|----------|---------------|--------|
| 1 | Soft-active: open D → "panel e" | `lastOptionsShown` → deterministic match → opens E | Wired |
| 2 | Active list → "panel e" | Tier 3 active list → deterministic select | Pre-existing |
| 3 | Stop → ordinal | Tier 0 stop-paused guard → re-anchor message | Pre-existing |
| 4 | Return cue | Tier 1 return/resume handler | Pre-existing |
| 5 | Multi-widget: two lists → "first" | `checkMultiListAmbiguity` → "which list?" | Wired (no-op until UI) |
| 6 | "open it" + last_target | `ACTION_PRONOUN_REF` → Step 4b referent → LLM → resolve | Wired |
| 7 | "fix it" no context | `ACTION_PRONOUN_REF` → Step 5 → "Fix what?" | Wired |
| 8 | Large list (>5 options) | `LIST_CANDIDATE_CAP = 12` allows up to 12 | Enforced |
| 9 | "do that again" ambiguous | Step 4b → LLM → `need_more_info` → clarifier | Wired |

### L) Integration Point — DONE

Tier 4.5 block inserted in `routing-dispatcher.ts` between Tier 4 (known-noun routing) and Tier 5 (doc retrieval). Soft-active selection-like inputs that bypass Tier 3 (because `activeOptionSetId === null`) are caught here.

---

## Safety Fixes Applied (2 rounds)

### Round 1 (self-review, 5 issues)

| Issue | Fix |
|-------|-----|
| Duplicate paused re-anchor with Tier 0 | Removed from Tier 4.5; Tier 0 handles it |
| LLM fires for all unhandled inputs | Added `isSelectionLike` gate; only list-type candidates sent to LLM |
| `isSelectionLike` false positives | Tightened: "one" only in short inputs; "panel" requires suffix |
| Server-only import (`intent-prompt.ts`) | Changed to import from `chat-navigation-context.tsx` |
| Referent execution gap | Cleaned up; referent LLM select shows confirmation message |

### Round 2 (external validation, 5 issues)

| Issue | Fix |
|-------|-----|
| LLM route 404 (`/api/chat-navigation/` → `/api/chat/`) | Corrected fetch URL in `grounding-llm-fallback.ts:130` |
| Soft-active used `clarificationSnapshot` | Rewired to use `lastOptionsShown` directly in dispatcher |
| Multi-widget guard always empty | Documented as future work; `openWidgets` defaults to `[]` |
| Precedence: paused before widget lists | Reordered `buildGroundingSets`: widget lists (step 2) before paused (step 3) |
| Non-selection-like referent inputs fell through | Added `ACTION_PRONOUN_REF` pattern to `isSelectionLike` |

---

## Type-Check

```
$ npx tsc --noEmit
__tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005: ')' expected.
```

Only error is pre-existing in an unrelated test file. No errors from grounding-set implementation.

---

## Round 3 Fixes (plan compliance review)

| Issue | Fix |
|-------|-----|
| `isSelectionLike` gate blocked referent LLM for non-selection inputs | Relaxed gate: referent sets bypass `isSelectionLike`; list/capability sets still require it |
| Referent LLM select showed confirmation instead of executing | Returns structured `groundingAction` to `sendMessage()` which routes through navigate API |
| Multi-widget guard blocked (no UI) | Documented as blocked — no `openWidgets` UI surface exists |

### Fix 1 detail — `grounding-set.ts:635–670`

The `isSelectionLike` gate now only blocks when there are no referent sets. When referent sets exist, non-selection-like inputs ("fix it", "open it" without matching `ACTION_PRONOUN_REF`) still reach the LLM path. This covers the plan's general trigger without intercepting informational queries that have only capability-set context.

### Fix 2 detail — `routing-dispatcher.ts` + `chat-navigation-panel.tsx`

New `groundingAction` field on `RoutingDispatcherResult`:
```typescript
groundingAction?: {
  type: 'execute_referent'
  syntheticMessage: string  // e.g. "open Resume.pdf"
  candidateId: string
  candidateLabel: string
  actionHint?: string
}
```

Panel handler (after suggestion handler, before generic `handled` return):
1. Takes `syntheticMessage` from `groundingAction`
2. Sends it to `/api/chat/navigate` (same as suggestion affirm pattern)
3. Executes the resolution via `executeAction()`
4. On failure: shows error message with the resolved label

---

## Known Limitations

1. **Multi-widget guard is blocked** — `openWidgets` is always `[]` because no multi-widget UI surface exists. Code path is implemented and documented; will activate when UI exposes `openWidgets[]`. Documented as blocked, not deferred.
2. **LLM fallback requires feature flags** — Both `NEXT_PUBLIC_GROUNDING_LLM_FALLBACK` (client) and `GROUNDING_LLM_FALLBACK` (server) must be `true`. When disabled, LLM path is skipped and grounded clarifier is shown instead.
3. **`checkSoftActiveWindow` is imported but unused** — The dispatcher inlines the soft-active logic directly using `ctx.lastOptionsShown`. The exported function remains available for other callers but is dead code in the dispatcher path.
