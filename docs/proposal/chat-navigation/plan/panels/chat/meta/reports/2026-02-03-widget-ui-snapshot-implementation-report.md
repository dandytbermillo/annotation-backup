# 2026-02-03 Widget UI Snapshot Plan Implementation Report

## Summary

This session implemented the `widget-ui-snapshot-plan.md` requirements that were marked "NOT STARTED" in the previous session report. The implementation enables:

1. **Widget context questions** — "what does this widget mean?" now answers from widget context, not docs
2. **Enhanced data contracts** — `totalCount`, `description`, snapshot metadata fields
3. **Selection patterns** — "next one" / "previous one" recognized as selection-like
4. **Context routing** — Widget context segments flow from client → server → LLM prompt
5. **Additional widget reporters** — QuickLinksWidget now registers snapshots

## Implementation Phases

### Phase 1: Data Contract Extensions

| Item | File | Change |
|------|------|--------|
| A1: Snapshot metadata | `lib/chat/ui-snapshot-builder.ts` | Added `uiSnapshotId`, `revisionId`, `capturedAtMs` to `TurnSnapshotResult` |
| A2: `totalCount` field | `lib/widgets/ui-snapshot-registry.ts` | Added optional `totalCount?: number` to `SnapshotListSegment` |
| A3: `description` field | `lib/widgets/ui-snapshot-registry.ts` | Added optional `description?: string` to `SnapshotListItem` with 200-char truncation |
| B1: Sequential patterns | `lib/chat/grounding-set.ts` | Added `SEQUENTIAL_ONE` regex for "next one" / "previous one" |

### Phase 2: hasBadgeLetters Wiring

| Item | File | Change |
|------|------|--------|
| B2a: Builder output | `lib/chat/ui-snapshot-builder.ts` | Added `hasBadgeLetters: boolean` to `TurnSnapshotResult`, computed from fresh visible snapshots with `badgesEnabled` |
| B2b: Dispatcher wiring | `lib/chat/routing-dispatcher.ts` | Moved `buildTurnSnapshot()` before soft-active check; passed `hasBadgeLetters` to `isSelectionLike()` and `handleGroundingSetFallback()` |

### Phase 3: Context Routing via Request Payload

**Critical constraint addressed**: The UI snapshot registry is client-side in-memory only. `intent-prompt.ts` runs on the server. The solution passes context data from client → server in the API request payload.

| Item | File | Change |
|------|------|--------|
| C1: Context segments | `components/chat/chat-navigation-panel.tsx` | Built `widgetContextSegments` from `getAllVisibleSnapshots()` |
| C2: Item descriptions | `components/chat/chat-navigation-panel.tsx` | Built `widgetItemDescriptions` with `visibleItemRange` consistency |
| Guard 1: Payload caps | `components/chat/chat-navigation-panel.tsx` | Max 10 context segments, max 50 item descriptions, truncation |
| Guard 2: Version gate (layer 1) | `app/api/chat/navigate/route.ts` | Check `widgetContextVersion === 1`, strip if invalid |
| Guard 2: Version gate (layer 2) | `lib/chat/intent-prompt.ts` | Check version before rendering `WidgetContext:` block |
| Guard 3: Dedup | `components/chat/chat-navigation-panel.tsx` | Dedup by `widgetId` (newest `registeredAt` wins), then by `segmentId` |
| Guard 4: Prompt heading | `lib/chat/intent-prompt.ts` | Render `WidgetContext:` block separate from `widgetStates:` |
| Type extension | `lib/chat/intent-prompt.ts` | Extended `ConversationContext` with `widgetContextVersion`, `widgetContextSegments`, `widgetItemDescriptions` |

### Phase 4: Tier 4.6 — Widget Context Questions

**Problem identified**: "what does this widget mean?" was being caught by Tier 5 (doc retrieval) before it could reach the API call where `widgetContextSegments` would be sent.

**Solution**: Added Tier 4.6 between Tier 4.5 (grounding-set) and Tier 5 (docs).

| Item | File | Change |
|------|------|--------|
| Tier 4.6 | `lib/chat/routing-dispatcher.ts` | Pattern `/\b(this|the)\s+(widget|panel)\b/i` → if widget context exists, return `handled: false` to bypass docs and reach API |

**Insertion point**: Lines 2104-2148 (after soft-active turn increment, before Tier 5)

### Phase 5: Additional Widget Reporters

| Item | File | Change |
|------|------|--------|
| QuickLinksWidget | `components/dashboard/widgets/QuickLinksWidget.tsx` | Added `registerWidgetSnapshot()` with list + context segments, `badgesEnabled: true` when badge present |

### Phase 6: Tests

| File | Tests | Status |
|------|-------|--------|
| `__tests__/unit/widgets/widget-ui-snapshot-plan.test.ts` | 29 tests | ✅ Passing |
| `__tests__/integration/widget-context-prompt.test.ts` | 6 tests | ✅ Passing |

