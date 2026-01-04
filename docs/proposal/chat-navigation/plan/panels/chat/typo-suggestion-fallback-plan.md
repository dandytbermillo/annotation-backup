# Chat UX Plan: Typo → Suggestion Fallback

**Date:** 2026-01-04  
**Status:** Draft (Ready for Implementation)  
**Scope:** Chat fallback messaging when intent parsing fails due to typos

---

## Problem

Current fallback responses explicitly say “typo” and dump a long list of commands.  
This is jarring and unhelpful, especially for voice input and casual users.

---

## Goal

Replace “typo” error messaging with a **polite clarification + suggestions** flow:
- Ask a question when there’s a likely match
- Offer clickable suggestions
- Keep responses short and conversational

---

## Desired Behavior

### Case A — High‑confidence single match

**Input:** `quikk links`  
**Response:**  
“Did you mean **Quick Links**? I can open it or list it here.”  
Buttons: `Open Quick Links`, `List in chat`

### Case B — Multiple close matches

**Input:** `quik`  
**Response:**  
“Did you mean **Quick Links** or **Quick Capture**?”  
Buttons: `Quick Links`, `Quick Capture`

### Case C — Low confidence

**Input:** `qk lk`  
**Response:**  
“I’m not sure what you meant. Try: `quick links`, `recent`, or `workspaces`.”

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
