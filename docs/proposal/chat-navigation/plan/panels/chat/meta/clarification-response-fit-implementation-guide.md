# Clarification Response‑Fit — Implementation Guide

**Plan:** `clarification-response-fit-plan.md`  
**Status:** Implementation guide (step‑by‑step)

---

## 0) Scope & Guardrails

- **Deterministic first**, LLM last‑resort.
- **Never route outside current options.**
- Response‑Fit **augments** existing tiers; it does not replace them.
- **Noise check runs first** (before any matching).
- **Classifier vs Answering:** Gemini Flash is the constrained classifier; OpenAI is used only after selection for final answers.

---

## 1) Files to Touch (Target List)

- `lib/chat/chat-routing.ts` — integrate response‑fit classification in clarification flow
- `lib/chat/clarification-offmenu.ts` — shared helpers (noise checks, templates)
- `lib/chat/clarification-llm-fallback.ts` — constrained LLM contract (if enabled)
- `lib/chat/chat-navigation-context.tsx` — repair memory (`lastChoiceId`, sticky list window)
- `__tests__/unit/chat/clarification-offmenu.test.ts` — new response‑fit cases

---

## 2) Decision Order (Canonical)

When clarification is active:

0. **Post‑action repair window** (if no clarification but snapshot exists) → restore list + repair prompt
0b. **Visible options = active selection** (even after a selection)
    → allow ordinal/label selection against last shown options while they remain visible
1. **Noise pre‑check** (alphabetic ratio / short token / no vowel / emoji smash) → re‑prompt
2. **Reject list** (“none of these/none of those/neither”) → refine prompt
3. **Exit / cancel** (with confirmation when options are visible)
4. **Repair phrases** (“not that”, “other one”) → stay in list
5. **Ordinal selection** (“first/second/1/2/last”) → select
6. **Label / alias match** → select
7. **Hesitation** (“hmm”, “idk”) → soft prompt, no attempt increment
8. **Clear command / new topic** → escape (per existing rules; verbs bypass short‑hint guard)
9. **Response‑Fit classifier** (deterministic → optional LLM)
10. **Escalation / zero‑overlap escape** (as last resort)

---

## 3) Response‑Fit Classifier Integration

### 3.1 Deterministic classification (before LLM)
- If input contains **negation/rejection** → `reject_list` or `repair` (per precedence)
- If input is **short hint (≤2 tokens)** → `ask_clarify`
- If input is **near‑match but ambiguous** → `soft_reject`
- If input is **clear command + 2+ non‑overlapping tokens** → `new_topic`

### 3.2 Optional constrained LLM fallback
Call only when deterministic response‑fit cannot classify:
- Input: user text + current options (labels + stable ids)
- Output: strict JSON intent + choiceId + confidence
- Enforce: `choiceId` only when intent = `select` or `repair`

---

## 4) Execution Confidence Ladder

Apply only when intent = `select` or `repair`:

- **confidence ≥ 0.75** → execute
- **0.55–0.75** → ask confirm (“Do you mean X?”)
- **< 0.55** → ask clarify (no execute)

---

## 4.5) Exit Confirmation Handling (Visible = Active)

**Detector (pure, text‑only):**
Use `isExplicitExitPhrase()` to classify input as *explicit* exit **only** when:
- Exit word + direct object (e.g., “cancel this”, “stop the selection”)
- Exit word + reset keyword (“start over”, “restart”, “begin again”)

**Stateful routing (in chat‑routing.ts):**
- Track `exitCount` per clarification session.
- If options are visible **and** exit phrase is ambiguous:
  - `exitCount == 0` → show confirm prompt, set `exitCount = 1`, keep options visible.
  - `exitCount >= 1` → hard‑exit (user repeated exit intent).

**Handling the next user reply to the confirm prompt:**
- Affirmation (“yes”, “cancel”, “do it”) → hard‑exit.
- Negation / keep choosing (“no”, “keep choosing”) → dismiss confirm, re‑show options, reset `exitCount`.
- Ordinal / label → normal selection (do **not** hard‑exit).
- Another exit phrase → hard‑exit.

This keeps the detector pure while routing handles repeat intent and confirm flow.

## 5) Repair Memory (Sticky Context)

- Store: `lastChoiceId`, `lastOptionsShown`
- Keep for **2 turns** (configurable)
- Clear on new clarification session or when window expires

### 5b) Post‑Action Repair Window (Snapshot)

- Track `lastClarificationSnapshot` for **1–2 turns** after an action escape.
- Save snapshot **before clearing clarification** on:
  - new‑topic escape
  - LLM reroute decision
- If repair phrase arrives with no active clarification but snapshot exists → restore options + repair prompt.

### 5c) Visible Options = Active Selection (No Turn Limit While Visible)
- Keep `lastOptionsShown` **after selection** as long as the options remain visible.
- If `lastClarification` is cleared but options are still visible, allow:
  - ordinal selection (“first/second/2”)
  - direct label match
  against `lastOptionsShown`.
- Clear only on:
  - explicit exit (“cancel this”, “start over”),
  - clear new topic command,
  - new options list replaces the old one.

---

## 6) Prompt Templates (Use Plan Wording)

- Base: “Which one do you mean — or if neither looks right, say ‘none of these’ (or ‘none of those’) or tell me one detail (where it is / what it’s called).”
- Repair: “Okay — not that one. Which one do you mean instead — or say ‘none of these’ (or ‘none of those’) or tell me what it’s called.”
- No: “No problem. Which one do you mean — or say ‘none of these’ (or ‘none of those’) or tell me where it is (Docs or Notes).”
- Refine (list rejection): “Got it. Tell me one detail (exact name or where it lives) — or I can show more results.”
- Unparseable: “I didn’t catch that. Reply **first** or **second**, or say ‘none of these’ (or ‘none of those’), or tell me one detail.”
- Noise escalation (optional): after 2 noisy inputs, append “Reply **first** or **second**, or tell me one detail.”

### 6b) Repeated “No” Escalation
- Track `noCount` per clarification session.
- Second “no” → treat as `reject_list` → refine prompt.

---

## 7) Telemetry (Additions)

Emit on every response‑fit pass:
- `response_fit_intent`
- `response_fit_confidence`
- `prevented_low_confidence_execute`
- `negative_overrode_label_match`
- `asked_confirm_instead_of_execute`

---

## 8) Tests (Add / Update)

Add unit cases in `__tests__/unit/chat/clarification-offmenu.test.ts`:

- `sdk` → `ask_clarify`
- `note of those` → `reject_list`
- `the first one` → `select`
- `not that` → `repair`
- `show me profile` → `new_topic`
- `settings` → `soft_reject`
- **Post‑action repair window:** “open recent” then “not that” → restore last options
- **Repeated no escalation:** “no” twice → refine prompt

---

## 9) Manual QA Checklist

- **Hesitation**: “hmm” does not increment attemptCount
- **Repair**: “not that” keeps same list
- **List rejection**: “none of those” triggers refine prompt
- **Noise**: “asdf” → unparseable prompt
- **Short hint**: “sdk” → ask clarify, not auto‑select
- **Clear command**: “open recent” escapes clarification
- **Post‑action repair window**: “open recent” then “not that” restores last options
- **Repeated no escalation**: “no” twice → refine prompt

---

## 10) Rollout

- Feature flag optional LLM fallback (default off)
- Ship deterministic response‑fit first
- Enable LLM only after telemetry confirms reduced mis‑opens

---

## Completion Criteria

- All acceptance tests pass
- No accidental selection on low‑confidence inputs
- Clarification flows remain bounded to current options
- Telemetry shows reduced “wrong open” events
