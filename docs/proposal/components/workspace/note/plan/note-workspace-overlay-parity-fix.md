# Note Workspace Overlay-Parity Fix Plan

Goal: make each note workspace behave like an isolated browser tab—state keeps running/in-memory, and switching away/back never drops panels or notes or other components (e.g., calculator widgets). Non-main panels must persist across switches, including after creating new notes. Any component type must be captured/replayed via the per-workspace store and snapshot payload (type/id/position/size/z-index/metadata).

Applicability of isolation/reactivity anti-patterns: applicable. We must avoid provider/consumer drift and UI-only gating. Changes must be behind flags or backward-compatible shims.

Scope
- Note workspace persistence (capture/hydrate) for V2 flag.
- Panel snapshot ownership and replay semantics.
- Datastore isolation to prevent cross-workspace bleed.
- Tests/telemetry to lock behavior.

Out of scope
- UI redesign; only persistence/hydration mechanics.
- Legacy `/api/canvas/workspace` path (except to remove use under V2).

Plan (tab-model)
1) Immediate guard (stop drops)
   - Always keep `snapshotOwnerWorkspaceIdRef` set to the active workspace except during deliberate preview.
   - Mutation handler must never skip: if owner is null, reattach to the active workspace (under V2) and log; do not drop the mutation.
   - Force replay of the cached snapshot on every workspace switch (panels + open notes + camera), even if hashes match, to keep in-memory state populated.
   - Keep `panel_snapshot_skipped_no_owner` logging until owner-null is impossible; add `workspace_snapshot_replay` logs for every replay source.

2) Per-workspace datastore isolation (structural)
 - Use only per-workspace DataStores via a registry + V2 provider; bypass legacy CanvasWorkspaceProvider for V2. All component types (notes, calculators, etc.) must write/read through these stores.
   - On switch: clear only the target workspace store, then replay its cached snapshot into that store (no global/shared store).
   - Ensure store events cannot bleed between workspaces.

3) Authoritative snapshot ownership + replay freshness
   - Track backend revision with each cached snapshot; on switch, compare and replay: if revision differs, replace cache and replay adapter snapshot; if equal, still replay cached snapshot to keep the store warm. Snapshot payload must include all component types present in the store; do not filter to notes only.
   - Owner stays attached after preview/apply; no owner-null during normal operation.

4) Capture/switch/hydrate sequence (tab semantics)
   - V2 removes `/api/canvas/workspace` from note flow; adapter owns save/hydrate.
   - Switch sequence:
     1) Ensure owner is active workspace.
     2) Bounded wait (`Promise.race` with timeout) for pending panel mutations; on timeout, log and continue.
     3) Capture snapshot from the per-workspace store; persist via adapter.
     4) Set owner to target workspace.
     5) Force replay of cached snapshot for target workspace into its store (panels/open notes/camera), regardless of hash.
     6) Fetch adapter snapshot; if revision differs, replace cache and replay adapter snapshot; if identical, keep cache and (still) force replay to avoid stale memory.

5) Tests
 - Regression: Workspace A with a non-main panel → add a new note in A → switch to B → switch back; panel persists.
 - Regression: Mixed components: add note panels and another component (e.g., calculator) in A; add a new item; switch to B; switch back; all components persist.
 - Regression: Multiple non-main panels and rapid switches across ≥2 workspaces; no drops.
 - Isolation: Keys/stores remain per workspace; no bleed.

6) Telemetry/Logging
 - Keep owner-null/mutation logs until eliminated.
  - Log every replay (`workspace_snapshot_replay`) with source/revision/panel counts; log bounded-wait timeouts.
  - Add a guardrail log for hydration replay (passive effect) when it is forced despite matching hashes.

Current status vs plan (snapshot)
- Done/partial: Per-workspace provider/registry; forced replay on switch; revision tracking; bounded wait; regression test exists.
- Missing: Hydration path still hash-gated (needs forced replay); owner attachment needs to be hardened so mutations are never skipped; full integration suite not rerun post-changes.

Immediate next steps to finish
- Force hydration replay (not just switches) and harden owner attachment so no mutations are skipped.
- Verify per-workspace store isolation while clearing/replaying on each switch.
- Re-run the broader integration suite after these changes.

Rollout
- Behind `NOTE_WORKSPACES_V2` (and optional localStorage override) until stable.
- After validation, remove legacy canvas workspace persistence from the V2 path.
