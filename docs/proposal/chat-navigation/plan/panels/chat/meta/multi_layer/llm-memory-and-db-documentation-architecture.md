# LLM Memory, Documentation, and Routing Knowledge Architecture

## Purpose

This document describes a complete design for giving the app a richer long-term memory and documentation layer **without retraining the model**.

The goal is to let the app and its bounded LLM become better over time by combining:

- structured routing memory
- validated learned rows
- weak evidence and failed-attempt evidence
- DB-backed living documentation
- manifest and validator authority
- bounded arbitration and clarification
- session-aware and long-term learning

This design assumes the app already has:

- built-in surfaces/widgets/panels
- chat, dashboard, and workspace containers
- note and editable-surface targets
- semantic retrieval over seeded and learned routing data
- manifest/runtime validation before execution
- clarification as a safe fallback

---

## Executive summary

The clean model is:

- **facts first**: store structured evidence from successful, failed, clarified, and rewritten turns
- **docs second**: derive small DB-backed “living documents” from those facts
- **execution last**: keep manifest, validator, and execution policy as final authority

The LLM should become smarter from:

- better candidate ranking
- better clarifications
- better typo recovery
- better understanding of surfaces, containers, and delivery behavior

But it should **not** become an uncontrolled execution authority.

---

# 1. Core design principles

## 1.1 Separate interpretation from execution

The LLM may help with:

- interpretation
- candidate ranking
- bounded arbitration
- `need_more_info`
- candidate-backed clarification
- rewrite-assisted retrieval

The app must still own:

- manifest rules
- runtime validation
- execution policy
- ambiguity policy
- write-target validation
- final execution

## 1.2 Store knowledge in layers, not one blob

Do not put everything into one giant memory text field.

Use separate layers for:

- authoritative structured memory
- weak evidence
- living documentation
- hard rules / manifest / validation
- session memory

## 1.3 Documentation is advisory, not authoritative

Living docs should help the LLM:

- understand the app
- understand common ambiguity
- produce better clarification options
- recover from repeated failures

But docs must **not** directly authorize:

- surface open
- content listing
- write delivery
- mutation
- panel selection

## 1.4 Learn conservatively

A single lucky success should not become deterministic routing.

Use promotion tiers:

- evidence only
- hint-eligible
- deterministic-eligible

## 1.5 Prefer structured storage in the database

Since the app is already DB-centric, the knowledge and documentation layer should also live in the database.

That gives:

- scoped retrieval
- versioning
- evidence linkage
- promotion control
- tenant/user isolation
- retention/deletion control

---

# 2. High-level architecture

The architecture should contain six major layers.

## 2.1 Layer A: Stable machine authority

This is the source of truth for what is allowed.

Examples:

- surface manifest
- note contract
- execution policy
- ambiguity policy
- delivery-state schema
- validator rules
- write-target rules

This layer decides:

- what commands exist
- what containers they support
- what delivery modes they allow
- what clarification is required
- whether execution is permitted

## 2.2 Layer B: Structured routing memory

This is the app’s validated reusable memory.

Examples:

- curated seeds
- learned success rows
- semantic embeddings
- validated surface metadata
- delivery metadata
- success counters
- recency
- confidence/promotion tier

This layer helps:

- exact reuse
- semantic retrieval
- candidate ranking
- reduced LLM dependence over time

## 2.3 Layer C: Weak evidence and negative evidence

This is non-authoritative learning evidence.

Examples:

- noisy original phrasing
- clarification-mediated phrasing
- rewrite-assisted cases
- rejected candidates
- near-miss failures
- destination conflicts
- repeated ambiguity patterns

This layer is **not lookup-authoritative**.
It is used to:

- downrank bad guesses
- improve clarification quality
- improve reranking
- improve future documentation

## 2.4 Layer D: Living documentation

This is the DB-backed documentation layer that summarizes what the system has learned.

Examples:

- surface help docs
- container semantics docs
- clarification playbooks
- failure pattern docs
- routing notes
- drift notes

This layer helps the LLM understand:

- what the surface/widget is
- common user phrasing
- common confusion patterns
- which clarifiers work best
- what delivery behavior means
- what should not be assumed

## 2.5 Layer E: Session-local memory

This is short-lived memory for the current conversation or interaction window.

