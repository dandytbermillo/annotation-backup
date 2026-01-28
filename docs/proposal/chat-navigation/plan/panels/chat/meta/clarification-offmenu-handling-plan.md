# Clarification With Pills — Off-Menu Input Handling Plan (v1)

## Goal
When pills are shown and the user types something not in the list, the system should:
- stay polite and helpful
- try to map the input to one of the options
- allow topic changes smoothly
- avoid infinite loops
- resolve in **≤ 3 turns** most of the time
- treat hesitation and repair phrases in a human‑like way

## Scope
### In scope
- Off-menu input handling while option pills are active.
- Deterministic mapping first (**LLM is optional, constrained, and last-resort**).
- Optional **constrained LLM fallback** (feature-flagged) that only selects among the currently shown options (strict JSON with `choiceId` + optional `choiceIndex`, or abstain with `choiceId=null` and `choiceIndex=-1`).
- Exit / cancel handling.
- Retry limit and escalation messaging.

### Out of scope
- Retrieval logic changes.
- New UI components beyond existing pills.
- LLM-based semantic routing.

## Gap Analysis (What Already Exists)
These behaviors are already implemented and should not be duplicated:
- **Direct selection (ordinal / label match):** Tier 1a + Tier 1b.3
- **Typo recovery vs. new intent escape:** Tier 1b.4 (fuzzy vs pending options)
- **Noisy input re-show:** Tier 2 UNCLEAR handling
- **Exit handling:** existing cancel/exit detection

Remaining gaps to address:
1) Deterministic off-menu mapping rules (clear confidence criteria)  
2) AttemptCount lifecycle (reset/increment rules)  
3) Clarification-type differentiation (cross-corpus vs panel vs workspace vs doc)  
4) Escalation messaging policy  
5) Hesitation and repair behavior (pause vs reject vs exit)

---

## Canonical Token Normalization (single definition)
Canonicalization includes:
- lowercase
- punctuation/separator collapse
- optional stopword removal
- **no global synonyms**
- **micro-aliases only** (label-derived, defined below)

> **Important:** Option labels (and relevant UI titles used in matching) should be normalized using the same punctuation/spacing rules to prevent mismatch like `quick-links` vs `quick links`.

---

## Clarification State
During a pill prompt, maintain:
- `clarificationActive`
- `clarificationType`
- `options` (A/B)
- `attemptCount` (per clarification session)
- `hesitationCount` (per clarification session; counts A0 only)
- `lastUserIntentGuess` (optional; telemetry only)

### Single Shared Clarification Session (NEW)
All pill-based clarification flows must use the **same shared session state**:
- **Single attempt counter** across cross‑corpus, panel, workspace, and doc disambiguations.
- **Unified reset rules** (selection, exit, or topic change).
- **Consistent escalation ladder** (attempt 1 → 2 → 3).

This prevents fragmented behavior across different pill types and keeps the UX aligned with ChatGPT/Cursor pacing.

### Sticky List Window (NEW)
After a selection, keep the **same option list** available for **1 more turn** (or 30–60s):
- enables “the other one / first / second” immediately after opening something
- expires automatically after the window or on new intent

### AttemptCount lifecycle
- Increment on off-menu input that is **not** mapped and **not** a hard exit.
- Reset when:
  - a selection is made, or
  - exit is invoked, or
  - routing changes topic (clarification cleared / new intent).
- Do **not** increment on hesitation/pause phrases (see below).
- Do **not** increment on repair phrases (e.g., “no”, “not that”).
- **Ambiguity rule (explicit):**
  - First ambiguous re-ask **does not** increment `attemptCount`.
  - If the user keeps responding with inputs that remain ambiguous, increment on subsequent attempts.

---

## Decision Policy (Order of Evaluation)

### A0) Hesitation / Pause (NEW)
If the input is a hesitation (e.g., “hmm”, “not sure”, “i don’t know”, “idk”):
- do **not** increment `attemptCount`
- increment `hesitationCount`
- if `hesitationCount >= 2`, add a short guidance hint
- respond with a softer narrowing prompt
- re-show the same pills

This prevents the system from feeling impatient and repetitive.

### A) Direct selection (existing)
Accept:
- exact label match
- ordinal (first/second/1/2)
- label contains input (**only if unique across options**; otherwise treat as ambiguous)

If matched: select and proceed.

#### Ordinal Extraction Rule (NEW)
Allow ordinal selection **inside phrases**, not just exact inputs.  
Match any of:
- `first`, `second`, `third`, `last`
- `1st`, `2nd`, `3rd`
- numeric `1/2/3` (when options length <= 3)
- “number one/two/three”
- phrases like “the first option”, “I pick the first”, “go with the second”

