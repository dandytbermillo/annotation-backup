# Active Clarification Bounded Arbiter — Detailed Implementation Plan

## Context

**Governing plan:** `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/active-clarification-bounded-arbiter-plan.md`

**Supporting plans (not yet implemented, depend on arbiter):**
- `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/truncated-bounded-context-expansion-plan.md` — compact context packaging for the arbiter
- `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/repair-mode-bounded-arbiter-plan.md` — rejection/correction handling

**Previous work (1-16 + Slices 1-3):** Surface resolver, seeds, delivery state, cue-aware gating, generic-phrase guards, badge split, ordinal-only deterministic, bounded LLM auto-execute, provenance unification.

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

**Current behavior (pre-arbiter):** "open recent" during active clarification shows Deterministic-Surface. After Slice A/B, validated escapes chosen by the arbiter will show 🎯 Bounded-Selection per the main plan.

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
- `"open entries"` after clarifier with live options → bounded LLM selects Entries (Bounded-Selection, not deterministic)

Must not break (no active clarifier — normal routing):
- `"open recent"` → Deterministic-Surface
- `"open entry navigator c"` → deterministic panel open
- `"open continue"` → opens Continue panel (specific, not generic)
- `"show navigator"` → navigator disambiguation
- `"show recent widget entries"` → drawer
- `"list my recent entries"` → chat list

Context-aware combinations (for Slices A+C/B/D):
- Destination cue + clarification overlap: `"open entries in the chat"` while clarifier active → active clarification remains primary, but deterministic selection is ordinal-only; bounded LLM may still select within the shown option set while destination stays constrained to chat
- Destination-constrained clarification: `"show entries"` while clarifier active → active clarification remains primary, but label/name overlap is not deterministic; bounded LLM or re-clarification stays inside the same bounded option set
- Referential active-surface follow-up after clarifier consumed/paused/expired: `"read it"` after clarifier consumed + panel opened → active-surface follow-up wins (only when clarifier is no longer live)
- Stale snapshot invalidation: clarifier shown → unrelated command → `"open entries"` → fresh clarifier (NOT stale snapshot recovery)
- Turn-expired snapshot: clarifier shown → 4 unrelated turns → `"open entries"` → fresh clarifier (snapshot expired at 3 turns)

---

## Verification

1. `npm run type-check`
2. Restart `npm run dev`
3. Manual: "open entries" (no clarifier) → multi-option clarifier
4. Manual: active clarifier + `"the first one"` → Deterministic
5. Manual: active clarifier + `"entries"` → 🎯 Bounded-Selection
6. Manual: active clarifier + `"open budget100"` → validated escape, clarifier paused, 🎯 Bounded-Selection
7. Manual: active clarifier + `"open recent"` → validated escape, clarifier paused, 🎯 Bounded-Selection
8. Manual: active clarifier + `"what is entries?"` → inform, clarifier stays live
9. Manual: paused clarifier + `"the second one"` → resume, select option 2
10. Manual: paused clarifier + `"from chat"` → resume paused clarifier
11. Manual: "open recent" (no clarifier) → Deterministic-Surface
12. Manual: "open continue" (no clarifier) → opens Continue panel

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
- The clarification snapshot is preserved with `pausedReason: 'interrupt'` (runtime uses `'interrupt' | 'stop'`, not `'escape'`)
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

### Residual risk: broad remap can over-label — FIX REQUIRED (Slice B2 step 6)

The current remap condition is `!!lastClarification || pendingOptions.length > 0`. This means ANY executed action during active clarification shows 🎯 Bounded-Selection, even if the action was not actually grounded by the bounded option set.

**Potential false positives:** An unrelated command that happens to execute while clarification is present (but was not grounded by the bounded context) would show Bounded-Selection instead of Auto-Executed.

**Required fix (Slice B2 step 6):** Replace the broad context-presence check with explicit `_executionSource` evidence on routing results. Each execution site sets `_executionSource: 'bounded_arbiter' | 'surface_resolver' | 'memory_exact' | ...` — badge follows source, not ambient state. This is the single provenance model; the old `_uiBoundedSelection` approach is superseded.

### Active Clarification Bounded Arbiter — IN PROGRESS (Gates 1-8 done, Slice B2 next)

