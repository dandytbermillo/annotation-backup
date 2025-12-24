# Option 1 Implementation Plan: Global Chatbox Across Entries and Workspaces

## Decision Summary
- One global chatbox instance shared across entries and workspaces.
- Conversation persists while the app is running and clears on full reload.
- No redesign or panel behavior changes in this phase.

## Goals
- Make chat interactions easy and productive by keeping context across navigation.
- Keep a single conversation thread for the session (no reset on entry switch).
- Use the existing LLM intent pipeline with memory-only context (no persistence).
- Respond truthfully when a request is not supported yet.

## Non-Goals
- No changes to panel behavior (no hide, resize, move).
- No panel content manipulation beyond existing LLM intents.
- No cross-session persistence (no localStorage, no DB storage).
- No UI redesign or layout changes to the chatbox itself.

## User Experience Behavior
- The chatbox is available in both dashboard and workspace views.
- Switching entries or workspaces keeps the same chat history.
- Reloading the app resets the chat history to empty.
- Unsupported requests always return: "Not supported yet" plus a short list of supported actions.
- Disambiguation uses existing quick-links style (clickable options) when needed.

## Architecture Overview
- Move chat state to a global provider mounted at the app shell level.
- Ensure only one chat panel instance renders the UI.
- Triggers from different UI locations open the same panel and share state.
- Keep message normalization and LLM context strategy from `docs/proposal/chat-navigation/llm-context-strategy.md`.

## State Model (In-Memory Only)
- `messages`: Array of chat turns (user + assistant).
- `isOpen`: Global open/close state for the panel.
- `isSending`: Pending request flag.
- `context`: Current entry/workspace identifiers and view mode.
- `summary`: Rolling summary of older user messages (optional but recommended).
- `recentUserMessages`: Last N user messages (e.g., 6).
- `lastAssistantQuestion`: Only for disambiguation or explicit questions.

## Data Flow
1. User opens chat from any location (dashboard/workspace).
2. Chat panel reads state from the global provider.
3. When user sends a message:
   - Normalize the message (remove filler, collapse duplicates, preserve case).
   - Build context payload (summary + recent messages + last assistant question).
   - Send to `/api/chat/navigate` with current entry/workspace context.
4. On response:
   - Update messages and context.
   - Execute navigation intent if supported.
   - Otherwise respond with "Not supported yet".

## Implementation Steps

### Step 0: Confirm Integration Points
- Identify where the chat panel is mounted today.
- Identify all UI triggers that open chat (toolbar, dock, control center).

### Step 1: Add a Global Chat Provider
- Create a `ChatSessionProvider` with a `useChatSession()` hook.
- Provider should be mounted at the top-level app shell so it survives view changes.
- Provider holds all chat state in memory only.

### Step 2: Make ChatNavigationPanel a Consumer
- Remove local chat state from `ChatNavigationPanel`.
- Read and update state via `useChatSession()`.
- Ensure `sendMessage()` uses the shared state and updates it in one place.

### Step 3: Single Panel, Multiple Triggers
- Render `ChatNavigationPanel` once (global placement).
- All chat triggers call `openChat()` from the provider.
- If a trigger already renders the panel, replace it with a trigger-only button.

### Step 4: Sync View Context into Chat
- Add a small `useChatContextBridge()` hook that updates chat context when:
  - Entry changes
  - Workspace changes
  - View mode changes (dashboard vs workspace)
- This ensures the LLM uses correct scope without resetting history.

### Step 5: Context Window Strategy
- Use the existing memory-only strategy:
  - Rolling summary for older messages.
  - Last N user messages + last assistant question.
- No storage across reload.

### Step 6: Unsupported Requests Handling
- If intent is unknown or unsupported, return:
  - "Not supported yet. I can help with: open workspace by name, open recent workspace, open note by title, create workspace."
- Do not attempt side effects.

### Step 7: QA and Verification
- Start in dashboard, send a message, switch entry, verify chat history persists.
- Switch into a workspace, verify history persists and context updates.
- Reload the app, verify history clears.
- Run common prompts:
  - "open workspace Research"
  - "open note Project Plan"
  - "open recent workspace"
  - "how about 7" after a previous workspace prompt

## Risks and Mitigations
- Duplicate panel instances: enforce a single render site for the panel.
- Stale context: bridge hook must update on entry/workspace change.
- Context overload: keep summary + recent window to cap token use.

## Compliance With Isolation Reactivity Anti-Patterns
- Applicability: not applicable (no isolation provider changes).
- Compliance: avoid introducing new provider/consumer API drift; add provider first, then migrate consumers.

## Feature Flag Policy
- Ship enabled by default.
- If any temporary gating is required for verification, document removal timeline.

## Deliverables
- Global chat session provider and hook.
- Single chat panel instance with global state.
- Context bridge for entry/workspace changes.
- Updated documentation of behavior and test checklist.
