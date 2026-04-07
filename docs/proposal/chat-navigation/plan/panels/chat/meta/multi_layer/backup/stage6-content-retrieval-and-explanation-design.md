# Stage 6 Extension: Content Retrieval and Explanation

Status: Draft

## 1. Goal

Extend the closed Stage 6 agent/tool loop with bounded content-reading capabilities so the assistant can:
- summarize note/widget content
- answer questions about note/widget content
- find specific text inside permitted widget content
- explain retrieved content without inventing unseen details

This extension is read-focused. It does not expand action authority beyond the existing Stage 6 execution model.

## 2. Why This Is Separate

The current Stage 6 plan is intentionally limited to:
- dashboard/widget structure inspection
- visible item inspection
- recent-item inspection
- name/label search
- read+navigate behavior

It does not support:
- body-text retrieval
- note/document content search
- content-grounded explanation
- question answering over widget content

This extension defines those capabilities explicitly rather than stretching the closed Stage 6 scope.

## 3. Scope

### In scope
- note content retrieval
- widget content retrieval
- bounded snippet search inside content
- grounded summarization
- grounded explanation / Q&A over retrieved content

Default intent class for this extension:
- summary / explanation / Q&A / find-text requests are treated as `info_intent` unless the user explicitly requests an action
- action execution remains governed by the existing Stage 6 action contract

### Out of scope
- content mutation/editing
- autonomous actions derived only from content
- unrestricted full-document dumps
- cross-document synthesis in Slice 1
- arbitrary workspace-wide semantic reasoning over all content

Slice 1 implementation boundary:
- note content only
- no generic widget-body retrieval
- no widget-body search
- widget content retrieval/search remains later-slice scope after note-only validation succeeds

## 4. Capability Architecture

This extension requires the app to expose a product-facing capability model to the LLM.
The model should not infer widget behavior from raw implementation details.

### 4.1 What the LLM must know
For each widget/panel/content surface, the app should be able to expose:
- `widgetId`
- `widgetType`
- `label`
- `editable`
- `readOnlyReason`
- `supportsActions[]`
- `supportsContentRead`
- `supportsContentSearch`
- `contentKinds[]`
- `selectionMode`
- `summary`

This is operational architecture, not frontend/source-code architecture.
It tells the model what the widget is, what the user can do there, and what content tools are available.

### 4.2 Capability manifest vs runtime snapshot

The app should separate two kinds of widget/panel data:

- **Capability manifest**: stable affordances and constraints, such as widget type, editability, supported actions, content-read/search support, content kinds, and selection mode.
- **Runtime snapshot**: current state, such as current title/label, visible items, active item, counts, state flags, and bounded summary.

The capability manifest tells the LLM how the widget works in principle.
The runtime snapshot tells the LLM what is true about the widget right now.

This should be implemented as a layered extension of the existing snapshot registry, not as a parallel unrelated registration system.
Capability fields should be added to the same app-controlled widget snapshot surface where practical, so structure/state/capability data remain consistent.

### 4.3 What the LLM must not receive
Do not send:
- raw React component structure
- internal reducer/store state
- ad hoc undocumented object graphs
- uncontrolled full widget bodies by default

The goal is to provide a stable capability contract, not an implementation dump.

### 4.4 Example capability shape

```json
{
  "widgetId": "w_notes",
  "widgetType": "note_panel",
  "label": "Notes",
  "editable": true,
  "readOnlyReason": null,
  "supportsActions": [
    "inspect_note_content",
    "search_widget_content"
  ],
  "supportsContentRead": true,
  "supportsContentSearch": true,
  "contentKinds": ["note_text", "title"],
  "selectionMode": "single",
  "summary": "Editable notes panel for the current workspace."
}
```

## 5. Tool Boundary

### 5.1 Read-only content tools

Widgets/panels expose capability and content interfaces to the app, and the app mediates them into LLM-facing tools.
Widgets do not talk directly to the LLM.
The app remains the safety boundary that decides what structured data is safe to forward.

#### `inspect_note_content`
Purpose:
- retrieve bounded content from a note-like item by id

Inputs:
- `itemId`
- optional `sectionId`
- optional `charLimit`

