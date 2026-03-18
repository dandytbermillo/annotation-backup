# Stage 6x.8 Phase 4 — Cross-Surface State-Info Implementation Report

**Date:** 2026-03-17
**Status:** Implemented and runtime-verified

## Summary

Phase 4 extends the cross-surface arbiter from note-only (`note:read_content`, `note:state_info`) to three additional surfaces: `panel_widget:state_info`, `workspace:state_info`, and `dashboard:state_info`. Each uses a deterministic resolver — no LLM generation for state answers.

Additionally, a panel open-vs-visible semantics bugfix was implemented: "what panel is open?" now answers from `uiContext.dashboard.openDrawer`, while "which widgets are visible?" answers from `uiContext.dashboard.visibleWidgets`.

## Changes

### 1. Arbiter Entry Broadened (`lib/chat/routing-dispatcher.ts`)

The arbiter entry condition was note-only. Phase 4 broadens it:

```typescript
const hasSurfaceContext = isNoteRelated || hasVisiblePanels || hasActiveWorkspace || isDashboardActive
```

The arbiter call now passes surface context:

```typescript
const arbiterResult = await callCrossSurfaceArbiter({
  ...existing,
  visiblePanels: visiblePanelTitles,
  workspaceName: ctx.uiContext?.workspace?.workspaceName,
  entryName: ctx.uiContext?.dashboard?.entryName,
})
```

### 2. Migrated-Family Gate Expanded (`lib/chat/routing-dispatcher.ts`)

```typescript
const MIGRATED_PAIRS = new Set([
  'note:read_content', 'note:state_info',
  'panel_widget:state_info', 'workspace:state_info', 'dashboard:state_info',
])
```

### 3. Deterministic State-Info Resolvers (`lib/chat/state-info-resolvers.ts`)

| Resolver | Source | Example answer |
|----------|--------|---------------|
| `resolvePanelOpenStateInfo` | `openDrawer` | "The open panel is Links Panel B." |
| `resolvePanelWidgetStateInfo` | `visibleWidgets` | "The visible panels are: Links, Recent." |
| `resolveWorkspaceStateInfo` | `workspaceName` | "You are in workspace budget100." |
| `resolveDashboardStateInfo` | `entryName` + widget count | "The dashboard for budget100 has 3 widgets." |

### 4. Panel Open-vs-Visible Discriminator (`lib/chat/state-info-resolvers.ts`)

```typescript
export function isPanelOpenQuery(input: string): boolean {
  return /\bpanels?\b|\bdrawer\b/i.test(input) && /\bopen(ed)?\b/i.test(input)
}
```

The `panel_widget:state_info` dispatcher path branches:
- `isPanelOpenQuery(input)` true → `resolvePanelOpenStateInfo` (reads `openDrawer`)
- else → `resolvePanelWidgetStateInfo` (reads `visibleWidgets`)

### 5. Non-Note `read_content` Bounded Response (`lib/chat/routing-dispatcher.ts`)

```typescript
} else if (arbiterResult.success && rawDecision?.intentFamily === 'read_content' && rawDecision?.surface !== 'note') {
  // "Reading content is currently available for notes only."
  ctx.addMessage(..., { tierLabel: 'arbiter_non_note_read_not_supported' })
```

### 6. Post-Arbiter Signal Corrections (`lib/chat/routing-dispatcher.ts`)

Two corrections prevent arbiter misclassification from producing wrong answers:

**Note reference correction:** When user explicitly says "note/document/page" (`noteRefDetected=true`) but arbiter returns non-note `state_info`, override surface to `note`.

**Panel-open correction:** When `isPanelOpenQuery(input)` is true but arbiter returns non-`panel_widget` `state_info` (typically `dashboard`), override surface to `panel_widget`.

### 7. Arbiter Prompt Improvements (`app/api/chat/cross-surface-arbiter/route.ts`)

- Added panel-vs-dashboard classification examples
- Added "When user mentions panel/panels/drawer → panel_widget, NOT dashboard"
- Added `visiblePanels`, `workspaceName`, `entryName` to prompt context

### 8. Arbiter Hard Guard Fix (`lib/chat/content-intent-classifier.ts`)

- Removed `NON_NOTE_SCOPE_PATTERN` from `isArbiterHardExcluded` (was blocking non-note queries)
- Removed `what\s+panels?\s+(are|is)\s+open` from `META_ONLY_PATTERN` (was blocking panel-open queries)
- Added `isLikelyNavigateCommand` helper (prevents navigate commands from entering arbiter)

### 9. Tier Label Mappings (`lib/chat/chat-navigation-context.tsx`)

