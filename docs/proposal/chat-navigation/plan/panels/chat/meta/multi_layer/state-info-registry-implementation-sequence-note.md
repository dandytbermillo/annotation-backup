# State-Info Registry Implementation Sequence Note

## Purpose

This note captures the next implementation sequence for the registry-backed state-info
work.

It is not a new proposal. The registry-first direction is already established in:

- `known-noun-policy-contract-plan.md`
- `state-info-runtime-registry-addendum.md`
- `runtime-widget-registry-metadata-note.md`

So the work below is primarily implementation alignment and execution, not conceptual
proposal redesign.

## Current Status

The live docs already establish the key architectural rule:

- one authoritative widget runtime registry/model for current state-info
- many producer inputs are allowed during migration
- consumers should read one registry-facing model only

The remaining work is to make implementation guidance fully consistent and ready for
coding.

## Recommended Next Sequence

### 1. Clean up any stale wording in the detailed plan

This is a cleanup/alignment step, not a rewrite.

The detailed plan should be checked for any wording that still implies:

- raw UI fields are read directly by multiple resolver branches
- dashboard inventory is equivalent to current open state
- generic state-info still uses pre-registry semantics

The goal is simple consistency with the already-settled registry-first contract.

### 2. Choose one canonical registry field set

Do not introduce a third overlapping schema.

The existing docs already name most of the needed fields, but with slightly different
labels across files. Pick one canonical runtime field set and map the older wording to
it.

Examples of fields already discussed:

- `family_id`
- `instance_id`
- `instance_label`
- `title`
- `type`
- `surface_type`
- `entry_id`
- `dashboard_id`
- `workspace_id`
- `duplicate_capable`
- `open`
- `updated_at`

The point is not to expand scope. The point is to make one field vocabulary
authoritative for implementation.

### 3. Lock the lifecycle decisions the proposal leaves open

The proposal intentionally allows more than one lifecycle shape. Implementation should
choose explicitly:

- closed widgets unregister from the runtime registry
- or closed widgets remain present with `open: false`

Similarly, any surface-switch behavior should be chosen explicitly rather than assumed.

The plan requires consistent surface-aware resolution, but it does not require one
specific unregister-on-switch policy.

### 4. Build the full test matrix before rollout

The test plan should include both positive and negative cases.

Core deterministic cases:

- `what panel is open?`
- `what widgets are open?`
- `is recent open?`
- `which navigator is open?`
- `is links panel a open?`
- `which links panel is open?`

Lifecycle and scope cases:

- widget opens -> appears in registry-backed answer
- widget closes -> follows chosen lifecycle rule
- installed/configured but not opened widget does not leak into `what widgets are open?`
- duplicate-capable family answers use current open instances only
- active clarification breakout still works

Required negative/regression cases from the addendum:

- state-info does not enter docs routing
- state-info does not produce generic grounding clarifiers
- state-info does not introduce unsupported option payload shapes

### 5. Implement in slices

Suggested coding slices:

1. canonical registry builder / normalized runtime model
2. generic state-info on top of that model
3. noun-specific singleton / family / instance state-info on top of that model
4. lifecycle wiring and regression tests

## Tone Of The Work

This should be treated as:

- implementation sequencing
- contract cleanup
- test hardening

It should not be treated as:

- a new proposal track
- a major conceptual rewrite
- a replacement for the current registry-first docs