Examples:

- recent clarification choice
- recent candidate set
- recent resolved surface
- recent destination conflict
- current active ambiguity

This layer helps:

- follow-up handling
- local typo recovery
- clarification continuity
- better multi-turn UX without overpromoting noisy phrasing

## 2.6 Layer F: Orchestrator and executor

This is the operational engine.

It:

- segments compound input when needed
- resolves each action unit
- retrieves candidates
- optionally rewrites for retrieval
- merges/reranks candidates
- validates against manifest and live context
- chooses execute / hint / clarify
- refreshes runtime state after each executed step

---

# 3. Why DB-backed living documentation is useful

Living documentation solves a problem that learned rows alone do not solve.

A learned row is good for:

- “this query often maps to this validated command”

But a living document is better for broader knowledge like:

- “users often confuse Recent content queries with generic Entries panel references”
- “explicit `in the chat` should outrank drawer/display defaults”
- “this clarifier wording consistently works better than the old one”
- “write-target requests are stricter than presentation requests”

These are larger patterns, not just one query-to-command mapping.

So living docs give the LLM a richer picture of the product and its ambiguity patterns.

---

# 4. What should be stored in the database

## 4.1 Stable documentation records

These are manually reviewed or product-defined docs.

Examples:

- app semantics
- chat/dashboard/workspace docs
- per-surface help docs
- delivery behavior docs
- note/write-target docs
- clarification style guides

## 4.2 Living documentation records

These are derived from repeated evidence.

Examples:

- recurring ambiguity notes
- common recent-family failure patterns
- destination-conflict patterns
- useful clarification templates
- drift notes between seeds and real usage

## 4.3 Evidence records

These are the facts behind the docs.

Examples:

- successful turns
- failed turns
- clarification choices
- rewrite-assisted recovery
- arbitration declines
- wrong candidate rejections
- validation failures

## 4.4 Routing memory records

These are structured lookup/reuse records.

Examples:

- curated seeds
- learned success rows
- embeddings
- source kind
- promotion state
- recency and success counts

## 4.5 Rules/manifest records

These define machine-enforced behavior.

Examples:

- surface manifest entries
- delivery-state schema
- execution policy values
- ambiguity policy
- clarification policy
- write-target policy

---

# 5. Recommended database schema groups

The exact schema can vary, but this is a good structure.

## 5.1 `routing_memory_rows`

Purpose:

- seed rows
- learned-success rows
- lookup-eligible routing memory

Suggested fields:

- `id`
- `tenant_id`
- `user_id`
- `normalized_query`
- `raw_query_example`
- `embedding`
- `surface_type`
- `container_type`
- `intent_family`
- `intent_subtype`
- `handler_id`
- `execution_policy`
- `selector_specific`
- `duplicate_family`
- `instance_label`
- `arguments_json`
- `requires_visible_surface`
- `requires_container_match`
- `source_kind` (`curated_seed`, `learned_success`, `manifest_fallback`)
- `success_count`
- `last_success_at`
- `lookup_eligible`
- `promotion_tier`
- `rewrite_assisted`
- `created_at`
- `updated_at`

## 5.2 `routing_evidence`

Purpose:

- weak evidence
- noisy phrasing
- negative evidence
- rejected candidates
- clarification-mediated evidence

Suggested fields:

- `id`
- `tenant_id`
- `user_id`
- `raw_query`
- `normalized_query`
- `evidence_type` (`weak_positive`, `hard_negative`, `clarification_bridge`, `rewrite_assist`, `destination_conflict`)
- `final_validated_command_key`
- `candidate_set_json`
- `clarification_required`
- `clarification_choice`
- `rewrite_used`
- `rewrite_text`
- `delivery_state_json`
- `context_fingerprint_json`
- `outcome`
- `weight`
- `created_at`
- `updated_at`

## 5.3 `living_docs`

Purpose:

- canonical storage for DB-backed documentation

Suggested fields:

- `doc_id`
- `tenant_id`
- `scope_type` (`global`, `project`, `user`, `surface_family`, `container`, `workspace`, `entry`)
- `scope_key`
- `doc_type` (`surface_help`, `container_help`, `clarification_playbook`, `routing_note`, `failure_pattern`, `drift_note`)
- `title`
- `summary`
- `body_markdown`
- `status` (`draft`, `trusted`, `deprecated`)
- `version`
- `source_evidence_count`
- `last_validated_at`
- `updated_by` (`system`, `reviewer`, `migration`)
- `created_at`
- `updated_at`

