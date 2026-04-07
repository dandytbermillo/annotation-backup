How it works

The routing system is still one shared ladder for uncertain requests across surfaces:

1. Exact deterministic
2. Semantic retrieval / replay
3. Bounded semantic arbitration
4. Surface-specific structured resolution
5. Policy-driven execution
6. Fallback clarification

The important update is that **routing is moving toward structured resolvers by surface family, not more family-specific replay wiring**.

For note commands, the system is moving to:

- a static note command manifest
- a generic note resolver
- a policy-driven executor
- memory as a resolution cache, not the behavior layer

For built-in non-note surfaces, the system is also moving to:

- a dedicated surface-command resolver
- DB-backed seeded + learned query rows as the phrase source of truth
- manifest and live-context validation before execution
- bounded arbiter/LLM handoff when retrieval is useful but not deterministic
- explicit destination-aware and ambiguity-aware execution gating
- clarification-first follow-up handling when the latest assistant turn offered bounded options

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

This is the step where the bounded LLM call happens.

Step 2 may retrieve memory candidates or semantic hints, but Step 2 by itself is not the LLM call.
Those retrieved hints become evidence for Step 3.

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

So the role split is:

- Step 2: retrieve prior exact/semantic evidence
- Step 3: bounded LLM classifies within a fixed schema
- Step 4: the surface resolver produces the canonical normalized command shape
- Step 5: the executor validates and runs it

If confidence is below threshold:

- unresolved
- move to bounded clarification or another bounded non-execution path

If confidence is above threshold:

- hand off to the correct structured resolver path


---

Step 4: Surface-specific structured resolution

This is where the current architecture changes.

There are now two sibling structured-resolution paths:

1. a note resolver for note commands
2. a dedicated surface-command resolver for built-in non-note surfaces

Both use manifests as capability/policy contracts rather than phrase dictionaries.

### Note resolver

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

### Dedicated surface-command resolver

For built-in non-note surfaces, the dedicated surface resolver:

1. retrieves semantic candidates from DB-backed curated seeds and eligible learned rows
2. re-ranks them with live context
3. validates them against the shared surface manifest
4. returns one of three outcomes:
   - high-confidence resolved command
   - medium-confidence candidate hint
   - unresolved / low-confidence

This resolver sits before the bounded arbiter/LLM and is independent of Phase 5 hint-scope logic.

#### High-confidence outcome

- a validated `ResolvedSurfaceCommand`
- deterministic execution
- no LLM fallthrough

#### Medium-confidence outcome

- a structured `SurfaceCandidateHint`
- no direct execution
- bounded arbiter/LLM receives the hint as advisory evidence

#### Low / unresolved outcome

- no interception
- normal bounded arbiter/LLM routing continues

#### Retrieval and fallback model

The phrase layer for non-note surfaces comes from:

- curated seed rows
- eligible learned-success rows

To improve recall without turning code into a phrase parser, the surface resolver may also use:

- lightweight query normalization before retrieval
- deterministic reranking using live context and lexical overlap
- a manifest/runtime-derived fallback hint for low-risk visible surfaces when DB similarity is too weak

That fallback hint:

- is advisory only
- must never directly execute
- exists to reduce avoidable misses on new phrasings before learned rows accumulate

#### Delivery and destination cues

Surface routing now distinguishes:

- **scope** cues
  - choose which conversational/source context the user means
  - examples:
    - `from chat`
    - `from active widget`
- **destination** cues
  - choose where the result should appear
  - examples:
    - `in the chat`
    - `here in the chat`

These cues must not be collapsed into one undifferentiated override rule.

For present/read-style surface requests:

- explicit destination cues such as `in the chat` must outrank generic verbs such as `show`
- a conflicting surface/display candidate must not auto-execute just because retrieval ranked it first
- if no safe compatible candidate remains, the turn should clarify rather than execute the conflicting candidate anyway

This is the reason queries such as:

- `show recent`
  - default to the Recent drawer / surface display
- `list recent entries`
  - default to chat delivery
- `show recent entries in the chat`
  - prefer chat delivery over drawer/display when a validated chat-compatible candidate exists

#### Generic ambiguous panel-open guardrail

Structurally generic panel-open phrases must not execute just because one lane found a plausible panel.

Examples:

- `open entries`
- `show entries`

These phrases may refer to:

- Recent content
- a visible panel titled `Entries`
- a navigator-family panel
- some other bounded candidate set admitted by the same routing scope

So the rule is:

- no panel-open path should execute a generic ambiguous phrase unless the target is sufficiently specific and validated
- this rule must be shared across lanes rather than reimplemented differently in grounding, `/api/chat/navigate`, and `intent-resolver`
- generic phrases should clarify unless:
  - the user supplied a sufficiently specific explicit target, such as `open entry navigator c` or `open links panel cc`
  - or product explicitly approved a safe default for that exact phrase family

