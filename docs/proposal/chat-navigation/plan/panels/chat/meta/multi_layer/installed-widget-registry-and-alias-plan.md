# Installed Widget Registry And Alias Plan

## Purpose

Define a routing model where widget/panel noun handling comes from live dashboard-installed widget metadata plus user-language aliases, not from hardcoded noun tables.

This plan is separate from the rename-proof live-resolution plan.

However, the two plans share one prerequisite:

- this plan's Phase 1 must reuse the same late-bound live label helper and single live object view introduced by [rename-proof-live-resolution-plan.md](/Users/dandy/Downloads/annotation_project/annotation-backup/docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/rename-proof-live-resolution-plan.md)
- do not implement two parallel "Phase 1" registry/label layers

It focuses on:

- installed-widget instance identity
- dashboard-scoped noun vocabulary
- user alias handling
- removal of hardcoded known-noun widget entries

## Problem

The current implementation still depends on hardcoded known-noun entries for widget/panel routing, for example in:

- [known-noun-routing.ts](/Users/dandy/Downloads/annotation_project/annotation-backup/lib/chat/known-noun-routing.ts)

That causes several architectural problems:

- newly created widget instances are not first-class routing nouns unless separately hardcoded or seeded
- user language is constrained to developer vocabulary
- duplicate-capable families are represented inconsistently across hardcoded maps, seeds, and live widget state
- runtime routing can drift from actual dashboard-installed widget state

This is especially weak in a serious app where users may refer to widgets by:

- current title
- shorthand
- nickname
- learned alias

## Core Principle

For widget/panel routing:

- installed widget instances are runtime data
- user aliases are runtime data
- hardcoded widget noun maps are not the source of truth

## Goal State

The target routing model has three layers:

1. Installed widget registry
2. Alias memory
3. Live resolution gate

This target model also has two distinct runtime truth layers:

- persistent installed-widget catalog
- transient runtime overlay for the current turn

These are not the same thing and must not be collapsed.

### 1. Installed Widget Registry

Implementation note:

- "installed widget registry" means a normalized installed-widget view over existing `workspace_panels` data plus the current dashboard panel fetch
- it is not a new persistent store by default
- do not introduce a second cache/registry path when the existing dashboard snapshot path can be extended

Persistent catalog of installed widget instances for the active dashboard/workspace.

Minimum fields:

- `panel_id`
- `workspace_id`
- `panel_type`
- `title`
- `duplicate_family`
- `instance_label`
- `is_visible`
- `deleted_at`
- `updated_at`

Nullability rule:

- `duplicate_family` and `instance_label` are nullable
- singleton widgets commonly have both fields null
- registry readers must support both:
  - family/instance-aware duplicate-capable widgets
  - singleton widgets with no family selector metadata

Optional derived/display fields:

- `dashboard_id` if the UI keeps a distinct dashboard identifier

Primary scope rule:

- `workspace_id` is the primary scope key for routing authority
- if the UI has a separate `dashboard_id`, it is derived/secondary and must not replace `workspace_id` as the authoritative routing scope key

This matches the current codebase more closely, where installed panel resolution and duplicate-family queries are primarily workspace-scoped.

### 1b. Access Path Choice

Phase 1 chooses client snapshot enrichment, not a new per-turn server-side registry query.

Concrete rule:

- extend the existing dashboard panel fetch / local panel state to expose an installed-widget view for the active workspace
- extend the existing per-turn snapshot path to capture:
  - installed-widget view
  - runtime overlay
  - current freshness metadata
- do not add a new chat-routing DB round-trip per turn in Phase 1 or Phase 2

Implementation anchors:

- `components/dashboard/DashboardView.tsx` remains the source of published dashboard widget context
- `lib/chat/ui-snapshot-builder.ts` remains the per-turn snapshot assembler
- `lib/widgets/ui-snapshot-registry.ts` remains the transient open/active widget source

### 1c. Shared Installed-Widget Contract

Phase 1 must name one concrete runtime contract and publish it in one canonical shape.

Canonical runtime shape:

- `panelId`
- `workspaceId`
- `panelType`
- `title`
- `duplicateFamily`
- `instanceLabel`
- `isVisible`
- `deletedAt`
- `updatedAt`

Runtime publication points:

- `uiContext.dashboard.installedWidgets`
- `uiContext.dashboard.installedWidgetFreshness`
- `TurnSnapshotResult.installedWidgets`
- `TurnSnapshotResult.installedWidgetFreshness`

