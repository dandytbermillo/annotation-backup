# Stage 6x.8 Phase 5 — Panel Registry Replay Coverage Implementation Report

**Date:** 2026-03-21
**Design doc:** `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-panel-registry-replay-coverage-addendum.md`

## Summary

Three fixes were implemented to close gaps in built-in panel replay coverage:

1. **Resolver-seam fix** — `resolvePanelIntent()` was silently discarding `open_panel_drawer` results from `executePanelIntent`, returning `action: 'inform'` instead. Fixed by adding explicit handling for the `open_panel_drawer` response shape.

2. **Grounding panel-writeback fix** — Tier 4.5 grounding panel-execute opened panel drawers client-side but never emitted a Phase 5 pending write. The navigate API writeback code was unreachable because the API was never called. Fixed by attaching `_groundingPanelOpen` metadata to the dispatcher result and building the writeback on the client side.

3. **Registry coverage audit** — Verified all replay-safe built-in panels have manifests, open/show examples, and generic writeback/replay contracts. Locked with automated tests.

## Changes

### `lib/chat/intent-resolver.ts`

**Lines ~2967:** Added `open_panel_drawer` result handler in `resolvePanelIntent()`.

When `executePanelIntent` returns `{ success: true, action: 'open_panel_drawer', panelId, panelTitle }` (e.g., from the shared `open-drawer` API handler), the result is now preserved as `action: 'open_panel_drawer'` instead of falling through to the default `action: 'inform'` case.

This fixes panels like `links-overview` that reach the `open-drawer` handler when `resolveDrawerPanelTarget()` dynamic fallback fails (because `links_overview` ≠ `category_navigator` in the DB `panel_type` column).

### `lib/chat/routing-dispatcher.ts`

**Line 620:** Added `_groundingPanelOpen?: { panelId: string; panelTitle: string }` to `RoutingDispatcherResult`.

**Line ~5969:** Grounding panel-execute return now attaches `_groundingPanelOpen: { panelId: selected.id, panelTitle: selected.label }`.

### `components/chat/chat-navigation-panel.tsx`

**Line 68:** Added import for `buildPhase5NavigationWritePayload`.

**Lines ~2061-2083:** After a handled routing result with `_groundingPanelOpen` and `_phase5ReplaySnapshot`, builds a Phase 5 pending write using `buildPhase5NavigationWritePayload` with `intentId: 'open_panel'` and sets it via `setPendingPhase5Write`. This enables one-turn delayed promotion → B1 exact replay for panel opens that go through grounding.

## Root Cause Analysis

### Resolver-seam bug

`resolvePanelIntent()` processes `executePanelIntent` results by checking:
1. `result.success === false` → error
2. `result.items` → list view
3. `result.navigateTo` → navigation
4. Default → `action: 'inform'`

The `open-drawer` handler returns `{ action: 'open_panel_drawer', panelId, panelTitle }` which has none of `items`, `navigateTo`, or `success === false`. It fell through to the default `inform` case. The drawer-open action was silently discarded.

### Grounding writeback gap

The grounding tier (Tier 4.5) opens panel drawers client-side via `ctx.openPanelDrawer()` and returns `handled: true`. The client early-returns at `chat-navigation-panel.tsx:2060` without calling the navigate API. The server-side Phase 5 writeback code at `navigate/route.ts:1325` is only reachable via the navigate API response. This meant grounding panel-executes could never produce Phase 5 memory rows.

Panels like `recent` and `widget-manager` are commonly resolved by grounding (Tier 4.5 visible-panel candidates) rather than the navigate API's panel-intent path. The provenance badge "Auto-Executed" (`_devProvenanceHint: 'llm_executed'` at dispatcher line 5967) confirmed the grounding path.

## Test Coverage

### New tests: `__tests__/unit/chat/phase5-panel-registry-coverage.test.ts` (34 tests)

**4a. Resolver-seam lock (3 tests)**
- `executePanelIntent` returning `open_panel_drawer` → `resolvePanelIntent` returns `open_panel_drawer` (not `inform`)
- Negative: non-drawer results still return `inform`

