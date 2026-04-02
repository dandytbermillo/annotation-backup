# Clarification-First Bridge + Shared Context Decision Helper

## Context

**Governing plan:** `clarification-vs-active-surface-priority-plan.md`
**Previous slices (1-16):** Surface resolver, seeds, delivery state, cue-aware gating, arbitration, S6 seam, Recent-evidence guard, generic-phrase guards, badge split, etc.

---

## Plan §1: Shared Context Decision Helper — IMPLEMENTED

**File:** `lib/chat/context-decision-helper.ts`

### What's implemented

- `resolveContextDecision()` with enriched input contract: `pendingOptions`, `lastClarification`, `lastOptionsShown`, `clarificationSnapshot`, `activeOptionSetId`, `activeSurface`, `isReferentialInput`
- Source precedence: pendingOptions > lastClarification > lastOptionsShown > clarificationSnapshot
- Lifetime validation via `isSourceValid()` with per-source TTLs and lineage alignment
- `isOrdinalSelection()` — deterministic selection limited to ordinals only
- Generic phrases only match from live `pendingOptions` (recoverable sources skipped)
- Clarification escape policy: non-generic inputs stay in bounded set when clarification active

### Ordinal-only deterministic policy (implemented)

- `clarification_selection` returned ONLY for ordinal inputs (`1`, `first`, `the first one`, `option 1`)
- Label/name matches (`entries`, `entry navigator`) → return `mode: 'none'` → fall through to bounded LLM
- No DB-seeded/learned row may make label-based clarification replies deterministic

---

## Plan §2: Wire Helper in ALL Lanes — MOSTLY DONE

### What's implemented

| Consumer | Status | Notes |
|----------|--------|-------|
| a) Clarification intercept (Tier 0/1) | **Done** | Called at `chat-routing-clarification-intercept.ts:~1259`, enriched input contract |
| b) Routing dispatcher (secondary) | **Done** | Called at `routing-dispatcher.ts:~3330`, after clarification-clearing, before scope-cue/grounding |
| c) Intent-resolver (server-side) | **Covered differently** | `isGenericAmbiguousPanelPhrase` + `buildStemBoundedCandidates` guards at 5 sites |
| d) Active-surface follow-up | **Not wired** | Helper supports `active_surface_followup` mode, but callers don't pass full active-surface state |

### Clarification-owns-the-turn gate (Slice 1, DONE)

- Arbiter skipped entirely when `pendingOptions.length > 0 || !!lastClarification` — single outer gate at `routing-dispatcher.ts:~1990`
- Per-branch guards reverted (redundant with outer gate)
- Ordinals and bare nouns reach the intercept for deterministic/bounded-LLM handling

### Bounded LLM for active clarification (Slice 2/3, DONE)

- Non-ordinal label matches fall through to the unresolved hook → `runBoundedArbitrationLoop` → bounded LLM
- Generic-phrase veto removed from bounded-clarification auto-execute path
- `preferredCandidateHint` with `source: 'label_match'` passed for single label matches
- Bounded LLM handles natural language, demonstratives ("that entries"), typos ("i wnat that entry navigator d")

### Provenance unification (DONE)

- New `bounded_clarification` provenance (🎯 Bounded-Selection badge) for bounded-context selections
- Truthful re-show provenance: `llm_influenced` only when `llmResult.attempted && llmResult.suggestedId`

**All provenance sites covered (runtime-verified):**

| Lane | File | Line | Status |
|------|------|------|--------|
| Intercept bounded LLM auto-execute | `chat-routing-clarification-intercept.ts` | ~1890 | ✅ `bounded_clarification` |
| Tier 3.6 constrained-LLM select | `routing-dispatcher.ts` | ~5705 | ✅ `bounded_clarification` |
| Selection typo LLM select | `routing-dispatcher.ts` | ~5072 | ✅ `bounded_clarification` |
| Grounding deterministic select | `routing-dispatcher.ts` | ~6182 | ✅ `bounded_clarification` |
| Grounding deterministic select (message fallback) | `routing-dispatcher.ts` | ~6221 | ✅ `bounded_clarification` |
| Grounding referent-execute | `routing-dispatcher.ts` | ~6698 | ✅ context-aware remap |
| Scope-cue ordinal select | `chat-routing-scope-cue-handler.ts` | ~275 | ✅ `bounded_clarification` |
| B1 replay (message + badge setter) | `chat-navigation-panel.tsx` | ~1893, ~1934 | ✅ context-aware remap |
| Navigate API fallthrough | `chat-navigation-panel.tsx` | ~3224 | ✅ context-aware remap |
| Select-option handler | `chat-navigation-panel.tsx` | ~2695 | ✅ preserves from routing result |

**No false positives observed:** "open recent" during active clarification correctly shows Deterministic-Surface (surface resolver sets its own provenance explicitly).

