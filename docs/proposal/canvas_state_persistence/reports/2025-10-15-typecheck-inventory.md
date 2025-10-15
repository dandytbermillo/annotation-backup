# Type-Check Inventory — 2025-10-15

**Command:** `npm run type-check` (tsc --noEmit -p tsconfig.type-check.json)  
**Result:** ❌ Failing — legacy errors remain. No new Stage 1 regressions detected.

## Summary
| Category | Files | Count | Notes |
| --- | --- | --- | --- |
| Overlay typing | `components/annotation-app.tsx` | 1 | Hook returns union with optional folder.id. Requires type refinement before Stage 2. |
| Legacy canvas (unused) | `components/annotation-canvas.tsx` | 6 | Old class-based canvas. Candidate for archival/exclusion from TypeScript scope. |
| Missing ProseMirror types | `components/canvas/annotation-*-fix.ts`, `components/canvas/annotation-decorations-fixed.ts`, etc. | 12 | Need `@types/prosemirror-*` or module shims. |
| Rich-text extensions | `lib/extensions/collapsible-block.tsx` | 9 | Implicit anys and type mismatches; requires rewrite or `// @ts-expect-error` gating. |
| Offline framework | `lib/offline/conflict-detector.ts`, `lib/offline/network-service.ts`, `lib/offline/service-worker-manager.ts`, `lib/providers/plain-offline-provider.ts` | 11 | Longstanding Option A/B debt. Decide whether to exclude or fix. |
| Workspace store | `lib/workspace/workspace-store.ts` | 3 | Strict null checks complaining about `rowCount`. | 

_Total outstanding errors tracked_: **42**

## Recommended Actions
1. **Overlay typing fix (blocking Stage 2)**  
   - Introduce discriminated union or safe defaults in `components/annotation-app.tsx` overlay reducer.  
   - Ensure `folder.id` is always set before passing to child components.
2. **Legacy canvas removal**  
   - Confirm `components/annotation-canvas.tsx` is unused. If so, move to `docs/` archive or exclude from `tsconfig.type-check.json`.
3. **ProseMirror typings**  
   - Install community typings (`npm i -D @types/prosemirror-state @types/prosemirror-view @types/prosemirror-model`) or add module declarations under `types/global.d.ts`.
4. **Collapsible block refactor**  
   - Refine function signatures; add explicit types for `child`, `editorView`, etc.  
   - Alternatively isolate experimental extension under a separate tsconfig.
5. **Offline module scope decision**  
   - Option A plain mode currently ignores these modules; consider adding them to an `exclude` list until modernization.
6. **Workspace store null guards**  
   - Ensure `rowCount` is checked before comparison and update return types.

## Tracking
- Update `stage1-gap-analysis.md` once items 1 & 3 are scheduled.  
- If modules are archived, add them to `RELATIVE_SKIPS` in `scripts/verify-composite-keys.js` and document justification in the plan.

---
