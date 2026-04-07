# LLM Context Retrieval + General Answers Plan

## Goal
Make chat feel natural by:
1) answering clarification questions from visible chat context,
2) retrieving additional context when needed, and
3) allowing safe general questions (time/math/general knowledge) when the message isn’t an app command.

## User Problem
The assistant currently fails on:
- “is F in the list?” even though options are visible
- “what did you just open?” even though it was just shown
- non-app questions (“what time is it?”, “compute 127*48”) which should be answered easily

## High-Level Flow

1. **App intent?**
   - If the message maps to navigation or panel intents → handle normally.

2. **Clarification about chat/UI?**
   - If answer is in the chat context → respond with `answer_from_context`.

3. **Need more context?**
   - LLM returns `need_context` with requested info.
   - Server fetches the extra context and re-calls LLM.

4. **Still unclear?**
   - Ask the user a clarification question.

5. **Not app-related?**
   - Allow safe general answers (time/math/static knowledge) with no side effects.

---

## Knowledge Boundary (Policy)

**In scope (local knowledge)**
- App navigation + state (workspaces, entries, panels)
- Chat context (what was shown)
- Database content (notes, workspaces)

**Out of scope (external web data)**
- Weather, news, live events, real-time prices
- Anything requiring browsing or live updates

Fallback response for out-of-scope:
> “I can help with your knowledge base and what’s already in this app. For live web info, use Web.”

Optional UX: **Use Web** button
- When a request is clearly web-only, render a “Use Web” button next to the fallback.
- Clicking “Use Web” switches the request into web mode (one-off), instead of retyping.
  - This keeps the default local boundary intact and reduces confusion.

**Borderline cases (allowed):**
- “What time is it?” → server time
- “What’s 2+2?” → deterministic math
- “Capital of France?” → static knowledge (allowed)

---

## New Response Types

### 1) `need_context`
LLM can request additional context if chatContext is insufficient.
- args:
  - contextRequest: string (e.g., "last 5 assistant messages", "last preview list", "recent actions")

### 2) `general_answer`
For non-app questions.
- args:
  - generalAnswer: string
  - answerType: "time" | "math" | "general"

---

## Chat Context Bundle
Always send a **minimal structured context** with each LLM call:
- lastAssistantMessage
- lastUserMessage
- lastOptions (labels + sublabels)
- lastListPreview (title, count, items[])
- lastOpenedPanel
- lastErrorMessage

Bounded to recent messages only.

---

## Need-Context Retrieval Loop
1) LLM returns `need_context` (e.g., "last 10 messages").
2) Server fetches that data from chat history.
3) Re-call LLM with expanded context.
4) LLM returns `answer_from_context` or action.

Safeguards:
- One retry max (avoid loops)
- If still unclear, ask user

---

## General Answer Policy
If the message is **not** an app command and **not** a clarification about chat UI:

- **Time/date:** use server time (not LLM guess)
- **Math/logic:** compute locally
- **General knowledge:** LLM response (static, non-live)
- **External web info:** deny with the standard out-of-scope message

---

## Prompt Updates
Add rules:
- If the answer is in chatContext, return `answer_from_context`.
- If more context required, return `need_context`.
- If non-app question:
  - return `general_answer` for time/math/static knowledge
  - return `unsupported` with out-of-scope message for live web info

---

## Client Updates
- If response is `answer_from_context`, render message only.
- If response is `general_answer`, render message only.
- If response is `need_context`, client does nothing (server handles re-call).

---

## Server Updates
- Add `need_context` handling in navigate route:
  - fetch extra context
  - re-call LLM
- Add safe local evaluators for time/math

---

## Acceptance Tests
1) Options membership
   - Show Quick Links D/E
   - Ask: “is F in the list?” → “No, only D and E.”

2) Last opened
   - Open Demo Widget
   - Ask: “what did you just open?” → “Demo Widget.”

3) Need context
   - Ask: “what did you say before that?” → LLM requests more context → answers

4) General answer
   - “what time is it?” → server time
   - “128 * 64” → computed
   - “capital of France?” → static answer

5) Out of scope
   - “what’s the weather?” → out-of-scope message

---

## Files to Touch (expected)
- `lib/chat/intent-schema.ts` (add need_context, general_answer)
- `lib/chat/intent-prompt.ts` (rules + examples)
- `lib/chat/intent-resolver.ts` (pass-through)
- `app/api/chat/navigate/route.ts` (need_context loop + general answer routing)
- `components/chat/chat-navigation-panel.tsx` (render general_answer)
