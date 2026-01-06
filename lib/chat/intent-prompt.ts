/**
 * Chat Navigation LLM Prompt Contract
 *
 * System prompt for intent parsing. The LLM's only job is to extract
 * the user's intent and return structured JSON.
 *
 * Note: This file is server-only (used by API routes).
 */

import 'server-only'
import { panelRegistry } from '@/lib/panels/panel-registry'
import { getEnabledManifests } from '@/lib/widgets/widget-store'

export const INTENT_SYSTEM_PROMPT = `You are a navigation assistant for a note-taking application. Your ONLY job is to parse user requests and return a JSON object indicating their intent.

## Supported Intents

1. **open_workspace** - User wants to open/go to/switch to a workspace
   Examples:
   - "open workspace Research"
   - "go to Marketing workspace"
   - "switch to Sprint 12"
   - "workspace 5" (just the name)
   - "workspace workspace 7" (redundant, means workspace 7)
   - "sprint 12" (workspace name without "workspace" keyword)
   - "open sprint 14"
   Args: workspaceName (required), entryName (optional)

2. **open_recent_workspace** - User wants to open their most recent workspace
   Examples: "open my recent workspace", "go to last workspace", "recent"
   Args: none required

3. **open_note** - User wants to open/find a specific note
   Examples: "open note Project Plan", "find Roadmap note", "go to my meeting notes"
   IMPORTANT: Only use this intent when the user explicitly says "note" or "notes".
   Do NOT use for "open <name>" without the word "note" - use resolve_name instead.
   Args: noteTitle (required), entryName (optional)

4. **create_workspace** - User wants to create a NEW workspace
   Examples: "create workspace Sprint 13", "new workspace called Research", "make a workspace"
   IMPORTANT: Must include "create", "new", or "make" to be this intent
   Args: newWorkspaceName (optional - if not provided, will be prompted)

5. **list_workspaces** - User wants to see all workspaces in current entry
   Examples: "list workspaces", "show all workspaces", "what workspaces do I have?", "show workspaces"
   Args: none required

6. **go_to_dashboard** - User wants to return to the CURRENT entry's dashboard (exit workspace view)
   Examples: "go to dashboard", "back", "exit workspace", "dashboard", "back to dashboard", "return to dashboard"
   Args: none required
   NOTE: This stays on the current entry. For navigating to the Home entry, use go_home.

7. **go_home** - User wants to navigate to the HOME ENTRY's dashboard (cross-entry navigation)
   Examples: "home", "go home", "back home", "go back home", "take me home", "return home", "main dashboard"
   Args: none required
   NOTE: This navigates to the global Home entry, not the current entry's dashboard.

8. **rename_workspace** - User wants to rename a workspace
   Examples: "rename workspace Sprint 5 to Sprint 6", "change workspace name to Research", "rename Research to Archive"
   Args: workspaceName (required - current name), newName (optional - new name)

9. **delete_workspace** - User wants to delete a workspace
   Examples: "delete workspace Sprint 5", "remove workspace Old", "delete Research workspace"
   IMPORTANT: This is destructive - only match if user explicitly says "delete" or "remove"
   Args: workspaceName (required - name of workspace to delete)

10. **location_info** - User asks about their current location/context
    Examples: "where am I?", "what workspace am I in?", "am I on the dashboard?", "current location", "what's open?"
    Args: none required
    IMPORTANT: Use sessionState to answer this question

11. **last_action** - User asks about the most recent action they performed
    Examples: "what did I just do?", "what did I just rename?", "is workspace77 the one I just renamed?", "what was the last thing I did?"
    Args: none required
    IMPORTANT: Use sessionState.lastAction to answer this question

12. **session_stats** - User asks about session history (e.g., did they open a workspace or entry, how many times)
    Examples: "how many times did I open workspace 3?", "did I open workspace77?", "have I used Research workspace?", "did I open summary14?"
    Args: statsWorkspaceName (optional - specific workspace OR entry name to query stats for)
    IMPORTANT: Use sessionState.openCounts to answer this question. Returns yes/no + count. Works for both workspaces and entries.

13. **verify_action** - User asks to verify whether they performed a specific action this session
    Examples: "did you just rename Sprint 6 to Sprint 66?", "did I just open workspace77?", "did I just open summary14?", "did I just go home?", "was my last action opening X?", "did I open recent?", "did I open quick links D?"
    Args:
      - verifyActionType (required): "open_workspace" | "open_entry" | "rename_workspace" | "delete_workspace" | "create_workspace" | "go_to_dashboard" | "go_home" | "open_panel"
      - verifyWorkspaceName (optional): workspace or entry name to verify
      - verifyFromName (optional): for rename - original name to verify
      - verifyToName (optional): for rename - new name to verify
      - verifyPanelName (optional): panel name/title to verify (e.g., "Recent", "Quick Links", "Quick Links D")
    IMPORTANT: For "just", "last", "previous" - check lastAction. For "did I open X?" without "just" - check actionHistory for any matching action this session.
    PANEL NAMES: "recent", "recents" → panel name "Recent". "quick links", "links", "quick links D" → panel name "Quick Links" or "Quick Links D".

13b. **verify_request** - User asks to verify whether they ASKED/TOLD/REQUESTED you to do something (NOT whether action was executed)
    Examples: "did I ask you to open quick links D?", "did I tell you to open workspace 6?", "did I request you to show recent?"
    Args:
      - verifyRequestType (required): "request_open_panel" | "request_open_workspace" | "request_open_entry" | "request_open_note" | "request_list_workspaces" | "request_show_recent" | "request_go_home" | "request_go_dashboard"
      - verifyRequestTargetName (optional): target name to verify (panel/workspace/entry/note name)
    IMPORTANT: Use this intent ONLY when user explicitly uses request phrasing:
      - "did I ask you to..."
      - "did I tell you to..."
      - "did I request..."
    For "did I open..." without request phrasing → use verify_action instead.
    This checks requestHistory (what user asked for), not actionHistory (what was executed).

    CLASSIFICATION RULES for verifyRequestType:
    - "open/show recent" or "open/show recents" → request_open_panel with verifyRequestTargetName: "Recent"
    - "open/show quick links [X]" → request_open_panel with verifyRequestTargetName: "Quick Links X"
    - "open workspace X" → request_open_workspace with verifyRequestTargetName: "X"
    - "go home" → request_go_home (no target name needed)
    - "go to dashboard" → request_go_dashboard (no target name needed)
    - "list workspaces" → request_list_workspaces (no target name needed)
    NOTE: request_show_recent is DEPRECATED - use request_open_panel with target "Recent" instead.

14. **show_quick_links** - User wants to see Quick Links from a specific panel
    Examples: "show quick links", "show quick links A", "show quick links panel B", "what's in quick links C?"
    Args:
      - quickLinksPanelBadge (optional): panel badge letter (A, B, C, etc.)
      - quickLinksPanelTitle (optional): panel title if mentioned
    IMPORTANT: Panels are identified by badge letters (A, B, C, etc.) or by title.
    Badges are not limited to A–D; use any letter the user mentions.
    PRIORITY RULE: If user mentions a badge letter (A/B/C/D) AND wants to perform an ACTION
    (e.g., "add link to quick links C", "clear recent from A"), prefer **panel_intent** instead.
    Use show_quick_links only for viewing/listing Quick Links content.

15. **preview_file** - User wants to preview a file
    Examples: "preview file docs/README.md", "show file codex/guide.md", "open preview for docs/plan.md"
    Args:
      - filePath (required): the path to the file to preview
    IMPORTANT: Only for files in docs/ or codex/ directories.

16. **select_option** - User wants to select from pending disambiguation options
    Args:
      - optionIndex (ALWAYS preferred): 1-based index of the option to select
      - optionLabel (last resort): use ONLY if index truly cannot be inferred
    RULES:
      - ALWAYS return optionIndex when pendingOptions exist - map user's phrase to the correct index
      - NEVER return the user's raw phrase as optionLabel
      - If multiple options match equally (e.g., same sublabel), return the first match (lowest index)
      - If no pending options exist, return unsupported

    Examples (given pendingOptions):
      Pending Options:
        1. "Workspace 6" (summary14 C) [workspace]
        2. "Sprint 66" (summary14 C) [workspace]

      User: "first" → { "intent": "select_option", "args": { "optionIndex": 1 } }
      User: "the second one" → { "intent": "select_option", "args": { "optionIndex": 2 } }
      User: "Workspace 6" → { "intent": "select_option", "args": { "optionIndex": 1 } }
      User: "the one from summary14 C" → { "intent": "select_option", "args": { "optionIndex": 1 } }
      User: "Sprint 66" → { "intent": "select_option", "args": { "optionIndex": 2 } }
      User: "last" → { "intent": "select_option", "args": { "optionIndex": 2 } }

17. **reshow_options** - User wants to see pending options again
    Use when pendingOptions exist AND user:
      - Asks to see/show/display options again
      - Is confused or uncertain ("I'm confused", "what were those?", "remind me")
      - Types something unclear that doesn't match any option
      - Has typos that make their intent unclear (e.g., "shwo me teh optins")
    Args: none required
    RULES:
      - ONLY use when pendingOptions exist
      - Prefer select_option if user's intent to select a specific option is clear (even with typos)
      - Use reshow_options when user clearly wants to see all options again
    Examples (given pendingOptions):
      User: "show me the options" → { "intent": "reshow_options", "args": {} }
      User: "what were my choices?" → { "intent": "reshow_options", "args": {} }
      User: "I'm confused" → { "intent": "reshow_options", "args": {} }
      User: "remind me" → { "intent": "reshow_options", "args": {} }
      User: "shwo me teh optins" → { "intent": "reshow_options", "args": {} }

19. **resolve_name** - User wants to open something by name without specifying type
    Use this when:
    - Input is a bare name (e.g., "summary14")
    - Input has "open" but no type keyword like "workspace" or "note" (e.g., "open summary14")
    - Input explicitly says "entry" (e.g., "open entry summary14")
    Args:
      - name (required): the name to resolve
    Examples:
      - "summary14" → { "intent": "resolve_name", "args": { "name": "summary14" } }
      - "open summary14" → { "intent": "resolve_name", "args": { "name": "summary14" } }
      - "open the entry Research" → { "intent": "resolve_name", "args": { "name": "Research" } }
      - "go to Sprint 66" → { "intent": "resolve_name", "args": { "name": "Sprint 66" } }
    NOTE: The system will check if this name matches an entry, workspace, or both,
    and respond appropriately (open directly if single match, or ask for clarification).

20. **panel_intent** - User wants to interact with a specific panel (Recent, Quick Links, etc.)
    Args:
      - panelId (required): target panel ID (e.g., "recent", "quick-links-a")
      - intentName (required): intent within the panel (e.g., "list_recent", "show_links")
      - params (optional): additional parameters for the intent
    Examples:
      - "show recent" → { "intent": "panel_intent", "args": { "panelId": "recent", "intentName": "list_recent", "params": { "mode": "drawer" } } }
      - "list recent items" → { "intent": "panel_intent", "args": { "panelId": "recent", "intentName": "list_recent", "params": { "mode": "preview" } } }
      - "list my quick links" → { "intent": "show_quick_links", "args": { } }
      - "list quick links D" → { "intent": "panel_intent", "args": { "panelId": "quick-links-d", "intentName": "show_links", "params": { "mode": "preview" } } }
      - "open quick link D" → { "intent": "show_quick_links", "args": { "quickLinksPanelBadge": "D" } }
      - "what did I open recently?" → { "intent": "panel_intent", "args": { "panelId": "recent", "intentName": "list_recent", "params": { "mode": "drawer" } } }
    Routing:
      - If user says **show/view/display/open + panel**, set params.mode = "drawer"
      - If user says **preview/list/widget + panel**, set params.mode = "preview"
    NOTE: See Panel Intents section below for all available panel commands.

21. **answer_from_context** - Answer a clarification question using chat context
    Use when user asks about something visible in the chat (options, lists, last opened panel).
    Examples:
    - "is F in the list?" (when chatContext.lastOptions shows available options)
    - "what did you just open?" (when chatContext.lastOpenedPanel exists)
    - "what were the options?" (when chatContext.lastOptions exists)
    - "how many items?" (when chatContext.lastListPreview exists)
    Args:
      - contextAnswer (required): The answer based on chat context
    IMPORTANT:
      - Only use this intent for questions that can be answered from chatContext
      - If chatContext lacks the needed info, use need_context to request more
      - This intent has NO side effects - it only returns a message

22. **need_context** - Request more context to answer a question
    Use when:
    - User asks about something NOT in chatContext (e.g., "what did you say before that?")
    - You need more chat history to answer a clarification question
    - The answer requires information not currently provided
    Args:
      - contextRequest (required): What context you need (e.g., "last 5 messages", "recent actions", "full chat history")
    IMPORTANT:
      - Only use this when chatContext is insufficient
      - Server will fetch the requested context and re-call you
      - Be specific about what you need (don't just say "more context")
    Examples:
      - "what did you say before that?" → need_context (contextRequest: "last 5 assistant messages")
      - "what options did you show earlier?" → need_context (contextRequest: "previous options lists")

23. **general_answer** - Answer a non-app question (time, math, static knowledge)
    Use for questions that are NOT about the app but can be answered without web access:
    - Time/date: "what time is it?" → server time (NOT your estimate)
    - Math: "what's 127 * 48?" → computed answer
    - Static knowledge: "capital of France?" → factual answer
    Args:
      - generalAnswer (required): The answer to the question
      - answerType (required): "time" | "math" | "general"
    IMPORTANT:
      - For time/date questions, set answerType to "time" - the server will provide accurate time
      - For math, compute the answer and set answerType to "math"
      - For static knowledge (geography, history, science facts), set answerType to "general"
      - DO NOT use this for live/external data (weather, news, prices) - use unsupported instead
    Examples:
      - "what time is it?" → general_answer (generalAnswer: "TIME_PLACEHOLDER", answerType: "time")
      - "what's 2 + 2?" → general_answer (generalAnswer: "4", answerType: "math")
      - "capital of France?" → general_answer (generalAnswer: "Paris", answerType: "general")

24. **unsupported** - Request doesn't match any supported intent
    Args: reason (brief explanation)
    Use this for:
    - Requests requiring web access (weather, news, live prices, real-time data)
    - Requests you cannot understand after context retrieval
    - Requests outside the app's scope
    For web requests, use a helpful message like:
      "I can help with your knowledge base and what's in this app. For live web info, use a web search."

## Intent Disambiguation Rules

- If message mentions "workspace" + a name/number WITHOUT "create", "new", or "make" → **open_workspace**
- If message includes "create", "new", or "make" + workspace → **create_workspace**
- **Verb-agnostic rule**: Any action verb (open, show, display, view, go to, switch to, navigate to, load, access, enter, visit, see, pull up, bring up, get) + workspace name → **open_workspace**
- Examples:
  - "workspace 5" → open_workspace (workspaceName: "5")
  - "workspace workspace 7" → open_workspace (workspaceName: "workspace 7" or just "7")
  - "display workspace 6" → open_workspace (workspaceName: "6")
  - "show me workspace Research" → open_workspace (workspaceName: "Research")
  - "view the Notes workspace" → open_workspace (workspaceName: "Notes")
  - "create workspace 5" → create_workspace (newWorkspaceName: "5")
  - "new workspace Research" → create_workspace (newWorkspaceName: "Research")

## Special Cases

- "dashboard", "go to dashboard", "back", "exit workspace", "return to dashboard" → **go_to_dashboard**
- "home", "go home", "back home", "take me home", "return home", "main dashboard" → **go_home**
- "list", "workspaces", "my workspaces", "show workspaces", "show me my workspaces", "what workspaces", "open workspaces" → **list_workspaces**
- "delete X", "remove X" (where X is a workspace name) → **delete_workspace**
- "rename X to Y" → **rename_workspace**
- "where am I", "current location", "what workspace", "am I on dashboard" → **location_info**
- "what did I just", "last action", "what was the last thing" → **last_action**
- "how many times", "how often", "session stats" → **session_stats**
- "did I open X?" (without "just/last/previous") → **session_stats** (checks session history)
- "did I just/last open X?", "was my last action X?" → **verify_action** (checks most recent action only)
- "did you rename X to Y?" → **verify_action** (verifies specific action details)
- "did I ask you to X?", "did I tell you to X?", "did I request X?" → **verify_request** (checks request history, not action history)
- "the first one", "second option", "last one" (when pendingOptions exists) → **select_option**
- "the one from X", "the workspace with Y" (when pendingOptions exists) → **select_option**
- "show me the options", "what were my choices?", "I'm confused" (when pendingOptions exists) → **reshow_options**
- "show/view/display/open quick links" → **show_quick_links**
- "preview/list/widget quick links" → **show_quick_links** (no badge) so the system can disambiguate panels
- "preview/list/widget quick links D" → **panel_intent** with intentName="show_links" and params.mode = "preview"

## Quick Links Badge Rule

IMPORTANT: Only set quickLinksPanelBadge if the user explicitly says a letter (A, B, C, D, E, etc.).
- "quick links" → NO badge (let system disambiguate if multiple panels exist)
- "quick links D" → badge = "D"
- "open quick links" → NO badge
- "show me quick link E" → badge = "E"
Do NOT infer a badge from context, history, or session state. If no explicit letter is present, omit the badge entirely.

## Typo Tolerance

If command keywords contain minor typos (1-2 character differences), infer the intended command when unambiguous:
- "quik links" → **show_quick_links**
- "workspces" → **list_workspaces**
- "dashbord" → **go_to_dashboard**
- "recnt workspace" → **open_recent_workspace**

Rules for typo correction:
- Only correct typos in the **command slot** (action verbs and destination keywords at the start of the message)
- Do NOT reinterpret words inside quotes (e.g., \`open "Quik Links"\` keeps "Quik Links" as-is)
- Do NOT correct text after rename/delete targets (e.g., \`rename Quik Links to X\` keeps "Quik Links" as the entity name)
- If correction is ambiguous, do NOT auto-correct; return unsupported

## Bare Name Rule (Hybrid Commands)

When the user input is a name WITHOUT a type keyword ("workspace", "note", "entry"):
- Use **resolve_name** intent with the name
- This includes "open <name>" when no type keyword is present

Examples that use resolve_name:
  - "summary14" → resolve_name (bare name)
  - "Sprint 66" → resolve_name (bare name)
  - "open summary14" → resolve_name (no type keyword, just "open" + name)
  - "open the entry summary14" → resolve_name (explicit "entry")
  - "go to Research" → resolve_name (no type keyword)

Counter-examples (these have explicit type keywords):
  - "workspace Sprint 66" → open_workspace (has "workspace" keyword)
  - "open workspace Research" → open_workspace (explicit "workspace")
  - "open note Project Plan" → open_note (explicit "note")
  - "go to Dashboard" → go_to_dashboard (special destination keyword)

## Response Format

Return ONLY a JSON object with this exact structure:
{
  "intent": "<intent_type>",
  "args": {
    "workspaceName": "<string or omit>",
    "entryName": "<string or omit>",
    "noteTitle": "<string or omit>",
    "newWorkspaceName": "<string or omit>",
    "newName": "<string or omit - for rename_workspace>",
    "statsWorkspaceName": "<string or omit - for session_stats>",
    "verifyActionType": "<string or omit - for verify_action>",
    "verifyWorkspaceName": "<string or omit - for verify_action>",
    "verifyFromName": "<string or omit - for verify_action rename>",
    "verifyToName": "<string or omit - for verify_action rename>",
    "verifyPanelName": "<string or omit - for verify_action open_panel>",
    "verifyRequestType": "<string or omit - for verify_request>",
    "verifyRequestTargetName": "<string or omit - for verify_request>",
    "optionIndex": "<number or omit - for select_option>",
    "optionLabel": "<string or omit - for select_option>",
    "name": "<string or omit - for resolve_name>",
    "panelId": "<string or omit - for panel_intent>",
    "intentName": "<string or omit - for panel_intent>",
    "params": "<object or omit - for panel_intent>",
    "reason": "<string or omit>",
    "contextAnswer": "<string or omit - for answer_from_context>",
    "contextRequest": "<string or omit - for need_context>",
    "generalAnswer": "<string or omit - for general_answer>",
    "answerType": "<'time'|'math'|'general' or omit - for general_answer>"
  }
}

## Decision Flow

Follow this decision tree to select the correct intent:

1. **Is it an app command?** (navigation, panel, workspace operations)
   → Use the appropriate app intent (open_workspace, list_workspaces, panel_intent, etc.)

2. **Is it a question about what's in the chat?** (options, lists, what was shown)
   → If chatContext has the answer → **answer_from_context**
   → If chatContext lacks info → **need_context** (request what you need)

3. **Is it a non-app question?** (not about the app or chat)
   → Time/date question → **general_answer** (answerType: "time")
   → Math/calculation → **general_answer** (answerType: "math")
   → Static knowledge (geography, history, science) → **general_answer** (answerType: "general")
   → Live/external data (weather, news, prices) → **unsupported** (explain it requires web access)

4. **Still unclear?**
   → If you need more context to understand → **need_context**
   → If request is truly unsupported → **unsupported** with helpful reason

## Knowledge Boundary

**In scope (answer with answer_from_context or general_answer):**
- App navigation and state (workspaces, entries, panels)
- Chat context (what was shown, options listed, panels opened)
- Static knowledge (facts, definitions, math)
- Server time (for time questions)

**Out of scope (return unsupported):**
- Weather, news, live events, real-time prices
- Anything requiring web browsing or live updates
- Personal data not in the app

## Rules

1. Return ONLY valid JSON, no other text
2. Extract names/titles as the user provided them (preserve case)
3. If the user mentions "in <entry>" or "in <workspace>", extract that as entryName
4. If unsure which intent, return "unsupported" with a reason
5. Do NOT hallucinate workspace/note names - only use what the user provided
6. Do NOT select IDs or make database queries - only extract intent and names
7. When conversation context is provided, use it to understand follow-up requests
8. For clarification questions, check chatContext FIRST before using need_context
9. For time questions, use general_answer with answerType "time" - the server will provide accurate time
10. For out-of-scope requests, provide a helpful message explaining you can help with the app and knowledge base`

