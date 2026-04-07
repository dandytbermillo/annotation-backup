# Clarification Exit + Cancel Fix (Minimal Plan)

## Goal
Ensure clarification mode can be exited cleanly when the user says “skip/cancel” or asks a new question, instead of falling into the generic typo fallback.

## Scope
- Small, localized change.
- No prompt changes.
- No schema changes.
- Only affects clarification-active flows.

## Problems Observed
1) **“skip”/“cancel” during clarification** triggers the generic fallback instead of exiting.
2) **New intent during clarification** (e.g., “where am I?”) remains trapped in clarification mode or falls to fallback instead of answering the new question.

## Fix Strategy
Add two explicit exits while clarification is active:

1) **Cancel path**
   - Treat `skip`, `cancel`, `never mind`, `stop` as explicit cancellation.
   - On cancel: clear `lastClarification`, clear pending options (if any), respond: “Okay—let me know what you want to do.”

2) **New intent path**
   - If input looks like a *new question/command* (question detector or explicit command), exit clarification and route normally.
   - This prevents “where am I?” from being forced through clarification flow.

## Implementation Steps
1) **Add cancel detection to clarification handler**
   - Extend the existing rejection matcher to include `skip`/`cancel` equivalents.
   - When matched: clear clarification state and return a short acknowledgment.

2) **Add new-intent escape hatch**
   - Before META/LLM interpretation, check `isNewQuestionOrCommand(input)`.
   - If true: clear clarification and continue with normal routing.

## Files to Touch
- `components/chat/chat-navigation-panel.tsx`

## Acceptance Tests
1) **Cancel**
   - Bot: “Which one—D or E?”
   - User: “skip” → Bot: “Okay—let me know what you want to do.” (clarification cleared)

2) **New question escape**
   - Bot: “Which one—D or E?”
   - User: “where am I?” → Bot answers location, no fallback, no clarification loop

3) **Normal clarification unaffected**
   - Bot: “Which one—D or E?”
   - User: “explain” → Bot explains, re-asks, clarification remains

## Rollback
Revert the added cancel and new-intent escape logic in `chat-navigation-panel.tsx`.

---

## Implementation Status (2025-01-09)

**Status:** IMPLEMENTED

### Changes Made

| Location | Change |
|----------|--------|
| `handleRejection()` (~line 1800) | Now clears `pendingOptions`, `pendingOptionsMessageId`, `pendingOptionsGraceCount` in addition to `lastClarification`. Updated message to "Okay — let me know what you want to do." |
| Tier 1b.5 (~line 1944) | Added new intent detection before META check. If `isNewQuestionOrCommand` is true, clears `lastClarification` and falls through to normal routing. |
| Tier 1c META check (~line 1960) | Now guarded with `lastClarification &&` to skip if already exited via new intent |
| Tier 2 LLM interpretation (~line 1974) | Wrapped in `if (lastClarification)` to skip if already exited via new intent |
| Escape hatch (~line 1861) | No longer clears `lastClarification`; resets `metaCount` to 0 instead, so "skip"/"cancel" can be handled by rejection check |

### Type-Check
```
npm run type-check → PASS
```

### Acceptance Tests Ready

1. **Cancel:** "skip" after options shown → clears clarification, responds "Okay — let me know what you want to do."
2. **New question escape:** "where am I?" during clarification → exits clarification, routes to normal LLM handling
3. **Normal clarification unaffected:** "explain" → META response, re-asks, clarification remains active
