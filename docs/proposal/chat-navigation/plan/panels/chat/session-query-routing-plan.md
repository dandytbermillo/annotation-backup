# Action Query Routing Plan (Session-Only)

## Purpose
Make "did I [action] X?" questions use a deterministic, session-only action history so answers are
accurate and consistent across entries, panels, and widgets.

## Goals
- Deterministic routing rules based on the user's phrasing.
- Use a single data source: session_state action history.
- Avoid LLM guessing; apply a small, deterministic scope classifier.
- Keep answers short and aligned to the user's wording.

## Non-Goals
- Changing how the Recent widget itself is populated.
- Replacing the existing session_stats schema entirely.
- Full analytics or audit trails.
- Multi-user scoping (still single-user).

## Definitions
- session_state: In-chat session tracking (lastAction, openCounts).
- recents DB: The data used by the Recent widget (workspace/activity recency).
- panel history: A short in-session log of panel opens (e.g., "Recent", "Quick Links D").

## Data Sources
1) session_state
   - lastAction (already implemented)
   - actionHistory[] (new, lightweight, bounded list)
   - panelHistory[] (optional alias of actionHistory entries for panels)

## actionHistory Data Model (Session-Only)
Each entry should be small and deterministic:
{
  "type": "rename_workspace",
  "targetType": "workspace",
  "targetName": "Sprint 6",
  "targetId": "uuid-optional",
  "ts": "ISO-8601"
}

Recommended fields:
- type: open_workspace | open_entry | open_panel | rename_workspace | delete_workspace | create_workspace | add_link | remove_link
- targetType: workspace | entry | panel | link | note
- targetName: display name used in user-facing responses
- targetId: optional (for disambiguation)
- ts: timestamp for ordering (latest-first)

## Action -> actionHistory Mapping
Use this table to ensure all tracked actions produce a consistent entry:

| Action Source                      | actionHistory.type   | targetType | targetName source                 |
|------------------------------------|----------------------|------------|-----------------------------------|
| open_workspace                      | open_workspace       | workspace  | workspace.name                    |
| open_entry                          | open_entry           | entry      | entry.name                        |
| go_home                             | open_entry           | entry      | "Home" (or home entry name)       |
| open_panel_drawer / preview         | open_panel           | panel      | panel title (e.g., "Quick Links D") |
| rename_workspace                    | rename_workspace     | workspace  | new workspace name                |
| delete_workspace                    | delete_workspace     | workspace  | workspace name                    |
| create_workspace                    | create_workspace     | workspace  | workspace name                    |
| quick_links add_link                | add_link             | link       | workspace/entry name added        |
| quick_links remove_link             | remove_link          | link       | workspace/entry name removed      |

## Implementation Tasks (MVP)
- [ ] Add session_state.actionHistory[] (bounded, e.g., last 50)
- [ ] Record panel opens (drawer/preview) into actionHistory or panelHistory
- [ ] Extend resolver to answer action queries via actionHistory
- [ ] Update negative responses to be action-aware:
  - "No, I have no record of [action] [target] this session."

## Routing Rules
### A) Action Query -> session_state.actionHistory
Triggers: "did I", "have I", "was I able to", plus an action verb.
Examples:
- "Did I open workspace 6?"
- "Did I rename Sprint 5?"
- "Did I delete workspace Alpha?"

### B) Panel Name Query -> session_state.actionHistory (panel entries)
Triggers: panel names or aliases ("recent", "quick links", "links", badge variants).
Examples:
- "Did I open recent?"
- "Did I open quick links D?"

### C) Ambiguous Scope -> clarify
If the input includes time words like "recently/last" but we only track session history:
"I can answer for this session. Do you want that?"

## Deterministic Scope Classifier
Use a small keyword matcher on the raw user message to set queryScope:

1) If message includes panel name tokens -> scope = panel_history
2) Else -> scope = session_state
3) If message includes recency words -> respond with a session-only clarification

