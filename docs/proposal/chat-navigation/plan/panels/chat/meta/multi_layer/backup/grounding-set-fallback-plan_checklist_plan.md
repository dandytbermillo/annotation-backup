wh — Implementation Checklist

  A) State & Data Contracts

  - Add/confirm state fields:
      - activeOptionSetId: string | null
      - activeWidgetId: string | null
      - openWidgets[]: { id, label, options[] }
      - pausedOptionSet?: { options[], pausedReason, pausedAt }
      - lastOptionsShown?: { options[], messageId, timestamp }
      - softActiveTTL = 2 turns (for lastOptionsShown)
      - pausedTTL (optional, only if you intentionally add expiry for paused lists)
      - last_action / last_target / recent_entities (for non-list referents)
  - Ensure lastOptionsShown is populated when options are shown (not only when selected).

  A2) Grounding Set Build Order (Decision Flow Step 1)

  - Build grounding sets in this order:
      1) Active options
      2) Paused snapshot options
      3) Active widget lists
      4) Recent referents
      5) Capability set

  B) Selection‑Like Detector (single source of truth)

  - Implement a named function (or reuse) with the plan’s exact rules:
      - Ordinals: first/second/third/1/2/3/last
      - Shorthand keywords: option/panel/item/choice/one
      - Badge token: only when UI displays badge letters
      - Unique token‑subset match (unique‑only)
  - Enforce uniqueness invariant (must resolve to exactly one option).

  C) Candidate Size Rule

  - Non‑list grounding sets: cap at 1–5
  - List‑type grounding sets: allow up to 12 (or full UI‑bounded list)
  - UI‑bounded means: the list displayed on screen is already the bounded candidate set.

  D) Multi‑List Early Guard (Decision Flow Step 2)

  - If multi‑list context AND input is selection‑like:
      - Ask: “I see multiple option lists open. Which one do you mean?”
      - Provide widget list buttons or allow typing widget name
  - Multi‑list context is computed only from visible widget lists, not paused snapshots.

  E) Deterministic Unique Match Before LLM

  - If list‑type grounding set exists and selection‑like resolves uniquely:
      - Execute directly
  - Do not call LLM until deterministic unique match fails.
  - If no grounding set exists at all: ask for missing slot (target/action/scope).

  F) LLM Fallback (Constrained)

  - Only call when:
      - deterministic unique match fails and
      - a grounding set exists
  - LLM contract: select (choiceId) or need_more_info
  - On need_more_info: ask one grounded clarifier
  - On failure/timeout: same clarifier (no silent fallthrough)
  - Safety rules (must enforce):
      - Never execute without a candidate id
      - Never allow LLM to generate new labels/commands
      - If candidates are empty, do not call LLM

  G) Soft‑Active Window

  - TTL = 2 turns
  - If activeOptionSetId == null but lastOptionsShown still valid and input is selection‑like:
      - treat it as a list grounding set
      - apply deterministic unique match → else LLM

  H) Paused‑List Re‑Anchor (after stop)

  - If paused list exists and activeOptionSetId == null, and user uses ordinal/shorthand without return cue:
      - Respond: “That list was closed. Say ‘back to the options’ to reopen it — or tell me what
        you want instead.”
  - Return cue restores paused list.

  I) Precedence Rules

  - Visible widget list wins over paused snapshot unless user explicitly returns.
  - Multi‑list ambiguity wins over soft‑active (ask which list).

  J) Telemetry

  - grounding_set_built (type, size)
  - grounding_llm_called / timeout / error
  - grounding_llm_select / need_more_info
  - multi_list_ambiguity_prompt_shown

  K) Manual QA (Must‑Pass)

  1. Soft‑active:
      - open D → “panel e” → opens E
  2. Active list shorthand:
      - active list shows options → “panel e” → deterministic select (unique match)
  2. Stop → ordinal:
      - stop → yes → “second option” → re‑anchor copy
  3. Return cue:
      - “back to options” restores list
  4. Multi‑widget:
      - two lists open → “first option” → ask which list
  5. Explicit widget:
      - “first option in Recent” → executes
  6. Non‑list referent:
      - “open it” with last_target → executes or asks
  7. No grounding:
      - “fix it” → asks missing slot
  8. Large list (>5):
      - list-type grounding set with >5 options → allowed (up to 12 or UI-bounded)
  9. Ambiguous referent:
      - “Do that again” with multiple recent actions → need_more_info clarifier

  L) Integration Point (Wiring)
  - Insert after deterministic routing has failed and before generic doc routing.
  - If Tier 3 only runs when activeOptionSetId != null, route soft‑active selection‑like inputs here.
