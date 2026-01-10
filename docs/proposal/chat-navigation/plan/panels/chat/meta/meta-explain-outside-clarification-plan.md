# Meta-Explain Outside Clarification (Tiered Plan)

## Goal
Handle user follow-ups like “explain”, “what do you mean?”, or “explain home” **after a normal answer**, not just during clarifications. Provide a short, contextual explanation instead of falling back to generic “Try: …” responses.

## Scope
- Applies only when **no clarification is active**.
- Keeps clarification META flow unchanged.
- Uses a **tiered approach**: local cache for common concepts, LLM+glossary for long tail.

## Problem
After normal answers (e.g., “You’re on the dashboard of Home”), users who ask “explain” get a fallback. That feels robotic and breaks conversation flow.

---

## Tiered Strategy (Production Pattern)

### Tier 1 — Local Cache (fast, deterministic)
- Return a short explanation for **common app concepts**.
- Handles >80% of typical “explain” requests with no LLM call.

**Example cache entries**:
- Home: “Home is your main entry dashboard. It shows your widgets and quick links.”
- Workspace: “A workspace is where your notes live. You can create and edit notes there.”
- Recent: “Recent shows your most recently opened items in this entry.”

### Tier 2 — LLM + Compact Glossary (fallback)
- For “explain <unknown concept>” or “explain that” when Tier 1 can’t match.
- Send a **short glossary** (1–2 sentences per concept), not full docs.
- Constrain responses to 1–3 sentences.

---

## Behavior
When `lastClarification` is null and input matches a META‑explain phrase:

1. **Try Tier 1** (local cache).
2. If no cache hit → **Tier 2** (LLM + glossary).
3. If Tier 2 fails → “Which part would you like me to explain?”

---

## Detection Rules
### Meta‑Explain Phrases
- “explain”
- “what do you mean”
- “explain that”
- “help me understand”
- “explain <known‑concept>” (only for whitelisted concepts)

### Known Concepts (Tier 1 scope)
- home, dashboard, workspace, notes, recent, widget, panel

---

## Files to Touch
- `components/chat/chat-navigation-panel.tsx`
  - Add Tier 1 local explain cache
  - Add Tier 2 LLM fallback with glossary
- (Optional) `lib/chat/intent-prompt.ts`
  - Add short glossary constant (shared source of truth)

---

## Acceptance Tests
1) **Explain after location**
   - User: “Where am I?” → “You’re on the dashboard of Home.”
   - User: “explain” → “Home is your main entry dashboard…”

2) **Explain specific concept**
   - User: “explain workspace” → Short local explanation

3) **Explain unknown concept**
   - User: “explain links overview” → Tier 2 LLM response using glossary

4) **No prior assistant answer**
   - User: “explain” as first message → “Which part would you like me to explain?”

---

## Guardrails
- Never send full docs to the LLM — only compact glossary.
- Tier 2 response length capped (1–3 sentences).
- Keep Tier 1 cache derived from glossary to avoid drift.

---

## Rollback
Remove Tier 1 + Tier 2 handler and fall back to current behavior.
