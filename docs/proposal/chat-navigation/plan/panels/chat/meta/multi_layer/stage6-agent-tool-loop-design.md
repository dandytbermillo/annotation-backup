# Stage 6: Agent Tool Loop — Design Note

**Date**: 2026-03-11
**Parent plan**: `multi-layer-routing-reliability-plan-v3_5.md`
**Predecessor**: Stage 5 (Semantic Resolution Reuse) — closed 2026-03-11, runtime-proven
**Ordering rationale**: `stage-ordering-rationale.md`
**Status**: Design draft

---

## 1) Goal

Replace the current single-shot routing model with a structured **agent/tool loop**: the LLM can inspect app state, request more information, and act — all through typed tool contracts. The objective is to reduce unnecessary clarifiers by giving the model enough context to resolve ambiguity itself, while keeping the app authoritative over execution.

**Product behavior**: User says "open the budget report I was looking at yesterday" → model inspects recent items, finds the match, executes — no clarifier needed.

**Non-goal**: General-purpose AI agent. The loop is scoped to navigation, disambiguation, and structured actions within the existing routing tier system.

---

## 2) Tool Boundary

Three categories define what the LLM can and cannot do:

### 2a) Inspectable (model can ask the app to read)

| Tool | Returns | Scope |
|------|---------|-------|
| `inspect_active_widget` | Widget ID, label, visible items/options, scroll position | Current focused widget |
| `inspect_dashboard` | Dashboard ID, name, list of open widget slugs + labels | Current workspace |
| `inspect_visible_items` | Structured list of items visible across all open widgets | All open widgets |
| `inspect_recent_items` | Recently accessed items with timestamps | User history |
| `inspect_search` | Matching item IDs, labels, and short snippets (max 80 chars) | Name/label index only; no body text search |

All inspection tools return **structured JSON**, never raw DOM or uncontrolled UI dumps.

`inspect_search` is intentionally narrow: it searches item names and labels only, not document body content. Results are typed `{ id, label, widgetId, snippet, score }[]` with snippet capped at 80 characters. Body-text search is deferred and would require a separate tool with explicit content exposure rules.

### 2b) Executable (model can ask the app to perform)

| Tool | Effect | Validation |
|------|--------|------------|
| `open_widget_item` | Open a specific item in a specific widget | Target must exist + be visible |
| `open_panel` | Open/focus a panel by slug | Panel must be registered |
| `navigate_entry` | Navigate to an entry by ID | Entry must exist |

All execution tools are **validated before dispatch** — the app rejects invalid targets.

### 2c) Clarification (model-requested, app-authoritative)

Clarification is **not** a normal action tool. It is a structured request from the model to the app:

- The model emits a `request_clarification` signal with candidate IDs and a reason
- The **app** decides whether to show the clarifier, how to format it, and what options to present
- The app may reject a clarification request (e.g., if only one candidate exists, force the model to act)
- The app controls the clarifier UI, option ordering, and user interaction

This keeps clarification app-authoritative even when model-suggested. The model cannot directly render options to the user.

### 2d) App-Authoritative (model cannot override)

