# Selection Intent Arbitration — Widget-First Latch Fix

## Context

After selecting a panel from a chat clarifier ("links panel" → disambiguation → "open second one" → Links Panel D opens), subsequent ordinals resolve against the stale chat disambiguation list instead of the widget items. The behavior is intermittent due to a timing race with `activeSnapshotWidgetId`. Fix: enforce one routing contract — selection-like follow-ups go to focused widget first unless user explicitly re-anchors to chat.

---

## 6 Principles

1. **Single owner** — selection arbitration happens once, before any Tier 3a stale-chat path
2. **Hard invariant** — if latch is resolved or pending, Tier 3a chat ordinal/message-derived selection is blocked
3. **State machine** — `none → pending(panelId) → resolved(widgetId) → suspended → cleared`; no ad-hoc flags
4. **Snapshot policy** — panel-drawer selection does not leave an ordinal-capturable stale snapshot
5. **Parser scope** — strict for stale-chat guards, embedded only where explicitly intended; no further parser tweaks
6. **Proof over tweaks** — ship only after 3 red/green race tests pass

---

## Implementation

### Step 1: FocusLatch state machine (discriminated union)

**File:** `lib/chat/chat-navigation-context.tsx`

```typescript
interface FocusLatchBase {
  widgetLabel: string
  latchedAt: number
  turnsSinceLatched: number
  suspended?: boolean
}

export interface ResolvedFocusLatch extends FocusLatchBase {
  kind: 'resolved'
  widgetId: string           // Widget slug — guaranteed valid
}

export interface PendingFocusLatch extends FocusLatchBase {
  kind: 'pending'
  pendingPanelId: string     // Panel UUID awaiting slug resolution
}

export type FocusLatchState = ResolvedFocusLatch | PendingFocusLatch
```

Transitions: `setFocusLatch(pending)` → `setFocusLatch(resolved)` (upgrade) → `suspendFocusLatch()` → `clearFocusLatch()`

**Feature flag wiring**: All latch state setters and checks are gated behind `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1=true`. When flag is false:
- `setFocusLatch` / `clearFocusLatch` / `suspendFocusLatch` are no-ops
- `latchBlocksStaleChat` evaluates to `false` — all guards pass through to existing behavior
- No `FocusLatchState` object is ever created
- Existing behavior is completely unchanged

`getLatchId()` helper (in `chat-navigation-context.tsx` next to type definitions):
```typescript
export function getLatchId(latch: FocusLatchState): string {
  return latch.kind === 'resolved' ? latch.widgetId : `pending:${latch.pendingPanelId}`
}
```

### Step 2: Proactive latch on panel-drawer selection

**File:** `components/chat/chat-navigation-panel.tsx`

In `handleSelectOption`, when `option.type === 'panel_drawer'`:
- Try immediate resolution via `getAllVisibleSnapshots().find(s => s.panelId === panelId)`
- If resolved: `setFocusLatch({ kind: 'resolved', widgetId: slug, ... })`
- If not resolved: `setFocusLatch({ kind: 'pending', pendingPanelId: panelId, ... })`
- **Snapshot policy (absolute)**: for `panel_drawer`, **never** write to `clarificationSnapshot`. Always write to `lastOptionsShown` only (for re-anchor recovery). This makes stale-chat ordinal capture impossible by construction, regardless of latch state.
- **Stale snapshot cleanup**: also call `clearClarificationSnapshot()` alongside `setFocusLatch()`. This clears any pre-existing `clarificationSnapshot` from a prior non-panel_drawer interaction. Without this, an ancient snapshot with no TTL could resurface after latch clears.

Location: line ~887, before `setLastClarification(null)` at line 892.

### Step 3: Latch validity check with pending resolution

**File:** `lib/chat/routing-dispatcher.ts` (lines 1068-1075)

- `kind === 'resolved'`: check `openWidgets.some(w => w.id === widgetId)` — clear if gone
- `kind === 'pending'`: resolve via `openWidgets.find(w => w.panelId === pendingPanelId)`
  - Resolved → upgrade to `{ kind: 'resolved', widgetId: slug }`
  - Not resolved, `turnsSinceLatched < 2` → keep alive (async registration window)
  - Not resolved, `turnsSinceLatched >= 2` → clear (graceful degradation)

**Tier 4.5 scoping** (line 2679): when `kind === 'pending'`, use `turnSnapshot.activeSnapshotWidgetId` as fallback.

**Null behavior (pending + no activeSnapshotWidgetId)**: If widget hasn't registered yet, the system cannot resolve the ordinal against any widget. Exact UX:
- Do NOT fall back to Tier 3a stale-chat paths (hard invariant holds regardless)
- Do NOT produce multi-list ambiguity clarifier (no widget context to clarify against)
- Instead, respond with a deterministic message: `"Still loading that panel — try again in a moment."` and return `handled: true`
- **Cooldown**: Track whether this message was already shown on the previous turn. If same pending latch + same null result on consecutive turns, do NOT repeat the message — silently let Tier 4.5 proceed without `activeWidgetId` instead. Prevents "Still loading..." spam.
- The latch remains pending; TTL and retry window (2 turns) apply normally
- This makes the null case visible and recoverable rather than silently misrouting

**Also:** Add `panelId?: string` to `OpenWidgetState` (`grounding-set.ts:69`) and propagate in `buildTurnSnapshot` (`ui-snapshot-builder.ts`).

### Step 4: Hard invariant — single owner before Tier 3a

**File:** `lib/chat/routing-dispatcher.ts` (line 1921) and `lib/chat/chat-routing.ts` (lines 2109, 2190)

One check, used everywhere:
```typescript
const latchBlocksStaleChat = isLatchEnabled && focusLatch && !focusLatch.suspended
```

