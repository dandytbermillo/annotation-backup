# Hard-Safe 4-Cap Eviction (No Silent Data Loss)
**Date:** 2025-12-15  
**Status:** Proposal / Implementation Plan (doc-only)  

## Context

The “4-cap” eviction path lives in `lib/hooks/annotation/use-note-workspace-runtime-manager.ts` and is currently *best-effort*:

- It captures a snapshot, attempts to persist it, then removes the runtime **unconditionally**, even if persistence failed.
  - Persist attempt: `persistResult = await latestPersistFn(...)` (`lib/hooks/annotation/use-note-workspace-runtime-manager.ts:109`)
  - Unconditional removal: `removeWorkspaceRuntime(targetWorkspaceId)` (`lib/hooks/annotation/use-note-workspace-runtime-manager.ts:122`)

This can cause **silent data loss** when the adapter fails, the snapshot is missing, or a write fails.

## Goal

Make 4-cap eviction **hard-safe**:

- **Invariant:** No workspace runtime is destroyed unless its state is known-durable.
- **UX:** When durability cannot be ensured, eviction is blocked and the user is offered an explicit choice.
- **Bounded:** The system does not allow unbounded memory growth when persistence is unavailable.

## Non-Goals

- Do not redesign the overall workspace state machine.
- Do not require Yjs/CRDT changes.
- Do not change “preserve state, not behavior” on reload (cold restore pauses operations).

## Mandatory Pre-Read / Compliance Note

This change should avoid “isolation reactivity” anti-patterns described in
`codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md`:

- Avoid introducing brittle provider/consumer API mismatches.
- Avoid wiring new UI to new `useSyncExternalStore` hooks without backwards-compatible fallback.
- Keep correctness in core logic; UI only requests actions and renders state.

This proposal does not require Isolation Provider changes.

---

## Problem Statement (Current Gap)

In `evictWorkspaceRuntime`:

1. Snapshot capture runs (`use-note-workspace-runtime-manager.ts:101`).
2. Persistence is attempted (`use-note-workspace-runtime-manager.ts:109`).
3. The runtime is removed regardless of `persistResult` (`use-note-workspace-runtime-manager.ts:122`).

If persistence fails, the runtime disappears and the user is not informed.

---

## Proposed Behavior (Hard-Safe Eviction)

### Definition: “Dirty” (Unsaved Changes)

Blocking eviction on “persistence failed” is only correct when there are **unsaved changes**.

The eviction gate should treat a workspace as **dirty** when it has any unsaved durable state, such as:

- Workspace-level persistence tracking indicates pending changes (e.g., the `workspaceDirtyRef` concept in persistence).
- Store-level tracking indicates pending changes (e.g., component-store dirty state).

If the workspace is **not dirty**, eviction is safe even if “persist” returns `false` due to “no snapshot” or “no adapter”.

### Definition: “Durable”

For the 4-cap eviction gate, treat the workspace as “durable” if **the persistence function reports success**.

Notes:
- `persistWorkspaceSnapshot` returns `true` when it saves successfully, or when it detects no changes (`save_skip_no_changes`) (`lib/hooks/annotation/use-note-workspaces.ts:600`).
- It returns `false` when it cannot confirm durability (no adapter, no snapshot, or save error) (`lib/hooks/annotation/use-note-workspaces.ts:587`, `lib/hooks/annotation/use-note-workspaces.ts:589`, `lib/hooks/annotation/use-note-workspaces.ts:635`).

### Hard-Safe Rule

When runtime capacity requires eviction:

- If the candidate workspace is **not dirty**, eviction may proceed without persistence.
- If the candidate workspace **is dirty**, attempt to make it durable.
- If durability cannot be confirmed for a **dirty** workspace, **do not destroy the runtime**.
- Surface the blocked state to the UI with actionable choices.

### User Choices (When Blocked)

When auto-eviction is blocked due to persistence failure, the UI must present:

1. **Retry save** (attempt persistence again).
2. **Cancel** (do not open the new workspace / do not proceed).
3. **Force close** (evict anyway, losing unsaved changes).

For “force close”, reuse the existing “user decision” concept already present for active operations in runtime-manager
(`lib/workspace/runtime-manager.ts:1166`), but apply it to “durability blocked”.

---

## Implementation Plan

### Phase 1 — Make 4-Cap Eviction Gate on Durability

**Scope:** `lib/hooks/annotation/use-note-workspace-runtime-manager.ts`

1. After `persistResult` is obtained (`:109`), gate removal:
   - If `persistResult === true`: proceed to remove runtime (`:122`).
   - If `persistResult === false`: **return blocked** (no removal).
2. Ensure `ensureRuntimePrepared` respects blocked eviction:
   - If eviction was blocked and capacity is still exceeded, **do not create the new runtime**.
   - Return a structured status (e.g., `ok | blocked`) to upstream callers (see Phase 2).
