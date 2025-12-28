# Chat Navigation Plan: Informational Intents + Structured Session Context

## Goal
Enable the chat to answer simple informational questions using session context, instead of replying “unsupported.”

Examples:
- “Where am I now?”
- “Is workspace77 the one I just renamed?”
- “How many times did I open workspace 3 this time?”

## Scope
Add informational intents and a lightweight session state payload, while keeping navigation intents unchanged.

## Non-Goals
- No cross-entry data access.
- No persistence across reloads (session-only state).
- No panel/UI redesign.

## New Intents (Phase 1)
1) workspace_info
   - Examples: “where am I now?”, “current workspace”, “workspace details”
   - Response: name + entry + view mode (dashboard/workspace).

2) last_action
   - Examples: “what did I just rename?”, “is workspace77 the one I just renamed?”
   - Response: last action summary (rename from/to, target workspace).

3) session_stats
   - Examples: “how many times did I open workspace 3 this time?”
   - Response: count from session memory (per workspace).

## Session State (In-Memory Only)
Maintain a small structured context in the chat provider:
- currentEntryId
- currentWorkspaceId
- currentViewMode (dashboard/workspace)
- lastAction
  - type: open_workspace | rename_workspace | delete_workspace | create_workspace | go_to_dashboard
  - workspaceId
  - workspaceName
  - fromName (for rename)
  - toName (for rename)
  - timestamp
- openCountsByWorkspaceId: Record<string, number>
- lastOpenedWorkspaceId

## Data Flow
1) User sends message.
2) Chat provider builds context payload:
   - sessionState (as above)
   - recent user messages (optional)
3) API returns:
   - navigation action (as today), or
   - informational response (action: "inform")
4) UI shows answer without navigation.

## LLM Prompt Updates
- Add 3 new intents to the intent schema and prompt examples.
- Add rules:
  - Use sessionState for workspace_info / last_action / session_stats.
  - If no sessionState data exists, return unsupported with reason.

## Resolver Behavior
- workspace_info:
  - If currentWorkspaceId exists: return workspace name + entry name.
  - If not: return “You’re on the dashboard of <entryName>.”
- last_action:
  - If lastAction exists: return a plain-English summary.
  - Else: “I don’t have recent action context yet.”
- session_stats:
  - Use openCountsByWorkspaceId if workspace matches.
  - If not available: respond with “No session stats yet.”

## UI Behavior
- Informational results are displayed as assistant messages only.
- No pills unless a follow-up action is required.

## Implementation Steps
1) Add new intents to:
   - lib/chat/intent-schema.ts
   - lib/chat/intent-prompt.ts
2) Add sessionState context payload from chat provider.
3) Extend API to accept sessionState and pass to buildIntentMessages.
4) Add resolver handlers for informational intents:
   - lib/chat/intent-resolver.ts
5) Extend ChatNavigationResult to allow action: "inform".
6) Ensure UI renders informational responses as normal assistant messages.

## Testing Checklist
- “where am I now?” returns current view context.
- “what did I just rename?” returns last rename info.
- “how many times did I open workspace X?” returns count.
- If sessionState is empty, returns truthful “not supported yet.”

## Isolation Reactivity Anti-Patterns
- Applicability: not applicable (no isolation provider changes).
- Compliance: no new provider/consumer API drift introduced in this phase.
