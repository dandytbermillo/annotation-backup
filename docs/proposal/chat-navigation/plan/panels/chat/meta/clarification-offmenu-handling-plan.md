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
- Deterministic mapping (no LLM dependency).
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
- `lastUserIntentGuess` (optional; telemetry only)

### Single Shared Clarification Session (NEW)
All pill-based clarification flows must use the **same shared session state**:
- **Single attempt counter** across cross‑corpus, panel, workspace, and doc disambiguations.
- **Unified reset rules** (selection, exit, or topic change).
- **Consistent escalation ladder** (attempt 1 → 2 → 3).

This prevents fragmented behavior across different pill types and keeps the UX aligned with ChatGPT/Cursor pacing.

### AttemptCount lifecycle
- Increment on off-menu input that is **not** mapped and **not** a hard exit.
- Reset when:
  - a selection is made, or
  - exit is invoked, or
  - routing changes topic (clarification cleared / new intent).
- Do **not** increment on hesitation/pause phrases (see below).

---

## Decision Policy (Order of Evaluation)

### A0) Hesitation / Pause (NEW)
If the input is a hesitation (e.g., “hmm”, “not sure”, “i don’t know”):
- do **not** increment `attemptCount`
- respond with a softer narrowing prompt
- re-show the same pills

This prevents the system from feeling impatient and repetitive.

### A) Direct selection (existing)
Accept:
- exact label match
- ordinal (first/second/1/2)
- label contains input

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
- Input contains **at least one token not overlapping** any option label tokens or alias tokens

Then:
- clear clarification
- route normally

This prevents “show me settings” from being misclassified as a topic switch.

#### Definition: “clear command/question” (explicit)
Treat input as a clear command/question if **any** are true:
- contains a question mark `?`
- starts with a question/ask verb: `what / how / why / tell / explain / describe / clarify / show`
- contains an imperative action verb: `open / show / go / create / rename / delete / add / remove`

### D) Noisy / unclear input
Examples: “idk”, emoji, random strings.
- re-show pills with short prompt
- increment `attemptCount`

### E) Repair phrases (NEW)
If the user rejects the current selection **but stays in context** (e.g., “not that”, “no, the other one”):
- keep clarification active
- prefer the alternative option if two choices exist
- otherwise re-show options with a short clarifier

**Note:** “not that” should **not** fully exit clarification unless the user explicitly exits (“cancel / never mind”).

### F) Loop control
If `attemptCount >= 2` (or after multiple hesitations):
- show explicit exits (`None of these` / `Start over`)
- invite a short free-form request

---

## Escalation Messaging Policy (copy guidance)
Attempt 1: gentle redirect (re-show pills)  
Attempt 2: short clarifying question (“Which one is closer?”)  
Attempt 3: exits + ask for **3–6 word description**

Suggested copy (Attempt 3):
- “Which one is closer, or tell me the feature in 3–6 words (e.g., ‘change workspace theme’).”

---

## Exit Handling
On explicit exit (“cancel / never mind / none / stop”):
- clear clarification
- ask open-ended question (“No problem — what would you like to do instead?”)

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
If mapping is confident **but the user input is very broad** (e.g., only “settings”), you may auto-select **and** add a small confirmation line:
- “Got it — I’ll use **Workspace Settings**. If you meant the other one, pick it below.”

This improves “human feel” without adding guessy behavior.

### 2) Repeat off-menu overlap behavior (durability)
If the user keeps typing variations that overlap multiple options, keep it simple:
- re-ask A/B
- increment `attemptCount`
- escalate on attempt 3

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
- Exit pills appear by attempt **2** or after repeated hesitation.
- New-topic detection only fires when **non-overlapping tokens** exist.

### 2) Telemetry Spot-Checks (after refactors)
Verify recent logs show:
- `clarification_offmenu_exit` only on explicit exits.
- `clarification_offmenu_attempts` does **not** increment on hesitation phrases.
- Escalation messages follow attempt ladder (1 → 2 → 3).

### 3) UI Regression Checklist
- “hmm / i don’t know” → same pills, softer prompt (no escalation).
- “not that” → stays in context and offers the alternative.
- “the first option” → selects without looping.

---

## Acceptance Tests
1. Options shown; input “settings please” → maps if only one option matches canonical tokens.  
2. Input “preferences” → re-ask A/B (no global synonym map).  
3. Input “show me my profile” → exit clarification and route normally.  
4. Input “idk” → re-show options.  
5. After 2+ off-menu attempts → show exit options + 3–6 word prompt.  
6. Input “none of these” → exit clarification.  
7. Input “first” → selects first option.  
8. Input “link notesx” → re-show options (typo recovery).  
9. Input “Can you show me the settings?” → maps to Workspace Settings (not exit).  
10. Input “settings” when both options include a settings token → re-ask A/B (ambiguous).  
11. Input “manage settings” (overlaps both) → re-ask A/B; increment `attemptCount`.  
12. Input “hmm” / “i don’t know” → re-show options without incrementing attempt count.  
13. Input “not that” → stays in clarification and offers the alternative (not a full exit).  

---

## Rollout
- Put behind an optional feature flag.
- Start with `attemptCount` limit = 2 or 3.
- Expand alias allowlist only if telemetry shows need.

---

## UX Examples (Before → After)
These are intended to guide implementation and testing.

### Example 1: Hesitation / Pause
**Before**
- User: “hmm” → escalation prompt
- User: “i don’t know” → escalation prompt again

**After (desired)**
- User: “hmm” → *gentle narrowing prompt, no attemptCount increment*
- User: “i don’t know” → *same options + short clarifier, still no escalation*

### Example 2: Repair phrase
**Before**
- User: “not that” → exits clarification

**After (desired)**
- User: “not that” → stays in context, prefers the alternative option

### Example 3: Natural ordinal phrasing
**Before**
- User: “the first option” → escalates

**After (desired)**
- User: “the first option” → selects option 1 immediately

---

## Implementation Checklist (Step‑by‑Step)
Use this as a practical guide when implementing the plan.

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

### 6) Off‑Menu Mapping → Ambiguous should still call LLM
- [ ] If off‑menu returns **ambiguous**, allow LLM fallback (if enabled)
- [ ] Do not short‑circuit to escalation immediately

### 7) Earlier Exit Pills
- [ ] Show exit pills at attempt ≥ 2 OR after repeated hesitation
- [ ] Exit pills: “None of these” / “Start over”

### 8) Telemetry Checks
- [ ] `clarification_offmenu_attempts` increments only on true failures
- [ ] `clarification_llm_called` logged on fallback
- [ ] `clarification_llm_decision` + `choiceIndex` present
- [ ] `clarification_exit_pill_selected` logged on exit pill use

### 9) UX Regression Tests
- [ ] “hmm / i don’t know” → soft prompt, no escalation
- [ ] “not that” → stays in context
- [ ] “the first option” → selects immediately
- [ ] “the one about panel d” → LLM selects (if enabled)
