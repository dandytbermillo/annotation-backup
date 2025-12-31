# Plan Addendum: Prompt Hardening for select_option (Prefer optionIndex)

## Goal

Make the LLM consistently return `optionIndex` for selection follow-ups so the
client does not need to rely on fragile label matching.

## Core Rule (Prompt)

Add a strict instruction to the `select_option` intent:

- **ALWAYS** return `optionIndex` when pending options are provided.
- Use `optionLabel` **only** if the user references text that does not match
  an option index and the index cannot be inferred.
- Never return the raw user phrase as `optionLabel`.

## Prompt Text (Proposed)

```
16. **select_option** - User wants to select from pending disambiguation options
    Args:
      - optionIndex (preferred): 1-based index of the option to select
      - optionLabel (fallback): use ONLY if index cannot be inferred
    IMPORTANT:
      - ALWAYS return optionIndex when pendingOptions exist.
      - optionLabel is a last resort, and must match an option label/sub-label.
      - Never return the user's raw phrase as optionLabel.
```

## Few-Shot Examples (Add to Prompt)

```
Pending Options:
  1. "Workspace 6" (summary14 C) [workspace]
  2. "Sprint 66" (summary14 C) [workspace]

User: "the one from summary14 C"
→ { "intent": "select_option", "args": { "optionIndex": 1 } }

User: "Workspace 6"
→ { "intent": "select_option", "args": { "optionIndex": 1 } }

User: "second"
→ { "intent": "select_option", "args": { "optionIndex": 2 } }
```

## Optional Safety Net (Keep)

Retain the client-side fallback that matches `optionLabel` to labels/sublabels.
This is for resilience only; it should rarely be used after prompt hardening.

## Acceptance Criteria

- "the one from summary14 C" returns `optionIndex: 1`.
- "Workspace 6" returns `optionIndex: 1`.
- Ordinals return `optionIndex` consistently.
- `optionLabel` appears only when the index truly cannot be inferred.
