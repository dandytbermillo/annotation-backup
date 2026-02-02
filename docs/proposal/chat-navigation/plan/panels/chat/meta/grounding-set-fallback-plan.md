# Grounding-Set Fallback Plan (General, Non-List)

Status: Draft
Owner: Chat Navigation
Last updated: 2026-02-01

## Change Log (Recent Tweaks)
- Added multi‑list early guard to Decision Flow (ask which list before matching).
- Defined soft‑active TTL as 2 turns (deterministic).
- Restricted badge tokens to cases where UI displays badge letters.

## Purpose
Provide a general fallback that uses a small, explicit "grounding set" when deterministic routing fails. This prevents dead-end replies and avoids hallucinations by constraining the LLM to known candidates.

Lists are just one kind of grounding set; this plan works whether or not a list is present.

## Goals
- Avoid dead-end responses like "I'm not sure what that refers to" when the system has enough local context.
- Constrain the LLM to known candidates so it can only select valid targets or ask a focused clarifying question.
- Work without any active UI list (not list-specific), while still supporting list-based selection when lists are present.

## Non-Goals
- Replacing existing deterministic routing tiers.
- Allowing the LLM to invent new commands, targets, or labels.
- Long multi-turn clarifications; keep to one grounded question.

## Definitions
- Grounding set: a small, explicit candidate list derived from local context.
  - Visible/active options (if any)
  - Paused snapshot options (if any)
  - Active widget lists (if multiple widgets expose options)
  - Recent referents (last_action, last_target, recent_entities)
  - Known system capabilities (open/search/create/explain) if no concrete targets

- Active option set: the single list currently intended for selection (if any).
- Multi-list context: two or more visible option lists (from widgets/panels) with selectable options.

## State Requirements (for multi‑widget lists)
Minimum state needed to implement multi‑list grounding:
- activeOptionSetId (nullable)
- activeWidgetId (nullable)
- openWidgets[] with { id, label, options[] }
- pausedOptionSet (optional) + pausedTTL (1–2 turns)

## Trigger
Run this fallback only when:
- deterministic routing yields no handler, and
- there is at least one grounding set with a bounded candidate list.

**Candidate size rule:**
- Non‑list grounding sets: 1–5 candidates
- List‑type grounding sets: allow up to 12 (or full list if already bounded by UI)

If no grounding set exists, ask for the missing slot (target/action/scope) rather than calling the LLM.

## Decision Flow
1) Build grounding sets (in order):
   - Active options (if activeOptionSetId != null)
   - Paused snapshot options (if any)
   - Active widget lists (if multiple widgets expose options)
   - Recent referents (last_action/last_target/recent_entities)
   - Capability set (open/search/create/explain)

**Clarification:** Active widget lists are derived from `openWidgets[]` (visible lists).  
Multi‑list context is computed **only** from visible widget lists, **not** from paused snapshots.

**Precedence note:** If a widget list is visible/open, prefer it over paused snapshots unless the user explicitly
returns to the paused list.

2) **Multi‑list early guard:** if multi‑list context exists and the input is selection‑like
   (ordinal/shorthand), ask “Which list do you mean?” and offer widget buttons or allow
   typing the widget name. Do **not** attempt deterministic matching.

3) If a **list-type grounding set** exists and a deterministic, **unique** selection-like match can be made:
   - Execute that option directly (no LLM call).

4) If **referent sets exist** (non-list, non-capability) and deterministic matching cannot resolve uniquely:
   - Call LLM with a constrained selection contract on **referent candidates only**.

5) Otherwise, if any **list-type** grounding set exists:
   - Call LLM with a constrained selection contract:
     - Must pick one candidate id OR return "need_more_info".
     - No free-form execution.

6) If LLM selects a candidate:
   - Execute that action deterministically.

7) If LLM returns need_more_info:
   - Ask a single grounded clarifier:
     - "Do you want to open X, search for X, or see docs?"

8) If LLM fails/timeout:
   - Ask the same grounded clarifier (no silent fallthrough).

9) If **no non-capability grounding set** exists and input is referent/selection-like:
   - Ask for the missing slot (target/action/scope) instead of routing to docs.

**Rationale:** capability sets always exist, so we only relax the selection-like gate for
referent sets. This avoids sending general informational queries to the LLM while still
resolving “open it / do that again” reliably.

## List-Aware Shorthand (when a list is the grounding set)
If the grounding set is a list (active or paused options), use deterministic unique matching to resolve
informal shorthand like:
- "panel d" / "panel e"
- "the other one"
- "the last option"

This is the core value: resolving natural shorthand **only** against the current option set.
If no list exists, the LLM should not invent a list—use the other grounding sets or ask a clarifier.

**Order of operations:** try deterministic unique matches first; use the LLM for shorthand only when
deterministic matching cannot resolve uniquely.

