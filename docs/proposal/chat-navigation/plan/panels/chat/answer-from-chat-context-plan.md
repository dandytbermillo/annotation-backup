# Answer From Chat Context (Clarification-Only Path)

## Goal
When the user asks a question whose answer is already visible in the chat UI, respond using chat context instead of falling back to generic suggestions or re-calling the LLM.

## Problem
Users ask clarification questions (“what did you just open?”, “is there a third option?”, “what were the items?”, “what did you say?”). The system currently treats these as unsupported inputs and responds with generic fallback prompts, even though the answer is in the chat history.

## Principle
If the answer is already in the chat, the system should use it directly. Only call the LLM when the answer cannot be determined from recent chat context.

## Proposed Context Signals
Track or derive from chat messages:
- Last assistant message text
- Last opened panel (title + type)
- Last list/preview shown (items + count)
- Last options list shown (labels + count)
- Last error / guidance message

## Detection Rules (Clarification-Only)
Recognize common clarification questions:
- “what did you just open?”
- “what did you just show?”
- “what did you say?” / “what did you say again?”
- “is there a third option?”
- “what were the options?” / “show me the options again”
- “which one was that?”
- “what were the items?”
- “how many items were there?”

These should **not** trigger actions. They should read from chat context.

## Response Logic
1) **Check if answer is available locally**
   - If last opened panel exists → respond with its name.
   - If last list/preview exists → respond with count or list summary.
   - If last options exist → answer ordinal questions or count.
   - If last assistant message exists → repeat or summarize it.

2) **If no local context**
   - Respond with a short, honest prompt:
     - “I don’t have that in the current chat history. Want me to show it again?”

3) **LLM fallback only if needed**
   - If clarification is ambiguous or needs natural language understanding,
     send a structured `ChatContext` block with recent assistant messages,
     last list/preview, and last options.

## UX Copy Examples
- “Your last opened panel was **Quick Links D**.”
- “You just saw **2 items** in Quick Links D.”
- “There are only **2 options**, so no third option.”
- “The last message said: ‘Found 2 Quick Links panels. Which one would you like to see?’”

## Acceptance Tests
1) “what did you just open?” after opening Quick Links D → correct response.
2) “is there a third option?” when only 2 options shown → “No, only 2 options.”
3) “what did you say?” after assistant prompt → repeats last assistant message.
4) “how many items were there?” after list preview → returns count.
5) No context → “I don’t have that in this chat history.”

## Files to Touch (expected)
- `components/chat/chat-navigation-panel.tsx`
  - add clarification-only detection
  - add local response builder using chat history
- Optional: `lib/chat/chat-navigation-context.tsx`
  - helper selectors for last list/preview/options

## Notes
- This is not limited to option lists; it applies to any chat-visible content.
- It improves UX without extra LLM calls.