New labels in `buildPreviousRoutingMetadataFromTierLabel`:
- `arbiter_panel_widget_state_info` → surface: panel_widget, state_info_answered
- `arbiter_workspace_state_info` → surface: workspace, state_info_answered
- `arbiter_dashboard_state_info` → surface: dashboard, state_info_answered
- `arbiter_non_note_read_not_supported` → turnOutcome: not_supported

### 10. Metadata Invalidation (`lib/chat/chat-navigation-context.tsx`)

`setUiContext` now invalidates routing metadata on surface changes:
- `workspaceId` change → clears `workspace`-scoped metadata
- `entryId` change → clears `panel_widget` and `dashboard`-scoped metadata

### 11. Cross-Surface Arbiter Types (`lib/chat/cross-surface-arbiter.ts`)

Extended `CrossSurfaceArbiterRequest` with:
- `visiblePanels?: string[]`
- `workspaceName?: string`
- `entryName?: string`

## Test Results

### Unit Tests

| Suite | Tests | Status |
|-------|-------|--------|
| `content-intent-dispatcher-integration` | 55 | Pass |
| `state-info-resolvers` | 16 | Pass |
| `routing-metadata-timing` | 16 | Pass |
| `routing-metadata-context-seam` | 6 | Pass |

### Test Coverage by Category

**Resolver tests (16):**
- `isPanelOpenQuery`: 6 tests (singular, plural, drawer, negatives)
- `resolvePanelOpenStateInfo`: 2 tests (drawer open, no drawer)
- `resolvePanelWidgetStateInfo`: 2 tests (visible, empty)
- `resolveWorkspaceStateInfo`: 2 tests (active, inactive)
- `resolveDashboardStateInfo`: 4 tests (with entry, singular, empty)

**Dispatcher regression tests (11 new in Phase 4):**
- 3 state_info resolvers (panel, workspace, dashboard — correct classification)
- 3 non-note read_content bounded responses
- 4 panel open-vs-visible discriminator (with drawer, no drawer, visible-only)
- 3 arbiter misclassification corrections (plural+drawer, singular+drawer, singular+no-drawer)

**Note-state corrections (2):**
- "which note is open?" with workspace → corrected to note
- "what note is open" → corrected via noteRefDetected

**Provider-seam tests (2 new in Phase 4):**
- Workspace metadata cleared on `workspaceId` change
- Panel/dashboard metadata cleared on `entryId` change

### Runtime Verification

| Input | Expected | Actual | Status |
|-------|----------|--------|--------|
| "what panel is open" (no drawer) | "No panel drawer is currently open." | Match | Pass |
| "which panels are opened" (Links Panel B open) | "The open panel is Links Panel B." | Match | Pass |
| "which panel are opened?" (Recent open) | "The open panel is Recent." | Match | Pass |
| "which panel are open???" | "The open panel is Recent." | Match | Pass |
| "which note is opened" | "The open note is Main Document." | Match | Pass |
| "i want to know workspace am i in right now?" | "You are in workspace budget100." | Match | Pass |
| "hi there. which note is currently openned???" | "The open note is Main Document." | Match | Pass |
| "summarize the dashboard" | "Reading content is currently available for notes only." | Match | Pass |

## Known Limitations

1. **Arbiter LLM variability:** The arbiter can still misclassify panel queries as dashboard in some runs. The post-arbiter correction mitigates this, but prompt-level improvements may need iteration.

2. **"take me home" / "go to home":** Navigation-language phrasing like "take me home" is not handled. This is a separate navigation-language gap, not a Phase 4 state-info issue.

3. **Panel open-vs-visible discriminator scope:** `isPanelOpenQuery` requires explicit "panel/drawer" + "open/opened" keywords. Phrasings like "what's showing right now?" would not trigger the open-drawer path.

## Files Modified

| File | Change type |
|------|------------|
| `lib/chat/routing-dispatcher.ts` | Modified — broadened entry, added resolver paths, corrections |
| `lib/chat/state-info-resolvers.ts` | Modified — added 3 resolvers + discriminator |
| `lib/chat/content-intent-classifier.ts` | Modified — removed blockers, added navigate guard |
| `lib/chat/chat-navigation-context.tsx` | Modified — tier labels, metadata invalidation |
| `lib/chat/cross-surface-arbiter.ts` | Modified — extended request type |
| `app/api/chat/cross-surface-arbiter/route.ts` | Modified — prompt improvements, surface context |
| `__tests__/unit/chat/state-info-resolvers.test.ts` | Modified — 8 new tests |
| `__tests__/unit/chat/content-intent-dispatcher-integration.test.ts` | Modified — 13 new tests |
| `__tests__/unit/chat/routing-metadata-timing.test.ts` | Modified — 4 new tier labels |
| `__tests__/integration/chat/routing-metadata-context-seam.integration.test.tsx` | Modified — 2 new tests |
