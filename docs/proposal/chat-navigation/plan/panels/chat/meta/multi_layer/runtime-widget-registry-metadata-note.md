# Runtime Widget Registry Metadata Note

## Purpose

This note captures metadata and registry ideas for later implementation work.

It is not a new routing authority. It is a supporting implementation note for the
state-info/runtime-registry direction already described in:

- `known-noun-policy-contract-plan.md`
- `state-info-runtime-registry-addendum.md`

## Core Direction

The system should move toward one authoritative runtime widget registry for current
widget/panel state.

That registry should be the consumer-facing source for:

- deterministic state-info answers
- routing/runtime validation
- LLM context about current widget/panel state

Widgets should register runtime state when they are opened, activated, focused,
surfaced, or otherwise become relevant to the current interaction.

## Seed Metadata

Current semantic seeds already carry useful structured fields such as:

- `family_id`
- `target_kind`

Those fields are valuable because they let the system represent:

- family-level requests
- specific-instance requests

### Recommended meaning

- `family_id`
  - identifies the widget/panel family
  - example: `navigator`, `quick-links`

- `target_kind`
  - `family` = generic family request; runtime must inspect live siblings before execute
  - `instance` = specific instance request; runtime should resolve one exact target

These structured fields should remain primary. They are better than freeform prose for
execution logic.

## Optional LLM-Support Metadata

If more LLM-facing clarity is needed, add compact structured support fields rather than
long explanations per row.

Possible fields:

- `duplicate_capable`
- `surface_type`
- `entry_id`
- `dashboard_id`
- `workspace_id`
- `instance_label`

These help the system and LLM understand:

- whether a noun may have multiple live instances
- which surface context owns the instance
- whether the target is a family or an exact instance

## Optional Documentation Reference

An additional optional field may point to authoritative product documentation for a
widget family or manifest.

Examples:

- `doc_ref`
- `manifest_ref`
- `help_ref`

This field should be secondary only.

Recommended use:

- structured metadata remains the execution authority
- `doc_ref` helps the LLM interpret widget-specific semantics when needed
- the reference should point to one stable authoritative section, not arbitrary prose

## Registry Shape

The runtime widget registry should have:

### Common shared fields

- `widget_id`
- `family_id`
- `instance_id`
- `instance_label`
- `title`
- `surface_type`
- `entry_id`
- `dashboard_id`
- `workspace_id`
- `duplicate_capable`
- `open`
- `active` if admitted later
- `updated_at`

### Widget-type-specific manifest

Each widget type may attach bounded temporary/runtime state that matches that widget.

Examples:

- `recent`
  - selected item
  - current mode
  - item count
- `links panel`
  - selected entry
  - current view
  - visible entry count
- `navigator`
  - current node
  - expanded groups
  - selected destination

Generic routing/state-info should prefer the common fields unless a query explicitly
requires widget-specific state.

## Surface Identity

Surface identity matters at runtime even when it does not belong in the semantic seed
itself.

The seed can stay global:

- `family_id`
- `target_kind`

But runtime resolution should know the current surface:

- `entry_id`
- `dashboard_id`
- `workspace_id`

This prevents family resolution or state answers from drifting across unrelated
dashboard/workspace surfaces.

## Recommended Implementation Rule

Avoid having resolver branches read many unrelated raw sources directly.

Preferred model:

1. existing app/runtime producers feed one normalized per-turn registry
2. deterministic state-info reads that registry
3. routing reads that registry
4. LLM context reads that registry

This keeps one source of truth for current widget/panel state.

## Non-Goal

This note does not define:

- final database schema
- final registry persistence strategy
- final widget manifest format

It is only a design note for later implementation alignment.