**Governing plan:** `active-clarification-bounded-arbiter-plan.md`

#### Slice A: One Arbiter Contract

**Goal:** Define the arbiter input/output contract and route all live-clarifier non-ordinal replies through it. The arbiter is the SOLE decision point — no upstream gate may preempt it.

**Arbiter input:**
- Raw user query (unchanged)
- Active clarification option set with target-class metadata
- Active clarification metadata: `messageId`, `activeOptionSetId`, current turn / TTL status
- Explicit scope/destination cues
- Validated escape targets (from bounded sources)
- Active widget/panel context (secondary evidence only)

**Bounded expansion note:** When truncated-bounded-context is added later, expansion must remain bounded to the same session and arbitration window with a hard request limit (per truncated-bounded-context-expansion-plan.md).

**Arbiter structured decision payload:**
```typescript
type BoundedArbiterDecision = {
  decision: 'select_clarifier_option' | 'escape_to_validated_target' | 'ask_clarify' | 'inform'
  selectedOptionId?: string        // when decision = select_clarifier_option
  targetId?: string                // when decision = escape_to_validated_target
  targetClass?: string             // widget, workspace, entry, panel
  commandRef?: string              // resolved command reference for execution
  resolvedActionRef?: string       // resolved action for downstream consumption
  sourceContext: 'active_clarifier' | 'from_chat' | 'validated_escape' | 'repair_context'
  basedOnTurnIds?: string[]        // turn IDs the decision is grounded on
  confidence: number
  reason: string
}
```

The arbiter does NOT invent new candidate pools. It chooses from existing bounded sources only.

**Existing infrastructure to reuse:**
- `runBoundedArbitrationLoop` at `chat-routing-arbitration.ts:~395`
- `callClarificationLLMClient` at `clarification-llm-fallback.ts:~542`
- System prompt at `clarification-llm-fallback.ts:~121-145`
- Unresolved hook at `chat-routing-clarification-intercept.ts:~1813`

**What changes:** Map existing LLM decisions to arbiter outcomes:
- LLM `select` with confidence ≥ 0.85 → `select_clarifier_option` (auto-execute)
- LLM `select` with lower confidence → `ask_clarify` (re-show with hint)
- LLM `ask_clarify` / `none` → `ask_clarify` (re-show bounded options)
- LLM `reroute` → `escape_to_validated_target` (only if target validates through bounded source)
- Question-intent gate → `inform` (arbiter decides this, not a regex gate upstream)

**Escape-candidate ID preservation (LLM contract requirement):**
When the LLM selects an `__escape_*` candidate (via `select`, `reroute`, or low-confidence select), the concrete `choiceId` (e.g., `__escape_surface_recent`, `__escape_b1_open_panel`) MUST be preserved through `callClarificationLLMClient` → `runBoundedArbitrationLoop` → intercept result → outer wrapper. The `choiceId` carries the escape source and target identity needed for execution. `clarification-llm-fallback.ts` must return the raw `choiceId` for ALL decision types, not just `select`. Slice B2 step 5 depends on this.

**Files:** `chat-routing-arbitration.ts`, `chat-routing-clarification-intercept.ts`

#### Slice B: Remove Chat-Clarifier Preemption

**Goal:** When a live chat clarification exists (`pendingOptions.length > 0` OR paused/resumable `lastClarification`), no upstream gate may **preempt** the arbiter. Upstream lanes may still **collect evidence** (validated escape targets, hint metadata) — they just must not return `handled: true` or skip the tier chain.

**Authority condition:** `const hasLiveClarification = ctx.pendingOptions.length > 0 || !!ctx.lastClarification || !!ctx.clarificationSnapshot`

**Distinction: preemption vs evidence collection.**
- B1 memory lookup and Phase 5 hints produce validated escape targets that the arbiter needs as input.
- The fix is to stop them from EXECUTING or SKIPPING the tier chain — not from running.
- They should run, collect evidence, attach it to the routing result as metadata, then let the arbiter decide.

**All direct executors that must be converted to evidence-only under `hasLiveClarification`:**

