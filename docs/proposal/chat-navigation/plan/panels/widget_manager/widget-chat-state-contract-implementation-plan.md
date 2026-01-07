# Widget Chat State Contract - Implementation Plan

Goal: make chat aware of widget-specific internal state (view, selection, filters)
by standardizing state reporting from widgets and storing it in UIContext.

## Scope

- Add host-side storage of widget state per instance
- Add sandbox bridge method for reporting state
- Inject widgetStates into UIContext for LLM
- Keep state minimal (no raw content) and debounced

Non-goals (this phase):
- Full semantic search over widget content
- Persisting widget state to DB (ephemeral is fine)
- Auto-deducing widget state without widget reports

## Data Model (runtime)

In-memory map keyed by widget instance ID:

widgetStates[instanceId] = {
  _version: 1,
  widgetId,
  instanceId,
  title,
  view,
  selection: { id, label } | null,
  summary,
  filters?: string[],
  counts?: Record<string, number>,
  actions?: string[],
  updatedAt,
  stale?: boolean,
}

## Architecture

Widget → Sandbox bridge → Host store → UIContext → LLM

```
[Widget] reportState()  ─┐
                         │
[SandboxBridge] onReportState → [WidgetStateStore] → uiContext.dashboard.widgetStates
                                                         ↓
                                                  LLM answer_from_context
```

## Implementation Steps

### Phase 1: Host state store

1) Create host store (ephemeral map + helpers)
- File: `lib/widgets/widget-state-store.ts`
- API:
  - upsertWidgetState(state)
  - getWidgetState(instanceId)
  - getAllWidgetStates()
  - pruneStaleWidgetStates(now, ttlMs)

2) Add prune timer in dashboard host
- File: `components/dashboard/DashboardView.tsx`
- On interval (e.g., 30s): mark stale if updatedAt > 60s
- Remove when widget unmounts

### Phase 2: Sandbox bridge reporting

3) Add bridge method for widgets
- File: `lib/widgets/sandbox-bridge.ts`
- New method: `widget.reportState(state)`
- Validation rules:
  - required fields: _version, widgetId, instanceId, title, updatedAt
  - size caps: strings <= 120 chars, summary <= 200 chars
  - reject invalid payloads (log warning)

4) Host handler wiring
- File: `components/widgets/WidgetSandboxHost.tsx`
- On reportState → store via widget-state-store
- Debounce to 300ms in host if needed

### Phase 3: UIContext integration

5) Attach widgetStates to UIContext
- File: `components/dashboard/DashboardView.tsx`
- Add `widgetStates` to uiContext.dashboard
- Only include non-stale entries (or include stale with `stale: true`)

6) Prompt update (optional, small)
- File: `lib/chat/intent-prompt.ts`
- Add note: uiContext.dashboard.widgetStates can answer “what is widget showing?”

## Client-side (built-in widgets)

7) Built-in widgets should report state
- Quick Links: view = list, selection = highlighted link (if any)
- Recent: view = list, selection = last clicked
- Widget Manager: view = list, selection = currently selected widget (if any)

File examples:
- `components/dashboard/widgets/QuickLinksWidget.tsx`
- `components/dashboard/widgets/RecentWidget.tsx`
- `components/dashboard/widgets/WidgetManager.tsx`

## Acceptance Tests

1) Widget state reporting
- Open Quick Links D, select a link → chat: “What is selected?” → correct

2) Stale handling
- Wait > 60s → chat: “What is selected?” → warns stale

3) Multi-instance
- Two Quick Links panels → chat: “What is selected in Quick Links?” → asks which one

4) Sandbox widget
- Custom widget calls reportState → chat answers from widgetStates

## Risks / Mitigations

- Flooding: enforce debounce + caps on fields
- Stale data: mark stale after TTL and surface warning
- Security: strip raw content, only metadata allowed

## Validation Rules (Hard Limits)

- Reject payloads missing required fields: _version, widgetId, instanceId, title, updatedAt
- Drop unknown keys (allowlist only)
- Enforce string length caps (default: 120 chars per field, summary 200)
- Enforce list caps (filters/actions <= 10, counts keys <= 10)
- Reject selection if missing id or label

## Rollout

- Phase 1+2 (host + bridge) → hidden behind dev flag
- Phase 3 (uiContext) → enable in chat for dashboard only
- Phase 4 (built-in widgets) → add reporting gradually
