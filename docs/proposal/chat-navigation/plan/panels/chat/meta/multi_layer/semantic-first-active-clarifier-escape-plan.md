# Semantic-First Active-Clarifier Command Routing Plan

## Purpose

Define an implementation plan for active-clarifier turns where the user is not actually answering the clarifier and instead issues a noisy or alternate navigation request such as:

- `open recent`
- `openn recent`
- `open recnet`
- `pls open recent widget`
- `open links panel b`
- `open widget manager`

This plan changes the active-clarifier command-routing model from competing surface/known-command lanes to a generic bounded retrieval model that reuses:

- B1 exact memory
- semantic seeded/learned rows

The goal is to support many command families through one architecture rather than handling each family with its own competing router.

## Core Decision

When clarification is active:

- reuse the existing B1 + semantic retrieval approach
- make semantic retrieval the primary fuzzy/typo/paraphrase lane
- keep B1 as the strongest exact-memory lane
- do not include surface as a competing active-clarifier escape lane
- do not include known-command / known-noun as separate competing winner lanes

Outside clarification:

- keep the existing no-clarifier routing flow unchanged
- surface may still execute directly there

## Why This Change

The current surface-led active-clarifier behavior is less reliable for portable navigation turns because it is tied to current runtime surface state:

- current dashboard
- visible widgets
- surface manifest visibility
- surface-family heuristics

The learned/seeded semantic approach is more reliable for this class of turn because it carries bounded stored metadata:

- learned rows from prior successful actions
- curated seeded rows
- query-to-target patterns
- target IDs
- slots
- labels
- retrieval score / ranking metadata

That makes semantic retrieval the better primary lane for:

- typo/noise
- paraphrases
- cross-dashboard continuity
- turns where visible surface state is not the best primary signal
- broader command-family coverage without family-specific routers

## Latest Runtime Observations

Recent runtime checks should be treated as design input for this plan:

- `can you please open the recent widget` during active clarification executed with `Bounded-Selection`
- `hi there. i want you to open the recent widget` during active clarification executed with `Bounded-Selection`
- `hmm can you open the recent widget?` during active clarification executed functionally, but still showed `Auto-Executed`

What this means:

- active-clarifier `recent widget` turns are no longer behaving like obvious direct surface-only executions
- natural-language/noisy phrasing can already reach the bounded path in at least some cases
- the remaining inconsistency is now more about source/provenance certainty than about basic user-facing success

This plan should therefore avoid assuming that active-clarifier command turns should be owned by family-specific routers.
Instead, it should steer implementation toward one bounded model where:

- B1 exact-memory candidates
- semantic seeded/learned candidates
- product validation/guards

work together across command families, and any remaining `Auto-Executed` result is treated as a provenance or source-selection gap to eliminate.

## Active-Clarifier Contract

When clarification is active, upstream lanes do not execute directly. They contribute bounded candidates only.

The bounded arbiter remains the sole decision point.

The active-clarifier candidate set should be:

1. Active clarifier options
2. B1 exact replay candidates
3. Learned/seeded semantic candidates
4. Active widget/panel context as secondary evidence only

Explicitly excluded from the active-clarifier candidate set:

- surface escape candidates
- known-noun as a separate winner lane

## No-Clarifier Contract

This plan does not change the no-clarifier routing ladder.

Outside active clarification, existing routing remains intact, including:

- deterministic surface execution
- known-command / known-noun current direct behavior
- exact replay / exact memory
- semantic retrieval / bounded LLM / clarifier fallback

This proposal only changes the active-clarifier protected path.
It does not attempt to redesign the entire no-clarifier routing ladder in this slice.

## Intended Flow

1. Detect live clarification using the existing protected condition.
   - include paused/recoverable clarification state such as `clarificationSnapshot`

2. Do not allow surface resolver output to become active-clarifier escape evidence.
   - if clarification is live, surface may still run for diagnostics if needed
   - but it must not contribute bounded escape candidates

3. Do not allow known-command / known-noun to remain separate winner lanes.
   - their product rules must survive
   - but they should no longer compete as independent routing winners

