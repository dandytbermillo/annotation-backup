# Annotation App Refactor Plan (2025-11-09)

## Goals
- Reduce the size/complexity of `components/annotation-app.tsx` (currently the largest orchestrator) so workspace hydration, folder cache, popup CRUD, and toolbar wiring live in focused modules.
- Improve testability by isolating side-effect-heavy concerns (Knowledge Base fetches, folder cache invalidation, layout persistence) behind hooks or utility adapters.
- Ensure the popup overlay continues to rely on clear, typed boundaries (one hook for popup state, one for KB data, one for layout persistence), minimizing regressions when we iterate on overlay features.

## Guardrails & Constraints
- Comply with `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md`: provider contracts must remain backward-compatible while new hooks ship; UI rewiring cannot land in the same PR that adds new context fields.
- No hook may call `useSyncExternalStore` unless it validates the provider shape (defensive defaults, runtime assertion with actionable errors).
- Each phase must include an opt-in flag (env or feature toggle) so we can revert to the inline logic if regressions appear during rollout.
- LayerProvider references (`layerCtx`, `applyExternalTransform`, `canvasDataStore`) are treated as shared singletons; hooks must consume them via dependency injection, never re-create providers inside hooks.

## Pain Points Observed
1. **Mixed responsibilities** – layout persistence, KB fetches, folder cache, popup CRUD, and UI orchestration all live in the same file, making it hard to reason about changes.
2. **Folder cache drift** – logic for keeping `folderCacheRef` fresh after create/move/delete is duplicated and easy to break.
3. **Knowledge Base workspace state** – deriving and propagating `knowledgeBaseWorkspaceId` happens inline with UI concerns.
4. **Popup selection & overlay plumbing** – even after overlay refactors, `annotation-app.tsx` still handles selection/move callbacks inline, reimplementing guardrails already handled elsewhere.
5. **Testing friction** – because everything lives in one component, unit testing any single concern requires stubbing massive context.

## Module Interface Overview
| Module/Hook | Inputs | Outputs | Notes |
| --- | --- | --- | --- |
| `useKnowledgeBaseWorkspace(options)` | `initialWorkspaceId`, `knowledgeBaseClient`, `authHeaders`, `onWorkspaceHydrated` | `{workspaceId, workspaceMeta, status, error, refresh, withWorkspaceHeaders}` | Persists `workspaceId` via `useState`; wraps KB REST client; `withWorkspaceHeaders` appends `x-workspace-id` to fetches. |
| `useFolderCache({folderClient, logger, ttlMs})` | `folderClient`, TTL (default 5 minutes), `onCacheMiss` | `{getFolderChildren, updateFolderEntry, flushFolderEntry, isStale}` | Owns internal `Map<string, CacheEntry>`; exposes read/write helpers and emits telemetry on stale hits. |
| `usePopupOverlayState({canvasDataStore, kbWorkspace, folderCache})` | `canvasDataStore`, `kbWorkspace` result, folder cache API, feature flags | `{popups, activeSelection, handlers, createPopup, movePopup, removePopup, resetSelection}` | Maintains popup map via `useReducer`; ensures workspace/folder references stay in sync. |
| `useOverlayLayoutPersistence({layoutAdapter, telemetry, clock})` | `layoutAdapter`, telemetry sink, conflict resolver | `{loadLayout, saveLayout, handleConflict, setCameraSync, resumeFromSnapshot}` | Serializes adapter calls, dedupes saves via debounced queue, emits `layout_conflict_resolved` metrics. |
| `AnnotationAppShell` | Providers, feature flags, KB + layout hooks | Renders global shell, passes resolved state to `AnnotationWorkspaceView`. | Responsible for gating Phase 4 flag and fallback rendering. |
| `AnnotationWorkspaceView` | `popups`, `workspace`, layout handlers | Renders canvas/overlay/toolbar composition. | Lightweight coordinator, no side effects. |

## Proposed Phases

### Phase 0 – Readiness & Instrumentation
- Owners: Canvas Infra + QA.
- Deliverables:
  - Add `ANNOTATION_APP_REFACTOR_PHASE` runtime flag (values `off`, `hooks`, `popup`, `layout`, `shell`).
  - Capture current telemetry baselines (popup CRUD latency, layout conflict rate, folder cache TTL misses).
  - Document rollback procedures per phase in the runbook.

### Phase 1 – Data & Workspace Hooks
- Scope: introduce `useKnowledgeBaseWorkspace` and `useFolderCache` without rewiring consumers.
- Implementation details:
  - Land the hooks next to `components/annotation-app.tsx` under `lib/hooks/annotation/`.
  - Hooks accept dependency objects (`knowledgeBaseClient`, `folderClient`, etc.) to avoid implicit imports.
  - Provide inline shims (`useLegacyKnowledgeBaseWorkspace`, `useLegacyFolderCache`) so existing code can keep using the old functions until Phase 1 flag flips.
- Rollout:
  - Ship hooks behind `ANNOTATION_APP_REFACTOR_PHASE >= hooks`.
  - Update `annotation-app.tsx` to optionally consume the hooks via feature flag while keeping legacy logic for fallback.
