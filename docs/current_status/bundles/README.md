# Annotation App Bundle Snapshots

Store the analyzer output for both legacy and shell builds here so we can review size deltas before flipping the flag.

## Commands

```bash
# Legacy build
NEXT_PUBLIC_ANNOTATION_APP_REFACTOR_PHASE=off ANALYZE=true next build --analyze
# Shell build
NEXT_PUBLIC_ANNOTATION_APP_REFACTOR_PHASE=shell ANALYZE=true next build --analyze
```

> Ensure `ANALYZE=true` (or appropriate env) is wired to the Next.js `@next/bundle-analyzer` plugin so each build emits an HTML report.

## Expected Artifacts

| File | Description |
| --- | --- |
| `legacy-YYYYMMDD.html` | Analyzer output for the legacy path. Capture chunk sizes for `annotation-app` and related vendors. |
| `shell-YYYYMMDD.html` | Analyzer output for the shell path. Include the delta summary in the flag-flip doc. |
| `bundle-delta-YYYYMMDD.md` | Short note describing chunk differences, tree-shaking wins/regressions, and sign-off. |

Once reports are generated, reference them in `docs/current_status/annotation-app-flag-flip.md`.
