# Clarification Response‑Fit Classifier (Draft)

Status: **Draft / Separate from main plan** (needs implementation + verification)

## Goal
When clarification pills are active, determine whether the user message **fits** the current context before taking action. This prevents “guess‑open” mistakes (e.g., interpreting a vague hint as a selection).

This plan adds a lightweight **Response‑Fit** classification step that is **deterministic first**, **LLM last‑resort**, and **strictly bounded to current options**.

---

## Problem
Current flows can misinterpret unclear inputs (e.g., “note of those”) as a selection and open the wrong item. The system lacks a “does this message fit the current clarification context?” check.

---

## Intent Buckets (when pills are active)
Each user input must be classified into one of:
- **select** — clearly chooses an option (label/ordinal/alias)
- **repair** — rejects last selection (“not that”, “the other one”)
- **reject_list** — rejects the list (“none of those”, “neither”)
- **hesitate** — pause/uncertainty (“hmm”, “idk”)
- **new_topic** — clearly different task
- **noise** — gibberish / unparseable
- **ask_clarify** — meaningful but unclear (hint words like “sdk”, “settings”)
- **soft_reject** — near‑match or ambiguous hint; requires explicit clarification before any selection

---

## Decision Flow (Deterministic → LLM)
### Step 0: Deterministic Pre‑Checks (Existing Tier Rules)
These are **not replaced**; Response‑Fit augments them. If any deterministic rule applies, **stop and handle**.
- **Noise / nonsense** (first check; do not proceed to matching)
- exit / cancel
- list rejection (none of these / neither)
- repair phrases
- ordinal selection
- label/alias match
- hesitation
- clear command/new topic (existing rule)

### Step 1: Response‑Fit Classification (Deterministic, then optional LLM)
Only if **no deterministic rule fired**:
- Run response‑fit classification to decide **ask_clarify / soft_reject / noise / new_topic / select/repair**.
- Deterministic rules should try to classify first; call constrained LLM only if classification remains uncertain.

### Step 2: Constrained LLM (Optional, Feature‑Flagged)
Only when deterministic response‑fit cannot classify intent:
- Must select **only** among current options.
- Must return strict JSON.
- Confidence gates apply (see “Execution Safety Rules”).

### Step 3: Ask‑Clarify Response
If intent is **ask_clarify** or **soft_reject**, respond with a targeted clarification prompt (see templates).

---

## Constrained Classifier Contract
**Input:** user text + current options (labels + stable ids)

**Output (strict JSON only):**
```
{ "intent": "select|repair|reject_list|hesitate|new_topic|noise|ask_clarify",
  "choiceId": "<stable id>" | null,
  "confidence": 0.0-1.0 }
```
Rules:
- `choiceId` is only allowed when intent = `select` or `repair`.
- If intent != select/repair, `choiceId` must be null.

---

## Execution Safety Rules (NEW)
### 1) Don’t Execute Unless Confident
If intent is `select` or `repair` and confidence is below threshold:
- **≥ 0.75** → execute selection
- **0.55 – 0.75** → ask confirm (“Do you mean Links Panel D?”)
- **< 0.55** → ask clarify (no execution)

### 2) Negative Intent Beats Label Overlap
If the message contains a **negation/rejection** signal (e.g., “not that”, “none of those”), **do not select**, even if label tokens overlap.
**Precedence order:**
`exit/cancel → reject_list → repair → ordinal → label_match → LLM`

### 3) Noise / Nonsense Definition (Deterministic)
Treat input as **noise** if any are true:
- alphabetic ratio < 50%
- token count == 1 and token length < 3
- contains no vowel (a/e/i/o/u)
- emoji‑only / keyboard smash

Noise should never trigger selection or zero‑overlap escape.

---

## Repair Memory (Sticky Context)
To support “the other one” style repairs:
- store `lastChoiceId` and `lastOptionsShown`
- keep sticky list for **2 turns** (configurable)
- clear on new clarification session **or** when the 2‑turn window expires

---

## Ask‑Clarify Templates (Contextual)
When intent = `ask_clarify`, choose a prompt based on the signal:
- **Hint word (≤2 tokens):** “Are you looking for X? If yes, choose A; if not, choose B.”
- **New topic signal:** “Okay — switching topics. What would you like to do now?”
- **Hesitation:** “No rush — which one is closer?”

### Soft‑Reject Template (Context‑Specific)
If the input is a near‑match but ambiguous (soft_reject), ask directly:
- “Did you mean **{Option A}**, or would you like to try again?”
- If two clear candidates: “Do you mean **{Option A}** or **{Option B}**?”

### Short Hint Words vs New Topic (Clarified)
Single or two‑token hints (e.g., “settings”, “profile”) should **not** be treated as `new_topic` unless they include a verb/command form (e.g., “open settings”, “show profile”).

---

## Telemetry (Additions)
Add the following to measure impact:
- `response_fit_intent`
- `response_fit_confidence`
- `prevented_low_confidence_execute`
- `negative_overrode_label_match`
- `asked_confirm_instead_of_execute`

---

## Safety Rules
- Never route outside the shown options.
- If confidence < 0.75 → do **not** execute; use confirm/clarify ladder.
- If noise → re‑prompt with the standard clarification template.

---

## Acceptance Tests (Draft)
1) Pills active, input “sdk” → **ask_clarify** (not auto‑select)
2) Pills active, input “note of those” → **reject_list** (refine prompt)
3) Pills active, input “the first one” → **select**
4) Pills active, input “not that” → **repair**
5) Pills active, input “show me profile” → **new_topic** (escape)
6) Pills active, input “settings” (ambiguous) → **soft_reject** → ask explicit clarification

---

## Integration Notes (Updated)
- **Response‑Fit is a wrapper, not a replacement.** It augments existing tiers.
- **Insert after deterministic tiers and before escalation/zero‑overlap escape** in `clarification-offmenu-handling-plan.md`.
- Clarify in implementation that response‑fit only runs when **no deterministic tier fired**.

## Files to Touch (Implementation Targets)
- `lib/chat/chat-routing.ts` — integrate response‑fit classification in the clarification flow
- `lib/chat/clarification-offmenu.ts` — add any shared helpers (noise checks, templates reuse)
- `lib/chat/clarification-llm-fallback.ts` — constrained LLM call/contract (if enabled)
- `lib/chat/chat-navigation-context.tsx` — state for repair memory (`lastChoiceId`, sticky list window)
- `__tests__/unit/chat/clarification-offmenu.test.ts` — new cases for response‑fit behavior

---

## LLM Fallback Clarification (Expanded)
Allow constrained LLM fallback not only on **no‑match**, but also on **ambiguous** inputs when deterministic mapping can’t resolve intent.
Still enforce:
- Only select among current options
- Confidence gates (0.75 execute / 0.55 confirm / <0.55 ask_clarify)
- No routing outside the shown list

---

## New‑Topic Definition (Clarified)
Treat input as `new_topic` only when:
- It contains a **verb/command form**, **and**
- at least **two non‑overlapping tokens** from the current options,
unless the verb is a known direct action (open/show/go/search).
Short hint words (≤2 tokens) should stay in **ask_clarify** unless they include a verb.

---

## Telemetry (if enabled)
- `clarification_fit_intent`
- `clarification_fit_confidence`
- `clarification_fit_choiceId`
- `clarification_fit_fallback_used`
