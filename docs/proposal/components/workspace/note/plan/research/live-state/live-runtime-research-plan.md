# Note Workspace Live-State — Research Plan

Goal: gather the proofs, constraints, and open questions needed before we land the live-runtime implementation (per `note-workspace-live-state-plan.md`). This plan focuses on understanding the current single-runtime stack, identifying all callsites that must change, and validating feasibility without creating new isolation/reactivity anti-patterns.

## Anti-pattern check
- `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md` **does apply**. All research actions must avoid introducing temporary UI-only gating or context/provider drift; any instrumentation must remain backward compatible.

## Key research questions
1. **Runtime Boundaries:** Which modules own the active canvas/runtime today, and how tightly are they coupled to a single workspace?
2. **Lifecycle & Ownership:** At what points do we create/destroy notes, panels, stores, and components? Where are ownership decisions sourced (e.g., `openNotes`, membership refs)?
3. **Persistence Sequencing:** When do snapshots capture vs. replay, and why do pending queues cause flicker?
4. **Component Registration:** How do calculators/alarms register in the layer manager and datastore? What hook(s) require work to support multi-runtime?
5. **Telemetry & Tooling:** Which log/telemetry events will we rely on to validate hot vs. cold runtimes, and what gaps exist?

## Affected files & focus areas
- `lib/hooks/annotation/use-note-workspaces.ts`
  - Sections: snapshot capture/replay (~300-950), workspace membership/open-notes (~1150-1550), lifecycle handlers (~1900+).
- `lib/note-workspaces/state.ts`
  - Current shared datastore + snapshot refs that must become per-runtime.
- `components/canvas/canvas-workspace-context.tsx`
  - Provider for `openWorkspaceNote`, component creation handlers, and layer manager plumbing.
- `components/annotation-canvas-modern.tsx`
  - Entry point for the runtime (canvas, datastore, layer manager wiring).
- `components/workspace/annotation-workspace-canvas.tsx`
  - Canvas host, selection wiring, and toolbar integration.
- `lib/hooks/annotation/use-canvas-snapshot.ts` / `use-canvas-snapshot-lifecycle.ts`
  - Snapshot apply/camera flows that will need runtime awareness.
- `lib/data-store.ts`, `lib/layer-manager.ts`
  - APIs that currently assume a single global instance.
- `components/workspace/floating-toolbar/*`, `components/annotation-app-shell.tsx`
  - User actions (e.g., “+ Note”) that must provide `workspaceId` to runtime selection.
- `logs/debug.log`, `lib/telemetry/events/*.ts`
  - Ensure we know which events to extend for runtime telemetry.

## Research Tasks

### 1. Map Current Flow (runtime & ownership)
- Trace `AnnotationAppShell` → `AnnotationWorkspaceCanvas` → `ModernAnnotationCanvas`.
- Document all props/state that carry `workspaceId`, `layerManager`, `dataStore`.
- Output: sequence diagram showing how a note creation flows through `openWorkspaceNote`, `useNoteWorkspaces`, and component creation handlers. Include file:line references for each hop.

### 2. Snapshot & Persistence Audit
- Review `collectPanelSnapshotsFromDataStore`, `waitForPanelSnapshotReadiness`, `captureCurrentWorkspaceSnapshot`, `applyPanelSnapshots`.
- Determine:
  - When pending queues are reset.
  - How `workspaceSnapshotsRef` is keyed.
  - Why replay clears before reinserting (causing flicker).
- Output: table that lists each function, current assumptions, and what must change in multi-runtime (e.g., “needs runtime-scoped datastore”).

### 3. Ownership/Membership Sources
- Investigate how `openNotes` feeds `workspaceNoteMembershipRef` and `workspaceOpenNotesRef`.
- Verify where `setNoteWorkspaceOwner` lives and how it is invoked when switching workspaces.
- Output: write-up that states authoritative owner source, failure scenarios (e.g., provider drift), and requirements for per-runtime truth.

### 4. Component Registration Survey
- Inspect calculators, alarms, generic components to see how they register with `LayerManager` and `DataStore`.
- Files to sample:
  - `components/workspace/components/calculator/*`
  - `components/workspace/components/alarm/*`
  - Shared hooks in `components/workspace/components/shared/`.
- Output: matrix mapping each component type to the hooks/stores it touches; mark blockers for per-runtime registration.

### 5. Toolbar & Selection Path
- Follow the “+ Note” flow from floating toolbar / command palette:
  - `components/workspace/floating-toolbar/*`
  - `lib/hooks/annotation/use-workspace-note-selection.ts`
- Confirm where `workspaceId` is sourced and how we’ll request a runtime before the UI shows the new note.
- Output: action flow doc with the list of files requiring updates.

### 6. Telemetry & Instrumentation
- Inventory existing events: `workspace_select_clicked`, `select_workspace_requested`, `workspace_prune_stale_notes`, `snapshot_*`.
- Define the additional events needed for runtime lifecycle (`workspace_runtime_created`, `workspace_runtime_evicted`, `workspace_runtime_visible`, `workspace_runtime_hidden`, `workspace_snapshot_replay` with `runtimeState`).
- Output: telemetry spec noting event name, payload schema, emitting file, and verification plan.

### 7. Persistence & Reload Behavior
- Observe current deletion/reload flow: how do we mark notes as deleted, and how does the datastore repopulate after reload?
- Files: `lib/hooks/annotation/use-note-workspaces.ts` (delete handlers), `lib/note-workspace-storage.ts` (if present).
- Output: checklist describing what must happen when a runtime is evicted or app is reloaded so deleted notes do not reappear.

### 8. Risk & Constraint Validation
- Memory profiling experiment: estimate baseline RAM per workspace by instrumenting `performance.memory` (Chrome) or devtools.
- Identify fallback behavior when more than N runtimes requested; document thresholds for desktop vs. tablet.
- Output: summary slide (bullets ok) with the measured numbers and recommended caps.

## Deliverables
1. **Research Notebook** (new doc under `docs/proposal/components/workspace/note/plan/research/live-state/`): captures outputs from Tasks 1–8.
2. **Owner Map**: table referencing file paths + line anchors for current ownership/membership flows.
3. **Telemetry Spec**: appended section in the notebook for new events.

## Success criteria
- Every question in “Key research questions” answered with file+line references.
- Risks documented with mitigation ideas (eviction thresholds, dev-mode assertions).
- Clear list of files to touch during implementation, minimizing guesswork and preventing future drift.
