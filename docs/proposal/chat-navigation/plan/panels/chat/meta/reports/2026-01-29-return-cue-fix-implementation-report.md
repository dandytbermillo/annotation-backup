# Return-Cue Fix — Implementation Report

**Date:** 2026-01-29
**Feature:** Three-Tier Return-Cue Detection (fixes for paused list restore)
**Plan references:**
- `clarification-interrupt-resume-plan.md` §46-69 (return-cue detection + LLM fallback)
- `clarification-stop-scope-plan.md` §28-43 (no-auto-resume guard)
- `clarification-response-fit-plan.md` §221-223 (addendum references)
- `clarification-qa-checklist.md` (acceptance gate)

---

## Summary

Fixed a compound failure where natural-language return cues (e.g., "back pls", "show me what I had before") fell through all three detection tiers and routed to unrelated doc retrieval instead of restoring the paused clarification list.

**Root cause (confirmed via debug_logs):**
1. Tier 1 (deterministic): Standalone return-cue regexes only accepted `pls/please` as a **prefix**, not a **suffix**. "back pls" → no match.
2. Tier 2 (LLM): Ordinal inputs ("first option", "second option") leaked into the return-cue LLM, causing Gemini 429 rate limiting and persistent 800ms timeouts.
3. Tier 3 (fallback): On LLM failure, the code fell through **silently** to normal routing instead of showing the plan-specified confirm prompt.

---

## Changes

### 1. Strip trailing politeness before return-cue regex

**File:** `lib/chat/clarification-offmenu.ts` (detectReturnSignal, ~line 516-565)

- Added `stripped` variable that removes trailing `pls|please|thanks|thx|ty` before matching.
- Matching loop now tries `stripped` first, then `normalized` as fallback for compound phrases.
- Avoids enumerating suffix variants in every regex pattern.

```typescript
// "back pls" → "back", "return please" → "return", "go back thanks" → "go back"
const stripped = normalized.replace(/\s+(pls|please|thanks|thx|ty)$/i, '').trim()

for (const candidate of [stripped, normalized]) {
  for (const { pattern } of returnPatterns) { ... }
}
```

### 2. Added "put it/them/those back" deterministic pattern

**File:** `lib/chat/clarification-offmenu.ts` (~line 543)

- Added `\bput\s+(it|them|those)\s+back\b` to the return-cue regex list.
- Fixes "yes put it back pls" resolving in one turn instead of requiring Tier 3 confirm.

### 3. Skip return-cue LLM for ordinals

**File:** `lib/chat/chat-routing.ts` (~line 1675-1681)

- Added `isOrdinalInput` guard before `callReturnCueLLM()`.
- Ordinals like "first option", "second one" now skip the return-cue LLM entirely.
- Prevents unnecessary LLM calls and avoids Gemini rate-limiting (429).

```typescript
const isOrdinalInput = isSelectionOnly(
  trimmedInput,
  clarificationSnapshot.options.length,
  clarificationSnapshot.options.map(o => o.label)
).isSelection

if (isLLMFallbackEnabledClient() && !isRepairPhrase(trimmedInput) && !isOrdinalInput) {
```

### 4. Tier 3 confirm prompt on LLM failure

**File:** `lib/chat/chat-routing.ts` (~line 1766-1810)

- Replaced silent fallthrough on LLM failure/timeout with confirm prompt:
  `"Do you want to go back to the previous options?"`
- Both failure branch and catch branch now return `{ handled: true }` instead of falling through to doc routing.

### 5. Affirmation handling for Tier 3 recovery

**File:** `lib/chat/chat-routing.ts` (~line 1583-1628)

- Added affirmation check at the top of the paused-snapshot block.
- When the user says "yes" (or any affirmation phrase) with a paused list present, the system restores the list.
- Completes the Tier 3 flow: confirm prompt → "yes" → restore.

---

## Files Modified

| File | Changes |
|---|---|
| `lib/chat/clarification-offmenu.ts` | Strip trailing politeness; add `put it back` pattern; dual-candidate matching loop |
| `lib/chat/chat-routing.ts` | Ordinal guard before LLM; Tier 3 confirm prompt; affirmation-based restore |

---

## Telemetry Events

### Existing (unchanged)
- `paused_list_return_signal` — Tier 1 deterministic match
- `paused_return_llm_called` — Tier 2 LLM called
- `paused_return_llm_return` — Tier 2 LLM returned "return"
- `paused_return_llm_not_return` — Tier 2 LLM returned "not_return"
- `paused_return_llm_failed` — Tier 2 LLM failed/timed out
- `paused_return_llm_error` — Tier 2 LLM threw exception

### New
- `paused_list_affirmation_return` — User affirmed Tier 3 confirm prompt, list restored

---

## Debug Log Evidence (Pre-Fix)

From `debug_logs` table, session 21:01-21:05 (before fixes):

| Time | Input | Event | Problem |
|---|---|---|---|
| 21:01:20 | `first one` | `paused_return_llm_called` → Timeout | Ordinal leaked to LLM |
| 21:02:08 | `first option` | `paused_return_llm_called` → Timeout | Ordinal leaked to LLM |
| 21:05:04 | `second option` | `paused_return_llm_failed` → 429 Rate Limited | Gemini exhausted from ordinal leak |
| 21:05:11 | `back pls` | `paused_return_llm_failed` → Timeout | Actual return cue — timed out, fell through to doc routing |

