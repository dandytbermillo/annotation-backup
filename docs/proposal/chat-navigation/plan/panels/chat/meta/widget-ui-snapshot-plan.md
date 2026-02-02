# Widget UI Snapshot Plan (Mixed List + Context)

## Purpose
Provide a structured, semantic UI snapshot so the assistant can reliably distinguish:
- selectable list items (for selection-like inputs), and
- informational widget context (for explanation-like inputs),
without relying on raw HTML/CSS or fragile heuristics.

This plan defines the **data contract** that feeds the existing routing spine and the grounding-set fallback.
It does **not** replace those plans. It supplies a consistent, machine-readable snapshot that enables them.

## Scope
- Applies to widgets/panels that are visible in the UI.
- Supports mixed widgets (list + context in the same widget).
- Enables shorthand handling ("panel e", "the other one") when a list is present.
- Enables context answers ("what is this widget", "explain this") when no list selection is intended.

## Non-Goals
- Do not parse raw HTML or CSS.
- Do not let the LLM invent new labels, IDs, or actions.
- Do not merge openWidgets and widgetStates into a single untyped blob.

## Core Principle
**Every visible widget must expose a structured snapshot with segments.**
Each segment is either:
- `segmentType: "list"` (selectable items), or
- `segmentType: "context"` (informational state).

This preserves the rule:
- **selection-like input → list segment**
- **context-like input → context segment**

## UI Snapshot Schema (v1.1)
```json
{
  "uiSnapshotVersion": "1.0",
  "uiSnapshotId": "snap_018f",
  "revisionId": 42,
  "capturedAtMs": 1738440000000,
  "activeWidgetId": "w_panel",
  "widgets": [
    {
      "widgetId": "w_panel",
      "title": "Links Panels",
      "isVisible": true,
      "segments": [
        {
          "segmentId": "w_panel:list",
          "segmentType": "list",
          "listLabel": "Panels",
          "badgesEnabled": true,
          "visibleItemRange": { "start": 0, "end": 4 },
          "items": [
            { "itemId": "panel_d", "label": "Links Panel D", "badge": "D", "badgeVisible": true, "actions": ["open"] },
            { "itemId": "panel_e", "label": "Links Panel E", "badge": "E", "badgeVisible": true, "actions": ["open"] }
          ],
          "focusItemId": "panel_d"
        },
        {
          "segmentId": "w_panel:context",
          "segmentType": "context",
          "summary": "Select a panel to open it. Shows quick links grouped by panel.",
          "currentView": "Panels overview",
          "focusText": "Links Panel D"
        }
      ]
    }
  ],
  "selectionMemory": {
    "activeOptionSetId": "w_panel:list",
    "lastOptionsShown": {
      "optionSetId": "w_panel:list",
      "items": [
        { "itemId": "panel_d", "label": "Links Panel D", "badge": "D" },
        { "itemId": "panel_e", "label": "Links Panel E", "badge": "E" }
      ],
      "ttlTurnsRemaining": 2
    }
  }
}
```

## Selection-Like Detector (Deterministic)
Treat input as selection-like if it matches any of:
- Ordinals: `first|second|third|fourth|fifth|last` or `1|2|3|4|5|#2|2nd`
- Badge tokens: single letter only if `badgeVisible` or `badgesEnabled` is true
- Shorthand patterns: `panel d`, `option e`, `item b`, `the other one`, `next one`, `previous one`
- Unique token subset of a list label (unique match only)

If not selection-like, treat as context-like.

## Routing Rules (Mixed Widget)
### Rule A: Context-like input
- Use the active widget's `context` segment to answer.
- Do not clear selection memory.
- Do not trigger list selection.

### Rule B: Selection-like input
Resolve only against list segments:
1. `activeOptionSetId` if present.
2. Else `lastOptionsShown` (soft-active, TTL-limited).
3. If multiple list segments visible, ask which list (do not guess).

### Precedence Clarification (activeWidgetId vs activeOptionSetId)
- **Context-like input**: always use `activeWidgetId` to choose the context segment.
- **Selection-like input**: always use `selectionMemory.activeOptionSetId` (or soft-active) for list binding.
- If they disagree, **selection-like routing wins** for selection-like inputs; context routing uses `activeWidgetId` only for context-like inputs.

### Rule C: Multi-list ambiguity
If two or more list segments are visible and input is selection-like:
- Ask: "Which list do you mean?" with widget/list buttons.
- Also allow typing the widget name.

## Soft-Active Selection Memory
Maintain `lastOptionsShown` for **2 turns** after list display, even across context questions.
Clear only when:
- explicit stop/cancel confirmed, or
- a new list replaces it.

## LLM Usage (Constrained, Deterministic-First)
Only use the LLM when deterministic matching **cannot uniquely resolve**.

Contract:
- Input: user text + candidate items (id + label + badge), optional context summary.
- Output: `selectedItemId` or `need_more_info` only.
- Never allow new labels or free-form actions.

Order:
1. Deterministic unique match → execute.
2. Constrained LLM pick → execute.
3. Otherwise ask grounded clarification ("D or E?").

## Freshness Guard
Only bind to list items if:
- `uiSnapshotId` is the most recent known snapshot, and
- `capturedAtMs` is within the active/soft-active TTL window.
This prevents binding to stale UI after rapid widget changes.

## Integration Points
This plan supplies the **UI Snapshot contract** to the routing system:
- The grounding-set fallback consumes list segments as candidates.
- Context-like inputs should be answered using `context` segments.
- The selection-like detector is a shared utility (used by both routing and fallback).

## Context Answer Source Rule
If the user asks about an item (e.g., "what does Panel E mean?"):
- If the item has its own context segment or item-level description, use it.
- Otherwise answer from widget-level context and offer to open the item.

## Acceptance Tests
### Mixed widget + context query
1. List D/E visible + context segment present.
2. User: "panel d" → opens D.
3. User: "what does this widget mean?" → context answer.
4. User: "panel e" → opens E (soft-active snapshot).

### Multi-list ambiguity
1. Two widgets with list segments visible.
2. User: "first option" → asks which list (buttons shown).
3. User picks widget name → executes first option in that widget list.

### Non-list widget
1. Widget has only a context segment (no list).
2. User: "summarize this widget" → responds from context.

## Notes
- This plan is list-agnostic: lists are just one segment type.
- Do not merge openWidgets and widgetStates; instead, map both into widget segments.
- The routing spine and grounding-set fallback remain the execution layer.