- Panel registration and lifecycle
- Widget data loading and refresh
- Authentication and permissions
- Layout and positioning
- Feature flags and kill switches
- Clarifier rendering and option presentation
- Tier 0-3 deterministic routing (model enters only when deterministic tiers don't resolve)

---

## 3) Observation Model

### 3a) Structured Snapshots

The model receives structured state, not raw UI. Each snapshot type has a defined schema:

**WidgetSnapshot**
```typescript
interface WidgetSnapshot {
  widgetId: string        // slug (e.g., "w_links_b")
  label: string           // display name
  panelId: string         // parent panel UUID
  items: {
    id: string
    label: string
    type: string          // "entry" | "folder" | "link"
    visible: boolean      // currently in viewport
  }[]
  itemCount: number       // total, including non-visible
  scrollPosition?: number // normalized 0-1
}
```

**DashboardSnapshot**
```typescript
interface DashboardSnapshot {
  dashboardId: string
  dashboardName: string
  widgets: {
    widgetId: string
    label: string
    panelId: string
    itemCount: number
  }[]
  widgetCount: number
}
```

**RecentItemsSnapshot**
```typescript
interface RecentItemsSnapshot {
  items: {
    id: string
    label: string
    widgetId: string
    lastAccessedAt: string  // ISO timestamp
  }[]
  windowDays: number        // how far back the query looked
}
```

### 3b) Snapshot Freshness

- Snapshots are computed **at tool-call time**, not cached
- Each snapshot includes a `captured_at` timestamp
- The model must not assume stale snapshots are current across turns

### 3c) No Raw UI Dump

The model never receives:
- HTML/DOM content
- Raw TipTap document JSON
- Pixel coordinates or layout metrics
- Unstructured log output

---

## 4) Action Model

### 4a) Validation Rules

Every execution tool call is validated before dispatch:

1. **Target exists**: The referenced ID/slug must resolve to a real entity
2. **Target visible**: For widget items, the parent widget must be open
3. **Permission check**: Action must be within the user's permission scope
4. **Idempotency**: Duplicate actions within a short window are deduplicated

### 4a-1) Final Revalidation (TOCTOU Guard)

Inspection snapshots can go stale during the multi-round loop. The app MUST revalidate against **fresh state** immediately before executing any action tool call:

- **Not trusted**: Snapshot data from earlier inspect rounds
- **Trusted**: Live state at commit point only

If revalidation fails (target moved, widget closed, item deleted since inspection), the action is rejected and the model receives a structured error. This is the same commit-point pattern used in Stage 4 (G5 TOCTOU shadow revalidation) and Stage 5 (Gate 3 target validation), extended to the tool loop.

### 4b) Reversibility Policy

| Action | Reversible | Policy |
|--------|-----------|--------|
| Open item/panel | Yes | Execute without confirmation |
| Navigate to entry | Yes | Execute without confirmation |
| Modify content | No | Require explicit user confirmation |
| Delete item | No | Require explicit user confirmation |

Stage 6 scope is **read + navigate only**. Content mutation tools are deferred. `close_panel` is not in the Stage 6 action contract; if needed later, it would be a reversible action requiring no confirmation.

### 4c) Clarify-vs-Act Decision

The model MUST clarify (not act) when:

- Multiple plausible targets with no distinguishing signal
- User intent is ambiguous (question vs command)
- Confidence is below a threshold (defined per tool)
- The action would affect data the user hasn't seen

The model SHOULD act (not clarify) when:

- Exactly one target matches
- User intent is unambiguous command form
- Prior resolution exists in memory (Stage 5)
- Context makes the target obvious (e.g., only one widget open)

---

## 5) Loop Shape

```
User Request
    │
    ▼
┌─────────────────────────┐
│  Tier 0-3: Deterministic │ ──► resolved? → execute + done
│  (unchanged)             │
└─────────────────────────┘
    │ not resolved
    ▼
┌─────────────────────────┐
│  Stage 5: Memory Replay  │ ──► replay eligible? → execute + done
│  (unchanged)             │
└─────────────────────────┘
    │ not resolved
    ▼
┌─────────────────────────┐
│  Stage 4: Bounded LLM    │ ──► confident select? → execute + done
│  (single-shot, fast path)│
└─────────────────────────┘
    │ abstain / low confidence
    ▼
┌─────────────────────────┐
│  Stage 6: Tool Loop      │
│                          │
│  1. Model receives:      │
│     - user input         │
│     - dashboard snapshot │
│     - grounding set      │
│     - Stage 4 abstain    │
│       reason             │
│                          │
│  2. Model may call:      │
│     - inspect_* tools    │
│     (up to N rounds)     │
│                          │
│  3. Model decides:       │
│     - execute action     │
│     - request_clarify    │
│     - abort (can't help) │
│                          │
│  4. App validates:       │
│     - TOCTOU revalidation│
│     - clarify approval   │
│                          │
└─────────────────────────┘
    │
    ▼
  Execute / Clarify / Abort
    │
    ▼
  Memory Write (if executed)
  Durable Log (always)
```

### 5a) Loop Constraints

- **Max rounds**: Configurable cap on inspect calls per request (default: 3)
- **Timeout**: Total loop budget (default: 5 seconds)
- **Fallback**: If loop exhausts rounds or timeout → clarifier with best candidates
- **No side effects during inspection**: inspect_* tools are read-only
- **Single action per loop**: Model emits at most one execution tool call

### 5b) Stage 4 / Stage 6 Handoff (Explicit Rule)

**Stage 4 runs first, Stage 6 runs only on Stage 4 abstain or explicit escalation.**

The routing order is: Tier 0-3 → Stage 5 → **Stage 4** → Stage 6.

- **Stage 4 resolves**: Single-shot bounded LLM selects a candidate with sufficient confidence → execute. Stage 6 does not run.
- **Stage 4 abstains** (`need_more_info`): Stage 4 cannot resolve with the grounding set alone → hand off to Stage 6 tool loop.
- **Stage 4 low confidence**: LLM returns a selection but below confidence threshold → hand off to Stage 6 for inspection-based disambiguation. Note: Stage 4 G1 shadow threshold is currently frozen (shadow-only, not enforced). Until G1 enforcement is live, the "low confidence" escalation to Stage 6 is triggered only by explicit `need_more_info` abstain, not by a numeric confidence gate. When G1 enforcement activates, it will provide the numeric threshold that distinguishes "Stage 4 resolves" from "escalate to Stage 6."

Stage 6 does NOT decide internally whether to use "Stage 4-like" single-shot selection. Stage 4 is the fast path; Stage 6 is the slow, multi-round fallback. This is a strict sequential handoff, not a nested decision.

Stage 6 activates when Stage 4 cannot resolve, typically:

- Multiple candidates require disambiguation beyond what a single LLM call can decide
- User input references context not in the grounding set (temporal, relational, history-based)
- Stage 4 explicitly abstains with `need_more_info`

---

## 6) Telemetry and Evals

### 6a) Metrics

| Metric | Definition | Target |
|--------|-----------|--------|
| Unnecessary clarifier rate | Clarifiers shown when the model had enough info to act | < 10% |
| Tool-call count per task | Average inspect calls before action/clarify | < 2.0 |
| Wrong-action rate | Actions that don't match user intent (see §6c for labeling) | < 1% |
| Loop timeout rate | Requests that exhaust the loop budget | < 5% |
| Latency (p50 / p95) | Total time from user input to action/clarify | p50 < 1s, p95 < 3s |

### 6b) Eval Framework

- **Offline**: Replay durable log entries through the tool loop, compare decisions to actual outcomes
- **Shadow mode**: Run tool loop in parallel with Stage 4, log disagreements
- **A/B**: Feature-flag controlled rollout, compare clarifier rates

### 6c) Wrong-Action Labeling

Wrong-action rate requires ground truth. Labels come from (in priority order):

1. **User correction**: User immediately re-issues a command or navigates away within 10 seconds → prior action was wrong
2. **Explicit undo/retry**: User invokes undo or retypes a corrected command
3. **Curated replay labels**: Offline eval set with human-labeled intent → action pairs from durable log replay
4. **Implicit success**: No correction within session → action assumed correct (weak signal, used only for aggregate rates)

For Stage 6 eval, category 3 (curated replay labels) is the primary source. Categories 1-2 provide live signal but are noisy.

### 6d) Recovery Behavior

- If an inspect tool fails → skip that information, proceed with what's available
- If an action tool fails → log failure, present error to user, do not retry automatically
- If the model loops without converging → fall through to clarifier after max rounds

---

## 7) Implementation Slices (Tentative)

| Slice | Scope | Depends On |
|-------|-------|------------|
| 6.1 | Define TypeScript tool schemas + snapshot types | — |
| 6.2 | Implement inspect_* tools (read-only state accessors) | 6.1 |
| 6.3 | Wire tool loop into routing dispatcher (shadow mode) | 6.1, 6.2 |
| 6.4 | Implement action tools with validation | 6.1 |
| 6.5 | Enforcement mode (tool loop replaces Stage 4 for complex cases) | 6.3, 6.4 |
| 6.6 | Telemetry + eval pipeline | 6.3 |
| 6.7 | Tuning: loop constraints, confidence thresholds, prompt optimization | 6.5, 6.6 |

---

## 7a) Slice 6.4 Implementation Checklist — Action Tools with Validation

**Status**: CLOSED (2026-03-11). Validators implemented, wired into loop route, unit-tested (52 tests), runtime-validated. Rejection path proven end-to-end (entry_not_found persisted in durable log). Pass path unit-covered but not runtime-observed — blocked by model ID hallucination, not validator logic. ID fidelity tracked as 6.7 tuning issue.
**Depends on**: 6.1 (contracts, locked)
**Scope**: Implement the request → validate → result pipeline for all three action types. Shadow mode only — validation determines whether the action *could* be executed, but no UI side effects yet (that's 6.5 enforcement).

### What 6.4 locks

The action validation contract: given a model-emitted action request + available state, produce an `S6ActionResult` with `executed` or `rejected` + rejection reason.

### Implementation items

**1. Action validator module** — `lib/chat/stage6-action-validators.ts`

Three validators, one per action type. Each takes the parsed action request + fresh state, returns `S6ActionResult`.

| Validator | Inputs | Validation checks | Rejection reasons |
|-----------|--------|-------------------|-------------------|
| `validateOpenPanel` | `panelSlug`, client snapshots | Panel slug resolves to a registered panel in the dashboard snapshot | `panel_not_registered` |
| `validateOpenWidgetItem` | `widgetId`, `itemId`, client snapshots | Widget exists in dashboard snapshot; item exists in widget's snapshot item list (not scroll-viewport — snapshot presence is sufficient) | `widget_not_open`, `target_not_found` |
| `validateNavigateEntry` | `entryId`, `userId` | Entry exists in DB (`items` table, `deleted_at IS NULL`); belongs to user's workspace | `entry_not_found`, `permission_denied` |

**Freshness model (important distinction)**:

- **Server-side** (`validateNavigateEntry`): truly fresh — queries the DB at validation time. This is real TOCTOU revalidation.
- **Client-side** (`validateOpenPanel`, `validateOpenWidgetItem`): validates against the pre-computed `clientSnapshots` supplied at loop entry (from 6.3). These are the latest available to the server, but they are **stale-by-design** relative to validation time — the user's UI may have changed during the loop. This is not true commit-time revalidation.
- **True client-side TOCTOU revalidation** (round-trip back to the browser for live UI state) is deferred to 6.5 enforcement mode. In 6.4 shadow mode, snapshot-based validation is sufficient because actions are not executed.

`target_not_visible` is defined in `S6ActionRejectionReason` (contracts, 6.1) but is **not produced by 6.4 validators**. In 6.4's freshness model (pre-computed snapshots only), there is no way to distinguish "item exists in the system but isn't in the snapshot" from "item doesn't exist." Both map to `target_not_found`. `target_not_visible` may become meaningful in 6.5 enforcement when true fresh client state is available — e.g., item exists in the system but the widget is scrolled past it or it was removed from the widget after the snapshot was taken.

**2. Wire validators into the loop route** — `app/api/chat/stage6-loop/route.ts`

Currently, the route returns `action_executed` for any model-emitted action (line ~386). Replace with:

```
Model emits action → parse action type → call validator → return action_executed or action_rejected
```

The `buildLoopResult` already supports both `action_executed` and `action_rejected` outcomes via `S6ActionResult`. Wire the validator result into the outcome and telemetry.

**3. Rejection reason alignment** — verify against `S6ActionRejectionReason` (contracts, 6.1)

All rejection reasons emitted by validators must be members of:
```typescript
'target_not_found' | 'target_not_visible' | 'widget_not_open' |
'panel_not_registered' | 'entry_not_found' | 'permission_denied' |
'toctou_stale' | 'duplicate_action'
```

`toctou_stale` is for when a target existed at inspect time but is gone at validation time.
`duplicate_action` is for idempotency guard (deferred — not in first 6.4 pass).

**4. Tests**

| Test file | Coverage |
|-----------|----------|
| `stage6-action-validators.test.ts` | Each validator × pass + each rejection reason |
| `stage6-loop-route.test.ts` (extend) | Route returns `action_rejected` when validation fails |

Minimum test matrix:

| Action | Pass | Reject: not found | Reject: widget/panel | Reject: permission |
|--------|------|--------------------|--------------------|---------------------|
| `open_panel` | ✓ | — | `panel_not_registered` | — |
| `open_widget_item` | ✓ | `target_not_found` | `widget_not_open` | — |
| `navigate_entry` | ✓ | `entry_not_found` | — | `permission_denied` |

Note: `target_not_visible` is not in the 6.4 test matrix. See freshness model note above.

### What 6.4 does NOT do

- No UI side effects (no `open-panel-drawer` events, no `chat-navigate-entry` events)
- No enforcement mode wiring (that's 6.5)
- No idempotency guard (`duplicate_action` is deferred)
- No clarification rejection logic (model-requested clarification handling is separate from action validation)

### Existing execution patterns (reference)

| Action | Current execution mechanism | Location |
|--------|---------------------------|----------|
| `open_panel` | `window.dispatchEvent('open-panel-drawer', { panelId })` | `use-chat-navigation.ts:408-433` |
| `open_widget_item` | `groundingAction: { type: 'execute_widget_item' }` → `/api/chat/navigate` roundtrip | `chat-navigation-panel.tsx:1813-1926` |
| `navigate_entry` | `window.dispatchEvent('chat-navigate-entry', { entryId, dashboardId })` | `use-chat-navigation.ts:695-719` |

6.4 validates but does not execute. 6.5 will bridge validation → existing execution mechanisms.

---

## 7b) Slice 6.6 Implementation Checklist — Telemetry + Eval Pipeline

**Status**: CLOSED (2026-03-11). Monitoring SQL validated against 6 shadow-loop rows (corrected: column-source bug fixed, revalidated). All 7 queries execute cleanly. Zero uncategorized disagreements.
**Depends on**: 6.3 (shadow loop wiring, closed)
**Scope**: Query-first evaluation infrastructure. No new runtime fields or write-time computations. Makes Stage 6 shadow mode measurable by joining existing durable log rows.

### Design principle

Agreement/disagreement is computed **on read** (SQL joins), not on write. The main routing row and the `:s6` shadow row are written asynchronously and may race. Persisting agreement at write time creates backfill complexity for no gain.

### What 6.6 locks

The reporting SQL contracts: how to join main + shadow rows, how to categorize disagreements, and what metrics to compute. These become the authoritative evaluation queries for Stage 6.

### Implementation items

**6.6a — Monitoring SQL** (`docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6-eval-queries.sql`)

One SQL file containing all evaluation queries, grouped by purpose:

**1. Coverage / row-pair join** — the foundation query

Two parts:
- **Eligibility count**: main routing rows where Stage 4 abstained or timed out (these are the rows that *should* have a shadow pair)
- **Coverage count**: how many of those have a matching `:s6` row

Join via `interaction_id`:
```sql
main.interaction_id = REPLACE(shadow.interaction_id, ':s6', '')
```

Coverage percentage = matched pairs / eligible main rows. If coverage is low, disagreement percentages are misleading. Low coverage indicates shadow loops failing silently (network, timeout, feature flag off).

**2. Outcome distribution**

```
COUNT by s6_outcome: action_executed, action_rejected, clarification_accepted, abort, max_rounds_exhausted
```

**3. Inspect-round distribution**

```
Histogram of s6_inspect_rounds (0, 1, 2, 3+)
```

**4. Abort reason breakdown**

Separate tracking (not conflated):
- `s6_abort_reason` containing timeout-related strings
- `s6_outcome = 'max_rounds_exhausted'` (budget exhaustion, NOT timeout)
- Other abort reasons (model chose to abort)

**5. Action rejection reason breakdown**

```
COUNT by s6_action_rejection_reason: entry_not_found, permission_denied, panel_not_registered, widget_not_open, target_not_found
```

**6. Latency**

```
PERCENTILE_CONT(0.5 / 0.95) WITHIN GROUP (ORDER BY s6_duration_ms)
```

**7. Disagreement categories**

Compare main row result_status/provenance with S6 outcome. Key categories:

| Main routing outcome | S6 shadow outcome | Category |
|---------------------|-------------------|----------|
| Clarified (clarifier shown) | `action_executed` | `disagree_s6_would_act` — S6 could have avoided the clarifier |
| Clarified | `clarification_accepted` | `agree_clarify` — both think clarification needed |
| Clarified | `abort` | `disagree_s6_abort` — S6 gave up, main at least offered options |
| Clarified | `action_rejected` | `disagree_s6_bad_action` — S6 tried to act but picked wrong target |
| Failed/no candidates | `action_executed` | `disagree_s6_would_act` — S6 found a target main routing missed |
| Failed/no candidates | `abort` | `agree_fail` — both gave up |

The primary eval signal is `disagree_s6_would_act` — these are interactions where Stage 6 could have resolved without a clarifier.

**6.6b — Interpretation guide** (short docs section, appended to this design note or in a separate file)

- How to run the monitoring queries
- How to interpret each disagreement category
- What thresholds indicate readiness for 6.5 enforcement
- Known limitations (hallucinated IDs, stale snapshots)

### What 6.6 does NOT do

- No new runtime telemetry fields (no `s6_agreement` persisted at write time)
- No offline replay infrastructure (needs curated test set)
- No wrong-action labeling pipeline (needs user correction signal)
- No A/B feature-flag rollout infrastructure
- No backfill scripts

### 6.7 (tuning) — overall status: OPEN

**Slice 1: Prompt hardening** — CLOSED (2026-03-12, environment limitation)
- panelSlug→widgetId mapping made explicit
- ID copy rule strengthened (character-for-character, never fabricate)
- Act/clarify/abort thresholds defined (1 match→act, 2+→clarify, 0→abort)
- Inspect strategy: task-conditioned (dashboard-first for panel requests, recent/search-first for item requests)
- Clarify/abort behavior runtime-observed. Single-match open_panel act path not runtime-observable in current dashboard shape (all panels always open → panel queries always multi-match or handled by earlier tiers).

**Slice 2: Structured output hardening** — CLOSED (2026-03-12)
- `responseMimeType: 'application/json'` + `responseSchema` on Gemini model config — enforces JSON with typed schema
- `type` field constrained to enum `['inspect', 'action', 'clarify', 'abort']`; `action` field to `['open_panel', 'open_widget_item', 'navigate_entry']`
- `validateResponseStructure()` — server-side per-type field validation (e.g., `open_panel` requires `panelSlug`, `clarify` requires non-empty `candidateIds`)
- Single-retry contract: `structRetried` boolean flag. First structural failure → error feedback to model → one correction attempt. Second failure → immediate abort.
- Traced as `invalid_<type>` in tool trace. 4 new tests (3 retry-succeed + 1 double-failure-abort).

**Remaining 6.7 slices:**
- Runtime fixture: create a dashboard/test state where single-match `open_panel` is reachable by Stage 6 (required to validate act path)
- Confidence thresholds for act vs clarify boundary
- Tool-call efficiency (reduce unnecessary inspect rounds)

---

## 7c) Slice 6.5 Implementation Checklist — Enforcement Mode

**Status**: CLOSED (Phase 1 — open_panel). Code + tests complete, runtime-validated 2026-03-12. Enforcement pipeline proven end-to-end (S6 loop fires, durable log written, fallback works). No `action_executed` + `open_panel` observed — model chose clarify/abort in all test scenarios (ambiguous dashboards). Execution bridge unit-tested. Model resolution is 6.7 tuning scope.
**Depends on**: 6.3 (shadow loop wiring, closed), 6.4 (action validators, closed)
**Scope**: Bridge validated Stage 6 actions to real UI execution. Transitions from shadow mode (log-only) to enforcement mode (actions execute). Staged rollout: `open_panel` first, then remaining action types.

### Design principle

Enforcement mode means the Stage 6 loop **replaces** the main routing path for eligible interactions, rather than running in parallel. The loop validates and executes. If validation fails or the loop aborts, the system falls back to the main routing path (clarifier or failure).

### What 6.5 locks

The execution bridge contract: given a validated `S6ActionResult` with `status: 'executed'`, dispatch the corresponding UI side effect via existing execution mechanisms. Provenance is `s6_enforced` (not `s6_shadow`).

### Rollout strategy

**Phase 1**: `open_panel` only (lowest risk, no DB mutation, client-side event)
**Phase 2**: `navigate_entry` (DB query, but read-only navigation)
**Phase 3**: `open_widget_item` (API roundtrip to `/api/chat/navigate`)

Each phase follows the same pattern: implement → unit test → runtime validate → close.

### Implementation items

**1. Enforcement feature flag**

New flag: `NEXT_PUBLIC_STAGE6_ENFORCE_ENABLED` (client-side). When `true`, the loop executes validated actions instead of just logging. When `false`, behavior is identical to shadow mode (6.3).

Both flags can coexist:
- `SHADOW=true, ENFORCE=false` → shadow mode (current)
- `SHADOW=true, ENFORCE=true` → enforcement mode
- `SHADOW=false` → S6 disabled entirely

**2. Execution bridge** — `lib/chat/stage6-execution-bridge.ts` (new file)

Maps validated `S6ActionResult` to existing execution mechanisms:

| Action | Mechanism | Reference |
|--------|-----------|-----------|
| `open_panel` | `window.dispatchEvent('open-panel-drawer', { panelId })` | `use-chat-navigation.ts:408-433` |
| `navigate_entry` | `window.dispatchEvent('chat-navigate-entry', { entryId, dashboardId })` | `use-chat-navigation.ts:695-719` |
| `open_widget_item` | `groundingAction: { type: 'execute_widget_item' }` → `/api/chat/navigate` roundtrip | `chat-navigation-panel.tsx:1813-1926` |

Phase 1 implements `open_panel` only. Other actions return a "not enforced" sentinel until their phase.

**3. Commit-point revalidation (TOCTOU guard)**

Before executing, revalidate against **fresh client state** (not the stale loop-entry snapshots):

- `open_panel`: Re-read dashboard widget list. Confirm target panel still exists and is registered.
- `navigate_entry`: DB query is already fresh (server-side validation in 6.4). No additional revalidation needed.
- `open_widget_item`: Re-read visible items. Confirm widget is still open and item is still present.

For Phase 1 (`open_panel`): call `handleInspect({ tool: 'inspect_dashboard' })` at commit point — this is a **fresh panel registry read**, not the earlier Stage 6 loop-entry snapshots. Re-run `validateOpenPanel` against this fresh snapshot. If stale → reject with `toctou_stale`.

**4. Failure fallback — resume normal Stage 4 clarifier path**

When enforcement fails (validation rejected, loop aborted, TOCTOU stale):

- **Do NOT invent a new fallback path.** Resume the normal Stage 4 clarifier behavior that already follows `stage4_abstain`.
- The dispatcher already has the grounding LLM candidates computed before S6 runs. If S6 fails, continue into the existing clarifier presentation code as if S6 never ran.
- This keeps enforcement low-risk — the worst case is identical to current behavior (clarifier shown).
- Log the fallback event in durable telemetry: `s6_enforcement_fallback: true`, `s6_fallback_reason: <reason>`.

**5. Duplicate action guard (by action signature)**

Prevent double-execution using a concrete action signature, not just a flag:

Action signature = `{ interactionId, actionType, targetId }`

- When S6 enforcement executes an action, record its signature.
- Before main routing executes, check if a matching signature was already executed by S6.
- This prevents suppressing valid follow-up actions (different target) while catching real duplicates (same interaction + same action + same target).
- Since enforcement mode is **synchronous** (dispatcher awaits S6 before proceeding), the signature check happens in-process — no external dedup store needed.
- This is the key architectural change from shadow (async, parallel) to enforcement (sync, replaces).

**6. Provenance and durable logging contract**

Locked before coding to avoid the Stage 5 provenance/mapping cleanup cycle.

| Field | Enforced S6 value | Shadow S6 value (unchanged) |
|-------|-------------------|----------------------------|
| `provenance` | `s6_enforced:<action_type>` (e.g., `s6_enforced:open_panel`) | `s6_shadow:<outcome>` |
| `handled_by_tier` | `6` | `6` |
| `decision_source` | `llm` (reuses existing enum — no new value needed) | `llm` |
| `routing_lane` | `D` (same lane as Stage 4 grounding) | `D` |
| `result_status` | `executed` (on success) or `clarified` (on fallback) | per shadow outcome |
| `interaction_id` | `${interactionId}:s6` (suffixed to avoid unique constraint conflict with dispatcher row) | `${interactionId}:s6` |
| `s6_enforcement_mode` | `true` | absent or `false` |

**7. Controller changes** — `lib/chat/stage6-loop-controller.ts`

- `runS6ShadowLoop` → rename or add `runS6EnforcementLoop` (awaitable, returns result to caller)
- Shadow mode remains fire-and-forget (`void runS6ShadowLoop(...)`)
- Enforcement mode is awaited: `const s6Result = await runS6EnforcementLoop(...)`
- Caller (dispatcher) uses the result to decide: execute action or fall back to main path

**8. Dispatcher integration** — `lib/chat/routing-dispatcher.ts`

At the `stage4_abstain` and `stage4_timeout` call sites:

```
if (enforce enabled) {
  const s6Result = await runS6EnforcementLoop(...)
  if (s6Result.outcome === 'action_executed') {
    // Bridge to execution, return to user
  } else {
    // Fall back to main routing (clarifier/failure)
  }
} else {
  // Shadow mode (existing behavior)
  void runS6ShadowLoop(...)
}
```

**9. Tests**

| Test file | Coverage |
|-----------|----------|
| `stage6-execution-bridge.test.ts` (new) | Bridge dispatches correct event for each action type |
| `stage6-loop-controller.test.ts` (extend) | Enforcement loop returns result to caller |
| `stage6-loop-route.test.ts` (extend) | TOCTOU revalidation at commit point |

### What 6.5 does NOT do

- No content mutation actions (write, delete)
- No automatic retry on failure (fail → fallback, not fail → retry)
- No confidence threshold gating (model decides act vs clarify; app only validates)
- No A/B traffic splitting (feature flag is all-or-nothing per environment)

### Phase 1 acceptance criteria (open_panel)

1. User types ambiguous input → Stage 4 abstains → S6 loop runs
2. Model emits `open_panel` with valid panel slug
3. Commit-point revalidation passes (panel still registered)
4. Panel drawer opens in the UI
5. Durable log shows `provenance: s6_enforced:open_panel`
6. If revalidation fails → clarifier shown instead (fallback)
7. No duplicate execution (main routing path does not also fire)

---

## 8) Open Questions

1. **Token budget**: How much context can the model receive per inspect call without blowing the prompt window?
2. **Tool call format**: OpenAI function calling vs structured output vs custom protocol?
3. **Prompt design**: How to frame the system prompt so the model prefers acting over clarifying when evidence is sufficient?
4. **Cross-widget references**: "the budget in the other panel" — how does the model know which panel the user means?
5. **Body-text search**: If `inspect_search` needs to search document content (not just names), what content exposure rules apply? Deferred from Stage 6 scope.

---

## 9) References

- Stage 4 design: `stage4-bounded-llm-optimize-design.md`
- Stage 5 design: `stage5-semantic-resolution-reuse-design.md`
- Routing dispatcher: `lib/chat/routing-dispatcher.ts`
- Grounding set: `lib/chat/grounding-set.ts`
- Context snapshots: `lib/chat/routing-log/context-snapshot.ts`
