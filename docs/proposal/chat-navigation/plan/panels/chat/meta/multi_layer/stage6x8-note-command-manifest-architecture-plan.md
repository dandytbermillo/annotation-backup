# Plan: Stage 6x.8 — Note Command Manifest and Policy-Driven Execution

## Context

The existing note replay plan established several useful ideas:

- note queries need their own contract and should not be forced into the panel registry
- target identity and query specificity must be kept separate
- note queries need explicit anchor metadata
- replay must remain policy-driven and safety-checked
- mutation requests must stay conservative

Those ideas are sound.

What does not scale is the long-term implementation pattern of adding more family-specific:

- writeback branches
- validator branches
- replay action shapes
- client replay seams

That approach is acceptable for a small tactical slice such as:

- `which note is open?`
- `open note Project Plan`

It is not a good main architecture for the broader note surface, where users can issue many command families with many phrasings and a long tail of note-specific requests.

Anti-pattern applicability: **not applicable**. This is routing/command-contract work, not React/provider reactivity work.

## Goal

Replace note-family-specific replay expansion as the main strategy with a manifest-driven note command architecture that:

1. defines a stable note command schema
2. uses one generic note resolver to map user input into that schema
3. uses policy-based execution instead of one replay contract per family
4. keeps memory as a routing acceleration layer, not the source of behavior
5. adapts the useful semantics and safety rules from the previous note replay plan

## Non-goals

This plan does **not**:

- enumerate every possible raw note phrasing
- replace Stage 6 content answering with a phrase lookup table
- move notes into the panel/widget manifest registry
- make note mutations directly replayable by default
- delete the narrow Phase A replay work if it is already partially implemented

## Core Decision

Use a **note command manifest** plus a **generic note resolver** and a **policy-driven note executor**.

The manifest is a capability and policy contract, not a giant dictionary of literal user phrases.

The architecture becomes:

1. static manifest defines what note commands exist
2. generic resolver maps user input into a manifest-shaped command
3. executor runs the policy for that command
4. memory stores successful resolved command shapes and exact-query reuse hints

Memory remains useful, but it is no longer the architectural center.

## What We Keep From the Previous Plan

The previous note replay plan contains valuable semantic and safety work. Keep these parts.

### 1. Note family taxonomy

Preserve these top-level command families:

- `state_info`
- `navigate`
- `read`
- `capability`
- `mutate`

These become manifest families instead of separate long-term replay lanes.

### 2. Target identity vs query specificity

Keep the distinction between:

- target identity: which note or note set the command operates on
- query specificity: whether the user explicitly named the target or relied on context

This remains critical for:

- clarification policy
- memory reuse
- mutation safety
- follow-up handling

### 3. Anchor-source modeling

Keep note anchor sources from the prior plan:

- `active_note`
- `resolved_reference`
- `followup_anchor`

These should move into the generic note command schema.

### 4. Execution-policy distinctions

Keep the family-specific execution rules:

- `state_info` -> live state re-resolution
- `navigate` -> deterministic navigation execution
- `read` -> Stage 6 grounded answer on current note content
- `capability` -> bounded capability/support answer
- `mutate` -> confirmation or explicit safety gate, no blind replay

### 5. Replay and safety rules

Keep these rules from the prior plan:

- do not reuse stale live-state answers
- do not reuse stale content answers
- always revalidate anchors before reuse
- keep mutation execution conservative
- use UPSERT self-upgrade so learned rows do not remain stale forever

### 6. Memory as an acceleration layer

Keep exact-query memory, but reinterpret what it stores:

- resolved family
- resolved subtype
- anchor interpretation
- extracted arguments
- execution-policy hint

Do **not** treat memory as authority for:

- stale answer text
- unchecked target assumptions
- direct unsafe side effects

## Note Command Manifest

Each note surface should expose a technical contract file or code-defined manifest that describes supported command families and their policies.

The manifest should define, at minimum:

- `surface`
- `manifestVersion`
- `intentFamily`
- `intentSubtype`
- `examples`
- `requiredArguments`
- `optionalArguments`
- `anchorRequirements`
- `selectorMode`
- `executionPolicy`
- `replayPolicy`
- `clarificationPolicy`
- `safetyRules`
- `handlerId`

### Manifest shape

```ts
type NoteCommandManifestEntry = {
  surface: 'note';
  manifestVersion: string;
  intentFamily: 'state_info' | 'navigate' | 'read' | 'capability' | 'mutate';
  intentSubtype: string;
  examples: string[];
  requiredArguments?: string[];
  optionalArguments?: string[];
  anchorRequirements?: {
    allowActiveNote?: boolean;
    allowResolvedReference?: boolean;
    allowFollowupAnchor?: boolean;
    requireSpecificTarget?: boolean;
  };
  selectorMode: 'explicit' | 'contextual' | 'either';
  executionPolicy:
    | 'live_state_resolve'
    | 'navigate_note'
    | 'stage6_grounded_answer'
    | 'bounded_capability_answer'
    | 'confirm_then_mutate'
    | 'blocked';
  replayPolicy:
    | 'cache_resolution_only'
    | 'safe_with_revalidation'
    | 'never_direct_replay';
  clarificationPolicy:
    | 'clarify_on_ambiguous_target'
    | 'clarify_on_low_confidence'
    | 'no_clarification';
  safetyRules: string[];
  handlerId: string;
};
```

The manifest should live at the family/policy level. It should not attempt to list every raw note query variant.

### Manifest location and runtime enforcement

Use one code-owned manifest module for note commands rather than scattering entries across prompts or handlers.

Recommended structure:

- `lib/chat/note-command-manifest.ts`
  - exports typed manifest entries
  - exports manifest version
  - exports lookup helpers by family/subtype

- optional follow-up helpers in:
  - `lib/chat/note-command-manifest-types.ts`
  - `lib/chat/note-command-manifest-validators.ts`

Runtime enforcement rules:

1. resolver may only emit `ResolvedNoteCommand` values backed by a manifest entry
2. executor must look up the manifest entry before execution and reject mismatches
3. memory reuse must compare stored `manifestVersion` and `handlerId` against the current manifest before reuse
4. contract tests should fail if any executor policy references a missing or stale manifest entry

## Generic Note Command Schema

The runtime resolver should normalize note requests into one command schema.

### Command schema

```ts
type ResolvedNoteCommand = {
  surface: 'note';
  manifestVersion: string;
  intentFamily: 'state_info' | 'navigate' | 'read' | 'capability' | 'mutate';
  intentSubtype: string;
  noteAnchor: {
    source: 'active_note' | 'resolved_reference' | 'followup_anchor' | 'explicit_note';
    noteId?: string;
    noteIds?: string[];
    isValidated: boolean;
  };
  targetScope?: {
    workspaceId?: string;
    entryId?: string;
  };
  selectorMode: 'explicit' | 'contextual';
  arguments: Record<string, string | string[] | boolean | null>;
  confidence: 'high' | 'medium' | 'low';
  executionPolicy: NoteCommandManifestEntry['executionPolicy'];
  replayPolicy: NoteCommandManifestEntry['replayPolicy'];
  clarificationPolicy: NoteCommandManifestEntry['clarificationPolicy'];
};
```

This schema is the durable contract between:

- resolver
- executor
- memory/cache layer
- validator

For navigation-family commands, `targetScope` or normalized scope keys in `arguments`
must preserve enough information to distinguish duplicate note titles across workspaces
or entries. Do not rely on bare note title alone when current navigation requires scope.

### Persisted cache payload shape

The memory layer should persist the resolved command schema in a stable serialized shape.

Recommended stored payload:

