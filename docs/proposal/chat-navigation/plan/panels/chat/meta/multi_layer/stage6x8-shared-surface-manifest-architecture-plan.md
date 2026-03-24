# Plan: Stage 6x.8 — Shared Surface Manifest Architecture

## Context

The current note-manifest work exposed a real product-policy issue:

- `open note X` is currently implemented too much like `go to where note X is already open`
- that can implicitly switch workspace or resolve against the wrong workspace scope
- this is wrong if the intended product rule is that plain note-open should preserve the current workspace

At the same time, the broader surface model is becoming clearer:

- dashboard widgets and workspace widgets are both built-in surfaces
- users can issue similar command families against both
- the container changes runtime context, but it does not justify two separate command architectures

Anti-pattern applicability: **not applicable**. This is command/routing architecture and documentation work, not React/provider reactivity work.

## Goal

Use one shared manifest framework for built-in surfaces across dashboard and workspace, while keeping per-surface policy explicit.

This plan should:

1. fix the immediate note-open policy mistake
2. keep workspace switching explicit rather than implicit
3. unify built-in dashboard and workspace surfaces under one manifest architecture
4. keep notes aligned to the same high-level vocabulary without forcing them into the generic surface manifest layer

## Core Product Rule

The product rule should be:

1. `open note X`
   - preserve the current workspace
   - if the note is already open here, focus it
   - if it is not open here, open it here
   - if multiple note identities match, clarify
   - if there is no current workspace, do not silently pick one; clarify or ask the user which workspace to use

2. workspace changes should happen only on explicit commands such as:
   - `go to the workspace containing note X`
   - `switch to where note X is open`

This separates:

- plain note-open
- cross-workspace navigation

Those are different execution policies and should not be merged into one implicit behavior.

## Architecture Decision

Do **not** build:

- one command system for dashboard widgets
- another command system for workspace widgets

Build:

1. one shared surface-manifest framework for built-in non-note surfaces
2. one shared resolver/executor model for those built-in non-note surfaces
3. per-surface manifest definitions
4. runtime container context that tells the system where the surface lives
5. a specialized sibling note command manifest/resolver/executor contract for notes

The correct distinction is:

- shared high-level framework and policy vocabulary
- generic shared manifest path for ordinary built-in non-note surfaces
- specialized sibling contracts only when a surface clearly outgrows the generic path
- different policy values and runtime context per surface

For notes, preserve the existing note-command-manifest architecture rather than collapsing notes into the generic panel/widget manifest layer.

## Shared Manifest Model

Each built-in non-note surface should have its own manifest definition within one shared schema.

Shared fields should include:

- `surfaceId`
- `surfaceType`
- `containerType`
- `surfaceInstanceType`
- `instanceSelector`
- `manifestVersion`
- `handlerId`
- `supportedCommands`
- `requiredContext`
- `executionPolicy`
- `clarificationPolicy`
- `replayPolicy`
- `safetyRules`

Example shape:

```ts
type SurfaceManifestEntry = {
  surfaceId: string;
  surfaceType:
    | 'links_panel'
    | 'recent'
    | 'widget_manager'
    | 'calculator'
    | 'sticky_note';
  containerType: 'dashboard' | 'workspace';
  surfaceInstanceType: 'singleton' | 'multi_instance';
  instanceSelector?: {
    selectorMode: 'none' | 'instance_label' | 'duplicate_family' | 'either';
    requireSpecificInstance?: boolean;
  };
  manifestVersion: string;
  handlerId: string;
  supportedCommands: Array<{
    intentFamily: string;
    intentSubtype: string;
    examples: string[];
    requiredArguments?: string[];
    requiredContext?: string[];
    executionPolicy: string;
    clarificationPolicy: string;
    replayPolicy: string;
    safetyRules: string[];
  }>;
};
```

The manifest is still a capability/policy contract, not a giant phrase table.

For duplicate-instance built-in surfaces, the manifest/runtime contract must carry enough selector identity to distinguish:

- instance label
- duplicate family
- whether the user explicitly targeted a specific instance

Do not rely on bare `surfaceType` alone for commands such as:

- `summarize what is in links panel B`
- `edit the entry in links panel A`

## Why One Shared Framework Is Better

Users can issue similar commands across both containers:

- `summarize what is in links panel B`
- `what is the current widget in dashboard`
- `edit the entry in the links panel`
- `remove the recent item in the recent widget`

These are all examples of the broader shared surface-command vocabulary.

The first four examples are the direct motivation for a shared generic manifest path for built-in non-note surfaces.

The note examples are relevant because they show overlapping command vocabulary across surfaces, even though notes remain on their specialized sibling contract rather than joining the generic non-note manifest layer.

The container changes:

- available live state
- target scope
- visibility/open-state semantics
- allowed mutations

But it does **not** remove the need for shared command vocabulary and a common framework, even if some surfaces use specialized sibling contracts.

## Notes as a Specialized Sibling Contract

Notes should not be forced into the generic built-in surface manifest layer.

The existing note-command-manifest architecture remains the right primary contract for notes. It already captures note-specific semantics that generic built-in widget/panel intents do not carry cleanly.

Notes need extra semantics such as:

- active note
- open notes
- note identity lookup
- follow-up anchors
- content answering
- mutation semantics

So the right model is:

- shared high-level vocabulary across surfaces
- generic shared manifest/registry as the default path for built-in non-note surfaces
- note as the first specialized sibling contract
- optional alignment points between the two systems where helpful

Not:

- forcing notes into the generic built-in surface manifest
- pretending notes have the same execution semantics as ordinary built-in widgets
- turning every surface into a specialized sibling contract by default

