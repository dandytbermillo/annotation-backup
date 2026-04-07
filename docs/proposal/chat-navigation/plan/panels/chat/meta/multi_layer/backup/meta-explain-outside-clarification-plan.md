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

---

## Implementation Status (2026-01-10)

**Status:** ✅ IMPLEMENTED

### What Was Implemented

| Component | Status | Location |
|-----------|--------|----------|
| `isMetaExplainOutsideClarification()` | ✅ | `chat-navigation-panel.tsx:335-361` |
| `extractMetaExplainConcept()` | ✅ | `chat-navigation-panel.tsx:368-390` |
| Meta-explain handler | ✅ | `chat-navigation-panel.tsx:2113-2187` |
| Tier 1: Local cache | ✅ | `lib/docs/keyword-retrieval.ts:CORE_CONCEPTS` |
| Tier 2: DB retrieval | ✅ | `lib/docs/keyword-retrieval.ts` + `/api/docs/retrieve` |
| Last-message context inference | ✅ | Handler infers concept from last assistant message |

### Detection Coverage

| Phrase | Status |
|--------|--------|
| "explain" | ✅ |
| "what do you mean" / "what do you mean?" | ✅ |
| "explain that" | ✅ |
| "help me understand" | ✅ |
| "what is that" | ✅ |
| "tell me more" | ✅ |
| "explain <concept>" | ✅ |
| "what is <concept>" | ✅ |
| "what are <concepts>" | ✅ |

### Tier 1 Cache (CORE_CONCEPTS)

```typescript
home, dashboard, workspace, notes, note, recent,
widget, widgets, panel, drawer, navigator,
quick links, links overview, continue, widget manager
```

### Flow

```
User: "explain"
  ↓
isMetaExplainOutsideClarification() → true
  ↓
extractMetaExplainConcept() → null (no specific concept)
  ↓
Infer from last assistant message → "home"
  ↓
POST /api/docs/retrieve { query: "home", mode: "explain" }
  ↓
Tier 1: getCachedExplanation("home") → HIT
  ↓
Response: "Home is your main entry dashboard. It shows your widgets and quick links."
```

### Type Check

```
npm run type-check → PASS
```

### Related Implementation

This plan is integrated with `cursor-style-doc-retrieval-plan.md`:
- Uses the same `CORE_CONCEPTS` cache (Tier 1)
- Uses the same `/api/docs/retrieve` endpoint (Tier 2)
- Falls back to "Which part would you like me to explain?" on failure

### Database Status (2026-01-10)

- ✅ Migration `062_create_docs_knowledge` executed
- ✅ 19 documents seeded from `docs/proposal/chat-navigation/plan/panels/chat/meta/documentation/`
- ✅ Tier 1 cache returns instant responses for core concepts
- ✅ Tier 2 DB retrieval works with keyword scoring

### Acceptance Tests Ready

1. ✅ "explain" after "dashboard of Home" → "Home is your main entry dashboard..."
2. ✅ "explain workspace" → "A workspace is where your notes live..."
3. ✅ "explain links overview" → Uses DB retrieval
4. ✅ "explain" as first message → "Which part would you like me to explain?"
