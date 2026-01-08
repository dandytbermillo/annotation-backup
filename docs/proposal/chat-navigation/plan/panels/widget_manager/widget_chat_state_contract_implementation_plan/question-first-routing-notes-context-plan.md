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
- Use a generic clarification contract: lastClarification.nextAction determines the local follow-up (not a hard-coded notes-specific check).
- Accept bounded affirmations locally (e.g., yes/yeah/yep/sure/ok/okay/go ahead, optional "please").
- Suggested pattern: ^(yes|yeah|yep|sure|ok|okay|go ahead)(\s+please)?$
- If reply is not a bounded affirmation, route to LLM with clarification context (no typo fallback).
- If a clarification is active and the reply is not an explicit selection, bypass typo fallback and route the reply to the LLM with clarification context.

### Phase 2a.3: Clarification Reply Interpretation (Local + LLM)

Goal: Make clarification replies conversational without hard-coded expansion.

Behavior:
1) Local fast path:
   - If reply matches bounded affirmation -> execute lastClarification.nextAction.
   - If reply matches bounded rejection -> cancel clarification ("Okay — what would you like instead?").
2) LLM fallback:
   - For any other reply, send to LLM with clarification context.
   - LLM returns one of: YES / NO / UNCLEAR.
     - YES -> execute nextAction.
     - NO -> cancel clarification.
     - UNCLEAR -> re-ask the clarification question.

Acceptance:
- "please do" / "yes pls" / "yap" -> LLM interprets YES -> shows workspace picker.
- "not now" -> LLM interprets NO -> "Okay — what would you like instead?"
- "hmm" -> LLM returns UNCLEAR -> re-ask clarification.

### Phase 2a.4: Clarification Explanation Requests

Goal: When the user asks for an explanation ("what do you mean?", "explain workspace"),
reply with a short explanation and re-ask the same clarification question.

Behavior:
1) When lastClarification is active, detect explanation requests.
2) Respond with a brief explanation (1-2 sentences).
3) Re-ask the clarification question.
4) Keep clarification state active.

Detection (examples):
- "what do you mean"
- "explain"
- "explain workspace"
- "what is a workspace"
- "help me understand"

Response template (notes scope):
- "Notes live inside workspaces. A workspace is where your notes are grouped in an entry.
   Would you like to open a workspace to see your notes? (yes/no)"

Acceptance:
- Dashboard: "give me open notes" -> clarification
- User: "what do you mean" -> explanation + re-ask clarification
- User: "yes please" -> show workspace picker

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
- User: "yes please" / "please do" -> LLM interprets YES -> workspace pills

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
- Also skip typo fallback when lastClarification is present; send to LLM with clarification context.
- Typo fallback should only run when no pendingOptions and no lastClarification context exist.
- Prevents typo suggestions from short-circuiting selection flows when the user misspells a visible option.

### Acceptance
- Options shown, user types "workspac 6" -> LLM sees pendingOptions and can resolve or ask clarification (no "Try: recent, quick links" fallback).

---

## Phase 2b: Verb + Ordinal Selection

### Change
- Support phrases like "open the second" or "select the first option" when options are visible.
- Strip leading verbs and fillers before ordinal parsing.
- Only clear pending options after selection matching fails.

### Recognized patterns
- Exact ordinals and numbers only (no verb/filler expansion).
- Ordinals: first/1, second/2, third/3, fourth/4, fifth/5

### Examples
- "open the second" -> option 2
- "select the first option" -> option 1
- "go with the third one" -> option 3
- "I'll take the second please" -> option 2
- "the second" -> option 2 (verb optional)

### Edge cases
- "open workspace 2" -> handled by exact number match
- If local parsing fails -> route to LLM with pendingOptions context (no typo fallback)

### Guard interaction
- Do not clear pendingOptions for verb+ordinal inputs (e.g., "open the second").
- Either:
  - Add a verb+ordinal exception to isExplicitCommand, or
  - Move the explicit-command clearing after selection/LLM fallback.

### Acceptance
- Options shown -> "open the second" -> selects option 2.
- Options shown -> "select the first option" -> selects option 1.

---

## Phase 3: Open Notes Source of Truth

### Requirement
- uiContext.workspace.openNotes must reflect the **Open Notes dock panel** state.
- Use the dock list as the authoritative source (the same list shown in the dock popover).
- Update whenever the dock’s open-notes list changes (open, close, reorder, active note change).
- **Single owner:** AnnotationAppShell owns workspace uiContext. DashboardView must not set workspace uiContext.

### Canonical source
- `CanvasWorkspaceContext.openNotes` via `useCanvasWorkspace()` (same list used by the Open Notes dock).
- Map this through `openNotesForContext` in AnnotationAppShell.

### Data shape
- `openNotes: Array<{ id: string; title: string; active?: boolean }>`

### Workspace switch guard
- Only update uiContext when:
  - `openNotesWorkspaceId === noteWorkspaceState.currentWorkspaceId`
  - Prevents stale notes from the previous workspace during transitions.

### Hydration handling (decision)
- Option A: set `isStale: true` during hydration and respond "Notes are loading…"
- Option B: skip uiContext updates during hydration and keep the last valid state.
- Decision: **Option A** (isStale flag) - prevents showing wrong workspace's notes during transitions.

### Acceptance
- Opening/closing notes in the toolbar changes answers on first ask.
- Rapid workspace switch -> "Which notes are open?" returns correct workspace notes (not empty, not previous).
- During hydration -> "Notes are loading..." message (via isStale flag), never empty/wrong data.

---

## Phase 4: Dashboard/Workspace State Reporting (WidgetStates)

### Prerequisites
- Phase 3 must be stable enough to prevent stale workspace/drawer state from being reported.
- If Phase 3 is simplified, it still must enforce single ownership + switch guard so widgetStates are correct.

### Change
- Dashboard and workspace report summaries to widgetStates via `upsertWidgetState`.
- Use instanceIds to avoid collisions:
  - `dashboard-${entryId}`
  - `workspace-${workspaceId}`

### Reporting triggers (required)
- On mount: initial summary so chat works immediately after reload.
- On change:
  - Dashboard: visible widgets change, drawer open/close, focused panel change.
  - Workspace: open notes change, active note change, workspace switch complete.

### Prompt preference
- For “what’s visible/open?” questions, prefer widgetStates summaries first.
- If widgetStates missing/stale, fall back to uiContext or ask to retry.

### Expected summaries
- Dashboard: "Home dashboard with 7 widgets"
- Workspace: "Workspace 6 with 3 open notes"

### Acceptance
- "What widgets are visible?" -> uses dashboard widgetState summary.
- "What panel is open?" -> matches open drawer + dashboard summary.
- "Which notes are open?" -> matches workspace widgetState + openNotes list.
- After reload, "What widgets are visible?" should respond correctly before any interaction.

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