## 5.4 `living_doc_evidence_links`

Purpose:

- link docs to the evidence that supports them

Suggested fields:

- `id`
- `doc_id`
- `evidence_id`
- `evidence_type`
- `weight`
- `created_at`

## 5.5 `routing_rules`

Purpose:

- structured rule store when rules are data-driven

Suggested fields:

- `rule_id`
- `rule_family`
- `scope_type`
- `scope_key`
- `rule_json`
- `status`
- `version`
- `created_at`
- `updated_at`

## 5.6 `session_memory`

Purpose:

- short-lived conversation or interaction memory

Suggested fields:

- `id`
- `session_id`
- `user_id`
- `memory_type`
- `memory_key`
- `memory_json`
- `expires_at`
- `created_at`

---

# 6. Recommended document types

## 6.1 Surface help docs

One per surface family.

Examples:

- Recent
- Links Panel
- Widget Manager
- Calculator
- Navigator

Suggested sections:

- purpose
- supported command families
- default delivery behavior
- container constraints
- common ambiguity patterns
- preferred clarification shapes
- examples
- invalid assumptions

## 6.2 Container semantics docs

Examples:

- Chat
- Dashboard
- Workspace
- Note
- Editable surface

These docs explain:

- what the container is
- what presentation means there
- what write delivery means there
- what defaults exist
- when clarification is needed

## 6.3 Clarification playbooks

These docs summarize:

- which clarifier wording worked best
- which ambiguity families recur most often
- which options users usually pick
- when to escalate from grounded clarifier to explicit bounded prompt

## 6.4 Failure pattern docs

These docs summarize:

- repeated misroutes
- repeated destination conflicts
- repeated false panel ambiguity
- repeated rewrite drift
- repeated wrong-candidate wins

## 6.5 Drift notes

These docs summarize mismatches between:

- curated seeds
- production-learned behavior
- current product contract

---

# 7. Update pipeline for living docs

The docs should **not** be rewritten directly from one turn.

Use this pipeline.

## 7.1 Step 1: collect structured outcomes

Every turn should log:

- raw query
- normalized query
- candidate set
- rewrite used or not
- delivery state
- validation outcome
- final resolved command
- clarification shown or not
- clarification option chosen
- execution outcome
- whether learning happened

## 7.2 Step 2: classify the outcome

Possible classes:

- deterministic success
- arbitration-assisted success
n- clarification-mediated success
- destination conflict
- structural ambiguity
- validation failure
- false ambiguity
- bad candidate reject
- rewrite-assisted recovery

## 7.3 Step 3: accumulate evidence

Evidence should be aggregated across repeated turns.

Example patterns:

- same noisy phrasing repeatedly maps to the same final command
- same clarifier wording is repeatedly chosen
- same wrong panel family keeps winning and getting rejected
- same destination conflict keeps appearing

## 7.4 Step 4: summarizer proposes doc changes

A summarizer can periodically update the docs with statements like:

- “For Recent, explicit chat destination should outrank drawer/display default.”
- “`open entries` is structurally ambiguous and should clarify unless a product-approved safe default exists.”
- “Write-target requests should clarify unless a unique eligible target exists.”

## 7.5 Step 5: update the living docs conservatively

Rules:

- repeated evidence required
- contradictory evidence must be resolved before promotion
- docs should remain small and scoped
- sensitive raw text should not be copied directly into docs

---

# 8. How the LLM should use the docs

The docs should be retrieved only when relevant.

## 8.1 Good uses

- bounded arbitration
- `need_more_info`
- candidate-backed clarification
- explaining how a surface works
- explaining why a request cannot safely execute

## 8.2 Bad uses

- direct execution authority
- bypassing manifest validation
- replacing structured routing state
- acting as a hidden per-widget phrase parser

## 8.3 Retrieval strategy

Use small scoped retrieval.

Examples:

- if Recent candidates are active, load only Recent docs
- if delivery conflict exists, load only destination/delivery docs
- if write target is requested, load write-target and note/editable-surface docs
- if clarification is needed, load the clarification playbook for that ambiguity family