Required rule:

- Phase 1/Phase 2 widget noun consumers must read this canonical runtime shape
- do not let one caller read `workspace_panels` columns directly while another reads a differently-shaped client projection
- persistence-layer snake_case may remain in storage, but the published routing contract must pick one canonical naming convention and keep every consumer on it

Server-side migration rule:

- any legacy server resolver path that still handles widget nouns must accept and consume the same published installed-widget contract when it is present in request context
- if the shared contract is absent or stale, that server path must stand down to safe fallback for widget-noun auto-routing rather than inventing a second authority path from raw ad hoc `workspace_panels` reads
- execution-time revalidation against live DB remains allowed and required for the final chosen `panel_id`; this rule only prohibits a second competing noun-resolution contract

Anti-pattern compliance:

- reuse the existing snapshot path instead of building a parallel provider/consumer contract
- keep one stable subscription and extend the captured object, rather than adding a second live routing feed

### 1a. Runtime Overlay

Transient per-turn state layered on top of the installed-widget registry.

Minimum overlay fields:

- `isOpen`
- `isActive`
- `isFocused`
- `isPresentInVisibleWidgets`
- `openDrawerPanelId`

The installed-widget registry is authoritative for:

- what widget instances exist on the active dashboard
- what their current canonical titles are
- duplicate-family and instance-label identity

The runtime overlay is authoritative for:

- what is currently visible on this turn
- what is currently open/active/focused
- whether the current routing turn has enough live evidence to execute

The live resolution gate must read both layers.

Freshness rule:

- the installed-widget view is only trustworthy if the underlying dashboard panel state is fresh
- the dashboard client must refetch or invalidate on create / rename / delete / show / hide
- the per-turn snapshot must carry a lightweight freshness signal (for example max `updated_at` or a revision token)
- if freshness cannot be established, routing must degrade to safe clarification/fallback rather than pretending the installed-widget view is current
- stale installed-widget view must block automatic widget execution from:
  - aliases
  - seeds
  - learned rows
  - normalized/fuzzy widget-noun recovery

### 2. Alias Memory

User-language layer that maps natural phrases to installed widget instances or families.

Examples:

- `stuff` -> `Recent`
- `my links` -> quick-links family
- `the manager` -> `Widget Manager`

Alias entries must be dashboard- or workspace-scoped unless explicitly global by product rule.

Minimum fields:

- `alias_text`
- `normalized_alias_text`
- `namespace`
- `workspace_id`
- `panel_id` or `family_id`
- `source` (`explicit`, `learned`, `imported`)
- `routing_status`
- `confidence`
- `updated_at`

Important rule:

- alias memory proposes candidates
- alias memory does not execute directly
- every alias result must still resolve against the installed-widget registry plus runtime overlay

### Alias Collision Safety

Alias handling must import the collision rule from the known-noun policy contract.

If two or more live widgets/families claim the same alias:

- automatic routing must not silently pick one
- the system must clarify safely or reject automatic alias coverage for that alias
- only non-colliding aliases may auto-route by default

Built-in versus third-party origin is not enough to break ties safely.

### Title / Alias Precedence

Collision handling must also define precedence between:

- exact current widget title
- explicit alias
- learned alias

Safe default rule:

- one live exact-title match and no competing exact-title match -> exact title wins
- two or more live exact-title matches -> clarify
- if a live exact-title match collides with one or more alias matches for different targets:
  - exact title wins for automatic routing
  - the colliding alias text is not eligible for silent auto-routing to the other target
  - if product later rejects title precedence for a specific surface, clarify instead

This makes precedence reviewable instead of ad hoc.

### Alias Storage Decision

Phase 3 uses a dedicated alias table, not `slots_json` inside `chat_routing_memory_index`.

Minimum shape:

- `alias_text`
- `normalized_alias_text`
- `namespace`
- `workspace_id`
- `panel_id` nullable
- `family_id` nullable
- `source`
- `routing_status`
- `confidence`
- `is_deleted`
- `created_at`
- `updated_at`

Rationale:

- alias collision checks must be cheap and indexable
- alias writes/lifecycle are not the same thing as semantic memory rows
- overloading `slots_json` would make collision enforcement and lifecycle rules harder to verify

State rules:

- `namespace` defaults to `widget_noun` for this plan's routing scope
- `routing_status` is explicit and reviewable:
  - `active`
  - `blocked_collision`
  - `disabled`
- transition rules:
  - `active` -> `blocked_collision` when the same `(workspace_id, namespace, normalized_alias_text)` resolves to multiple distinct live identities
  - `blocked_collision` -> `active` only after one unique live identity remains and the alias still passes precedence and live-resolution rules
  - `active` or `blocked_collision` -> `disabled` only by explicit user/product action or lifecycle policy
  - `disabled` aliases do not auto-route and do not become `active` again without an explicit re-enable/review step

Indexing rule:

- active aliases must be unique on `(workspace_id, namespace, normalized_alias_text)` where `routing_status = 'active'` and `is_deleted = false`
- colliding alias records may still be stored for telemetry/review, but they must be marked `blocked_collision` and excluded from auto-routing

Identity rule:

- aliases are identity-bound to `panel_id` or `family_id`
- display labels are always late-bound from the installed-widget view
- rename does not require alias cleanup if the identity binding remains valid

Write-safety rule:

- active aliases must be unique on `(workspace_id, namespace, normalized_alias_text)` within the auto-routable namespace
- learned writes must use atomic upsert semantics against that unique key
- concurrent learned writes for the same alias may update only if they target the same identity or the precedence rule explicitly allows replacement
- if two competing learned writes target different identities and neither has stronger precedence, the alias must not become auto-routable until clarified/reviewed

Input hardening rule:

- cap `alias_text` and `normalized_alias_text` to a reviewed maximum length before storage/indexing
- reject empty alias text after normalization
- log length-based rejection so abusive or accidental oversized aliases are observable during rollout

Source precedence rule:

- `explicit` > `imported` > `learned`
- learned writes must never overwrite an active explicit alias
- learned writes must never silently replace an active imported alias unless product rules explicitly permit it
- any write that would downgrade an alias from `explicit` or `imported` to `learned` must be rejected

### 3. Live Resolution Gate

Every candidate from:

- installed title matching
- alias memory
- semantic seeds
- learned rows

must resolve against the current installed-widget registry plus runtime overlay before:

- clarify
- execute
- display target labels

If not resolvable:

- drop candidate
- or clarify safely
- never silently execute

Normative execution rules:

- hidden target -> not executable
- deleted target -> not routable
- multiple live duplicate-family siblings -> clarify, not execute
- non-dashboard / no-active-registry context -> safe fallback, not silent widget execution

### Execution-Time Revalidation

Passing the per-turn gate is necessary but not sufficient for final execution.

Before a widget/panel open action fires on a chosen `panel_id`, execution must revalidate against authoritative current state:

- `deleted_at IS NULL`
- `is_visible = true`
- `workspace_id` still matches the routing scope
- if selector metadata was part of the resolution:
  - `duplicate_family` still matches
  - `instance_label` still matches when required

If execution-time revalidation fails:

- do not execute
- do not show a stale success message
- drop to safe clarification/fallback and refresh candidate/view state

This closes TOCTOU windows such as:

- renamed during another tab's turn
- soft-deleted mid-turn
- moved/retargeted across workspaces

### Installed vs Visible Semantics

The plan must preserve current widget-routing behavior unless a later product decision explicitly broadens it.

Default semantics by query type:

- command execution:
  - candidate must resolve to a current installed widget
  - target must also be present in the runtime overlay as visible/resolvable now
- clarifier options:
  - only resolved visible targets appear
  - hidden/deleted/install-only targets do not appear by default
- duplicate-family ambiguity for execution/clarifier:
  - count current visible siblings only
  - do not widen ambiguity detection to every installed-but-hidden sibling
- current state-info queries:
  - use the runtime overlay/current state path
  - do not silently broaden "what is open/active/visible" into "what is installed"
- install/inventory/help queries:
  - out of scope for this plan unless explicitly added later
  - if added later, they may read the installed-widget view with explicit labeling such as hidden/installed-only

This avoids changing hidden-widget semantics during the noun-routing migration.

### Display Label Fallback

Display labels must never render as empty strings.

Fallback order:

1. non-empty live `title`
2. formatted selector label when available:
   - family + instance label, or
   - instance label alone if that is the only meaningful live identifier
3. formatted `panel_type`
4. `Untitled`

If fallback occurs because live title is null/empty:

- log a `null_title_fallback` event for observability