Outputs:
- `itemId`
- `title`
- `snippets[]`
- `truncated`
- `capturedAtMs`

Slice 1 extraction contract:
- source of truth is the persisted ProseMirror JSON / JSONB document representation
- content must be normalized into bounded plain-text snippets before being returned to the LLM
- extraction must define:
  - ProseMirror JSON to plain-text conversion rules
  - section boundary detection
  - handling of nested lists and tables
  - handling of embedded/non-text elements
  - truncation/snippet shaping rules

#### `inspect_widget_content`
Purpose:
- retrieve bounded content exposed by the currently active or specified widget

Inputs:
- `widgetId`
- optional `contentArea`
- optional `charLimit`

Outputs:
- `widgetId`
- `widgetLabel`
- `snippets[]`
- `truncated`
- `capturedAtMs`

This tool is later-slice scope.
It is not part of Slice 1 implementation unless a specific non-note widget type gets its own explicit content contract.

#### `search_widget_content`
Purpose:
- search inside permitted widget/note content and return matched snippets only

Inputs:
- `query`
- optional `widgetId`
- optional `limit`

Outputs:
- `query`
- `matches[]`
- `capturedAtMs`

This tool is later-slice scope.
The current system already has document-body search infrastructure, but this tool is deferred in Slice 1 for scope control and contract hardening reasons rather than missing infrastructure.

### 5.2 App-authoritative constraints
- tools may return only bounded, typed, permission-checked content
- tool outputs are evidence; they do not grant action authority
- app controls truncation, snippet shaping, and permission filtering

## 6. Observation Model

### 6.1 Content response shape
Every content tool response must include:
- stable object id
- human-readable label/title
- bounded snippets only
- `truncated: boolean`
- `capturedAtMs`

### 6.2 Exposure limits
Initial defaults:
- max 5 snippets
- max 400 chars per snippet
- max 1500 chars total returned per tool call

### 6.3 Total loop content budget
In addition to per-tool limits, the loop must enforce a total content budget across a single Stage 6 run.

Initial defaults:
- max 2 content-tool calls per loop
- max 2000 chars total injected across all content tool responses in one loop
- content-tool calls count against the same Stage 6 round budget as other inspect/tool calls; they do not get a separate extra round allowance
- if the total cap is reached, later content calls must return truncated results or force clarify/abort rather than exceed the budget

This prevents content retrieval from crowding out the rest of the Gemini conversation budget.

### 6.4 No uncontrolled raw dump
The model should not receive full raw widget/note bodies by default.
If more content is needed, it must request another bounded read/search tool call.

## 7. Permission and Safety Rules

### 7.1 Permission-first
If the user cannot access the content, the tool must fail closed.

Slice 1 assumption:
- access control is inherited from current workspace visibility / access context
- the current system does not assume per-note or per-item ACL checks beyond that workspace-level scope

### 7.2 Evidence-grounded answers only
The model may answer only from retrieved snippets.
If the retrieved evidence is insufficient, it must clarify or abort.

### 7.3 Reading does not imply execution
Content tools are read-only.
They do not permit navigation or mutation unless separate action tools are invoked and validated.

### 7.3a External model exposure
Slice 1 must explicitly treat retrieved note content as data that may be forwarded to the same external Gemini API used by the Stage 6 loop.
Before implementation, the contract must state:
- whether any redaction/scrubbing is applied before forwarding
- which content classes, if any, are excluded from forwarding
- whether user-visible disclosure is required when note content is sent to the external model

### 7.3b Prompt-injection handling for user-authored content
Retrieved content must be framed as user-authored data, not executable instructions for the model.
The contract should require:
- explicit delimiting/wrapping of retrieved content snippets
- prompt text that instructs the model to treat snippet content as evidence only
- no obedience to instructions found inside note/widget content unless separately authorized by the app

### 7.4 Freshness
All content responses include `capturedAtMs`.
Any action that follows content inspection still requires final commit-point validation under the existing Stage 6 rules.

Known limitation for info-intent:
- answers may still be based on slightly stale retrieved content if the underlying note/widget changes after retrieval and before the model responds
- Slice 1 should surface this as a documented limitation rather than pretending content answers are commit-time fresh

## 8. Answer Contract

