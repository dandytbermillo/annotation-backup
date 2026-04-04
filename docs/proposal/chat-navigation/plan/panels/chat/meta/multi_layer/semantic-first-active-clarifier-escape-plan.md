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

**Parent architecture note:** `lane-removal-capability-preservation-plan.md`

This document is the concrete migration slice.
It must be read together with the parent architecture note, which makes one rule explicit:

- lane goes away
- capability stays

In particular:

- removing `surface` from the active-clarifier winner lane does **not** mean deleting surface-manifest/runtime capability
- removing `known-command` / `known-noun` as winner lanes does **not** mean deleting their safety/policy rules

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

## Capability Preservation Rule

This plan removes lane ownership, not product capability.

What is removed under active clarification:

- surface as a competing winner lane
- known-command / known-noun as competing winner lanes

What must remain available:

- semantic learned/seeded retrieval
- B1 exact-memory retrieval
- rewrite-assisted re-retrieval for weak/low-threshold queries
- surface-manifest execution/replay/clarification policy
- surface-manifest container/visibility/runtime validation
- useful rewrite/recovery helpers from surface logic
- known-command / known-noun safety rules

The implementation must therefore preserve:

- widget-specific manifest knowledge
- built-in widget command semantics
- runtime validation

even while removing surface ownership from the active-clarifier path.

Rewrite rule:

- rewrite-assisted retrieval is part of the shared retrieval core
- if initial retrieval is weak, low-threshold, or ambiguous, the system may rewrite/denoise and re-query
- this retrieval behavior should remain available in both active and no-active clarification modes
- only the final decision/execution policy changes by mode

Preserve / replace details:

- preserve delivery-state shaping as shared preprocessing / candidate shaping
- preserve or explicitly replace family-ownership guards so generic inputs are not stolen by a matched family seed
- define explicit merge/dedupe behavior for B1 + semantic collisions
- define explicit threshold / near-tie rules for direct execution, rewrite trigger, and arbiter-only eligibility
- explicitly decide whether manifest-fallback hints survive as bounded helpers or are intentionally dropped
- preserve selected-candidate provenance detail

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
- non-note active-panel item candidates (for explicit named item actions)
- note-sibling candidates (validated by the note-specific contract)
- product validation/guards

work together across command families, and any remaining `Auto-Executed` result is treated as a provenance or source-selection gap to eliminate.

## Active-Clarifier Contract

When clarification is active, upstream lanes do not execute directly. They contribute bounded candidates only.

The bounded arbiter remains the sole decision point.

The active-clarifier candidate set should be:

1. Active clarifier options
2. B1 exact replay candidates
3. Learned/seeded semantic candidates
4. Non-note validated active-panel item candidates for explicit named item actions
5. Note-sibling candidates validated by the note-specific contract
6. Active widget/panel context as secondary evidence otherwise

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

## Minimal Multi-Intent Safety Contract

This slice does not implement full multi-intent handling.

It does require one guardrail now:

- if a turn appears mixed, compound, or command-plus-question, do not direct-execute from retrieval alone

Detector for this slice:

- command verb + question form in one turn
- conjunction sequencing such as `and`, `then`, `also` joining distinct intents
- multiple executable command verbs with different objects

Polite-wrapper exclusion: do not mark a turn as mixed solely because it uses a polite or hedged single-intent command wrapper, for example:

- `can you open recent`
- `could you please open the recent widget`
- `would you mind opening links panel b`

These are single-intent polite requests, not command+question compounds.

No active clarification:

- only direct-execute when one dominant executable intent is clearly isolated
- otherwise bounded LLM or clarification should take over

Active clarification:

- the arbiter may execute only when one dominant executable intent is clearly isolated
- otherwise keep or re-show clarification

## Intended Flow

1. Detect live clarification using the existing protected condition.
   - include paused/recoverable clarification state such as `clarificationSnapshot`

2. Do not allow surface resolver output to become active-clarifier escape evidence.
   - if clarification is live, surface may still run for diagnostics if needed
   - but it must not contribute bounded escape candidates
   - this removes lane ownership only; it does not authorize deleting surface-manifest validation/policy capability

3. Do not allow known-command / known-noun to remain separate winner lanes.
   - their product rules must survive
   - but they should no longer compete as independent routing winners

4. Reuse the existing semantic retrieval path already approved for bounded hinting.
   - use the learned/seeded semantic lookup path
   - keep semantic rows hint-only
   - do not grant direct execution authority
   - preserve shared rewrite-assisted re-retrieval
   - preserve delivery-state shaping or move it into shared preprocessing / candidate shaping
   - define merge/dedupe for B1 + semantic candidate collisions using canonical identity: `(targetId, intentId, normalizedSlotsKey)` when concrete `targetId` exists, otherwise `(panelTypeOrFamily, intentId, normalizedSlotsKey)`. Different concrete `targetId`s must remain separate candidates.
   - define threshold / near-tie behavior explicitly

5. Assemble one bounded arbiter input from:
   - active clarifier options
   - B1 exact replay candidates
   - semantic learned/seeded candidates
   - non-note validated active-panel item candidates for explicit named item actions
   - note-sibling candidates validated by the note-specific contract
   - secondary active widget/panel context otherwise

