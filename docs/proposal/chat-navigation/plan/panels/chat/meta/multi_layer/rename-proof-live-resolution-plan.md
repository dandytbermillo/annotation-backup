# Rename-Proof Live Resolution Plan

## Purpose

Define a rename-proof routing model for panel/widget commands and state-info queries so the system:

- executes only against current live objects
- never treats persisted titles as execution authority
- renders current titles at display time
- degrades to clarification or safe fallback when live resolution is ambiguous or stale

This plan combines:

- the structural proposal to separate retrieval from live resolution
- the smaller incremental proposal to late-bind display labels and add one live resolution gate

The end-state is stronger than the current patch set. The current patches remove some stale learned-row symptoms, but they do not eliminate old seeded identities or title-driven drift.

## Current Problem

The current bug class appears when a widget/panel is renamed after seeds and learned rows already exist.

Observed examples:

- `open links panel aaa` still surfaces `links panel a`
- `is links panel aaa open?` can still route through A-shaped seeded candidates
- clarification pills can display old seed names that no longer match live widget titles
- replay/execution messages can use stored labels instead of the current title unless explicitly patched

The root issue is not only stale learned rows. It is the larger identity model:

- curated seeds still encode mutable instance nouns such as `links panel a`
- learned rows historically stored titles as execution/display metadata
- runtime re-resolution expects selector metadata that many curated rows do not carry
- some matching code still normalizes query text toward single-letter instance forms

## Anti-Pattern Applicability

The mandatory anti-pattern note in `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md` is applicable by analogy.

Relevant constraints:

- do not introduce provider/consumer contract drift in one patch
- do not fix correctness only at the UI layer
- do not couple behavioral changes with reactivity changes unless the boundary is explicit
- do not replace a stable path with a brand-new contract everywhere at once

This plan complies by:

- introducing a phased migration
- keeping live resolution as a shared runtime contract rather than a UI-only patch
- isolating display fixes from identity-model/schema changes
- treating retrieval and resolution as separate layers with backward-compatible phases

## Goal State

A reliable system for mutable widget/panel names means:

1. persisted text is never authoritative for execution
2. every shown or executed candidate must resolve against fresh live state
3. display labels are late-bound from the resolved live object
4. retrieval ranks possibilities; resolution decides what is actually valid now
5. rename is handled as an explicit identity-policy event, not as ad hoc stale-data cleanup

This does not mean text disappears from the system. It means text may participate in retrieval, but not in final authority.

## Core Invariants

### 1. Stable identity beats stored title

- `panelId` is authoritative when available
- selector metadata is authoritative when a stable ID is not present
- stored `panelTitle` / `target_name` are retrieval hints only

### 2. No unresolved candidate is user-visible

A candidate may be retrieved, but it must not:

- execute
- appear in a clarifier
- produce an `Opening X...` message

until it resolves to a current live object or a bounded family ambiguity set.

### 3. Display labels are late-bound

Every displayed label comes from the resolved live object:

- current title for single resolved target
- current sibling titles for bounded family clarifiers

Stored labels may be retained for telemetry/debugging, but not rendered directly.

### 4. Retrieval and resolution are distinct phases

- retrieval may use seeds, learned rows, fuzzy matching, and embeddings
- resolution must use live runtime state only
- execution authority belongs to resolution, not retrieval

### 5. Rename policy is explicit

The system must choose one product rule:

- old instance name remains a valid alias for some period
- or old instance name becomes invalid immediately

The routing system cannot be reliable while this rule is implicit.

## End-State Architecture

### Candidate Model

Use one canonical candidate shape for navigation/state-info target resolution.

Illustrative shape:

```ts
type Candidate = {
  source: 'seed' | 'learned' | 'live_match'
  intent_id: string
  retrieval_score: number
  family_id?: string
  selector?: {
    panel_id?: string
    instance_label?: string
    alias?: string
    kind: 'panel_id' | 'instance_label' | 'family'
  }
  query_type?: 'open_state' | 'active_state'
}
```

Notes:

- stable ID is good and should be retained when known
- stored titles are not part of the authoritative shape
- retrieval text may still exist elsewhere for ranking/fingerprints/telemetry

### Resolution Function

Introduce one shared runtime resolver:

```ts
resolveCandidate(candidate, liveRegistry) -> ResolvedTarget | FamilyAmbiguity | NotResolvable
```

Where:

- `ResolvedTarget` includes current `panelId`, current `title`, current `instanceLabel`, current family metadata
- `FamilyAmbiguity` includes the current live sibling set
- `NotResolvable` is a hard stop for execution and direct display

### Single Resolution Gate

Every path must use the same resolution result:

- Stage 5 execution
- bounded-selection clarifier build
- memory replay
- state-info target lookup
- `Opening X...` display
- inspector/dev labels where correctness matters

No path should bypass the gate and render/use a raw seed title or stored learned-row title.

## Live Registry Requirement

This plan depends on a fresh live registry.

In this repo, the current practical registry is the per-turn dashboard/widget context:

- current visible widgets
- current duplicate-family metadata
- current open/active widget state

Freshness is a separate requirement:

- if `uiContext.dashboard.visibleWidgets` is stale, resolution is stale
- so the rename-time `uiContext` sync fixes remain necessary even under the stronger architecture

## Rename Handling Policy

### Minimum rule

On rename:

- current title changes on the live object
- late-bound displays automatically show the new title
- learned rows survive only if they re-resolve to the same live object

### Optional alias/tombstone rule