---

# 9. Relationship between docs and learned rows

These are related but different.

## 9.1 Learned rows

Good for:

- query → command reuse
- exact or semantic retrieval
- candidate ranking
- reducing LLM dependence

## 9.2 Living docs

Good for:

- larger patterns
- common misunderstandings
- clarification strategy
- widget semantics
- destination behavior
- failure explanations

## 9.3 Recommended rule

- learned rows = structured routing evidence
- living docs = derived semantic guidance
- validator = final authority

---

# 10. Promotion and trust model

Not all knowledge should be equally trusted.

## 10.1 Routing memory promotion tiers

### Tier 0: evidence only

- not lookup-eligible
- noisy or clarification-mediated
- may help docs and reranking

### Tier 1: hint-eligible

- can help bounded arbitration or clarification
- not safe for deterministic execution

### Tier 2: deterministic-eligible

- repeated validated success
- context compatibility stable
- little or no clarification required

## 10.2 Living doc statuses

### `draft`

- recently generated
- low evidence count
- not trusted for strong routing hints

### `trusted`

- supported by repeated evidence
- allowed to influence LLM interpretation

### `deprecated`

- outdated
- contradicted by product or newer evidence

---

# 11. Hard-negative and failed-attempt learning

One of the best improvements is to learn from **wrong plausible candidates**, not just successful ones.

Examples:

- a query repeatedly looks vaguely like Recent but is not Recent
- a drawer candidate repeatedly conflicts with explicit chat destination
- a visible panel title repeatedly causes false ambiguity

This should be stored as negative evidence.

Use it to:

- downrank wrong near-matches
- improve clarifiers
- reduce repeated false positives
- update living docs

---

# 12. Clarification as learning bridge

Clarification is not success.

But clarification is useful because it can lead to later learning.

## 12.1 Good rule

- clarifier shown = not success
- user answer alone = not success
- final validated resolved command + successful bounded outcome = success

## 12.2 What can still be kept after clarification

- original noisy query
- clarification options shown
- option user selected
- final validated command
- whether this should remain evidence only or be promoted later

## 12.3 What docs can learn from clarification

- which options work best
- which ambiguity families recur
- which wording confuses users
- which clarifier style reduces loops

---

# 13. Rewrite-assisted retrieval and docs

Rewrite-assisted retrieval should remain a retrieval aid only.

## 13.1 Good stored facts

- raw query
- rewrite text
- whether rewrite was needed
- whether raw and rewritten retrieval agreed
- whether rewrite helped recover the right command

## 13.2 Good derived documentation insights

Examples:

- “Recent-family typo-heavy content requests often recover well from a single bounded rewrite.”
- “Rewrite-only candidates should not become deterministic without agreement or validation support.”

---

# 14. Delivery model: presentation vs write

The docs and DB model should support this distinction.

## 14.1 Keep presentation destination separate

For example:

- `presentation_target = chat | surface | unspecified`

## 14.2 Keep write target separate

For example:

- `write_target = none | active_note | named_note | open_editable_surface | any_open_editable_surface`

## 14.3 Keep delivery kind separate

For example:

- `delivery_kind = present | write`

## 14.4 Keep source strength separate

For example:

- `destination_source = explicit | inferred | default`

## 14.5 Why docs matter here

Living docs can explain:

- what `in the chat` means
- what `in the note` means
- what `any open editable panel` means
- why write-target validation is stricter than presentation

But docs must not decide execution. That still belongs to validator rules.

---

# 15. Multi-intent queries and documentation

For long multi-intent queries, docs should support the orchestrator but not replace it.

## 15.1 Correct model

- decompose query into ordered action units
- resolve each unit separately
- refresh runtime state after each executed unit
- use docs to improve:
  - unit understanding
  - clarification
  - destination handling
  - common ambiguity patterns

## 15.2 What to document

Examples:

- common multi-intent sequencing issues
- which segments are often dependent
- common clarification styles when one segment is unclear
- common delivery conflicts in multi-step requests

---

# 16. Security, privacy, and retention

Because this memory/documentation layer accumulates user interactions, privacy matters.

## 16.1 Do not directly copy sensitive raw text into docs

