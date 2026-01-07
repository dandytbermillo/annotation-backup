# Layered Chat Experience Plan (LLM + Deterministic)

## Goal
Create a conversational chat experience that is accurate, fast, and resilient by combining deterministic handling with LLM reasoning, while always using what the user already saw in chat.

## Principles (5 Patterns + Degradation)
1) **Structured context, not raw chat**
2) **Retrieval when needed** (one retry max)
3) **Local deterministic handlers** for obvious selections
4) **LLM for everything else** (clarifications, follow‑ups)
5) **Fail honest** when context is missing
6) **Graceful degradation**: if one layer fails, fall through to the next

## Layered Decision Flow

1. **Fast local selection**
   - If input is a clear selection (ordinals, option numbers, single-letter badges) AND options are present → select locally.

2. **LLM with chat context**
   - For everything else, send structured ChatContext to the LLM.
   - LLM answers with `answer_from_context`, requests more with `need_context`, or routes to standard intents.

3. **Need‑context retrieval loop**
   - If LLM returns `need_context`, fetch more chat history and re‑call once.

4. **App data retrieval (DB lookup)**
   - If question is about app data not shown in chat (widgets, workspaces, notes): retrieve from DB and respond.
   - Chat context wins if recent; otherwise fall back to DB.

5. **General answers (non‑app)**
   - Time → server time
   - Math → local compute (or LLM if trivial)
   - Static knowledge → LLM
   - Web/live data → out‑of‑scope message with optional “Use Web” button

6. **Fallback / honest response**
   - If still unclear: ask a clarification question.
   - If context missing: “I don’t see that in this chat. Want me to show it again?”

---

## Chat Context Bundle (Minimal + Structured)
- lastAssistantMessage
- lastUserMessage
- lastOptions (labels + sublabels)
- lastListPreview (title, count, items[])
- lastOpenedPanel
- lastErrorMessage

## Recency Decay (Configurable)
- Make decay configurable (e.g., defaults: **60s** or **last 10 messages**).
- Context-specific decay:
  - **Options** expire faster (shortest window)
  - **Opened panel** can persist longer
- If context is stale → treat as missing and ask user to re‑show.

## Explicit Handling Rules

### Selection-only guard (explicit patterns)
Only intercept input that fully matches one of these patterns:
- Ordinals: `first`, `second`, `third`, `last`
- Numeric: `1`, `2`, `3`, `4`, `5`
- Phrases: `the first one`, `the second one`, `option 2`, `number two`
- Single letters: `A`, `B`, `C`, `D`, `E` (only when options are letter‑tagged)

Everything else goes to the LLM with chat context.

### Membership questions
- “is X in the list?” → use lastOptions/lastListPreview.

### What just happened
- “what did you just open/show?” → use lastOpenedPanel/lastListPreview.

## answer_from_context vs general_answer
- **answer_from_context** → derived from ChatContext bundle (options, lists, last opened panel)
- **general_answer** → static knowledge / time / math (no chat context required)

---

## App Data Retrieval (DB Lookup)

### When to use
- The user asks about entities that exist in the app but were not shown in chat.
  - Example: “Do I have a Quick Links F widget?”

### LLM Signal
Add a new intent:

```
retrieve_from_app:
  entity_type: "widget" | "workspace" | "note" | "entry"
  query: "Quick Links F"
```

Future enhancement:
- Add `match_type: "exact" | "fuzzy"` and support fuzzy/semantic search for vague queries
  (e.g., “Do I have anything related to sales?”).

### Scoping / Permissions
- Retrieval must respect user scope (current user’s widgets/workspaces/notes only).

### Priority Rule
- **Chat context wins** if recent and relevant.
- Otherwise, use DB retrieval.

### Empty Result Response
- “I don’t see a widget called ‘Quick Links F’ in your workspace.”

### Latency Budget
- Chat context: <50ms
- DB retrieval: <300ms (show typing indicator)

---

## Knowledge Boundary
**In scope:** app state, chat context, DB content, static knowledge, math, time.
**Out of scope:** live web info (weather/news/prices).
Fallback: “I can help with your knowledge base and what’s in this app. For live web info, use a web search.”
Optional: “Use Web” button.