4. Reuse the existing semantic retrieval path already approved for bounded hinting.
   - use the learned/seeded semantic lookup path
   - keep semantic rows hint-only
   - do not grant direct execution authority

5. Assemble one bounded arbiter input from:
   - active clarifier options
   - B1 exact replay candidates
   - semantic learned/seeded candidates
   - secondary active widget/panel context

6. Apply shared pre-arbiter validation/filtering.
   - remove or demote candidates that fail hard product checks before they reach the arbiter
   - examples:
     - duplicate-family ambiguity
     - target not visible / not available
     - question-shaped / docs-open guard
     - stale or current-state-incompatible targets

7. Run the bounded arbiter over that closed set.
   - selected clarifier option
   - selected escape candidate
   - unresolved -> clarify again

8. Execute only after selection.
   - if a semantic candidate is selected, preserve the concrete selected target/action payload through execution
   - run final post-selection validation before execution for checks that must be verified against the exact chosen target
   - if final validation fails, reject or clarify rather than executing
   - execution provenance must stay bounded

## Routing Priority Rule

For active clarification:

- semantic learned/seeded candidates are the primary fuzzy lane across command families
- B1 exact replay remains the strongest exact candidate lane
- surface is not part of the active-clarifier escape competition
- known-command / known-noun are not separate competing lanes

This means:

- typo/noise cases such as `openn recent` should resolve through semantic retrieval when a live clarifier is present, not through surface or known-command lanes
- exact active-clarifier command families must not depend on surface as the owner lane
- those exact active-clarifier commands should be satisfied by:
  - semantic seeds/hints, or
  - a stronger exact B1 candidate when one exists

## Known-Noun Migration Rule

This plan removes `known-command` / `known-noun` as separate routing or escape lanes.

That does **not** mean dropping the product rules currently enforced there.

Any hard policy/validation logic currently implemented in the known-noun path must be preserved and migrated into:

- thin deterministic/product guards, or
- shared candidate validation applied to B1 and semantic candidates before execution

Examples of logic that must survive the lane removal:

- duplicate-family deferral
- visibility checks
- question-shaped / docs/open safety guards
- current-state compatibility checks

The intended end state is:

- no separate known-noun winner lane
- no separate known-command winner lane
- retained product/safety policy through shared validation

Validation split required by this proposal:

- pre-arbiter validation/filtering:
  - remove or demote candidates that should not compete
  - examples: duplicate-family ambiguity, target invisibility/unavailability, question-shaped/docs-open guards, stale current-state incompatibility
- post-selection validation:
  - verify the exact chosen candidate still satisfies current-state execution requirements
  - if not, reject or clarify

## Required Code Changes

1. Remove surface from the active-clarifier escape evidence path.
   - stop writing `_surfaceEscapeEvidence` for live-clarifier bounded escape
   - stop emitting `__escape_surface_*` candidates for active clarification

2. Remove known-command / known-noun as separate winner lanes.
   - stop using them as independent active-clarifier escape sources
   - migrate their policy/validation logic into deterministic guards or shared candidate validation

3. Keep the no-clarifier surface path unchanged.
   - no regression to deterministic-surface behavior when no clarifier is live

4. Reuse the approved semantic retrieval implementation for active clarification.
   - use the learned/seeded semantic hint path
   - do not fall back to legacy semantic lookup for this slice
   - ensure seeded semantic coverage exists for the supported command families in this slice
   - if semantic is disabled, times out, or returns empty for a migrated family:
     - B1 exact may still win if present
     - otherwise clarify
     - do not fall back to removed surface/known-command owner lanes

5. Preserve concrete semantic execution payload.
   - the selected semantic candidate must carry through to execution
   - do not use boolean-only semantic flags
   - do not generically fall through after semantic selection

6. Keep arbiter authority intact.
   - no pre-LLM direct escape shortcut
   - no fixed precedence between B1 and semantic candidates

7. Preserve evidence-based provenance.
   - bounded arbiter escape/select must surface bounded execution provenance in the executed result

8. Gate rollout per command family.
   - removal of active-clarifier surface/known-command ownership must be controlled by an explicit family-level rollout mechanism
   - only families with:
     - semantic seed or B1 coverage
     - migrated validation rules
     - regression coverage
     may switch to the new active-clarifier model