Future sibling specializations should be exception-based, not the default design.

Only introduce them when a surface demonstrably outgrows the generic shared manifest contract.

## Relationship to the Existing Note Plan

This plan must not override the current note architecture decision captured in:

- `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-note-command-manifest-architecture-plan.md`

That plan explicitly keeps notes out of the generic panel/widget manifest registry and uses a note-specific manifest, resolver, and executor.

This shared-surface plan should therefore be interpreted as:

- shared framework for built-in dashboard/workspace surfaces
- generic manifest path remains the default for ordinary built-in non-note surfaces
- shared vocabulary for policy concepts
- notes are the first specialized sibling contract
- note policy correction for the current bug
- future sibling specializations are possible, but only when justified by deeper semantics
- no forced merge of note contracts into the generic surface-manifest layer

## Immediate Bug Fix Direction

The immediate issue is not just a bad fallback source. The deeper issue is that plain note-open currently behaves like a workspace-navigation action.

### Current wrong behavior

`open note X` can resolve into a path that effectively means:

- find the note
- navigate to the workspace where it is already open

### Correct behavior

`open note X` should mean:

- find the note identity
- preserve the current workspace
- open or focus the note in that workspace
- if there is no current workspace, ask the user which workspace should receive the note instead of silently switching

### Immediate investigation step

Instrument the deterministic note-open branch and log:

- `currentWorkspaceId`
- `sessionState.currentWorkspaceId`
- `uiContext?.workspace?.workspaceId`
- `getActiveWorkspaceContext()`
- `currentEntryId`
- `sessionState.currentEntryId`
- note title

This confirms which scope source is actually wrong during the repro.

### Immediate execution fix

After instrumentation confirms runtime scope behavior:

1. keep deterministic note-open narrow
2. stop treating plain note-open as implicit workspace navigation
3. route plain note-open through a current-workspace note-open/focus seam
   - initial implementation should use a client-side current-workspace note-open callback/event that ultimately calls the workspace note-opening path
   - treat that callback/event path as the bridging rollout seam, not necessarily the final permanent executor seam
   - do **not** reuse `navigate_note` as the execution policy for plain note-open
4. keep explicit workspace-switch commands separate

## Surface Command Policy Split

The system does not need a different command framework for dashboard vs workspace.

It **does** need different execution policies for different commands.

For notes, at minimum:

### `open_note`

- target: note identity
- preserve current workspace: `true`
- allow global note discovery: `true`
- implicit workspace switch: `false`
- clarify on duplicate note identities: `true`
- if no current workspace exists: `clarify_target_workspace`

### `go_to_note_workspace`

- target: workspace containing note
- preserve current workspace: `false`
- implicit workspace switch: `true`
- clarify on multiple candidate workspaces: `true`

This is the key distinction:

- semantic recognition can be assisted by seeded queries, memory, and bounded LLM
- execution behavior still needs an explicit policy contract

## Seeded Queries and Semantic Matching

Seeded queries and semantic retrieval are useful for:

- recognizing which surface command the user probably means
- increasing confidence
- covering varied phrasing

They are **not** enough by themselves to define execution behavior.

They help answer:

- what command family is this?

They do not safely answer:

- should the workspace switch?
- should the note open here?
- should the system clarify?
- what side effects are allowed?

That is why the manifest still needs explicit execution policy.

## Implementation Plan

### Phase A — Immediate bug investigation and policy correction

1. instrument deterministic note-open scope sources
2. confirm the actual runtime scope mismatch
3. document `open_note` vs `go_to_note_workspace` as separate policy behaviors
4. change plain note-open to preserve current workspace

### Phase B — Shared surface manifest base

1. define shared `SurfaceManifestEntry` for built-in non-note surfaces
2. define shared command entry shape
3. add `containerType`
4. add duplicate-instance selector identity fields
5. add runtime surface context contract

### Phase C — Surface manifests

Create manifest definitions for built-in surfaces, for example:

- `links_panel`
- `recent`
- `widget_manager`
- `calculator`
- `sticky_note`

Each uses the same schema with different policy values.

### Phase D — Note specialization

Keep the note-command-manifest plan as the note path and align it with the shared-surface vocabulary where useful.

Extend note manifests with note-specific fields for:

- active note support
- open-note state
- anchor requirements
- content-read policies
- mutation confirmation rules

### Phase E — Resolver and executor alignment

1. semantic retrieval + seeded examples classify likely command
2. surface resolver produces canonical normalized command shape
3. executor applies manifest policy
4. replay/cache only reuses interpretation, not stale outputs

## Testing Plan

At minimum:

1. `open note X` while in workspace A and note currently exists in workspace B
   - stays in workspace A
   - opens or focuses note X in workspace A

2. `go to the workspace containing note X`
   - switches workspace

3. duplicate note title across workspaces
   - clarifies

4. deterministic note-open path logs and uses the correct live scope source

5. dashboard and workspace surfaces can both resolve through the same manifest framework

6. `open note X` from dashboard/no current workspace
   - does not silently switch to an arbitrary workspace
   - instead clarifies or prompts for the target workspace

7. duplicate-instance built-in surfaces such as `links panel B`
   - resolve to the correct targeted instance
   - do not bind to bare surface type when instance-specific context exists

## Bottom Line

The right direction is:

1. one shared manifest framework for built-in non-note surfaces
2. one manifest definition per surface
3. container metadata and live context supplied at runtime
4. generic shared manifest/registry remains the default path for ordinary built-in non-note surfaces
5. notes remain the first specialized sibling contract, not a generic surface-manifest entry
6. future sibling specializations are exception-based, not the default architecture
7. plain note-open preserves current workspace
8. workspace switching stays explicit
