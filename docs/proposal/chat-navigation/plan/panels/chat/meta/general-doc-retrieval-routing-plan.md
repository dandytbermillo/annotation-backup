# General Doc Retrieval Routing Plan (v5 — Hybrid Response Selection)

> **Status: v5 Core COMPLETE** (2026-01-13)
> - HS1/HS2 snippet quality + follow-up expansion implemented
> - Metrics logging for all key events (correction, clarification, snippet upgrade)
> - All smoke tests passed
> - See Rollout Checklist for details

## Goal
Route general, doc-style questions (e.g., “what is…”, “how do I…”, “tell me about…”) through the Cursor-style retrieval system so answers are grounded in app documentation (via `/api/docs/retrieve`), not ad hoc LLM guesses. This expands retrieval beyond the current meta-explain path and adds a deterministic response-selection layer to prevent low-quality snippets.

This plan is **UI/router integration + response selection**. It assumes the **Cursor-Style Doc Retrieval Plan (Phased)** already defines:
- the docs store + indexing,
- retrieval scoring + confidence,
- `/api/docs/retrieve` response statuses (`found | weak | ambiguous | no_match`),
- feature flags + rollback/kill-switch behavior.

---

## Experience Goals (ChatGPT/Claude Flow + Cursor Groundedness)
- Human-like conversational flow with deterministic, grounded evidence.
- Predictable outcomes: users can infer what happens next.
- Minimal surprise: deterministic routing first, semantic fallback only when needed.

## Mode Contract (User-Visible)
Define a stable contract per mode so responses feel consistent.

**Docs**
- Answer grounded in docs.
- Offer one natural next step: “Show more” or “Open doc.”

**Action**
- Execute or preview action.
- If confirmation is needed, ask once.
- Offer “Want details?” only after completion.

**Personal data (notes/files)**
- Search + cite results.
- Apply privacy guardrails and never invent data.
- If not implemented, fall back to clarification.

**General**
- Normal assistant response (non-app queries).

## UX Affordances (Optional but Recommended)
- “Show more / Open doc” button opens a panel with the full section, TOC, and highlighted chunk.
- Optional “Sources” breadcrumb (e.g., `Workspace docs > Actions`).

## Repair Loop (Expanded)
- “not that” → re-run retrieval using `lastTopicTokens`.
- Ordinals (“second one”) → select from current options.
- “go back / start over” → clear clarification state and return to prompt.
- “stop / nevermind” → cancel and ask a single follow-up question if needed.

## Unified Retrieval (Docs + Notes/Files) — Future Phase
Unify the retrieval interface while keeping policy separation per corpus.

### Unified Interface
```
POST /api/retrieve
{
  "corpus": "docs" | "notes" | "files" | "auto",
  "mode": "explain" | "search",
  "query": "...",
  "resourceId": "optional",
  "docSlug": "optional",
  "excludeChunkIds": ["optional"],
  "cursor": "optional"
}
```

### Corpus Relevance Gate
Split app relevance into two signals:
- `isDocsRelevant`: known terms, concepts, widgets.
- `isPersonalRelevant`: “my notes/files”, filenames, note titles, “search/find”.

Routing rules:
- Docs if docs‑relevant and not personal‑relevant.
- Notes/files if personal‑relevant and not docs‑relevant.
- Ambiguous if both are true → show two options (max).
- Classifier fallback if neither is clear.

### Cross‑Corpus Ambiguity UX
If top candidates from different corpora are close in score/confidence, show 2 pills:
- Example: `Workspace (Docs > Concepts)` vs `Workspace (My Notes)`.

### Shared HS1/HS2 Selection
Apply HS1/HS2 to all corpora. Evidence objects must include:
- `corpus`, `resourceId`, `chunkId`, `isHeadingOnly`, `bodyCharCount`, `nextChunkId`.

### Policy Separation (Beyond Routing)
- Personal data: show results list + “Open” actions, never invent.
- Enforce permissions server‑side.
- Ranking weights differ by corpus (e.g., recency/title for notes; keyword/concept for docs).

