# Chat UX Plan: Typo → Suggestion Fallback

**Date:** 2026-01-04
**Status:** Implemented (Partial — see Known Issues)
**Scope:** Chat fallback messaging when intent parsing fails due to typos

---

## Problem

Current fallback responses explicitly say "typo" and dump a long list of commands.
This is jarring and unhelpful, especially for voice input and casual users.

---

## Goal

Replace "typo" error messaging with a **polite clarification + suggestions** flow:
- Ask a question when there's a likely match
- Offer clickable suggestions
- Keep responses short and conversational

This avoids saying "typo" and keeps the conversation natural.

---

## Recommended Behavior (Simple + Friendly)

### Case A — High‑confidence single match

If the typo layer finds one strong candidate, ask for confirmation (or offer an action button), instead of saying "typo."

**Input:** `quikk links`
**Response:**
"Did you mean **Quick Links**? I can open it or list it here."
Buttons: `Open Quick Links`, `List in chat`

### Case B — Multiple close matches

If two candidates are close, ask which one:

**Input:** `quik`
**Response:**
"Did you mean **Quick Links** or **Quick Capture**?"
Buttons: `Quick Links`, `Quick Capture`

### Case C — Low confidence

If there's no strong match, show a short suggestion list (not the full help wall):

**Input:** `qk lk`
**Response:**
"I'm not sure what you meant. Try: `quick links`, `recent`, or `workspaces`."

---

## Rules

1. **Never say “typo.”**  
2. **Never show the full help list** in typo fallback.  
3. **Ask a question if there is a strong candidate.**  
4. **Offer at most 3–4 suggestions.**

---

## Decision Logic (Deterministic)

Input → candidate matches (from closed vocabulary):

| Condition | Action |
|----------|--------|
| One strong candidate (score ≥ 0.90) | Ask confirmation + 2 action buttons |
| Two candidates close (score gap < 0.08) | Ask which one + buttons |
| Otherwise | Short suggestion list |

Scoring can reuse existing typo normalization logic:
- Exact / normalized match = 1.00  
- 1–2 edit distance = high (0.90–0.95)  
- Otherwise = low confidence

---

## Suggested Copy (Standardized)

**Confirm single:**  
“Did you mean **{Command}**? I can open it or list it here.”

**Multiple:**  
“Did you mean **{Command A}** or **{Command B}**?”

**Low confidence:**  
“I’m not sure what you meant. Try: `{cmd1}`, `{cmd2}`, `{cmd3}`.”

---

## UI Requirements

- Suggestion buttons use existing pill UI.
- `Open` vs `List in chat` uses existing intent routing rules.
- Keep button count ≤ 3.

---

## Integration Points

- **Fallback path** in chat navigation panel (typo/unsupported handling)
- Uses existing closed command vocabulary (no new intents required)

---

## Acceptance Criteria

- No responses include the word “typo”.
- High‑confidence misspellings prompt for confirmation.
- Multiple possible matches prompt for disambiguation.
- Low confidence response suggests 3–4 commands max.
- Response length under 2 lines when possible.

---

## Manual Test Checklist

1. Input: `quikk links`  
   → Confirm suggestion with action buttons.
2. Input: `quik`  
   → Ask between Quick Links / Quick Capture.
3. Input: `qk lk`  
   → Short suggestion list, no command wall.
4. Input: `workspces`  
   → Confirm “Workspaces”.

---

## Notes

- This plan intentionally avoids LLM changes.
- It improves UX even when LLM classification fails.

---

## Implementation Direction

**Where to implement (location in code):**

1. **Typo/normalization fallback** — In the API route (`app/api/chat/navigate/route.ts`), before the "unsupported intent" response is returned.

2. **Suggestion generation** — In `lib/chat/typo-suggestions.ts`, which uses Levenshtein distance to match against a closed vocabulary.

3. **UI rendering** — In `components/chat/chat-navigation-panel.tsx`, which renders suggestion pills/buttons based on `message.suggestions`.

**Key implementation details:**

- If the input has no verb AND is not an exact match, override the LLM response and show typo suggestions instead (prevents false actions).
- Exact matches like `home`, `recent`, `quick links` still pass through normally.
- If the input includes a verb (open, show, list, go, etc.), let the LLM handle it.

---

## UI Implementation Note (Observed Issue + Fix)

**Issue:** The dashed "List in chat" badge can look disabled in dark mode because the outline variant uses a dark text color.
**Fix:** Force a readable text color on that badge (e.g., add `text-foreground` or `text-white` to the outline badge class).
**Why:** This is a visual clarity fix only; the button is not actually disabled.

---

## Known Issues

1. **Short inputs like "quik" don't match well.**
   - "quik" vs "quick links" → Levenshtein distance ~7, score ~0.36 (below 0.5 threshold)
   - **Fix needed:** First-word matching for short inputs (compare "quik" vs "quick" instead of full phrase)

2. **Case B (multiple matches) not fully testable.**
   - The plan shows "Quick Capture" as a second option, but it's not in the current vocabulary.
   - Either add "Quick Capture" to vocabulary or update the plan example.

---

## Files Changed

- `lib/chat/typo-suggestions.ts` — Fuzzy matching logic with Levenshtein distance
- `app/api/chat/navigate/route.ts` — Calls `getSuggestions()` on unsupported intents + no-verb guard
- `components/chat/chat-navigation-panel.tsx` — Renders suggestion pills with dual-action buttons
- `lib/chat/chat-navigation-context.tsx` — Added `ChatSuggestions` and `SuggestionCandidate` types
- `lib/chat/index.ts` — Exports for new types
