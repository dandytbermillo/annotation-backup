# Widget Registry Architecture Reference

**Status:** Reference (derived from implementation)
**Last updated:** 2026-02-09
**Source plan:** `widget-registry-implementation-plan.md`
**Companion plan:** `widget-ui-snapshot-plan.md`
**Implementation report:** `reports/2026-02-02-widget-registry-session-report.md`

## What "Widget Registry" Means

The widget registry is a 3-layer architecture, not a single file. It is the **data provider** that feeds structured widget state into the routing system. The **data consumer** is the `universal-selection-resolver-plan.md`, which defines how routing behaves with that data.

---

## 3-Layer Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: Widget Snapshot Registry                               │
│ File: lib/widgets/ui-snapshot-registry.ts                       │
│ Role: Ephemeral in-memory store — widgets self-register         │
│       structured snapshots on mount/visibility/data change      │
│ Writer: Individual widgets (RecentPanel, QuickLinksWidget, etc) │
│ Reader: Layer 2 (snapshot builder)                              │
└──────────────────────────┬──────────────────────────────────────┘
                           │ getAllVisibleSnapshots()
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 2: Snapshot Builder                                       │
│ File: lib/chat/ui-snapshot-builder.ts                           │
│ Role: Per-turn assembly — buildTurnSnapshot() reads Layer 1     │
│       + chat state, produces OpenWidgetState[] for routing      │
│ Writer: N/A (assembles, does not persist)                       │
│ Reader: Layer 3 (routing dispatcher)                            │
└──────────────────────────┬──────────────────────────────────────┘
                           │ openWidgets[], activeSnapshotWidgetId
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 3: Routing Integration                                    │
│ Files: lib/chat/routing-dispatcher.ts + lib/chat/grounding-set.ts│
│ Role: Tier 4.5 consumes the built snapshot for widget item      │
│       matching via resolveWidgetSelection(),                    │
│       checkMultiListAmbiguity(), isSelectionLike()              │
│ Writer: Routing system (chat-created options at Tier 3 only)    │
│ Reader: Grounding-set resolution logic                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow (Per Chat Turn)

```text
1. Widgets self-register
   RecentPanel, QuickLinksWidget, etc.
     → registerWidgetSnapshot({ widgetId, title, segments, ... })
     → Layer 1 (ui-snapshot-registry)

2. Chat turn fires
   routing-dispatcher calls buildTurnSnapshot()
     → Layer 2 reads Layer 1 via getAllVisibleSnapshots()
     → Applies freshness guard (rejects stale registrations)
     → Maps list segments to OpenWidgetState[]
     → Returns { openWidgets, activeSnapshotWidgetId }

3. Routing runs at Tier 4.5
   routing-dispatcher passes openWidgets to buildGroundingContext()
     → resolveWidgetSelection() for widget-specific ordinals
     → checkMultiListAmbiguity() for multi-widget disambiguation
     → isSelectionLike() for detection gate
```

---

## Tier 3 / Tier 4.5 Boundary (Critical Rule)

This boundary prevents the failure mode where widget items and chat options mix in the same resolution path.

| Tier | Handles | State | Owner |
|------|---------|-------|-------|
| **Tier 3** | Chat-created options (panel disambiguation, meta-explain, known-noun prompts, re-show) | `pendingOptions`, `activeOptionSetId`, `lastClarification`, `lastOptionsShown`, `clarificationSnapshot` | Routing system |
| **Tier 4.5** | Widget-registered lists (recent workspaces, quick links, etc.) | `OpenWidgetState[]` built from snapshot registry | Widget registry via builder |

**The two tiers never share candidate lists.** Tier 3 fires first. If Tier 3 handles the input, Tier 4.5 never runs.

Examples:
- Chat shows "Panel D or Panel E?" pills (from Tier 2c via `uiContext.dashboard.visibleWidgets`), user says "D" → **Tier 3** handles the selection. Snapshot registry not consulted.
- User says "first option in the recent widget" with no active chat options → Tier 3 passes → Tier 4 passes → **Tier 4.5** queries snapshot registry via builder, resolves.

---

## Registry and Data Source Comparison

| Data Source | File / Path | Purpose | Used At |
|-------------|-------------|---------|---------|
| **Widget Snapshot Registry** | `lib/widgets/ui-snapshot-registry.ts` | Widget list items for selection resolution | Tier 4.5 (grounding-set) |
| **Visible Widgets (React context)** | `uiContext.dashboard.visibleWidgets` | Panel title matching for deterministic commands | Tier 2c (`handlePanelDisambiguation` via `panel-command-matcher.ts`) |
| **Panel Intent Registry** | `lib/panels/panel-registry.ts` | Panel chat manifests (built-in + DB-loaded) for LLM prompt | LLM system prompt (Tier 5 via `intent-prompt.ts`) |
| **Widget State Store** | `lib/widgets/widget-state-store.ts` | Aggregate summaries for LLM context | LLM prompt (not routing) |