### search_notes Prerequisites
- Indexing approach (full‑text + metadata).
- Chunking strategy for notes/files.
- Permissions filter and visibility rules.
- Runtime fallback: if personal-data signals are present but retrieval is not implemented, ask a clarifying question or fall back to `doc_explain`.

---

---

## Scope
- Add a doc-style routing path in the chat UI.
- Use `/api/docs/retrieve` for answers, ambiguity, and no-match handling.
- Reuse existing disambiguation UX (option pills + clarification state).
- Keep action/navigation intents unchanged.
- Improve snippet/response selection so follow-ups like “tell me more” never return a bare heading.

## Non-Goals
- No embeddings (Phase 3) changes (this plan is routing + response selection only).
- No document authoring changes.
- No UI redesign of the chat panel.
- No always-on LLM intent classifier. Semantic fallback is gated and feature-flagged (default-on).
- LLM does not choose docs/chunks; it can only format a chosen snippet.

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
- then apply: **synonyms**, **conservative stemming**, **typo fix**
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
- `query` (default smart retrieval)
- optional `docSlug` to scope retrieval after disambiguation
- optional `cursor` / `excludeChunkIds` to support “tell me more” without repeats

Expected response shapes:
- `status: "found"` → render answer from returned snippet
- `status: "weak"` → ask clarification or show top guess with caveat
- `status: "ambiguous"` → show two options as pills
- `status: "no_match"` → “Which part would you like me to explain?” + examples

### Evidence Objects (Minimum Fields)
Return enough structure to support snippet quality checks and follow-ups.

