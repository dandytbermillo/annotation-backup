# Lane Removal, Capability Preservation Plan

## Purpose

Prevent a dangerous implementation mistake:

- removing a competing routing lane
- and accidentally deleting the product capability that happened to live inside that lane

This plan exists because the current `surface-resolver` is not only a routing lane.
It also contains manifest-backed product knowledge that must survive any semantic-first or unified-resolver migration.

## Problem Statement

The current code mixes three different concerns inside the same modules:

1. Retrieval
   - embedding-backed lookup
   - rewrite-assisted lookup
   - exact-memory lookup

2. Product validation and execution policy
   - widget-specific manifest definitions
   - execution policy
   - replay policy
   - clarification policy
   - container compatibility
   - visibility/runtime checks

3. Routing ownership
   - which lane is allowed to win directly
   - which lane may only contribute bounded candidates
   - which mode allows direct execution

If a plan says "remove surface" without decomposing these concerns, an implementer can wrongly infer:

- delete `surface-resolver.ts`
- route everything through `lookupSemanticHints(...)`

That would be unsafe, because semantic retrieval metadata does not replace manifest-backed product policy.

## Anti-Pattern Applicability

The isolation/reactivity anti-pattern guidance is not directly applicable here.

This plan does not introduce:

- new provider/consumer context APIs
- new reactive hooks
- UI-layer correctness gating

It is a routing decomposition and migration plan.

The relevant guardrail carried forward from that guidance is still useful:

- do not collapse multiple responsibilities into one ambiguous change
- define old capability to preserve, new capability to introduce, and exact migration seams before removing behavior

## Capability Decomposition

### Semantic Hints

Semantic hints provide retrieval capability:

- learned/seeded retrieval-backed hints
- generic bounded metadata
  - `intent_id`
  - `slots_json`
  - `target_ids`
  - score / provenance
- typo/noise/paraphrase support
- bounded candidate input
- no direct execution authority by design

Semantic hints are strong at:

- retrieval breadth
- fuzzy phrasing
- portable query-to-target matching
- cross-dashboard continuity

Semantic hints do **not** by themselves replace:

- widget execution policy
- container/runtime compatibility rules
- visibility rules
- built-in widget semantics

### B1 Exact Memory

B1 provides exact-memory retrieval capability:

- exact or near-exact remembered match
- bounded candidate metadata
- strong exact-memory signal
- no direct execution authority during active clarification

B1 is strong at:

- exact replay
- low-ambiguity exact-memory matches

### Surface Resolver

The current surface resolver contains more than one thing.

It contains retrieval helpers:

- rewrite-assisted retrieval
- built-in surface seed retrieval
- confidence-band shaping

It also contains product capability that must not be deleted:

- widget-specific manifest usage
- execution policy mapping
- replay/clarification policy
- container compatibility
- visibility/runtime checks
- concrete built-in widget command semantics

Examples of the capability source:

- `lib/chat/surface-manifest.ts`
- `lib/chat/surface-manifest-definitions.ts`
- manifest/runtime validation in `lib/chat/surface-resolver.ts`

### Known-Command / Known-Noun

Known-command currently mixes:

- lane ownership
- product rules / safety rules

The lane should be removable.
The rules should survive as shared validation:

- duplicate-family deferral
- visibility checks
- docs/question guards
- current-state compatibility

## Core Rule

Remove duplicated winner lanes.
Do not remove required capabilities.

That means:

- remove `surface` as an independent active-clarifier winner lane
- remove `known-command` / `known-noun` as independent winner lanes
- preserve and relocate the useful policy/validation capability currently living inside them

## Target Architecture

The target architecture is one shared command-candidate pipeline with different execution policy by mode.

### Shared Core

Both modes use the same shared core:

1. normalize query
2. if initial retrieval is weak or below the useful threshold, run rewrite-assisted retrieval and re-query
3. retrieve candidates from:
   - semantic hints
   - B1 exact memory
4. merge / dedupe candidates
5. enrich and validate against:
   - surface manifest
   - runtime visibility
   - container compatibility
   - known-command safety rules

Rewrite-assisted retrieval is part of the shared retrieval core for both modes.
It is not active-clarifier-only and not no-clarifier-only.
What changes by mode is execution policy after retrieval and validation, not whether rewrite-assisted re-retrieval exists.

### No Active Clarification

After shared retrieval + validation:

1. if one candidate is strong and valid, execute directly
2. otherwise bounded LLM may assist
3. if still unresolved, clarify

### Active Clarification

After shared retrieval + validation:

1. do not execute directly from retrieval
2. pass validated candidates plus active clarifier options to bounded arbitration
3. execute only the exact selected candidate
4. if unresolved, keep / show clarification

