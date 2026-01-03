# Plan: Panel Intent Registry (Future‑Proof, Plugin‑Style Chat)

## Purpose
Make the chat system extensible and future‑proof so any built‑in or custom panel can add chat commands **without changing core chat code**.

This avoids a growing list of hard‑coded intents and lets panels “teach” the system via manifests.

---

## Core Decision (Schema + Dispatch)
Use a **single, strict intent** for panel commands:
```
intent: "panel_intent"
args: { panelId, intentName, params }
```

This keeps the JSON schema stable while allowing unlimited panel‑specific commands.

---

## Manifest Contract (Per Panel)
Each panel exposes a manifest like:
```
{
  panelId: string,
  panelType: string,
  title: string,
  version: "1.0",
  intents: [
    {
      name: "show_recents",
      description: "Show recent items in this panel",
      examples: ["show recents", "open recent list"],
      paramsSchema: { ... },
      handler: "api:/api/panels/recents",
      permission: "read"
    }
  ]
}
```

### Required fields
- `panelId`, `panelType`, `title`, `version`
- `intents[]` with `name`, `description`, `examples`, `paramsSchema`, `handler`, `permission`

---

## Handler Model (Single Choice)
**Use API handlers for all panel intents.**
- `handler: "api:/api/panels/<panel>/<intent>"`
- Built‑in panels can still route internally on the server.

This avoids mixing function handlers and API handlers.

---

## Intent Aggregation
At runtime:
1) Collect manifests for **visible/mounted panels**.
2) Merge with **core intents** (open workspace, etc.).
3) Build the LLM prompt with core intents + a panel intent section.

### Prompt contract
Panel intents must instruct the LLM to output:
```
{ "intent": "panel_intent", "args": { "panelId": "...", "intentName": "...", "params": { ... } } }
```

---

## Priority Rules (Collision‑Safe)
When user input could match core + panel intents:
1) Explicit panel mention wins (e.g., “Quick Links: show all”).
2) Focused panel (active or recently interacted) wins.
3) Visible panels next.
4) Otherwise, ask clarification: “Which panel do you want: Recent or Quick Links?”

Core intents always remain available for non‑panel commands.

### Quick Links Disambiguation
- If the user asks for “quick links” **without a badge** and **multiple Quick Links panels are visible** (A/B/C/D), **ask which panel**.
  - Example: “Which Quick Links panel do you want — A, B, C, or D?”
- If **only one** Quick Links panel is visible, use it without asking.

### Default Quick Links Panel (Persisted)
- Remember the **last selected Quick Links badge** (A/B/C/D) and reuse it as the default for
  “list my quick links” across reloads.
- If the remembered badge is **not visible**, fall back to disambiguation.

---

## Routing Defaults (Drawer vs Chat Preview)
To keep panel interactions consistent with the dashboard widgets:

- **Default:** “show/view/display/open + panel name” → **open the panel drawer** (same as double‑clicking the widget).
  - Examples: “show recents”, “show quick links D”, “view quick links”
- **Explicit preview:** “preview/list/widget + panel name” → **chat preview** (summary/partial list).
  - Examples: “preview recents”, “list quick links”, “show recents widget”
- **Preview override (always wins):** if the user mentions **list / preview / in the chatbox / in chat**, force **preview mode** even if the message also includes “show/display/open”.
- **Follow‑up:** “show all” after a preview → **open the panel drawer** for that panel.
- **Pronoun follow‑up:** “display it in the chatbox” (or “show it in chat”) uses the **last panel preview/drawer** as the target.
  - If no prior panel context exists, ask: “Which panel should I display in the chatbox — Recent or Quick Links?”

This avoids two different “full list” experiences and keeps panel commands aligned with widget behavior.

### Routing Precedence (Deterministic Fallback)
- If raw input includes **list / preview / in the chatbox / in chat**, force `params.mode = "preview"` even if the LLM chose a drawer‑style intent.
- “show/display/open” only route to drawer **when preview keywords are absent**.

Examples:
- “list quick links D” → `panel_intent` + `mode: "preview"`
- “display the recent items list in the chatbox” → `panel_intent` + `mode: "preview"`
- “show quick links D” → drawer

---

## Validation & Safety
- Strict schema validation for `panel_intent` args.
- Permission check before executing (`read` vs `write`).
- If panel not found or intent unknown → return supported actions.

---

## Chat Output Contract (Required for Third‑Party Panels)
To keep chat previews and actions consistent across all panels, panel handlers must return data in a uniform shape.

### Required Fields (for list-style results)
- `items[]`: array of list items with:
  - `id` (string, stable)
  - `name` (string, user‑friendly label)
  - `type` (one of: `link`, `entry`, `workspace`, `note`, `file`)
  - `meta` (optional subtitle text)
  - `isSelectable` (optional, false for non-clickable items)
  - Navigation fields (required for clickable items):
    - `entryId` (string) when the item opens an entry dashboard
    - `workspaceId` (string) when the item opens a workspace
    - `dashboardId` (string) when the item is an entry link (dashboard workspace id)

### Required Fields (for the response envelope)
- `title`: string shown in the chat preview header
- `subtitle`: optional string shown under the title
- `message`: short summary line for the chat bubble

### Behavior Rules
- If an item is clickable, include the navigation fields so the chat preview can navigate.
- Never substitute IDs for names; `name` must be user-friendly.
- Non-list result types (text, note, file, etc.) must still include `title` and `message`.

---

## Versioning Strategy
- Manifest includes `version`.
- Registry only accepts compatible versions.
- Incompatible manifests are ignored with a warning.

---

## Generalization Framework (Future Widgets)
This pattern can apply to any widget type without special‑casing:

- **Dynamic registration:** widgets advertise visibility so the prompt only includes on‑screen panels.
- **Panel‑level aliases:** each widget declares its own synonyms (e.g., “tasks”, “to‑dos”, “task board”).
- **Primary read‑only intent:** each widget should declare a safe default (e.g., `list_items`) used for list/preview requests.
- **Instance disambiguation:** if multiple instances exist (e.g., Timer A, Timer B), ask which one unless a focused or last‑selected instance is present.
- **Fallback coercion:** if the LLM returns an unknown intent name for a panel, coerce to the primary read‑only intent only when the user asked to list/preview (never for write actions).

These rules prevent intent drift while keeping the system open to third‑party widgets.

---

## Example: Task Board Panel
User: “show my tasks”

LLM Response:
```
{
  "intent": "panel_intent",
  "args": {
    "panelId": "taskboard",
    "intentName": "list_tasks",
    "params": {}
  }
}
```

Router → `api:/api/panels/taskboard/list_tasks` → returns viewPanelContent → UI renders.

---

## Implementation Phases
**Phase 1: Registry Core**
- Define manifest interface
- Add registry loader for visible panels
- Add panel intent section to LLM prompt

**Phase 2: Router**
- Add dispatch layer for `panel_intent`
- Implement permission checks + error paths

**Phase 3: Custom Panels**
- Allow custom panels to register manifests dynamically
- Add validation + version checks

---

## Testing Checklist
- Core intents still work without panels.
- “show recents” routes to Recent panel intent when visible.
- Two panels match → clarification.
- Custom panel manifest rejected if version unsupported.
- “display it in the chatbox” with prior panel context → preview for that panel.
- “display it in the chatbox” with no context → clarification prompt.

---

## Success Criteria
- New panels can define chat commands without core changes.
- No intent collisions.
- Safe execution with validation + permissions.