Suggested keywords:
- Panel tokens: "recent", "recents", "quick links", "links", "links panel"
- Session tokens: "this session", "just now", "last action", "right now"
- Recents tokens: "recently", "last opened", "most recent", "lately"

## Resolver Behavior
1) session_state (actionHistory)
   - Match by action type + target name (case-insensitive).
   - Respond with "Yes, you [action] [target] this session."
2) panel_history
   - Match panel name or badge (Quick Links D).
   - Respond with "Yes, you opened {panelTitle} this session."
3) clarify
   - "I can answer for this session. Do you want that?"

## Action History Tracking (New)
Whenever the system executes an action:
- Append to session_state.actionHistory (bounded, e.g., last 50).
- Update lastAction.

Example entry:
{ type: "rename_workspace", targetType: "workspace", targetName: "Sprint 6", ts }

Panel opens (drawer or preview) should record:
{ type: "open_panel", targetType: "panel", targetName: "Quick Links D", ts }
When a panel is opened via chat:
- Record session_state.panelHistory entry:
  { panelId, panelTitle, openedAt }
- Also update lastAction:
  { type: "open_panel", panelId, panelTitle }

If panel opens from UI (double-click widget), optionally record panelHistory
so chat questions stay consistent with UI behavior.

## UX Copy Rules
- Use "this session" consistently (single data source).
- If user asked "recently/last", respond with:
  "I can answer for this session only. Want that?"
- Avoid generic "no record" without action + target context.

## Test Checklist
- "Did I open recent?" -> panel_history (yes/no).
- "Did I open quick links D?" -> panel_history (yes/no).
- "Did I open workspace 6?" -> session_state.
- "Did I rename Sprint 5?" -> session_state.
- "Did I delete workspace Alpha?" -> session_state.
- "Did I open workspace 6 recently?" -> clarification (session-only).

## Rollback
- If routing causes regressions, revert to session_state-only behavior.
- Keep panel_history logging optional and gated by feature flag.

## Isolation Reactivity Anti-Patterns
Not applicable. This plan does not change Isolation context or reactivity hooks.
No new useSyncExternalStore usage or provider/consumer contract changes.

---

## Implementation Plan

### Step 1: Data Model + State
- Add `actionHistory` to session_state shape and persist it.
- Keep bounded list (e.g., last 50).
- Update session_state serialization/deserialization.

**Target files:**
- `lib/chat/chat-navigation-context.tsx`
- `lib/chat/resolution-types.ts`
- `lib/chat/index.ts` (export new types)

### Step 2: Track Actions (write to actionHistory)
Append an entry whenever these happen:
- open workspace / entry / panel
- rename / delete / create workspace
- quick links add/remove

See "Action -> actionHistory Mapping" table above for field values.

**Target files:**
- `lib/chat/use-chat-navigation.ts`
- `lib/chat/intent-resolver.ts` (where resolution is finalized)
- `components/chat/chat-navigation-panel.tsx` (where panel opens are triggered)

### Step 3: Panel Open Tracking
- When drawer opens or preview renders, add `open_panel` action history.
- Use panel title + badge for targetName.

**Target files:**
- `components/chat/chat-navigation-panel.tsx`
- `lib/chat/use-chat-navigation.ts`

### Step 4: Action Query Resolver
- New deterministic routing:
  - If "did I [action] X?" → check actionHistory.
  - If "recently/last" → respond with session-only clarification.
- Add action-aware negative response wording.

**Target files:**
- `lib/chat/intent-resolver.ts`
- `lib/chat/intent-prompt.ts` (brief rule update)

### Step 5: Copy/UX
- Replace generic "no record" with:
  "No, I have no record of [action] [target] this session."

**Target files:**
- `lib/chat/intent-resolver.ts`

### Step 6: Tests (Manual)
- "Did I open workspace 6?"
- "Did I rename Sprint 5?"
- "Did I open quick links D?"
- "Did I open workspace 6 recently?" → session-only clarification

### Execution Order
```
1 → 2 → 3 → 4 → 5 → 6
     ↓
 (can parallel 2+3)
```