### What's still missing

- Dispatcher Tier 3.6 and other independent paths still do not consult the shared helper first
- Active-surface follow-up not wired through the helper
- Broad remap residual risk (documented below)

---

## Plan §3: Prevent Memory-Exact Writeback — DONE

| Sub-item | Status |
|----------|--------|
| a) `_fromClarifiedSelection` flag on bridge result | Done (`chat-routing-clarification-intercept.ts`, `chat-routing-types.ts`) |
| b) Propagate flag into pending write | Done (`chat-navigation-panel.tsx:~2174`) |
| c) Gate promotion on generic-phrase | Done — widened: blocks ALL `open_panel` writebacks for generic ambiguous phrases (`routing-dispatcher.ts:~1433`) |
| d) Stale row cleanup | Done — deleted rows for "open entries" and "show entries" |

---

## Plan §4: Recent Writeback Suppression — DONE

Writeback suppression for surface-resolver-owned Recent drawer turns at `chat-navigation-panel.tsx:~2135`. Narrowed to Recent-only (checks `panelTitle` contains "recent").

---

## Plan §5: Telemetry — NOT DONE

None of the 4 planned telemetry fields are implemented:
- `context_decision_mode`
- `context_decision_version`
- `clarification_source_used`
- `context_losing_lane`

---

## Additional implemented work (not in original plan)

### Generic-phrase guards — client-side (runtime-verified)

- **Widened promotion gate** (`routing-dispatcher.ts:~1433`): blocks ALL `open_panel` writebacks for generic ambiguous phrases
- **Stale-recovery guards** at 4 sites in `routing-dispatcher.ts`:
  - `selection_from_message` (~4927), `label_match_from_message` (~4972), Tier 3.6 recoverable-chat (~5377)
  - All guarded by `isGenericAmbiguousPanelPhrase` — only live `pendingOptions` can resolve generic phrases
- **Single-panel auto-execute veto** (`routing-dispatcher.ts:~6701`): `!isGenericAmbiguousPanelPhrase`
- **Collapsed candidate expansion** (`routing-dispatcher.ts:~6757`): expands single `visible_panels` candidate to stem-matched set

### Generic-phrase guards — server-side (2026-03-30)

Report: `docs/proposal/chat-navigation/reports/2026-03-30-generic-phrase-server-guard-implementation.md`

**Root cause:** LLM classifies "open entries" as `panel_intent` with `panelId: 'navigator'`. Server-side `resolvePanelIntent` → `resolveDrawerPanelTarget` → duplicate-family resolution returned `open_panel_drawer` without any generic-phrase check.

**Shared stem helper** (`lib/chat/generic-phrase-guard.ts`):
- `expandStems()`: "entries" → ["entries", "entry"]
- `buildStemBoundedCandidates()`: filters visible widgets by stem-matched titles. Never falls back to all visible widgets.

**5 unified guard sites** (all use `buildStemBoundedCandidates`):

| Site | Location | Zero-candidate behavior |
|------|----------|------------------------|
| 1. Primary `shouldOpenDrawer` | `intent-resolver.ts:~2998` | `inform` (hard stop) |
| 2. Inner `resolveDrawerPanelTarget` | `intent-resolver.ts:~2828` | `not_found` |
| 3. `executePanelIntent` pass-through | `intent-resolver.ts:~3180` | `inform` (hard stop) |
| 4. Workspace-not-found | `intent-resolver.ts:~420` | Falls to `error` — safe for execution, but not "latest conversation stays primary" |
| 5. `resolveBareName` | `intent-resolver.ts:~2373` | Falls to `panelMatches` exact-match — safe for execution, but not "latest conversation stays primary" |

### Other fixes

- **Summary endpoint** (`conversations/[id]/summary/route.ts`): incremental bounded summarization, 10s timeout
- **Stale row cleanup**: deleted `open_panel` rows for "open entries" and "show entries"

---

## Tests

Must pass:
- `"open entries"` → multi-option clarifier (never Auto-Executed, never single-option, never error)
- `"open entries"` repeated → still clarifier (never Memory-Exact)
- `"open entries"` after clarifier with live options → bridge selects Entries (Deterministic)

Must not break:
- `"open recent"` → Deterministic-Surface
- `"open entry navigator c"` → deterministic panel open
- `"open continue"` → opens Continue panel (specific, not generic)
- `"show navigator"` → navigator disambiguation
- `"show recent widget entries"` → drawer
- `"list my recent entries"` → chat list

