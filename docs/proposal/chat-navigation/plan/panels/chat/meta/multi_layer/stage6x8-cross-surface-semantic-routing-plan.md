# Plan: Stage 6x.8 — Cross-Surface Semantic Routing

## Context

The current router behaves inconsistently across intent families because semantic understanding is not applied uniformly.

Today, different request families enter different routing paths:

- note content-read requests may use deterministic content-intent matching plus the anchored-note resolver
- execute-intent requests use normalized input plus a broader LLM intent parser
- note-state/info, panel/widget, dashboard, and workspace questions can still be intercepted by earlier deterministic tiers before the better semantic layer sees them

This creates inconsistent behavior for semantically similar requests with wrapper language, awkward phrasing, or light grammar noise, for example:

- `hey summarize that note`
- `hello which note is open`
- `hi what panel is open`
- `which workspace am I in`

The goal is not note-only routing. The goal is **cross-surface semantic routing** across:

- notes
- panels / widgets
- dashboard
- workspace

## Decision

Adopt one shared routing ladder for uncertain requests across intent families:

1. **exact deterministic**
2. **semantic retrieval / replay**
3. **bounded LLM arbitration**
4. **fallback clarification**

Deterministic logic remains responsible for exact wins and hard safety boundaries. The semantic/LLM layer becomes the common arbiter for the uncertain middle across surfaces.

## Core Principles

### 1. Deterministic remains the safety/control layer

Deterministic logic still owns:

- ordinals / active option selections
- exact validated commands
- explicit non-target scope exclusions
- destructive / mutation safety boundaries
- execution-time validation

Deterministic logic must **not** act as a broad semantic veto for noisy natural language.

### 2. Weak deterministic heuristics must not block semantically clear requests

Wrapper-heavy or awkward phrasing should not die in early guards:

- greetings
- politeness
- mild grammar noise
- paraphrases
- natural conversational wrappers

If deterministic logic is not truly certain, the request must be escalated to the semantic layer.

### 3. Semantic arbitration must be cross-family, not execute-only

The working pattern already exists in the execute-intent path:

- normalize for routing
- use a bounded LLM to classify the user request into a typed intent
- resolve deterministically against live app state
- clarify only when still unresolved

That pattern should be generalized across surfaces, not limited to execute-intent.

## Surface Model

The semantic layer should classify two things:

1. **target surface**
   - `note`
   - `panel_widget`
   - `dashboard`
   - `workspace`
   - `unknown`

2. **intent family**
   - `read_content`
   - `state_info`
   - `navigate`
   - `mutate`
   - `ambiguous`

Examples:

- `summarize that note` -> `surface=note`, `intent=read_content`
- `which note is open` -> `surface=note`, `intent=state_info`
- `what panel is open` -> `surface=panel_widget`, `intent=state_info`
- `open links panel` -> `surface=panel_widget`, `intent=navigate`
- `which workspace am I in` -> `surface=workspace`, `intent=state_info`

### Surface simplification for initial migration

For initial implementation, `panel` and `widget` should be treated as one shared surface family for arbitration and resolution purposes.

So Phase 2/3 should use:

- `note`
- `panel_widget`
- `dashboard`
- `workspace`
- `unknown`

This matches the current code reality more closely and avoids forcing the arbiter to make unstable distinctions that the resolver layer does not consistently preserve yet. A finer `panel` vs `widget` split can be introduced later if there is a concrete execution need.

### Mutate outcome policy

`mutate` is a valid classification family, but mutation execution is out of scope for this slice.

So until a dedicated mutation policy lands:

- `intentFamily=mutate` must never silently fall through
- it must produce an immediate bounded response such as:
  - safe clarifier
  - explicit not-supported-yet message
  - or redirect into a later mutation-specific slice when implemented

In short: classify `mutate`, but do not execute `mutate` in `6x.8`.

## Target Flow

### 1. Exact deterministic

Used only for:

- exact option selection
- exact validated panel/workspace/note commands
- hard safety exclusions
- exact obvious wins where certainty is genuinely high

### 2. Semantic retrieval / replay

Use B1 exact memory and B2 semantic memory as advisory signals:

- exact prior success reuse where safe
- semantic candidate retrieval for likely intent/surface patterns
- replay only when the candidate is validated and confidence is sufficient

Semantic memory should help reduce LLM calls, not replace safety validation.

### 3. Bounded LLM arbitration

If deterministic and replay are not sufficient, call a bounded semantic router that returns a typed decision such as:

Initial threshold policy:

- use a single arbiter confidence threshold of `0.75` for migrated families unless Phase 2 evidence justifies a different value
- treat confidence below threshold as unresolved for execution/answering purposes
- Phase 2 must explicitly confirm or revise this threshold before implementation


```ts
type CrossSurfaceSemanticDecision = {
  surface: 'note' | 'panel_widget' | 'dashboard' | 'workspace' | 'unknown'
  intentFamily: 'read_content' | 'state_info' | 'navigate' | 'mutate' | 'ambiguous'
  confidence: number
  reason: string
}
```