### Minimal Multi-Intent Safety Rule

This plan does not attempt full multi-intent handling.

It does require one immediate safety guard:

- if a turn appears mixed, compound, or command-plus-question, do not direct-execute from retrieval alone

No-clarifier mode:

- direct execution is allowed only when one dominant executable intent is clearly isolated
- otherwise fall back to bounded LLM or clarification

Active-clarifier mode:

- the arbiter may execute only when one dominant executable intent is clearly isolated
- otherwise keep or re-show clarification

This is a safety contract for the current plan, not a full multi-intent decomposition design.

### Minimal Active-Panel Item Candidate Rule

This plan does not add a broad visible-content candidate pool.

It does add one narrow bounded capability:

- during active clarification, allow a validated active-panel item candidate when:
  - the user explicitly names the item target
  - the item is validated as present in the active panel/widget
  - the active panel's manifest supports bounded item execution
  - the candidate is grounded in the active panel context, not guessed globally

Limits:

- this is not a general visible-item candidate pool
- this does not direct-execute from active panel context alone
- the validated active-panel item still enters bounded arbitration
- if validation fails or overlap remains unresolved, clarify instead of guessing

Example protected behavior:

- active panel: `links panel b`
- user: `open budget100`
- validated item exists in the active panel
- manifest supports `execute_item`
- expected: bounded candidate available to the arbiter, not loss of the action

Validation contract for this rule:

- active-panel item validation should try the raw/normalized user target first
- if rewrite-assisted re-retrieval runs for the turn, the rewritten target string may also be checked against active-panel contents
- rewritten-text matching must remain bounded and must preserve provenance that the active-panel item match came from rewritten text rather than the raw text
- this does not authorize global guessing from rewrite alone; the rewritten match must still validate against the active panel/widget contents

Active-panel scoping contract:

- if the user provides an explicit scope cue naming the panel/widget, that scope wins
- otherwise use the currently active/focused panel/widget when one is unambiguous
- if multiple visible panels/widgets could satisfy the same explicit item target and no scope cue or unambiguous active/focus signal resolves the conflict, clarify instead of guessing

### Note-Sibling Candidate Rule

Notes remain on the note-command-manifest sibling contract.

They must not be folded into the generic non-note active-panel item rule.

During active clarification, allow a bounded note-sibling candidate only when:

- the user explicitly names a note target or issues a note-follow-up targetable by the note contract
- the target is validated by the note-specific resolver/manifest/anchor contract
- the candidate remains bounded and enters the arbiter

Limits:

- this is not a generic surface-item candidate
- this does not direct-execute under active clarification
- if note validation fails, clarify instead of guessing

Preservation rule:

- this note-sibling path preserves the existing note-specific resolver / intercept logic, validation, and target-shaping behavior
- under active clarification, this preservation does not include direct execution authority
- it must not flatten note handling into the generic shared non-note surface-item path

### Rollout Gating Contract

Rollout gating must distinguish non-note panel families from the note sibling contract.

Non-note active-panel item behavior:

- uses the normal family gate keyed by panel family / `panel_type`
- only enabled when that family has:
  - semantic seed or B1 coverage
  - migrated validation
  - regression coverage

Note-sibling behavior:

- must not be keyed only by generic non-note `panel_type` family gates
- must use a separate note-specific rollout decision
- acceptable implementations are:
  - a dedicated rollout key such as `note`
  - or an explicit always-on/off note-sibling gate documented separately

Until note-specific rollout is explicitly enabled, notes must remain on their current note contract behavior rather than being partially migrated through the non-note family gate.

### Cross-Source Mixed-Turn Contract

When multiple bounded candidate sources are simultaneously valid, the minimal multi-intent guard still applies.

Examples that must not direct-execute unless one dominant executable intent is clearly isolated:

- active clarifier option + non-note active-panel item candidate
- non-note active-panel item candidate + note-sibling candidate
- note-sibling candidate + clarification reply

Required handling:

- keep all candidates bounded
- let the arbiter choose only when one dominant executable intent is clearly isolated
- otherwise re-show clarification or ask to clarify

## What Goes Away

These go away as separate routing authorities:

1. `surface` as a competing active-clarifier winner lane
2. `known-command` / `known-noun` as competing winner lanes

## What Stays

These capabilities must stay:

1. semantic retrieval
2. B1 exact-memory retrieval
3. rewrite-assisted retrieval / re-query support
4. surface-manifest-backed execution policy
5. surface-manifest-backed container/visibility/runtime validation
6. known-command safety/policy rules
7. narrow validated active-panel item candidate support for explicit item actions
8. note-sibling bounded candidate support through the note-specific contract

