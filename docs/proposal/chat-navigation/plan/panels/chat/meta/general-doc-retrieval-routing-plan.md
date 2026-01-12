# General Doc Retrieval Routing Plan (v4)

## Goal
Route general, doc-style questions (e.g., “what is…”, “how do I…”, “tell me about…”) through the Cursor-style retrieval system so answers are grounded in app documentation (via `/api/docs/retrieve`), not ad hoc LLM guesses. This expands retrieval beyond the current meta-explain path.

This plan is **UI/router integration**. It assumes the **Cursor-Style Doc Retrieval Plan (Phased)** already defines:
- the docs store + indexing,
- retrieval scoring + confidence,
- `/api/docs/retrieve` response statuses (`found | weak | ambiguous | no_match`),
- feature flags + rollback/kill-switch behavior.

---

## Scope
- Add a doc-style routing path in the chat UI.
- Use `/api/docs/retrieve` for answers, ambiguity, and no-match handling.
- Reuse existing disambiguation UX (option pills + clarification state).
- Keep action/navigation intents unchanged.

## Non-Goals
- No embeddings (Phase 3) changes (this plan is routing-only).
- No document authoring changes.
- No UI redesign of the chat panel.

---

## Routing Order (New)
1) Selection fast paths (ordinals/labels) with pending options  
2) Clarification handling (YES/NO/META) when clarification active  
3) Meta-explain outside clarification (existing plan)  
4) **General doc retrieval routing (this plan)**  
5) Question-first bypass to LLM  
6) Typo fallback  
7) Normal LLM routing  

**Note:** Steps 5–7 run only if step 4 does not route the query to doc retrieval, so they cannot pre-empt doc retrieval.

---

## Shared Contracts (Prevent Plan Drift)
### Normalization contract (single source of truth)
Both the router and `/api/docs/retrieve` should share the same normalization rules so:
- `quick-links` matches `quick links`
- widget title comparisons are consistent
- known-term overlap checks are stable

Normalization contract:
- lowercase
- replace separators/punctuation-with-meaning (`- _ / , : ;`) with spaces
- trim + collapse whitespace
- strip trailing sentence punctuation (`? ! .`)
- then apply (in real impl): **synonyms**, **conservative stemming**, **typo fix**
- then tokenize

### knownTerms contract
`knownTerms` must be built once (cached) and shared by both routing and retrieval:
- doc titles + keywords from `docs_knowledge`
- core concepts cache
- widget registry names (built-in + installed)
All known terms must be normalized using the same rules as input.

---

## Decision Rules

### 1) App relevance gate (prevents wasted retrieval)
Only consider doc routing if the input is app-relevant after normalization:
- token overlap with `knownTerms`, OR
- full normalized phrase matches a known term (for multi-word terms), OR
- matches an **action noun** (e.g., `recents`, `quick links`), OR
- matches a **visible widget title** (normalized)

If not app-relevant → route to LLM directly (no retrieval call).

### 2) Action routing guardrails (avoid “question-shaped commands”)
Route to **action** if any are true:

**A. Action noun bypass**
If normalized input matches a minimal action-noun list:
- `recent` / `recents`
- `quick links` / `quicklinks`
- `workspaces` (plural only; keep singular “workspace” doc-routable)

**B. Visible widget routing (command vs question)**
If `uiContext.dashboard.visibleWidgets` contains a normalized title match:
- **Command-like** input → action  
- **Question-intent** input → doc retrieval (explain first) + optional “Want me to open it?” hint

**C. Index-like references (digits are allowed in docs, but index-like should be action)**
Digits **do not automatically imply action**.
Route to action only when digits look like a UI selection reference, e.g.:
- `workspace 6`
- `note 2`
- `page 3`
- `entry 10`

**D. Command-like inputs**
- Imperative commands: action verb without question intent  
  - “open workspace 6”, “delete note 2”, “show recents”
- Polite commands: starts with `can you / could you / would you / please / show me` AND contains an action verb  
  - “can you open workspace”, “show me recents”

**Polite-command carve-out (important)**
If the input includes an **instruction/question cue** such as:
- “how to”, “how do I”, “tell me how”, “show me how”, “walk me through”
…then treat it as doc-style even if it starts with “show me / please”.

Examples:
- “show me recents” → action  
- “show me how to add a widget” → doc retrieval

---

