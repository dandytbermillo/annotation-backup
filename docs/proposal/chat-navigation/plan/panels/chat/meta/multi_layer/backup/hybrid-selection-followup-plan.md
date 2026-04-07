# Chat Navigation Plan: Hybrid Selection Follow-ups (Ordinals + LLM Fallback)

## Problem

When the assistant presents disambiguation options (selection pills), users
often respond with ordinal phrases like "the first one." The system currently
expects a pill click, so the LLM receives no option list and treats the reply
as ambiguous.

## Goal

Make follow-up selection feel natural:
- Handle simple ordinals locally (no LLM call).
- Use the LLM only for free-form selection phrases.

## Non-Goals

- No changes to existing option generation logic.
- No changes to quick links parsing or storage.
- No long-term memory beyond the most recent selection prompt.

## Definitions

- **Pending selection**: the most recent assistant message that includes
  `options` (selection pills).
- **Ordinal reply**: "first", "second", "1", "last", etc.
- **Free-form selection**: "the one from summary14 C", "the workspace with 3 notes".

## Approach (Hybrid)

### 1) Client-side ordinal handling (Option 1)

If there is a pending selection and the user reply is a simple ordinal:
- Map ordinal -> option index.
- Immediately call `selectOption(...)` with that option.
- Do NOT call the LLM.

This is deterministic, fast, and avoids extra token cost.

### 2) LLM fallback for free-form selection (Option 2)

If there is a pending selection and the reply is not a simple ordinal:
- Send the message to the LLM with a compact list of options.
- LLM returns `select_option` with `optionIndex` (or `optionLabel`).
- Client maps that index to the stored options and calls `selectOption(...)`.

## Data Model Changes

### Client-side context (no DB)

Add to chat state:
- `pendingOptions`: array of the latest selection options
- `pendingOptionsMessageId`: assistant message ID that produced the options

Each option should include:
- `index` (1-based)
- `label`
- `sublabel` (optional)
- `type`
- `id`

### LLM context payload

When pending options exist, include:
```
context.pendingOptions = [
  { index: 1, label: "Workspace 6", sublabel: "summary14 C", type: "workspace" },
  { index: 2, label: "Sprint 66", sublabel: "summary14 C", type: "workspace" }
]
```

## Intent Changes

Add new intent:
- `select_option`

Args:
- `optionIndex` (preferred)
- `optionLabel` (fallback)

Examples:
Note: Ordinal examples are handled client-side first. These examples apply
only if client parsing fails or for documentation clarity.
- "the first one" → select_option (optionIndex: 1)
- "the second option" → select_option (optionIndex: 2)
- "the one from summary14 C" → select_option (optionLabel: "Workspace 6")

## Client Flow (sendMessage)

1) If no pending options → normal LLM flow.
2) If pending options:
   - Parse ordinal reply.
   - If ordinal resolved → call `selectOption` directly, add assistant message, clear pending options.
   - Else → call LLM with pendingOptions context.

## Ordinal Parser (Client)

Recognize:
- "first", "1", "one"
- "second", "2", "two"
- "third", "3", "three"
- "fourth", "4", "four"
- "fifth", "5", "five"
- "last"

Rules:
- Use 1-based indexing.
- If index out of range → return clarification (no LLM call).

## LLM Fallback Flow

1) LLM returns `select_option` with `optionIndex` or `optionLabel`.
2) Client maps to local `pendingOptions`.
3) If match found → call `selectOption`.
4) If no match → respond with: "Please pick one of the options shown."

## API/Resolver Changes

### 1) `/api/chat/navigate`
- Accept `context.pendingOptions` (optional).
- Update prompt to describe `select_option`.
- Pass pending options into context block.

### 2) Resolver
- If intent is `select_option`, do not resolve with DB.
- Return a resolution that includes:
  - `action: 'select_option'`
  - `optionIndex` or `optionLabel` from LLM args

### 3) Client action execution
- On `select_option`, map index/label to pending options and call `selectOption`.

## UX Copy

When presenting options, add hint (only on first disambiguation per session):
- "You can click a pill or reply 'first', 'second', or 'last'."

If the LLM cannot map:
- "I couldn't tell which one you meant. Please click a pill or say 'first/second'."

## Clearing Rules

Clear `pendingOptions` when:
- A selection is made (pill click or ordinal/LLM).
- A new assistant message with options replaces the old list.
- The user sends a new request that does not follow a selection prompt.

## Safety Notes

- The client only executes options already provided by the server.
- LLM never selects raw IDs or performs DB mutations directly.
- No additional PII exposure.

## Anti-Pattern Compliance

Isolation/reactivity anti-patterns are not applicable. No changes to
isolation providers or UI gating are introduced.

## Manual Test Checklist

1) Disambiguation → user types "first":
   - Correct option selected without LLM call.
2) Disambiguation → user types "the one from summary14 C":
   - LLM returns select_option, correct option selected.
3) Disambiguation → user types "third" with only two options:
   - Clarification prompt shown.
4) No pending options → "first":
   - Treated as normal message (unsupported or clarify).
5) New request after selection prompt:
   - Pending options cleared, normal intent flow.
