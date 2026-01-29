# Chat Navigation — Comprehensive Project Status

**Date:** 2026-01-29
**Scope:** Full status of chat navigation subsystem — plans, implementations, fixes, and current state.

---

## 1. Project Overview

The chat navigation system is a subsystem of a **Dual-Mode Annotation System** built with Next.js 15, React 19, TipTap, PostgreSQL, and Electron. It provides:

- **Doc retrieval** — keyword/chunk-based retrieval from a knowledge base
- **Clarification & disambiguation** — multi-tier intent classification for ambiguous user queries
- **Panel command routing** — deterministic routing of user commands to UI panels
- **Cross-corpus retrieval** — unified retrieval across docs and notes corpora

The system is currently running in **Option A** (offline, single-user, no Yjs). Option B (multi-user/live collaboration) is a future phase.

---

## 2. Plan Hierarchy

Plans are organized in a layered hierarchy. Later plans override earlier ones where specified.

```
Foundation Layer
├── cursor-style-doc-retrieval-plan.md          ← Retrieval pipeline (keyword + chunks)
├── general-doc-retrieval-routing-plan.md        ← Routing v5 (HS1/HS2 selection, disambiguation)
├── 2026-01-14-doc-retrieval-routing-debt-paydown-plan.md ← Technical debt cleanup
└── unified-retrieval-prereq-plan.md             ← Cross-corpus prerequisites

Clarification Layer
├── clarification-offmenu-handling-plan.md       ← Base: deterministic tiers, ordinal/alias matching
├── clarification-llm-last-resort-plan.md        ← Constrained LLM fallback (feature-flagged)
├── clarification-response-fit-plan.md           ← Primary: intent classifier, confidence ladder
│   ├── clarification-interrupt-resume-plan.md   ← Addendum: pause/resume on interruption
│   └── clarification-stop-scope-plan.md         ← Addendum: scope-aware stop/cancel
└── clarification-qa-checklist.md                ← 13-test acceptance gate (A1-E13)

Supporting Documents
├── clarification-offmenu-handling-examples.md   ← Canonical bot/user response wording
├── clarification-response-fit-implementation-guide.md ← Checklist-style guide
└── INDEX.md                                      ← Plan timeline and quick reference
```

---

## 3. Implementation Status by Plan

### 3.1 Doc Retrieval Foundation

| Plan | Status | Key Deliverables |
|------|--------|-----------------|
| Cursor-style doc retrieval (Phases 0-2) | **Complete** | `lib/docs/keyword-retrieval.ts`, `lib/docs/seed-docs.ts`, `/api/docs/retrieve` |
| Cursor-style (Phase 3: Embeddings) | Deferred | Trigger: keyword retrieval success drops |
| Cursor-style (Phase 4: Context Builder) | Deferred | Trigger: need consistent context assembly |
| General doc routing v5 | **Complete** | HS1/HS2 selection, disambiguation pills, follow-up expansion |
| Doc retrieval debt paydown (TD-1 to TD-9) | **Complete** (except TD-6) | Pattern consolidation, telemetry, fuzzy matching, polite follow-up guard |

### 3.2 Unified Retrieval

| Prerequisite | Status | Key Deliverables |
|--------------|--------|-----------------|
| 1. Indexing Strategy | **Complete** | `lib/docs/items-indexing.ts`, chunks schema |
| 2. Permissions/Workspace Scoping | **Complete** | Workspace-scoped queries |
| 3. Unified API Contract | **Complete** | `/api/retrieve` endpoint |
| 4. Cross-Corpus Ambiguity UX | **Complete** | Docs vs Notes pills |
| 5. Safety/Fallback | **Complete** | Graceful degradation |
| Phase 2 Adoption | Pending | Broader integration awaiting response-fit stabilization |

### 3.3 Clarification & Disambiguation

| Plan | Status | Key Deliverables |
|------|--------|-----------------|
| Off-menu handling | **Implemented** | Ordinal parsing, micro-alias, hesitation/repair, escalation |
| LLM last-resort fallback | **Implemented** (flagged) | Constrained selection among shown options |
| Response-fit classifier | **Active / Iterating** | Intent classification, confidence ladder, noise handling |
| Interrupt/resume addendum | **Active / Iterating** | Pause on interruption, three-tier return-cue detection |
| Stop/cancel scope addendum | **Active / Iterating** | Scope-aware stop, confirmation for ambiguous stop, no-auto-resume |

### 3.4 Panel Command Routing

| Area | Status |
|------|--------|
| Panel routing hardening | **Complete** |
| Links Panel naming consolidation | **Complete** |

---

## 4. Current Session Fixes (2026-01-29)

