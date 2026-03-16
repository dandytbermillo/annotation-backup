How it works

  The plan turns routing into one shared ladder for uncertain requests across
  surfaces:

  1. Exact deterministic
  2. Semantic retrieval / replay
  3. Bounded LLM arbitration
  4. Fallback clarification

  The key change is:

  - deterministic keeps safety and exact wins
  - but it stops vetoing noisy natural-language turns too early

  ———

  Step 1: Exact deterministic

  This still runs first.

  It handles only things the app can identify with high certainty:

  - ordinals like 1, second, last
  - exact validated commands like show links panel
  - hard exclusions like dangerous mutation paths
  - exact non-target scope
  - exact obvious wins

  If deterministic is truly certain:

  - it resolves immediately

  If not:

  - it must not guess
  - it must pass the turn forward

  ———

  Step 2: Semantic retrieval / replay

  Before calling a new arbiter, the system can still use memory:

  - B1 exact memory lookup
  - B2 semantic memory lookup
  - Stage 5 replay

  But only as advisory or safe replay:

  - exact prior successful patterns
  - semantically similar prior successful patterns

  If replay confidence is high and validation passes:

  - reuse the prior resolution

  If not:

  - continue to the arbiter

  So semantic memory helps reduce LLM calls, but does not replace safety checks.

  ———

  Step 3: Bounded LLM arbitration

  If deterministic and replay do not settle the turn, the app calls a bounded
  semantic arbiter.

  The arbiter does not execute anything.
  It only returns a typed decision, like:

  - surface=note, intentFamily=read_content
  - surface=note, intentFamily=state_info
  - surface=panel_widget, intentFamily=state_info
  - surface=workspace, intentFamily=state_info
  - surface=unknown, intentFamily=ambiguous

  This is bounded because:

  - fixed schema
  - confidence score
  - no freeform tool execution
  - no direct side effects

  If confidence is below threshold:

  - unresolved
  - move to clarification

  If confidence is above threshold:

  - hand off to the correct deterministic family resolver

  ———

  Step 4: Deterministic family resolver

  After arbitration, the app resolves according to the chosen family.

  ### note.read_content

  - semantic arbiter classifies the turn as note content-read
  - dispatcher builds contentContext
  - existing Stage 6 runs:
      - executeS6Loop(...)
      - inspect
      - grounded answer
      - citations
      - surfaced answer

  So Stage 6 remains the execution/answer pipeline.

  ### note.state_info

  - semantic arbiter says:
      - note + state_info
  - deterministic resolver answers from live UI/session state:
      - activeNoteId
      - openNotes
  - examples:
      - Which note is open?
      - What note am I on?

  If no note is open:

  - explicit answer:
      - No note is currently open.

  ### panel_widget.state_info

  - answer from visible/open panel state and widget snapshots
  - examples:
      - What panel is open?
      - Which widgets are visible?

  ### workspace.state_info

  - answer from workspace/session state
  - example:
      - Which workspace am I in?

  ### navigate

  - deferred until later migration
  - because existing /api/chat/navigate already handles that family

  ### mutate

  - classified if needed
  - never executed in this slice
  - returns bounded not-supported / clarifier behavior

  ———

  Step 5: Fallback clarification

  Clarification happens only when:

  - arbiter is not confident enough
  - surface is unknown
  - or the selected family lacks enough grounded live data

  Examples:

  - Do you want me to explain the current note, or navigate somewhere else?

  Clarifier is last resort, not early default.

  ———

  How migration works

  The plan is staged.

  ### Phase 1

  Audit only:

  - which deterministic rules are real safety rules
  - which ones are exact wins
  - which ones should stop acting as weak vetoes

  No unsafe guard-removal shipping by itself.

  ### Phase 2

  Lock the shared contract:

  - arbiter schema
  - threshold
  - dispatcher insertion seam
  - Stage 6 handoff
  - state_info resolvers
  - migrated-family gate

  ### Phase 3

  Migrate note families first:

  - note.read_content
  - note.state_info

  This is where current pain is highest.

  ### Phase 4

  Extend to:

  - panel_widget
  - dashboard
  - workspace
  - later navigate

  ### Phase 5

  Add telemetry/evals:

  - what stage handled the turn
  - exact deterministic vs replay vs arbiter vs clarifier

  ———

  Why this solves the current problem

  Today, requests can fail because:

  - early regex/guard logic decides too soon
  - different intent families use different routing quality levels

  With this plan:

  - exact cases still stay fast and safe
  - noisy but understandable requests get one shared semantic arbiter
  - content-read and state-info stop depending on ad hoc family-specific wording
    hacks
  - clarification happens only after semantic routing also fails

  ———

  Concrete example

  User:

  - hello which note is open

  Flow:

  1. deterministic exact win? no
  2. semantic replay? maybe none
  3. bounded arbiter:
      - surface=note
      - intentFamily=state_info
      - confidence 0.87
  4. deterministic note-state resolver:
      - looks at activeNoteId
      - returns:
          - The open note is Main Document.
  5. no clarifier needed

  Another example:

  User:

  - could you summarize that note please

  Flow:

  1. deterministic exact win? maybe yes if obvious, otherwise no
  2. replay? optional
  3. arbiter:
      - surface=note
      - intentFamily=read_content
  4. Stage 6:
      - inspect
      - grounded answer
      - citations
  5. surfaced content answer

  ———

  In one sentence

  The plan makes the router consistent by using:

  - deterministic for certainty and safety,
  - semantic memory for reuse,
  - one bounded LLM arbiter for the uncertain middle,
  - and clarifier only when even that is still unresolved.
