# Annotation App Telemetry Baselines

Use this directory to store CSV exports from Looker or other telemetry dashboards captured before flipping `ANNOTATION_APP_REFACTOR_PHASE` to `shell`.

## Required Metrics

| Metric Key | Description | Baseline File | Captured By | Timestamp (UTC) | Allowed Variance |
| --- | --- | --- | --- | --- | --- |
| `popup_crud_latency_ms` | Median CRUD latency for overlay popups | `baseline-YYYYMMDD-popup-crud.csv` | _TBD_ | _TBD_ | ±5% |
| `folder_cache_ttl_miss_rate` | Percentage of folder cache requests falling outside TTL | `baseline-YYYYMMDD-folder-cache.csv` | _TBD_ | _TBD_ | ±5% |
| `layout_conflict_rate` | HTTP 409 conflict rate during layout saves | `baseline-YYYYMMDD-layout-conflicts.csv` | _TBD_ | _TBD_ | ±5% |
| `workspace_menu_error_rate` | Errors surfaced when toggling the workspace menu | `baseline-YYYYMMDD-workspace-menu.csv` | _TBD_ | _TBD_ | ±5% |

## Capture Checklist
1. Set the annotation app to legacy mode: `export NEXT_PUBLIC_ANNOTATION_APP_REFACTOR_PHASE=layout`.
2. Run each dashboard and export the filtered CSV (same date range/log level).
3. Drop the CSV into this directory following the naming pattern above.
4. Update `docs/current_status/annotation-app-flag-flip.md` with the filenames, owners, and timestamps.
