# Clarification Interrupt & Resume — Addendum

**Purpose:** Define how the system should behave when a user interrupts an active selection flow
(pills visible) with a new command, and how/when it should allow returning to the old list.

---

## Core Rule: Interrupts Pause the List

When a **clear new‑topic command** is detected (e.g., “open recent”, “show workspaces”) while a
selection list is active:

- Execute the new command immediately.
- **Pause** the previous list (do not keep it implicitly active for selection).
- Keep the previous list in **short‑term memory** for potential return.

This matches human/ChatGPT/Cursor behavior: interrupt → execute → wait for a return signal.

---

## Guard: No Silent Return to Old List (With One‑Turn Grace)

After an interrupt/new‑topic command, **ordinals/labels should not resolve against the old list**
unless the user **explicitly signals return**.

**One‑turn grace (human‑friendly):** If the *very next* user message after the interrupt is an
ordinal or an exact label reference, treat it as an implicit return and resolve against the paused
list. After that single turn, require an explicit return cue.

### Valid return signals
- “back to the panels”
- “continue that list”
- “the other one from before”
- “go back to the options”
- Reusing the exact list label with a return cue (“back to links panels”)

Without a return signal, treat ordinals/labels as new input in the current context.

**Labels without return cues:**
- Default: **do not** resume on a bare label alone.
- Optional exception (safe): allow resume only if the input **exactly** matches a paused option label
  (no fuzzy match), and that label is unambiguous.

---

## No Automatic Expiry on Unrelated Commands

Do **not** clear a paused list just because the user issued unrelated commands.
The paused list should remain available until one of these happens:
- the user explicitly exits (confirmed stop/cancel), or
- a new list replaces it.

---

## Recommended State Fields (Optional)

To keep implementations consistent (without changing behavior), consider explicit state fields:
- `activeOptionSetId` (nullable) — id of the currently visible list
- `pausedOptionSetId` + `pausedOptions[]` — last paused list after interrupt
- `pausedTurnsRemaining` (optional) — only if you intentionally add a time/turn expiry
- `pausedReason = "interrupt"` — why the list was paused

These can be mapped to existing fields (e.g., `lastClarification.messageId`, `clarificationSnapshot`).

---

## Acceptance Tests

1) **Interrupt**
   - List shown: Links Panel D/E/Panels
   - User: “open recent”
   - Expected: Open Recent immediately; list is paused

2) **Implicit return (one‑turn grace)**
   - After interrupt, user says: “second option”
   - Expected: Resume the paused list and select the second item.

3) **No return signal (after grace)**
   - After interrupt, user says: “second option”
   - Then user says: “second option” again (without a return cue)
   - Expected: “Which options are you referring to? You can say *‘back to the options’* to continue choosing.”
     Do **not** select from old list.

4) **Explicit return**
   - After interrupt, user says: “back to the panels”
   - Expected: Restore the paused list and allow selection

5) **Return + ordinal**
   - After interrupt, user says: “continue that list — second option”
   - Expected: Select second item from the restored list

6) **Repair after interrupt**
   - After interrupt, user says: “not that”
   - Expected: **Do not** restore the paused list and **do not** route into unrelated doc/notes disambiguation.
   - Respond with a neutral cancel/clarify prompt (e.g., “Okay — what would you like to do instead?” or
     “Which action are you referring to?”).
   - Only target the paused list if a return cue is present (e.g., “not that — back to the panels”).

7) **Paused list persists across unrelated commands**
   - After interrupt, user issues other unrelated commands (e.g., “open recent”, “open widget demo”).
   - Later user says: “back to the options — second option”.
   - Expected: Paused list is still available and selection resolves correctly.

---

## Reference Integration

This addendum should be referenced from:
- `clarification-response-fit-plan.md` (New Topic / Interrupt handling section)
- Implementation guide (routing integration notes)
