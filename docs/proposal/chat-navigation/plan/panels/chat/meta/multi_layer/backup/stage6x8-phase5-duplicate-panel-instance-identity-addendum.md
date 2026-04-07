# Stage 6x.8 Phase 5 Addendum — Generic Duplicate Panel Instance Identity

## Summary

Generalize the working Links Panel badge model into a shared duplicate-instance identity contract for any panel family that allows multiple instances.

This addendum is about **user-addressable duplicate panel identity**, not replay storage itself.
- The memory database already stores learned successful exact queries and replay payloads.
- The missing layer is a generic way for duplicated panel instances to expose stable, user-facing instance identity so first-turn resolution, clarification, and replay eligibility remain consistent.

The existing Links Panel implementation proves the pattern works:
- stable instance token in storage (`badge`)
- per-instance semantic identity (`quick-links-a`, `quick-links-b`, ...)
- prompt rules for explicit instance tokens
- deterministic extraction for explicit instance tokens
- resolver lookup by explicit instance token
- visible UI snapshot support for the same token

The goal of this addendum is to make that pattern reusable for other duplicable panel families, not to keep re-implementing Links-specific logic.

Anti-pattern applicability: **not applicable**. This is routing/replay identity-contract work, not provider/reactivity work.

## Problem

Links Panels already support duplicate-aware commands well because they have a full identity contract.

Other duplicable panel families do not.

Current duplicate behavior for non-Links families is weaker:
- a command like `open navigator` can hit multiple physical panel instances
- the system clarifies with pills, but there is no stable direct-addressing contract like `Links Panel B`
- replay remains generic once a concrete panel is opened, but first-turn targeting and exact user phrasing degrade when the user needs to distinguish duplicates

That creates three product problems:
1. duplicate instances are harder to address directly
2. duplicate handling is inconsistent across panel families
3. the codebase risks growing more family-specific duplicate heuristics instead of one generic identity system

## Current Evidence

The current product already shows both sides of the problem:
- Links Panels work well with explicit duplicate identity such as `Links Panel B`
- duplicated Navigator widgets can produce clarification because the family has multiple physical instances but no equivalent direct-addressing contract

That means the missing layer is not replay storage. The missing layer is a reusable duplicate-instance identity contract that all duplicable built-in panel families can adopt.

## Existing Working Pattern: Links Panels

Links Panels are the reference implementation.

### 1. Persistent instance token in storage
Links panels receive an auto-assigned `badge` on creation.

Relevant code:
- [route.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/app/api/dashboard/panels/route.ts)

### 2. Per-instance semantic chat identity
Manifest generation creates panel IDs like:
- `quick-links-a`
- `quick-links-b`

Relevant code:
- [link-notes-panel.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/panels/manifests/link-notes-panel.ts)

### 3. Prompt contract for explicit instance tokens
The prompt explicitly teaches:
- only use a badge when the user said one
- do not guess an instance token
- clarify when multiple instances exist and the user did not specify one

Relevant code:
- [intent-prompt.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/chat/intent-prompt.ts)

### 4. Deterministic extraction and override
The server can deterministically extract `links panel d` -> `D` and override weak LLM output.

Relevant code:
- [ui-helpers.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/chat/ui-helpers.ts)
- [navigate/route.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/app/api/chat/navigate/route.ts)

### 5. Resolver lookup by instance token
The resolver can query the exact physical panel instance using the explicit badge.

Relevant code:
- [intent-resolver.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/chat/intent-resolver.ts)

### 6. UI snapshot support
Links widgets expose badge-aware data in widget snapshots, enabling downstream routing and selection logic to stay aligned with the visible UI.

Relevant code:
- [QuickLinksWidget.tsx](/Users/dandy/Downloads/annotation_project/annotation-backup/components/dashboard/widgets/QuickLinksWidget.tsx)
- [ui-snapshot-registry.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/widgets/ui-snapshot-registry.ts)

## Goal

Introduce a generic duplicate-instance identity contract for any panel family that supports multiple instances.

