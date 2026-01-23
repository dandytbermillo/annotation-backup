# Clarification With Pills — Off-Menu Input Handling Plan (v1)

## Goal
When pills are shown and the user types something not in the list, the system should:
- stay polite and helpful
- try to map the input to one of the options
- allow topic changes smoothly
- avoid infinite loops
- resolve in **≤ 3 turns** most of the time

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

### AttemptCount lifecycle
- Increment on off-menu input that is **not** mapped and **not** a hard exit.
- Reset when:
  - a selection is made, or
  - exit is invoked, or
  - routing changes topic (clarification cleared / new intent).

---

## Decision Policy (Order of Evaluation)

### A) Direct selection (existing)
Accept:
- exact label match
- ordinal (first/second/1/2)
- label contains input

If matched: select and proceed.

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

### E) Loop control
If `attemptCount >= 3`:
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

## Acceptance Tests
1. Options shown; input “settings please” → maps if only one option matches canonical tokens.  
2. Input “preferences” → re-ask A/B (no global synonym map).  
3. Input “show me my profile” → exit clarification and route normally.  
4. Input “idk” → re-show options.  
5. After 3 off-menu attempts → show exit options + 3–6 word prompt.  
6. Input “none of these” → exit clarification.  
7. Input “first” → selects first option.  
8. Input “link notesx” → re-show options (typo recovery).  
9. Input “Can you show me the settings?” → maps to Workspace Settings (not exit).  
10. Input “settings” when both options include a settings token → re-ask A/B (ambiguous).  
11. Input “manage settings” (overlaps both) → re-ask A/B; increment `attemptCount`.  

---

## Rollout
- Put behind an optional feature flag.
- Start with `attemptCount` limit = 2 or 3.
- Expand alias allowlist only if telemetry shows need.