This runs **before** off‑menu mapping and LLM fallback.

### B) Off-menu mapping (NEW, deterministic)
Confidence criteria:
- Canonical token equality with a single option label
- Canonical token subset where only one option satisfies it
- **Micro-alias tokens** derived from each option label (see below)

If confident: auto-select that option.  
If ambiguous (two options satisfy): re-ask A/B.

#### Micro-alias tokens (label-derived)
To avoid large synonym maps, derive a small alias token set from each label:
- Normalize label, split into tokens
- Include base tokens and conservative morphological variants **from an allowlist only**

Allowlist examples (tight, explicit):
- `personal` ↔ `personalization`
- `customize` ↔ `customization`

Rules:
- Do **not** use broad stemming.
- Keep variants opt-in and minimal.
- Expand the allowlist only when telemetry shows repeated user phrasing that fails mapping.

### C) New topic detection (bounded)
Only treat as new topic **if**:
- No direct selection, and
- No off-menu mapping match, and
- Input is a **clear command/question**, and
- Input contains **at least two tokens** that do **not** overlap any option label tokens or alias tokens
  **or** contains a strong imperative (open/show/search/go/create/rename/delete/add/remove)

Then:
- clear clarification
- route normally

This prevents “show me settings” from being misclassified as a topic switch.

#### Zero‑Overlap Escape (Addendum, integrated)
After running direct selection, off‑menu mapping, and **optional** constrained LLM fallback (if enabled), apply this last‑resort escape:

- If the input has **zero canonical token overlap** with all option labels/aliases, then **escape clarification** and route normally — even without an action verb.

**Guards:** do **not** escape if the input is:
- an ordinal (first/second/1/2/option 1)
- a hesitation phrase (hmm / idk / not sure)
- a repair/rejection phrase (not that / no / none of those)
- a short hint (≤ 2 tokens)
- noisy / garbage input (random strings, emoji spam)

This keeps “sdk / settings / profile” as clarification hints while still allowing clean topic switches like “export notes pdf” to escape.

**Note:** Zero‑overlap escape is an **exception** to the clear‑command requirement, and should be treated as a **last‑resort** reroute only after direct selection, deterministic mapping, and (if enabled) constrained LLM fallback.

#### Definition: “clear command/question” (explicit)
Treat input as a clear command/question if **any** are true:
- contains a question mark `?`
- starts with a question/ask verb: `what / how / why / tell / explain / describe / clarify / show`
- contains an imperative action verb: `open / show / go / create / rename / delete / add / remove`

### D) Noisy / unclear input
Examples: emoji, random strings.
- re-show pills with short prompt
- increment `attemptCount`

### E) Repair phrases with scoped rejection (NEW)
Treat repair/rejection phrases based on **scope**:
- **“not that”** → reject the last suggestion, stay in the same option list, re‑show options
- **“no”** → ambiguous refusal, stay in context, re‑show options
- **list rejection phrases** (user may say “none of these / none of those / neither”) → reject the entire list, switch to **refine prompt** (ask for one detail)

**Note:** only **explicit** exits (e.g., “cancel this”, “stop this”, “start over”) should fully clear clarification.  
Single‑word “stop/cancel” should be treated as **ambiguous** when options are visible (confirm first).

### F) Loop control
Escalation is used for **guidance**, not access.
If `attemptCount >= 2` **or** `hesitationCount >= 2`:
- add a short guidance hint (e.g., “You can say ‘first’ or ‘second’.”)
- invite a short free-form request if still unclear (e.g., “Tell me one detail: where it is or what it’s called.”)

---

## Escalation Messaging Policy (copy guidance)
Attempt 1: gentle redirect (re-show pills)  
Attempt 2: short clarifying question (“Which one is closer?”)  
Attempt 3: add guidance + ask for **3–6 word description**

Suggested copy (Attempt 3):
- “Which one is closer, or tell me the feature in 3–6 words (e.g., ‘change workspace theme’).”

---

## Prompt Template (Consistent Base + Adaptive Tail)  ✅
Use the same base structure everywhere, but adjust the **tail** based on what just happened:

**Base:**  
“Which one do you mean — or if neither looks right, say **‘none of these’** (or **‘none of those’**) or tell me one detail (where it is / what it’s called).”

**First time showing options (neutral):**  
“Which one do you mean — or if neither looks right, say **‘none of these’** (or **‘none of those’**) or tell me one detail (where it is / what it’s called).”

**After “not that” (rejects last choice):**  
“Okay — not that one. Which one do you mean instead — or say **‘none of these’** or tell me what it’s called.”