6. Apply shared pre-arbiter validation/filtering.
   - remove or demote candidates that fail hard product checks before they reach the arbiter
   - examples:
     - duplicate-family ambiguity
     - target not visible / not available
     - question-shaped / docs-open guard
     - stale or current-state-incompatible targets
   - preserve or replace family-ownership guards so generic inputs are not stolen by a matched family seed
   - non-note active-panel item candidates require:
     - explicit user target mention
     - validated item presence in the active panel/widget
     - manifest-compatible bounded item execution
   - active-panel scoping resolution when multiple panels are visible:
     - if the user provides an explicit scope cue naming the panel/widget, that scope wins
     - otherwise use the currently active/focused panel/widget when one is unambiguous
     - if multiple visible panels could satisfy the same item target and no scope cue or unambiguous focus resolves the conflict, clarify instead of guessing
   - note-sibling candidates require:
     - validation by the note-specific resolver / manifest / anchor contract
     - no fallback to the generic non-note surface-item rule

7. Run the bounded arbiter over that closed set.
   - selected clarifier option
   - selected escape candidate
   - unresolved -> clarify again

8. Execute only after selection.
   - if a semantic candidate is selected, preserve the concrete selected target/action payload through execution
   - if a non-note active-panel item candidate is selected, preserve the concrete selected item payload through execution
   - if a note-sibling candidate is selected, preserve the concrete selected note-target payload through execution
   - run final post-selection validation before execution for checks that must be verified against the exact chosen target
   - if final validation fails, reject or clarify rather than executing
   - execution provenance must stay bounded
   - if the turn is mixed / multi-intent and no dominant executable intent is isolated, do not auto-execute

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
   - surface-manifest/runtime capability remains required even after active-clarifier lane removal

4. Reuse the approved semantic retrieval implementation for active clarification.
   - use the learned/seeded semantic hint path
   - do not fall back to legacy semantic lookup for this slice
   - ensure seeded semantic coverage exists for the supported command families in this slice
   - preserve one rewrite-assisted re-query pass when trigger conditions are met
   - preserve bounded manifest-fallback hints as helper candidates only when semantic and B1 produce no usable candidate above the medium floor
   - if semantic is disabled, times out, or returns empty for a migrated family:
     - B1 exact may still win if present
     - otherwise clarify
     - do not fall back to removed surface/known-command owner lanes

4a. Preserve minimal active-panel item capability for active clarification.
   - allow a bounded active-panel item candidate only when:
     - user explicitly names the item
     - item presence is validated in the active panel/widget
     - panel manifest supports bounded item execution
   - do not promote this into a broad visible-content candidate pool
   - do not direct-execute from this source alone

4b. Preserve note-sibling bounded candidate capability for active clarification.
   - allow a bounded note-sibling candidate only when:
     - user explicitly names a note target, or issues a note-follow-up targetable by the note contract
     - the target is validated by the note-specific resolver / manifest / anchor contract
   - do not collapse note handling into the generic non-note active-panel item rule
   - do not direct-execute from this source alone

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
     - explicit family-key verification and at least one validated seed/B1 path in test or fixture coverage
     may switch to the new active-clarifier model

9. Preserve capability while removing the lane.
   - do not interpret "remove surface from active-clarifier escape" as permission to delete:
     - `surface-manifest.ts`
     - `surface-manifest-definitions.ts`
     - manifest/runtime validation logic
     - built-in widget execution semantics
   - those capabilities remain part of shared validation/policy, even if the surface lane itself is removed from active clarification

10. Add minimal multi-intent guard.
   - no direct execution from retrieval alone for mixed command/question turns unless one dominant executable intent is clearly isolated
   - active clarifier re-shows clarification when mixed intent remains unresolved

11. Add minimal active-panel item guard.
   - non-note active-panel item candidates are allowed only for explicit named item actions validated in the active panel/widget
   - if the item is not validated, do not guess; continue with B1/semantic/clarify

12. Add note-sibling bounded candidate guard.
   - notes remain on the note-command-manifest sibling contract
   - active-note follow-ups are not handled by the generic non-note surface-item path
   - if note validation fails, clarify instead of guessing

13. Add note-specific rollout gating.
   - non-note active-panel item behavior continues to use the normal family-level rollout mechanism keyed by family / `panel_type`
   - note-sibling bounded behavior must not rely only on that generic non-note family gate
   - note behavior must use a separate note-specific rollout decision, such as:
     - a dedicated `note` rollout key
     - or an explicit always-on/off note-sibling gate documented separately
   - until note-specific rollout is enabled, notes remain on their current note-contract behavior

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

4a. Active clarifier + validated active-panel item
   - active `links panel b`
   - user says `open budget100`
   - item validated in active panel
   - expect bounded candidate / bounded selection, not re-clarification

4b. Active clarifier + active-panel item absent
   - active panel present, named item not validated
   - expect clarify, not guess

4c. Active clarifier + active note follow-up
   - active note open
   - user says `read it`
   - expect bounded note-sibling handling via note-specific contract, not generic surface-item routing

4d. Active clarifier + note target absent
   - note-specific validation fails
   - expect clarify, not guess

4e. Active clarifier + cross-source mixed competition
   - clarifier option overlaps with a validated active-panel item candidate
   - active-panel item candidate overlaps with a note-sibling candidate
   - note-sibling candidate overlaps with a clarification reply
   - expect bounded arbitration or re-clarification, not direct execution

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
   - confirm note-sibling bounded behavior is gated separately from generic non-note `panel_type` families

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
- live clarifier -> clarifier option + validated active-panel item candidate overlap -> bounded arbitration, not direct execution
- live clarifier -> validated active-panel item candidate + note-sibling candidate overlap -> bounded arbitration or clarify, not direct execution
- live clarifier -> note-sibling candidate + clarification reply overlap -> bounded arbitration or re-show clarification, not silent guess
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