Context-aware combinations (for Slices A+C/B/D):
- Destination cue + clarification overlap: `"open entries in the chat"` while clarifier active → active clarification remains primary, but deterministic selection is ordinal-only; bounded LLM may still select within the shown option set while destination stays constrained to chat
- Destination-constrained clarification: `"show entries"` while clarifier active → active clarification remains primary, but label/name overlap is not deterministic; bounded LLM or re-clarification stays inside the same bounded option set
- Referential active-surface follow-up while clarifier recent: `"read it"` after clarifier shown + panel opened → active-surface follow-up wins (not stale clarifier)
- Stale snapshot invalidation: clarifier shown → unrelated command → `"open entries"` → fresh clarifier (NOT stale snapshot recovery)
- Turn-expired snapshot: clarifier shown → 4 unrelated turns → `"open entries"` → fresh clarifier (snapshot expired at 3 turns)

---

## Verification

1. `npm run type-check`
2. Restart `npm run dev`
3. Manual: "open entries" → multi-option clarifier
4. Manual: active clarifier + `"the first one"` / `"option 1"` → deterministic selection
5. Manual: active clarifier + `"entries"` / `"open entries"` → bounded LLM or re-clarify, never deterministic
6. Manual: "open recent" → Deterministic-Surface
7. Manual: "open continue" → opens Continue panel
8. Manual: "open entry navigator c" → deterministic panel open

---

## Remaining work — implementation order

### Core invariant: Clarification owns the turn while active

When `pendingOptions` or `lastClarification` are active, the routing order is:

1. **Ordinal deterministic** — `1`, `2`, `the first one`, `option 1`, `second` → execute directly
2. **Bounded LLM** — everything else (`entries`, `open entries`, `show entries`) → LLM selects from the SAME bounded option set, no fresh candidates
3. **Re-show clarification** — if bounded LLM can't resolve → re-show same options with escape guidance ("Did you mean one of these, or something else?")
4. **General routing** — only after explicit exit (TTL expires, user dismisses, successful selection consumes, explicit unrelated escape detected)

**What is NOT deterministic during active clarification:**
- Label/component-name replies: `entries`, `entry`, `home`, `recent`
- Command-shaped label replies: `open entries`, `show entries`
- No DB-seeded/learned row may make label-based clarification replies deterministic

**What IS deterministic:**
- Ordinal/pill forms only: `1`, `2`, `first`, `second`, `the first one`, `option 1`

**Specific-target escape:**
- Allowed ONLY when the escaping target is validated by a bounded candidate source (note manifest, panel registry, entry resolver — not free-text specificity alone)
- Example: active clarifier showing panel options, user says `open budget100` → escape if `budget100` is a validated note/entry
- Example: `link panel b` → escape if it's a validated active-surface target
- If the same turn is also plausibly selecting from active clarification → conflict → re-clarify

**Pause vs clear on escape:**
- When a validated specific-target escape fires, the active clarification is **paused** (not cleared)
- The clarification snapshot is preserved with `pausedReason: 'escape'`
- On the next turn, if the user says something that matches the paused option set (e.g., `the second one`), the clarification is **resumed** from the paused snapshot
- If the user continues with unrelated commands, the paused clarification expires via normal TTL
- This enables: `open budget100` → navigates to budget100 → `the second one` → resumes paused clarifier → selects option 2

### Slice 1: Clarification-owns-the-turn gate — DONE

- Single outer arbiter gate at `routing-dispatcher.ts:~1990`: `&& !hasActiveClarification`
- Per-branch guards reverted (redundant with outer gate)
- Runtime-verified: "entries", "the first one", "that entry navigator c" all bypass arbiter

### Slice 2: Ordinal-only deterministic — DONE

- Intercept at `chat-routing-clarification-intercept.ts:~1538`: `isOrdinalInput` check gates deterministic execution
- Helper at `context-decision-helper.ts:~216`: `isOrdinalSelection()` gates `clarification_selection`
- Non-ordinal label matches pass `preferredCandidateHint` (source: `'label_match'`) and fall through to bounded LLM
- Runtime-verified: "the first one" → Deterministic; "entries" → bounded LLM

### Slice 3: Bounded LLM for active clarification — DONE

- Existing `runBoundedArbitrationLoop` at intercept line ~1813 handles bounded LLM
- Generic-phrase veto removed from auto-execute path (line ~1854)
- Bounded LLM handles natural language, demonstratives, typos
- Re-show with escape guidance on bounded LLM miss
- Runtime-verified: "entries" → Bounded-Selection; "i wnat that entry navigator d" → Bounded-Selection

### Provenance unification — DONE

- New `bounded_clarification` provenance (🎯 Bounded-Selection) at both intercept and Tier 3.6
- `chat-navigation-panel.tsx:~2695`: preserves `bounded_clarification` from routing result
- Truthful re-show: `llm_influenced` only when `llmResult.attempted && llmResult.suggestedId`
- Report: `docs/proposal/chat-navigation/reports/2026-03-31-clarification-owns-the-turn-implementation.md`

### B1 memory replay badge remap — DONE (broad remap)

