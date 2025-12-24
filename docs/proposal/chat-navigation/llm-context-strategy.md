# LLM Context Strategy for Chat Navigation

## Goal
Improve intent parsing reliability by providing conversational context to the LLM while keeping latency and cost predictable. Context should reset on app reload, matching the expected UX.

## Recommended Approach
**Memory-only context since reload + rolling summary + recent window**

This combines three signals:
1) **Rolling summary** of older turns (compact context)
2) **Recent user messages** (last 6–8)
3) **Last assistant clarification** (only if it asked a question)

This yields consistent intent inference without sending unbounded history.

## Why Not Send Entire History Every Time
Even “since reload” can grow large in long sessions, increasing cost and latency. A summary + recent window preserves intent while controlling size.

## Data Model (In-Memory)
Maintain a local chat state:
- `messages`: full conversation since reload
- `summary`: rolling summary string (optional)

Each message:
```
{
  id: string,
  role: 'user' | 'assistant',
  content: string,
  timestamp: Date,
  isQuestion?: boolean
}
```

## Context Assembly (Request Payload)
On each user submit, build a context block to send to `/api/chat/navigate`:

1) **Summary** (if available)
2) **Last N user messages** (N = 6–8)
3) **Last assistant clarification** (only if it ends with a question or is flagged `isQuestion`)
4) **Current user message**

Example request payload:
```
{
  message: "open workspace workspace 5",
  context: {
    summary: "User has been trying to open a workspace by name.",
    recentUserMessages: [
      "open workspace Research",
      "how about workspace workspace 5"
    ],
    lastAssistantQuestion: "Do you want to open Workspace 5?"
  },
  currentEntryId: "...",
  currentWorkspaceId: "..."
}
```

## Prompt Construction (Server-Side)
Append context into the system prompt or as a structured preamble:

```
Context:
- Summary: <summary or empty>
- Recent user messages:
  1) ...
  2) ...
- Last assistant question: <if present>

Current user message: <message>
```

Then request JSON intent only (unchanged schema).

## Implementation Steps (Recommended First Pass)
1) Client-side normalization before sending to the LLM:
   - Strip filler phrases (e.g., "how about", "please", "can you")
   - Collapse duplicate tokens ("workspace workspace 5" -> "workspace 5")
   - Trim extra spaces

2) Context payload construction on submit:
   - Summary (if present)
   - Last 6–8 user messages
   - Last assistant clarification (if it was a question)
   - Current user message

3) Server-side prompt assembly:
   - Insert context block before the current user message
   - Enforce size caps and drop oldest messages first

4) Prompt hardening (system prompt):
   - Add examples like "workspace 5", "workspace workspace 7", "how about workspace 12"
   - Add a rule: if a message includes "workspace" + a name/number and does not imply create/new, treat as open_workspace

## Example Normalization
Input:
  "how about workspace workspace 5"
Normalized:
  "workspace 5"

## Rolling Summary Rules
- Update summary when total messages exceed a threshold (e.g., 12 messages).
- Summary should capture only intent-relevant facts:
  - “User is trying to open a workspace by name.”
  - “User asked for workspace 5.”
- Keep summary under ~400–600 chars.

## Token/Size Guardrails
- Cap recent user messages to 6–8.
- Cap summary length.
- If context is still too large, drop oldest user messages first.

## Reset Behavior
- On app reload, context is cleared (no persistent memory).
- This matches user expectation and keeps privacy boundaries clear.

## Fallback Behavior
If LLM returns `unsupported`:
- If the summary or recent user messages imply a workspace intent, respond with a clarification prompt (e.g., “Do you want to open Workspace 5?”).
- Otherwise respond with “not supported yet” and list supported intents.

## Benefits
- More robust interpretation of natural phrasing (“how about workspace 5”).
- Clear, bounded context window.
- No persistent memory beyond reload.
- Low implementation risk and minimal API changes.

## Open Decisions
- Whether to include assistant messages beyond the last clarification.
- Whether to auto-generate summary with the same LLM or a lightweight heuristic.