### 8.1 Allowed outcomes
The model may:
- summarize retrieved content
- explain retrieved content
- answer a question using retrieved content
- ask for clarification if retrieval scope is ambiguous
- abort if no permitted/usable content is available

### 8.2 Forbidden behavior
The model must not:
- invent missing content
- present unsupported claims as retrieved facts
- answer from prior conversational assumption if no retrieved evidence supports it

### 8.3 Answer style
When possible, answers should:
- refer to retrieved evidence
- distinguish direct evidence from inference
- mention truncation or missing context when relevant

## 9. Loop Integration

### 9.1 Handoff order
Runtime order remains the parent v3.5 lane order:
- Lane A deterministic fast lane
- Lane B memory retrieval
- Lane C validation gate
- Lane D bounded LLM
- Lane E safe clarifier

This extension does not replace that order.
Instead, it extends the Stage 6 agent/tool loop so that when the runtime reaches the Stage 6 path, the loop can use content-aware inspect tools in addition to the existing structure/navigation tools.

### 9.2 Initial narrow routing
Slice 1 implementation should activate content tools only for:
- note summary requests
- direct note-content questions
- "find text in note" requests

Not for:
- generic navigation queries
- general chat fallback
- generic widget-body explanation/search outside note content

Widget content retrieval remains in overall plan scope, but it is a later slice after note-only validation succeeds and per-widget content contracts are defined.

## 10. Telemetry

Suggested durable fields:
- `s6_content_tool_used`
- `s6_content_tool_name`
- `s6_content_chars_returned`
- `s6_content_snippet_count`
- `s6_content_truncated`
- `s6_answer_outcome` (`answered | clarified | abort`)
- `s6_answer_grounded` (`true | false`)
- `s6_answer_reason`
- `s6_content_duration_ms`

## 11. Eval Metrics

### Primary
- grounded answer rate
- unsupported-answer rate
- unnecessary clarifier rate
- latency p50 / p95
- permission rejection rate

### Secondary
- average content chars returned
- average snippet count
- tool calls per successful answer
- abort rate by request type

## 12. Slices

### 6x.1 Contracts
Define a dedicated contract file:
- `lib/chat/stage6-content-tool-contracts.ts`

This slice should lock the concrete TypeScript shapes for:
- capability manifest types
- runtime snapshot types
- note-content tool requests/responses
- shared snippet/evidence reference types
- answer outcomes
- telemetry fields
- content/tool budget constants
- ProseMirror-to-snippet extraction contract (see below)

Recommended contract structure:
- `S6ContentCapabilityManifest`
- `S6ContentRuntimeSnapshot`
- `S6ContentSnippet`
- `S6InspectNoteContentRequest`
- `S6InspectNoteContentResponse`
- optional later-slice placeholders for `inspect_widget_content` / `search_widget_content`
- `S6_CONTENT_LIMITS`

Contract decisions to lock in this slice:
- whether to rename `supportsActions[]` to `supportsTools[]`, or split into separate user-facing actions vs LLM-facing tool affordances
- whether every snippet carries stable evidence references such as `snippetId` and `sectionRef`
- whether capability manifest and runtime snapshot are separate types even when sourced from the same registry

Slice 1 scope for this contract:
- note content only
- `inspect_note_content` only
- widget-content contracts, if present, should be clearly marked as later-slice placeholders

#### ProseMirror content extraction contract
Notes are stored as ProseMirror JSON / JSONB in `document_saves`. The extraction contract must define:
- how ProseMirror structured content (nested lists, tables, headings, embedded elements) is converted to plain-text snippets suitable for the LLM
- section boundary detection: how to identify snippet break points (heading nodes, paragraph boundaries, block-level elements)
- stripping rules: which elements are preserved as text, which are dropped, which are replaced with placeholders (e.g., images -> `[image]`)
- snippet indexing: whether snippets carry stable positional references (e.g., `snippetId`, `sectionRef`, heading path, paragraph ordinal) for evidence citation
- round-trip fidelity: the extraction is lossy (plain text from rich content) - the contract must document what is lost and how truncation is signaled

This contract must be locked before 6x.2 handler implementation begins.

### 6x.2 Read-only handlers
Implement the content tool handlers:
- permission-checked
- bounded
- deterministic