- All executed-action provenance sites now remap to `bounded_clarification` when active clarification is present
- Sites covered: B1 replay (×2), grounding referent-execute, Tier 3.6, navigate API fallthrough
- Internal routing logs still record original lane provenance (`memory_exact`, `llm` etc.)

### Residual risk: broad remap can over-label

The current remap condition is `!!lastClarification || pendingOptions.length > 0`. This means ANY executed action during active clarification shows 🎯 Bounded-Selection, even if the action was not actually grounded by the bounded option set.

**Potential false positives:** An unrelated command that happens to execute while clarification is present (but was not grounded by the bounded context) would show Bounded-Selection instead of Auto-Executed.

**Evidence-based fix (deferred):** Replace the broad context-presence check with a narrow `_uiBoundedSelection: true` flag set only at real grounding sites (bounded clarification execute, Tier 3.6 active-option select, validated referent-execute, replay validated against active context). Only implement if false positives appear in runtime testing.

**Decision gate:** Runtime-test for false positives first. If they show up in practice, implement the evidence-based refactor. If not, keep the current broad remap.

### Slice 4: Stale-state lifetime controls (High)

Same as previous Slice B — turn-based expiry for `clarificationSnapshot`, hard TTL for `lastOptionsShown`, sole-owner validation in the shared helper.

| Source | Current lifetime | Target lifetime |
|--------|-----------------|-----------------|
| `pendingOptions` | Cleared on bypass/new command | No change |
| `lastOptionsShown` | Soft ~2 turns | Hard 2-turn TTL |
| `clarificationSnapshot` | No expiry | Hard 3-turn TTL, invalidated on unrelated command |
| `lastClarification` | Cleared when `clarificationCleared` | No change |

**Files:** `chat-navigation-context.tsx`, `context-decision-helper.ts`

### Slice 5: Active-surface wiring through helper (Medium)

Same as previous Slice D — aggregate focus latch, widget selection, previous routing metadata into the helper's `activeSurface` input. Enforce conflict mode when both clarification and active surface produce plausible targets.

### Slice 6: Telemetry (Medium)

Same as previous Slice E — 4 fields: `context_decision_mode`, `context_decision_version`, `clarification_source_used`, `context_losing_lane`.

### Remaining low-priority items

| Item | Priority |
|------|----------|
| Clarification wording improvement (token-derived option sets) | Low |
| Remove diagnostic `console.log` from `intent-resolver.ts`, `navigate/route.ts`, `routing-dispatcher.ts` | Low |
| Close `resolveBareName` zero-candidate fallthrough | Low |
| Close workspace-not-found zero-candidate fallthrough | Low |

---

## Regression tests

### Active clarification — deterministic (ordinal-only)

| Input | Active clarifier? | Expected |
|-------|------------------|----------|
| `the first one` | Yes (4 options) | Deterministic → select option 1 |
| `option 1` | Yes | Deterministic → select option 1 |
| `2` | Yes | Deterministic → select option 2 |
| `second` | Yes | Deterministic → select option 2 |

### Active clarification — bounded LLM (not deterministic)

| Input | Active clarifier? | Expected |
|-------|------------------|----------|
| `entries` | Yes (options include "Entries") | Bounded LLM or re-clarify, NEVER deterministic |
| `open entries` | Yes | Bounded LLM or re-clarify, NEVER deterministic |
| `show entries` | Yes | Bounded LLM or re-clarify |
| `entry navigator` | Yes (options include "Entry Navigator") | Bounded LLM or re-clarify |

### Active clarification — specific-target escape and resume

| Input | Active clarifier? | Expected |
|-------|------------------|----------|
| `open budget100` | Yes (panel options) | Escape ONLY if `budget100` is a validated bounded target; clarification paused |
| `link panel b` | Yes | Escape ONLY if validated active-surface target; clarification paused |
| `open links panel cc` | Yes (options don't include it) | Escape if validated, conflict if plausibly overlapping |
| `the second one` | Paused (after escape) | Resume paused clarification → select option 2 |
| `hello` | Paused (after escape) | Paused clarification expires via TTL → general routing |

### Active clarification — no fallthrough

| Input | Active clarifier? | Expected |
|-------|------------------|----------|
| `entries` | Yes | NOT: arbiter "I'm not sure" / NOT: "The visible panels are:" / NOT: navigate API |
| `the first one` | Yes | NOT: arbiter ambiguous / NOT: Safe Clarifier |
| `open entries` | Yes | NOT: blue Auto-Executed / NOT: Memory-Exact |

### No active clarification — normal routing

| Input | Active clarifier? | Expected |
|-------|------------------|----------|
| `open entries` | No | Multi-option stem-matched clarifier |
| `open recent` | No | Deterministic-Surface |
| `open continue` | No | Opens Continue panel |
| `open entry navigator c` | No | Deterministic panel open |
