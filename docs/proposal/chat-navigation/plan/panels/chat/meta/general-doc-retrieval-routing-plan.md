# General Doc Retrieval Routing Plan

## Goal
Route general, doc-style questions ("what is", "how do I", "tell me about") through the
Cursor-style retrieval system so answers are grounded in app documentation, not ad hoc
LLM guesses. This expands retrieval beyond the current meta-explain path.

## Scope
- Add a doc-style routing path in the chat UI.
- Use `/api/docs/retrieve` for answers, ambiguity, and no-match handling.
- Reuse existing disambiguation UX (option pills + clarification state).
- Keep action/navigation intents unchanged.

## Non-Goals
- No embeddings (Phase 3) changes.
- No document authoring changes.
- No UI redesign of the chat panel.

## Routing Order (new)
1) Selection fast paths (ordinals/labels) with pending options
2) Clarification handling (YES/NO/META) when clarification active
3) Meta-explain outside clarification (existing plan)
4) **General doc retrieval routing (this plan)**
5) Question-first bypass to LLM
6) Typo fallback
7) Normal LLM routing

## Decision Rule: Doc-Style Query
Doc-style query if:
- Starts with: `what is`, `what are`, `how do I`, `how to`, `tell me about`, `explain`,
  `what does`, `where can I`, `how can I`.
- OR contains "help" / "guide" / "instructions" with no action verb.

Doc-style query is NOT used if:
- It contains explicit action verbs (open/list/show/go/create/rename/delete)
- A clarification is active (handled earlier)

## API Usage
Use `/api/docs/retrieve` with `mode: "explain"`.
Add optional `docSlug` to scope retrieval to a single document after disambiguation.

Expected response shapes:
- `status: "found"` → answer using returned snippet
- `status: "weak"` → ask clarification or show top guess
- `status: "ambiguous"` → show two options as pills
- `status: "no_match"` → "Which part would you like me to explain?"

### Ambiguity Handling
When ambiguous, show 2 options and set `lastClarification`:
- type: `doc_disambiguation`
- options: [{ id: doc_slug, label: title, sublabel: category }]
- question: "Do you mean <A> or <B>?"

On selection:
- Call `/api/docs/retrieve` with `docSlug` to fetch the best chunk for that doc.

## Implementation Steps
1) Add doc-style detection helper in `chat-navigation-panel.tsx`.
2) Insert routing branch before question-first bypass.
3) Handle `found/weak/ambiguous/no_match` responses:
   - `found`: add assistant message with snippet
   - `weak`: show best guess + "Is that what you meant?"
   - `ambiguous`: render pills + set clarification
   - `no_match`: "Which part would you like me to explain?"
4) Add optional `docSlug` retrieval support in `/api/docs/retrieve`.
5) Log retrieval metrics to existing debug logger.

## Acceptance Tests
1) "What is a workspace?" → doc answer from retrieval (not LLM).
2) "How do I add a widget?" → doc answer from actions/widgets.
3) "Tell me about home" → doc answer from concepts/home.
4) Ambiguous term ("home") → two options; selecting one returns the correct doc.
   - Confirm selection uses `docSlug` and does not re-run the original query.
5) No match ("quantum physics") → "Which part would you like me to explain?"
6) Action command ("open workspace 6") → bypass retrieval and execute action.

## Rollback
- Remove the doc-style routing branch.
- Keep meta-explain and LLM routing unchanged.