| Gate | Location | Current behavior | Fix |
|------|----------|-----------------|-----|
| 1. Semantic-question guard | `routing-dispatcher.ts:~3064` | Returns canned response | Skip when `hasLiveClarification` |
| 2. B1 memory lookup | `routing-dispatcher.ts:~1593` | Returns `handled: true` | Collect evidence, don't return early |
| 3. Content-intent classifier | `routing-dispatcher.ts:~1690` | Executes content answer | Gate with `!hasLiveClarification` |
| 4. Phase 5 hint scope | `routing-dispatcher.ts:~2635` | Skips tier chain | Don't skip when `hasLiveClarification` |
| 5. Widget context bypass | `chat-routing-clarification-intercept.ts:~422` | Returns `handled: false`, defers to resolver | Gate with `!hasLiveClarification` |
| 6. Command verb escape | `chat-routing-clarification-intercept.ts:~1415` | Clears clarification, falls through | Gate with `!hasLiveClarification` — let bounded arbiter decide escape |
| 7. Surface resolver direct execute | `routing-dispatcher.ts:~1829` | Opens panel/drawer directly | Collect as escape evidence, don't execute directly |
| 8. Exact known-noun / deterministic direct executors | `routing-dispatcher.ts` (various) | Direct panel open for "open continue", known-noun routing | Same evidence-only rule under `hasLiveClarification` |

**Implementation rule:** Gates 1-6 are single-line condition changes. Gate 7 (surface resolver) requires converting the execution paths (`list_items`, `open_surface`) to evidence-only when `hasLiveClarification` is true, storing the validated result on `ctx._surfaceEscapeEvidence` so the bounded arbiter can use it.

**Gate status (all 8 fixed):**

| Gate | Status |
|------|--------|
| 1. Semantic-question guard | ✅ Fixed |
| 2. B1 memory lookup | ✅ Fixed: evidence-only, stores `_b1EscapeEvidence` |
| 3. Content-intent classifier | ✅ Fixed |
| 4. Phase 5 hint scope | ✅ Fixed |
| 5. Widget context bypass | ✅ Fixed |
| 6. Command verb escape | ✅ Fixed: gated with `!hasLiveClarificationForBypass` |
| 7. Surface resolver direct execute | ✅ Fixed: evidence-only, stores `_surfaceEscapeEvidence` |
| 8. Known-noun direct execute | ✅ Fixed: evidence-only via `matchKnownNoun` |

**Paused-clarifier resume (all forms verified):**
- Ordinals: `the second one` → resume + select ✅
- Scope cues: `from chat` → visible re-show with pills ✅
- Command + scope: `open first option from chat` → resume + select ✅
- Verb-less + scope: `the first option from chat` → resume + select ✅
- Arbiter gate includes `!!ctx.clarificationSnapshot` for paused snapshot protection ✅

### Slice B2: Clean implementation pass — unified escape architecture (NEXT)

**Problem:** The current escape evidence path uses ad-hoc surface resolver exact matching. Typos like "opeen recent" fail because the surface resolver doesn't fuzzy-match. The existing B2 semantic pipeline (learned/seeded rows with embedding similarity) already handles typos — it should be reused for escape evidence during active clarification.

**Goal:** Under live clarification, escape candidates come from the existing learned/seeded semantic model — not a separate ad-hoc shortcut.

**Escape candidate sources (under live clarification):**
1. **B1 exact replay** — existing, already wired as `_b1EscapeEvidence`
2. **Phase 5 semantic hints** — `lookupSemanticHints` with learned/seeded rows (NOT legacy `lookupSemanticMemory`). Handles typos via rewrite-assisted retrieval. "opeen recent" matches "open recent" seed.
3. **Surface resolver** — existing, already wired as `_surfaceEscapeEvidence` (exact/curated seed only)
4. **Known-noun** — existing, already wired as `_knownNounEscapeEvidence`

**What changes:** Use Phase 5 `lookupSemanticHints` (not legacy B2 `lookupSemanticMemory`) for semantic escape evidence during active clarification. Legacy B2 stays for no-clarifier behavior only.

**Decision ladder (under live clarification):**
1. **All escape evidence** (B1 exact, surface resolved, known-noun, B2 semantic) is collected as bounded candidates — none resolves directly
2. **Bounded LLM** over: active clarifier options + all validated/semantic escape candidates → LLM decides
3. **Re-show clarifier** if unresolved
4. No pre-LLM direct escape — the bounded LLM arbiter is the sole decision point