## Explicit Mapping

### Keep As Retrieval

- `lookupSemanticHints(...)`
- B1 exact-memory lookup

### Keep As Validation / Policy

- `lib/chat/surface-manifest.ts`
- `lib/chat/surface-manifest-definitions.ts`
- manifest/runtime validation logic currently in `lib/chat/surface-resolver.ts`
- known-command / known-noun safety rules
- active-panel item presence validation against the live panel/widget contents

### Keep As Optional Helpers

- rewrite-assisted retrieval helpers from `lib/chat/surface-resolver.ts`
- bounded candidate shaping helpers where they do not reintroduce independent ownership

### Rewrite Contract

The unified retrieval core should explicitly support this pattern in both modes:

1. initial retrieval on the raw/normalized query
2. if results are weak, low-threshold, or ambiguous, run rewrite/denoise
3. re-query retrieval with the rewritten query
4. merge the original and rewritten retrieval results into one bounded candidate set

This rewrite-assisted re-retrieval behavior is a retrieval concern, not a manifest concern.
It should remain available in both active clarification and no-active-clarification flows.

### Behavior Preservation Details

The following current behaviors must be preserved, explicitly replaced, or intentionally dropped.

#### Delivery-State Shaping

Current behavior uses destination intent such as:

- present in chat
- open surface / drawer

to rerank and gate candidates.

Required treatment:

- **Preserve**
- move into shared preprocessing / candidate shaping

#### Family-Ownership Guards

Current behavior includes anti-steal ownership guards, for example:

- generic inputs must not be captured by a family only because a seed matched

Required treatment:

- **Preserve or explicitly replace**
- implement as shared pre-arbiter ownership/validation guard

#### Manifest-Fallback Hint Behavior

Current behavior may synthesize a bounded manifest-derived fallback hint when retrieval is empty but runtime/manifest overlap is strong.

Required treatment:

- **Preserve as a bounded helper candidate source, with strict limits**

Decision:

- preserve manifest-fallback hints as a bounded helper
- allow them only when:
  - semantic retrieval returned no usable candidate above the medium floor
  - B1 returned no usable exact-memory candidate
  - runtime/manifest overlap is strong
  - the family is low-risk and enabled for this behavior
- manifest-fallback hints must never directly execute from retrieval alone
- manifest-fallback hints may enter:
  - bounded LLM / clarification flow in no-clarifier mode
  - bounded arbiter flow in active-clarifier mode

#### Confidence Bands and Near-Tie Shaping

Current behavior has explicit:

- high / medium floors
- near-tie demotion

Required treatment:

- **Replace with explicit shared threshold contract**

Default threshold contract:

- direct-execute eligibility: `>= 0.88`
- rewrite trigger floor: `< 0.88` and `>= 0.78`, or no usable candidate above `0.78`
- arbiter-only eligibility: `>= 0.78` and `< 0.88`
- low/no-match: `< 0.78`
- near-tie demotion margin: `< 0.03` difference between top two candidates

These defaults may later become bounded config, but the migration plan should implement these values first unless a family-specific override is approved.

#### B1 + Semantic Merge / Dedupe

The unified pipeline says merge/dedupe, but this needs an explicit rule.

Required treatment:

- **Preserve as explicit merge contract**

Required merge rule:

1. candidates with the same canonical target/action identity collapse into one merged candidate
2. merged candidate preserves:
   - source evidence from all contributing lanes
   - best score per source
   - stable execution payload
3. different targets remain separate candidates

Canonical identity contract:

- identity is `(targetId, intentId, normalizedSlotsKey)` when a concrete `targetId` exists
- otherwise identity is `(panelTypeOrFamily, intentId, normalizedSlotsKey)`
- `normalizedSlotsKey` means only execution-relevant slots, not incidental telemetry/provenance fields
- if two candidates disagree on concrete `targetId`, they must remain separate even if they share family/intent

#### Rewrite Trigger Contract

Current plan says rewrite on weak / low-threshold / ambiguous retrieval.

Required treatment:

- **Replace with explicit trigger contract**

Required trigger categories:

- no usable candidate above medium floor
- top candidate below direct-execute threshold
- near-tie between top candidates
- obvious lexical typo/noise cases where rewrite is cheap and bounded

Latency / attempt contract:

- allow at most one rewrite-assisted re-query pass per turn in this slice
- do not chain multiple rewrite rounds
- default behavior:
  - try rewrite when the trigger categories above are met
  - skip rewrite when a direct-execute candidate already exists above `0.88` with no near-tie
