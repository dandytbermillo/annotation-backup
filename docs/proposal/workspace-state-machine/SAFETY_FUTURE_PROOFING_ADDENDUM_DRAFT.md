# Workspace State Machine — Safety & Future‑Proofing Addendum (Draft)

- **Feature Slug:** `workspace-state-machine`
- **Date:** 2025-12-14
- **Status:** Draft addendum to `IMPLEMENTATION_PLAN.md`

---

## Why This Addendum Exists

`docs/proposal/workspace-state-machine/IMPLEMENTATION_PLAN.md` already solves the core bug by making the
workspace store the single source of truth and using store lifecycle (not runtime existence) for hot/cold
classification.

This addendum adds low-overhead guardrails for:
- Component state evolution (schema changes over time)
- Prolonged persistence failures (avoid “non-evictable forever” memory growth)
- Extensibility (avoid the store becoming a god object as more component types add headless ops)

**Non-goals (unchanged):**
- CRDT/Yjs and multi-writer collaboration (explicitly out of scope for Option A)
- Replaying “behavior” on reload (default remains preserve state, not behavior)

---

## 1) New Safety Invariants

1. **Persisted state is validated on restore.** Corrupt or incompatible component state must not crash
   restore/hydration.
2. **Schema evolution is first-class.** Old payloads restore predictably via migration, and newer payloads
   are preserved without data loss even if the app can’t interpret them.
3. **Eviction never silently discards dirty state.** If the DB cannot be reached, eviction requires either
   a durable fallback (local queue) or explicit user action (pin/close/export).
4. **Degraded mode is explicit and user-visible.** Users should know when saves are not durable.

---

## 2) Component State Schema Versioning (Minimal but Future-Proof)

### Durable payload additions (conceptual)

For each component in the persisted `components[]` payload, treat `metadata/state` as a versioned blob:
- `type` (already present)
- `schemaVersion` (new, integer)
- `state` (existing shape, still “component-specific”)

### Registry-based validation and migration

Introduce a **Component Type Registry** (data-only contract) that provides per-type rules:
- Current `schemaVersion`
- `validate(state)` (accept/reject; can coerce where safe)
- `migrate(fromVersion, state)` (forward migrations only)
- `applyColdRestoreInvariant(state)` (centralized “preserve state, not behavior” normalization)
- Optional: operation hooks (see section 3)

### Restore behavior rules

- **Unknown component type:** preserve the payload as opaque, keep layout/position, render a placeholder
  (“Component type unavailable”) and allow delete. Do not drop data.
- **Newer schemaVersion than supported:** preserve opaque, do not attempt partial parsing. This prevents
  accidental default-overwrite when a user downgrades or switches builds.
- **Older schemaVersion:** migrate forward to the latest before storing in the workspace store.
- **Validation failure:** preserve raw state separately for export/debug, but prevent it from overwriting a
  known-good state; show a non-blocking warning in UI.

### Persist behavior rules

- Persist only the latest schemaVersion for known types.
- Enforce size limits (per-component and per-workspace) to prevent pathological payload growth; if limits
  are exceeded, enter degraded mode and require user action (pin/close/export).

---

## 3) Extensibility: Prevent the Store Becoming a “God Object”

The current plan uses Option B (“headless ops in the store”) for correctness when hidden workspaces are
unmounted. That’s right, but it can become messy as more component types add background behavior.

Add a simple extensibility pattern:
- Keep the store core generic: CRUD, dirty tracking, persistence scheduler, lifecycle, subscriptions.
- Move component-specific headless operation logic behind the Component Type Registry so new components can
  plug in without editing the store core.

**Outcome:** Adding “Pomodoro”, “Media”, “Alarm”, etc. becomes “add a registry entry + UI component”, not “edit
store internals”.

---

## 4) Persistence Resilience: Backpressure + Degraded Mode

The base plan’s retry-with-backoff and “non-evictable if dirty + persist failed” is safe, but incomplete:
in a prolonged outage, *everything* becomes non-evictable and memory can grow without bound.

### 4.1 Persist Health State (per entry or per workspace)