## Doc-Style Query (Doc Route)
A query is doc-style if:
- It has **question intent** (starts with question word, contains question auxiliaries, or ends with `?`)
  **OR** contains doc-verb cues (low-churn list): `describe`, `clarify`, `define`, `overview`, `meaning`
- AND it is **not** routed to action by the guardrails above.

This intentionally covers natural phrasing beyond fixed prefixes:
- “tell me how I can add a widget”
- “describe the workspace”
- “clarify how notes work”
- “what does delete do?”

---

## Bare-Noun Query Guard (Doc Route, stricter)
Treat input as a **bare-noun doc query** only when ALL are true:
- 1–3 tokens after normalization
- No action verbs
- No digits (to avoid `note 2`, `workspace 6`)
- At least one token OR the full normalized phrase matches `knownTerms`
- Does NOT match action-noun list
- Does NOT match visible widget titles

If it passes → route through the same doc retrieval pipeline as doc-style queries.
(“bare noun” is just a stricter entry gate for better precision and logging.)

---

## API Usage
Call `/api/docs/retrieve` with:
- `mode: "explain"`
- optional `docSlug` to scope retrieval after disambiguation

Expected response shapes:
- `status: "found"` → render answer from returned snippet
- `status: "weak"` → ask clarification or show top guess with caveat
- `status: "ambiguous"` → show two options as pills
- `status: "no_match"` → “Which part would you like me to explain?” + examples

### Ambiguity Handling
When ambiguous:
- Show **2 options** as pills and set `lastClarification`:
  - `type: "doc_disambiguation"`
  - `options: [{ id: doc_slug, label: title, sublabel: category }]`
  - `question: "Do you mean <A> or <B>?"`

On selection:
- Call `/api/docs/retrieve` with `docSlug` (do not re-run the original query).

---

## Response Policy Layer (Human-Like Output)
This layer governs **how answers are phrased**, independent of routing. It is designed to make responses feel conversational while staying grounded and predictable.

### Match User Effort
| User input style | Response style |
|---|---|
| Short definition (“what is X?”) | 1–2 sentences |
| “explain/describe/clarify X” | 2–3 sentences + 1 key detail |
| “walk me through / show me how to …” | Numbered steps (3–7) |
| Vague (“help”, “instructions”) | Ask 1 clarifying question |

### Acknowledge When It Adds Clarity (avoid filler)
Use acknowledgment **only** after a state change:
- After disambiguation selection: “Got it — you meant **{A}**.”
- After weak-match confirmation: “Okay — **{A}**.”
- After user correction (“not that”): “Got it — let’s try again.”

Do **not** add acknowledgments for simple, direct questions.

### Offer Next Steps (only when natural)
| After… | Offer… |
|---|---|
| Short explanation | “Want the step-by-step?” / “Want more detail?” |
| Steps | “Want me to point to where that is in the UI?” (if action available) |
| Action completed | “Done — anything else?” |
| No match | Suggest 2–3 example app topics |

### Tone Guide
- Friendly, concise, practical
- No filler intros (“I’d be happy to…”) and no “as an AI…”
- Prefer concrete nouns from docs (“workspace”, “widgets”, “notes”)
- When unsure: ask a clarifying question rather than guessing

### Response Templates by Status

**found (high confidence):**
```
[1–3 sentence answer grounded to retrieved docs]
Want the step-by-step?
```

**found (widget explanation, question-intent match):**
```
[1–3 sentence explanation of the widget]
Want me to open it?
```

**found (after clarification resolved):**
```
Got it — you meant {Topic}.
[1–3 sentence answer grounded to retrieved docs]
```

**weak:**
```
I think you mean {Top}. Is that right?
[Yes] [No]
```

**ambiguous:**
```
Do you mean {A} ({category}) or {B} ({category})?
[A] [B]
```

**no_match (app-relevant but not found):**
```
I don’t see docs for that exact term. Which feature are you asking about?
(e.g., workspace, notes, widgets)
```


---

## Conversation State (Human-Like Continuity)
Maintain minimal state to support follow-ups:
- `activeMode: 'doc' | 'action' | 'llm'`
- `lastDocSlug?: string`
- `lastTopicTokens?: string[]`
- `clarification?: { type, options, question }`

### Correction handling (repair loop)
If the user says “no / not that / that’s wrong” after a `found` doc answer:
- re-run retrieval using `lastTopicTokens` + current input
- or fall back to `ambiguous` pills (top-2 docs)

