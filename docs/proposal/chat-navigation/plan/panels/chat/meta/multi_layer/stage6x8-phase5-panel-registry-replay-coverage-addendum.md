# Stage 6x.8 Phase 5 Addendum — Panel Registry Expansion and Replay Wiring

## Summary

Use the existing panel manifest registry as the static contract layer for panel-family replay coverage.

This addendum refers specifically to the chat manifest registry in `lib/panels/panel-registry.ts`, not the dashboard type/layout registry in `lib/dashboard/panel-registry.ts`.

The database remains the source of learned successful exact queries and replay counts.
The registry remains the source of static panel metadata, examples, parameter schema, handler shape, and target identity.

Scope note:
- Phase 1 scope: built-in dashboard panels only
- Deferred: DB-backed registered/custom widget manifests, which need a separate openability and resolver-adoption audit

This addendum replaces panel-by-panel replay patches with a registry-backed rollout model for built-in dashboard panels in this phase. DB-backed registered widgets are explicitly deferred to a follow-up phase.

Applies to:
- [stage6x8-phase5-family-level-replay-coverage-addendum.md](/Users/dandy/Downloads/annotation_project/annotation-backup/docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-family-level-replay-coverage-addendum.md)
- [stage6x8-phase5-retrieval-backed-semantic-memory-plan.md](/Users/dandy/Downloads/annotation_project/annotation-backup/docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-retrieval-backed-semantic-memory-plan.md)

Anti-pattern applicability: **not applicable**. This is routing/replay contract work, not provider/reactivity work.

## Problem

Panel-family replay now works for representative examples such as:
- `open links panel b`
- `hello there open links panel b`

But the product requirement is broader:
- `open recent`
- `open recent widgets`
- `open widget manager`
- other default dashboard panels
- noisy variants of those phrases

The current risk is not that the replay database is missing. The risk is that panel-family routing and replay still rely on uneven adoption of static panel metadata.

Without a registry-backed contract, the codebase drifts toward:
- panel-specific routing assumptions
- panel-specific replay assumptions
- query-by-query fixes

That is not scalable.

## Existing Foundation

The codebase already has the right static layer:

### 1. Panel intent registry
- [panel-registry.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/panel-registry.ts)
- singleton: `panelRegistry`
- already used by:
  - [intent-prompt.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/chat/intent-prompt.ts)
  - [intent-resolver.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/chat/intent-resolver.ts)
  - [navigate/route.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/app/api/chat/navigate/route.ts)

### 2. Panel manifest contract
- [panel-manifest.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/panel-manifest.ts)
- already defines:
  - `panelId`
  - `panelType`
  - `title`
  - intents
  - examples
  - params schema
  - handler
  - permission

### 3. Built-in manifests already registered
Examples:
- [recent-panel.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/manifests/recent-panel.ts)
- [navigator-panel.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/manifests/navigator-panel.ts)
- [widget-manager-panel.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/manifests/widget-manager-panel.ts)
- [link-notes-panel.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/manifests/link-notes-panel.ts)
- [links-overview-panel.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/manifests/links-overview-panel.ts)
- [quick-capture-panel.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/manifests/quick-capture-panel.ts)
- [continue-panel.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/manifests/continue-panel.ts)

## Goal

Expand and wire the existing registry so that panel-family replay is generic.

Target outcome:
1. a panel/widget declares its static chat contract in one manifest file
2. the app registers that manifest into the existing registry
3. successful replay-safe panel opens write generic `open_panel` memory rows
4. later exact repeats replay through the same generic `open_panel` contract
5. no new widget/panel should require custom replay logic if it fits the panel-family contract

## Core Design

### Static vs learned responsibilities

#### Registry / manifest layer
Source of truth for static capabilities:
- panel identity
- title
- aliases/examples
- supported intent names
- params schema
- handler path
- permission level
- any additional static replay-relevant metadata

#### Memory database layer
Source of truth for learned behavior:
- exact successful user query text
- normalized query
- query fingerprint
- context fingerprint
- success count
- replay row payload
- provenance and replay history

This separation is mandatory.

