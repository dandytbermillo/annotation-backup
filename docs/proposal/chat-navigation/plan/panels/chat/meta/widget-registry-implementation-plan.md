# Widget Registry Implementation Plan

> Companion to: `widget-ui-snapshot-plan.md`
> This plan defines the **implementation architecture** that makes the snapshot plan's contract realizable.
> The snapshot plan defines *what* the data looks like. This plan defines *where it lives, who writes it, who reads it, and how it enters the routing system*.

---

## Problem Summary

The snapshot plan requires every visible widget to expose a structured snapshot with typed segments (list + context). Previously:

1. `widget-state-store.ts` reports only aggregate summaries (no individual items).
2. `OpenWidgetState` in `grounding-set.ts` expects widget list items but always receives `[]`.
3. `saveLastOptionsShown` was only called at 3 post-dispatch API response sites — it did not cover dispatcher-created options (Tier 2c, meta-explain, known-noun). **Now wired at all option-creation sites.**
4. A previous attempt to wire widget items directly into `chat-navigation-context.tsx` failed because widget-registered items interfered with chat-created options (`pendingOptions` / `activeOptionSetId`), causing the wrong option to execute in the active widget list.

---

## Root Cause of Previous Failure

The previous implementation collapsed two separate concerns into one path:

| Concern | Owner | State | Tier |
|---------|-------|-------|------|
| **Chat-created options** (e.g., "Panel D or Panel E?" pills) | Routing system | `pendingOptions`, `activeOptionSetId`, `lastOptionsShown` | Tier 3 |
| **Widget-visible items** (e.g., recent workspaces in the drawer) | Widget itself | Was pushed into the same `openWidgets` array | Tier 4.5 |

When both entered the same resolution path, the routing system could not distinguish which list to bind to. The fix is architectural: these two data sources must enter routing at **different tiers** and never mix.

---

## Architecture: 3 Layers

```
Layer 1: Widget Registry (source of truth)
  lib/widgets/ui-snapshot-registry.ts
  - Widgets self-register structured snapshots on mount/visibility
  - Widgets unregister on unmount/hide
  - Pure ephemeral in-memory store (session-scoped)
  - Router is a read-only consumer — never writes to registry

Layer 2: Snapshot Builder (per chat turn)
  lib/chat/ui-snapshot-builder.ts
  - Reads registry (widget segments) + chat state (selection memory)
  - Assembles the full uiSnapshot object per the snapshot plan schema
  - Applies freshness guard (rejects stale registrations)
  - Maps list segments to OpenWidgetState[] for grounding-set

Layer 3: Routing + Grounding (existing, modified)
  lib/chat/routing-dispatcher.ts — calls snapshot builder at Tier 4.5
  lib/chat/grounding-set.ts — already has resolveWidgetSelection,
                                checkMultiListAmbiguity, isSelectionLike
  lib/chat/chat-navigation-context.tsx — saveLastOptionsShown wired to dispatcher
```

### Layer Responsibilities (strict)

| Layer | Writes | Reads | Routing Tier |
|-------|--------|-------|-------------|
| Widget Registry | Widgets write snapshots | Snapshot builder reads | N/A (data store) |
| Snapshot Builder | N/A (assembles, does not persist) | Registry + chat state | Called at Tier 4.5 |
| Routing / Grounding | Chat-created options (Tier 3) | Snapshot builder output (Tier 4.5) | Tier 3 and Tier 4.5 (separate) |

---

## Critical Rule: Tier 3 / Tier 4.5 Boundary

This is the rule that prevents the previous failure from recurring.

**Tier 3** handles **chat-created options** only:
- `pendingOptions` (active option pills in chat)
- `activeOptionSetId` (when a list is currently active)
- `clarificationSnapshot` (post-action ordinal window)
- `lastOptionsShown` (soft-active TTL window)

**Tier 4.5** handles **widget-registered lists** only:
- `OpenWidgetState[]` built from the snapshot registry
- Resolved via `resolveWidgetSelection` and `checkMultiListAmbiguity`

**The two tiers never share candidate lists.** Tier 3 fires first. If Tier 3 handles the input (because chat options are active), Tier 4.5 never runs. Tier 4.5 only runs when Tier 3 has nothing to bind to and Tier 4 (known-noun) also did not handle it.