### Pronoun follow-ups
If the user asks “how does it work?” / “tell me more”:
- scope retrieval to `lastDocSlug` when available
- otherwise reuse `lastTopicTokens`

### Optional preference learning (safe + deterministic)
Only learn from explicit user selections:
- if user repeatedly chooses the same doc option for a token (e.g., “home”) → add a synonym/boost for that user/org
- never learn from a single event

---

## Implementation Steps
1) Add doc routing helper in `chat-navigation-panel.tsx`.
2) Implement shared normalization + `knownTerms` builder (import from retrieval lib).
3) Add app relevance gate (knownTerms/action nouns/visible widgets).
4) Add action guardrails:
   - action noun bypass
   - visible widget bypass
   - index-like reference detector
   - command-like detector with polite-command carve-out
5) Add doc-style detection (question intent + doc verbs).
6) Add bare-noun guard.
7) Wire `/api/docs/retrieve`:
   - handle `found / weak / ambiguous / no_match`
   - `ambiguous` sets clarification state; selection calls `docSlug`
8) Log routing + retrieval metrics.

---

## Acceptance Tests
### Doc routing
1) “What is a workspace?” → doc retrieval answer (not LLM).
2) “describe the workspace” → doc retrieval answer.
3) “clarify how notes work” → doc retrieval answer.
4) “show me how to add a widget” → doc retrieval answer (polite-command carve-out).
5) “Tell me about home” → doc retrieval answer from concepts/home.
6) “home” → **weak** if top-two chunks are from the same doc (same-doc tie collapse); otherwise **ambiguous** (two options). Selecting an option uses `docSlug`.

### Action routing
7) “open workspace 6” → action.
8) “workspace 6” → action (index-like reference).
9) “note 2” → action (index-like reference).
10) “recent” → action (action noun).
11) Visible widget title (“widget manager”) → action.

### LLM routing (non-app)
12) “quantum physics” → skip retrieval → LLM.
13) “tell me a joke” → skip retrieval → LLM.

### Retrieval `no_match`
14) “foobar widget” (contains “widget” so app-relevant) → retrieval `no_match` → “Which part would you like me to explain?” + examples.

---


## Metrics (Human-Like)
Track these to measure conversational quality (not just retrieval correctness):

| Metric | Description | Target |
|---|---|---|
| Clarification success rate | % of `ambiguous/weak` flows resolved without user abandoning or rephrasing | > 80% |
| Turns to resolution | Avg. turns from user question → grounded answer or completed action | < 3 |
| Correction rate | % of answers followed by “not what I meant” | < 10% |
| Doc-routing coverage | % of app-relevant queries that successfully route to doc retrieval (vs LLM) | Increase over time |
| Pronoun follow-up success | % of follow-ups (“tell me more”, “how about that?”) resolved to the prior topic correctly | > 90% |
| Groundedness sampling | Manual weekly check: answer matches retrieved docs | > 95% |

**Logging note:** include `route`, `status`, `docSlug` (if used), and whether the user corrected/accepted, so you can compute these rates reliably.


## Sample Code (Routing Skeleton)