**Authority rule:** The arbiter is the sole decision point. No escape source may bypass it. B2 semantic rows are hints for the bounded LLM, NOT execution authority. This aligns with Phase 5's retrieval-is-hint-only principle.

**Unique target rule:** If more than one escape source produces a candidate on the same turn, ALL candidates are presented to the bounded LLM. The LLM chooses. No fixed code-order precedence.

**Live clarification condition:** `pendingOptions.length > 0 || !!lastClarification || !!clarificationSnapshot` — includes paused snapshot/recovery state, not just active pending options.

**No-clarifier behavior unchanged.** B1, B2, surface resolver, known-noun all work exactly as before when no live clarification exists.

**Known structural issues (must fix in this pass):**
1. Gate 3 nesting error: `!hasLiveClarificationForGate` accidentally gates the entire `STAGE6_SHADOW_ENABLED` block (surface resolver, arbiter, etc.) — not just the content-intent classifier
2. Pre-LLM escape shortcut at intercept line ~1818 conflicts with arbiter-as-sole-decision-point
3. `_semanticEscapeAction` is boolean-only — chosen target is lost
4. Badge derived from ambient state (`!!lastClarification || pendingOptions.length > 0`), not actual execution source
5. Two competing semantic retrieval systems (legacy B2 `lookupSemanticMemory` vs Phase 5 `lookupSemanticHints`)

**Implementation (clean pass, in order):**

1. **Fix Gate 3 nesting** — move `!hasLiveClarificationForGate` INSIDE the `STAGE6_SHADOW_ENABLED` block to wrap ONLY the content-intent classifier call, not the surface resolver/arbiter
2. **Delete pre-LLM escape shortcut** — remove the branch at intercept line ~1818. All escape sources go through the bounded arbiter.
3. **Unify semantic source** — use Phase 5 `lookupSemanticHints` (learned/seeded, typo-tolerant) for active-clarifier escape. Stop using legacy `lookupSemanticMemory` for this path. Legacy B2 stays for no-clarifier behavior.
4. **Concrete escape payload** — replace `_semanticEscapeAction?: boolean` with structured payload: `{ candidateId, targetId, intentId, slotsJson, label, similarity }`. Same for B1/surface/knownNoun escape actions. Thread from intercept to outer wrapper execution.
5. **Symmetric `__escape_*` handling** — all confidence levels (high select, low select, reroute) preserve the concrete chosen escape candidate
6. **Evidence-based provenance** — stop inferring badge from ambient state. Add explicit `_executionSource: 'bounded_arbiter' | 'surface_resolver' | 'memory_exact' | ...` to routing result. Badge follows source, not context presence.
7. **Update tests** — regression matrix from the plan

**Required regressions:**

| Input | Active clarifier? | Expected |
|-------|------------------|----------|
| `open recent` (first turn) | Yes | 🎯 Bounded-Selection (validated escape) |
| `open recent` (repeated) | Yes | 🎯 Bounded-Selection |
| `opeen recent` (typo) | Yes | 🎯 Bounded-Selection (B2 semantic match) |
| `open recnet` (typo) | Yes | 🎯 Bounded-Selection (B2 semantic match) |
| `open recent widget` | Yes | 🎯 Bounded-Selection |
| `from chat` (after escape) | Paused | ✅ Re-shows paused options |
| `the first option from chat` | Paused | ✅ Resumes + selects |

**Mixed-case adversarial regression:**

| Input | Active clarifier? | Expected |
|-------|------------------|----------|
| `open entries` (overlaps option "Entries" AND could match entry items) | Yes | Bounded LLM selects from clarifier options — NOT escape |
| `open navigator` (overlaps multiple options AND could be known-noun) | Yes | Bounded LLM selects from clarifier options — NOT escape |

**Files:** `routing-dispatcher.ts`, `chat-routing-types.ts`, `chat-routing-clarification-intercept.ts`, `clarification-llm-fallback.ts`, `chat-navigation-panel.tsx`

#### Slice C: Widget Context Secondary

**Goal:** Widget context must not silently replace active chat clarification.

