# Question-First Routing + Notes Context Plan

## Pre-read compliance
- Isolation/reactivity anti-patterns: Not applicable. This plan does not touch isolation providers or useSyncExternalStore hooks and avoids provider/consumer API drift.

## Problem
- Question-style inputs ("What widgets are visible?", "Which notes are open?") are being intercepted by typo fallback or pending-options guards, producing "Try: ..." responses.
- Notes questions fail on the dashboard because open notes only exist in workspace context.
- The experience feels command-driven rather than conversational.

## Goals
- Route question-style inputs to the LLM + UIContext reliably.
- Provide clear scope-aware answers for notes questions.
- Keep deterministic selection fast paths (ordinals, numbers, letters).
- Make dashboard/workspace “open/visible” answers come from a single state source.

## Non-Goals
- No new DB retrieval/embeddings.
- No changes to widget reporting contract or sandbox bridge.
- No changes to selection-only fast paths.

---

## Decision Policy (One Source of Truth)

- UIContext remains the routing/scoping layer.
- widgetStates is the narrative source for conversational answers.
- Dashboard/workspace report into widgetStates like widgets do.

Examples
- widgetId: `dashboard` with instanceId `dashboard-{entryId}`
- widgetId: `workspace` with instanceId `workspace-{workspaceId}`

---

## Phase 1: Question-First Bypass

### Change
- Detect question-style inputs and skip typo fallback + pending-options guard.
- Allow these questions to reach the LLM with chatContext + uiContext.

### Question detector (examples)
- Starts with: what/which/where/when/how/why/is/are/do/did/does/can/could/should
- Ends with "?"
- Contains: "what's", "what is", "which one", "how many", "is there", "are there"

### Acceptance
- "What widgets are visible?" -> context answer, not fallback.
- "Which notes are open?" -> context answer in workspace.
- "Is F in the list?" -> context answer using last options.

---

## Phase 1a: Error Message Preservation (High Impact)

### Change
- Do not overwrite explicit resolver errors with typo fallback.
- Only apply typo suggestions when the LLM returns unsupported intent.

### Acceptance
- "Open note Project Plan" -> "No note found matching ..." (no "Try: ..." text).

---

## Phase 1b: Last Action Formatting for Panels

### Change
- Format open_panel actions in last-action responses.

### Acceptance
- "What did I just do?" -> "You opened 'Recent'." after opening a panel.

---

## Phase 2: Notes Scope Clarification

### Behavior
- If on dashboard and asked about open notes:
  - Respond: "Notes live inside workspaces. Would you like to open a workspace to see your notes?"
- If in workspace:
  - Answer from uiContext.workspace.openNotes + activeNote.

### Acceptance
- Dashboard: "Which notes are open?" -> clarification.
- Workspace: "Which notes are open?" -> list of open notes.

---

## Phase 2a: Clarification “Yes” Handling (Workspace Picker)

### Change
- Track when the notes-scope clarification is shown.
- If user replies "yes" to that clarification, show workspace options instead of "Yes to which option?"
- If a clarification is active and the reply is not an explicit selection, bypass typo fallback and route the reply to the LLM with clarification context.

### Workspace option source (priority)
1. Current entry workspaces (default)
2. Recent workspaces (fallback)
3. All workspaces (only if no entry context exists)

### After selection (recommended)
- Navigate to the chosen workspace and **automatically answer** the original notes question:
  - "The open notes are: ..."

### Acceptance
- Dashboard: "Give me the open notes" -> clarification
- User: "yes" -> "Sure — which workspace?" + workspace pills
- User selects workspace -> navigates + immediate notes list

---

## Phase 2a.1: Label Matching for Visible Options

### Change
- When pending options are visible, allow typed label matching (exact/contains) against option labels and sublabels.
- This is an alternative to clicking pills or using ordinals.
- If no label match is found, fall back to the LLM with pendingOptions context.

### Acceptance
- Options shown: [Workspace 2] [Workspace 6]
- User types: "workspace 6" -> selects Workspace 6.

---

## Phase 2a.2: Pending-Options LLM Fallback Guard

### Change
- When pending options exist, **do not trigger typo fallback**. Route unmatched input to the LLM with pendingOptions context.
- Prevents typo suggestions from short-circuiting selection flows when the user misspells a visible option.

### Acceptance
- Options shown, user types "workspac 6" -> LLM sees pendingOptions and can resolve or ask clarification (no "Try: recent, quick links" fallback).

---

## Phase 2b: Verb + Ordinal Selection

### Change
- Support phrases like "open the second" or "select the first option" when options are visible.
- Strip leading verbs and fillers before ordinal parsing.
- Only clear pending options after selection matching fails.

### Acceptance
- Options shown -> "open the second" -> selects option 2.
- Options shown -> "select the first option" -> selects option 1.

---

## Phase 3: Open Notes Source of Truth

### Requirement
- uiContext.workspace.openNotes must reflect workspace toolbar state.
- Update whenever note tabs change.

### Acceptance
- Opening/closing notes in the toolbar changes answers on first ask.

---

## Phase 4: Dashboard/Workspace State Reporting (WidgetStates)

### Change
- Dashboard and workspace report summaries to widgetStates via `upsertWidgetState`.
- Use instanceIds to avoid collisions:
  - `dashboard-${entryId}`
  - `workspace-${workspaceId}`

### Expected summaries
- Dashboard: "Home dashboard with 7 widgets"
- Workspace: "Workspace 6 with 3 open notes"

### Acceptance
- "What widgets are visible?" -> uses dashboard widgetState summary.
- "What panel is open?" -> matches open drawer + dashboard summary.
- "Which notes are open?" -> matches workspace widgetState + openNotes list.

---

## Prompt Example Additions

### Change
- Add explicit answer_from_context example for widgets visibility.

### Example
- User: "What widgets are visible?"
- Context: widgetStates.dashboard-123.summary = "Home dashboard with 7 widgets"
- Response: answer_from_context: "You have 7 widgets on your home dashboard."

### Acceptance
- "What widgets are visible?" resolves to answer_from_context using dashboard widgetState summary.

---

## Guardrails
- Selection-only fast paths remain:
  - ordinals, numbers, letters ("first", "2", "D").
- Question-style inputs never trigger typo fallback.

---

## Test Checklist

Dashboard
- "What widgets are visible?"
- "What panel is open?"
- "Which notes are open?" (should clarify)

Workspace
- "Which notes are open?"
- "What note is open?"
- "Is F in the list?" (after options shown)

Errors and actions
- "Open note Project Plan" -> explicit "not found" message
- "What did I just do?" -> shows open_panel action

Selection and questions
- "first" / "2" / "D" -> immediate selection
- "Is first the right choice?" -> treated as a question, no selection