## Debug Log Evidence (Post-Fix)

Session 21:38-21:39 (first post-fix test):

| Time | Input | Event | Result |
|---|---|---|---|
| 21:38:21 | `first option` | `stop_paused_ordinal_blocked` | Ordinal blocked — **no LLM call** |
| 21:38:36 | `pls take it back` | `paused_list_return_signal` | **Tier 1 match** — immediate restore |
| 21:39:05 | `first option` | `stop_paused_ordinal_blocked` | Ordinal blocked — **no LLM call** |
| 21:39:18 | `yes put it back pls` | `paused_return_llm_failed` → Timeout | Tier 3 confirm shown |
| 21:39:23 | `yes` | `paused_list_affirmation_return` | **List restored via affirmation** |

Session 22:06-22:09 (comprehensive test):

| Time | Input | Event | Result |
|---|---|---|---|
| 22:06:35 | `second option` | `stop_paused_ordinal_blocked` | Blocked — no LLM |
| 22:07:01 | `can you bring those back` | `paused_list_return_signal` | **Tier 1 match** — immediate restore |
| 22:07:45 | `show me what I had before` | `paused_return_llm_failed` → Timeout | **Tier 3 confirm shown** (not doc routing) |
| 22:07:49 | `yes` | `paused_list_affirmation_return` | **Restored** |
| 22:07:56 | `1` | `clarification_tier_noise_detected` | Noise — correct |
| 22:08:23 | `can I see the old list` | `paused_return_llm_failed` → Timeout | **Tier 3 confirm shown** |
| 22:08:27 | `yes` | `paused_list_affirmation_return` | **Restored** |
| 22:08:30 | `sto0p` | `clarification_response_fit` ask_clarify | Not an exit — correct (no typo-tolerant exit) |
| 22:08:46 | `first option pls` | `stop_paused_ordinal_blocked` | Blocked — trailing pls handled |
| 22:09:08 | `i want to go back to that` | `paused_list_return_signal` | **Tier 1 match** — "go back to" pattern |
| 22:09:14 | `stop` (active list) | `clarification_tier1a_exit_confirm` | Ambiguous exit confirm — correct |
| 22:09:22 | `yefirst` | `clarification_response_fit` ask_clarify | Garbled input — correct |
| 22:09:53 | `what were my choices` | `paused_return_llm_failed` → Timeout | **Tier 3 confirm shown** |
| 22:09:58 | `yes` | `paused_list_affirmation_return` | **Restored** |

---

## QA Checklist Results (from clarification-qa-checklist.md)

| Test | Result | Notes |
|---|---|---|
| A1 Stop during clarification (ambiguous) | **PASS** | "stop" with active list → confirm prompt |
| A2 Stop during clarification (explicit) | **PASS** | Previously verified |
| A3 Stop with no active list | **PASS** | "stop" → "No problem..." |
| A4 Repeated stop suppression | **PASS** | Previously verified |
| A5 Bare ordinal after stop | **PASS** | "first option" → "That list was closed..." |
| B6 Interrupt executes immediately | **PASS** | "open recen widget" → "Opening Recent..." |
| B7 Ordinal after interrupt (implicit return) | Not tested this session | |
| B8 Explicit return resumes | **PASS** | "can you bring those back" → restores |
| B9 Repair after interrupt | Not tested this session | |
| B9b Return cue variants | **PASS** | "pls take it back", "i want to go back to that" → restores |
| B9c Return-cue LLM fallback | **PASS** | LLM timeout → Tier 3 confirm → "yes" → restores |
| C10 Multiple ordinals while list visible | **PASS** | "second" then "first" then "third" all resolved |
| D11 Bare label without return cue | Not tested this session | |
| E12 Noise | **PASS** | "1" → noise detected, "sto0p" → ask_clarify |
| E13 Hesitation | Not tested this session | |

---

## Known Limitations

1. **Gemini LLM consistently times out at 800ms.** All Tier 2 LLM calls in both test sessions failed with timeout. The Tier 3 confirm prompt catches this, but the LLM fallback is effectively non-functional. May be Gemini API latency or lingering rate limiting.

2. **Restore logic is duplicated** across Tier 1, Tier 2, and affirmation handlers in `chat-routing.ts`. A refactor to extract a shared `restorePausedList()` function would reduce duplication. Not a bug.

3. **Remainder from non-standalone patterns includes noise.** E.g., "pls take it back" → remainder "pls", "i want to go back to that" → remainder "i want to that". These remainders are harmless (not ordinals, so ignored), but could be cleaned up by stripping leading politeness/filler from the remainder too.

---

## Type-Check

```bash
$ npx tsc --noEmit
# No errors in modified files.
# One pre-existing error in unrelated test file:
# __tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005: ')' expected.
```

---

## Next Steps

- [ ] Investigate Gemini timeout issue (API key quota, model latency, or network)
- [ ] Run remaining QA checklist tests (B7, B9, D11, E13)
- [ ] Consider refactoring restore logic into shared helper
- [ ] Commit changes
