# Plan: Memory-Aware Bounded Arbitration

## Goal

Extend bounded arbitration so the LLM does not operate only on the current turn.

The system should let the bounded LLM make better decisions by retrieving:

- app knowledge
- user-specific instructions and habits
- repair/correction memory

while still keeping execution bounded, validated, and safe.

This plan is the higher-level design above:

- active clarification bounded arbitration
- repair-mode bounded arbitration

Those remain valid, but become slices of a broader memory-aware arbitration architecture.

## Problem

Current bounded arbitration is safer than fragmented routing, but it still has a major weakness:

- the LLM only sees the current bounded context plus a small amount of recent state
- it does not reliably learn the app
- it does not reliably learn the user
- it does not reliably improve after mistakes

So even when routing is correct, the LLM can still feel shallow and repetitive when the user is in trouble.

## Core Rule

Every bounded LLM call should receive not only the current bounded candidate set, but also a validated memory package containing the most relevant:

- app memory
- user memory
- repair memory

The LLM may use that package to choose better among bounded outcomes, but memory must never authorize execution by itself.

Execution remains bounded by:

- active clarifier options
- validated escape targets
- runtime validators
- manifest / policy rules

## Memory Layers

### Layer 1: App Memory

Stable product knowledge about how the app works.

Examples:

- dashboard, workspace, widget, panel, and note families
- cross-class name-match behavior such as `open entries` matching widgets, workspaces, and entries that share the name
- common aliases
- common surface confusion patterns
- known command families
- delivery behavior
- common clarifier patterns that work well

This memory helps the LLM understand the app, but it is not execution authority.

### Layer 2: User Memory

Stable user-specific knowledge and instructions.

Examples:

- preferred terminology
- recurring phrasing habits
- preferred interpretation of recurring ambiguous requests
- standing user rules the system should remember
- `claude.md`-style instructions or equivalent user-authored memory

This memory should be explicit and retrievable, not hidden model drift.

### Layer 3: Repair Memory

Memory learned from actual failed or corrected decisions.

Examples:

- what the LLM chose
- what the user rejected
- what the user corrected it to
- what UI and routing state was active at the time
- how similar corrections should influence future arbitration

This is advisory memory, not deterministic authority.

## Bounded Memory Package

When the bounded LLM is called, the app should construct a bounded memory package with:

- current active clarification option set, if any
- target class metadata for every current option
- validated escape candidates, if any
- relevant app memory snippets
- relevant user memory snippets
- relevant repair-memory snippets
- current UI/routing metadata

The raw user query must still be passed unchanged.

The LLM should reason over:

- the raw user input
- the current bounded choices
- the memory package

It should not freely search the whole app.

## Retrieval Rules

Memory retrieval must be filtered by context.

Relevant filters include:

- current dashboard or screen
- active widget/panel ids
- active clarification option set or family
- active clarification target classes
- current command family
- scope cues such as `from chat`
- recency
- user identity / tenant
- compatibility with current routing metadata fingerprint

If memory is not context-compatible, do not retrieve it into the arbiter prompt.

## Trust Rules

App memory, user memory, and repair memory have different trust levels.

### App Memory

May strongly influence:

- interpretation
- candidate ranking
- better clarification wording

May not directly authorize:

- execution
- mutation
- surface opening

### User Memory

May strongly influence:

- preferred interpretation between otherwise plausible bounded choices
- understanding of the user's habitual phrasing

May not override:

- current visible option set
- current validated target set
- runtime validation

### Repair Memory

May influence:

- de-prioritizing a previously rejected target
- biasing toward a previously corrected target in a sufficiently similar context

May not:

- replay a correction across incompatible UI state
- override a different live clarifier
- create a target not present in the current bounded context

## Arbitration Outcomes

The bounded arbiter still returns only structured outcomes:

- `select_clarifier_option`
- `escape_to_validated_target`
- `ask_clarify`
- `inform`

Repair mode extends that with:

- `select_alternative_option`
- `reopen_previous_clarifier`
- `ask_repair_clarify`

Memory improves these decisions, but does not add new unbounded outcomes.

Every arbiter result should be a structured decision payload, not just an outcome label.

Minimum payload fields:

- `decision`
- `selectedOptionId` or `targetId`
- `targetClass`
- `commandRef` or `resolvedActionRef`
- `sourceContext`
- `basedOnTurnIds`
- `confidence`
- `reason`

