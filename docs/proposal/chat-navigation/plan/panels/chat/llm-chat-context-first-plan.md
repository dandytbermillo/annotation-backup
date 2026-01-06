# LLM-First Clarification Using Chat Context (Selection-Only Guard)

## Goal
Make the LLM answer clarification questions based on what the user already saw in the chat UI, while keeping only a narrow local guard for clear selection inputs (ordinals/letters).

## Problem
Current guards block the LLM from seeing conversational questions, so queries like “is F in the list?” or “what did you just open?” fall back to generic help text even though the answer is visible in the chat.

## Principle
Let the LLM handle everything except **obvious selections**. Only intercept inputs that are clearly picking an option.

## Scope
- Clarification-only questions (no side effects)
- Membership/count questions about the most recent list/options
- “What did you just open/show?” questions

Non-goals:
- Executing actions based on context alone
- Replacing existing selection flows (pills, ordinals)

## Guard Policy (Selection-Only)
Only intercept inputs that are explicit picks:
- Ordinals: “first”, “second”, “third”, “last”, “1”, “2”, “3”, “option 2”, “the first one”
- Single-letter choices when the options are labeled with letters

Guard specificity:
- Only when `pendingOptions.length > 0`
- Only when the input **fully matches** the selection pattern (no extra words)
  - Example: “first” ✅
  - Example: “first, let me ask…” ❌ (send to LLM)

Everything else goes to the LLM with chat context:
- Questions: “is F in the list?”, “what were the options?”, “what did you just open?”
- Full sentences and conversational phrases
- Ambiguous inputs that are not clear selections

## Chat Context Passed to the LLM
Add a structured ChatContext block:
- lastAssistantMessage: text
- lastOptions: [{ label, sublabel }]
- lastListPreview: { title, count, items[] }
- lastOpenedPanel: { title }
- lastErrorMessage: text
- lastUserMessage: text

Context extraction rules:
- **Options message** = most recent assistant message with `options[]`.
- **List preview** = most recent assistant message with list preview metadata.
- **Last opened panel** = most recent assistant message indicating “Opening …” or tracked action log.

## LLM Instructions (Prompt Rules)
- If the answer is visible in context, answer directly.
- If user asks about list membership, compare against lastOptions/lastListPreview.
- If user asks “what did you just open/show?”, answer from lastOpenedPanel.
- If context is missing, respond: “I don’t see that in this chat. Want me to show it again?”

## Response Type
Add:
- action: "answer_from_context"
- message: string

Client renders message only (no action).

## Token Budget
Keep context tight:
- Only most recent assistant message + last options/list + last opened panel.
- Do not send full chat history.

## Implementation Outline
1) Narrow the local guard to selection-only patterns.
2) Send ChatContext to the LLM for all other inputs.
3) Add answer_from_context to schema + resolver.
4) Render answer_from_context responses without side effects.

## Acceptance Tests
1) Options membership
   - Show Quick Links D/E
   - Ask: “is Quick Links F in the list?”
   - Expect: “No, only Quick Links D and Quick Links E.”

2) Last opened panel
   - Open Demo Widget
   - Ask: “what did you just open?”
   - Expect: “You just opened Demo Widget.”

3) Options recall
   - Show disambiguation list
   - Ask: “what were the options?”
   - Expect: list the same options

4) Selection still fast
   - Show options
   - Input: “first one” → selects option

5) No context
   - Ask: “what did you just open?” without prior actions
   - Expect: “I don’t see that in this chat. Want me to show it again?”

## Files to Touch (expected)
- `components/chat/chat-navigation-panel.tsx` (narrow guard + send ChatContext)
- `lib/chat/intent-prompt.ts` (ChatContext + rules)
- `lib/chat/intent-schema.ts` (answer_from_context action)
- `lib/chat/intent-resolver.ts` (pass-through response)
- `app/api/chat/navigate/route.ts` (include ChatContext)