Target outcome:
1. a duplicable panel family declares that it supports duplicate instance identity
2. each created duplicate receives a stable instance token
3. the registry/manifest layer exposes that capability uniformly
4. prompts and resolvers treat explicit instance tokens generically, not just for Links Panels
5. if the user specifies an instance token, the resolver targets the exact panel instance
6. if multiple instances exist and the user does not specify one, the system clarifies instead of guessing
7. replay remains generic once a concrete `panelId` is known

## Scope

### In scope for this addendum
- duplicate identity for built-in panel families that can legitimately have multiple instances
- registry/manifest contract changes needed to expose duplicate-instance capability
- creation-time assignment of stable instance tokens
- resolver/prompt/snapshot adoption of that shared contract

### Out of scope for this addendum
- changing how `Memory-Exact` rows are stored
- changing generic `open_panel` replay payload shape
- DB-backed/custom widget manifests unless explicitly brought into scope later
- non-open panel intents

## Compatibility Boundaries

This addendum must preserve the current generic panel-open contract while extending it for duplicate-aware targeting.

Two boundaries are critical:

### 1. `panel_intent` compatibility

Today built-in visible-widget opening assumes `panelId` is the built-in family/type identity such as:
- `navigator`
- `quick-capture`
- `widget-manager`
- `links-overview`

That is sufficient for singleton targeting but insufficient for duplicate-aware direct addressing.

This addendum therefore requires an explicit migration rule:
- keep `panelId` as the family-level identity for built-in panel intents
- add a separate duplicate-aware targeting field or equivalent contract for explicit instance selection
- do **not** overload family `panelId` and physical panel UUID into one ambiguous field

Allowed implementations:
- `instanceLabel`
- physical `panelInstanceId`
- equivalent explicit duplicate-instance selector

Not allowed:
- silently changing `panelId` semantics in a way that breaks existing built-in panel-intent flows

Links compatibility rule:
- existing `quick-links-*` suffixed `panelId` behavior remains a compatibility exception during this phase
- new duplicate-aware families must adopt the generic family-`panelId` plus separate duplicate-selector contract
- Links migration to the same generic selector model is a follow-up cleanup, not an implicit part of this addendum

Reason:
- Links already has working runtime behavior across prompt, resolver, deterministic extraction, and replay
- forcing a simultaneous Links contract migration would couple framework rollout with compatibility churn

### 2. Known-noun routing compatibility

Known-noun routing currently executes deterministic built-in panel opens early for phrases such as:
- `navigator`
- `widget manager`
- `quick capture`
- `links overview`

That early path must not remain duplicate-blind for families that adopt this contract.

Required rule:
- if a family is duplicate-aware and more than one live sibling exists, known-noun routing must either:
  - defer to the shared duplicate-instance resolver, or
  - surface the same clarification policy as the shared duplicate contract

Not allowed:
- deterministic known-noun execution that bypasses duplicate clarification for a family with multiple live siblings

## Core Design

### 1. Split panel identity into three layers

#### A. Family identity
The semantic family name shared by all instances.

Examples:
- `quick-links`
- `navigator`
- `recent`
- `continue`
- `widget-manager`

#### B. Physical panel identity
The concrete stored panel UUID.

This remains the execution/replay target.

#### C. User-facing instance identity
A stable user-visible token that distinguishes duplicates inside one family.

Examples:
- `A`, `B`, `C`
- or another short instance label if the product later chooses a different format

This token is for:
- direct user addressing
- disambiguation
- deterministic parsing
- snapshot labeling

It is **not** the replay target. The replay target remains the concrete `panelId`.

### 2. Generalize the Links-only `badge` concept

Today `badge` is effectively Links-specific.

Generalize to a family-level concept such as:
- `instanceLabel`

Design rule:
- one shared field/contract for duplicate instance identity across duplicable families
- Links Panels can continue using the existing DB `badge` as the underlying source for now
- other families can adopt the same contract without introducing separate ad hoc fields

The migration can be:
1. keep DB column `badge` initially if needed for compatibility
2. expose a generic contract in routing/registry code named around instance identity rather than Links-specific wording

### 3. Duplicable-family declaration in the registry/manifest layer

Each panel family should explicitly declare whether it is:
- singleton
- duplicable with stable instance identity
- duplicate-aware open-drawer family
- non-open-drawer family with separate routing semantics