### 6x.3 Shadow loop integration — IMPLEMENTED
Allow the Stage 6 loop to use content tools in shadow mode.
No user-visible answer changes yet.

### 6x.4 Grounded answer policy — IMPLEMENTED
Refine prompt and response validation so explanations/summaries are evidence-grounded.
- `answer` terminal type with server-enforced citation validation
- Session snippet registry with session-scoped IDs (`c{call}_{id}`)
- Anchored-note enforcement, cross-note rejection, single retry budget
- Report: `reports/2026-03-13-stage6x4-grounded-answer-policy-implementation.md`

### 6x.5 User-visible answer mode — IMPLEMENTED
Content answers are surfaced directly in the chat UI as a product path (not shadow-only).
- **Single-execution rule**: loop runs once per content-intent turn; result used for both display and durable logging
- **Surfaced-answer contract**: `content_answered` → display + durable log; `abort`/`timeout` → durable log + fallback to normal routing; `throw` → fallback only
- **Provenance**: `_devProvenanceHint: 'content_answered'`, durable `provenance: 's6_enforced:content_answered'`, `result_status: 'executed'`, `decision_source: 'llm'`
- **Auto-fill transparency**: `s6_citations_autofilled` and `s6_grounded_autofilled` telemetry markers when server repairs Gemini structured output gaps
- **Answer presentation**: citation markers stripped from display text; truncation warning appended when `contentTruncated`; "Content Answer" provenance badge (teal)
- **ShowMoreButton**: gated on `contentTruncated === true` — opens full note in View Panel
- Report: `reports/2026-03-14-stage6x5-surfaced-answer-mode-implementation.md`

### 6x.6 Citation & snippet surfacing — IMPLEMENTED
Inline citation evidence display so users can verify the grounding behind surfaced content answers.
- **Collapsible "Sources" section**: collapsed by default below each content answer, expandable to show cited snippet texts
- **Snippet registry extended**: stores text, truncation, and section heading alongside source item ID
- **Selective citation**: only model-cited snippets shown (uncited evidence excluded)
- **Persistence/hydration**: cited snippets and surfaced-answer metadata survive chat history reload
- **Cross-note safety preserved**: single-note validation updated for richer registry shape
- Report: `reports/2026-03-14-stage6x6-citation-snippet-surfacing-implementation.md`

### 6x.7 Anchored-note intent resolver — SUPERSEDED by 6x.8
Interim narrow fix for classifier-miss note-read turns. Replaced by the cross-surface arbiter in 6x.8 Phase 3.

### 6x.8 Cross-surface semantic routing (Phase 3) — IMPLEMENTED
Shared semantic arbiter for uncertain turns across surfaces. Phase 3 migrates note families.
- **Cross-surface arbiter**: bounded LLM classifier returning `surface × intentFamily × confidence`
- **Greeting-prefix fix**: `DASHBOARD_META_PATTERN` split so greetings no longer block content requests
- **note.read_content**: arbiter classifies → Stage 6 handoff (unchanged execution)
- **note.state_info**: arbiter classifies → deterministic resolver from live UI state
- **Mutate policy**: classified but not executed, immediate bounded response
- **Migrated-family gate**: only `note:read_content` and `note:state_info` in Phase 3
- Report: `reports/2026-03-15-stage6x8-phase3-cross-surface-arbiter-implementation.md`

## 13. Recommended First Slice

Start with:
- note content only
- snippet-based retrieval
- summary + direct Q&A
- no cross-note synthesis
- no content mutation

Reason:
- highest utility
- clearest permission boundary
- smallest exposure surface
- easiest to evaluate for hallucination risk

## 14. Open Questions

- What widgets besides notes expose stable content safely?
- Should content search be limited to visible/open widgets in Slice 1?
- What snippet size best balances usefulness vs exposure risk?
- Do we need citation-style answer formatting for grounded explanations?
- Should user-visible answers include "based on retrieved content" labeling in early rollout?

## 15. Success Criteria

This extension is ready to move beyond shadow mode when:
- unsupported-answer rate is acceptably low
- permission failures are correct and fail closed
- answer rate improves over clarify/abort baseline
- latency remains within acceptable limits
- retrieval outputs remain bounded and interpretable