This means:
- When chat shows "Panel D or Panel E?" pills and user says "D" → Tier 3 handles it. Widget registry is not consulted.
- When user says "first option in the recent widget" with no active chat options → Tier 3 passes. Tier 4 passes. Tier 4.5 queries the registry, finds Recent's list segment, resolves "first option."

---

## Layer 1: Widget Registry

### File: `lib/widgets/ui-snapshot-registry.ts`

### Design: Pull Model
Widgets register snapshots; the snapshot builder pulls current state when needed (once per chat turn). No events, no subscriptions, no push notifications.

### Types

```
SnapshotListItem
  itemId: string           — stable, unique within widget
  label: string            — human-readable display text
  badge?: string           — single-letter badge (e.g., "D")
  badgeVisible?: boolean   — whether badge is rendered
  actions: string[]        — allowed actions (e.g., ["open"])

SnapshotListSegment
  segmentId: string        — e.g., "w_recent:list"
  segmentType: "list"
  listLabel: string        — e.g., "Recent Workspaces"
  badgesEnabled: boolean
  visibleItemRange: { start: number, end: number }
  items: SnapshotListItem[]
  focusItemId?: string     — currently focused/highlighted item

SnapshotContextSegment
  segmentId: string        — e.g., "w_recent:context"
  segmentType: "context"
  summary: string          — 1-2 line description
  currentView: string      — e.g., "list", "drawer"
  focusText?: string       — currently focused text

SnapshotSegment = SnapshotListSegment | SnapshotContextSegment

WidgetSnapshot
  _version: 1              — schema version (registry rejects unrecognized versions)
  widgetId: string         — unique widget key (e.g., "w_recent")
  title: string            — human-readable (e.g., "Recent")
  isVisible: boolean
  segments: SnapshotSegment[]
  registeredAt: number     — Date.now() when registered
```

### Functions

```
registerWidgetSnapshot(snapshot: WidgetSnapshot): void
  — Validates and stores. Overwrites previous registration for same widgetId.

unregisterWidgetSnapshot(widgetId: string): void
  — Removes on unmount/hide.

getWidgetSnapshot(widgetId: string): WidgetSnapshot | null
  — Single widget lookup.

getAllVisibleSnapshots(): WidgetSnapshot[]
  — Returns all snapshots where isVisible === true.

setActiveWidgetId(id: string | null): void
getActiveWidgetId(): string | null
  — Tracks which widget is currently focused/active (e.g., open drawer).
```

### Registration Lifecycle Rules

Widgets must register/update/unregister at these points:

| Event | Action |
|-------|--------|
| **Mount** (widget becomes visible) | `registerWidgetSnapshot()` with initial data |
| **Data change** (items loaded, list updated, filter applied) | `registerWidgetSnapshot()` again (overwrites previous) |
| **Visibility toggle** (drawer opens/closes, tab switch) | Update `isVisible` field via `registerWidgetSnapshot()` |
| **Unmount** (widget removed from DOM) | `unregisterWidgetSnapshot()` |

This matches the existing `upsertWidgetState` pattern: widgets call it inside `useEffect` with data dependencies, so it re-fires whenever the underlying data changes (e.g., Recent panel loads new items, user opens a workspace and the list updates).

### Contract Rules (enforced by registry)
- `_version` must be `1`. Registry rejects snapshots with unrecognized versions (prevents stale widget components from poisoning the store after a schema change).
- `segments` must contain only typed segments (`list` or `context`). No untyped blobs.
- `SnapshotListItem.itemId` must be non-empty and unique within the segment.
- `SnapshotListItem.actions` must be non-empty (at least one action like `"open"`).
- `title` and `label` fields are truncated at 120 chars (same as widget-state-store).
- `items` array capped at 20 items (prevents unbounded lists).
- `summary` capped at 200 chars.

### Relationship to Widget State Store

| | Widget State Store | Widget Registry |
|---|---|---|
| File | `lib/widgets/widget-state-store.ts` | `lib/widgets/ui-snapshot-registry.ts` |
| Consumer | LLM / intent-prompt | Routing system / grounding-set |
| Contains | Summaries, counts, view state | Structured segments with list items |
| Purpose | Answer "what is this widget showing?" | Resolve "first option in recent widget" |
| Merged? | **No** — snapshot plan says "Do not merge openWidgets and widgetStates" |

Widgets call both stores in their `useEffect`. The two stores are independent.

---

## Layer 2: Snapshot Builder

### File: `lib/chat/ui-snapshot-builder.ts`