**4b. Resolver-wiring for non-visibleWidgets path (2 tests)**
- `links-overview` resolves through handler when not in `visibleWidgets`
- `navigator` resolves through handler when not in `visibleWidgets`

**4c. Registry coverage (15 tests)**
- All replay-safe built-ins registered in `panelRegistry`
- All quick-links badges (A-E) registered
- Each built-in has open/show intent with relevant examples
- Writeback payload shape is generic (`panelId` + `panelTitle` regardless of panel)
- Replay reconstruction is panel-agnostic
- Exclusions: `clear_recent`, `add_link`, `remove_link` do not produce `open_panel` writeback

**4d. Grounding writeback seam (5 tests)**
- `_groundingPanelOpen` + snapshot → valid `open_panel` pending write
- Works for any panel identity (widget manager)
- Rejects missing `panelTitle`
- Rejects missing `panelId`
- End-to-end round-trip: writeback → simulated B1 row → `buildResultFromMemory` → `navigationReplayAction` with `memory_exact` provenance

### Existing tests: regression clean

- `memory-action-builder.test.ts`: 16/16 (includes Phase 5 navigation replay reconstruction)
- Phase 5 + content-intent-dispatcher regression: 244/244

## Runtime Proof

### "open recent widget" (3 turns)
- Turn 1: Auto-Executed (grounding opens drawer, pending write created)
- Turn 2: Auto-Executed (pending write promoted fire-and-forget, B1 runs before commit)
- Turn 3: **Memory-Exact** (B1 finds promoted row)

### "open widget manager" (3 turns)
- Turn 1: Auto-Executed
- Turn 2: Auto-Executed
- Turn 3: **Memory-Exact**

## Registry Inventory

| panelId | title | manifest | registered | open intent | resolves to `open_panel_drawer` | replay-safe |
|---------|-------|----------|------------|-------------|---------------------------------|-------------|
| `recent` | Recent Items | `recent-panel.ts` | Yes | `list_recent` | Yes (hardcoded + grounding) | Yes |
| `navigator` | Navigator | `navigator-panel.ts` | Yes | `open_drawer` | Yes (dynamic fallback + grounding) | Yes |
| `widget-manager` | Widget Manager | `widget-manager-panel.ts` | Yes | `open_drawer` | Yes (dynamic fallback + grounding) | Yes |
| `quick-capture` | Quick Capture | `quick-capture-panel.ts` | Yes | `open_drawer` | Yes (dynamic fallback + grounding) | Yes |
| `continue` | Continue | `continue-panel.ts` | Yes | `open_drawer` | Yes (dynamic fallback + grounding) | Yes |
| `links-overview` | Links Overview | `links-overview-panel.ts` | Yes | `open_drawer` | Yes (handler via resolver-seam fix) | Yes |
| `quick-links-{a-e}` | Links Panel {A-E} | `link-notes-panel.ts` | Yes | `show_links` | Yes (hardcoded + grounding) | Yes |

## Remaining Work

1. **Built-in panel coverage sweep** — Validate remaining panels (`navigator`, `quick-capture`, `continue`, `links-overview`, `quick-links` variants) through the same runtime cycle: first success → pending write → later Memory-Exact.
2. **DB-backed/custom widgets** — After built-ins are stable, extend to custom widget manifests loaded from `installed_widgets`.

## Acceptance Criteria Status

| Criterion | Status |
|-----------|--------|
| All replay-safe built-in panels have manifests and registry coverage | Verified (automated) |
| Drawer-open resolution consults registry-backed metadata | Verified for handler path (resolver-seam fix) |
| Panel-family replay is generic (no per-panel branching) | Verified (automated) |
| Successful exact repeats can become Memory-Exact | Verified (runtime: recent, widget-manager) |
| New panels join replay via manifest + registration, not replay-code changes | Verified (test 4c: panel-agnostic writeback + replay) |
| Exclusions are explicit | Verified (automated: non-open intents rejected) |
