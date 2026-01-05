# Request History Plan (Option A)

## Purpose
Answer conversational questions like "did I ask you to open X?" by tracking user requests
separately from action execution, with session-only scope and optional persistence.

## Goals
- Deterministic, non-LLM answers to "did I ask/request/tell you to…" questions.
- Distinguish request intent from executed action.
- Persist request history across reloads (same conversation).

## Non-Goals
- Cross-conversation or long-term analytics.
- Full chat transcript search.
- Multi-user identity scoping (single-user mode only).

## Data Model
Add to session_state:

requestHistory[] (bounded, e.g., last 50):
{
  "type": "request_open_panel",
  "targetType": "panel",
  "targetName": "Quick Links D",
  "targetId": "quick-links-d",
  "ts": "ISO-8601"
}

Supported request types (initial):
- request_open_panel
- request_open_workspace
- request_open_entry
- request_open_note
- request_list_workspaces
- request_show_recent

## Routing Rules (Deterministic)
If user message includes request phrasing:
- "did I ask you to"
- "did I tell you to"
- "did I request"
→ Use requestHistory (not actionHistory).

If user message includes "did I open/do/rename/delete" without request phrasing:
→ Use actionHistory (existing behavior).

## Persistence (Cross-Reload)
- Persist requestHistory in the same session_state payload used for actionHistory.
- Load requestHistory on init alongside actionHistory.

## Implementation Steps
1) Extend SessionState
   - Add requestHistory?: RequestHistoryEntry[]
   - Add RequestHistoryEntry type

2) Append requests
   - When user submits a command that maps to a supported intent, append a
     requestHistory entry with target name + id.
   - Use the same bounded list logic as actionHistory.

3) Add verify_request intent
   - New intent type for request queries
   - Args: requestType, requestTargetName (panel/workspace/entry/etc.)

4) Resolver: resolveVerifyRequest
   - Match by requestType + targetName (case-insensitive)
   - Respond:
     - Yes: "Yes, you asked me to open 'Quick Links D' this session."
     - No: "No, I have no record of you asking to open 'Quick Links D' this session."

5) Prompt updates
   - Add verify_request examples:
     - "did I ask you to open quick links D?"
     - "did I tell you to open workspace 6?"
   - Clarify: request questions use requestHistory, not actionHistory.

## Request → Target Mapping
Use this table to map user requests into requestHistory entries:

| User Request Pattern                | requestHistory.type      | targetType | targetName source                 |
|-------------------------------------|--------------------------|------------|-----------------------------------|
| "show quick links D"                | request_open_panel       | panel      | "Quick Links D"                   |
| "show recent"                       | request_open_panel       | panel      | "Recent"                          |
| "open workspace Sprint 6"           | request_open_workspace   | workspace  | workspace name                    |
| "open entry summary14"              | request_open_entry       | entry      | entry name                        |
| "open note Project Plan"            | request_open_note        | note       | note title                        |
| "list workspaces"                   | request_list_workspaces  | workspace  | "Workspaces"                      |
| "show recent workspace"             | request_show_recent      | workspace  | "Recent Workspace"                |
| panel_intent (custom widget)        | request_open_panel       | panel      | panel title from manifest         |

## Test Checklist
- "did I ask you to open quick links D?" → requestHistory yes/no
- "did I tell you to open workspace 6?" → requestHistory yes/no
- "did I open quick links D?" → actionHistory yes/no (unchanged)
- Reload page → requestHistory still available

## Custom Widgets (panel_intent)
If a user request resolves to panel_intent (custom widget), append:
{
  type: "request_open_panel",
  targetType: "panel",
  targetName: panel title,
  targetId: panelId
}
This allows "did I ask you to open the demo widget?" to resolve correctly.

## UX Copy Rules
- Use "asked me to" / "told me to" phrasing in responses.
- Keep scope "this session" for consistency.

## Rollback
- If issues, disable verify_request intent and leave actionHistory untouched.

## Isolation Reactivity Anti-Patterns
Not applicable. No context API changes outside chat session state.
