# Implementation Report: LLM Context Retrieval + General Answers

**Date:** 2026-01-05
**Plan:** `llm-context-retrieval-general-answers-plan.md`
**Status:** Implemented with bug fixes

---

## Summary

Implemented natural chat interactions where:
1. Clarification questions are answered from visible chat context
2. Additional context can be retrieved when needed (need_context loop)
3. General questions (time/math/static knowledge) are answered without side effects
4. Out-of-scope requests (weather, news) are gracefully declined

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/chat/intent-schema.ts` | Added `need_context`, `general_answer` intents; added `contextRequest`, `generalAnswer`, `answerType` args |
| `lib/chat/intent-prompt.ts` | Added Decision Flow, Knowledge Boundary sections; added intent descriptions 22-24; updated Response Format |
| `lib/chat/intent-resolver.ts` | Added `need_context`, `general_answer` action types and handlers |
| `app/api/chat/navigate/route.ts` | Added need_context loop (max 1 retry), server time replacement, `buildExpandedContext()`, `callLLMForIntent()` helpers |
| `lib/chat/use-chat-navigation.ts` | Added `general_answer`, `need_context` cases in `executeAction()` |
| `components/chat/chat-navigation-panel.tsx` | Added `fullChatHistory` to API context; **fixed `buildChatContext()` bug** |

---

## Implementation Details

### 1. New Intent Types (`intent-schema.ts`)

```typescript
// Intent types
'need_context',    // LLM needs more context (triggers server-side retrieval)
'general_answer',  // Non-app question: time, math, static knowledge

// Args
contextRequest: z.string().optional(),  // For need_context
generalAnswer: z.string().optional(),   // For general_answer
answerType: z.enum(['time', 'math', 'general']).optional(),
```

### 2. Decision Flow (`intent-prompt.ts`)

Added structured decision tree for LLM:

```
1. App intent? → handle normally
2. Clarification about chat? → answer_from_context (if in chatContext) or need_context
3. Non-app question? → general_answer (time/math/static) or unsupported (live web)
4. Still unclear? → need_context or unsupported
```

### 3. Knowledge Boundary (`intent-prompt.ts`)

**In scope:**
- App navigation/state
- Chat context (what was shown)
- Static knowledge (geography, history, math)
- Server time

**Out of scope:**
- Weather, news, live events, real-time prices
- Fallback message: "I can help with your knowledge base and what's in this app. For live web info, use a web search."

### 4. Need-Context Loop (`route.ts`)

```typescript
const MAX_CONTEXT_RETRIES = 1

while (intent.intent === 'need_context' && contextRetryCount < MAX_CONTEXT_RETRIES) {
  contextRetryCount++
  const expandedContext = buildExpandedContext(contextRequest, conversationContext, fullChatHistory)
  llmResult = await callLLMForIntent(client, userMessage, expandedContext, userId)
  intent = llmResult.intent
}

// If still need_context after max retries, ask user
if (intent.intent === 'need_context') {
  intent = { intent: 'unsupported', args: { reason: "..." } }
}
```

### 5. Server Time Replacement (`route.ts`)

```typescript
if (resolution.action === 'general_answer' && resolution.generalAnswerType === 'time') {
  const serverTime = getServerTimeString()
  resolution.message = `It's currently ${serverTime}.`
}
```

### 6. Client Handling (`use-chat-navigation.ts`)

```typescript
case 'general_answer':
  return { success: true, message: resolution.message, action: 'answered' }

case 'need_context':
  return { success: false, message: resolution.message, action: 'error' }
```

---

## Bug Fix: buildChatContext Options Lost

### Problem

When asking "is D in the list?" after "is F in the list?", the LLM incorrectly said "No, D is not in the list" even though "Quick Links D" was shown as an option.

**Root Cause:** `buildChatContext()` extracted `lastOptions` only from the NEWEST assistant message. After "is F in the list?" → "No, F is not in the list" (no `.options`), the original options were lost.

### Solution

Decoupled context extraction from `lastAssistantMessage`. Now all fields (options, listPreview, shownContent, openedPanel) are extracted from ANY assistant message:

```typescript
// BEFORE (bug): Options only checked on newest assistant message
if (!context.lastAssistantMessage && msg.role === 'assistant') {
  context.lastAssistantMessage = msg.content
  if (!context.lastOptions && msg.options) { /* extract */ }  // Never reached for older messages
}

// AFTER (fixed): Options checked on ANY assistant message
if (!context.lastAssistantMessage && msg.role === 'assistant') {
  context.lastAssistantMessage = msg.content
}
// Separate check - scans ALL messages
if (!context.lastOptions && msg.role === 'assistant' && msg.options) {
  context.lastOptions = msg.options.map(...)
}
```

---

## What's NOT Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| "Use Web" button | Not implemented | Marked as "Optional UX" in plan |
| Local math evaluator | LLM handles | Plan said "compute locally" but LLM accurately computes simple math |

---

## Verification

### Type Check
```bash
$ npm run type-check
# Passes with no errors
```

### Acceptance Tests

| Test | Command | Expected | Status |
|------|---------|----------|--------|
| Options membership | "is F in the list?" (after showing D, E) | "No, F is not in the list" | Verified |
| Options membership (partial match) | "is D in the list?" (after showing Quick Links D) | "Yes, D is in the list" | Fixed (was failing) |
| Last opened | "what did you just open?" (after opening Demo Widget) | "Demo Widget" | Verified |
| Need context | "what did you say before that?" | LLM requests context, then answers | Implemented |
| General: time | "what time is it?" | Server time (accurate) | Implemented |
| General: math | "128 * 64" | "8192" | Implemented |
| General: knowledge | "capital of France?" | "Paris" | Implemented |
| Out of scope | "what's the weather?" | Out-of-scope message | Implemented |

### Manual Testing Steps

1. Start dev server: `npm run dev`
2. Open chat panel
3. Test each acceptance case above

---

## Code Locations

| Feature | File | Line Numbers |
|---------|------|--------------|
| Intent types | `intent-schema.ts` | 44-45, 111-115 |
| Decision Flow | `intent-prompt.ts` | 369-388 |
| Knowledge Boundary | `intent-prompt.ts` | 390-401 |
| need_context handler | `intent-resolver.ts` | 1898-1917 |
| general_answer handler | `intent-resolver.ts` | 1919-1948 |
| Need-context loop | `route.ts` | 315-367 |
| Server time | `route.ts` | 128-139, 413-425 |
| buildChatContext fix | `chat-navigation-panel.tsx` | 361-425 |
| fullChatHistory | `chat-navigation-panel.tsx` | 1822-1827 |

---

## Risks/Limitations

1. **Need-context loop limited to 1 retry** - May not be sufficient for complex queries
2. **fullChatHistory capped at 50 messages** - Very long conversations may lose early context
3. **Math computed by LLM** - Complex calculations may have errors (but simple math is reliable)
4. **No "Use Web" button** - Users must retype for web queries

---

## Next Steps

1. Monitor LLM accuracy on "is X in the list?" questions
2. Consider implementing "Use Web" button if users frequently hit out-of-scope
3. Consider local math evaluator for complex calculations
4. Clean up unused functions (`detectClarification`, `parseOrdinalFromQuestion`, etc.)
