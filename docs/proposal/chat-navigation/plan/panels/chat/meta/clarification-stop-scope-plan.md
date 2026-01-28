# Stop / Cancel Scope Resolution — Addendum

**Purpose:** Prevent “stop/cancel” loops by making stop actions scope‑aware and
blocking automatic resumption of prior lists.

---

## Core Rule: Stop Is Scope‑Bound

Treat stop/cancel as a **control utterance**, not a destination. Resolve it to the
**closest active scope** in priority order:

1) **Active execution** (e.g., “Opening Recent…”)  
   → **Deferred until cancellable execution exists.**  
   Rationale: `executeAction`/`selectOption` are fire‑and‑forget today; saying “Okay — stopped”
   would be misleading without real cancellation support.

2) **Active clarification UI** (pills visible / active selection)  
   → Drop the clarification (do not resume it automatically).  
   **Response:** “Okay — we’ll drop that. What would you like to do instead?”

3) **No active scope**  
   → Treat as general cancel.  
   **Response:** “No problem — what would you like to do instead?”

---

## Guard: No Auto‑Resume After Stop

After a confirmed stop/cancel, **do not automatically re‑show** the prior options
even if a previous intent is cached. Resumption must require **explicit return cues**:

- “go back to the panels”
- “continue the previous list”
- “the options from before”

Ordinals/labels without return cues should **not** resolve to the old list.

---

## Repeated Stop Suppression

If the user repeats a stop‑like input within **N turns** after a confirmed stop
(`stop`, `cancel`, `never mind`), **do not re‑confirm**. Acknowledge and stay idle:

**Response:** “All set — what would you like to do?”

Suggested default: `N = 2`.

**Suppression reset rule (important):**  
Reset the suppression counter on **any non‑exit input**, even if a new command
executes. This prevents suppression from leaking across unrelated actions
(e.g., “cancel this” → “open recent” → “stop” should **not** be suppressed).

---

## Explicit vs Ambiguous Stop (Clarified)
- **Ambiguous:** “cancel” / “stop” alone (with pills visible) → **confirm**.
- **Explicit:** “cancel this / cancel that / stop this / start over” → **hard‑exit** (no confirm).

This keeps accidental cancels safe while allowing fast exits.

---

## Acceptance Tests

1) **Stop during execution**
   - “Opening Recent…” visible  
   - User: “stop”  
   - Expected: “Okay — stopped.” (no list shown)

2) **Stop during clarification**
   - Pills visible  
   - User: “stop” → confirm  
   - User: “yes”  
   - Expected: “Okay — we’ll drop that. What would you like to do instead?”  
   - Old list is **not** restored automatically.
   - **Explicit stop phrasing** (“cancel this”, “stop this”, “start over”) → **no confirmation**, hard‑exit immediately.

3) **No auto‑resume**
   - After stop, user says “second option”  
   - Expected: ask what list they mean (do not select old list)

4) **Explicit return**
   - After stop, user: “go back to the panels — second option”  
   - Expected: resume list + select second option

5) **Repeated stop**
   - User: “stop” → confirm → “yes”
   - User: “stop” again within 2 turns  
   - Expected: “All set — what would you like to do?”

---

## Example Conversations (Expected UX)

### 1) Stop during execution
User: open recent  
Bot: Opening Recent…  
User: stop  
Bot: Okay — stopped.  
User: links panel  
Bot: Multiple Links Panel panels found. Which one would you like to open?  
[Pills]

### 2) Stop during clarification (ambiguous)
User: links panel  
Bot: Multiple Links Panel panels found. Which one would you like to open?  
[Pills]  
User: stop  
Bot: Do you want to cancel and start over, or keep choosing from these options?  
[Pills]  
User: yes  
Bot: Okay — we’ll drop that. What would you like to do instead?

### 3) Stop during clarification (explicit)
User: links panel  
Bot: Multiple Links Panel panels found. Which one would you like to open?  
[Pills]  
User: cancel this  
Bot: Okay — we’ll drop that. What would you like to do instead?

### 4) No auto‑resume after stop
User: links panel  
Bot: Multiple Links Panel panels found. Which one would you like to open?  
[Pills]  
User: stop  
Bot: Do you want to cancel and start over, or keep choosing from these options?  
[Pills]  
User: yes  
Bot: Okay — we’ll drop that. What would you like to do instead?  
User: second option  
Bot: Which options are you referring to?

### 5) Explicit return signal
User: links panel  
Bot: Multiple Links Panel panels found. Which one would you like to open?  
[Pills]  
User: open recent  
Bot: Opening Recent…  
User: back to the panels — second option  
Bot: Opening Links Panel D…

### 6) Repeated stop suppression
User: links panel  
Bot: Multiple Links Panel panels found. Which one would you like to open?  
[Pills]  
User: stop  
Bot: Do you want to cancel and start over, or keep choosing from these options?  
[Pills]  
User: yes  
Bot: Okay — we’ll drop that. What would you like to do instead?  
User: stop  
Bot: All set — what would you like to do?

---

## Reference Integration

Reference this addendum from:
- `clarification-response-fit-plan.md` (Execution Safety / Exit handling)
- Implementation guide (routing integration notes)