```ts
type StoredResolvedNoteCommand = {
  surface: 'note';
  manifestVersion: string;
  handlerId: string;
  intentFamily: 'state_info' | 'navigate' | 'read' | 'capability' | 'mutate';
  intentSubtype: string;
  noteAnchor: {
    source: 'active_note' | 'resolved_reference' | 'followup_anchor' | 'explicit_note';
    noteId?: string;
    noteIds?: string[];
  };
  targetScope?: {
    workspaceId?: string;
    entryId?: string;
  };
  selectorMode: 'explicit' | 'contextual';
  arguments: Record<string, string | string[] | boolean | null>;
  executionPolicy: NoteCommandManifestEntry['executionPolicy'];
  replayPolicy: NoteCommandManifestEntry['replayPolicy'];
  clarificationPolicy: NoteCommandManifestEntry['clarificationPolicy'];
  validationHints?: {
    requiresActiveNote?: boolean;
    requiresOpenNote?: boolean;
    requiresFollowupAnchor?: boolean;
    requiresScopeMatch?: boolean;
  };
};
```

This is the cache payload. It is not the final answer payload.

## Generic Note Resolver

Build one resolver that maps note-oriented user input into `ResolvedNoteCommand`.

Its responsibilities:

1. determine whether the query targets the note surface
2. classify `intentFamily` and `intentSubtype`
3. resolve anchor source and target specificity
4. extract arguments
5. choose execution, replay, and clarification policy from the manifest
6. emit a structured command with confidence

This replaces the idea of adding one new replay contract for each new note query family.

### Confidence and clarify thresholds

Confidence must be computed from concrete signals, not intuition.

Recommended signals:

- explicit note-title or note-id match quality
- anchor-source quality
- argument extraction completeness
- workspace/entry scope match quality
- family/subtype classifier agreement

Operational rules:

1. `high`
- direct execution is allowed when required anchors and arguments are present
- memory may cache and reuse the resolved command schema

2. `medium`
- allow execution only when the manifest family says clarification is not required and deterministic validation fully succeeds
- otherwise clarify

3. `low`
- do not execute
- clarify or fall through to bounded safe fallback

Clarification wins over execution when:

- confidence is below the family threshold
- ambiguity remains after anchor resolution
- required scope fields are missing
- the command requires explicit target specificity but only contextual resolution is available

## Policy-Driven Note Executor

Build one note executor that consumes `ResolvedNoteCommand`.

Execution depends on policy, not on raw phrasing.

### Policy behavior

1. `live_state_resolve`
- used for `state_info`
- always re-resolve current state
- never return stale cached answer text

2. `navigate_note`
- used for `navigate`
- execute note navigation once the target is resolved
- validate target and scope as needed

3. `stage6_grounded_answer`
- used for `read`
- resolve current note anchor
- regenerate answer from current note content
- memory may skip some routing work, but never reuse stale answer text as the final result

4. `bounded_capability_answer`
- used for `capability`
- return deterministic or bounded policy answer
- do not route into mutation execution

5. `confirm_then_mutate` / `blocked`
- used for `mutate`
- require explicit confirmation or reject safely
- no direct memory replay of side effects

## Integration With Existing Arbiter and Stage 6 Paths

This architecture must fit the current routing stack instead of bypassing it blindly.

Recommended integration model:

1. note-targeted queries first pass through lightweight note-surface detection
2. the generic note resolver produces `ResolvedNoteCommand`
3. execution then branches by policy:
   - `state_info` -> deterministic state resolver path
   - `navigate_note` -> existing note navigation path
   - `stage6_grounded_answer` -> existing Stage 6 grounded-answer path, but with pre-resolved note command and anchor
   - `bounded_capability_answer` -> bounded capability responder
   - `confirm_then_mutate` / `blocked` -> mutation safety path

This means:

- the generic note resolver does not replace Stage 6 answer generation
- it replaces ad hoc note intent interpretation before Stage 6
- it should feed structured note intent into the existing cross-surface arbiter where that arbiter still owns final lane selection

Practical rule:

- if the query is clearly note-targeted, resolver output should constrain or bypass cross-surface ambiguity
- if surface detection is uncertain, existing arbiter logic remains the safety fallback

## Concrete Note Validation Context

Even with a generic resolver, note reuse still needs explicit runtime validation inputs.

The validator contract should include, when applicable:

- `activeNoteId`
- `openNoteIds`
- `followupAnchorNoteId`
- `currentWorkspaceId`
- `currentEntryId`

Minimum rules:

1. `state_info`
- must re-resolve from current live note/workspace state
- never trust stored answer text

2. `navigate`
- must validate any explicit `noteId` plus any required scope keys
- must not assume current `activeNoteId` is the target

3. `read`
- must validate anchor compatibility:
  - `active_note` against `activeNoteId`
  - `followup_anchor` against `followupAnchorNoteId`
  - `resolved_reference` against currently resolvable note target and scope

4. `capability`
- must validate the same note anchor rules as `read` when note-targeted

5. `mutate`
- must never skip confirmation/safety policy even if cached resolution exists

## Clarification Policy

Clarification should be manifest-driven, not scattered per feature.

Clarify when:

- note target is ambiguous
- anchor resolution is low confidence
- the command requires explicit target specificity but only contextual anchor is available
- the requested mutation lacks confirmation

Do not clarify when:

- state resolution is deterministic and safe
- explicit note target is resolved with high confidence

## Memory and Replay Model

Memory should become a **resolution cache**, not a bespoke behavior layer.

### What memory stores

- exact query text or fingerprint
- manifest version
- resolved `intentFamily`
- resolved `intentSubtype`
- anchor interpretation
- extracted arguments
- selector mode
- execution-policy hint
- success count
- context validation hints

### What memory does not store as authoritative behavior

- final state-info answer text
- final note-content answer text
- unchecked mutation side effects
- stale assumptions about current active note

### Replay meaning in the new model

Replay should mean:

- if an exact query was previously resolved with high confidence
- and current validation still passes
- reuse the resolved command schema
- then run live policy-aware execution again

That means:

- `state_info` re-resolves live state
- `navigate` re-executes navigation
- `read` re-runs grounded answer generation on current content
- `capability` re-runs bounded capability response logic
- `mutate` does not directly replay side effects

### Manifest versioning and invalidation

Because the manifest now defines behavior, cache rows must carry version metadata.

Rules:

1. every resolved note-command cache row stores:
- `manifestVersion`
- `handlerId`
- optionally an executor/policy version if handler semantics can change independently

2. cache reuse must reject rows when:
- stored `manifestVersion` does not match the current manifest entry
- stored `handlerId` no longer matches the active handler
- stored replay policy is no longer compatible with the current manifest

3. UPSERT self-upgrade must refresh:
- manifest version
- handler id
- resolved schema payload
- policy metadata

This prevents cached note-command rows from silently reusing outdated behavior after manifest edits.

## Migration From the Previous Plan

Do not throw away the previous note replay plan wholesale.

Use it as source material for:

- family taxonomy
- anchor-source model
- selector-specificity rules
- execution-policy distinctions
- validator expectations
- UPSERT self-upgrade

Discard it as the long-term pattern for:

- adding one replay action shape per new note family
- adding more family-specific client/server writeback seams
- expanding special-case validator logic as the primary scaling strategy

## Cutover From Existing Phase A Note Replay

The Phase A note replay bridge already exists in code for:

- `note_state_info`
- `open_note`

This new architecture must define a clear cutover rule so the system does not learn
the same query through two incompatible mechanisms.

Cutover policy:

1. while the bridge remains active, it is the only writer for:
- `which note is open?`
- direct unambiguous `open note X`

2. manifest-driven note-command cache rows should initially be enabled for:
- families not covered by the bridge
- or behind a separate feature flag during migration

3. once manifest-driven `state_info` and `navigate` are validated, disable Phase A note-family writes for those queries