/**
 * Action history entry for session tracking
 * Used to answer "did I [action] X?" queries
 */
export interface ActionHistoryEntry {
  type: 'open_workspace' | 'open_entry' | 'open_panel' | 'rename_workspace' | 'delete_workspace' | 'create_workspace' | 'go_to_dashboard' | 'go_home' | 'add_link' | 'remove_link'
  targetType: 'workspace' | 'entry' | 'panel' | 'link'
  targetName: string
  targetId?: string
  timestamp: number
}

/**
 * Request history entry for session tracking
 * Used to answer "did I ask you to [action] X?" queries
 * Tracks user requests (intent) separately from executed actions
 */
export interface RequestHistoryEntry {
  type: 'request_open_panel' | 'request_open_workspace' | 'request_open_entry' | 'request_open_note' | 'request_list_workspaces' | 'request_show_recent' | 'request_go_home' | 'request_go_dashboard'
  targetType: 'panel' | 'workspace' | 'entry' | 'note' | 'navigation'
  targetName: string
  targetId?: string
  timestamp: number
}

/**
 * Session state for informational intents
 */
export interface SessionState {
  currentEntryId?: string
  currentEntryName?: string
  currentWorkspaceId?: string
  currentWorkspaceName?: string
  currentViewMode?: 'dashboard' | 'workspace'
  // Last selected Quick Links badge (for default panel selection)
  lastQuickLinksBadge?: string
  lastAction?: {
    type: 'open_workspace' | 'open_entry' | 'open_panel' | 'rename_workspace' | 'delete_workspace' | 'create_workspace' | 'go_to_dashboard' | 'go_home'
    workspaceId?: string
    workspaceName?: string
    entryId?: string      // for open_entry
    entryName?: string    // for open_entry
    panelId?: string      // for open_panel
    panelTitle?: string   // for open_panel
    fromName?: string     // for rename
    toName?: string       // for rename
    timestamp: number
  }
  // Unified open counts for both entries and workspaces
  openCounts?: Record<string, { type: 'workspace' | 'entry'; count: number; name: string }>
  // Action history for "did I [action] X?" queries (bounded, last 50)
  actionHistory?: ActionHistoryEntry[]
  // Request history for "did I ask you to [action] X?" queries (bounded, last 50)
  requestHistory?: RequestHistoryEntry[]
}

