# Suggestion Routing Unification Plan

**Status:** 📝 Draft  
**Owner:** Chat Navigation  
**Related:** `routing-order-priority-plan.md`, `suggestion-rejection-handling-plan.md`, `suggestion-confirm-yes-plan.md`

---

## 1) Purpose

Unify the **suggestion rejection** and **suggestion affirmation** flows into the same routing
dispatcher that now handles Tier 0–5, so routing decisions are made in **one canonical chain**.

This is intentionally **separate** from the routing-order plan to avoid scope creep and preserve
the currently stable Tier 0–5 order.

---

## 2) Goals

- Make suggestion reject/confirm part of the **dispatcher** (single routing spine).
- Preserve current behavior and output wording (no UX regressions).
- Keep existing analytics/debug events.
- Avoid breaking Tier 0–5 priority chain or clarification flows.

---

## 3) Non‑Goals

- Do not redesign suggestion UX.
- Do not change LLM model selection or system prompts.
- Do not refactor `/api/chat/navigate` or routing logic beyond relocating it.

---

## 4) Current Problem

Two routing decisions still live **inline** in `sendMessage()`:

1. **Suggestion rejection** (`lastSuggestion && isRejectionPhrase`)
2. **Suggestion affirmation** (`lastSuggestion && isAffirmationPhrase`)

These short‑circuit the dispatcher, so routing is **not** fully unified yet.

---

## 5) Proposed Tier Placement (Revised)

Suggestion handling should **not** override stop/cancel or explicit command interrupts.
Place suggestion handling **after** stop/return/interrupt tiers, or keep it pre‑tiered with
explicit exclusions.

Recommended order:

```
Tier 0: Stop / Cancel
Tier 1: Return / Resume / Repair
Tier 2: Interrupt Commands (explicit verbs)
Tier S: Suggestion Reject / Affirm
Tier 3: Clarification (active list only)
Tier 4: Known‑Noun Commands
Tier 5: Docs / Informational
```

Alternative (if keeping Tier S‑0): add **exclusions** so suggestion handling only runs when
input is **not** a stop/cancel phrase and **not** an explicit command.

---

## 6) Dispatcher Context Additions

Dispatcher needs access to these fields currently local to `sendMessage()`:

**State**
- `lastSuggestion`
- `setLastSuggestion`
- `addRejectedSuggestions`
- `clearRejectedSuggestions`

**Environment / Routing** (only needed if dispatcher executes the API call)
- `sessionState`
- `visiblePanels`
- `focusedPanelId`
- `currentEntryId`
- `currentWorkspaceId`

**Utilities** (only needed if dispatcher executes the action)
- `openPanelDrawer`
- `openPanelWithTracking`
- `executeAction`

**Note:** Prefer keeping the dispatcher **routing‑only**. If so, it should return
`{ handled: true, action: 'affirm_suggestion', candidate }` and let `sendMessage()`
perform the `/api/chat/navigate` call and side‑effects.

---

## 7) Behavior Rules (unchanged)

### Suggestion Rejection
If user rejects a suggestion:
- Clear suggestion state
- Add rejection label(s)
- Respond with alternatives if available
- **Return handled** (do not fall through to other tiers)

### Suggestion Affirmation
If user affirms:

**Single candidate**
- Execute that candidate’s primary action
- If resolution returns options → show pills
- Clear suggestion state
- **Return handled**

**Multiple candidates**
- Respond with the candidate list (“Which one did you mean?”)
- Keep suggestion state until resolved
- **Return handled**

---

## 8) Implementation Steps

1. **Create a `handleSuggestionRouting()` helper** in `lib/chat/routing-dispatcher.ts`
2. **Place it at Tier S** (after stop/return/interrupt, before clarification)
3. **Move inline blocks** from `chat-navigation-panel.tsx` into the dispatcher:
   - Rejection branch
   - Affirmation branch (routing decision only)
4. **Return action** to `sendMessage()` (routing‑only); execute API call there
5. **Wire minimal context** fields from §6 (state + candidate list)
6. **Remove inline checks** in `sendMessage()`

---

## 9) Acceptance Tests

### S1 — Reject suggestion
Input: “no” when lastSuggestion exists  
Expected: suggestion state cleared; rejection response; no other routing

### S2 — Affirm suggestion (single candidate)
Input: “yes” when lastSuggestion has one candidate  
Expected: execute that candidate (panel opens or action executes)

### S3 — Suggestion shouldn’t bypass stop
Input: “stop” with lastSuggestion present  
Expected: stop‑scope logic wins (confirm or drop)

### S4 — Suggestion shouldn’t bypass interrupt
Input: “open recent” with lastSuggestion present  
Expected: interrupt command executes; suggestion ignored

### S5 — Affirmation (multi‑candidate)
Input: “yes” when lastSuggestion has multiple candidates  
Expected: “Which one did you mean?” + candidate list; suggestion state preserved

---

## 10) Notes / Risks

- Keep dispatcher routing‑only to avoid a large context surface area.
- Ensure suggestion handling does **not** preempt stop/interrupt tiers.
- If stop/interrupt fires while a suggestion is active, clear `lastSuggestion` to avoid stale confirm/reject on the next turn.

---

## 11) Status

**Draft.** Implement after current routing‑order spine is stable and tests are green.