This is why:

- `open entry navigator c`
  - may execute deterministically
- `open links panel cc`
  - may execute deterministically
- `open entries`
  - should clarify from the bounded candidate set instead of exact-opening `Entries` or collapsing to a family-specific interpretation by itself

#### Recent ownership stays bounded

The Recent resolver is intentionally narrow.

It may claim queries like:

- `show recent`
- `open recent`
- `show recent widget entries`

But it must not claim a generic content-noun query like:

- `show entries`

unless there is real Recent-family evidence, such as:

- an explicit `recent` / `recently` term
- a validated Recent candidate from retrieval
- typo-tolerant near-match evidence pointing at `recent`
- strong runtime evidence tied to a Recent-specific content request

Without that stronger evidence:

- the Recent resolver should decline ownership
- other bounded candidates may compete
- the turn should clarify rather than being forced to `Recent`

#### Clarification boundary

Clarification is not only a low-confidence arbiter fallback.

It is also required when:

- the user query appears to ask for a specific surface command or specific surface contents
- but the system only has a coarse result such as `panel_widget.state_info`
- and there is no validated specific surface resolution and no accepted hint-assisted execution path

In that case, the app must not confidently execute a broader generic answer such as a visible-panels list.

It should clarify instead, because:

- the broader answer does not actually answer the user’s specific request
- clarification creates a safer path to a validated final resolution
- that validated final resolution is what can justify learned-row writeback later

Clarification is also required when:

- a generic ambiguous panel-open phrase survives with multiple plausible bounded candidates
- the top candidate conflicts with an explicit destination cue such as `in the chat`
- the latest assistant turn already asked a bounded clarification question and the user is still plausibly answering that clarification

So clarification is not only a terminal fallback step.
It is also an explicit safety tool used to prevent unsafe execution when:

- the system has bounded candidates but not enough specificity to execute
- the latest clarification context and active-surface context conflict
- a generic phrase would otherwise auto-execute differently across lanes

#### Clarification-first follow-up context

The router now treats the latest clarification and the active/just-opened surface as separate bounded context signals with a fixed order:

1. explicit current-turn scope, explicit destination, or explicit specific target
2. latest active clarification
3. active or just-opened surface
4. general routing

This means:

- the latest clarification stays primary for option-like follow-ups
- active or just-opened surface context stays strong for referential follow-ups such as `read it` or `what does it say`
- focus changes alone do **not** make the clarification stale

So if the assistant just offered options including `Entries`, and the user replies:

- `open entries`

the router should usually treat that as a clarification-follow-up or clarification-confirmation attempt before it treats it as a fresh command.

Likewise, if a panel is active and the user says:

- `read it`
- `show me the content`

then active-surface continuity may win, but only because the follow-up is referential, not merely because a panel is visible.

Conflict rule:

- if clarification context and active-surface context point to different plausible targets
- do not execute
- reuse the bounded candidate set and ask a tighter clarifier instead

Single-owner rule:

- one shared helper must own clarification-state clearing, recoverable-source validation, and context-winner selection
- no lane should clear active clarification state before that shared decision runs
- otherwise the same phrase can still loop as a fresh command in one lane and a clarification follow-up in another

---

Step 5: Policy-driven execution

After note resolution, execution happens by policy, not by raw phrasing.

For non-note surface commands, policy-driven execution now also means:

- execution authority comes from validated structured resolution, not from raw phrase similarity alone
- explicit destination constraints must be checked before execution
- generic ambiguous panel-open phrases must not execute without sufficient specificity
- if bounded arbitration declines or returns an unusable answer, the app must fail open to candidate-backed clarification rather than free-form execution

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

Clarification happens when:

- deterministic routing is not certain
- memory reuse is not safe
- surface/family confidence is too low
- anchor resolution is ambiguous
- required scope is missing
- explicit target specificity is required but only contextual resolution exists
- generic ambiguous panel-open phrases remain unresolved across the bounded candidate set
- the current turn conflicts with an explicit destination cue
- latest clarification context and active-surface context remain in conflict

Examples:

- `Do you mean the note in the current entry or the similarly named note in another workspace?`
- `Do you want the Recent panel, or do you want recent entries listed here in chat?`
- `I found multiple matching panels for "entries". Which one do you want to open?`

Clarifier is still bounded and policy-driven.
It is not a free-form guess, and it is not only a last-resort terminal fallback.
It is also the correct safety outcome when the system has a bounded candidate set but not enough specificity to execute safely.

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



There are two different kinds of reuse, and they solve different
problems:

### 1. `Memory-Exact` or exact command reuse

This is about **behavior reuse**.

Question:

- have we already seen this exact query in a compatible context?
- if yes, can we safely reuse the same interpreted command or action?

