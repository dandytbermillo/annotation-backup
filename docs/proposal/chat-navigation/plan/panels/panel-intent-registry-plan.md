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

---

## Validation & Safety
- Strict schema validation for `panel_intent` args.
- Permission check before executing (`read` vs `write`).
- If panel not found or intent unknown → return supported actions.

---

## Versioning Strategy
- Manifest includes `version`.
- Registry only accepts compatible versions.
- Incompatible manifests are ignored with a warning.

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

---

## Success Criteria
- New panels can define chat commands without core changes.
- No intent collisions.
- Safe execution with validation + permissions.