**After “no” (ambiguous refusal):**  
“No problem. Which one do you mean — or say **‘none of these’** or tell me where it is (Docs or Notes).”

**After list rejection (reject list):**  
“Got it. Tell me one detail (exact name or where it lives) — or I can show more results.”

**After 2+ unparseable replies:**  
“I didn’t catch that. Reply **first** or **second**, or say **‘none of these’** (or **‘none of those’**), or tell me one detail.”

---

## Exit Handling
On explicit exit (e.g., “cancel this / stop this / start over”):
- clear clarification
- ask open-ended question (“No problem — what would you like to do instead?”)

On list‑rejection (user rejects the list):
- keep the same intent, but **ask for one detail** (where it is / exact name)

---

## Clarification Type Differentiation
Apply the same logic across types, with minor differences:
- **Cross-corpus pills:** disable micro-alias mapping (**only exact label / ordinal**)
- **Panel disambiguation:** allow canonical token subset (badge letters)
- **Workspace list:** prefer ordinal or exact label; avoid fuzzy auto-select
- **Doc disambiguation:** allow subset if only one option matches

---

## Optional Refinements (Recommended)

### 1) Soft-confirm for broad mappings (one safe case)
If mapping is confident **but the user input is very broad**, you may auto-select **and** add a small confirmation line:
- **Threshold (explicit):** if input is **≤ 1 token** or in `{settings, help, profile}`, prefer soft‑confirm over silent auto‑select.
- “Got it — I’ll use **Workspace Settings**. If you meant the other one, pick it below.”

This improves “human feel” without adding guessy behavior.

### 2) Repeat off-menu overlap behavior (durability)
If the user keeps typing variations that overlap multiple options, keep it simple:
- re-ask A/B
- increment `attemptCount`
- escalate on attempt 3

### 3) Noisy Input Definition (Explicit)
Define **noisy input** so the zero‑overlap guard is consistent:
- **Noisy** if **alphabetic ratio < 50%**, **or**
- token count == 1 **and** token length < 3, **or**
- input contains **no vowel** (a,e,i,o,u)

Noisy input should **not** trigger zero‑overlap escape and should stay in clarification.

---

## Constrained LLM Contract (Optional, If Enabled)
If LLM fallback is enabled, it **must** be strictly bounded to the current pills only:
- **Input:** user text + currently shown options (labels + stable ids)
- **Output:** strict JSON
  - `{ "choiceId": "<stable id>", "choiceIndex": <0..N-1>, "decision": "select", "confidence": 0..1 }`
  - or `{ "choiceId": null, "choiceIndex": -1, "decision": "abstain", "confidence": 0..1 }`
- **No routing / no new actions / no extra text**

This keeps the fallback deterministic and safe while still allowing natural phrasing to resolve a choice.

---

## Telemetry
Log:
- `clarification_offmenu_mapped`
- `clarification_offmenu_ambiguous`
- `clarification_offmenu_reroute`
- `clarification_offmenu_exit`
- `clarification_offmenu_attempts`

---

## Implementation Drift Guardrails (NEW)
To keep the UX aligned with the plan as the code evolves:

### 1) Behavior Checks (must stay true)
- Hesitation inputs **do not** increment `attemptCount`.
- “not that” keeps clarification **active** and does **not** exit.
- New-topic detection only fires when **non-overlapping tokens** exist.
  - Must be **two** non-overlapping tokens, or a strong imperative (open/show/search/go/create/rename/delete/add/remove).

### 2) Telemetry Spot-Checks (after refactors)
Verify recent logs show:
- `clarification_offmenu_exit` only on explicit exits.
- `clarification_offmenu_attempts` does **not** increment on hesitation phrases.
- Escalation messages follow attempt ladder (1 → 2 → 3).

### 3) UI Regression Checklist
- “hmm / i don’t know” → same pills, softer prompt (no escalation).
- “not that” → stays in context and re‑shows options.
- list rejection → refine prompt (ask for one detail).
- “the first option” → selects without looping.

---

## Acceptance Tests
1. Options shown; input “settings please” → maps if only one option matches canonical tokens.  
2. Input “preferences” → re-ask A/B (no global synonym map).  
3. Input “show me my profile” → exit clarification and route normally.  
4. Input “idk” → soft prompt + re-show options (**no attemptCount increment**; increment `hesitationCount`).  
5. After 2+ attempts, add guidance + 3–6 word prompt.  
6. Input “cancel / never mind” → exit clarification.  
7. List rejection (user says “none of these / none of those / neither”) → refine prompt (ask for one detail).  
8. Input “first” → selects first option.  
9. Input “link notesx” → re-show options (typo recovery).  
10. Input “Can you show me the settings?” → maps to Workspace Settings (not exit).  
11. Input “settings” when both options include a settings token → re-ask A/B (ambiguous).  
12. Input “manage settings” (overlaps both) → re-ask A/B; increment `attemptCount`.  
13. Input “hmm” / “i don’t know” → re-show options without incrementing attempt count.  
14. Input “not that” → stays in clarification and re‑shows options (repair).  
15. List rejection phrase → refine prompt (ask for one detail).  

