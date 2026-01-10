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

## Manifest Skeletons (Ready to Paste)

Targets:
- `lib/panels/manifests/navigator-panel.ts`
- `lib/panels/manifests/quick-capture-panel.ts`
- `lib/panels/manifests/links-overview-panel.ts`
- `lib/panels/manifests/continue-panel.ts`
- `lib/panels/manifests/widget-manager-panel.ts`

Template:
```ts
import { createPanelManifest, createIntent } from '../create-manifest'

export const <WidgetName>PanelManifest = createPanelManifest({
  panelId: '<panel-id>',
  panelType: '<panel-type>',
  title: '<Widget Title>',
  intents: [
    createIntent({
      name: 'open_panel',
      description: 'Open <Widget Title> drawer',
      examples: [
        'open <widget name>',
        'show <widget name>',
        'view <widget name>',
      ],
      handler: 'api:/api/panels/<panel-id>/open',
      permission: 'read',
    }),
  ],
})
```

Concrete IDs / Titles:
- Navigator
  - panelId: `navigator`
  - panelType: `navigator`
  - title: `Navigator`
- Quick Capture
  - panelId: `quick-capture`
  - panelType: `quick_capture`
  - title: `Quick Capture`
- Links Overview
  - panelId: `links-overview`
  - panelType: `category_navigator`
  - title: `Links Overview`
- Continue
  - panelId: `continue`
  - panelType: `continue`
  - title: `Continue`
- Widget Manager
  - panelId: `widget-manager`
  - panelType: `widget_manager`
  - title: `Widget Manager`

## Handler Strategy
- Option A: Add one `open` route per panel (e.g., `/api/panels/navigator/open`).
- Option B (preferred): Add a shared `open-drawer` handler and point all manifests to it.

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

---

## Implementation Status (2025-01-09)

### Approach Taken: Temporary Bridge ✅

We implemented the **Temporary Bridge** approach instead of the full panel manifest approach. This provides immediate functionality while the manifest approach remains available for future enhancement.

### What Was Implemented

| Component | Description | File | Lines |
|-----------|-------------|------|-------|
| Step 0: visibleWidgets match | Check if panelId matches visible widget title → open immediately | `lib/chat/intent-resolver.ts` | 2488-2502 |
| LLM prompt rule | "open X" with visible widgets → use panel_intent | `lib/chat/intent-prompt.ts` | 453-457 |
| Context passing | Pass visibleWidgets from uiContext to resolver | `app/api/chat/navigate/route.ts` | - |
| visibleWidgets type | Added to ResolutionContext | `lib/chat/resolution-types.ts` | - |

### What Was NOT Implemented

- Panel manifests for Navigator, Quick Capture, Links Overview, Continue, Widget Manager (Steps 1-2)
- Widget-specific intents beyond "open" (list, show, etc.)
- Panel registry entries for these widgets

### Acceptance Criteria Status

| Command | Expected | Status |
|---------|----------|--------|
| "open navigator" | Opens Navigator drawer | ✅ Tested, works |
| "open quick capture" | Opens Quick Capture drawer | ✅ Tested, works |
| "open links overview" | Opens Links Overview drawer | ✅ Tested, works |
| "open continue" | Opens Continue drawer | ✅ Tested, works |
| "open widget manager" | Opens Widget Manager drawer | ✅ Tested, works |

**All 5/5 acceptance criteria verified on 2025-01-09.**

Bonus: Natural language variations also work (e.g., "open widget manager pls", "open navigator pls").

### Related Implementation

During this work, we also implemented the **Panel Intent Ambiguity Guard** (see `panel-intent-ambiguity-guard-plan.md`):
- Multi-step disambiguation (Steps 0-3)
- Quick Links badge differentiation
- LLM prompt hardening for "open links"
- Fuzzy match confirm pill ("Did you mean X?")

### Report Location

Full implementation report: `missing_widget_panel_intents_plan_report/2025-01-09-implementation-report.md`

Note: The report covers both the Temporary Bridge implementation AND the Ambiguity Guard implementation, as they were developed together.

### Full Manifest Implementation (2025-01-09)

Upgraded from Temporary Bridge to full manifest approach:

#### Files Created

| File | Description |
|------|-------------|
| `app/api/panels/open-drawer/route.ts` | Shared open-drawer API handler (Option B) |
| `lib/panels/manifests/navigator-panel.ts` | Navigator panel manifest |
| `lib/panels/manifests/quick-capture-panel.ts` | Quick Capture panel manifest |
| `lib/panels/manifests/links-overview-panel.ts` | Links Overview panel manifest |
| `lib/panels/manifests/continue-panel.ts` | Continue panel manifest |
| `lib/panels/manifests/widget-manager-panel.ts` | Widget Manager panel manifest |

#### Files Modified

| File | Change |
|------|--------|
| `lib/panels/panel-registry.ts` | Added imports and registration for all 5 widget manifests |

#### Handler Strategy

Used **Option B (preferred)**: Single shared `/api/panels/open-drawer` handler that:
1. Maps semantic panelId (e.g., "navigator") to panel_type (e.g., "navigator")
2. Looks up the panel in the dashboard workspace
3. Returns `action: 'open_panel_drawer'` with the actual panel UUID

#### Flow with Full Manifests

```
User: "open navigator"
  ↓
LLM: { intent: "panel_intent", args: { panelId: "navigator", intentName: "open_drawer" } }
  ↓
Intent Resolver:
  1. Step 0: Check visibleWidgets → Found → Return immediately
  OR (if Step 0 fails):
  2. executePanelIntent() → calls /api/panels/open-drawer
  ↓
Result: { action: "open_panel_drawer", panelId: <UUID>, panelTitle: "Navigator" }
```

#### Notes

- Temporary Bridge (Step 0: visibleWidgets match) is still active and provides fast resolution
- Full manifests add LLM prompt examples for better intent recognition
- Full manifests serve as fallback when visibleWidgets doesn't match
- Each manifest uses `open_drawer` intent pointing to shared handler

#### Test Results (2025-01-09)

| Command | Intent Routing | Drawer Opened | Status |
|---------|---------------|---------------|--------|
| "open quick capture" | ✅ | ✅ | PASS |
| "open widget manager pls" | ✅ | ✅ | PASS |
| "can you pls open recents" | ✅ | ✅ | PASS |
| "open continue" | ✅ | ✅ | PASS |
| "open navigator pls" | ✅ | ✅ | PASS |

**All 5/5 acceptance criteria verified.**

#### Future Work (Optional)

To extend beyond just "open":
1. Add widget-specific intents (list items, show details, etc.)
2. Create dedicated API handlers for complex operations