### State-Info Materialization Invariant

Current state-info behavior includes a materialization invariant:

- if a panel is open or active but absent from the visible widget list, state-info still materializes a minimal runtime entry for answering questions like:
  - `what panels are open?`
  - `is <panel> open?`

This plan must preserve that behavior.

Rules:

- materialized non-visible runtime entries are allowed for state-info answering only
- they are not eligible as noun-execution targets
- they are not eligible as clarifier options unless a later product decision explicitly broadens that scope
- installed-widget registry migration must not regress current open/active state answers for panels missing from `visibleWidgets`

## Why This Is Better Than Hardcoded Known-Noun Routing

Hardcoded widget noun maps are wrong as a target design because:

- they are global, not dashboard-scoped
- they do not represent user-created instances cleanly
- they do not represent user aliases
- they require code changes for vocabulary growth
- they duplicate metadata that already exists in installed widget state

The installed-widget registry plus alias layer solves those problems directly.

## Relationship To Existing Building Blocks

The repo already has part of the required metadata model:

- `duplicate_family`
- `instance_label`
- dashboard/workspace ownership
- visible widget runtime state

That means this is not a greenfield design.

The real work is to promote those building blocks into the authoritative routing source instead of leaving them as partial metadata beside:

- hardcoded known-noun maps
- curated instance seeds
- title-based fallbacks

### Quick Links Legacy Exception

Quick Links currently remains a transitional exception in some resolver paths because it still has a badge-based branch before the generic duplicate-family path.

Migration rule:

- once the shared installed-widget contract exposes `duplicateFamily` and `instanceLabel` consistently, Quick Links must route through the same family/instance selector path as every other duplicate-capable widget family
- `badge` may remain as display/backfill metadata, but it must not remain a separate noun-routing authority
- Phase 2 is not complete while a dedicated badge-first widget noun branch still exists for Quick Links in routing resolution

## Target Rule For Known-Noun Routing

For widget/panel nouns:

- remove the hardcoded widget-instance known-noun table as the target state
- derive noun resolution from installed widget registry + alias memory

This applies to:

- duplicate-capable instances such as `links panel a/e/...`
- singleton widgets such as `recent`, `widget manager`, `navigator`

If a widget exists on the active dashboard, it should be routable because it exists in the registry, not because it appears in a hardcoded table.

## Seeds In The New Model

Seeds remain useful, but their role changes.

Seeds should be:

- retrieval/bootstrap aids
- family-intent hints
- question-shape/state-info hints

Seeds should not be:

- the authoritative vocabulary for installed widgets
- the only way a newly created widget instance becomes routable

So:

- keep seeds for semantic recall
- stop making them the primary noun identity layer

Seed safety rule:

- if a seed matches but no installed-widget view entry resolves on the current workspace, the seed may inform help/clarification only
- a seed without current live resolution must not fabricate a widget candidate or execute

## Alias Policy

The system should support three alias modes:

### 1. Exact title

Direct match to installed widget title.

### 2. Explicit alias

User-created or product-defined alias stored in alias memory.

### 3. Learned alias

Learned from successful accepted usage, but only after stable live resolution.

Example:

- user says `open stuff`
- system clarifies or safely resolves to `Recent`
- after repeated confirmed usage, `stuff` can become a learned alias

Learned-alias write rule:

- only write a learned alias after one current live widget/family was resolved successfully
- only write after successful execution or successful state-info answer
- do not write from weak semantic matches, clarifier appearance alone, or failed execution

Rename lifecycle rule:

- aliases survive rename because they are identity-bound
- rename does not cascade-delete alias rows
- only title-derived display text changes

## Execution Contract

No widget/panel execution should depend on:

- hardcoded known-noun widget vocabulary
- persisted stale title text
- seed text alone

Execution should depend on:

- current installed-widget registry entry
- optional alias match
- successful live resolution against the runtime overlay

Migration consistency rule:

- during Phase 1 and Phase 2, any existing server-side resolver path that still queries `workspace_panels` directly must either:
  - consume the same installed-widget-view contract, or
  - degrade to safe fallback when its answer would conflict with the client-installed-widget view
- do not allow client-side widget noun routing and server-side widget noun routing to diverge silently during migration
- if the dispatcher-installed-widget view and a legacy server resolver disagree on target identity or visibility, auto-execution must not proceed
- Quick Links badge-special resolution is included in this rule; it must be collapsed into the shared family/selector contract, not carried forward as a permanent exception

