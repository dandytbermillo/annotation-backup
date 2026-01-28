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

## Guard: No Silent Return to Old List

After an interrupt/new‑topic command, **ordinals/labels should not resolve against the old list**
unless the user **explicitly signals return**.

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

## Expiry (Silent)

If the user continues the new topic for 2–3 turns, the paused list expires silently.
No announcement is needed.

---

## Recommended State Fields (Optional)

To keep implementations consistent (without changing behavior), consider explicit state fields:
- `activeOptionSetId` (nullable) — id of the currently visible list
- `pausedOptionSetId` + `pausedOptions[]` — last paused list after interrupt
- `pausedTurnsRemaining` (2–3) — optional expiry counter if you use turn limits
- `pausedReason = "interrupt"` — why the list was paused

These can be mapped to existing fields (e.g., `lastClarification.messageId`, `clarificationSnapshot`).

---

## Acceptance Tests

1) **Interrupt**
   - List shown: Links Panel D/E/Panels
   - User: “open recent”
   - Expected: Open Recent immediately; list is paused

2) **No return signal**
   - After interrupt, user says: “second option”
   - Expected: Do **not** select from old list; treat as new input

3) **Explicit return**
   - After interrupt, user says: “back to the panels”
   - Expected: Restore the paused list and allow selection

4) **Return + ordinal**
   - After interrupt, user says: “continue that list — second option”
   - Expected: Select second item from the restored list

5) **Repair after interrupt**
   - After interrupt, user says: “not that”
   - Expected: Apply repair to the **current topic**, not the paused list.
   - Only target paused list if a return cue is present (e.g., “not that — back to the panels”).

---

## Reference Integration

This addendum should be referenced from:
- `clarification-response-fit-plan.md` (New Topic / Interrupt handling section)
- Implementation guide (routing integration notes)