### Issue: Natural-Language Return Cues Fell Through All Three Detection Tiers

**Symptom:** User says "back pls" with a paused clarification list present. Instead of restoring the list, the system routes to unrelated doc retrieval.

**Root Cause (confirmed via `debug_logs` table):**

1. **Tier 1 (deterministic):** Standalone return-cue regexes only accepted `pls/please` as a **prefix**, not a **suffix**. "back pls" produced no match.
2. **Tier 2 (LLM):** Ordinal inputs ("first option", "second option") leaked into the return-cue LLM, causing Gemini 429 rate limiting and persistent 800ms timeouts.
3. **Tier 3 (fallback):** On LLM failure/timeout, the code fell through **silently** to normal routing instead of showing the plan-specified confirm prompt.

### Fixes Applied

#### Fix 1: Strip trailing politeness before return-cue regex

**File:** `lib/chat/clarification-offmenu.ts` (~line 516-565)

- Added `stripped` variable that removes trailing `pls|please|thanks|thx|ty` before matching.
- Matching loop now tries `stripped` first, then `normalized` as fallback.

```typescript
const stripped = normalized.replace(/\s+(pls|please|thanks|thx|ty)$/i, '').trim()
for (const candidate of [stripped, normalized]) {
  for (const { pattern } of returnPatterns) { ... }
}
```

#### Fix 2: Added "put it/them/those back" deterministic pattern

**File:** `lib/chat/clarification-offmenu.ts` (~line 543)

- Added `\bput\s+(it|them|those)\s+back\b` to the return-cue regex list.
- Fixes "yes put it back pls" resolving in one turn instead of requiring Tier 3 confirm.

#### Fix 3: Skip return-cue LLM for ordinals

**File:** `lib/chat/chat-routing.ts` (~line 1675-1681)

- Added `isOrdinalInput` guard before `callReturnCueLLM()`.
- Ordinals now skip the return-cue LLM entirely, preventing unnecessary calls and Gemini rate-limiting.

```typescript
const isOrdinalInput = isSelectionOnly(
  trimmedInput,
  clarificationSnapshot.options.length,
  clarificationSnapshot.options.map(o => o.label)
).isSelection

if (isLLMFallbackEnabledClient() && !isRepairPhrase(trimmedInput) && !isOrdinalInput) {
```

#### Fix 4: Tier 3 confirm prompt on LLM failure

**File:** `lib/chat/chat-routing.ts` (~line 1766-1810)

- Replaced silent fallthrough on LLM failure/timeout with confirm prompt: "Do you want to go back to the previous options?"
- Both failure branch and catch branch now return `{ handled: true }` instead of falling through to doc routing.

#### Fix 5: Affirmation handling for Tier 3 recovery

**File:** `lib/chat/chat-routing.ts` (~line 1583-1628)

- Added affirmation check (`isAffirmationPhrase`) at the top of the paused-snapshot block.
- When user says "yes" with a paused list present, the system restores the list.
- Completes the Tier 3 flow: confirm prompt -> "yes" -> restore.

#### Additional Return-Cue Improvements (Late 2026-01-29)

- **Standalone “back” rule (paused list only):** If a paused list exists, `back` / `go back` restores it (no routing).
- **Deterministic cues expanded:** Added support for
  - “bring those back”
  - “show me what I had before”
  - “put it/them/those back”
- **LLM guard:** Ordinals now skip return‑cue LLM calls to avoid rate limiting.
- **Failure recovery:** On LLM timeout/error, the system shows a confirm prompt instead of routing away.

### Files Modified

| File | Changes |
|------|---------|
| `lib/chat/clarification-offmenu.ts` | Strip trailing politeness; add `put it back` pattern; dual-candidate matching loop |
| `lib/chat/chat-routing.ts` | Ordinal guard before LLM; Tier 3 confirm prompt; affirmation-based restore |

---

## 5. Debug Log Evidence

### Pre-Fix Session (21:01-21:05)

| Time | Input | Event | Problem |
|------|-------|-------|---------|
| 21:01:20 | `first one` | `paused_return_llm_called` -> Timeout | Ordinal leaked to LLM |
| 21:02:08 | `first option` | `paused_return_llm_called` -> Timeout | Ordinal leaked to LLM |
| 21:05:04 | `second option` | `paused_return_llm_failed` -> 429 Rate Limited | Gemini exhausted from ordinal leak |
| 21:05:11 | `back pls` | `paused_return_llm_failed` -> Timeout | Actual return cue fell through to doc routing |

### Post-Fix Session (21:38-21:39, 22:06-22:09)

