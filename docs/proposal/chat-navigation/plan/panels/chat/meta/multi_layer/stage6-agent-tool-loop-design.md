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