```ts
interface RetrievalChunk {
  docSlug: string
  title: string
  category: string
  chunkId: string            // e.g., `${docSlug}#chunk-${chunk_index}`
  headerPath?: string
  score: number
  matchedTerms: string[]
  snippet: string            // display-ready by default
  chunkText?: string         // optional: full chunk
  isHeadingOnly?: boolean    // optional: server-side heuristic
  bodyCharCount?: number     // optional: server-side heuristic
  nextChunkId?: string       // optional: adjacency for same-doc expansion
}
```

### Ambiguity Handling
When ambiguous:
- Show **2 options** as pills and set `lastClarification`:
  - `type: "doc_disambiguation"`
  - `options: [{ id: doc_slug, label: title, sublabel: category }]`
  - `question: "Do you mean <A> or <B>?"`

On selection:
- Call `/api/docs/retrieve` with `docSlug` (do not re-run the original query).

---

## Hybrid Response Selection Layer (NEW)

### Why this exists
Routing can be correct and retrieval can be “found”, yet the returned snippet can still be low quality (e.g., a bare heading). This layer guarantees responses contain meaningful body text before the response policy runs.

### HS1 — Snippet Quality Guard (deterministic)
Before rendering `found/weak` results, enforce minimum snippet quality.

Defaults:
- `MIN_BODY_CHARS = 80` (tune later)
- `HEADING_ONLY_MAX_CHARS = 50`
- `MAX_APPEND_CHUNKS = 1` (keep it surgical)

Heuristic: snippet is low quality if any are true:
- `isHeadingOnly === true`, OR
- `bodyCharCount < MIN_BODY_CHARS`, OR
- snippet has no sentence-like punctuation and is very short (e.g., `< 80 chars`)

If low quality, upgrade using one of:
1) Header-only scoring penalty: apply a 90% score reduction to header-only chunks so body chunks rank higher.
2) Same-doc fallback search: re-run retrieval scoped to `docSlug` with `excludeChunkIds=[chunkId]`.
3) Next-best chunk: select the next chunk candidate that passes quality.

Guarantee:
- For `status: found` and `status: weak`, the final displayed snippet must contain 1–2 real sentences (unless the doc genuinely has no body).

Implementation notes:
- HS1 is implemented via a header-only scoring penalty plus fallback search to avoid selecting empty headings.
- HS2 tracks `lastChunkIdsShown[]` and uses `excludeChunkIds` to prevent repeats.

### HS2 — Follow-up Expansion (“tell me more”)
Maintain `lastDocSlug` + `lastChunkIdsShown[]`. When the user says:
- “tell me more”, “more details”, “continue”, “go on”, “expand”
Implementation note: follow-up detection should normalize polite prefixes (e.g., "can you", "please", "pls") and treat "tell me more" as a match even when it appears mid-utterance.
If follow-up detection misses but `lastDocSlug` is set, call the semantic classifier as a backup before falling back to LLM.

Prefer:
1) Retrieve a different chunk from the same doc (e.g., `excludeChunkIds` or cursor).
2) Apply HS1 again.
3) If no more chunks in that doc, fall back to query-based retrieval within the doc using `lastTopicTokens`.

Goal: follow-ups are additive (new content), not a repeated header.
Implementation note: follow-up retrieval and any fallback should call `mode: "chunks"` so HS1/HS2 always receive chunk metadata.

### HS3 — Optional bounded LLM formatting (excerpt-only)
Use an LLM only to format or summarize the already-selected snippet. It must not choose routing or content.

Trigger formatting when:
- the final snippet is long (e.g., > 600–900 chars), OR
- the user asked for steps (“walk me through…”, “step by step”), OR
- two chunks were appended and need condensation.

Constraint prompt (example):
“Summarize using only the excerpt. Do not add facts. If the excerpt doesn’t contain the answer, say so.”

---

## Semantic Fallback (Gated, Default-On)
This phase improves human-like recall for app-relevant phrasing while keeping deterministic routing as the default. Enabled by default when the feature flag is on; can be disabled without affecting deterministic routing.
Default-on means the flag is enabled, but the classifier only runs on uncertain routes (it never replaces confident doc/action routing).

### When to call the classifier (Pass 1)
Only call the semantic classifier if all are true:
- Deterministic routing returns `llm` (no confident route).
- App relevance is unclear (no **known doc terms** overlap and no widget/title match).
- No clarification is active.
- Not a fast-path selection reply (ordinal/label).
- Not a follow-up (follow-up = refers to prior context like “that/it/those/what about…”, within the active context window).
If the classifier is used to interpret a follow-up, pass `lastDocSlug` and `lastTopicTokens` so it can route to the same doc instead of starting from scratch.

### Classifier contract (strict JSON, one-shot)
Return JSON only:
```json
{
  "domain": "app" | "general",
  "intent": "doc_explain" | "action" | "search_notes" | "other",
  "confidence": 0.0,
  "rewrite": "optional normalized user query",
  "entities": {
    "docTopic": "optional",
    "widgetName": "optional",
    "noteQuery": "optional"
  },
  "needs_clarification": true | false,
  "clarify_question": "optional"
}
```

Rules:
- Max 1 classifier call per message.
- If `confidence < 0.7` or `needs_clarification=true`, ask one clarifying question.
- If `domain=general`, skip retrieval and go to general LLM response.
- Timeout (e.g., 300–600ms). On timeout/error, skip classifier and fall back to deterministic handling.

### Deterministic execution after Pass 1
- `doc_explain` → call `/api/docs/retrieve` with `rewrite` or original query. (Optional guard: only retrieve if `confidence >= threshold`.)
- `action` → run action router; if unresolved (no target, multiple competing targets, or low-confidence match), fall back to doc retrieval or clarification.
- `search_notes` → route to notes/files retrieval if implemented; otherwise ask a clarifying question or treat as `doc_explain`.
- `general` → normal LLM response (no retrieval).

### Pass 2 (HS3 formatting)
Still excerpt-only: LLM may summarize only the selected snippet(s). It must not pick docs/chunks or rewrite evidence.

---

## Response Policy Layer (Human-Like Output)
This layer governs **how answers are phrased** and runs **after** hybrid response selection. It is designed to make responses feel conversational while staying grounded and predictable.

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
- `lastChunkIdsShown?: string[]`
- `lastTopicTokens?: string[]`
- `clarification?: { type, options, question }`

### Correction handling (repair loop)
If the user says “no / not that / that’s wrong” after a `found` doc answer:
- re-run retrieval using `lastTopicTokens` + current input
- or fall back to `ambiguous` pills (top-2 docs)

### Pronoun follow-ups
If the user asks “how does it work?” / “tell me more”:
- use HS2 same-doc expansion when `lastDocSlug` is available
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
8) Implement Hybrid Response Selection:
   - HS1 snippet quality guard
   - HS2 follow-up expansion (same doc, avoid repeats)
   - HS3 optional bounded LLM formatting (excerpt-only)
9) Add Semantic Fallback classifier (feature-flagged, default-on):
   - gated by deterministic `llm` route + unclear relevance
   - strict JSON contract + timeout + fallback
10) Log routing + retrieval + snippet-quality + classifier metrics.

---

## Acceptance Tests
### Doc routing
1) “What is a workspace?” → doc retrieval answer (not LLM).
2) “describe the workspace” → doc retrieval answer.
3) “clarify how notes work” → doc retrieval answer.
4) “show me how to add a widget” → doc retrieval answer (polite-command carve-out).
5) “Tell me about home” → doc retrieval answer from concepts/home.
6) “home” → **weak** if top-two chunks are from the same doc (same-doc tie collapse); otherwise **ambiguous** (two options). Selecting an option uses `docSlug`.

### Hybrid response selection
7) “tell me more” after a `found` answer → returns 1–2 sentences of body, not a heading.
8) “tell me more” repeated twice → returns different chunks until doc exhausted.
9) Top chunk is header-only → auto-append next chunk or select next candidate.

### Action routing
10) “open workspace 6” → action.
11) “workspace 6” → action (index-like reference).
12) “note 2” → action (index-like reference).
13) “recent” → action (action noun).
14) Visible widget title (“widget manager”) → action.

### LLM routing (non-app)
15) “quantum physics” → skip retrieval → LLM.
16) “tell me a joke” → skip retrieval → LLM.

### Retrieval `no_match`
17) “foobar widget” (contains “widget” so app-relevant) → retrieval `no_match` → “Which part would you like me to explain?” + examples.

### Unified retrieval (docs + notes/files)
18) “search my notes for workspace” → notes corpus results.
19) “workspace” when both doc concept and note title exist → cross-corpus 2-pill disambiguation.
20) “tell me more” after a note snippet → HS2 returns next chunk from same note (no repeats).

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
| Snippet quality fail rate | % of `found/weak` where HS1 upgraded the snippet | Track + reduce |
| Follow-up repeat rate | % of “tell me more” that repeats a prior chunk | ~0% |
| Classifier usage rate | % of messages requiring semantic fallback | Track |
| Added latency p95 | p95 overhead for classifier + HS3 path | Track |

**Logging note:** include `route`, `status`, `docSlug` (if used), and whether the user corrected/accepted, so you can compute these rates reliably.
Clarification success should count all resolution paths (pill click, typed label, typed index).

---

## Rollout Checklist

### v5 Core (Ship First) ✅ COMPLETE (2026-01-13)
- [x] Routing + HS1/HS2 live for docs.
- [x] Header‑only penalty active and thresholds aligned (`MIN_BODY_CHARS=80`, `HEADING_ONLY_MAX_CHARS=50`).
- [x] `excludeChunkIds` + `lastChunkIdsShown[]` working on "tell me more."
- [x] Metrics logging enabled: correction rate, clarification success, turns‑to‑resolution, snippet‑quality fail rate.
- [x] Manual smoke tests:
  - [x] "what is a workspace?" → body content returned
  - [x] "tell me more" (no repeat) → cycles through chunks, shows exhaustion
  - [x] ambiguous term → 2 pills (clarification_shown logged)
  - [x] "not that" → repair loop (doc_correction logged)

### Optional Features (Phase In)
- Semantic fallback classifier (gated, default‑on):
  - Enable in staging → monitor usage rate + latency p95.
  - Roll out to prod if correction rate improves without latency spikes.
- Unified retrieval (notes/files):
  - Only after indexing + permissions are ready.
  - Add cross‑corpus ambiguity pills and HS1/HS2 reuse.


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
- Remove the doc-style routing branch and Hybrid Response Selection layer.
- Keep meta-explain and LLM routing unchanged.