**Total**: 110 tests passing across 5 widget test suites.

## Files Modified

| File | Change Summary |
|------|----------------|
| `lib/widgets/ui-snapshot-registry.ts` | Added `totalCount`, `description` to types + validation |
| `lib/chat/grounding-set.ts` | Added `SEQUENTIAL_ONE` regex to `isSelectionLike()` |
| `lib/chat/ui-snapshot-builder.ts` | Added snapshot metadata + `hasBadgeLetters` |
| `lib/chat/routing-dispatcher.ts` | Reordered `buildTurnSnapshot`; wired `hasBadgeLetters`; added Tier 4.6 |
| `components/chat/chat-navigation-panel.tsx` | Built widget context payload with dedup + caps + debug log |
| `app/api/chat/navigate/route.ts` | Version gate (layer 1), forward validated fields |
| `lib/chat/intent-prompt.ts` | Extended `ConversationContext`, render `WidgetContext:` block |
| `components/dashboard/widgets/QuickLinksWidget.tsx` | Added snapshot registration |
| `__tests__/unit/widgets/widget-ui-snapshot-plan.test.ts` | Created (29 tests) |
| `__tests__/integration/widget-context-prompt.test.ts` | Created (6 tests) |
| `docs/.../widget-ui-snapshot-plan.md` | Updated status section |

## End-to-End Verification

### Test 1: Widget Context Question ✅

**Input**: "what does this widget mean?" (with Recent widget visible)

**Result**: "The Recent widget shows the 10 most recently accessed workspaces and entries."

**Execution path**:
1. Tier 4.6 pattern matched "this widget"
2. `getVisibleSnapshots()` found 5 snapshots with context segments
3. Returned `handled: false` → bypassed Tier 5 (docs)
4. Reached API call with `widgetContextSegments` in payload
5. `intent-prompt.ts` rendered `WidgetContext:` block
6. LLM answered from widget context

**Console evidence**: `contextSegmentsCount: 5`

### Test 2: Widget Selection ✅

**Input**: "open the sixth option in recent widget"

**Result**: "Opened workspace 'Workspace 2'"

**Execution path**:
1. Tier 4.5 `buildTurnSnapshot()` returned `w_recent_widget` with items
2. `handleGroundingSetFallback` → widget label "recent" matched
3. `resolveWidgetSelection` → `resolveOrdinalIndex` → "sixth" → index 5
4. `execute_widget_item` action returned
5. Workspace opened

### Test 3: Links Panel Registration ✅

**Console**: `__snapshotRegistry.getAll()` shows:
- `w_links_d` (Links Panel D)
- `w_links_e` (Links Panel E)
- `w_links_f` (Links Panel F)
- `w_recent_widget` (Recent Widget)

### Test 4: Workspace Context Question ✅

**Input**: "what does Workspace 2 mean?" (after opening Workspace 2)

**Result**: "Workspace 2 is the current workspace you are in, which contains your notes and projects."

**Note**: This correctly uses workspace context (current location) rather than widget context, since the query doesn't match the "this widget" pattern.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐      │
│  │  RecentWidget   │    │ QuickLinksWidget│    │   RecentPanel   │      │
│  │                 │    │                 │    │                 │      │
│  │ registerWidget  │    │ registerWidget  │    │ registerWidget  │      │
│  │   Snapshot()    │    │   Snapshot()    │    │   Snapshot()    │      │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘      │
│           │                      │                      │               │
│           ▼                      ▼                      ▼               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    UI Snapshot Registry (Layer 1)                │    │
│  │                     In-memory Map<widgetId, Snapshot>            │    │
│  │                                                                  │    │
│  │  Snapshots contain:                                              │    │
│  │  - list segments (items, badges, visibleItemRange)              │    │
│  │  - context segments (summary, currentView, focusText)           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                 chat-navigation-panel.tsx                        │    │
│  │                                                                  │    │
│  │  1. getAllVisibleSnapshots()                                     │    │
│  │  2. Dedup by widgetId (newest registeredAt wins)                │    │
│  │  3. Build widgetContextSegments (max 10, dedup by segmentId)    │    │
│  │  4. Build widgetItemDescriptions (max 50, visibleItemRange)     │    │
│  │  5. Add widgetContextVersion: 1                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│                              ▼                                          │
│                    POST /api/chat/navigate                              │
│                    { context: { widgetContextVersion, segments, ... }}  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              SERVER                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    route.ts (API Route)                          │    │
│  │                                                                  │    │
│  │  Guard 2 (Layer 1): Check widgetContextVersion === 1             │    │
│  │  If invalid → strip widgetContextSegments, widgetItemDescriptions│    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    intent-prompt.ts                              │    │
│  │                                                                  │    │
│  │  Guard 2 (Layer 2): Check widgetContextVersion === 1             │    │
│  │  If valid → render WidgetContext: block (separate from           │    │
│  │             widgetStates:)                                       │    │
│  │                                                                  │    │
│  │  Prompt structure:                                               │    │
│  │    widgetStates:                                                 │    │
│  │      - "Recent": ...  (from widget-state-store)                  │    │
│  │    WidgetContext:                                                │    │
│  │      - "Recent": "Shows recently accessed workspaces"            │    │
│  │        focus: "Sprint 14"                                        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│                              ▼                                          │
│                           LLM Call                                      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Routing Tier Flow