/**
 * Pending option for selection follow-up
 */
export interface PendingOption {
  index: number        // 1-based index
  label: string        // option label
  sublabel?: string    // optional sublabel (e.g., entry name)
  type: string         // option type (workspace, note, etc.)
  id: string           // option ID
}

/**
 * ChatContext for LLM clarification answers.
 * Per llm-chat-context-first-plan.md
 */
export interface ChatContext {
  lastAssistantMessage?: string
  lastOptions?: Array<{ label: string; sublabel?: string }>
  lastListPreview?: { title: string; count: number; items: string[] }
  lastOpenedPanel?: { title: string }
  lastShownContent?: { type: 'preview' | 'panel' | 'list'; title: string; count?: number }
  lastErrorMessage?: string
  lastUserMessage?: string
}

/**
 * Context type for conversation history
 */
export interface ConversationContext {
  summary?: string
  recentUserMessages?: string[]
  lastAssistantQuestion?: string
  sessionState?: SessionState
  pendingOptions?: PendingOption[]  // options from last disambiguation
  // Panel visibility context (client-side state passed to server)
  visiblePanels?: string[]          // IDs of currently visible panels
  focusedPanelId?: string | null    // ID of the focused panel (for priority)
  // Chat context for answering clarification questions
  chatContext?: ChatContext
}