Not allowed:
- using the DB as the primary source of panel contract requirements
- duplicating manifest knowledge in replay code for each panel

Allowed:
- using the registry to define how a panel-family row should be interpreted and validated
- using the DB to store which exact user queries succeeded for that panel

## Panel-Family Contract

For replay purposes, only successful **panel-open** outcomes should converge on one family:
- `open_panel`

Manifest presence is necessary but not sufficient. A panel is replay-safe under this addendum only when the live resolver actually produces a successful drawer-open outcome.

This addendum applies only to successful outcomes that execute as:
- `action: 'open_panel_drawer'`

It does **not** automatically apply to all panel manifest intents.

Examples excluded from generic `open_panel` replay by default:
- `open_recent_item`
- `clear_recent`
- any panel write/mutate intent
- any panel intent that does not execute as a successful drawer-open action

Required replay fields remain:
- `panelId`
- `panelTitle`

Execution remains generic:
- replay reconstructs `navigationReplayAction: { type: 'open_panel', panelId, panelTitle }`
- panel execution still routes through the normal validated execution path

## Expansion Rules

### 1. Every replay-safe built-in panel must have a manifest
A built-in panel is in coverage only if:
1. it has a manifest file
2. the manifest is registered into `panelRegistry`
3. the manifest has at least one open/show intent that resolves to panel-open behavior

### 2. Manifest examples should carry user-facing aliases
Examples must cover the phrases users actually use.

Examples:
- `open widget manager`
- `show widget manager`
- `open recent`
- `show recent items`
- `open links panel b`

This is not for B1 replay itself; it is for reliable first-turn resolution and generic family coverage.

### 3. Registry identity must be stable
`panelId` must be the stable replay identity.

Allowed:
- user-facing title changes as display metadata
- alias expansion in examples

Not allowed:
- replay keying off titles alone when a stable `panelId` exists

### 4. Panel-family replay code must remain manifest-agnostic
The replay path must not branch on panel names like:
- `recent`
- `widget manager`
- `links panel`

It should only consume:
- `open_panel`
- `panelId`
- `panelTitle`

If a new built-in panel fits the `open_panel` execution contract, it should not require replay-code changes.

### 5. Drawer-open resolution must consult the registry contract
Manifest + registration alone are not enough unless the successful panel-open resolver path also uses the registry-backed contract.

Required wiring rule:
- `resolveDrawerPanelTarget()` or the equivalent open-panel target resolver must consult registry-backed aliases/metadata for built-in panel discovery and matching

Visibility/openability rule:
- for this rollout, drawer-open matching must operate over the set of registry-backed built-ins that are actually openable in the current product surface, not merely all registered manifests in the abstract
- prompt visibility filtering and live openability must not be conflated; the resolver must use the live openable target set for successful `open_panel_drawer` resolution

Not allowed:
- assuming manifest presence automatically gives panel-open replay coverage when the drawer-open resolver still depends on separate hardcoded heuristics
- treating all registered manifests as equally openable regardless of live surface availability

## What Must Be Expanded

### A. Manifest coverage audit
Audit all default built-in dashboard panels in scope for this phase and classify each as:
- manifest present and registered
- manifest present but incomplete
- missing manifest
- intentionally excluded from replay-safe panel family

Initial audit targets:
- `recent`
- `widget-manager`
- `navigator`
- `quick-capture`
- `continue`
- `links-overview`
- `quick-links-*`

### B. Manifest completeness audit
For each built-in panel manifest, verify:
1. open/show examples exist
2. user-facing aliases are present
3. panel title is stable and suitable for surfaced replay messages
4. handler semantics still correspond to panel-open behavior
5. permission level is correct

### C. Resolver wiring audit
Verify the registry-backed contract is actually consulted by:
1. prompt building
2. panel-intent resolution
3. fallback panel matching
4. drawer-open target resolution / alias matching
5. replay-safe panel identity

### D. Replay coverage audit
For each manifest-backed replay-safe panel, verify:
1. successful open resolves to `open_panel_drawer` or equivalent panel-open success path
2. pending write is emitted as `open_panel`
3. later exact repeat becomes eligible for `Memory-Exact`

