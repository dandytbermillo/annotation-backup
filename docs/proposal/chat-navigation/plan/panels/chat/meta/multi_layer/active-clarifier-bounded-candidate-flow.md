# Active Clarifier Bounded Candidate Flow

## Purpose

Document the intended decision flow when a clarification is active and the next user turn may be:

- a clarification answer
- a different validated navigation/action request
- a request grounded in bounded context beyond the shown clarifier options

This note reflects the intended bounded-selection model discussed during investigation of the `open recent` escape bug.
It is aligned to the current detailed plan. Where broader target architecture is useful but not yet part of the approved plan, it is called out explicitly as a future extension.

## Core Rule

When a clarifier is active, the system should not force a false binary between:

- "answer the clarifier"
- "show the clarifier again"

Instead, it should build one bounded decision surface and let the bounded arbiter choose from that closed set.

## Candidate Classes

The bounded decision surface in the current detailed plan should include:

1. Active clarifier options
   - The current options shown to the user.

2. Validated escape candidates
   - B1 exact replay candidates
   - surface-resolver candidates
   - known-noun candidates
   - learned/seeded semantic candidates

3. Active widget/panel context
   - Secondary evidence only
   - Not a separate candidate pool in the current approved plan

The detailed plan currently commits to:

- active clarifier options
- validated escape targets
- active widget/panel context as secondary evidence

### Future Extension: Bounded Visible-Content Candidates

A broader candidate model may later add:

- concrete items currently visible in active widgets/panels
- only when bounded and relevant to the current turn

That broader model is useful for cases like:

- "pick option 2"
- "open Recent instead"
- "open budget100 from the visible Recent panel"

But that visible-content candidate pool is not part of the exact current-plan contract yet.

## Intended Flow

1. Clarifier authority stays active.
   - No direct executor should steal the turn while clarification or paused clarification is live.

2. Upstream lanes collect bounded evidence only.
   - They do not execute.
   - They contribute candidates.

3. Evidence/candidates are assembled into one bounded surface:
   - active clarifier options
   - validated escape candidates
   - active widget/panel context as secondary evidence

4. The bounded LLM/arbiter chooses among that closed set.
   - select clarifier option
   - select escape candidate
   - ask to clarify if unresolved

5. Code executes only after the decision.
   - The LLM selects.
   - The runtime executes.

## Learned/Seeded Semantic Role

Learned rows and curated seeds should support typo/noise handling for escape-like turns during active clarification.

Examples:

- `opeen recent`
- `open recnet`
- `can you open recent widget`

These semantic rows are:

- bounded hints
- not direct execution authority

They should become candidate inputs to the arbiter, not bypasses around it.

## No-Clarifier Contrast

Outside active clarification, an older direct path may still handle inputs like `opeenn recent` via the surface resolver.

That success does not prove the active-clarifier semantic escape path is correct.

The active-clarifier path is stricter:

- it should convert sources into bounded candidates
- then decide through the arbiter

## Safety Rules

1. No fixed precedence between candidate sources.
   - If multiple bounded sources produce candidates, all go to the arbiter.

2. No direct execution from semantic retrieval.
   - Learned/seeded semantic rows are hint-only until selected.

3. Active widget/panel context is secondary evidence.
   - It informs arbitration but does not silently replace chat clarification.

4. Execution happens after selection.
   - Candidate generation is separate from execution.

## Practical Decision Ladder

1. Collect active clarifier options.
2. Collect validated escape candidates.
3. Collect active widget/panel context as secondary evidence.
4. Run bounded arbiter over the combined set.
5. Execute chosen target, or re-clarify if unresolved.

### Future Extension Ladder

If the architecture is later broadened, an extended bounded surface may add:

1. Active clarifier options.
2. Validated escape candidates.
3. Bounded visible-content candidates from active widgets/panels.
4. Run bounded arbiter over the expanded set.
5. Execute chosen target, or re-clarify if unresolved.

## Why This Matters

This model prevents the system from failing on turns that are clearly not clarifier answers but are still grounded in bounded context.

It also matches the desired architecture:

- use learned/seeded bounded evidence first
- use LLM help when thresholds are low or the phrasing is noisy
- re-show the clarifier only when nothing resolves cleanly

The current approved plan applies that architecture to:

- active clarifier options
- validated escape targets
- widget/panel context as secondary evidence

It does not yet formally promote visible panel/widget contents into their own bounded candidate pool.

## Anti-Pattern Applicability

The isolation/reactivity anti-pattern guidance is not applicable here.

This flow concerns:

- routing
- bounded candidate assembly
- arbiter contract
- deferred execution

It does not introduce provider/consumer API drift or new reactive context hooks.
