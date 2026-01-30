# Known‑Noun Command Routing Plan (Deterministic)

**Status:** Draft  
**Owner:** Chat Navigation  
**Scope:** Global routing (no clarification state required)

## Problem
Users often type **noun‑only commands** without verbs (e.g., “links panel”, “widget manager”).  
Today these can fall into docs/notes routing or error states, which feels wrong.

## Goals
- Execute common noun‑only commands deterministically.  
- Avoid accidental doc routing for noun‑only inputs.  
- Provide a helpful recovery prompt for unknown/typo nouns.

## Non‑Goals
- Personalized learning / per‑user allowlist (defer).  
- LLM routing for noun‑only commands (deterministic first).

---

## Rule Set

### 1) Known‑Noun Allowlist (deterministic)
Maintain an allowlist of executable nouns (example set):
- links panel
- widget manager
- recent
- dashboard
- workspaces

If input matches allowlist (with existing typo‑tolerant normalization), execute immediately.

### 2) Question vs Command Guard
Even for allowlisted nouns, route to docs/help if the input looks like a question:
**Question signals** (any):
- ends with `?`
- starts with: `what`, `how`, `why`, `meaning`, `explain`, `describe`, `clarify`
- starts with: `can you`, `do you know`

**Exception (power-user friendly):**  
If the input **exactly matches an allowlisted noun** and the **only** question signal is a trailing `?`, do **not** route to docs.  
Instead ask: “Open ___, or read docs?”

Examples:
- “links panel” → **execute**
- “what is links panel” → **docs/help**
- “links panel?” → **ask** (“Open Links Panel, or read docs?”)

### 3) Unknown Noun Fallback (no verb + not allowlisted)
Do **not** auto‑route to docs. Ask a short clarification:

**Prompt (default):**  
“I’m not sure what that refers to. Do you want to open something, or read docs?  
If you meant a specific thing, you can say the name again or give one detail.”

**Optional buttons:** Open / Docs / Try again

**Near‑match hint (deterministic):**  
If the input is 2–3 tokens and is a close fuzzy match to an allowlisted noun  
(e.g., “widget managr”), show:
“Did you mean **Widget Manager**?” (button)

---

## Integration Points

**Where:** global routing (before docs/notes routing).  
**Order:**
1. Normalize input (existing typo normalization).
2. If allowlisted noun and only trailing `?` → ask Open/Docs.
3. If question signal → docs/help.
4. If allowlisted noun → execute.
5. If noun‑only and unknown → show fallback prompt.

---

## Acceptance Tests

1) “links panel” → execute panel command (disambiguation if needed)  
2) “widget manager” → execute widget command  
3) “what is widget manager” → docs/help  
4) “links panel?” → ask Open/Docs  
5) “widget managr” → “Did you mean Widget Manager?”  
6) “panel layot” (typo, unknown) → fallback prompt (Open/Docs/Try again)  

---

## Telemetry
- `known_noun_command_execute`  
- `known_noun_command_docs_guard`  
- `unknown_noun_fallback_shown`
