# Scope-Typo Clarifier — Post-Implementation Investigation & Fix Report

**Date**: 2026-02-26
**Feature**: scope-cues-addendum-plan.md §typoScopeCueGate
**Scope**: Safety audit of all 6 stages + critical fix + dead code fix

---

## Summary

Conducted a thorough post-implementation investigation of the 6-stage Scope-Typo Clarifier + One-Turn Replay plan. Found and fixed two issues:

1. **CRITICAL**: `chat-navigation-panel.tsx` (production call site for `dispatchRouting()`) was missing the `pendingScopeTypoClarifier` / `setPendingScopeTypoClarifier` / `clearPendingScopeTypoClarifier` field wiring — entire feature would be non-functional in production
2. **Dead code**: `routing-dispatcher.ts` hardcoded `const currentReplayDepth = 0` instead of reading from `ctx._replayDepth ?? 0` per plan. Also `_replayDepth` field was missing from `RoutingDispatcherContext` interface.

---

## Issues Found & Fixed

### Issue 1 (CRITICAL): Missing context wiring in chat-navigation-panel.tsx

**Problem**: The production component `chat-navigation-panel.tsx` calls `dispatchRouting()` but was not updated to:
- Destructure `pendingScopeTypoClarifier`, `setPendingScopeTypoClarifier`, `clearPendingScopeTypoClarifier` from the context hook
- Pass these fields into the `dispatchRouting()` call

**Impact**: In production, these fields would be `undefined`, causing:
- Pending state never saved (Stage 3 typo gate `setPendingScopeTypoClarifier` call silently fails due to truthiness guard)
- `clearPendingScopeTypoClarifier()` calls in the confirmation resolver (Stage 4) would throw TypeError

**Fix**: Added the three fields to both the context destructure and the `dispatchRouting()` call in `chat-navigation-panel.tsx`.

**Why tests didn't catch it**: Integration tests construct their own mock context directly, bypassing `chat-navigation-panel.tsx` entirely. The wiring gap only manifests in the real production call path.

### Issue 2: Dead code in dispatcher replay depth guard

**Problem**: `routing-dispatcher.ts` line 1225 had:
```typescript
const currentReplayDepth = 0  // This is the first replay from dispatcher
if (currentReplayDepth >= 1) { ... }  // Always false — dead code
```

The plan specified `ctx._replayDepth ?? 0`, but `_replayDepth` was not on `RoutingDispatcherContext`.

**Impact**: Low. Primary recursion prevention (`pendingScopeTypoClarifier: null` on replay call) works correctly. The depth guard is a secondary safety net for a structurally unreachable scenario (dispatcher is never called recursively — only `handleClarificationIntercept` is re-called).

**Fix**:
1. Added `_replayDepth?: 0 | 1` to `RoutingDispatcherContext` interface
2. Changed hardcoded `0` to `ctx._replayDepth ?? 0`

### Minor: Redundant truthiness guard (NOT FIXED — harmless)

`chat-routing-scope-cue-handler.ts:132`: `if (ctx.setPendingScopeTypoClarifier)` is redundant since the field is now required on `ClarificationInterceptContext`. Left as-is — defensive coding, no behavioral impact.

---

## Verification

```
$ npx tsc --noEmit
# Only pre-existing error: __tests__/unit/use-panel-close-handler.test.tsx(87,1)

$ npx jest --no-coverage __tests__/unit/chat/ __tests__/integration/chat/
# Test Suites: 37 passed, 37 total
# Tests: 912 passed, 912 total
# Time: 1.439s
```

---

## Files Modified (This Investigation)

| File | Changes |
|------|---------|
| `components/chat/chat-navigation-panel.tsx` | Added `pendingScopeTypoClarifier` / `setPendingScopeTypoClarifier` / `clearPendingScopeTypoClarifier` to context destructure + `dispatchRouting()` call |
| `lib/chat/routing-dispatcher.ts` | Added `_replayDepth?: 0 | 1` to `RoutingDispatcherContext`, fixed `const currentReplayDepth = ctx._replayDepth ?? 0` |

---

## Safety Invariants (Re-verified)

- `low_typo` confidence is **never executable** — always shows safe clarifier ✓
- Every path through the confirmation resolver calls `clearPendingScopeTypoClarifier()` — no stale state bleed ✓
- `_replayDepth: 0 | 1` properly read from context — prevents recursive replay loops ✓
- `pendingScopeTypoClarifier: null` in replay call provides primary recursion prevention ✓
- Snapshot fingerprint drift detection prevents stale replay after UI changes ✓
- Strict one-turn TTL (`createdAtTurnCount + 1`) prevents late replay ✓
- Confirmation resolver runs **before** ordinal binding — "yes" never captured as query ✓
- Production call site (`chat-navigation-panel.tsx`) now properly wires all new context fields ✓