If product wants short-lived tolerance for the old name:

- store old title as a tombstoned alias
- allow retrieval to consider the alias during a bounded TTL
- never allow tombstone-only resolution to silently execute without current live confirmation

### Important distinction

If product policy says rename changes the instance identity itself, then:

- old instance selectors must be invalidated
- instance-label metadata must be updated or tombstoned explicitly

If product policy says rename only changes display text, then:

- the old selector may remain valid
- but the UI must always display the new canonical title

## Incremental Migration Plan

### Phase 1: Late-Bind All Display Labels

Goal:

- remove stale-label leaks without changing seed schema

Work:

- introduce one helper that resolves the display label from the current live registry
- use it in:
  - replay message display
  - bounded/clarifier pill labels
  - open-vs-docs labels
  - any `Opening X...` path that currently reads stored text

Why this is valuable:

- smallest safe improvement
- directly removes user-visible stale titles
- does not require schema changes

Limit:

- does not remove old seeded identities
- does not fix execution authority by itself

### Phase 2: Make Runtime Resolution the Execution Gate

Goal:

- prevent stale seeded or learned candidates from executing unless they bind to live state

Work:

- normalize candidate metadata so curated seeds expose runtime-resolvable selector fields
- reconcile naming mismatch between:
  - `family_id`
  - `duplicateFamily`
  - `instanceLabel`
  - current seed/dispatcher field expectations
- require resolution before:
  - execution
  - clarifier inclusion

Repo-specific substeps:

- update curated quick-links instance seeds so they carry selector metadata compatible with runtime resolution
- stop relying on hardcoded known-noun instance rows for mutable instance titles
- ensure the dispatcher re-resolution path can consume curated instance metadata, not just learned-row metadata

Why this is the real fix:

- Step 2 learned-row cleanup alone cannot solve the current issue because curated A-seeds still survive
- this phase closes that gap

### Phase 3: Candidate Model + Write-Path Refactor

Goal:

- remove text-as-identity from persistence

Work:

- refactor learned-row writes to store stable selector identity, not authoritative titles
- keep query text for retrieval/telemetry only
- add optional alias/tombstone support for rename policy
- remove rename-time stale-title cascades that become unnecessary once display is live-bound and rows are identity-bound

Why this phase is larger:

- touches persistence shape
- touches seed authoring
- touches replay/build/write code

## Specific Repo Recommendations

### Recommendation A: Keep Fix A, but treat it as Phase 1 only

The current display-time title lookup is still useful.

It should remain, but be generalized into one shared late-binding helper instead of staying as a narrow replay-only fix.

### Recommendation B: Do not rely on learned-row cleanup as the main prevention mechanism

Rename-time soft-delete is useful containment, but it is not sufficient:

- curated seeds remain active
- current issue already proves that

Soft-delete should be treated as transitional hygiene, not the core architecture.

### Recommendation C: Fix query normalization only after the resolution gate exists

Repeated-letter collapse and typo logic should not be the main identity mechanism.

The correct order is:

1. make live resolution authoritative
2. then reduce or relocate normalization so it only helps retrieval

### Recommendation D: Make known-noun instances family-driven, not hardcoded title-driven

For mutable duplicate-family panels, hardcoded instance noun entries such as:

- `links panel a`
- `links panel b`

should stop being execution authority.

They may remain retrieval hints, but they must resolve through live family + selector rules before being shown or executed.

## Testing Plan

### Phase 1 tests

- replay message after rename shows current title, not stored title
- clarifier labels use current live title when the target resolves

### Phase 2 tests

- renamed panel no longer executes through stale instance seed unless live resolution proves it
- `open links panel aaa` resolves correctly or clarifies safely
- `is links panel aaa open?` never executes a stale A-target
- deleted or hidden panel rows do not survive as executable candidates

### Phase 3 tests

- learned-row replay still works across rename when stable identity remains valid
- tombstoned alias behavior follows the chosen product rule
- no display path renders stored stale titles directly

### Runtime checks

- rename in-session, then immediately query old and new names
- verify:
  - no stale label leak
  - no silent wrong-object execution
  - ambiguity produces clarification, not execution

## Rollback / Safety

This plan is intentionally phased.

Safe rollback points:

- Phase 1 can roll back without touching persistence
- Phase 2 can ship behind internal validation instrumentation before Phase 3
- Phase 3 should land only after the earlier phases have stabilized runtime evidence

Safety rule:

- if a candidate cannot resolve to current live state, the fallback must be clarification or safe refusal, never silent execution

## Non-Goals

This plan does not require:

- eliminating text from retrieval
- eliminating seeds
- eliminating learned rows
- a one-shot rewrite of the whole routing stack

It changes where authority lives, not whether retrieval text exists.

## Open Product Decision

One product decision is still required:

- does renaming `Links Panel A` to `Links Panel aaa` preserve the old `A` identity as an alias, or does it invalidate it?

This decision affects:

- alias/tombstone behavior
- whether old `links panel a` seeded identities should continue to resolve
- how `instance_label` should behave on rename

Without this decision, the system can still be made safer, but not fully semantically consistent.

## Recommended Next Step

Implement the smallest reliable path in this order:

1. finish Phase 1 late-bound labels everywhere
2. implement Phase 2 live resolution gate for curated instance seeds and clarifier build
3. only then decide whether Phase 3 selector-bound persistence + tombstones is worth the schema churn

This preserves momentum while moving the repo toward the stronger architecture instead of stacking more local patches on stale title identity.
