# Chat Navigation Plan: Informational Intents + Structured Session Context

## Goal
Enable the chat to answer simple informational questions using session context, instead of replying "unsupported."

Examples:
- "Where am I now?"
- "Is workspace77 the one I just renamed?"
- "How many times did I open workspace 3 this time?"
- "Did you rename Sprint 6 to Sprint 66?"
- "Did I open workspace77?"

## Scope
Add informational intents and a lightweight session state payload, while keeping navigation intents unchanged.

## Non-Goals
- No cross-entry data access.
- No persistence across reloads (session-only state).
- No panel/UI redesign.

## New Intents (Phase 1)
1) location_info
   - Examples: "where am I now?", "current location", "am I on the dashboard?"
   - Response: entry + view mode (dashboard/workspace), include workspace name if in workspace view.

2) last_action
   - Examples: "what did I just rename?", "what was my last action?"
   - Response: last action summary (rename from/to, target workspace).

3) session_stats
   - Examples: "how many times did I open workspace 3 this time?", "did I open workspace77?"
   - Response: count or yes/no based on session memory (per workspace).

4) verify_action
   - Examples: "did you rename Sprint 6 to Sprint 66?", "did I just open workspace77?"
   - Response: yes/no based only on sessionState.lastAction.

## Session State (In-Memory Only)
Maintain a small structured context in the chat provider:
- currentEntryId
- currentEntryName
- currentWorkspaceId
- currentWorkspaceName
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
- Add 4 intents to the intent schema and prompt examples.
- Add rules:
  - Use sessionState for location_info / last_action / session_stats / verify_action.
  - If no sessionState data exists, return unsupported with reason.
  - Route "did I just/last open <workspace>" to verify_action.
  - Route "did I open <workspace>" to session_stats.

## Resolver Behavior
### location_info
- If currentViewMode is workspace:
  - "You are in workspace <name> in entry <entryName>."
- If currentViewMode is dashboard:
  - "You are on the dashboard for entry <entryName>."
- If entry context is missing:
  - "I can't determine the current entry yet."

### last_action
- If lastAction exists: return a plain-English summary.
- Else: "I don't have recent action context yet."

### session_stats (Comprehensive Response)
- If a specific workspace is referenced:
  - Provide BOTH:
    1) Session-level answer (openCounts)
    2) Last-action answer (whether the last action was opening that workspace)
  - Example:
    "Yes, you opened workspace77 once this session. (Not just now — your last action was going to the dashboard.)"
- If no workspace specified:
  - Provide a summary list of openCounts.

### verify_action
- Only compare against sessionState.lastAction.
- If lastAction is missing: "I don't have enough info to confirm that."
- If lastAction matches the type and names (case-insensitive, trimmed): "Yes."
- Otherwise: "No, the last action was <summary>."

## Name Matching Rules (verify_action)
- Use case-insensitive, trimmed comparison for names.
- Do not accept partial matches unless explicitly requested.
- If required names are missing in lastAction, respond with "I don't have enough info to confirm that."

## Example Prompts
- location_info: "where am I now?", "am I on the dashboard?", "what workspace am I in?"
- last_action: "what did I just do?", "what did I just rename?"
- session_stats: "how many times did I open workspace 3?", "did I open workspace77?"
- verify_action: "did you rename Sprint 6 to Sprint 66?", "did I just open workspace77?"

## Example Responses (session_stats)
- "Did I open workspace77?"
  - If openCounts shows 1 and lastAction is dashboard:
    - "Yes, you opened workspace77 once this session. (Not just now — your last action was going to the dashboard.)"

## Example Responses (verify_action)
- "Did you rename Sprint 6 to Sprint 66?"
  - If last action was rename Sprint 12 -> Sprint 6:
    - "No, the last action was renaming \"Sprint 12\" to \"Sprint 6\"."
- "Did I just open workspace77?"
  - If last action was open workspace77:
    - "Yes."

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
- "where am I now?" returns current view context.
- "what did I just rename?" returns last rename info.
- "how many times did I open workspace X?" returns count.
- "did I open workspace77?" returns session-level + last-action clarification.
- "did I just open workspace77?" returns yes/no based on lastAction.
- If sessionState is empty, returns truthful "not supported yet."

## Isolation Reactivity Anti-Patterns
- Applicability: not applicable (no isolation provider changes).
- Compliance: no new provider/consumer API drift introduced in this phase.
