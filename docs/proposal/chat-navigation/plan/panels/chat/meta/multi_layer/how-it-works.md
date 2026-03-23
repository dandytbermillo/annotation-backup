How it works

The routing system is still one shared ladder for uncertain requests across surfaces:

1. Exact deterministic
2. Semantic retrieval / replay
3. Bounded semantic arbitration
4. Surface-specific structured resolution
5. Policy-driven execution
6. Fallback clarification

The important update is that **notes are no longer headed toward more family-specific replay wiring**.

For note commands, the system is moving to:

- a static note command manifest
- a generic note resolver
- a policy-driven executor
- memory as a resolution cache, not the behavior layer

That is the current implementation direction.

---

Step 1: Exact deterministic

This still runs first.

It handles only things the app can identify safely with high certainty:

- ordinals like `1`, `second`, `last`
- exact validated commands and exact known targets
- hard safety exclusions
- exact obvious wins

If deterministic is truly certain:

- it resolves immediately

If not:

- it must not guess
- it passes the turn forward

For notes, this also includes obvious exact note-state questions where current live state is enough.

---

Step 2: Semantic retrieval / replay

Before any new semantic interpretation, the broader routing system can still try memory:

- B1 exact memory lookup
- B2 semantic memory lookup
- Stage 5 replay / exact reuse

But memory is only valid when:

- the stored interpretation is still compatible with current validation
- the action family is safe to reuse
- the system still re-runs live policy execution where required

For notes, this means:

- in the long term, memory may reuse the interpreted command shape
- memory must not become the authority for stale answer text
- memory must not directly replay note mutations

For the initial note-manifest rollout, the implementation direction is still deterministic-first:

- manifest metadata and current note/context state come first
- broader note retrieval/replay remains secondary and can be expanded later if runtime evidence justifies it

So memory remains part of the overall routing ladder, but it is not the primary mechanism for the first note-manifest slice.

---

Step 3: Bounded semantic arbitration

If deterministic and replay do not settle the turn, the app can call a bounded semantic arbiter.

The arbiter does not execute anything.
It only returns a typed routing decision, such as:

- `surface=note, intentFamily=state_info`
- `surface=note, intentFamily=navigate`
- `surface=note, intentFamily=read_content`
- `surface=panel_widget, intentFamily=state_info`
- `surface=workspace, intentFamily=state_info`
- `surface=unknown, intentFamily=ambiguous`

This remains bounded because:

- fixed schema
- confidence score
- no freeform tool execution
- no direct side effects

If confidence is below threshold:

- unresolved
- move to clarification or safe fallback

If confidence is above threshold:

- hand off to the correct structured resolver path

---

Step 4: Surface-specific structured resolution

This is where the current note architecture changes.

For notes, the long-term design is:

1. a **note command manifest** defines supported note command families
2. a **generic note resolver** maps note-oriented user input into one `ResolvedNoteCommand`
3. the resolved command carries:
   - family
   - subtype
   - anchor source
   - selector mode
   - arguments
   - confidence
   - execution policy
   - replay policy
   - clarification policy

So note routing stops being “one more family-specific replay patch” and becomes one structured command contract.

### Note command manifest

The manifest is a capability/policy contract, not a phrase dictionary.

It defines things like:

- `state_info.active_note`
- `navigate.open_note`
- later:
  - `read.summary`
  - `read.question`
  - `capability.can_edit`
  - `mutate.rename_note`

Each manifest entry declares:

- examples
- required arguments
- anchor requirements
- execution policy
- replay policy
- clarification policy
- safety rules

### Generic note resolver

The generic note resolver maps note-oriented user input into a structured command.

Its job is to:

- identify the note family
- identify the subtype
- determine anchor source
- extract arguments
- compute confidence
- choose the policy declared by the manifest

The current implementation direction is:

1. lightweight deterministic note-surface detection first
2. manifest-backed note resolution second
3. existing arbiter remains fallback when surface confidence is uncertain

This avoids creating a second fully separate routing stack while also avoiding ad hoc note-family branching.

### Initial rollout scope

The first implementation slice only covers:

- `state_info.active_note`
- `navigate.open_note`

That means the first resolved note commands will cover queries like:

- `which note is open?`
- `what note am I in?`
- `open note Project Plan`

This slice is intentionally narrow.

It is meant to prove the architecture, not to solve every note query at once.

It is not the full end-state scope. Later phases extend the same manifest/resolver/executor model to:

- `read.*`
- `capability.*`
- later, carefully:
  - `mutate.*`

---

Step 5: Policy-driven execution

After note resolution, execution happens by policy, not by raw phrasing.

### state_info

Execution policy:

- `live_state_resolve`