This layer is bounded:

- typed output only
- no direct execution
- no freeform chat generation
- confidence threshold required before execution or state answering

#### Unknown surface policy

If the arbiter returns `surface=unknown`, that result must never silently execute.

Interim rule:

- `surface=unknown` + `intentFamily=ambiguous` -> fallback clarification
- `surface=unknown` + any other intentFamily -> fallback clarification unless a later Phase 2 contract explicitly defines a deterministic recovery path

So, for the initial migration, a confident intent with `surface=unknown` is still treated as unresolved.

### 4. Fallback clarification

Clarify only when:

- semantic arbitration is still ambiguous
- or resolution lacks enough grounded target/state data

Clarification should be the last resort, not a substitute for semantic understanding.

## Reuse From Current Working System

The best existing example is the execute-intent path:

- [components/chat/chat-navigation-panel.tsx](./../../../../../../../../../components/chat/chat-navigation-panel.tsx)
- [app/api/chat/navigate/route.ts](./../../../../../../../../../app/api/chat/navigate/route.ts)
- [lib/chat/intent-prompt.ts](./../../../../../../../../../lib/chat/intent-prompt.ts)
- [lib/chat/intent-schema.ts](./../../../../../../../../../lib/chat/intent-schema.ts)
- [lib/chat/intent-resolver.ts](./../../../../../../../../../lib/chat/intent-resolver.ts)

That pattern should be generalized as:

- semantic classify first for uncertain requests
- deterministic resolve second
- bounded execution / bounded answering third

## Non-Goals

This slice does **not**:

- replace execution-time validation with freeform LLM behavior
- remove deterministic safety boundaries
- make every routing decision LLM-first
- solve all surface families in one risky patch
- introduce mutation execution without explicit safety policy

## Integration Decisions

### 1. Relationship to existing `/api/chat/navigate`

The new cross-surface semantic arbiter does **not** run alongside the existing execute-intent LLM path as a permanent parallel sibling. That would create duplicate LLM arbitration and unnecessary latency.

Instead, the integration model is:

- **near term:** introduce the arbiter only for the migrated uncertain families
- **for all other families:** keep the existing `/api/chat/navigate` path unchanged
- **long term:** converge toward one shared bounded semantic classification layer so `/api/chat/navigate` becomes one consumer of the shared semantic contract, not a separate competing arbiter

That means the arbiter initially **wraps the migrated uncertain families only**, rather than replacing all of `/api/chat/navigate` at once.

### 2. Stage 6 handoff remains unchanged

For `surface=note` and `intentFamily=read_content`, the new arbiter is **classification only**.

Execution remains the existing Stage 6 content pipeline:

- semantic arbiter classifies `note + read_content`
- dispatcher builds the existing `contentContext`
- dispatcher calls `executeS6Loop(...)`
- Stage 6 still owns:
  - inspect rounds
  - grounding
  - citation validation
  - surfaced answer handling

So `6x.8` does **not** replace Stage 6. It only replaces brittle entry arbitration into Stage 6.

### 2b. Relationship to `6x.7` anchored-note resolver

The existing `6x.7` anchored-note resolver is an interim narrow fix.

For the `note.read_content` family, `6x.8` should absorb that responsibility rather than permanently stacking a second arbiter beside it.

So the migration rule is:

- before `6x.8` note-family migration: keep `6x.7` resolver as the working narrow repair
- once `6x.8` owns `note.read_content`: deprecate the standalone `6x.7` resolver path and route those uncertain note-read turns through the shared arbiter instead

The `6x.7` Stage 6 handoff behavior remains the execution model; only the entry arbitration becomes shared.

### 3. `state_info` needs deterministic family-specific resolvers

`state_info` is classification-only until a concrete resolver exists for the target surface.

Initial `state_info` resolvers should be deterministic and bounded:

- `surface=note`, `intentFamily=state_info`
  - answer from `uiContext.workspace.activeNoteId` and `uiContext.workspace.openNotes`
  - if no active note exists, return an explicit bounded answer such as `No note is currently open.`
- `surface=panel_widget`, `intentFamily=state_info`
  - answer from visible/open panel state and widget snapshots
- `surface=workspace`, `intentFamily=state_info`
  - answer from current workspace/session state
- `surface=dashboard`, `intentFamily=state_info`
  - answer from current dashboard/UI state

So the pattern is:

- semantic arbiter chooses the family
- deterministic surface-specific resolver answers from live app state

This avoids inventing a second freeform answer generator for `state_info`.

Known limitation:

- `state_info` resolvers read from live client-provided UI/session context
- if that context is stale or mid-transition, the resolver can answer from incomplete state
- this is an existing trust-boundary limitation of the current routing model, not a new risk introduced by `6x.8`
- Phase 2 should document any surfaces where freshness validation or fallback wording is required

### 4. Latency budget rule

The cross-surface arbiter must **replace**, not stack on top of, existing LLM arbitration for migrated uncertain families.

For any family migrated into the new arbiter:

- do **not** call a second semantic/intent LLM afterward for the same decision
- keep B1/B2 retrieval as cheap pre-LLM signals
- use one bounded arbiter call at most for family classification
- then resolve deterministically against live state or Stage 6

So the intended ladder for migrated uncertain families is:

1. exact deterministic
2. semantic retrieval / replay
3. one bounded semantic arbiter call
4. deterministic family resolver or Stage 6 handoff
5. fallback clarification

Dispatcher migration gate:

- after classification, execution/resolution must check whether the returned `surface + intentFamily` pair is currently migrated
- if it is migrated, continue into the new family resolver / Stage 6 handoff
- if it is not migrated, fall back to the existing routing path for that family

This keeps the arbiter from forcing partial migrations into unsupported handlers.

This keeps the semantic layer as a replacement for uncertainty arbitration, not an extra layer of latency.

## Implementation Sequence

### Phase 1: Policy cleanup

Audit early deterministic tiers and classify each rule as one of:

- exact deterministic win
- hard safety exclusion
- should escalate to semantic routing instead

Phase 1 is **audit-and-design only** unless the migrated semantic arbiter for that family is shipping in the same change window.

Do not ship guard removals or rerouting changes ahead of the replacement arbiter. Otherwise those turns would fall through into legacy paths that are not designed to absorb the newly reclassified uncertainty.

Primary files:

- `lib/chat/routing-dispatcher.ts`
- `lib/chat/content-intent-classifier.ts`
- adjacent early-tier routing helpers

### Phase 2: Shared semantic contract

Create one bounded cross-surface semantic contract for the uncertain middle.

Before implementation begins, Phase 2 must explicitly lock:

- how migrated families enter the new arbiter instead of calling competing LLM paths
- how `read_content` hands off to Stage 6
- which deterministic `state_info` resolver handles each surface after classification
- the one-arbiter-per-turn latency rule for migrated families
- `surface=unknown` fallback behavior
- the exact dispatcher insertion rule for migrated note families
- the temporary policy for non-note `read_content` surfaces
- the arbiter confidence threshold for migrated families

This is the architectural pivot:

- from family-specific fuzzy guards
- to one shared semantic arbiter for uncertain cases

### Phase 3: Migrate note-related families first

Start with the families already showing visible inconsistency:

- note `read_content`
- note `state_info`

For this first migration:

- `note.read_content` -> semantic classify, then existing Stage 6
- `note.state_info` -> semantic classify, then deterministic note-state resolver from live UI/session state
- `navigate` remains deferred for this phase so the new arbiter does not compete with the existing `/api/chat/navigate` path yet

Dispatcher entry rule for this first migration:

- reuse the same general dispatcher seam currently occupied by the `6x.7` note-read resolver family
- deterministic exact wins and hard safety exclusions still run first
- pre-arbiter eligibility for Phase 3 note-family migration is:
  - note-related turn (active note present or note-reference detected)
  - not already handled by an exact deterministic win
  - not blocked by a hard safety exclusion
- if that eligibility rule is satisfied, call the shared arbiter
- after classification, apply the migrated-family gate:
  - migrated pair -> continue into the new resolver / Stage 6 handoff
  - non-migrated pair -> fall back to the existing routing path

Phase 2 must lock the exact dispatcher insertion contract before implementation, but the intended boundary is: absorb the existing note uncertainty seam rather than add a second competing seam.

Examples:

- `summarize that note`
- `which note is open`
- `what note am I on`

### Phase 4: Extend to other surfaces

Add panel/widget/dashboard/workspace informational families first, then migrate navigation families once the replacement strategy for `/api/chat/navigate` is explicitly locked.

Examples:

- `what panel is open`
- `which widgets are visible`
- `which workspace am I in`
- `open links panel`

Temporary policy for non-note `read_content` during this phase:

- `surface=panel_widget|dashboard|workspace` + `intentFamily=read_content` is deferred unless that surface has a dedicated bounded content reader
- until then, return a bounded not-supported-for-this-surface response or clarifier
- do not route non-note `read_content` into Stage 6 note content execution

### Phase 5: Telemetry and evals

Log which stage made the decision:

- exact deterministic
- semantic replay
- bounded LLM arbitration
- clarifier

Add regression coverage for wrapper-heavy variants across surfaces.

## Success Criteria

The system should behave consistently for semantically equivalent requests regardless of wrapper words or light grammar noise.

For migrated families, one uncertain turn should require at most one bounded semantic arbiter call before deterministic resolution or clarification.

Examples that should converge to the same result:

- `which note is open`
- `hi which note is open`
- `hello which note is open`

- `summarize that note`
- `hey summarize that note`
- `could you summarize that note please`

- `what panel is open`
- `hi what panel is open`

## Summary

The current issue is not note-only and not fixable by endless regex additions.

The correct direction is:

- deterministic for exact wins and safety boundaries
- semantic retrieval/replay for prior-success reuse
- bounded LLM arbitration for the uncertain middle across all surfaces
- fallback clarification only after the semantic layer is still not confident enough
