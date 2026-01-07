# UI Context Bundle Plan - Implementation Report

Date: 2026-01-06

## Summary
Implemented the UI Context bundle so the LLM can answer questions about what is visible on the current dashboard/workspace. The chat request now carries a structured `uiContext`, the API passes it through to the LLM prompt, and the prompt explicitly prioritizes chatContext/uiContext for on-screen questions.

## Scope Implemented
- UIContext type added to the prompt schema and conversation context.
- Dashboard view writes a live UIContext snapshot (visible widgets, drawer state, focused panel, entry).
- Workspace shell writes a live UIContext snapshot (workspace name/id, open notes, active note).
- Chat panel includes uiContext in the navigate API request payload.
- API route forwards uiContext to the intent prompt builder.
- Prompt renders an explicit UI Context block and updates decision flow/priorities.

## Files Changed

### Added/Updated Types and Prompt Formatting
- `lib/chat/intent-prompt.ts`
  - Added `UIContext` interface and `ConversationContext.uiContext` field.
  - Added UI Context block rendering in `buildIntentMessages`.
  - Updated decision flow and priority rule to use chatContext/uiContext first.
  - Clarified `answer_from_context` usage for UIContext.

### Chat Context State + Transport
- `lib/chat/chat-navigation-context.tsx`
  - Added `uiContext` state and `setUiContext` setter to context value.

- `components/chat/chat-navigation-panel.tsx`
  - Reads `uiContext` from context and includes it in `/api/chat/navigate` payload.

- `app/api/chat/navigate/route.ts`
  - Passes `uiContext` into `conversationContext` for prompt construction.

### UI Context Producers
- `components/dashboard/DashboardView.tsx`
  - Produces dashboard UIContext: entry name/id, visible widgets (capped at 10), open drawer, focused panel.
  - Produces workspace UIContext (name/id) when in workspace mode.

- `components/annotation-app-shell.tsx`
  - Produces workspace UIContext: workspace name/id, open notes (capped at 5), active note.
  - Skips updates when hidden or entry is inactive.

## Behavior Changes (Expected)
- Questions like "Is Quick Links D visible?" or "Which widgets are on the dashboard?" can be answered via `answer_from_context`.
- Questions like "Which notes are open?" or "Is Project Plan open?" can be answered using workspace UIContext.
- If the answer isn’t in chatContext/uiContext, the LLM should request more context or use retrieve_from_app.

## Manual Test Ideas
1. Dashboard
   - Open multiple widgets, then ask: "What widgets are visible?"
   - Open a drawer, ask: "What panel is open?"
2. Workspace
   - Open 2-3 notes, ask: "Which notes are open?" and "Is <note> open?"
3. Context priority
   - Ask a question about visible widgets after a recent list was shown to confirm chatContext/uiContext precedence.

## Notes
- UIContext is metadata-only and capped to avoid large payloads.
- UIContext is a live snapshot; it is not persisted across reloads.