| Time | Input | Event | Result |
|------|-------|-------|--------|
| 21:38:21 | `first option` | `stop_paused_ordinal_blocked` | Ordinal blocked -- no LLM call |
| 21:38:36 | `pls take it back` | `paused_list_return_signal` | Tier 1 match -- immediate restore |
| 21:39:18 | `yes put it back pls` | `paused_return_llm_failed` -> Timeout | Tier 3 confirm shown |
| 21:39:23 | `yes` | `paused_list_affirmation_return` | List restored via affirmation |
| 22:07:01 | `can you bring those back` | `paused_list_return_signal` | Tier 1 match -- immediate restore |
| 22:07:45 | `show me what I had before` | `paused_return_llm_failed` -> Timeout | Tier 3 confirm shown (not doc routing) |
| 22:07:49 | `yes` | `paused_list_affirmation_return` | Restored |
| 22:08:23 | `can I see the old list` | `paused_return_llm_failed` -> Timeout | Tier 3 confirm shown |
| 22:08:27 | `yes` | `paused_list_affirmation_return` | Restored |
| 22:08:46 | `first option pls` | `stop_paused_ordinal_blocked` | Blocked -- trailing pls handled |
| 22:09:08 | `i want to go back to that` | `paused_list_return_signal` | Tier 1 match |
| 22:09:53 | `what were my choices` | `paused_return_llm_failed` -> Timeout | Tier 3 confirm shown |
| 22:09:58 | `yes` | `paused_list_affirmation_return` | Restored |

---

## 6. QA Checklist Results (2026-01-29)

From `clarification-qa-checklist.md` (13 tests, A1-E13):

| Test | Description | Result | Notes |
|------|-------------|--------|-------|
| A1 | Stop during clarification (ambiguous) | **PASS** | "stop" with active list -> confirm prompt |
| A2 | Stop during clarification (explicit) | **PASS** | Previously verified |
| A3 | Stop with no active list | **PASS** | "stop" -> "No problem..." |
| A4 | Repeated stop suppression | **PASS** | Previously verified |
| A5 | Bare ordinal after stop | **PASS** | "first option" -> "That list was closed..." |
| B6 | Interrupt executes immediately | **PASS** | "open recen widget" -> "Opening Recent..." |
| B7 | Ordinal after interrupt (implicit return) | Not tested | |
| B8 | Explicit return resumes | **PASS** | "can you bring those back" -> restores |
| B9 | Repair after interrupt | Not tested | |
| B9b | Return cue variants | **PASS** | Multiple variants tested and working |
| B9c | Return-cue LLM fallback | **PASS** | LLM timeout -> Tier 3 confirm -> "yes" -> restores |
| C10 | Multiple ordinals while list visible | **PASS** | "second" then "first" then "third" all resolved |
| D11 | Bare label without return cue | Not tested | |
| E12 | Noise | **PASS** | "1" -> noise detected, "sto0p" -> ask_clarify |
| E13 | Hesitation | Not tested | |

**Pass rate:** 10/13 tested, all passing. 3 tests not yet run (B7, B9, D11, E13).

---

## 7. Telemetry Events

### Clarification Events (Existing)

| Event | Description |
|-------|-------------|
| `paused_list_return_signal` | Tier 1 deterministic match -- immediate restore |
| `paused_return_llm_called` | Tier 2 LLM called |
| `paused_return_llm_return` | Tier 2 LLM returned "return" |
| `paused_return_llm_not_return` | Tier 2 LLM returned "not_return" |
| `paused_return_llm_failed` | Tier 2 LLM failed/timed out |
| `paused_return_llm_error` | Tier 2 LLM threw exception |
| `stop_paused_ordinal_blocked` | Ordinal input blocked (no LLM call) |
| `clarification_tier1a_exit_confirm` | Ambiguous exit confirm prompt |
| `clarification_tier_noise_detected` | Noise input detected |
| `clarification_response_fit` | Response-fit classifier result |

### New Events (2026-01-29)

| Event | Description |
|-------|-------------|
| `paused_list_affirmation_return` | User affirmed Tier 3 confirm prompt, list restored |

---

## 8. Feature Flags

| Flag | Scope | Purpose |
|------|-------|---------|
| `CLARIFICATION_LLM_FALLBACK` | Server | Enable LLM fallback for clarification |
| `NEXT_PUBLIC_CLARIFICATION_LLM_FALLBACK` | Client | Client-side gate for LLM fallback |
| `CLARIFICATION_LLM_MODEL` | Server | Model selection for LLM calls |
| `NEXT_PUBLIC_CROSS_CORPUS_FUZZY` | Client | Cross-corpus fuzzy normalization |
| `SEMANTIC_FALLBACK_ENABLED` | Server | Semantic fallback classifier for routing |

