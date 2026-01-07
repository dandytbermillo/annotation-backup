# Widget Chat State Contract

Purpose: make chat aware of what each widget is doing right now so it can answer
user questions without guessing. This applies to both built-in widgets and
third-party widgets.

## Scope

- Covers widget-specific state that is NOT already known by the host.
- The host already knows open/close because the drawer state lives in
  `DashboardView`. Widgets do NOT need to report open/close.
- Widgets MUST report internal state that affects answers (selected item,
  active tab, applied filter, etc.).

## Required Data (Minimum)

Each widget instance must report a minimal state object when it changes:

- _version (number)            // schema version (start at 1)
- widgetId (string)
- instanceId (string)
- title (string)
- view (string | null)         // e.g., "list", "details", "settings"
- selection (object | null)    // { id, label } for selected item
- summary (string | null)      // 1-2 line human summary
- updatedAt (number, ms)

This is the minimum needed for chat to answer:
- "What is this widget showing?"
- "Which item is selected?"
- "Are you on the settings tab?"

## Optional Fields (If Applicable)

- filters: string[]            // e.g., ["today", "unread"]
- counts: Record<string, number>
- contextTags: string[]        // lightweight tags for LLM grounding
- actions: Array<"select" | "filter" | "refresh" | "close"> // optional capability hints

## Reporting Rules

Widgets must report state:

1. On mount (initial state)
2. On view change (tab switch)
3. On selection change
4. On filter change
5. On close/unmount (optional: send view = null)

Widgets SHOULD debounce state reports (recommended: 300ms) to avoid excessive\n+updates during rapid interactions.

## How the Host Uses This

The host stores the latest state per widget instance and injects it into
`uiContext.dashboard.widgetStates`:

uiContext.dashboard.widgetStates = {
  "panel-123": {
    _version: 1,
    title: "Quick Links D",
    view: "list",
    selection: { id: "summary144", label: "summary144" },
    summary: "Showing 2 links",
    updatedAt: 1736200000000
  }
}

The LLM can then answer:
- "What is Quick Links D showing?"
- "Is any item selected?"
- "How many links are visible?"

## Stale State Handling

If updatedAt is older than 60 seconds and the widget is still mounted, the host\n+MAY mark the state as stale (stale: true) and the LLM should answer with a\n+warning such as: "This may be out of date."

## Built-In Widgets

Built-in widgets should call a host helper (e.g., `setWidgetState`) when their
internal state changes. This keeps them consistent with third-party widgets.

## Third-Party Widgets (Sandbox)

Widgets use the sandbox bridge to report state:

- `widget.reportState(state)`

The host validates and stores it under the widget instance ID. This is the
required path for all custom widgets.

## Safety & Privacy

- Do NOT send raw content or full lists.
- Use short summaries and labels only.
- Cap string length (e.g., 120 chars per field).

## Host Responsibilities

- Store the latest state per widget instance in `uiContext.dashboard.widgetStates`.
- Prune stale entries when a widget unmounts or has not updated beyond the\n+  configured timeout (default: 60 seconds).\n+- Ignore updates from widgets that are disabled or not mounted.\n+- Validate required fields and drop invalid payloads silently (log warnings for debug).

## Acceptance Criteria

- Chat can answer "What is open in Widget X?" without DB lookups.
- Chat can answer "Is item Y selected?" when a widget reports selection.
- No widget state is sent without explicit reporting.

## Edge Cases

- Widget reports state before mount completes → host queues and applies after registration\n+- Widget sends invalid state (missing required field) → host rejects silently and logs warning\n+- Two widgets with same widgetId but different instanceId → stored separately (multi-instance)\n+- Widget unmounts without final report → host clears state on unmount or after timeout\n+
## Acceptance Tests

- View query: widget reports view "settings" → "Is it on settings?" → "Yes, it's on the settings tab."\n+- Selection query: widget reports selection summary144 → "What's selected?" → "summary144 is selected."\n+- Stale state: updatedAt older than 2 minutes → "What's selected?" → "It may be out of sync..."\n+- Multi-instance: two Quick Links widgets open → "What's selected in Quick Links?" → "Which one—D or E?"