## Edge Cases To Cover

1. Active clarifier + exact alternate request
   - `open recent`
   - `open links panel b`
   - `open widget manager`

2. Active clarifier + typo/noisy alternate request
   - `openn recent`
   - `open recnet`
   - `pls open recent widget`
   - noisy / paraphrased forms for non-Recent command families covered by seeds

3. Active clarifier + option answer
   - `open entries`

4. Active clarifier + mixed competition
   - one active option is plausible
   - one semantic escape candidate is also plausible

5. Known-command / known-noun policy migration
   - duplicate-family deferral still works
   - visibility checks still block invalid targets
   - question-shaped / docs-open safety guards still prevent wrong execution
   - current-state compatibility still blocks stale/invalid targets

6. Post-escape resume
   - `from chat`
   - `open that option 1 from chat`
   - `open that option 2 from chat`

7. Question-intent safety
   - `question_intent + escape evidence` must not auto-execute

8. Semantic unavailable
   - semantic disabled
   - semantic timeout
   - semantic empty result
   - B1 exact still allowed
   - otherwise clarify, with no fallback to removed owner lanes

9. Family-gated rollout
   - one family migrated
   - one family not yet migrated
   - confirm behavior differs only where explicitly enabled

## Regression Matrix

Must pass:

- live clarifier -> `open recent` -> `Recent` opens with bounded provenance without relying on surface
- live clarifier -> `openn recent` -> `Recent` opens via semantic candidate with bounded provenance
- live clarifier -> `open recnet` -> `Recent` opens via semantic candidate with bounded provenance
- live clarifier -> `pls open recent widget` -> `Recent` opens with bounded provenance
- live clarifier -> `can you please open the recent widget` -> `Recent` opens with bounded provenance
- live clarifier -> `hi there. i want you to open the recent widget` -> `Recent` opens with bounded provenance
- live clarifier -> `hmm can you open the recent widget?` -> `Recent` opens with bounded provenance and must not fall back to `Auto-Executed`
- live clarifier -> `open links panel b` -> correct bounded semantic/B1 candidate resolves without surface ownership
- live clarifier -> `open widget manager` -> correct bounded semantic/B1 candidate resolves without surface ownership
- live clarifier -> `open entries` -> clarifier option executes, not semantic escape
- live clarifier -> semantic-vs-option overlap case -> arbiter chooses correctly, no fixed precedence bug
- migrated known-command / known-noun policy checks still hold:
  - duplicate-family deferral
  - visibility validation
  - question-shaped/docs-open guard
  - current-state compatibility validation
- post-escape resume flows still work
- no-clarifier `open recent` / `openn recent` deterministic-surface behavior remains unchanged
- semantic disabled/timeout/empty for a migrated family -> B1 exact still allowed, otherwise clarify
- non-migrated family -> old owner-lane behavior remains until that family is explicitly enabled

Must not happen:

- exact active-clarifier command resolution depends on surface or known-command ownership
- surface wins the active-clarifier typo/noise escape path
- known-noun survives as a separate competing winner lane
- known-command survives as a separate competing winner lane
- semantic candidate is selected but execution falls through generically
- active clarifier is bypassed by direct execution
- `question_intent + escape evidence` auto-executes

## Files Expected To Change

- `lib/chat/routing-dispatcher.ts`
- `lib/chat/chat-routing-clarification-intercept.ts`
- `lib/chat/chat-routing-types.ts`
- `lib/chat/clarification-llm-fallback.ts`
- relevant unit/integration tests under `__tests__/`

## Non-Goals

This plan does not:

- change no-clarifier deterministic-surface routing
- promote visible widget/panel contents into their own bounded candidate pool
- implement truncated bounded context
- implement repair mode

It also does not promise blanket support for every product command family immediately.
Each command family removed from active-clarifier surface/known-command ownership must have semantic seed or B1 coverage plus migrated validation before that removal is considered complete.

## Anti-Pattern Applicability

The isolation/reactivity anti-pattern guidance is not applicable here.

This is a routing and bounded-arbiter contract change:

- candidate assembly
- semantic retrieval reuse
- provenance preservation
- deferred execution