---

## 9. Key Runtime Files

### Chat Routing & Navigation
- `lib/chat/chat-routing.ts` — Main routing logic (~3800 lines)
- `lib/chat/chat-navigation-context.tsx` — Snapshot management (save/pause/clear)
- `components/chat/chat-navigation-panel.tsx` — Chat UI panel

### Clarification System
- `lib/chat/clarification-offmenu.ts` — Deterministic detection (return signals, ordinals, repair)
- `lib/chat/clarification-llm-fallback.ts` — Client-side LLM wrapper (800ms timeout)
- `app/api/chat/clarification-llm/return-cue/route.ts` — Server-side Gemini Flash route

### Retrieval
- `lib/docs/keyword-retrieval.ts` — Keyword retrieval service
- `lib/docs/items-indexing.ts` — Notes indexing service
- `lib/docs/items-retrieval.ts` — Notes retrieval service
- `app/api/retrieve/route.ts` — Unified retrieval endpoint

### Patterns & Telemetry
- `lib/chat/query-patterns.ts` — Consolidated pattern module (affirmation, corpus signals)
- `lib/chat/routing-telemetry.ts` — Telemetry event definitions

---

## 10. Known Limitations

1. **Gemini LLM consistently times out at 800ms.** All Tier 2 LLM calls failed with timeout during testing. The Tier 3 confirm prompt catches this, but the LLM fallback is effectively non-functional. Needs investigation (API key quota, model latency, or network).

2. **Restore logic is duplicated** across Tier 1, Tier 2, and affirmation handlers in `chat-routing.ts`. A refactor to extract a shared `restorePausedList()` function would reduce duplication.

3. **Remainder from non-standalone patterns includes noise.** E.g., "pls take it back" -> remainder "pls". Harmless but could be cleaned up.

4. **Response-fit classifier is still iterating** — the primary classifier plan is active but undergoing refinements.

5. **Unified Retrieval Phase 2** adoption pending — infrastructure complete but broader integration not started.

---

## 11. Implementation Reports

| Date | Report | Scope |
|------|--------|-------|
| 2026-01-10 | `report/2026-01-10-cursor-style-doc-retrieval-implementation-report.md` | Cursor-style foundation |
| 2026-01-11 | `report/2026-01-11-phase2-chunk-retrieval-implementation-report.md` | Chunk retrieval |
| 2026-01-11 | `report/2026-01-11-general-doc-retrieval-routing-complete-report.md` | Routing v5 |
| 2026-01-14 | `reports/2026-01-14-definitional-query-fix-implementation-report.md` | Definitional fix |
| 2026-01-14 | `reports/2026-01-14-td3-implementation-report.md` | Debt TD-3 |
| 2026-01-15 | `reports/2026-01-15-knownterms-race-fix-report.md` | knownTerms race |
| 2026-01-15 | `reports/2026-01-15-td2-fuzzy-matching-implementation-report.md` | Debt TD-2 |
| 2026-01-15 | `reports/2026-01-15-td4-td8-implementation-report.md` | Debt TD-4, TD-8 |
| 2026-01-16 | `reports/2026-01-16-td7-implementation-report.md` | Debt TD-7 |
| 2026-01-19 | `reports/2026-01-19-interface-weak-match-fix-implementation-report.md` | Interface weak-match |
| 2026-01-20 | `reports/2026-01-20-classifier-gemini-and-alias-coverage-implementation-report.md` | Classifier Gemini + alias |
| 2026-01-20 | `reports/2026-01-20-unified-retrieval-prereq-indexing-implementation-report.md` | Prereq 1 |
| 2026-01-20 | `reports/2026-01-20-unified-retrieval-prereq-permissions-workspace-scope-report.md` | Prereq 2 |
| 2026-01-20 | `reports/2026-01-20-prereq4-cross-corpus-ambiguity-implementation-report.md` | Prereq 4 |
| 2026-01-20 | `reports/2026-01-20-prereq5-safety-fallback-implementation-report.md` | Prereq 5 |
| 2026-01-25 | `clarification-offmenu-handling-implementation-report.md` | Off-menu handling |
| 2026-01-29 | `reports/2026-01-29-return-cue-fix-implementation-report.md` | **Return-cue fix (this session)** |

---

## 12. Next Steps

- [ ] Investigate Gemini timeout issue (API key quota, model latency, or network)
- [ ] Run remaining QA checklist tests (B7, B9, D11, E13)
- [ ] Consider refactoring restore logic into shared helper
- [ ] Continue response-fit classifier iteration
- [ ] Begin Unified Retrieval Phase 2 adoption after response-fit stabilizes
- [ ] Commit current changes