- if rewrite budget is exhausted or times out, continue with the original bounded candidate set rather than blocking

#### Selected-Candidate Provenance Detail

Current candidate contract already includes provenance, but migration should preserve richer detail.

Required treatment:

- **Preserve and expand**

Winning-candidate provenance should record:

- retrieval source(s): raw, rewritten, agreement
- lane contribution: semantic, B1, or merged
- whether rewrite was used
- whether near-tie demotion occurred
- whether the candidate came from exact hit, ranked semantic hit, or fallback hint
- whether the candidate was grounded by validated active-panel item context

#### Multi-Intent Detector Contract

The minimal multi-intent guard needs an explicit detector.

Required detector contract for this slice:

- mark a turn as mixed when one or more of the following holds:
  - command verb + question form in the same turn
  - explicit conjunction sequencing such as `and`, `then`, `also` joining distinct actions/questions
  - multiple executable command verbs with different objects
- do not mark a turn as mixed solely because it uses a polite or hedged single-intent command wrapper, for example:
  - `can you open recent`
  - `could you please open the recent widget`
  - `would you mind opening links panel b`
- examples:
  - `open recent and what is inside it?`
  - `open links panel b then tell me what is in recent`
  - `can you open recent and why is it empty?`

This slice may use bounded lexical/rule-based detection first.
Deeper multi-intent decomposition can be designed later.

### Remove As Independent Lane Ownership

- direct active-clarifier ownership by surface resolver
- direct active-clarifier ownership by known-command / known-noun

## Candidate Contract

The unified pipeline should produce a bounded candidate shape that separates retrieval from policy:

```ts
type CommandCandidate = {
  source: 'semantic' | 'b1' | 'active_panel_item' | 'note_sibling'
  intentId: string
  targetIds: string[]
  slotsJson: Record<string, unknown>
  score?: number
  provenance: string
}

type ValidatedCommandCandidate = CommandCandidate & {
  manifestPolicy?: {
    executionPolicy: string
    replayPolicy: string
    clarificationPolicy: string
  }
  runtimeValid: boolean
  validationErrors: string[]
}
```

Important:

- embeddings retrieve
- manifest validates/interprets
- the active-clarifier path executes only after bounded selection

## Migration Strategy

### Phase 1: Stop Deleting The Wrong Thing

Update active plans/docs to say explicitly:

- lane goes away
- capability stays

Required wording:

- "surface is removed as an active-clarifier winner lane"
- "surface-manifest validation and execution-policy knowledge remain required"
- "known-command lane is removed, but known-command safety rules are preserved"

### Phase 2: Shared Validation Extraction

Extract or centralize the following so they are not tied to lane ownership:

- manifest lookup
- execution/replay/clarification policy lookup
- visibility checks
- container compatibility
- duplicate-family guards
- question/docs safety guards
- family-ownership guards
- delivery-state shaping

### Phase 3: Shared Retrieval Core

Move toward one shared retrieval core:

- semantic hints as the primary retrieval engine
- B1 as exact-memory retrieval
- rewrite-assisted re-retrieval from old surface logic
- explicit merge/dedupe contract
- explicit threshold / near-tie contract
- explicit multi-intent detector contract
- preserved bounded manifest-fallback helper contract

### Phase 4: Mode-Specific Execution Policy

Keep one core pipeline, two execution modes:

- no clarifier:
  - validated strong winner may execute
- active clarifier:
  - bounded candidates only
  - arbiter decides

## Implementation Guidance

An implementer should not read "surface goes away" as permission to delete:

- `surface-manifest.ts`
- `surface-manifest-definitions.ts`
- manifest/runtime validation logic
- widget-specific execution semantics

An implementer should read it as:

- remove lane ownership
- preserve policy capability
- preserve validation capability
- relocate helpers if needed

## Review Checklist

Before removing any lane, confirm:

1. Which retrieval capability is being preserved?
2. Which validation/policy capability is being preserved?
3. Which execution-mode rule changes between active and no-active clarification?
4. Which exact files/functions are being removed versus extracted?
5. Does the change remove only ownership, or does it also delete product knowledge?

If the answer to 5 is "it deletes product knowledge", stop and redesign the change.

## Bottom Line

The correct rule is:

- remove duplicated routing ownership
- preserve manifest-backed product knowledge
- preserve exact-memory retrieval
- preserve semantic retrieval

The dangerous misread is:

- semantic is richer on retrieval
- therefore surface resolver can be deleted

The safe implementation rule is:

- semantic is primary for retrieval
- surface-manifest capability remains required for policy and validation
- active/no-active clarification differ by execution policy, not by deleting product capability