Hard safety requirements:

- hidden panel rows are never executable
- deleted panel rows are never routable
- ambiguity in duplicate-capable families clarifies rather than executes
- alias-only matches without current live resolution do not execute

## Raw Match Before Normalization

Raw live matching must run before typo/repeated-letter normalization for widget nouns.

Ordering rule:

1. exact title / explicit alias / learned alias match against the current installed-widget view
2. if no raw live match succeeds, then run bounded normalization/fuzzy retrieval aids
3. any normalized/fuzzy candidate must still pass the same live resolution gate

This is required so inputs like `links panel aaa` do not collapse to `links panel a` before the installed-widget view is consulted.

Instance-label matching rule:

- `instanceLabel` matching is case-insensitive for resolution
- display preserves the canonical live `instanceLabel` from the installed-widget view
- normalization may fold case, but it must not rewrite the underlying live selector identity

## Clarifier Contract

Clarifier options should be built from resolved live targets only.

That means:

- labels come from current installed widget titles
- not from raw seed `target_name`
- not from stale learned `panelTitle`

If an alias or seed cannot resolve to a live target on the current dashboard, it should not appear as a clarifier option.

Clarifier safety requirements:

- hidden/deleted targets do not appear in clarifiers
- colliding aliases do not silently collapse into one option
- duplicate-family ambiguity uses current live siblings only

### Clarifier Workspace Binding

Clarifier options for widget/panel targets must carry the workspace scope they were built from.

Selection rule:

- if current routing workspace matches the option workspace, selection may proceed
- if current routing workspace differs from the option workspace, the option is stale for the current turn
- stale cross-workspace options must be dropped and re-clarified rather than silently executed against the current workspace

This applies to:

- panel clarifiers
- alias-backed clarifiers
- seed/learned clarifiers that resolve to widget/panel targets

## Empty-Dashboard / Non-Dashboard Behavior

The plan must define safe behavior when there is no active dashboard widget registry for the current turn.

Minimum safe behavior:

- if the active dashboard has no installed widget for the requested noun/family, do not fabricate a target
- if the user is not on a dashboard-scoped routing surface, do not silently route through widget nouns as if a dashboard were active
- use safe clarification, onboarding/help, or explicit fallback instead of synthetic execution

## Migration Plan

### Phase 1: Registry Read Model

Build a normalized installed-widget registry plus runtime overlay read path using existing metadata.

Goals:

- expose one normalized source for installed widget instances
- expose one normalized runtime overlay for visible/open/active/focused state
- extend the existing dashboard/snapshot pipeline instead of adding a parallel registry path
- make the per-turn snapshot the single captured object read by downstream routing stages
- no routing changes yet beyond diagnostics/instrumentation

### Phase 2: Known-Noun Routing Switch

Replace hardcoded widget-instance noun authority with installed-widget-view resolution at the real shared validation call sites.

Goals:

- `Recent`, `Widget Manager`, `Navigator`, `Links Panel E`, etc. resolve from live installed widgets
- no hardcoded instance noun dependence for widget/panel targets
- preserve current hidden/deleted/duplicate-family safety invariants while switching the noun source

Implementation note:

- there is no standalone Tier 4 `handleKnownNounRouting()` path to replace
- Phase 2 must rework the shared noun-validation / clarification call sites that still depend on `matchKnownNoun()` and related helpers inside `routing-dispatcher.ts`
- initial call sites to migrate include:
  - trailing-question runtime resolve
  - semantic escape resolve from `target_name`
  - post-Stage-5 known-noun resolution
  - clarification-first top-candidate noun resolution

### Phase 3: Alias Layer

Add dashboard-scoped alias memory.

Goals:

- user can refer to installed widgets by natural nickname
- aliases map to live installed widgets, not stale titles
- learned aliases are only written after confirmed live resolution and successful execution/answer

### Phase 4: Seed / Learned Integration

Make seeds and learned rows produce candidates that must pass the same registry-backed live resolution gate.

Goals:

- one routing contract for:
  - titles
  - aliases
  - seeds
  - learned rows

### Phase 5: Remove Hardcoded Widget Noun Map

After registry + alias + resolution gate are stable:

- delete hardcoded widget/panel noun entries from known-noun routing
- keep only non-widget special cases if any remain after review

Target end-state:

- no hardcoded widget noun authority

## Testing Plan

### Installed Widget Registry

- creating a new widget instance makes it routable without code changes
- widget appears in the registry for the active dashboard

### Alias Support

- explicit alias resolves to installed widget
- learned alias resolves only after confirmed live resolution
- alias from another workspace/dashboard does not bleed into the current active scope
- colliding aliases clarify or are rejected from automatic routing

### Duplicate-Capable Families

- `links panel e` resolves because the instance exists in the registry
- no need for hardcoded `e` map entry
- new duplicate instances route through the same family resolution logic
- multiple live siblings clarify rather than execute
- Quick Links no longer depends on a dedicated badge-special noun-resolution branch

### Clarifier Safety

- unresolved alias does not appear as executable clarifier option
- clarifier labels always show live current widget titles
- hidden/deleted targets do not appear

### Hidden / Deleted / Missing Context

- hidden widget -> not executable
- deleted widget -> not routable
- no active dashboard registry -> safe fallback, not widget auto-execution

### State-Info

- `is <alias> open?`
- `what panels are open?`
- `is links panel e open?`

must all use the installed-widget registry as current object truth

This includes the state-info materialization invariant above for open/active-but-not-visible panels.

## Observability

Minimum required telemetry before Phase 2 rollout:

- counter: `installed_widget_lookup_zero_result`
  - dimensions: source (`title`, `alias`, `seed`, `learned`)
- counter: `live_resolution_gate_dropped_candidate`
  - dimensions: source (`title`, `alias`, `seed`, `learned`)
- counter: `alias_collision_detected`
- counter: `alias_collision_blocked`
- counter: `installed_widget_view_stale`
- counter: `installed_widget_resolution_mismatch`
- counter: `execution_time_revalidation_failed`
- counter: `cross_workspace_clarifier_rejected`
- counter: `alias_write_rejected_explicit_precedence`
- counter: `hardcoded_widget_authority_read`
- log event: `alias_write_rejected_no_live_resolution`
- log event: `seed_match_without_live_target`
- log event: `normalization_used_after_raw_live_miss`
- log event: `state_info_materialized_nonvisible_panel`
- log event: `null_title_fallback`

Minimum rollout checks:

- compare successful widget-noun resolution counts before/after Phase 2
- verify no increase in hidden/deleted target execution
- verify no silent execution when alias collision is present
- verify no silent execution when installed-widget view freshness is stale
- verify no client/server target mismatch reaches execution
- verify legacy Quick Links badge-special noun-resolution hits trend to zero as the shared family/selector path takes over

## Additional Edge-Case Tests

- open-but-not-visible panel still appears in state-info answers
- active-but-not-visible panel still appears in state-info answers
- two installed widgets with the same current title clarify instead of auto-routing
- exact current title collision with another widget alias follows the explicit precedence rule
- stale installed-widget view forces safe fallback rather than execution
- client-installed-widget view vs legacy server resolver disagreement does not auto-execute
- panel soft-deleted after snapshot but before execution does not open and does not emit stale success text
- clarifier selection built in workspace A is rejected after switching to workspace B
- concurrent learned writes for the same alias obey unique-key and precedence rules
- learned alias write does not overwrite an existing explicit alias
- null/empty live title falls back to a non-empty display label
- colliding alias rows persist as `blocked_collision` and are excluded from auto-routing

## Open Product Decisions

1. Should aliases be explicit only, or may the system learn them automatically?
2. Should aliases be strictly workspace-scoped, or may some be global by explicit product rule?
3. Should deleted/hidden widgets preserve aliases for a bounded time or drop immediately?
4. For empty dashboards, should onboarding/help use a small static vocabulary for suggestion only, or should all widget nouns fall straight to docs/help with "no widgets installed" guidance?

These product decisions must not weaken the hard execution rules above.

## Recommended Next Step

Do not add more hardcoded widget nouns.

Instead:

1. define the normalized installed-widget registry shape
2. define the runtime overlay shape and primary scope key (`workspace_id`)
3. commit the Phase 1 access path:
   - extend existing dashboard/snapshot publication
   - do not add a new per-turn DB read path in chat routing
4. add raw-live-match-before-normalization as a hard contract
5. switch known-noun widget routing to read from both
6. then add alias memory on top

That is the cleanest path to eliminating hardcoded widget noun dependence while supporting both new widget instances and natural user language.
