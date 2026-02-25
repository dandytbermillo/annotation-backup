# PR1: chat-routing.ts Refactor — Freeze Report

**Date**: 2026-02-25
**Status**: FROZEN — no further logic changes
**Slug**: `chat-navigation`

---

## Summary

Extracted 5 self-contained modules from `lib/chat/chat-routing.ts` (6,416 lines → 5,092 lines).
Zero behavior changes. All existing imports still work via the barrel path `@/lib/chat/chat-routing`.

## Files Created

| File | Lines | Contents |
|---|---|---|
| `chat-routing-types.ts` | 271 | 13 shared types/interfaces |
| `chat-routing-correction.ts` | 99 | `handleCorrection` |
| `chat-routing-meta-explain.ts` | 402 | `handleMetaExplain` |
| `chat-routing-followup.ts` | 490 | `handleFollowUp` + `isLowQualitySnippet` |
| `chat-routing-panel-disambiguation.ts` | 200 | `handlePanelDisambiguation` |

## Files Modified

- `lib/chat/chat-routing.ts` — removed extracted code, cleaned unused imports, added barrel re-exports at bottom

## Backup

- `lib/chat/chat-routing.ts.backup` — original 6,416-line file preserved

## Verification Results

- Type-check: **CLEAN** (0 errors)
- Chat tests: **35 suites, 816 tests — all pass**
- Code parity: **4/4 handlers identical** (character-for-character verified against backup)
- Types parity: **13/13 types structurally identical** (inline `import()` resolved to top-level imports)
- Consumer compatibility: **13 consumers verified** — all use barrel path, zero direct internal imports
- Remaining code: **all 10 preserved sections confirmed** present in refactored file

## Known Caveat

`chat-routing.ts` is NOT barrel-only yet. It still contains ~5,000 lines of business logic:

- LLM arbitration subsystem (~700 lines): guard singleton, `tryContinuityDeterministicResolve`, `tryLLMLastChance`, `runBoundedArbitrationLoop`, enrichment helpers
- `handleClarificationIntercept` (~4,200 lines): the main clarification tier pipeline

**This is by design.** PR1 scope is limited to the 4 self-contained handlers + types. The remaining logic requires PR2 with stricter parity guards due to:
- Module-level singleton state (`lastLLMArbitration`) that must stay co-located with its read/write accessors
- Cross-module internal dependency (clarification → arbitration, not via barrel)

## PR2 Contract

PR2 will extract:
1. `chat-routing-arbitration.ts` (~700 lines) — arbitration subsystem + singleton
2. `chat-routing-clarification.ts` (~4,200 lines) — `handleClarificationIntercept` + `reconstructSnapshotData`
3. `chat-routing.ts` becomes a pure barrel (<300 lines target)

**PR2 prerequisites** (must be done before any code moves):
- Characterization/parity test pack covering `{handled, handledByTier, tierLabel, _devProvenanceHint}` for key inputs
- LLM guard singleton reset verification test
- Noisy command and multi-turn flow regression cases

**PR2 commit discipline**:
- Commit A: extract files + wire imports (no logic edits)
- Commit B: cleanup dead code/imports only
- Full type-check + full chat test suite after each commit

**PR2 exit criteria**:
- `chat-routing.ts` < 300 lines
- No direct business logic beyond wiring/re-exports
- Same parity tests pass
- No file outside `lib/chat/` imports from `chat-routing-*` directly