### Purpose
Assembles the per-turn snapshot by joining:
- Widget Registry data (segments)
- Chat navigation state (selection memory)

### Functions

```
buildTurnSnapshot(params):
  Input:
    visibleSnapshots: WidgetSnapshot[]    — from registry
    activeWidgetId: string | null         — from registry
    activeOptionSetId: string | null      — from chat state (Tier 3)
    lastOptionsShown: LastOptionsShown | null — from chat state
  Output:
    openWidgets: OpenWidgetState[]        — for grounding-set consumption
    activeSnapshotWidgetId: string | null  — widget with focus

getWidgetListItems(widgetId, segmentId?):
  Input: widget ID, optional segment ID for multi-list widgets
  Output: ClarificationOption[]           — mapped from SnapshotListItem
  Maps: itemId → id, label → label, "widget_option" → type
```

### Freshness Guard
- Each `WidgetSnapshot.registeredAt` is checked against a threshold (configurable).
- Stale snapshots (widget mounted but hasn't re-registered) are excluded from `openWidgets`.
- This prevents binding to stale UI after rapid widget changes.

### Why No Global `uiSnapshotId` / `revisionId` in v1
The pull model rebuilds the snapshot fresh each turn from the registry. There is no cached snapshot to version. Per-widget `registeredAt` is sufficient for freshness. Global IDs can be added later if snapshot caching becomes necessary.

---

## Layer 3: Routing Integration

### 3a. Dispatcher Changes (`routing-dispatcher.ts`)

**New context fields:**
- `getVisibleSnapshots: () => WidgetSnapshot[]` — reads registry
- `getActiveWidgetId: () => string | null` — reads registry
- `clearLastOptionsShown: () => void` — clears soft-active state

**Tier 2a (Explicit Command Bypass) — state clearing:**
When an explicit verb command is detected (e.g., "open recent widget"):
- **Do NOT** clear `lastOptionsShown` on explicit commands.
- Only clear `lastOptionsShown` when:
  - user confirms stop/cancel, or
  - a new options list is shown (replaces it), or
  - TTL expires naturally.
- Clear non-paused `clarificationSnapshot` — prevents stale post-action window
- Do NOT clear paused snapshots (they represent interrupted flows the user may return to)

**Tier 4.5 (Grounding-Set Fallback) — snapshot consumption:**
```
1. Call buildTurnSnapshot() with registry data + chat state
2. Pass resulting openWidgets to buildGroundingContext()
3. Existing grounding-set logic handles:
   - resolveWidgetSelection() for widget-specific ordinals
   - checkMultiListAmbiguity() for multi-widget disambiguation
   - isSelectionLike() for detection
```

### 3b. saveLastOptionsShown Wiring (Completed)

**Problem (resolved):** `saveLastOptionsShown` was only called at 3 post-dispatch API response sites. Dispatcher-created options (Tier 2c panel disambiguation, meta-explain, known-noun) did not save, so the soft-active window was dead code for those paths.

**Fix (completed):** Call `saveLastOptionsShown` at every site where `setPendingOptions` is called with non-empty options:

| File | Location | Description |
|------|----------|-------------|
| `chat-routing.ts` | ~line 4275 | `handlePanelDisambiguation` (Tier 2c) |
| `chat-routing.ts` | ~line 389 | Clarification handler doc disambiguation |
| `chat-routing.ts` | ~line 452 | Weak option |
| `chat-routing.ts` | ~line 2293 | Workspace picker |
| `known-noun-routing.ts` | ~line 396 | Step 1 trailing-? prompt |
| `known-noun-routing.ts` | ~line 551 | Step 4 near-match |

**How:** Add `saveLastOptionsShown` to handler context interfaces (`ClarificationInterceptContext`, `PanelDisambiguationHandlerContext`, `MetaExplainHandlerContext`, `KnownNounRoutingContext`). Call it immediately after `setPendingOptions`.

### 3c. bare_ordinal_no_context Guards (`chat-routing.ts`)

**Problem:** `bare_ordinal_no_context` handler catches command-like inputs (e.g., "open the first option in the recent widget") because it detects "first" as a selection-like token.

**Fix:** Add two guards:
- `!isNewQuestionOrCommandDetected` — skip if input contains verb commands
- `wordCount <= 4` — only catch bare ordinals like "first", "panel d", not full sentences

### 3d. Widget Reference Resolution

When the user mentions a widget by name (e.g., "first option in recent widget"):
1. The grounding-set's existing logic at lines 606-620 checks if input mentions a widget label
2. If matched to exactly one widget → resolve within that widget's list via `resolveWidgetSelection`
3. If matched to zero widgets → fall through to Tier 5
4. If input is selection-like but no widget named and **multiple widgets have lists**, `checkMultiListAmbiguity` asks "which list?"
5. Else if input is selection-like and **activeWidgetId has a visible list**, prefer that list.
6. Else if only one widget has a list → auto-resolve against that single list.

---

## Widget Reporter Changes

Each widget that exposes selectable items registers a snapshot alongside its existing `upsertWidgetState` call.

### RecentPanel (`components/dashboard/panels/RecentPanel.tsx`)
- After loading items from `/api/dashboard/recent`, register snapshot with:
  - `widgetId: "w_recent"`
  - List segment: items mapped from `{id, name, entryId, entryName}` to `SnapshotListItem`
  - Context segment: "Shows recently accessed workspaces"
- On unmount: `unregisterWidgetSnapshot("w_recent")`

### RecentWidget (`components/dashboard/widgets/RecentWidget.tsx`)
- After loading workspaces, register snapshot with:
  - `widgetId: "w_recent_widget"`
  - List segment: workspace items
  - Context segment: summary from existing `upsertWidgetState`
- On unmount: `unregisterWidgetSnapshot("w_recent_widget")`

### QuickLinksWidget (optional)
- If this widget exposes a list, register a snapshot using the same pattern.
- Add as needed (not required for initial phase).

### QuickLinksWidget (`components/dashboard/widgets/QuickLinksWidget.tsx`)
- Register snapshot with link items as list segment
- On unmount: unregister

### DashboardView (`components/dashboard/DashboardView.tsx`)
- When a drawer opens: call `setActiveWidgetId(drawerId)`
- When drawer closes: call `setActiveWidgetId(null)`

---

## File Summary

### New Files (2)

| File | Layer | Purpose |
|------|-------|---------|
| `lib/widgets/ui-snapshot-registry.ts` | 1 | Ephemeral widget snapshot store |
| `lib/chat/ui-snapshot-builder.ts` | 2 | Assembles per-turn snapshot for routing |

### Modified Files (7)

| File | Layer | Changes |
|------|-------|---------|
| `lib/chat/routing-dispatcher.ts` | 3 | Add snapshot getters to context, consume builder at Tier 4.5, **do not** clear lastOptionsShown at Tier 2a |
| `lib/chat/chat-routing.ts` | 3 | Wire saveLastOptionsShown at option-creation sites, guard bare_ordinal_no_context |
| `lib/chat/known-noun-routing.ts` | 3 | Wire saveLastOptionsShown at option-creation sites |
| `components/chat/chat-navigation-panel.tsx` | 3 | Pass clearLastOptionsShown + snapshot getters to dispatcher |
| `components/dashboard/DashboardView.tsx` | Reporter | Set activeWidgetId on drawer open/close |
| `components/dashboard/panels/RecentPanel.tsx` | Reporter | Register snapshot with list segment |
| `components/dashboard/widgets/RecentWidget.tsx` | Reporter | Register snapshot with list segment |

### Unchanged Files

| File | Reason |
|------|--------|
| `lib/widgets/widget-state-store.ts` | Stays as LLM context source (not merged) |
| `lib/chat/grounding-set.ts` | Already has OpenWidgetState, resolveWidgetSelection, checkMultiListAmbiguity — just needs non-empty data |
| `lib/chat/intent-prompt.ts` | Continues rendering widgetStates for LLM answers |

---

## Implementation Order

```
Phase 1 (parallel):
  Step 1: Create ui-snapshot-registry.ts (Layer 1)
  Step 2: Wire saveLastOptionsShown into dispatcher + handlers (Layer 3b) **(DONE)**

Phase 2 (depends on Step 1):
  Step 3: Create ui-snapshot-builder.ts (Layer 2)
  Step 4: Widget reporters register snapshots (RecentPanel, RecentWidget, QuickLinks — optional)

Phase 3 (depends on Phase 2):
  Step 5: Integrate builder into dispatcher at Tier 4.5 (Layer 3a)
  Step 6: Add bare_ordinal_no_context guards (Layer 3c)
  Step 7: Ensure explicit commands **do not** clear lastOptionsShown (Layer 3d)

Phase 4:
  Validation against acceptance tests from widget-ui-snapshot-plan.md

## Acceptance Test Additions

Add test to cover shorthand after unrelated query:
1. Show disambiguation list (“Links Panel D / E / …”)
2. User asks unrelated question (e.g., “what is recent?”)
3. User types shorthand (“panel e”)
4. Expect: resolves within soft-active window unless stop/cancel or new list replaced it.

## Implementation Status Notes

**All steps complete as of 2026-02-02.**

| Step | Description | Status | Commit / Session |
|------|-------------|--------|-----------------|
| Step 1 | Create `ui-snapshot-registry.ts` (Layer 1) | **Done** | `e2bd3e3f` |
| Step 2 | Wire `saveLastOptionsShown` (Layer 3b) | **Done** | Prior session |
| Step 3 | Create `ui-snapshot-builder.ts` (Layer 2) | **Done** | `e2bd3e3f` |
| Step 4 | Widget reporters (RecentPanel, RecentWidget, DashboardView) | **Done** | `e2bd3e3f` |
| Step 5 | Integrate builder into dispatcher at Tier 4.5 | **Done** | `e2bd3e3f` |
| Step 6 | `bare_ordinal_no_context` guards (Layer 3c) | **Done** | 2026-02-02 session (not yet committed) |
| Step 7 | Don't clear `lastOptionsShown` at Tier 2a | **Done** | Already correct in `e2bd3e3f` |

**Additional fix (2026-02-02 session):** `resolveOrdinalIndex` in `grounding-set.ts` extended with embedded ordinal extraction to handle ordinals within longer command sentences (e.g., "open the first option in the recent widget").

**End-to-end verified:** "open the first option in the recent widget" → Opened workspace "Sprint 14".

**Report:** `reports/2026-02-02-widget-registry-session-report.md`

## Widget Item Execution (Tier 4.5)

When grounding resolves a widget list item, execution must be explicit (not via chat pills):
- Introduce `groundingAction: { type: 'execute_widget_item', widgetId, segmentId, itemId, action }`
- `sendMessage()` executes this action via widget navigation API or handler
- This avoids relying on `handleSelectOption()` for widget items

This is required for selection‑like inputs such as “first option in recent widget.”
```

---

## Mapping to widget-ui-snapshot-plan.md

| Plan Concept | Implementation |
|---|---|
| `widgets[].segments[]` | `WidgetSnapshot.segments` in registry |
| `segmentType: "list"` | `SnapshotListSegment` in registry |
| `segmentType: "context"` | `SnapshotContextSegment` in registry |
| `activeWidgetId` | `getActiveWidgetId()` in registry, set by DashboardView |
| `selectionMemory.activeOptionSetId` | Existing `activeOptionSetId` in chat state (Tier 3) |
| `selectionMemory.lastOptionsShown` | Existing `LastOptionsShown` in chat state (now wired) |
| Selection-Like Detector | Existing `isSelectionLike()` in grounding-set.ts |
| Rule A (context-like → context segment) | Handled by widgetStates → LLM path (unchanged) |
| Rule B (selection-like → list segment) | Handled by grounding-set with builder output at Tier 4.5 |
| Rule C (multi-list ambiguity) | Existing `checkMultiListAmbiguity()` in grounding-set.ts |
| Soft-Active Selection Memory (2 turns) | Existing `LastOptionsShown` with `SOFT_ACTIVE_TURN_LIMIT = 2` |
| Freshness Guard | Builder checks `registeredAt` per widget against threshold |
| LLM constrained pick | Existing constrained LLM fallback in grounding-set.ts |
| "Do not merge openWidgets and widgetStates" | Two separate stores, two separate consumers |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Wrong option in active widget list (previous failure) | Widget lists enter ONLY at Tier 4.5. Tier 3 handles chat-created options separately. The two tiers never share candidate lists. |
| Stale snapshots after rapid widget changes | Per-widget `registeredAt` freshness guard. Widgets unregister on unmount. |
| Multi-list ambiguity confusion | Existing `checkMultiListAmbiguity()` asks "which list?" when 2+ widget lists are visible. |
| Registry becomes untyped dumping ground | Strict contract enforcement: typed segments only, stable IDs required, array caps, string length limits. |
| Widget forgets to unregister | Freshness guard auto-expires stale entries. Can add pruning similar to widget-state-store's `pruneStaleWidgetStates`. |