```
User Input: "what does this widget mean?"
                │
                ▼
┌───────────────────────────────────────────────────────────────┐
│ Tier 0-3: Clarification handling                              │
│ → Not applicable (no active list)                             │
└───────────────────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────┐
│ Tier 4: Known-noun routing                                    │
│ → Not applicable (question intent)                            │
└───────────────────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────┐
│ Tier 4.5: Grounding-set fallback                              │
│ → Not applicable (not selection-like)                         │
└───────────────────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────┐
│ Tier 4.6: Widget Context Questions    ◄── NEW                 │
│                                                               │
│ Pattern: /\b(this|the)\s+(widget|panel)\b/i                   │
│ Check: visibleSnapshots have context segments?                │
│                                                               │
│ Result: handled: false (bypass Tier 5, go to API)             │
└───────────────────────────────────────────────────────────────┘
                │
                ▼ (bypassed)
┌───────────────────────────────────────────────────────────────┐
│ Tier 5: Doc retrieval                                         │
│ → SKIPPED (Tier 4.6 returned handled: false)                  │
└───────────────────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────┐
│ API Call: /api/chat/navigate                                  │
│                                                               │
│ Payload includes:                                             │
│   - widgetContextVersion: 1                                   │
│   - widgetContextSegments: [...5 segments...]                 │
│   - widgetItemDescriptions: [...if any...]                    │
└───────────────────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────┐
│ LLM Response                                                  │
│                                                               │
│ "The Recent widget shows the 10 most recently accessed        │
│  workspaces and entries."                                     │
└───────────────────────────────────────────────────────────────┘
```

## Debug Tooling Added

### Console logging (temporary)

**File**: `components/chat/chat-navigation-panel.tsx` (line ~1847)

```javascript
console.log('[chat-nav] widget context payload:', {
  allSnapshotsCount: allSnapshots.length,
  uniqueSnapshotsCount: uniqueSnapshots.length,
  contextSegmentsCount: widgetContextSegments.length,
  contextSegments: widgetContextSegments.map(s => ({ widgetId: s.widgetId, segmentId: s.segmentId })),
  itemDescriptionsCount: widgetItemDescriptions.length,
})
```

**File**: `lib/widgets/ui-snapshot-registry.ts` (line ~224)

```javascript
console.log('[ui-snapshot-registry] Registered:', validated.widgetId, {
  segments: validated.segments.length,
  items: validated.segments.filter(s => s.segmentType === 'list').reduce((sum, s) => sum + s.items.length, 0),
})
```

**File**: `lib/widgets/ui-snapshot-registry.ts` (line ~284-292)

```javascript
window.__snapshotRegistry = {
  getAll: () => Array.from(widgetSnapshots.entries()),
  get: (id: string) => widgetSnapshots.get(id) ?? null,
  count: () => widgetSnapshots.size,
  activeWidgetId: () => activeWidgetId,
}
```

These should be removed or gated behind a debug flag before production.

## What Remains

### Not implemented in this session:

1. **Item-level context lookup expansion** — Tier 4.6 only catches "this widget" / "the widget" patterns. Questions about specific items ("what does Workspace 2 mean?") use general context, not widget item descriptions.

2. **"next one" / "previous one" actual resolution** — The patterns are detected as selection-like, but sequential item navigation (moving to the next item after a selection) is not implemented.

3. **Production cleanup** — Debug logs should be removed or feature-flagged.

4. **Additional widget reporters** — Only RecentWidget, RecentPanel, and QuickLinksWidget register snapshots. Other widgets (if any) need to be wired.

## Verification Commands

```bash
# Type check
npm run type-check

# Unit tests
npx jest __tests__/unit/widgets/ --no-coverage

# Integration tests
npx jest __tests__/integration/widget-context-prompt.test.ts --no-coverage

# All widget tests
npx jest __tests__/unit/widgets/ __tests__/integration/widget-context-prompt.test.ts --no-coverage
# Result: 110 tests passing
```

## Manual Test Script

1. Open app dashboard
2. Verify `__snapshotRegistry.getAll()` shows registered widgets
3. Type "what does this widget mean?" → should answer from widget context
4. Type "open the sixth option in recent widget" → should open workspace
5. Check console for `[chat-nav] widget context payload:` with `contextSegmentsCount > 0`
