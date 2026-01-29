# Clarification QA Checklist (Single‑Pass)

Run these tests in one session to validate the combined behavior from:
- `clarification-stop-scope-plan.md`
- `clarification-interrupt-resume-plan.md`
- `clarification-response-fit-plan.md`

---

## Results Template

Use this quick table to track pass/fail:

| Test | Result | Notes |
|------|--------|-------|
| A1   |        |       |
| A2   |        |       |
| A3   |        |       |
| A4   |        |       |
| A5   |        |       |
| B6   |        |       |
| B7   |        |       |
| B8   |        |       |
| B9   |        |       |
| C10  |        |       |
| D11  |        |       |
| E12  |        |       |
| E13  |        |       |

---

## A) Stop / Cancel Scope

1) **Stop during clarification (ambiguous)**
   - Trigger pills (e.g., “links panel”)
   - Input: `stop`
   - Expect: confirm prompt  
     “Do you want to cancel and start over, or keep choosing from these options?”
   - Reply: `yes`
   - Expect: “Okay — we’ll drop that. What would you like to do instead?”

2) **Stop during clarification (explicit)**
   - Trigger pills
   - Input: `cancel this`
   - Expect: immediate drop (no confirm)

3) **Stop with no active list (Priority 3)**
   - Ensure no pills visible
   - Input: `stop`
   - Expect: “No problem — what would you like to do instead?”

4) **Repeated stop suppression**
   - `stop` → confirm → `yes`
   - Within 2 turns: `stop`
   - Expect: “All set — what would you like to do?”

5) **Bare ordinal after stop**
   - `stop` → confirm → `yes`
   - Input: `second option`
   - Expect: “That list was closed. Say ‘back to the options’ to reopen it, or tell me what you want instead.”

---

## B) Interrupt / Resume

6) **Interrupt executes immediately**
   - Pills visible
   - Input: `open recent`
   - Expect: “Opening Recent…” (list paused)

7) **No auto‑resume after interrupt**
   - After interrupt, input: `second option`
   - Expect: “Which options are you referring to? You can say ‘back to the options’ to continue choosing.” (no old list resume)

8) **Explicit return resumes**
   - After interrupt, input: `back to the panels — second option`
   - Expect: selection from the paused list

9) **Repair after interrupt**
   - After interrupt, input: `not that`
   - Expect: neutral cancel/clarify prompt  
     (must NOT restore old list or show doc/notes disambiguation)

---

## C) Selection Persistence (Visible = Active)

10) **Multiple ordinals while list visible**
   - Trigger pills
   - Input: `first option` → opens first
   - Input: `second option` → opens second
   - Input: `third option` → opens third
   - Expect: all selections resolve while pills remain visible

---

## D) Return‑Signal Edge

11) **Bare label without return cue**
   - After interrupt, input: exact label only (e.g., “Links Panel D”)
   - Expect: no resume unless label is exact full match and unambiguous (per addendum)

---

## E) Noise / Hesitation Sanity

12) **Noise**
   - Input: `asdf` or `🎉🎉`
   - Expect: unparseable prompt, no selection

13) **Hesitation**
   - Input: `hmm` or `idk`
   - Expect: soft prompt, no attempt increment