Track a simple health state:
- **healthy:** saves succeed recently
- **retrying:** transient failures, backoff active
- **degraded:** failure threshold exceeded (time-based and/or attempt-based)
- **recovering:** first success after degraded; flush queued writes

This state is used for:
- UI banner/indicator (“Saving unavailable / Offline mode”)
- Eviction policy decisions
- Applying backpressure to prevent memory blow-ups

### 4.2 Degraded Mode Policy (safety-first)

When **degraded**:
- **User-visible warning**: make non-durability explicit.
- **Backpressure**:
  - Prefer preventing creation of many new dirty workspaces (soft limit + warning).
  - Prefer pausing *new* headless operations by default (user can override per component/workspace).
  - Always allow pinning to protect the user’s most important workspaces.

### 4.3 Durable fallback for eviction (recommended)

To keep “persist-before-evict” true even when the DB is unreachable, add an optional local durable queue:
- Persist pending workspace snapshots to a local store (e.g., IndexedDB) with `(entryId, workspaceId,
  revision, capturedAt)`.
- On recovery, replay in order and clear.

If the local queue is considered out-of-scope initially, define the alternative explicitly:
- In degraded + memory-pressure conditions, eviction requires explicit user action (pin/close/export),
  rather than silent eviction.

### 4.4 Hard memory limits

Define explicit guardrails:
- Max open workspaces per entry (config)
- Max total component count per entry (config)
- Max serialized payload size per workspace (config)

When limits are hit:
- Evict only **clean + inactive + non-default + non-pinned** first.
- If none exist and persistence is degraded, block further growth and surface a user choice.

---

## 5) Ordering & Idempotency at the DB Boundary

The plan already uses a monotonic `revision` internally. Make that revision meaningful at the persistence
boundary:
- Store `revision` with the persisted workspace payload.
- Reject stale writes (or treat as no-op) when incoming revision is older than what’s stored.

This protects against out-of-order async saves and reduces the blast radius of race conditions during
switch/evict/hydrate bursts.

---

## 6) Observability (Make Future Bugs Cheap to Diagnose)

Standardize a small set of structured events:
- Store lifecycle transitions (`uninitialized` → `restoring` → `ready` → `error`)
- Persist start/success/failure (include revision, bytes, dirty count)
- Degraded mode enter/exit (include reason)
- Eviction decisions (hard-rule block reason or score breakdown)

**Goal:** When a user reports “workspace reset”, you can reconstruct the timeline from logs without adding
ad-hoc debug prints.

---

## 7) Expanded Tests / Acceptance Criteria

Keep the current “Exact Failing Case” and “No Running Components Variant” from the base plan, and add:

### Resilience
- DB outage simulation (persist failing for several minutes):
  - Degraded mode becomes visible
  - No silent data loss
  - Memory growth is bounded by backpressure/limits
  - Recovery replays queued writes (if local queue implemented)

### Schema evolution
- Restore payloads from older schemaVersion for each component type (migration works)
- Restore payloads from newer schemaVersion (opaque preservation; no overwrite)

### Scale sanity
- 50+ components in one workspace (typing + drag + resize):
  - No excessive re-renders
  - Persistence remains batched
  - Switch/evict remains responsive

---

## 8) Phase Integration (Where This Fits)

Suggested minimal integration points:
- **Phase 1:** Add schemaVersion to durable component entries; add component registry skeleton; add basic
  validation and “unknown type” preservation.
- **Phase 3:** Add persist health state and degraded mode indicator (even if the local queue is deferred).
- **Phase 4:** Make eviction consult persist health + hard memory limits (avoid unbounded non-evictables).
- **Phase 5:** Register each migrated component type with schema + optional headless ops hooks.

---

## 9) Risk Updates (Add to Base Plan’s Risk Table)

| Risk | Mitigation |
|------|------------|
| Persist outage causes unbounded memory | Degraded mode + backpressure + limits; optional local durable queue |
| Schema migration bug | Forward-only migrations; test fixtures for old payloads; feature flag |
| Unknown/new component types | Opaque preservation; placeholder rendering; never drop data |
| Store complexity growth | Component registry for ops/validation to keep store core generic |