Required manifest/registry metadata for duplicable families:
- family semantic ID
- title/base title
- duplicate identity support enabled
- instance token format rules
- optional explicit token examples
- parsing/disambiguation policy

This prevents routing code from guessing which families support duplicate addressing.

Family classification rule:
- only families with a real panel-open path should adopt the generic duplicate-instance contract in this phase
- families centered on non-open intents need explicit classification before inclusion

### 4. Creation-time instance token assignment

When a duplicable panel is created or duplicated:
- assign the next available stable instance token within the workspace/dashboard scope
- preserve it as part of panel metadata

The current Links-only assignment logic in:
- [route.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/app/api/dashboard/panels/route.ts)
should be generalized into shared instance-token assignment logic.

Safety rules:
- token uniqueness must be enforced within the same workspace/dashboard scope
- token assignment must be stable across reloads and later replays
- titles remain display metadata and must not become the primary duplicate identity key

### 5. Prompt-level generic duplicate policy

Prompt rules should become generic:
- if user explicitly says an instance token, keep it
- if user does not specify a token and multiple instances exist, clarify
- do not infer or guess an instance token silently

This should no longer be limited to Quick Links.

Compatibility rule:
- prompt examples for duplicate-aware built-ins must preserve family `panelId` semantics and carry the duplicate selector separately

### 6. Deterministic parser support for explicit instance tokens

Links currently have deterministic token extraction.

Generalize that to:
- family-aware instance-token extraction
- using registry-backed duplicate identity metadata

Design rule:
- deterministic extraction should be family-generic
- family-specific regex/parsing should come from one shared contract or helper layer, not per-family routing branches scattered through the codebase

### 7. Resolver behavior

For duplicable families:
1. explicit token present
   - resolve exact instance
2. no token + one instance exists
   - resolve directly
3. no token + multiple instances exist
   - clarify
4. explicit token does not exist
   - clear error

This is the correct generalized form of the current Links behavior.

Resolver adoption rule:
- the resolver must accept duplicate-aware targeting from both:
  - LLM/panel-intent flows
  - deterministic known-noun/open-panel flows

Duplicate handling must converge on one shared policy rather than two separate behaviors.

### 8. UI snapshot alignment

Visible widget/panel snapshots should expose duplicate-instance identity in a generic way.

Required snapshot metadata for duplicable families:
- family ID
- concrete panel ID
- instance token / label
- whether the token is visibly rendered

This keeps:
- grounding
- selection
- disambiguation
- visible-surface matching
aligned with what the user can actually see.

## Adoption Strategy

Do not force every built-in panel family into duplicate-instance identity at once.

Adopt by family capability:
1. families that are already proven duplicable in product UX
2. families where duplicate clarification already appears at runtime
3. families where stable duplicate identity improves direct user addressing

Initial likely adopters:
- `quick-links`
- `navigator`

Conditional adopters only if product UX allows multiple instances intentionally:
- `continue`
- `widget-manager`
- `quick-capture`

Families requiring explicit classification before adoption:
- `recent`
  - current manifest shape is centered on `list_recent`, `open_recent_item`, and `clear_recent`
  - it is not a clean `open_drawer` family in the same way as `navigator` or `widget-manager`
  - it must not be enrolled automatically without an explicit open-path decision

Non-goal:
- invent duplicate identity for families that are intended to remain singleton

## Required Contract Changes

### A. Shared duplicate-instance identity type
Define one shared routing-facing concept equivalent to:
- family ID
- panel ID
- instance label/token
- display title
- token visibility

### B. Registry/manifest capability declaration
Add manifest-level metadata for:
- duplicable vs singleton
- instance-token support
- base family title
- direct-addressing examples

### C. Shared assignment policy
Extract Links-only creation logic into a generic allocator for duplicate instance tokens.

### D. Shared parser / extractor
Provide a generic instance-token extraction helper rather than Links-only extraction.

### E. Shared resolver matching policy
Resolver should consult the same family metadata to decide:
- exact direct instance lookup
- clarification on sibling duplicates
- invalid token handling

## Implementation Plan

### Phase 1. Inventory duplicable families
Build a table covering built-in panel families:
- family ID
- singleton vs duplicable
- open-drawer vs non-open-drawer
- current duplicate behavior
- current instance token behavior
- visible snapshot support
- prompt support
- resolver lookup support
- known-noun routing behavior