---

## Rollout
- Put behind an optional feature flag.
- Start with `attemptCount` limit = 2 or 3.
- Expand alias allowlist only if telemetry shows need.

---

## UX Examples (Before → After)
These are intended to guide implementation and testing.

For full, concrete conversation scripts that follow the template exactly, see:  
`clarification-offmenu-handling-examples.md`

For a draft plan that adds a response‑fit classifier step (deterministic first, constrained LLM last‑resort), see:  
`clarification-response-fit-plan.md`

### Example 1: Hesitation / Pause
**Before**
- User: “hmm” → escalation prompt
- User: “i don’t know” → escalation prompt again

**After (desired)**
- User: “hmm” → *gentle narrowing prompt, no attemptCount increment*
- User: “i don’t know” → *same options + short clarifier, still no escalation*

### Example 2: Repair vs list rejection
**Before**
- User: “not that” → exits clarification
- User: “none of those” → exits clarification

**After (desired)**
- User: “not that” → stays in context and re‑shows options
- User: “none of those” → refine prompt (ask for one detail)

### Example 3: Natural ordinal phrasing
**Before**
- User: “the first option” → escalates

**After (desired)**
- User: “the first option” → selects option 1 immediately

---

## Implementation Checklist (Step‑by‑Step)
Use this as a practical guide when implementing the plan.

## Implementation Notes (Ordering Pitfalls)
Keep these in mind to avoid regressions:
- **Ordinal selection before off‑menu mapping** (so “the first option” doesn’t get treated as noise).
- **Hesitation handling before attemptCount increments** (don’t punish “hmm / idk”).
- **Repair phrases before exit** (“not that / no” should stay in context).
- **Ambiguous off‑menu → optional LLM fallback** only if enabled; otherwise re‑ask deterministically.

### 1) Feature Flags + Server/Client Gating
- [ ] Server flag exists: `CLARIFICATION_LLM_FALLBACK=true`
- [ ] Client gating flag exists: `NEXT_PUBLIC_CLARIFICATION_LLM_FALLBACK=true`
- [ ] Client calls server route (no direct LLM calls from client)

### 2) Shared Clarification Session State
- [ ] Single shared `attemptCount` across all pill types
- [ ] Unified reset rules (selection / exit / topic change)
- [ ] Consistent escalation ladder for all clarification types

### 3) Hesitation / Pause Handling (A0)
- [ ] Detect hesitation phrases (“hmm”, “i don’t know”, “not sure”)
- [ ] Do **not** increment `attemptCount`
- [ ] Re‑show pills with softer prompt

### 4) Repair Phrases (“not that”) Stay in Context
- [ ] “not that / no, the other one” keeps clarification active
- [ ] Prefer alternative option when only two choices exist
- [ ] Do **not** clear clarification for repair phrases

### 5) Ordinal Parsing Before Off‑Menu Mapping
- [ ] Expand ordinal phrases: “the first option”, “i pick the first”
- [ ] Include numeric variants: “2nd”, “number two”, “the last one”
- [ ] Resolve to a single option before off‑menu mapping runs

### 6) Off‑Menu Mapping → Ambiguous may use constrained LLM (optional)
- [ ] If off‑menu returns **ambiguous**, allow **optional** constrained LLM fallback (if enabled)
- [ ] If LLM fallback is disabled, re‑ask deterministically (no LLM call)

### 7) List Rejection → Refine Prompt
- [ ] Detect “none of these / none of those / neither”
- [ ] Ask for one detail (where it is / exact name)

### 8) Telemetry Checks
- [ ] `clarification_offmenu_attempts` increments only on true failures
- [ ] `clarification_llm_called` logged on fallback
- [ ] `clarification_llm_decision` + `choiceId` (and `choiceIndex` if present) logged
- [ ] `clarification_offmenu_exit` only on explicit exits

### 9) UX Regression Tests
- [ ] “hmm / i don’t know” → soft prompt, no escalation
- [ ] “not that” → stays in context
- [ ] “none of those” → refine prompt (ask for one detail)
- [ ] “the first option” → selects immediately
- [ ] “the one about panel d” → LLM selects (if enabled)