If the answer is yes:

- the system can skip some routing work
- it can reuse the prior interpreted command shape
- it still must revalidate current context when the family requires it

This is what drives:

- exact resolved-command reuse
- exact action reuse where safe
- `Memory-Exact`-style behavior

### 2. Embedding reuse

This is about **vector generation cost**, not action safety.

Question:

- do we already have an embedding for this exact normalized query text with a compatible embedding model version?

If yes:

- the system may be able to avoid a new embedding API call

But that does **not** mean:

- the old action is safe to replay
- the old answer text is safe to reuse
- the current anchor or target assumptions are still valid

### Important distinction

A query may reuse:

1. its prior interpreted action or command
2. its prior embedding vector

These are related, but they are not the same layer.

### What the current implementation actually does

Today, this codebase only has a **small server-side in-process embedding cache** keyed by query fingerprint.

Implementation nuance:

- conceptually, embedding reuse should be tied to embedding model/version compatibility
- currently, the in-process cache key is just the query fingerprint because the embedding model/version is fixed in code today

That means:

- exact repeated queries may avoid a new embedding API call if they hit the in-memory cache in the current server process
- but the system does **not** currently implement a DB-level exact-query embedding cache that reloads a previously stored embedding from the database to skip embedding generation

So:

- `Memory-Exact` reuse is about safe command/action reuse
- embedding reuse is about reducing vector generation cost
- current exact embedding reuse is only via the server’s in-memory cache, not via database round-trip reuse of stored embeddings

### Similar versus exact queries

For a merely similar query, a stored prior embedding does **not** let the system skip embedding the new query.

Why:

- semantic search still needs a vector for the new query text
- the old stored embeddings act as the search corpus
- but the new query usually still needs its own embedding

So the practical rule is:

- exact repeated query -> may reuse command interpretation and may hit the in-process embedding cache
- similar query -> may benefit from stored semantic corpus, but still usually needs a fresh query embedding



Scenario where semantic retrieval is useful:

When the user phrasing is slightly different, but the same or very similar intent has already succeeded before.

The flow below describes the intended behavior for the note-manifest architecture.
It is not a claim that every active semantic path in the broader routing stack already behaves this way.

Example:

- current user query:
  - `take me to the project plan note`
- prior successful rows in memory:
  - `open note project plan`
  - `go to note project plan`

This is where semantic retrieval helps.

### Safe flow

1. in the current implementation, the new query still gets embedded
- because the phrasing is different
- exact-query reuse does not apply
- the previously stored embeddings act as retrieval corpus, not as a substitute for the new query vector

2. semantic lookup retrieves close prior matches from the database
- similar intent
- similar anchor or target pattern
- similar successful history

3. retrieved matches are used as hints, not as authority
- they can reduce ambiguity
- they can help a bounded LLM infer likely structured intent
- they can help the resolver infer likely family/subtype and argument shape
- they do not by themselves authorize replay or direct execution

4. bounded LLM should decide structured intent or provide a classification hint, not final raw execution
- good:
  - `surface=note`
  - `intentFamily=navigate`
  - `intentSubtype=open_note`
  - maybe a `noteTitle` hint
- bad:
  - “just execute this exact old command from memory”
- in practice, the LLM should help with likely family, subtype, and candidate arguments
- it should not be the final authority for the exact executable command

5. the resolver remains the canonical producer of the normalized command shape
- it turns the query plus any safe hints into:
  - family
  - subtype
  - arguments
  - confidence
  - policy
- this is the point where the app normalizes the intent into the manifest-backed command contract

6. the executor still resolves and validates the concrete target before execution
- resolve the actual note target
- validate anchor and scope
- clarify if ambiguous
- then execute
- for `open_note`, the final concrete target may still depend on live note resolution and clarification

### Important safety rule

The safe flow is:

- semantic retrieval finds close prior examples
- bounded LLM may use them as evidence to infer likely structured intent
- the structured resolver produces the canonical command shape
- the executor validates and runs it

Not:

- semantic match -> bounded LLM -> direct command execution with no resolver or validation

That shortcut is too risky because similar phrasing does not guarantee:

- the same target
- the same anchor
- the same current state
- the same safe action

### Practical meaning

Semantic retrieval is the right tool for slightly different phrasing.

For the note-manifest architecture, it should be used to improve:

- classification
- argument hints
- confidence
- candidate command-family selection

It should not replace:

- resolver authority
- deterministic validation
- executor policy

Current broader-system caveat:

- B2 semantic lookup still behaves as a hint-producing lane in the shared routing ladder
- but the broader current routing stack also contains a Stage 5 semantic replay path that may directly replay when eligible
- that existing Stage 5 behavior is separate from the intended note-manifest resolver/executor flow described above
