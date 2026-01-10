# Clarification META Response Plan

## Pre-read compliance
- Isolation/reactivity anti-patterns: Not applicable. This plan does not touch isolation providers or useSyncExternalStore hooks.

## Problem
When the assistant asks a clarification question, users often reply with requests for explanation (e.g., “what do you mean?”, “explain”, “help”). Today these are treated as unsupported and fall into typo fallback. This breaks the conversational flow.

## Goal
Add a META response path for clarification follow-ups so the assistant can explain and re-ask, without leaving the clarification flow.

## Scope
- Only active when a clarification is already pending.
- No new DB calls or embeddings.
- No changes to selection-only fast paths.

## Non-Goals
- No deep semantic explanations or recommendations.
- No automatic selection or side effects from META.
- No new UI components beyond existing chat messages.

---

## Proposed Behavior
When `lastClarification` is active, classify user replies into:
- YES: proceed with the pending action
- NO: cancel clarification
- OPTION_SELECTED: use existing option selection logic
- META: explain the clarification and re-ask
- UNCLEAR: re-ask the same clarification

### META examples
- “what do you mean?”
- “explain” / “explain that”
- “help me understand”
- “what are my options?”
- “what’s the difference?”

### META response structure
- A short explanation (1–2 sentences)
- Re-ask the original clarification question
- Keep `lastClarification` active

---

## Phase 1: Local META Detection

### Detection
Match against a small, explicit pattern list while clarification is active.

Patterns (examples only; bounded list):
- what do you mean
- explain
- help me understand
- what are my options
- what’s the difference
- huh
- ?
- what
- not sure
- i don't know

### META loop limit
- Cap META responses to 2 per clarification.
- After the limit, offer an escape:
  - “I can show both options, or we can skip this for now. What would you like?”

### Response template
- If options exist: “Your options are: A or B. Which one would you like?”
- If no options: “I’m asking: <original question>. Would you like to proceed?”

### Acceptance
- “explain” → explanation + re-ask
- “what do you mean?” → explanation + re-ask

---

## Phase 2: LLM META Interpretation (Fallback)

### Behavior
If local META patterns do not match, send to the clarification interpreter (LLM) and allow a META classification.

LLM returns one of: YES / NO / OPTION_SELECTED / META / UNCLEAR.

If META:
- Provide a short explanation and re-ask the clarification question.

### Acceptance
- “can you tell me more?” → META → explanation + re-ask
- “what is that?” → META → explanation + re-ask
- “I’m not sure what that does” → META → explanation + re-ask

---

## Implementation Notes

### Clarification Context
Use `lastClarification` fields:
- `question` (original clarification prompt)
- `options` (if applicable)
- `nextAction` (for YES)

No new schema changes are required in Phase 1.

### Explanation Content
Keep explanations short and predictable:
- If options exist: list their labels, optionally include brief source info if available.
- If no options: restate the question in plain terms.

---

## Risks
- Over-triggering META: mitigate by only enabling META in clarification mode.
- Excess verbosity: cap responses to 1–2 sentences.

---

## Acceptance Tests

1) Clarification active, user asks for explanation
- Bot: “Would you like to open a workspace to see your notes?”
- User: “what do you mean?”
- Expected: explanation + re-ask, clarification stays active

2) Clarification active, options exist
- Bot: “Which one — Quick Links D or E?”
- User: “what’s the difference?”
- Expected: list options + re-ask

3) Clarification inactive
- User: “what do you mean?”
- Expected: normal routing (no META handling), LLM handles as a general question

---

## Rollback
- Remove META detection and treat all clarification follow-ups via YES/NO/UNCLEAR logic.
