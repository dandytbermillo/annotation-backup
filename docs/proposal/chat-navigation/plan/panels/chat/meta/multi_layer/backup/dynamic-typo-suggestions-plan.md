# Dynamic Typo Suggestions Plan (Panels + Widgets)

**Status:** IMPLEMENTED
**Implementation Date:** 2026-01-05
**Report:** See `dynamic_typo_suggestions_plan_report/README.md`

## Purpose
Replace the static "Try: quick links, recent, workspaces" fallback with dynamic suggestions
based on currently available panels, widgets, and intents so typos resolve to real, local UI.

## Goals
- Fallback suggestions reflect what actually exists (panels/widgets in the current entry).
- Use the LLM as primary; only fall back when it returns unsupported.
- Support typos and pluralization for widget/panel names (e.g., "vuew demo widgets").
- Keep deterministic behavior: show only high-confidence, unambiguous suggestions.

## Non-Goals
- Removing the existing LLM intent prompt or panel registry.
- Full semantic search across note content.
- Auto-executing on low-confidence matches.

## Current Issue
The typo fallback list is hardcoded. It doesn’t include custom widgets like "Demo Widget",
so users see repetitive suggestions even when the system could infer the correct target.

## Proposed Approach
### 1) Dynamic Suggestion Pool
Build a per-request candidate list from:
- Visible panels (Recent, Quick Links, custom widgets)
- Panel registry (DB-loaded widget manifests)
- Core commands (workspaces, dashboard, home)

Suggested candidate fields:
```

Example merged candidate list:
```
[
  { label: "Quick Links D", type: "panel", panelId: "quick-links-d", intentHint: "panel_intent" },
  { label: "Recent", type: "panel", panelId: "recent", intentHint: "panel_intent" },
  { label: "Demo Widget", type: "panel", panelId: "demo-widget-123", intentHint: "panel_intent" },
  { label: "Workspaces", type: "command" },
  { label: "Dashboard", type: "command" },
  { label: "Home", type: "command" }
]
```
{
  label: "Demo Widget",
  type: "panel",             // panel | workspace | entry | command
  panelId: "demo-widget-123", // optional
  intentHint: "panel_intent"  // optional
}
```

### 2) LLM First, Fallback Second
Flow:
1. User message → LLM intent parse
2. If unsupported → run typo suggestion matcher
3. Suggest top 1–3 candidates (high confidence only)

### 3) Confidence Rules
- Use normalized Levenshtein distance with:
  - score >= 0.85
  - best score must exceed second-best by at least 0.07
- If ambiguous, ask: “Did you mean X or Y?”

### 4) Pluralization + Verb Normalization
Normalize:
- “widgets” → “widget”
- “links” → “link”
- “view/show/list/open” → command slot (handled by LLM)

Only apply normalization to command slot and candidate labels, not entity names.

## UI Behavior
When fallback triggers:
- Show a short question:
  “Did you mean Demo Widget?”
- Provide two buttons if applicable:
  - “Open Demo Widget”
  - “List in chat”

## Implementation Steps
1) Build candidate list
   - Add function `getDynamicSuggestionCandidates(context)`
   - Sources: visiblePanels + loaded manifests + core commands
   - Client vs server:
     - Client: use `visiblePanels` and recent chat context
     - Server: merge visiblePanels (from request) with DB-loaded manifests
     - If visiblePanels missing, fall back to manifests + core commands only

2) Expand typo matcher
   - Accept candidate list instead of static list
   - Return top matches with metadata

3) UI rendering
   - Reuse existing suggestion pills
   - Label buttons based on candidate type (panel vs workspace)

4) Prompt update (small)
   - Add rule: “If user says view/show/list/open + widget name, route to panel_intent.”

## Test Checklist
- [x] "vuew demo widgets" → suggests Demo Widget (VERIFIED 2026-01-05)
- [x] "oopen recent" → suggests Recent (VERIFIED 2026-01-05)
- [x] "shwo quick links d" → suggests Quick Links D (VERIFIED 2026-01-05)
- [x] "wrkspaces" → suggests Workspaces (VERIFIED 2026-01-05)
- [ ] Ambiguous: "links" when multiple panels → ask which one (not tested)

## Rollback
- If dynamic suggestions misfire, revert to static list for safety.

## Isolation Reactivity Anti-Patterns
Not applicable. No Isolation context changes.