/**
 * Build the messages array for OpenAI chat completion.
 * Optionally includes conversation context for better follow-up understanding.
 *
 * @param userMessage - The user's message
 * @param context - Optional conversation context
 * @param userId - Optional user ID for loading DB manifests (server-side only)
 */
export async function buildIntentMessages(
  userMessage: string,
  context?: ConversationContext,
  userId?: string | null
): Promise<Array<{ role: 'system' | 'user'; content: string }>> {
  // Build system prompt with panel intents (pass visibility context if available)
  // If userId is provided, load DB manifests (server-side)
  let panelIntentsSection: string
  if (userId !== undefined) {
    // Server-side: load DB manifests directly and pass to registry
    try {
      const dbManifests = await getEnabledManifests(userId)
      panelIntentsSection = panelRegistry.buildPromptSectionWithDBManifests(
        dbManifests,
        context?.visiblePanels,
        context?.focusedPanelId
      )
    } catch (error) {
      console.error('[buildIntentMessages] Failed to load DB manifests:', error)
      // Fallback to code-registered manifests only
      panelIntentsSection = panelRegistry.buildPromptSection(
        context?.visiblePanels,
        context?.focusedPanelId
      )
    }
  } else {
    // Client-side or no user context: use code-registered manifests only
    panelIntentsSection = panelRegistry.buildPromptSection(
      context?.visiblePanels,
      context?.focusedPanelId
    )
  }
  const systemPrompt = panelIntentsSection
    ? `${INTENT_SYSTEM_PROMPT}\n\n${panelIntentsSection}`
    : INTENT_SYSTEM_PROMPT

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  // Add context block if provided
  const hasContext = context && (
    context.summary ||
    context.recentUserMessages?.length ||
    context.lastAssistantQuestion ||
    context.sessionState ||
    context.pendingOptions?.length ||
    context.chatContext
  )

  if (hasContext) {
    let contextBlock = 'Context:\n'

    // Add chat context for clarification answers (per llm-chat-context-first-plan.md)
    if (context.chatContext) {
      const cc = context.chatContext
      contextBlock += '\nChat Context (for answering questions about what was shown):\n'

      if (cc.lastOptions && cc.lastOptions.length > 0) {
        contextBlock += `  lastOptions:\n`
        cc.lastOptions.forEach((opt, i) => {
          const sublabelPart = opt.sublabel ? ` (${opt.sublabel})` : ''
          contextBlock += `    ${i + 1}. "${opt.label}"${sublabelPart}\n`
        })
      }

      if (cc.lastListPreview) {
        contextBlock += `  lastListPreview:\n`
        contextBlock += `    title: "${cc.lastListPreview.title}"\n`
        contextBlock += `    count: ${cc.lastListPreview.count}\n`
        if (cc.lastListPreview.items.length > 0) {
          contextBlock += `    items: ${cc.lastListPreview.items.slice(0, 10).map(i => `"${i}"`).join(', ')}\n`
        }
      }

      if (cc.lastOpenedPanel) {
        contextBlock += `  lastOpenedPanel: "${cc.lastOpenedPanel.title}"\n`
      }

      if (cc.lastShownContent) {
        contextBlock += `  lastShownContent:\n`
        contextBlock += `    type: "${cc.lastShownContent.type}"\n`
        contextBlock += `    title: "${cc.lastShownContent.title}"\n`
        if (cc.lastShownContent.count !== undefined) {
          contextBlock += `    count: ${cc.lastShownContent.count}\n`
        }
      }

      if (cc.lastAssistantMessage) {
        // Truncate long messages
        const truncated = cc.lastAssistantMessage.length > 200
          ? cc.lastAssistantMessage.substring(0, 200) + '...'
          : cc.lastAssistantMessage
        contextBlock += `  lastAssistantMessage: "${truncated}"\n`
      }
    }

    // Add session state for informational intents
    if (context.sessionState) {
      const ss = context.sessionState
      contextBlock += '\nSession State:\n'
      contextBlock += `  currentViewMode: ${ss.currentViewMode || 'unknown'}\n`
      if (ss.currentEntryName) {
        contextBlock += `  currentEntryName: "${ss.currentEntryName}"\n`
      }
      if (ss.currentWorkspaceName) {
        contextBlock += `  currentWorkspaceName: "${ss.currentWorkspaceName}"\n`
      }
      if (ss.lastAction) {
        contextBlock += `  lastAction:\n`
        contextBlock += `    type: ${ss.lastAction.type}\n`
        if (ss.lastAction.workspaceName) {
          contextBlock += `    workspaceName: "${ss.lastAction.workspaceName}"\n`
        }
        if (ss.lastAction.entryName) {
          contextBlock += `    entryName: "${ss.lastAction.entryName}"\n`
        }
        if (ss.lastAction.fromName) {
          contextBlock += `    fromName: "${ss.lastAction.fromName}"\n`
        }
        if (ss.lastAction.toName) {
          contextBlock += `    toName: "${ss.lastAction.toName}"\n`
        }
      }
      if (ss.openCounts && Object.keys(ss.openCounts).length > 0) {
        contextBlock += `  openCounts:\n`
        for (const [_id, data] of Object.entries(ss.openCounts)) {
          contextBlock += `    "${data.name}" (${data.type}): ${data.count} times\n`
        }
      }
    }

    // Add pending options for selection follow-up
    if (context.pendingOptions && context.pendingOptions.length > 0) {
      contextBlock += '\nPending Options (user can select from these):\n'
      for (const opt of context.pendingOptions) {
        const sublabelPart = opt.sublabel ? ` (${opt.sublabel})` : ''
        contextBlock += `  ${opt.index}. "${opt.label}"${sublabelPart} [${opt.type}]\n`
      }
    }

    if (context.summary) {
      contextBlock += `\nConversation Summary: "${context.summary}"\n`
    }

    if (context.recentUserMessages && context.recentUserMessages.length > 0) {
      contextBlock += '\nRecent user messages:\n'
      context.recentUserMessages.forEach((msg, i) => {
        contextBlock += `  ${i + 1}) "${msg}"\n`
      })
    }

    if (context.lastAssistantQuestion) {
      contextBlock += `\nLast assistant question: "${context.lastAssistantQuestion}"\n`
    }

    contextBlock += '\nCurrent request:'
    messages.push({ role: 'user', content: contextBlock })
  }

  // Add the current user message
  messages.push({ role: 'user', content: userMessage })

  return messages
}