```ts
type Route = 'doc' | 'action' | 'bare_noun' | 'llm'

const ACTION_NOUNS = new Set<string>([
  'recent',
  'recents',
  'quick links',
  'quicklinks',
  'workspaces', // plural only; keep singular "workspace" doc-routable
])

const POLITE_COMMAND_PREFIXES = [
  'can you',
  'could you',
  'would you',
  'please',
  'show me',
]

const DOC_VERBS = new Set<string>([
  'describe',
  'clarify',
  'define',
  'overview',
  'meaning',
])

function startsWithAnyPrefix(normalized: string, prefixes: string[]): boolean {
  return prefixes.some(p => normalized === p || normalized.startsWith(p + ' '))
}

function normalizeInput(input: string): { normalized: string; tokens: string[] } {
  const normalized = input
    .toLowerCase()
    .trim()
    .replace(/[-_/,:;]+/g, ' ')
    .replace(/[?!.]+$/, '')
    .replace(/\s+/g, ' ')

  // NOTE: In real impl apply synonyms + conservative stemming + typo fix BEFORE tokenization.
  const tokens = normalized.split(/\s+/).filter(Boolean)
  return { normalized, tokens }
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[-_/,:;]+/g, ' ')
    .replace(/[?!.]+$/, '')
    .replace(/\s+/g, ' ')
}

function hasQuestionIntent(normalized: string): boolean {
  return (
    /^(what|how|where|when|why|who|which|can|could|would|should|tell|explain|help|is|are|do|does)\b/i.test(
      normalized
    ) ||
    normalized.endsWith('?')
  )
}

function hasActionVerb(normalized: string): boolean {
  return /\b(open|close|show|list|go|create|rename|delete|remove|add|navigate|edit|modify|change|update)\b/i.test(
    normalized
  )
}

function matchesVisibleWidgetTitle(normalized: string, uiContext: UIContext): boolean {
  return !!uiContext.dashboard?.visibleWidgets?.some(
    w => normalizeTitle(w.title) === normalized
  )
}

function containsDocInstructionCue(normalized: string): boolean {
  return /\b(how to|how do i|tell me how|show me how|walk me through)\b/i.test(normalized)
}

function looksIndexLikeReference(normalized: string): boolean {
  // Matches: "workspace 6", "note 2", "page 3", "entry 10"
  return /\b(workspace|note|page|entry)\s+\d+\b/i.test(normalized)
}

function isCommandLike(normalized: string): boolean {
  // Index-like selection should be action even without a verb: "note 2"
  if (looksIndexLikeReference(normalized)) return true

  // Imperative: action verb without question intent
  if (hasActionVerb(normalized) && !hasQuestionIntent(normalized)) return true

  // Polite command: prefix + action verb, unless it’s clearly an instruction question
  if (
    startsWithAnyPrefix(normalized, POLITE_COMMAND_PREFIXES) &&
    hasActionVerb(normalized) &&
    !containsDocInstructionCue(normalized)
  ) {
    return true
  }

  return false
}

function isDocStyleQuery(normalized: string, tokens: string[], uiContext: UIContext): boolean {
  if (ACTION_NOUNS.has(normalized)) return false
  if (matchesVisibleWidgetTitle(normalized, uiContext)) return false
  if (isCommandLike(normalized)) return false

  // Broad doc-style trigger: instruction cue OR question intent OR doc-verb cue
  if (containsDocInstructionCue(normalized)) return true
  if (hasQuestionIntent(normalized)) return true
  return tokens.some(t => DOC_VERBS.has(t))
}

function passesBareNounGuard(
  normalized: string,
  tokens: string[],
  knownTerms: Set<string>,
  uiContext: UIContext
): boolean {
  if (tokens.length > 3) return false
  if (hasActionVerb(normalized)) return false
  if (/\d/.test(normalized)) return false

  const matchesKnown =
    tokens.some(t => knownTerms.has(t)) || knownTerms.has(normalized)
  if (!matchesKnown) return false

  if (ACTION_NOUNS.has(normalized)) return false
  if (matchesVisibleWidgetTitle(normalized, uiContext)) return false

  return true
}

function routeInput(input: string, uiContext: UIContext, knownTerms: Set<string>): Route {
  const { normalized, tokens } = normalizeInput(input)

  // Step 1: app relevance AFTER normalization
  const isAppRelevant =
    tokens.some(t => knownTerms.has(t)) ||
    knownTerms.has(normalized) ||
    ACTION_NOUNS.has(normalized) ||
    matchesVisibleWidgetTitle(normalized, uiContext)

  if (!isAppRelevant) return 'llm'

  // Step 2: visible widget routing (question vs command)
  if (matchesVisibleWidgetTitle(normalized, uiContext)) {
    if (isCommandLike(normalized)) return 'action'
    if (hasQuestionIntent(normalized)) return 'doc'
  }

  // Step 3: action-noun bypass
  if (ACTION_NOUNS.has(normalized)) return 'action'

  // Step 4: command-like (includes index-like digits)
  if (isCommandLike(normalized)) return 'action'

  // Step 5: doc-style routing
  if (isDocStyleQuery(normalized, tokens, uiContext)) return 'doc'

  // Step 6: bare noun routing (stricter)
  if (passesBareNounGuard(normalized, tokens, knownTerms, uiContext)) return 'bare_noun'

  return 'llm'
}
```

---

## Rollback
- Remove the doc-style routing branch.
- Keep meta-explain and LLM routing unchanged.