## Soft-Active Window (list stickiness)
If a list was just shown and the UI still displays it, allow a short-lived "soft-active" window
for shorthand inputs even if `activeOptionSetId` was cleared by an action. In this case, the
grounding set is the lastOptionsShown snapshot (TTL-limited).

**Soft‑active TTL:** 2 turns (deterministic; do not exceed).

**Tier‑3 compatibility note:** if Tier‑3 only runs when `activeOptionSetId != null`, then
selection‑like inputs during the soft‑active window must be routed through the grounding‑set
fallback (unique‑match only), or they will fall through and produce dead‑ends.

**Selection‑like definition (deterministic):**
- Ordinals: first/second/third/1/2/3/last
- Shorthand keywords: option/panel/item/choice/one
- Single‑letter badge tokens: only if the UI actually displays badge letters
- Unique token‑subset match against lastOptionsShown (unique‑only)

**Uniqueness invariant:** shorthand/contains/subset matches must resolve to a **single** option; otherwise ask a clarifier.

## Selection‑Like Detector (single source of truth)
Use the definition above wherever the plan says “selection‑like” (multi‑list early guard, deterministic matching,
soft‑active window routing). This ensures the same rules are applied consistently.

## Multi-Widget Ambiguity (multiple lists)
If more than one widget/panel list is open:
- **Do not guess** which list an ordinal **or shorthand** selection ("panel d", "the other one") refers to.
- Ask a direct, answerable question:
  - "I see multiple option lists open. Which one do you mean?"
  - Offer buttons for each widget list, or allow typing the widget name.

If the user explicitly references a widget ("Recent", "Settings widget") or a list label, bind the
ordinal to that widget’s list and execute.

**Precedence rule:** if multi‑list context exists, always ask which list **before** using the soft‑active snapshot.

### Paused list re‑anchor (after stop)
If `activeOptionSetId == null` and a paused list exists and the user uses an ordinal/shorthand:
- Do **not** ask "Which options are you referring to?"
- Respond: “That list was closed. Say ‘back to the options’ to reopen it — or tell me what you want instead.”

## LLM Contract (Constrained)
Input:
- userInput
- candidates: [{ id, label, type, actionHint? }]
- instructions: select one id or "need_more_info"

Output:
- decision: "select" | "need_more_info"
- choiceId?: string
- confidence: 0..1

## Safety Rules
- Never execute without a candidate id.
- Never allow LLM to generate new labels or commands.
- If candidates are empty, do not call the LLM.

## Telemetry
- grounding_set_built (type, size)
- grounding_llm_called / grounding_llm_timeout / grounding_llm_error
- grounding_llm_select / grounding_llm_need_more_info

## Acceptance Tests
1) No list, recent referent exists:
   - User: "Open it"
   - last_target = "Resume.pdf"
   - Expected: LLM selects Resume.pdf

2) No list, ambiguous referent:
   - User: "Do that again"
   - last_action ambiguous
   - Expected: LLM returns need_more_info → ask which action

3) No list, no referents:
   - User: "Fix it"
   - Expected: ask missing slot ("Fix what?")

4) List exists:
   - User: "panel e"
   - Candidates are the visible options
   - Expected: LLM selects the right option or asks clarifier

5) Soft-active list after action:
   - User: open D → immediately "panel e"
   - Candidates are lastOptionsShown (soft-active)
   - Expected: LLM selects E (or asks clarifier if ambiguous)

6) Multiple widgets open:
   - User: "first option"
   - Expected: ask which widget/list (no guessing)
   - After user picks a widget, apply the original ordinal to that widget’s list (do not reopen the widget)

7) Explicit widget reference:
   - User: "first option in Recent"
   - Expected: bind to Recent list and execute

8) Paused list ordinal re‑anchor:
   - User: stop → yes → "second option"
   - Expected: “That list was closed. Say ‘back to the options’ to reopen it…”

9) Large list candidate handling:
   - Active list has >5 options
   - Expected: grounding set uses list candidates (allow larger N for list-type sets)

## Integration Point
- Insert after deterministic routing has failed and before generic doc routing.
- Never runs when a deterministic handler has already selected or asked for clarification.

## Implementation Notes (Wiring)
- Treat this as the **final deterministic fallback** before docs.
- When `activeOptionSetId == null` but a soft‑active snapshot exists, route selection‑like inputs here.
- If multi‑list context exists, ask which list **before** applying soft‑active snapshot logic.
- If a unique match exists within the selected list, you may execute deterministically without LLM.
- Only call the LLM if deterministic selection‑like matching cannot resolve uniquely.

## Known Limitations
1. **Multi-widget guard is a no-op** — `openWidgets` is always `[]` until the UI supports multiple visible widget lists.
2. **Open widgets wiring** — blocked until the UI exposes `openWidgets[]` state to the chat routing layer.