Keep raw phrasing in evidence tables, not in human-facing or model-facing docs unless redacted.

## 16.2 Apply retention rules

- evidence should expire or be archived according to policy
- stale docs should be reviewed or deprecated
- stale learned rows should decay or be removable

## 16.3 Keep scopes isolated

Support:

- global/project scope
- tenant scope
- user scope
- entry/workspace scope when needed

## 16.4 Delete and cleanup must work across all layers

If a memory/evidence item is removed, derived docs should no longer claim it as support.

---

# 17. Recommended rollout plan

## Phase 1: foundation

Implement:

- stable documentation records in DB
- living docs table
- evidence table
- links between docs and evidence
- retrieval by scope/type

## Phase 2: first docs

Create:

- app semantics doc
- chat/dashboard/workspace doc
- Recent surface doc
- clarification playbook
- failure-pattern doc

## Phase 3: derived updates

Add:

- periodic summarization from evidence to living docs
- doc versioning
- doc status (`draft`, `trusted`, `deprecated`)

## Phase 4: LLM integration

Use docs for:

- bounded arbitration
- `need_more_info`
- candidate-backed clarification
- surface explanations

## Phase 5: advanced learning

Add:

- hard-negative evidence
- clarifier-choice learning
- drift detection between seeds and production usage
- replay bench / shadow evaluation before promotion

---

# 18. Example document records

## 18.1 Example: Recent surface help doc

Title:

- `Recent surface behavior`

Summary:

- Describes the Recent surface, common user phrasing, default surface vs chat behavior, and common ambiguity cases.

Body example:

- Purpose: Show or list recently accessed content.
- Common commands:
  - `show recent`
  - `show recent widget`
  - `list recent entries`
  - `show recent entries in the chat`
- Defaults:
  - bare `show recent` usually means surface/display
  - `list recent entries` usually means chat answer
- Common ambiguity:
  - generic `entries` queries may be ambiguous and should clarify unless Recent-family evidence exists
- Clarification style:
  - prefer intent-shaped options

## 18.2 Example: clarification playbook doc

Title:

- `Recent ambiguity clarification patterns`

Summary:

- Lists which clarification options work best for Recent-family ambiguity.

Body example:

- Use candidate-backed options when possible.
- When destination conflict exists, mention it directly.
- Prefer:
  - `Open the Recent panel`
  - `List recent entries here in chat`
- Avoid bare choices like:
  - `Recent`
  - `Entries`

## 18.3 Example: failure pattern doc

Title:

- `Generic entries ambiguity failures`

Summary:

- Notes that broad phrases like `open entries` should not auto-open a panel without specific target evidence or a documented product-approved safe default.

---

# 19. Example retrieval use cases

## 19.1 Surface arbitration case

User query:

- `show recent widget contents in the chat`

System may retrieve:

- Recent surface help doc
- destination semantics doc
- clarification playbook if conflict exists

The docs help the LLM understand:

- this is likely a present request
- explicit chat destination is stronger than default surface display
- if no safe chat-compatible candidate exists, clarify rather than open drawer/display

## 19.2 Write-target case

User query:

- `list the recent widget content in the note`

System may retrieve:

- Recent surface doc
- write-target semantics doc
- note/editable-surface doc

The docs help explain:

- this is a write request, not just presentation
- active note is the relevant target
- write-target validation is stricter than presentation

But execution still depends on validator checks.

---

# 20. Final recommendation

For this app, the best design is:

- **store documentation in the database**
- **keep it small, scoped, and versioned**
- **derive it from structured evidence**
- **retrieve only the relevant docs when needed**
- **keep manifest/rules/validator as final authority**

The clean rule is:

- structured evidence records what happened
- living docs summarize what keeps happening
- the LLM uses docs to interpret better
- the app still decides what may execute

That gives you:

- long-term project/app awareness without retraining
- better candidate ranking and clarification
- safer growth than free-form memory
- better debugging and reviewability
- stronger support for both user help and app help

---

## Short version

The best architecture is:

- **DB for canonical storage**
- **small document records, not one giant blob**
- **separate evidence tables**
- **structured routing memory for validated reuse**
- **living docs for explanation and ambiguity support**
- **hard rules and validator remain authoritative**

That is the strongest way to make the LLM “know more over time” without retraining it.
