# Active Clarifier Bounded Candidate Flow

## Purpose

Document the intended decision flow when a clarification is active and the next user turn may be:

- a clarification answer
- a different validated navigation/action request
- a request grounded in bounded context beyond the shown clarifier options

This note reflects the intended bounded-selection model after the semantic-first active-clarifier update.
It is aligned to the current semantic-first proposal for active clarification. Where broader target architecture is useful but not yet part of the approved scope, it is called out explicitly as a future extension.
Detailed implementation and rollout rules live in `semantic-first-active-clarifier-escape-plan.md`; this file is the shorter architecture summary.
The capability-preservation rule lives in `lane-removal-capability-preservation-plan.md`.

## Core Rule

When a clarifier is active, the system should not force a false binary between:

- "answer the clarifier"
- "show the clarifier again"

Instead, it should build one bounded decision surface and let the bounded arbiter choose from that closed set.

## Candidate Classes

The bounded decision surface for active clarification should include:

1. Active clarifier options
   - The current options shown to the user.

2. Bounded retrieval candidates
   - B1 exact replay candidates
   - learned/seeded semantic candidates
   - non-note active-panel item candidates for explicit validated item actions
   - note-sibling candidates validated by the note-specific contract

3. Active widget/panel context
   - Secondary evidence only
   - Not a separate candidate pool in the current scope

Explicitly excluded from the active-clarifier candidate set:

- surface escape candidates as a competing owner lane
- known-command / known-noun as separate competing winner lanes

The current scope commits to:

- active clarifier options
- B1 exact replay candidates
- learned/seeded semantic candidates
- non-note active-panel item candidates for explicit validated item actions
- note-sibling candidates validated by the note-specific contract
- active widget/panel context as secondary evidence

### Future Extension: Broader Visible-Content Candidates

A broader candidate model may later add wider visible-content candidate support beyond the current narrow active-panel item rule.

The current scope already supports explicitly named, validated active-panel items (e.g., "open budget100" when budget100 is validated in the active panel). A future extension could broaden this to:

- positional references ("open the third visible item")
- demonstrative references ("open that item in the panel")
- broader visible-content matching across multiple panels

That broader model is not part of the current contract. The current narrow active-panel item rule (per the parent plan) requires: explicit user naming, validated item presence, manifest support, and grounded active-panel context — not general visible-content guessing.

## Intended Flow

1. Clarifier authority stays active.
   - No direct executor should steal the turn while clarification or paused clarification is live.

2. Upstream lanes collect bounded evidence only.
   - They do not execute.
   - They contribute candidates.
   - Surface and known-command may still exist outside clarification, but they do not own the active-clarifier turn.
   - Removing a lane here does not mean deleting surface-manifest/runtime policy capability.

3. Evidence/candidates are assembled into one bounded surface:
   - active clarifier options
   - B1 exact replay candidates
   - learned/seeded semantic candidates
   - non-note active-panel item candidates
   - note-sibling candidates
   - active widget/panel context as secondary evidence

4. Shared validation filters candidates before and after arbitration.
   - Hard product rules survive lane removal.
   - Examples: duplicate-family ambiguity, visibility/unavailability, docs/open guard, current-state compatibility.
   - Notes remain on the note sibling contract, not the generic surface-item path.

5. The bounded LLM/arbiter chooses among that closed set.
   - select clarifier option
   - select B1 or semantic candidate
   - ask to clarify if unresolved

6. Code executes only after the decision.
   - The LLM selects.
   - The runtime executes.

## Learned/Seeded Semantic Role

Learned rows and curated seeds are the primary fuzzy/typo/paraphrase support for active-clarifier alternate commands.

Examples:

- `opeen recent`
- `open recnet`
- `can you open recent widget`

These semantic rows are:

- bounded hints
- not direct execution authority

They should become candidate inputs to the arbiter, not bypasses around it.

Exact active-clarifier command families must not depend on surface as the owner lane.
Those exact commands should be satisfied by:

- semantic seeds/hints, or
- a stronger exact B1 candidate when one exists

## No-Clarifier Contrast

Outside active clarification, older direct paths may still handle inputs like `opeenn recent` via the surface resolver or known-command routing.

That success does not prove the active-clarifier semantic escape path is correct.

The active-clarifier path is stricter:

- it should convert the allowed sources into bounded candidates
- then decide through the arbiter

## Safety Rules

1. No fixed precedence between candidate sources.
   - If multiple bounded sources produce candidates, all go to the arbiter.

2. No direct execution from retrieval.
   - B1 and semantic candidates are bounded inputs until selected and validated.

3. Surface and known-command do not remain owner lanes during active clarification.
   - Their useful product rules survive as shared validation/guards.
   - Surface-manifest execution policy, visibility checks, container compatibility, and built-in widget semantics remain required.
   - Notes remain a separate bounded sibling contract and should not be collapsed into the non-note surface-item rule.

4. Active widget/panel context is secondary evidence.
   - It informs arbitration but does not silently replace chat clarification.

5. Execution happens after selection.
   - Candidate generation is separate from execution.

6. Family-gated rollout is required.
   - A family should not lose surface/known-command ownership until it has semantic seed or B1 coverage, migrated validation, and regression coverage.
   - Non-note active-panel item behavior uses this normal family gate.
   - Note-sibling bounded behavior must be gated separately from generic non-note `panel_type` families.

7. Semantic-unavailable fallback is explicit.
   - If semantic is disabled, times out, or is empty for a migrated family:
   - B1 exact may still win if present.
   - Otherwise clarify.
   - Do not silently fall back to removed owner lanes.

## Practical Decision Ladder

1. Collect active clarifier options.
2. Collect B1 exact replay candidates.
3. Collect learned/seeded semantic candidates.
4. Collect non-note active-panel item candidates for explicit validated item actions.
5. Collect note-sibling candidates validated by the note-specific contract.
6. Collect active widget/panel context as secondary evidence otherwise.
7. Apply pre-arbiter validation/filtering.
8. Run bounded arbiter over the combined set.
9. Apply final post-selection validation.
10. Execute chosen target, or re-clarify if unresolved.

Multi-intent detector (per parent plan):

- command verb + question form in one turn
- conjunction sequencing such as `and`, `then`, `also` joining distinct intents
- multiple executable command verbs with different objects

Polite-wrapper exclusion: do not mark a turn as mixed solely because it uses a polite or hedged single-intent command wrapper (e.g., `can you open recent`, `could you please open the recent widget`).

Mixed-source examples that must remain bounded:

- clarifier option + non-note active-panel item candidate
- non-note active-panel item candidate + note-sibling candidate
- note-sibling candidate + clarification reply

These must not direct-execute unless one dominant executable intent is clearly isolated.

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

- use one bounded retrieval stage during active clarification
- let B1 serve as the strongest exact-memory signal
- let semantic serve as the primary fuzzy/typo/paraphrase signal
- use LLM help when thresholds are low or candidates compete
- re-show the clarifier only when nothing resolves cleanly

The current scope applies that architecture to:

- active clarifier options
- B1 exact replay candidates
- learned/seeded semantic candidates
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
