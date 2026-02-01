# Routing Order & Priority Plan (Unified)

**Status:** Draft  
**Owner:** Chat Navigation  
**Scope:** Global routing order — resolves priority conflicts between plans  

## Why This Exists

We now have multiple correct mini‑plans (clarification, stop‑scope, interrupt‑resume, known‑noun routing).  
Most of the “random” behavior in screenshots comes from **priority conflicts** between them.  
This plan defines a single, canonical routing order so the system behaves deterministically.

---

## Core Principles

1. **Stop / cancel is highest priority**  
   Avoids loops and accidental execution.

2. **Interrupt commands execute immediately**  
   New topic commands should not be blocked by active clarification.

3. **Clarification logic only runs when options are active**  
   Ordinals, repair, return‑cue are scoped to active/paused lists.

4. **Known‑noun commands should execute before docs**  
   Prevent noun‑only inputs from being hijacked by docs.

5. **Docs routing is last resort**  
   Only when input is informational or explicitly doc‑intent.

---

## Canonical Routing Order (Priority Chain)

### Tier 0 — Hard Interrupts / Safety
1. **Explicit stop / cancel (clarification active)**  
   - “cancel this”, “stop this”, “start over”  
   - Hard‑exit, pause snapshot with `pausedReason: 'stop'`

2. **Ambiguous stop / cancel (clarification active)**  
   - “stop”, “cancel”  
   - Confirm exit (keep options visible)

3. **Stop with no active clarification**  
   - Respond: “No problem — what would you like to do instead?”

---

### Tier 1 — Return / Resume / Repair (if snapshot exists)
4. **Return‑cue (paused list)**  
   - Deterministic cues → restore list  
   - LLM fallback → **constrained** to `return / not_return` only; if low confidence → ask (confirm), not execute

5. **Ordinal / label on paused list**  
   - If pausedReason = `interrupt`: allow ordinals **only if** an explicit return cue was given **or** the paused list is the only plausible list (no other list context active)  
   - If pausedReason = `stop`: block ordinals (“list was closed…”)

**Post‑action selection gate (anti‑garbage guard):**  
The post‑action selection window must only run when the input is **selection‑like**:  
- contains a recognized ordinal (first/second/third/1/2/3/last), **or**  
- exactly matches an option label, **or**  
- uniquely matches an option via **canonical token subset**, **or**  
- uniquely matches an option via **label contains input**, **or**  
- uniquely matches via **badge/suffix** (e.g., panel D/E), **or**  
- is a return‑cue already handled above.  
Otherwise, **skip post‑action selection** and fall through to normal routing.  
This prevents garbage input (e.g., “anel layot”) from being mis‑selected simply because a snapshot exists.

**Definition — “other list context active”:**
- Any other visible option pills in chat, or
- Any widget/panel showing a selectable list, or
- Another paused snapshot that has not expired

6. **Repair phrases (“not that”)**  
   - If paused list → guide to return cue  
   - If active list → repair in place

---

### Tier 2 — New Topic / Interrupt Commands
7. **Clear command with verb**  
   - “open recent”, “show widget demo”  
   - Execute immediately, pause active list

8. **Known‑noun interrupt (noun‑only, active list only)**  
   - If a clarification list is active and input is an **allowlisted known noun** (Tier 4) **without a verb**,  
     treat it as an interrupt command **only when**:  
     - it does **not** overlap the active list’s option labels, and  
     - it is **not** a question signal.  
   - Action: pause the active list and execute the known‑noun command.  
   - Rationale: enables power‑user noun commands (“widget manager”) to break out of an unrelated active list.

---

### Tier 3 — Clarification (active list only)
9. **Response‑Fit classifier / deterministic selection**  
   - Ordinals, label match, off‑menu mapping  
   - LLM fallback (constrained) only if enabled
    - **Runs only when** `activeOptionSetId != null` (don’t bind to old visible pills in history)
    - **Skip if** `isNewQuestionOrCommandDetected === true` (interrupt wins over clarification)

**Soft‑active window (short‑term list stickiness):**  
If `activeOptionSetId == null` but **lastOptionsShown** is still within a short TTL and the input is **selection‑like** (as defined above), treat the list as *soft‑active* for selection‑only routing.  
This preserves “panel d/e” and “the other one” immediately after an action while still preventing binding to ancient history.

**Selection‑like shorthand resolution:** use deterministic **unique** matching first; only fall back to LLM if deterministic matching cannot resolve uniquely (see `grounding-set-fallback-plan.md`).

---

### Tier 4 — Known‑Noun Commands (global)
10. **Known‑noun allowlist**  
   - “links panel”, “widget manager”  
   - Execute deterministically  

**Rule:** If a known‑noun command executes while a paused snapshot exists, the snapshot remains paused (no implicit resume). Subsequent ordinals should bind only to the new command’s UI list (if any).

11. **Unknown noun fallback**  
   - Ask: “Open or Docs?” + “Did you mean ___?” if near‑match

---

### Tier 5 — Docs / Informational Routing
12. **Question signals**  
   - “what is…”, “how do I…”  
   - Route to docs/help

---

## Notes on Conflicts

- **Stop always wins** over new topic or ordinals.  
- **New topic commands win** over clarification selection (interrupt).
- **Known noun commands should run before docs**, but after stop/interrupt.

## Why This Matters (Human Feel)

This routing order prevents “random” behavior where different handlers win on different turns.
By enforcing a single priority chain, the assistant behaves predictably:

- Stop/cancel never accidentally triggers docs or selection
- Interrupt commands execute immediately without forcing the user to finish a list
- Ordinals only bind when the context is unambiguous (explicit return or single list)

This is the core of the ChatGPT/Cursor “human” feel — consistent priorities instead of hidden state.

---

## Acceptance Tests (Priority Conflict Resolution)

1. Stop + active list → confirm prompt (not noun routing)  
2. “open recent” while list active → executes + pauses list  
2b. “widget manager” while list active → executes + pauses list (noun‑only interrupt)  
3. “links panel” (no verb, no list) → executes, not docs  
4. “what is links panel?” → docs  
5. “second option” after stop → blocked, ask for return cue  
6. “back to options” after stop → restore list  
7. After opening Links Panel D, input “panel e” → opens Links Panel E (soft‑active, unique match)  