3. Add explicit debug logs for:
   - `workspace_runtime_eviction_blocked_persist_failed`
   - include workspaceId, reason, persistResult, and any error info available from the persist call path.

**Acceptance checks**
- In a simulated persistence failure (adapter unavailable / forced save error), attempting to open a new workspace:
  - does **not** destroy an existing runtime
  - emits the “blocked” log event
  - does not silently proceed to exceed the cap

### Phase 2 — Propagate “Eviction Blocked: Not Durable” to UI

There are two approaches; for implementation, **pick one and remove the other** to avoid parallel systems.

#### Option A (Recommended): Extend runtime-manager’s blocked-event system

**Why:** Keeps “blocked eviction” signaling centralized and consistent.

1. Extend the `EvictionBlockedCallback` payload shape in `lib/workspace/runtime-manager.ts:147` to support more than “active operations”:
   - Add `blockType` (e.g., `active_operations | persist_failed`).
   - Keep existing `activeOperationCount` for compatibility; allow `0` for non-active blocks.
2. Export a safe notifier for blocked events (today `notifyEvictionBlocked` is internal at `runtime-manager.ts:176`).
3. From the 4-cap hook path, invoke the notifier with `blockType=persist_failed`.

**Risk to manage:** API expansion must be backwards compatible. Any UI consuming this callback must tolerate unknown/new block types.

#### Option B (Fallback only): Hook-level blocked event callback

**Why:** Avoids changing runtime-manager APIs.

1. Add an `onEvictionBlocked` callback to `useNoteWorkspaceRuntimeManager` options.
2. When persistence fails, call `onEvictionBlocked({ workspaceId, entryId?, reason: 'persist_failed' })`.
3. UI listens and shows the modal.

**Risk:** Two parallel “eviction blocked” channels (active ops vs persist failure) unless later unified.

### Phase 3 — Bounded Backpressure / Degraded Mode

Hard-safe eviction can deadlock capacity when persistence is unavailable. This must be explicit and bounded:

1. Track consecutive persistence failures and/or time window.
2. After a threshold (e.g., 3 failures or 30 seconds), enter **degraded mode**:
   - Block opening new workspaces automatically.
   - Require the user to either retry or force close a specific workspace.
3. Provide clear UI messaging:
   - “Unable to save workspaces right now; opening more would risk data loss.”

### Phase 4 — Candidate Selection Safety (Prevent “Wrong” Evictions)

The 4-cap hook chooses an eviction candidate by LRU access time and excludes only `current/pending` (`use-note-workspace-runtime-manager.ts:152-165`).

To match the broader eviction rules used in runtime-manager (pinned/active/shared workspace protections):

1. Prefer reusing runtime-manager’s eligibility rules rather than duplicating logic. Concretely:
   - Select candidates using the same “don’t evict shared/pinned/active/visible” rules as `getLeastRecentlyVisibleRuntimeId()` (`lib/workspace/runtime-manager.ts:1048`).
2. If *all* candidates are blocked (active ops or persist failures), always escalate to the UI.
3. Ensure the 4-cap path never evicts:
   - pinned workspaces (`lib/workspace/runtime-manager.ts:125`)
   - workspaces with active operations (auto-eviction must not kill operations; see `lib/workspace/runtime-manager.ts:1061`)

### Phase 5 — Tests (Targeted, No UI Needed)

Add unit/integration tests that cover:

1. When persistence returns `false`, 4-cap eviction does not call runtime removal.
2. When persistence returns `true`, 4-cap eviction removes the runtime.
3. When blocked, upstream receives a structured “blocked” status and does not create a new runtime.

Note: The repo already uses Jest (`package.json:13`) and has store tests (`__tests__/lib/workspace/workspace-component-store.test.ts`).

---

## Manual Test Scenarios (Post-Implementation)

### Scenario A — Persistence Available (Normal)

1. Create components/notes in Workspace A.
2. Create enough workspaces to trigger 4-cap pressure.
3. Verify eviction occurs and state rehydrates correctly when returning.
4. Verify no “blocked” modal appears.

### Scenario B — Persistence Unavailable (Blocked)

1. Simulate adapter failure (DB down or save throws).
2. Create workspaces until cap pressure occurs.
3. Verify:
   - no runtime is silently removed
   - “blocked” UI appears
   - user can retry, cancel, or force close

### Scenario C — Recovery

1. While blocked, restore persistence availability.
2. Retry save from UI.
3. Verify eviction proceeds normally and the blocked state clears.

---

## Rollout / Safety

1. Gate hard-safe eviction behind an existing feature flag if available, or a new one scoped to runtime manager behavior.
2. Ensure the UI path is resilient:
   - If no listener is registered, eviction should block but also log loudly to aid debugging.
3. Keep the change minimal and reversible.
