# Stage 1 Gap Analysis — Composite Keys

**Date:** 2025-10-15  
**Reviewer:** Codex (LLM)

## Summary
Stage 1 introduced composite key helpers and threaded them through part of the persistence flow, but the migration is only partially complete. Composite IDs are being generated on the write-path, yet most read-paths still look up panel state with the legacy plain `panelId`. This asymmetry will surface as soon as hydration or persistence begins storing `noteId::panelId` entries—panels will fail to hydrate, LayerManager lookups will miss, and drag updates will silently no-op.

## Verified Work
- ✅ Helpers (`makePanelKey`, `parsePanelKey`, `ensurePanelKey`) exist and are unit-tested.
- ✅ `CanvasItem` and `createPanelItem` now carry optional `noteId` / `storeKey` fields.
- ✅ Persistence callers (`persistPanelCreate`, `persistPanelUpdate`) include the new `storeKey` argument.
- ✅ Documentation/test-plan placeholders committed.
- ✅ Reader-side migration applied to active components (`annotation-canvas-modern`, `canvas-panel`, `BranchItem`, `BranchesSection`, `floating-toolbar`, plain/Yjs decorations, TipTap plain editor, hooks `use-auto-save` & `use-panel-dragging`).
- ✅ `scripts/verify-composite-keys.js` enforces absence of legacy ID usage; exposed via `npm run test:composite-keys`.

## Outstanding Gaps
1. **Reader-Side Validation (Residual)**
   - `npm run test:composite-keys` now passes; any new files must maintain the invariant. Maintain script as part of CI.

2. **Type-Check Debt**
   - `npm run type-check` remains red with the legacy error set (see `2025-10-15-typecheck-inventory.md`). Stage 1 cannot close until we either resolve or formally quarantine these failures.

3. **Automated Test Evidence**
   - Composite-key static verification exists, but we still lack a runtime smoke (drag → persist → reload). Decision: add Playwright/Jest smoke or document manual steps in MANUAL_TESTING_GUIDE.md.

## Immediate Next Steps
- Harden the composite-key regression suite (`test:composite-keys`) by adding it to pre-commit / CI.
- Decide on strategy for outstanding type-check errors (fix vs `tsconfig` exclusion) per `2025-10-15-typecheck-inventory.md`.
- Implement automated smoke (or capture manual verification logs) before marking Stage 1 complete.

## Blockers / Risks
- Without completing the reader migration, moving on to Phase 2 will break existing single-note behaviour.
- The longer we defer the type-check cleanup, the harder it becomes to spot regressions introduced during Phase 2.

---