Initial audit targets:
- `quick-links`
- `navigator`
- `recent`
- `continue`
- `widget-manager`
- `quick-capture`
- any other built-in family allowed to be duplicated in product UX

### Phase 2. Define the generic duplicate-instance contract
Add a design-level shared contract for duplicable panel identity.

Deliverables:
- family metadata shape
- instance token semantics
- replay boundary rules
- clarification policy
- duplicate-aware `panel_intent` targeting contract
- known-noun adoption rule
- explicit Links compatibility exception for this phase

### Phase 3. Generalize creation-time assignment
Refactor current Links-only token assignment into a shared allocator.

Requirements:
- preserve existing Links behavior
- support future duplicable families without per-family branching in route handlers
- allow families that remain singleton to opt out cleanly
- enforce workspace/dashboard-scoped uniqueness for assigned instance tokens

### Phase 4. Generalize prompt rules
Replace Links-only badge rules with generic duplicate-instance identity rules plus family-specific examples generated from registry data.

Requirements:
- preserve existing built-in `panelId` family semantics
- carry duplicate-aware targeting separately from family identity

### Phase 5. Generalize deterministic extraction and resolver lookup
Move from Links-specific extraction and lookup toward registry-backed duplicate-instance resolution.

Requirements:
- explicit token -> exact instance
- no token + multiple instances -> clarify
- no token + one instance -> open
- invalid token -> explicit error
- known-noun routing and resolver flows must converge on the same duplicate-instance policy
- duplicate-aware targeting must work without breaking existing singleton built-in commands

### Phase 6. Snapshot alignment
Ensure visible widget snapshots expose duplicate-instance identity consistently for duplicable families.

### Phase 7. Replay verification
Verify that duplicate-instance targeting does not change the generic replay contract:
- successful open still writes `open_panel`
- row still stores concrete `panelId` and `panelTitle`
- duplicate instance token only affects first-turn targeting and clarification

## Test Plan

### 1. Creation and allocation tests
- duplicating a Links Panel still assigns the next label correctly
- duplicating another duplicable family assigns the next label correctly
- singleton families do not receive duplicate instance tokens

### 2. Prompt and extraction tests
- explicit instance token is preserved
- missing token with multiple siblings does not get guessed
- invalid explicit token produces a clear miss path
- duplicate-aware `panel_intent` keeps family `panelId` stable while carrying duplicate selector separately
- Links compatibility path remains functional while new families use the generic selector contract

### 3. Resolver tests
For duplicable families:
- single instance -> direct open
- multiple instances + no token -> clarification
- multiple instances + explicit token -> exact open
- explicit token must never be silently invented when the user did not provide one
- known-noun routing reaches the same duplicate policy for duplicate-aware families

### 4. Snapshot tests
- duplicable visible widgets expose instance token metadata consistently
- routing can align visible labels with resolver addressing

### 5. Replay invariants
- successful duplicate-instance panel open still emits generic `open_panel` writeback
- `Memory-Exact` still replays by concrete `panelId`
- duplicate token is not required during replay once the row exists

## Acceptance Criteria

1. duplicate instance identity is expressed as a generic contract, not Links-only routing logic
2. at least one non-Links duplicable built-in family can use the same identity model without custom replay logic
3. prompt, parser, resolver, and visible snapshot layers all use the same duplicate-instance contract
4. when multiple siblings exist, the system clarifies unless the user explicitly specifies the instance token
5. successful exact repeats still resolve through the existing generic `open_panel` replay contract
6. no family-specific replay branching is added for duplicate handling
7. instance labels are unique within the intended workspace/dashboard scope and remain stable after creation
8. duplicate-aware targeting does not break the existing built-in `panelId` family contract
9. known-noun routing and resolver/LLM flows follow the same duplicate-instance policy for adopted families
10. Links Panels remain functional as a documented compatibility exception during this phase

## Expected Outcome

After this addendum is implemented:
- Links Panels keep working as they do now
- other duplicable widget/panel families can adopt the same duplicate-instance identity model
- duplicate handling becomes consistent across families
- first-turn targeting becomes cleaner
- replay remains generic and does not require new per-family memory logic
