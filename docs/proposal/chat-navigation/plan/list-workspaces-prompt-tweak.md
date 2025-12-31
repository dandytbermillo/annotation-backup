# Draft: list_workspaces prompt tweak (bare "workspaces")

## Goal
Reduce LLM parse failures and unsupported responses for common shorthand like "workspaces" or "open workspaces" by mapping them explicitly to `list_workspaces`.

## Proposed change
Update `lib/chat/intent-prompt.ts` under **Special Cases** so the model treats bare or generic workspace phrases as `list_workspaces`.

### Current
```
- "list", "show workspaces", "what workspaces" -> list_workspaces
```

### Proposed
```
- "list", "workspaces", "my workspaces", "show workspaces", "show me my workspaces", "what workspaces", "open workspaces" -> list_workspaces
```

## Notes
- This is a prompt-only change. No schema changes required.
- Keeps existing `list_workspaces` examples; this adds explicit routing for bare or generic phrases.
- Optional follow-up (not required): add a single example under intent #5 showing "workspaces" -> list_workspaces for reinforcement.

## Validation
Manual test prompts after change:
- "workspaces" -> list_workspaces
- "open workspaces" -> list_workspaces
- "my workspaces" -> list_workspaces
- "list workspaces" -> list_workspaces

## Patch preview (snippet)
```diff
@@ Special Cases
-- "list", "show workspaces", "what workspaces" -> list_workspaces
+- "list", "workspaces", "my workspaces", "show workspaces", "show me my workspaces", "what workspaces", "open workspaces" -> list_workspaces
```