- Validation:
  - Unit tests for both hooks covering success, error, TTL expiry, and concurrent updates.
  - QA runs folder create/move/delete flows plus workspace switching; confirm telemetry parity.

### Phase 2 – Popup Overlay State Surface
- Scope: extract popup CRUD + overlay interaction into `usePopupOverlayState`.
- Implementation details:
  - Hook accepts the outputs of Phase 1 hooks and `canvasDataStore`.
  - Expose typed handler bundle: `{onSelect, onMove, onCreate, onDelete, onDetachFromFolder}`.
  - Provide compatibility adapter that maps new handlers back to the existing `<PopupOverlay />` props.
- Rollout:
  - Feature flag gate `annotation-app.tsx` to swap in the hook when `ANNOTATION_APP_REFACTOR_PHASE >= popup`.
  - Keep legacy inline logic in the file until metrics prove parity for 1 release.
- Validation:
  - Expand `__tests__/unit/popup-overlay.test.ts` to import the new hook handlers.
  - Add storybook regression spot-check (manual) for drag/move, selection, and KB-driven popups.

### Phase 3 – Layout Persistence Boundary
- Scope: isolate layout persistence into `useOverlayLayoutPersistence`.
- Implementation details:
  - Hook wraps `OverlayLayoutAdapter`, ensures `load` and `save` return typed promises, and adds retry/backoff for HTTP 409 conflicts.
  - Provide `handleConflict` helper that notifies the caller and merges remote vs local snapshots via timestamp priority.
  - Continue emitting telemetry via injected `telemetry` dependency (defaulting to `canvasTelemetry`).
- Rollout:
  - Flag `ANNOTATION_APP_REFACTOR_PHASE >= layout` switches `annotation-app.tsx` to use the hook; fallback path remains available for one version.
  - Update manual checklist with conflict scenarios (parallel browser tabs, offline -> online recovery).
- Validation:
  - New unit tests mocking `OverlayLayoutAdapter`.
  - Add smoke Playwright script that toggles layout persistence and asserts saved positions survive reload.

### Phase 4 – UI Composition Split
- Scope: separate shell/providers from workspace view.
- Implementation details:
  - Create `components/annotation-app-shell.tsx` hosting providers, modals, toasts, hotkeys.
  - Create `components/annotation-workspace-view.tsx` that receives already-prepared props (popups, handlers, workspace data).
  - Ensure shell lazily imports the heavy canvas chunk so Next.js can split bundles.
- Rollout:
  - Flag `ANNOTATION_APP_REFACTOR_PHASE >= shell` toggles the new composition.
  - Provide fallback export (`export const AnnotationApp = LegacyAnnotationApp`) while the new shell bakes.
- Validation:
  - Bundle analyzer run to confirm size improvement.
  - Manual regression on keyboard shortcuts, toast display, and LayerProvider hydration.

## Testing & Validation Plan
- **Unit tests** (Vitest/Jest): each hook/module with exhaustive cases (success, failure, stale cache, conflict resolution). Owners: Canvas Infra.
- **Integration tests**: extend `__tests__/unit/popup-overlay.test.ts` plus add `lib/hooks/__tests__/folder-cache.test.ts`.
- **Playwright smoke**: run `npx playwright test --grep "@annotation-app"` after each phase flips to “on” in staging.
- **Manual checklist**: existing overlay regression sheet plus new rows for workspace switching, folder TTL expiry, layout conflict recovery.
- **Telemetry watch**: monitor `popup_crud_latency_ms`, `folder_cache_ttl_miss_rate`, `layout_conflict_rate` on Looker dashboards for 48h post rollout.

## Risks & Mitigations
- **State synchronization** – Mitigation: single source of truth in hooks, explicit snapshot helpers, feature flags for rapid rollback.
- **Layout conflicts** – Mitigation: retry/backoff plus manual QA on dual-tab editing before Phase 3 roll-out.
- **Context churn** – Mitigation: dependency injection for LayerProvider artifacts, no re-creation inside hooks, runtime assertions in dev mode.
- **Hot reload drift** – Mitigation: do not remove legacy inline logic until next phase is stable; add console warnings if provider shape mismatches occur.

## Rollout Timeline & Owners
| Phase | Duration (target) | Owner | Dependencies |
| --- | --- | --- | --- |
| Phase 0 | 2 days | Canvas Infra TL | Telemetry dashboards ready |
| Phase 1 | 1 week | Workspace Squad | KB client typings finalized |
| Phase 2 | 1 week | Canvas Infra | Phase 1 flag on |
| Phase 3 | 1 week | Overlay Platform | Adapter contract reviewed |
| Phase 4 | 1 week | UI Architecture | Bundle analyzer baseline captured |

## Success Criteria
- `components/annotation-app.tsx` drops below ~600 lines (currently >1.2k) once Phase 4 ships.
- Each major concern (KB workspace, folder cache, popup interaction, layout persistence) lives in a dedicated hook/module with unit tests checked into CI.
- Overlay regressions remain absent: manual checklist + `npm test -- __tests__/unit/popup-overlay.test.ts` pass after each phase.
- Telemetry deltas remain within ±5% for folder cache TTL misses and popup CRUD latency for two weeks after final rollout.