## Implementation Plan

### Phase 1. Registry inventory
Build a coverage table:
- panelId
- title
- manifest file
- registered in `panelRegistry`
- open/show examples present
- expected execution family
- replay-safe status

### Phase 2. Manifest expansion
For each built-in panel missing coverage:
1. add or complete the manifest file
2. add realistic open/show aliases
3. register it in `panelRegistry`

### Phase 3. Resolver wiring verification
Confirm that registry-backed metadata actually influences drawer-open resolution.

Prove that these all resolve through the intended panel-open path without bespoke replay logic:
- `open recent`
- `open widget manager`
- `open links panel b`

### Phase 4. Generic open_panel wiring verification
Confirm generic panel-family replay does not care which panel it is.

Expected writeback payload shape:
- `intent_id: open_panel`
- `slots_json.action_type: open_panel`
- `slots_json.panelId`
- `slots_json.panelTitle`

### Phase 5. Coverage validation
Run panel-family validation against registered built-ins.

Minimum target set:
- `open recent`
- `open widget manager`
- `open navigator`
- `open links panel b`

For each:
1. first successful turn works
2. pending write emitted
3. later exact repeat can become `Memory-Exact`

### Phase 6. Exclusions
Explicitly document built-ins that should not be treated as generic replay-safe panel opens.

Examples of possible exclusions:
- panels whose “open” path is actually a state-info path
- panels whose effect is non-deterministic or unsafe to replay blindly
- write/mutate panel intents

## File-Level Plan

### Existing files to audit or extend
- [panel-registry.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/panel-registry.ts)
- [panel-manifest.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/panel-manifest.ts)
- [recent-panel.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/manifests/recent-panel.ts)
- [widget-manager-panel.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/manifests/widget-manager-panel.ts)
- [navigator-panel.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/manifests/navigator-panel.ts)
- [link-notes-panel.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/manifests/link-notes-panel.ts)
- [links-overview-panel.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/manifests/links-overview-panel.ts)
- [quick-capture-panel.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/manifests/quick-capture-panel.ts)
- [continue-panel.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/manifests/continue-panel.ts)
- [intent-resolver.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/chat/intent-resolver.ts)
- [navigate/route.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/app/api/chat/navigate/route.ts)

### Memory/replay files that should stay generic
- [memory-write-payload.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/chat/routing-log/memory-write-payload.ts)
- [memory-action-builder.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/chat/routing-log/memory-action-builder.ts)
- [memory-validator.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/chat/routing-log/memory-validator.ts)

Rule:
- prefer manifest/registry expansion over adding panel-specific branches to these replay files

## Tests

### Automated tests
1. Manifest coverage test for built-in replay-safe panels
- registry contains expected built-ins
- required open/show examples exist

2. Resolver wiring tests
- `open recent`
- `open widget manager`
- `open navigator`
- `open links panel b`
- each resolves through the expected `open_panel_drawer` path

3. Replay coverage tests
- successful `open_panel_drawer` emits `open_panel` writeback payload
- later exact repeat is eligible for `Memory-Exact`

4. Exclusion tests
- non-open panel intents do not get generic `open_panel` replay treatment by accident

### Manual smoke tests
1. `open recent`
2. `open recent widgets`
3. `open widget manager`
4. `open navigator`
5. `open links panel b`

For each:
- first success works
- repeat eventually becomes `Memory-Exact` if replay-safe

## Acceptance Criteria

This addendum is complete when:
1. all replay-safe built-in dashboard panels in scope for this phase have manifests and registry coverage
2. drawer-open resolution is proven to consult registry-backed aliases/metadata
3. panel-family replay remains generic and does not branch per panel name
4. successful exact repeats of replay-safe panel-open commands can become `Memory-Exact`
5. new built-in panels can join generic panel replay by adding a manifest and registration **plus resolver adoption of that contract**, not by changing replay logic
6. exclusions are explicit rather than accidental

## Decision

Use the existing universal panel registry as the static contract layer.

Do not replace the replay database.

Final model:
- **manifest file = static capabilities**
- **registry = central discovery**
- **database = learned successful exact queries**