Apply to ALL four stale-chat ordinal paths:
- **Tier 3a primary** (`routing-dispatcher.ts:1635`): add `&& !latchBlocksStaleChat` — this is the active `pendingOptions` selection path
- **Tier 3a message-derived** (`routing-dispatcher.ts:1921`): add `&& !latchBlocksStaleChat` — this is the `selection_from_message` grace window path
- **Interrupt-paused path** (`chat-routing.ts:2109`): add `|| latchBlocksStaleChat` to skip condition
- **Post-action ordinal window** (`chat-routing.ts:2190`): existing `isLatchOrPreLatch` covers this — both `kind: 'resolved'` and `kind: 'pending'` satisfy `focusLatch && !focusLatch.suspended`

### Step 5: Parser — unified with modes, no further tweaks

**File:** `lib/chat/input-classifiers.ts`

Move both parsers into one function with `mode: 'strict' | 'embedded'`:
- `strict`: anchored regex (current `routing-dispatcher.ts:467-519`)
- `embedded`: Levenshtein + `extractOrdinalFromPhrase` (current `chat-routing.ts:1191-1360`)

**Dependency chain to move with strict parser:**
- `normalizeOrdinalTypos()` (currently `routing-dispatcher.ts:313-346`) — called by strict parser at line 472. Must move to `input-classifiers.ts` to avoid circular dependency (routing-dispatcher.ts already imports from input-classifiers.ts at line 292).
- `ORDINAL_TARGETS` constant — used by `normalizeOrdinalTypos()`, move alongside
- `levenshteinDistance` — already importable from `typo-suggestions.ts`
- `isSelectionLikeTypo()` (`routing-dispatcher.ts:411`) — also calls `normalizeOrdinalTypos()`, update to import from `input-classifiers.ts`

**Mode assignments (final, no changes after this):**
- `routing-dispatcher.ts:1637` (Tier 3a primary): **strict**
- `routing-dispatcher.ts:1930` (Tier 3a message-derived): **strict**
- `routing-dispatcher.ts:2335` (`looksLikeNewCommand` negative test): **embedded** — "open second one" must stay in selection flow
- `chat-routing.ts` 6 callsites: **embedded**

Delete both local implementations. Replace 3 `[LATCH_DIAG]` console.logs with structured `debugLog`. Migrate all `focusLatch.widgetId` reads to use `kind` narrowing (9 sites: 7 debug logs, 2 functional).

### Step 6: Three red/green race tests

**Files:**
- `__tests__/unit/chat/selection-intent-arbitration.test.ts` (NEW)
- `__tests__/integration/chat/selection-intent-arbitration-race.test.ts` (NEW)

**Required red/green tests (ship blockers):**

1. **Pending latch race**: panel disambiguation → select panel → pending latch set → immediate "open second one" → pending latch blocks stale chat → Tier 4.5 resolves via `activeSnapshotWidgetId` → widget item #2

2. **Command escape**: "open second one" at `looksLikeNewCommand` (line 2335) with `mode: 'embedded'` → `isSelection: true` → `looksLikeNewCommand: false` → stays in selection flow. With `mode: 'strict'` → `isSelection: false` → escapes. Test both.

3. **Flag-off behavior**: `SELECTION_INTENT_ARBITRATION_V1=false` → all latch logic is no-op, existing behavior unchanged, no regressions.

**Additional unit tests:**
- `isSelectionOnly` strict vs embedded mode coverage
- State machine transitions: none → pending → resolved → suspended → cleared
- Latch with `pendingPanelId` + widget NOT in registry after 2 turns → cleared
- **Re-anchor recovery after panel-drawer**: panel-drawer selection → latch set → "back to options" → options restored from `lastOptionsShown` (not `clarificationSnapshot`, which is never written for panel_drawer). Proves absolute snapshot policy doesn't break re-anchor.

---

## Files Modified (9 files)

| File | Changes |
|------|---------|
| `lib/chat/chat-navigation-context.tsx` | `FocusLatchState` discriminated union + `getLatchId()` |
| `lib/chat/input-classifiers.ts` | Unified `isSelectionOnly(mode)` + `extractOrdinalFromPhrase` |
| `lib/chat/routing-dispatcher.ts` | Import unified parser, latch validity check with pending resolution, Tier 4.5 pending scoping, Tier 3a hard invariant, `trySetWidgetLatch` panelId support, union migration |
| `lib/chat/chat-routing.ts` | Import unified parser, interrupt-paused latch guard, post-action guard, union migration for logs, remove console.logs |
| `components/chat/chat-navigation-panel.tsx` | Proactive latch on panel-drawer, snapshot policy |
| `lib/chat/grounding-set.ts` | `panelId?: string` on `OpenWidgetState` |
| `lib/chat/ui-snapshot-builder.ts` | Propagate `panelId` to openWidgets |
| `__tests__/unit/chat/selection-intent-arbitration.test.ts` | NEW — unit tests |
| `__tests__/integration/chat/selection-intent-arbitration-race.test.ts` | NEW — race sequence integration test |

---

## Verification

```bash
npm run type-check                       # zero errors
npm run test -- selection-intent-arbitration  # all tests pass
```

Manual tests:
1. `"links panel"` → `"open second one"` → `"the second one"` → widget item #2
2. `"links panel"` → `"open second one"` → `"back to options"` → `"second one"` → chat option #2
3. `"links panel"` → `"open recent"` (interrupt) → `"second one"` → Recent widget item #2

## Acceptance Checks (blockers)

1. Three red/green race tests pass (pending latch, command escape, flag-off)
2. Zero direct `focusLatch.widgetId` reads without `kind === 'resolved'` guard
3. `looksLikeNewCommand` at line 2335 uses `mode: 'embedded'`
