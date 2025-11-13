# Annotation App Flag Flip Packet

This document tracks the concrete artifacts required before `ANNOTATION_APP_REFACTOR_PHASE` is moved from `layout`/`popup` to `shell`.

## 1. Telemetry Baselines

| Metric | CSV File | Owner | Timestamp (UTC) | Notes |
| --- | --- | --- | --- | --- |
| popup_crud_latency_ms | _TBD_ | _TBD_ | _TBD_ | Target ±5% vs baseline |
| folder_cache_ttl_miss_rate | _TBD_ | _TBD_ | _TBD_ | |
| layout_conflict_rate | _TBD_ | _TBD_ | _TBD_ | |
| workspace_menu_error_rate | _TBD_ | _TBD_ | _TBD_ | |

- Capture instructions in `docs/current_status/telemetry/README.md`.
- Update this table once CSVs are added to `docs/current_status/telemetry/`.

## 2. Bundle Analyzer Output

| Build | Report | Owner | Notes |
| --- | --- | --- | --- |
| Legacy (`phase=off`) | _TBD_ | _TBD_ | Path: `docs/current_status/bundles/legacy-YYYYMMDD.html` |
| Shell (`phase=shell`) | _TBD_ | _TBD_ | Path: `docs/current_status/bundles/shell-YYYYMMDD.html` |
| Summary | _TBD_ | _TBD_ | Include `bundle-delta-YYYYMMDD.md` with delta commentary |

## 3. Regression Evidence

| Artifact | File | Owner | Status |
| --- | --- | --- | --- |
| Manual regression sheet | `docs/current_status/regression/manual-regression-YYYYMMDD.pdf` | _TBD_ | Pending |
| Playwright run | `docs/current_status/regression/playwright-annotation-YYYYMMDD.txt` | _TBD_ | Pending |
| Prop-parity test log | `docs/current_status/regression/prop-parity-YYYYMMDD.txt` | _TBD_ | Pending |
| Screenshots / Looms | (link) | _TBD_ | Optional |

## 4. Rollback Plan

| Step | Command / Action | Owner |
| --- | --- | --- |
| Set legacy flag | `export NEXT_PUBLIC_ANNOTATION_APP_REFACTOR_PHASE=layout` | _TBD_ |
| Rebuild + deploy | `npm run build && npm run deploy:<env>` | _TBD_ |
| Verification | `npm test -- annotation-app-shell-prop-parity.test.ts` + smoke checklist | _TBD_ |

- List on-call SRE + QA contacts here once assigned.

## 5. Observability Hooks

- Prop-parity Jest test already runs locally; wire it into CI (add job name + link once created).
- Add temporary console warning if `workspaceViewProps` is missing critical fields (see TODO in `components/annotation-app-shell.tsx`). Document removal plan here.

## Status Log

| Date | Author | Notes |
| --- | --- | --- |
| _TBD_ | _TBD_ | Initial checklist created. |