4. lookup precedence must be explicit during migration:
- prefer the active mechanism for the query family
- do not allow both bridge replay rows and manifest-resolution rows to compete for the same query

5. badge semantics must stay stable during cutover:
- repeated queries should show one consistent reuse path, not alternate between old and new replay labels

## Bridge Strategy

If the narrow Phase A replay work is already partially underway, keep it only as a bridge.

Allowed bridge scope:

- `which note is open?`
- `open note Project Plan`

Do not use that bridge work as the default pattern for all future note features.

New note work should target the manifest-driven architecture first.

## Proposed Phases

### Phase 1: Define the note command manifest and schema

Deliverables:

- note manifest type and seed entries
- resolved command schema
- concrete note validation context contract
- execution-policy enum
- replay-policy enum
- clarification-policy enum
- manifest versioning rules

### Phase 2: Build the generic note resolver

Initial coverage:

- `state_info`
- `navigate`
- `read`
  - summary
  - question
  - find_text
  - read_full
- `capability`
- `mutate`

The first slice can still prioritize:

- `state_info`
- `navigate`

### Phase 3: Build the unified note executor

Deliverables:

- one executor that dispatches by execution policy
- one validator path for note anchors and selector safety
- one clarification entry point

### Phase 4: Attach memory as resolution acceleration

Deliverables:

- exact-query memory rows store resolved command schema
- exact-query rows store manifest version and handler id
- memory reuse skips some routing work
- live execution still runs
- UPSERT self-upgrade refreshes stale learned rows
- cutover policy prevents Phase A replay rows and manifest rows from competing for the same query

### Phase 5: Optimize high-frequency note paths after runtime evidence

Only optimize based on observed traffic and repeated command families.

Do not preemptively create bespoke replay contracts for long-tail note commands.

## Testing and Verification

### Contract tests

- manifest entries validate against the schema
- every manifest family has a declared execution and replay policy
- manifest entries expose stable version metadata
- manifest lookup and executor policy references stay in sync

### Resolver tests

- arbitrary phrasing maps to the correct command family and subtype
- anchor resolution is correct for:
  - active note
  - explicit note
  - resolved reference
  - follow-up anchor
- ambiguous queries produce clarification intent
- navigation resolution preserves scope for duplicate-title note targets
- confidence thresholds choose execute vs clarify consistently

### Executor tests

- `state_info` always re-resolves live state
- `navigate` executes current navigation path
- `read` regenerates answer from current note content
- `capability` returns bounded answers
- `mutate` never directly replays side effects without confirmation
- validator rejects stale or incompatible anchor/scope state
- Stage 6 integration consumes resolved note commands without re-interpreting note surface intent from scratch

### Memory tests

- exact-query memory stores resolved command schema
- exact-query memory stores manifest version and handler id
- stale rows self-upgrade on conflict
- memory reuse never bypasses required validation
- memory reuse never returns stale content/state answers as final results
- rows written against old manifest versions are rejected
- cutover prevents duplicate bridge-vs-manifest learning for the same query
- stored payload shape is stable and excludes final answer text

### Runtime sweep

- `which note is open?`
- `open note Project Plan`
- `read it`
- `summarize this note`
- `can you edit this note?`
- `rename this note`

Verify for each:

- resolver family
- anchor source
- execution policy
- clarification behavior
- memory reuse behavior

## Why This Is Better

This architecture scales because growth happens in:

- better resolver quality
- better anchor resolution
- better execution policies

Not in:

- more special writeback branches
- more validator branches
- more replay action shapes
- more client-specific replay seams

That is the difference between:

- a growing patch set
- and a durable command architecture

## Success Criteria

This plan succeeds when:

1. notes have one stable command schema
2. supported note capabilities are declared in a manifest
3. resolver maps broad note phrasing into that schema
4. executor runs live policy-aware behavior safely
5. memory improves repeated routing without becoming the behavior layer
6. new note commands usually require manifest and resolver improvements, not new bespoke replay plumbing
