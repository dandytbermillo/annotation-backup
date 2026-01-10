# Missing Widget Panel Intents Plan

## Problem
Some visible dashboard widgets (Navigator, Quick Capture, Links Overview, Continue, Widget Manager) do not have panel intents. When users say "open Navigator" or "open Quick Capture," the LLM falls back to entry/workspace resolution and fails. "Open recents" works because Recent has a panel manifest.

## Goal
Ensure "open <widget name>" routes to the correct panel drawer for all built-in widgets shown on the dashboard.

## Non-Goals
- No new widget UI changes.
- No changes to selection/ordinal logic unless needed for pills already shown.
- No changes to custom widget install flow.

## Proposed Approach
Add panel manifests and panel intents for missing built-in widgets. Use existing panel registry patterns to ensure LLM routing resolves to panel_intent instead of entry/workspace lookup.

## Temporary Bridge (Optional)
If needed before manifests are added, add a prompt rule:
- If user says "open <widget name>" and <widget name> matches `uiContext.dashboard.visibleWidgets`, route to `panel_intent` (drawer).
This is a stopgap; the manifest approach remains the durable solution.

## Scope
Widgets to cover (built-in):
- Navigator
- Quick Capture
- Links Overview
- Continue
- Widget Manager

## Implementation Steps
1. Add panel manifests (or extend existing) for the missing widgets.
   - Define panelId, panelType, title, intents with show/list/open action.
   - Ensure handler uses existing panel API endpoints or drawer open path.
2. Register these manifests in the panel registry (if not already auto-registered).
3. Add prompt examples for each widget name:
   - "open navigator" → panel_intent
   - "open quick capture" → panel_intent
   - "open links overview" → panel_intent
   - "open continue" → panel_intent
   - "open widget manager" → panel_intent
4. Verify panel_intent routing uses drawer open action.

## Acceptance Criteria
- "open navigator" opens Navigator drawer.
- "open quick capture" opens Quick Capture drawer.
- "open links overview" opens Links Overview drawer.
- "open continue" opens Continue drawer.
- "open widget manager" opens Widget Manager drawer.
- No "No entry or workspace found" errors for these commands.

## Test Checklist
- On dashboard, ask "what widgets are visible?" then "open <widget name>" for each listed widget.
- Confirm drawer opens and "What panel is open?" returns the correct widget.

## Rollback
- Remove the added manifests and prompt examples; fallback behavior returns to entry/workspace resolution.