- Widget context is evidence for the arbiter, not a takeover signal
- Widget takeover allowed ONLY when: explicit widget scope, arbiter chooses validated widget escape, or arbiter identifies conflict
- Paused chat clarifier resumes before widget context on next turn

#### Slice D: Provenance — REQUIRED (implemented by Slice B2 step 6)

- Current `bounded_clarification` provenance is derived from ambient state (`!!lastClarification || pendingOptions.length > 0`), which causes badge drift
- Slice B2 step 6 replaces this with explicit `_executionSource` evidence on routing results — this is REQUIRED, not deferred
- Badge follows actual execution source, not context presence
- `bounded_clarification` provenance already implemented across 10 lanes (must be replaced with evidence-based approach in Slice B2 step 6)
- All 10 provenance sites listed in §2 must be updated to set `_executionSource` instead of checking ambient clarification state

#### Slice E: Diagnostics

- Whether active clarification was live
- Whether widget context was also live
- Whether ordinal deterministic fired
- Arbiter outcome
- Whether escape target was validated
- Whether fallback re-clarified

### Dependencies

| Plan | Status | Depends on |
|------|--------|------------|
| Active-clarifier arbiter (this) | In progress (Slice B2 next) | — |
| Truncated bounded context | After arbiter | Stable arbiter contract |
| Repair mode | After context | Stable arbiter + stable context |
| Stale-state lifetime controls | After arbiter | Arbiter handles expiry |
| Telemetry fields | After arbiter | Arbiter structured outcomes |

---

## Regression tests (aligned with active-clarification-bounded-arbiter-plan.md)

### Ordinal deterministic

| Input | Active clarifier? | Expected |
|-------|------------------|----------|
| `the first one` | Yes | Deterministic → select option 1 |
| `option 1` | Yes | Deterministic → select option 1 |
| `2` | Yes | Deterministic → select option 2 |

### Bounded LLM selection

| Input | Active clarifier? | Expected |
|-------|------------------|----------|
| `entries` | Yes | 🎯 Bounded-Selection |
| `that entry navigator` | Yes | 🎯 Bounded-Selection |
| `can open that entries in the list` | Yes | 🎯 Bounded-Selection |
| `pls open that entries` | Yes | 🎯 Bounded-Selection |

### Validated escape

| Input | Active clarifier? | Expected |
|-------|------------------|----------|
| `open budget100` | Yes | 🎯 Bounded-Selection (arbiter chose validated escape) |
| `open recent` | Yes | 🎯 Bounded-Selection (arbiter chose validated escape) |
| `go home` | Yes | 🎯 Bounded-Selection (arbiter chose validated escape) |

### Paused clarifier resume

| Input | State | Expected |
|-------|-------|----------|
| `the second one` | Paused (after escape) | Resume → select option 2 |
| `from chat` | Paused (after escape) | Resume paused clarifier |
| `that first option` | Paused (after escape) | Resume + ordinal select option 1 |
| `hello` | Paused (after escape) | Paused expires via TTL |

### Genuine questions (should NOT execute)

| Input | Active clarifier? | Expected |
|-------|------------------|----------|
| `what is entries?` | Yes | Inform (clarifier stays live) |
| `which one is Entry Navigator?` | Yes | Inform |
| `can you explain how to open entries?` | Yes | Inform |

### Question-intent with escape evidence (must NOT auto-execute)

| Input | Active clarifier? | Escape evidence present? | Expected |
|-------|------------------|--------------------------|----------|
| `what is recent?` | Yes | Surface: recent widget | Inform only — do NOT execute escape (clarifier stays live) |
| `what does open budget100 do?` | Yes | Known-noun: budget100 | Inform only — do NOT execute escape (clarifier stays live) |

### No active clarification (normal routing)

| Input | Active clarifier? | Expected |
|-------|------------------|----------|
| `open entries` | No | Multi-option clarifier |
| `open recent` | No | Deterministic-Surface |
| `open continue` | No | Opens Continue panel |

### Must not happen

- Live chat clarifier replaced by widget-only options
- Stage 6 execution before bounded arbiter exhausted
- Widget context overriding chat clarification without explicit scope
- Direct executor (surface resolver, known-noun, B1) preempting bounded arbiter during live clarification
- `question_intent` + escape evidence auto-executing (must be `inform` only)