Behavior:

- always re-resolve current live note/workspace state
- never return stale cached answer text

Examples:

- `Which note is open?`
- `What note am I in?`

### navigate

Execution policy:

- `navigate_note`

Behavior:

- resolve the actual target note and scope
- execute the existing note navigation path
- clarify if duplicate or ambiguous targets remain

Example:

- `open note Project Plan`

### read

Execution policy:

- `stage6_grounded_answer`

Behavior:

- resolve the note anchor
- run Stage 6 against current note content
- regenerate the answer from current content

Important:

- memory reuse here is **interpretation reuse**
- not instant deterministic replay of old answer text

### capability

Execution policy:

- `bounded_capability_answer`

Behavior:

- return bounded support/capability response
- do not turn into mutation execution

### mutate

Execution policy:

- `confirm_then_mutate` or `blocked`

Behavior:

- require explicit safety policy
- do not directly replay side effects from memory

---

Step 6: Fallback clarification

Clarification happens only when:

- deterministic routing is not certain
- memory reuse is not safe
- surface/family confidence is too low
- anchor resolution is ambiguous
- required scope is missing
- explicit target specificity is required but only contextual resolution exists

Examples:

- `Do you mean the note in the current entry or the similarly named note in another workspace?`

Clarifier remains the last resort, not the early default.

---

How note memory works now

For notes, memory is moving toward **resolution caching** instead of bespoke replay behavior.

That means memory stores:

- the resolved family
- the resolved subtype
- anchor interpretation
- extracted arguments
- policy metadata
- manifest version
- handler id

And it does **not** store as the final source of truth:

- stale live-state answers
- stale note-content answers
- unchecked target assumptions
- unsafe mutation results

So:

- `state_info` memory reuse still re-runs live state resolution
- `navigate` memory reuse still re-runs navigation with current validation
- `read` memory reuse still regenerates content answers from current content

---

How migration works now

The note plan is now staged around the manifest architecture.

### Phase 1

Define the static contract:

- note manifest module
- manifest entry type
- command schema
- execution/replay/clarification enums

No runtime behavior change is required yet.

### Phase 2

Build the first generic note resolver slice for:

- `state_info.active_note`
- `navigate.open_note`

This gives unit-testable resolved note commands.

### Phase 3

Add policy-driven executor integration for those same families.

This is where runtime behavior begins to move onto the new architecture.

### Phase 4

Attach memory as resolution acceleration:

- cache the resolved command schema
- revalidate against current manifest version and note context
- keep live execution behavior

### Phase 5

Extend to additional note families after runtime evidence:

- `read.*`
- `capability.*`
- later, carefully:
  - `mutate.*`

This ordering is deliberate:

- start with deterministic-safe note families first
- avoid pulling Stage 6, capability, and mutation complexity into the first slice

---

Why this solves the current problem better

The older note direction risked growing into:

- more family-specific replay builders
- more validator branches
- more client/server seams
- more one-off patches per query family

The new note direction scales by improving:

- one manifest
- one resolver
- one executor model
- one memory/cache contract

So growth happens in:

- better note interpretation
- better anchor resolution
- better execution policies

Not in:

- more special-case replay plumbing

---

Concrete examples

User:

- `which note is open?`

Flow:

1. the shared routing ladder may first check deterministic and memory paths
2. if those do not already settle the turn, note-surface detection says this is clearly note-targeted
3. the note resolver emits:
   - `family=state_info`
   - `subtype=active_note`
   - `anchor=active_note`
   - `executionPolicy=live_state_resolve`
4. the executor re-resolves current live state
5. answer:
   - `The open note is Main Document.`

Another example:

User:

- `open note Project Plan`

Flow:

1. the shared routing ladder may first check deterministic and memory paths
2. if those do not already settle the turn, the note resolver emits:
   - `family=navigate`
   - `subtype=open_note`
   - `selectorMode=explicit`
   - `arguments.noteTitle=Project Plan`
   - `executionPolicy=navigate_note`
3. the executor resolves the actual note target
4. if multiple matches remain:
   - clarify
5. otherwise execute note navigation

Later example:

User:

- `summarize this note`

Flow:

1. after the shared routing ladder reaches the note path, the note resolver emits:
   - `family=read`
   - `subtype=summary`
   - anchored to the current note
2. the executor uses:
   - `stage6_grounded_answer`
3. Stage 6 regenerates the answer from current content

---

In one sentence

The current direction keeps the shared routing ladder, but for notes it replaces growing replay-specific wiring with:

- a manifest for capability and policy
- a generic note resolver for structured interpretation
- a policy-driven executor for live behavior
- and memory as resolution acceleration, not the behavior layer
