# Pending Options Source of Truth (Chat Message Driven)

## Goal
Make disambiguation consistent by treating the last options already shown in chat as the source of truth, instead of a separate `lastOptions` state that can drift.

## Problem
Users see options in the chat, but the system can still say “No options are open” after a typo or follow-up. This happens because state is cleared or stale even though the chat already contains the option list.

## Principles
- The chat UI should reflect the state of the conversation itself.
- If options are visible in chat, the system must be able to re-use them.
- Avoid duplicate “lastOptions” state that can fall out of sync.

## Approach

### 1) Use the last options message as source
- When the assistant renders options (pills), that message should carry the full option payload (label, sublabel, type, id, data).
- Add a helper that scans messages from newest to oldest to find the most recent assistant message with options.
- Treat that as the canonical “last options” to re-show.

### 2) Re-show options from chat history
- If the user says “show me the options / I’m confused / show again”:
  - If a recent options message exists (within grace window), re-render those same options.
  - If not, respond with a short guidance message.

### 3) Keep pendingOptions aligned
- `pendingOptions` should be derived from the most recent options message when needed (for selection matching).
- Do not clear `pendingOptions` on typo/unsupported inputs.
- Clear only when:
  - user selects an option,
  - user executes an explicit new command (open/create/rename/delete/etc.),
  - grace window expires.

### 4) Ordinal matching uses message-derived options
- If `pendingOptions` is empty but a recent options message exists, allow ordinal matching against that list.

## Grace Window
- Maintain a short grace window (e.g., 60 seconds) for re-show and ordinal matching.
- If expired, respond: “No options are open. Say ‘show quick links’ to see them again.”

## UX Copy
- Re-show prompt: “Here are your options:” + original pills
- Expired: “No options are open. Say ‘show quick links’ to see them again.”

## Acceptance Tests
1) Options survive typos
   - Show options, type garbage, then “first one” → selects correctly.
2) Re-show works
   - After selection, “show me the options” → re-renders the same pills.
3) Grace window expiry
   - Wait > 60s, “show me the options” → expired message.
4) No prior options
   - “show me the options” with no options in history → expired message.

## Files to Touch (expected)
- `components/chat/chat-navigation-panel.tsx`
  - add helper to find last options message
  - update re-show handling to use message-derived options
  - adjust pendingOptions clearing rules
- Optional: `lib/chat/chat-navigation-context.tsx`
  - if helper belongs in shared context

## Notes
- This avoids `lastOptions` drift by using the chat itself as the canonical record.
- Keeps UI behavior consistent with what the user already sees.