## Error Recovery
If the LLM call fails (timeout/500):
- Respond: “Something went wrong. Try again or rephrase.”
- Do not clear pending options unless explicitly selected.

## Expected UX Outcomes
- No dead ends: questions get answers, not walls.
- Faster selections: ordinals resolve instantly.
- Trustworthy responses: answers match visible chat context.
- Graceful degradation: if retrieval fails, ask user instead of guessing.

## Acceptance Tests
1) **Selection fast path**
   - Show options → “first” selects immediately.
2) **Membership question**
   - Show D/E → “is F in the list?” → “No, only D/E.”
3) **Last opened**
   - Open Demo Widget → “what did you just open?” → “Demo Widget.”
4) **Need context**
   - “what did you say before that?” → LLM requests context → answers.
5) **General question**
   - “what time is it?” → server time.
6) **Out of scope**
   - “what’s the weather?” → out-of-scope message (+ optional Use Web).
7) **Stale context**
   - Wait 2 minutes → “select the second one” → “I don’t see recent options. Want me to show them again?”
8) **LLM failure**
   - Simulate timeout → “Something went wrong. Try again or rephrase.”
9) **DB retrieval**
   - Widget exists but not shown in chat: “Do I have Sales Dashboard?” → “Yes, you have a widget called Sales Dashboard.”
   - Widget missing: “Do I have Quick Links F?” → “I don’t see a widget called Quick Links F in your workspace.”

## Files to Touch (expected)
- `components/chat/chat-navigation-panel.tsx`
  - selection-only guard
  - ChatContext builder with recency window
- `lib/chat/intent-prompt.ts`
  - context rules + general answer rules + retrieve_from_app
- `lib/chat/intent-schema.ts`
  - need_context, general_answer, answer_from_context, retrieve_from_app
- `app/api/chat/navigate/route.ts`
  - need-context loop + time handling + DB retrieval
- `lib/chat/intent-resolver.ts`
  - retrieve_from_app handler
- `lib/chat/use-chat-navigation.ts`
  - render answer_from_context / general_answer

## Schemas and API Examples

### ChatContext payload (client -> server)
```json
{
  "chatContext": {
    "lastAssistantMessage": "Found 2 Quick Links panels. Which one would you like to see?",
    "lastUserMessage": "quick links",
    "lastOptions": [
      { "label": "Quick Links D", "sublabel": "Quick Links (TipTap)" },
      { "label": "Quick Links E", "sublabel": "Quick Links (TipTap)" }
    ],
    "lastListPreview": {
      "title": "Recent Items",
      "count": 10,
      "items": ["Workspace 2", "Dashboard"]
    },
    "lastOpenedPanel": { "title": "Quick Links D" },
    "lastErrorMessage": null
  }
}
```

### LLM intent: answer_from_context
```json
{
  "intent": "answer_from_context",
  "args": {
    "contextAnswer": "No, only Quick Links D and Quick Links E are available."
  }
}
```

### LLM intent: need_context
```json
{
  "intent": "need_context",
  "args": {
    "contextRequest": "last 5 assistant messages"
  }
}
```

### LLM intent: general_answer
```json
{
  "intent": "general_answer",
  "args": {
    "generalAnswer": "TIME_PLACEHOLDER",
    "answerType": "time"
  }
}
```

### LLM intent: retrieve_from_app (new)
```json
{
  "intent": "retrieve_from_app",
  "args": {
    "entity_type": "widget",
    "query": "Quick Links F"
  }
}
```

### Server response: answer_from_context
```json
{
  "resolution": {
    "success": true,
    "action": "answer_from_context",
    "message": "No, only Quick Links D and Quick Links E are available."
  }
}
```

### Server response: general_answer (time)
```json
{
  "resolution": {
    "success": true,
    "action": "general_answer",
    "message": "It's currently 3:45 PM."
  }
}
```

### Server response: retrieve_from_app
```json
{
  "resolution": {
    "success": true,
    "action": "answer_from_context",
    "message": "I do not see a widget called \"Quick Links F\" in your workspace."
  }
}
```

## need_context Sequence (Text Diagram)

```
User message → LLM
   ↳ LLM returns need_context (contextRequest: "last 5 assistant messages")
Server fetches expanded context
Server re-calls LLM (1 retry max)
   ↳ LLM returns answer_from_context or standard intent
Client renders response
```