When the current user query refers to previous turns in the session, `basedOnTurnIds` and `sourceContext` are required so the app knows exactly which prior chat state the arbiter used. Memory may improve the choice, but the returned payload must still point to a bounded executable reference the app can validate.

## Active Clarifier Integration

When active clarification is live:

1. ordinals remain deterministic
2. every other reply goes to the bounded arbiter
3. the arbiter receives:
   - active clarification option set
   - validated escapes
   - secondary widget evidence
   - relevant memory package

This lets the LLM use what it has learned about:

- the app
- the user
- past corrections
- recurring cross-class ambiguity patterns such as one broad name matching widgets, workspaces, and entries

while still keeping live clarification authoritative.

## Repair Mode Integration

When the user rejects or corrects a recent bounded execution:

1. detect repair eligibility
2. reconstruct `lastDecisionContext`
3. retrieve compatible repair memory
4. retrieve relevant app/user memory
5. run bounded repair arbiter

So repair mode becomes one memory-aware arbitration slice, not a separate disconnected mechanism.

## Metadata Required For Memory Validation

Memory must carry enough metadata to validate reuse.

Minimum metadata:

- dashboard/screen id
- active widget ids
- widget selection context metadata
- active clarification id / option-set id
- candidate family
- candidate class for each shown option
- selected target id
- alternative targets available at the time
- scope cues used
- timestamp / TTL
- user and tenant scope

Without this metadata, the system cannot know whether old learning is still applicable.

## User Documentation And Explicit Memory

The system should support user-authored memory such as:

- `claude.md`
- stored user rules
- stable preference notes

Those should be retrievable into bounded arbitration just like other user memory.

They should be treated as:

- strong interpretive guidance
- not direct execution authority

## Failure And Rejection Learning

After any incorrect or rejected result:

- preserve the full bounded decision context
- record the rejection/correction
- record the corrected target, if known
- attach UI/routing metadata
- make that record available for future compatible bounded calls

This is how the LLM becomes more helpful over time without unsafe free-form autonomy.

## Clarification-Mediated Writeback Alignment

This plan does not replace the existing durable memory writeback model.

Instead:

- weak or ambiguous phrasing may be clarified, repaired, and successfully resolved through bounded arbitration
- once that resolution ends in a final validated successful outcome, the phrasing may later become learned routing evidence through the existing writeback and promotion pipeline
- clarification-mediated success is valid evidence for learning
- but one clarification-mediated success does not instantly become deterministic authority

Memory-aware arbitration improves interpretation and recovery. Durable learned rows still depend on the normal success, validation, and promotion rules.

## Safety Boundaries

Must always remain true:

- memory never authorizes execution by itself
- current bounded context outranks old memory
- runtime validation outranks memory
- widget context remains secondary unless explicitly chosen or validated
- repair memory cannot jump across incompatible UI state
- the LLM may not invent an unbounded candidate pool from memory

## Implementation Order

### Slice A: Define Memory Package Contract

- input schema for app memory
- input schema for user memory
- input schema for repair memory
- retrieval filters and trust levels

### Slice B: Integrate With Active Clarifier Arbiter

- attach relevant memory package to bounded clarification calls
- keep ordinals deterministic
- preserve current bounded safety rules

### Slice C: Integrate With Repair Mode

- preserve `lastDecisionContext`
- retrieve compatible repair memory
- route rejections/corrections through bounded repair arbitration

### Slice D: Add Memory Recording

- store corrections
- store explicit user rules
- store app-level recurring confusion patterns
- record validation metadata

### Slice E: Add Provenance And Diagnostics

- log which memory layers were used
- log whether memory influenced selection, clarification, or repair
- keep user-facing provenance bounded and simple

## Regression Tests

Must pass:

- active clarifier + user-specific phrasing habit -> better bounded selection in same option family
- active clarifier + explicit user rule from memory -> better bounded clarification wording
- active clarifier + previously corrected target in compatible context -> repair bias helps but does not force execution
- repair correction recorded in one dashboard must not replay in incompatible dashboard
- `no, I meant entry navigator c` -> repair memory recorded and reused only in compatible context
- `what is entries?` with user memory present -> still `inform`, no execute
- active clarifier + unrelated fresh command -> validated escape or clarify, not memory replay

Must not happen:

- memory bypassing current bounded option set
- stale repair memory overriding a different live clarifier
- user documentation directly authorizing execution
- app memory turning an ambiguous label into deterministic execution by itself
