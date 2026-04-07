# Chat Navigation Plan: Hybrid Commands + Clarification

## Goal

Ensure user inputs stay natural for casual use while supporting strict, clear
commands for power users and voice. Clarify only when genuinely ambiguous.

## Principles

- **Natural-first**: open obvious matches without extra prompts.
- **Explicit when needed**: if ambiguous, ask with concrete options.
- **Voice-friendly**: strict command grammar still supported.
- **Deterministic**: no guessing when multiple matches exist.

## Command Grammar (Supported)

Supported command patterns:

- `open workspace <name>`
- `open entry <name>`
- `show quick links [A|B|C|<title>]`
- `go home`
- `go to dashboard`
- `list workspaces`
- `open recent workspace`
- `open note <title>`

## Ambiguity Rules (Hybrid)

If user input is only a bare name:

- **Single match** → open directly.
- **Multiple matches** → show disambiguation pills with type labels.
- **Entry + workspace same name** → ask explicit: `entry or workspace?`

If user input is "quick links" with no badge:
- Ask: `Do you want Quick Links A, B, or C?`

## Clarification Style

Use explicit options (no vague prompts):

Bad:
- "What do you want to do with 'summary14'?"

Good:
- "Do you want to open the entry 'summary14' or the workspace 'summary14'?"

## Interaction Examples

### Example 1: Bare entry name (single match; only entry exists)
User: `summary14`
Assistant: `Opening entry "summary14" dashboard.`

### Example 2: Bare workspace name (single match)
User: `Sprint 66`
Assistant: `Opening workspace "Sprint 66".`

### Example 3: Correct strict command
User: `open entry summary14`
Assistant: `Opening entry "summary14" dashboard.`

### Example 4: Quick Links without badge
User: `quick links`
Assistant: `Do you want Quick Links A, B, or C?`

### Example 5: Ambiguous name (entry + workspace both named "summary14")
User: `summary14`
Assistant: `Do you want the entry "summary14" or the workspace "summary14"?`

## LLM Prompt Updates

- Enforce strict command grammar.
- If the input does not match a command, return a clarification message
  with explicit options.
- For bare names: open directly when there is a single match; clarify only
  when multiple matches exist or when entry/workspace types conflict.

## Client Behavior

- Display clarification prompts as assistant messages.
- Optionally render clarification options as clickable pills:
  - Entry vs Workspace
  - Quick Links A/B/C

## Safety

- Avoids accidental navigation or destructive actions.
- Reduces LLM hallucination in ambiguous cases.

## Manual Test Checklist

1) Bare entry name (single match) → opens directly.
2) Bare workspace name (single match) → opens directly.
3) Bare name with entry + workspace conflict → ask entry or workspace.
4) Bare name with multiple matches → show disambiguation pills.
5) Bare "quick links" → ask for panel badge.
6) Correct strict commands → execute immediately.
7) Voice input with filler → normalized but still follows hybrid rules.