### Tier 2c Panel Command Path (Important Distinction)

Panel-level commands ("open links panel", "show recent") go through `uiContext.dashboard.visibleWidgets` — the React context path — **not** through the widget snapshot registry or the panel intent registry.

```text
User: "open links panel d"
  → Tier 2c: handlePanelDisambiguation()
    → reads ctx.uiContext.dashboard.visibleWidgets        (React context)
    → calls matchVisiblePanelCommand() in panel-command-matcher.ts
    → tokenizes visible widget titles for deterministic matching
    → executes panel open or shows disambiguation pills

NOT involved in this path:
  - ui-snapshot-registry.ts (widget item resolution only, Tier 4.5)
  - panel-registry.ts (LLM prompt vocabulary only, Tier 5)
```

The widget snapshot registry is only consulted for **widget item resolution** (e.g., "open summary144" → find which widget has that item) and **active widget tracking** (e.g., latch knows Links Panel D is focused via `getActiveWidgetId()`).

### Store Independence

These four data sources are independent:
- Widgets call both the **snapshot registry** and **widget state store** in their `useEffect`.
- The **visible widgets** React context is populated by the dashboard layout, not by any registry.
- The **panel intent registry** (`lib/panels/panel-registry.ts`) aggregates built-in manifests and dynamically loads DB manifests; it tracks visible/focused panels for LLM prompt construction via `buildPromptSectionWithDBManifests()`.

---

## Provider / Consumer Relationship

| Role | Plan | What it defines |
|------|------|----------------|
| **Provider** | `widget-registry-implementation-plan.md` | How data gets into the system (3-layer architecture, registration lifecycle, snapshot schema, freshness guards) |
| **Consumer** | `universal-selection-resolver-plan.md` | How routing uses the data (Tier 3.5 resolver, `WidgetSelectionContext`, registration helpers, clear rules, constrained LLM fallback) |

The provider plan is **fully implemented** (all steps complete as of 2026-02-02, commit `e2bd3e3f`).
The consumer plan is **partially implemented** (Phases 1, 4, 5, 6 complete; Phase 2 helpers and Phase 3 option-creation sites partial; `uiOnly` flag and observability logs not yet implemented).

---

## Key Types (Layer 1)

| Type | Fields | Purpose |
|------|--------|---------|
| `SnapshotListItem` | `itemId`, `label`, `badge?`, `badgeVisible?`, `actions[]` | Single selectable item within a widget list |
| `SnapshotListSegment` | `segmentId`, `segmentType: "list"`, `listLabel`, `badgesEnabled`, `visibleItemRange`, `items[]`, `focusItemId?` | A list of items exposed by a widget |
| `SnapshotContextSegment` | `segmentId`, `segmentType: "context"`, `summary`, `currentView`, `focusText?` | Non-list context info about a widget's state |
| `WidgetSnapshot` | `_version: 1`, `widgetId`, `title`, `isVisible`, `segments[]`, `registeredAt`, `panelId?` | Full snapshot registered by a widget |

---

## Widget Reporters (Who Registers)

| Widget | widgetId | Registers | File |
|--------|----------|-----------|------|
| RecentPanel | `w_recent` | List segment (recent workspaces) + context segment | `components/dashboard/panels/RecentPanel.tsx` |
| RecentWidget | `w_recent_widget` | List segment (workspaces) + context segment | `components/dashboard/widgets/RecentWidget.tsx` |
| QuickLinksWidget | Dynamic: `w_links_<badge>` (e.g., `w_links_d`) or `w_links` if no badge | List segment (link items) | `components/dashboard/widgets/QuickLinksWidget.tsx` (line 125) |
| DashboardView | N/A | Sets `activeWidgetId` on chat-triggered drawer open (line 1134) and drawer close (line 1100) — not every drawer-open path | `components/dashboard/DashboardView.tsx` |

---

## Registration Lifecycle

| Event | Action |
|-------|--------|
| Widget mounts (becomes visible) | `registerWidgetSnapshot()` with initial data |
| Data changes (items loaded, filter applied) | `registerWidgetSnapshot()` again (overwrites previous) |
| Visibility toggle (drawer opens/closes) | Update `isVisible` via `registerWidgetSnapshot()` |
| Widget unmounts (removed from DOM) | `unregisterWidgetSnapshot()` |

---

## Source of Truth

- Architecture and layer responsibilities: `widget-registry-implementation-plan.md`
- Snapshot schema and contract: `widget-ui-snapshot-plan.md`
- Implementation evidence: `reports/2026-02-02-widget-registry-session-report.md`
- Consumer routing behavior: `universal-selection-resolver-plan.md`
